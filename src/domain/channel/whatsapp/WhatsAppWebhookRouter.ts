import express, { Request, Response, Router } from 'express';
import { createHash } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { WhatsAppSignatureValidator } from './WhatsAppSignatureValidator';
import { WhatsAppWebhookExtractor } from './WhatsAppWebhookExtractor';
import { IdempotencyStore, MemoryIdempotencyStore } from './IdempotencyStore';
import { WhatsAppNumberService } from './WhatsAppNumberService';
import { WhatsAppWebhookOptions } from './types';
import { MessageQueue, InboundQueueJob, PartitionedFifoQueue } from './MessageQueue';
import { logger } from '../../../utils/logger';

export function createWhatsAppWebhookRouter(
  numberService: WhatsAppNumberService,
  options: WhatsAppWebhookOptions = {},
  idempotencyStore: IdempotencyStore = new MemoryIdempotencyStore(),
  queue?: MessageQueue<InboundQueueJob>,
  prismaClient?: PrismaClient
): Router {
  const router = express.Router();
  const db = prismaClient || options.prisma;
  const appSecret = options.appSecret ?? process.env.WHATSAPP_APP_SECRET ?? process.env.META_APP_SECRET;
  const verifyToken = options.verifyToken ?? process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;

  /**
   * Phase 4: GET Webhook Handshake Verification
   */
  router.get('/', (req: Request, res: Response) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token && verifyToken && token === verifyToken) {
      logger.info('WhatsAppWebhookRouter: Webhook subscription verified successfully');
      return res.status(200).send(challenge);
    }

    logger.warn('WhatsAppWebhookRouter: Webhook verification handshake failed (invalid token or mode)');
    return res.status(403).send('Forbidden');
  });

  /**
   * Phase 3, 5, 6, 7, 8, 39: POST Webhook Ingestion, Deduplication, Account Resolution & Enqueue
   */
  router.post('/', async (req: Request, res: Response) => {
    // 1. Fail-Closed HMAC Signature Verification
    if (!appSecret) {
      if (process.env.NODE_ENV === 'production' || process.env.STRICT_AUTH === 'true') {
        logger.error('WhatsAppWebhookRouter: Webhook rejected: WHATSAPP_APP_SECRET/META_APP_SECRET is not configured');
        return res.status(500).json({
          error: 'WEBHOOK_SECRET_NOT_CONFIGURED',
          message: 'Meta app secret must be configured to process webhooks.'
        });
      }
      // Non-production without appSecret and without STRICT_AUTH: log warning
      logger.warn('WhatsAppWebhookRouter: Processing webhook without HMAC validation (development/test mode only)');
    } else {
      const signatureHeader = req.headers['x-hub-signature-256'] as string | undefined;
      if (!signatureHeader) {
        logger.warn('WhatsAppWebhookRouter: Missing X-Hub-Signature-256 header on inbound webhook');
        return res.status(401).json({ error: 'MISSING_SIGNATURE' });
      }

      const rawBody = (req as any).rawBody || (Buffer.isBuffer(req.body) ? req.body : (typeof req.body === 'string' ? Buffer.from(req.body, 'utf8') : null));
      if (!rawBody) {
        logger.error('WhatsAppWebhookRouter: Authoritative rawBody is missing for signature verification');
        return res.status(500).json({ error: 'RAW_BODY_UNAVAILABLE' });
      }

      const isSignatureValid = WhatsAppSignatureValidator.isValid(rawBody, signatureHeader, appSecret);
      if (!isSignatureValid) {
        logger.warn('WhatsAppWebhookRouter: Inbound webhook signature verification failed');
        return res.status(401).json({ error: 'INVALID_SIGNATURE' });
      }
    }

    try {
      // 2. Safe Extraction of Messages and Asynchronous Delivery Statuses
      const extractedMessages = WhatsAppWebhookExtractor.extractMessages(req.body);
      const extractedStatuses = WhatsAppWebhookExtractor.extractStatuses(req.body);

      let processedStatuses = 0;
      if (extractedStatuses.length > 0) {
        for (const st of extractedStatuses) {
          try {
            const mapping = await numberService.resolveAccountByPhoneNumberId(st.phoneNumberId);
            if (!mapping) {
              logger.warn(`WhatsAppWebhookRouter: Received delivery receipt for unregistered or disabled phoneNumberId [${st.phoneNumberId}]`);
              continue;
            }

            // Deduplication key: sha256(phoneNumberId:wamid:status:timestamp)
            const dedupeInput = `${st.phoneNumberId}:${st.wamid}:${st.status}:${st.timestamp}`;
            const dedupeKey = createHash('sha256').update(dedupeInput).digest('hex');

            if (db) {
              try {
                await db.whatsAppDeliveryReceipt.create({
                  data: {
                    dedupeKey,
                    tenantId: mapping.tenantId,
                    accountId: mapping.accountId,
                    phoneNumberId: st.phoneNumberId,
                    providerMessageId: st.wamid,
                    recipientWaId: st.recipientWaId,
                    status: st.status.toUpperCase(),
                    providerTimestamp: new Date(st.timestamp * 1000),
                    errorCode: st.errorCode ?? null,
                    errorMessage: st.errorMessage ?? null,
                    correlated: false
                  }
                });
                processedStatuses++;
                logger.info(`WhatsAppWebhookRouter: Ingested delivery receipt [${st.status}] for provider ID [${st.wamid}]`);
              } catch (err: any) {
                if (err.code === 'P2002' || err.message?.includes('Unique constraint')) {
                  logger.info(`WhatsAppWebhookRouter: Deduplicated status receipt for wamid [${st.wamid}] with status [${st.status}]`);
                  continue;
                }
                throw err;
              }
            } else {
              processedStatuses++;
            }
          } catch (statusErr: any) {
            logger.error(`WhatsAppWebhookRouter: Failed to record delivery receipt for [${st.wamid}]: ${statusErr.message || statusErr}`);
          }
        }

        if (extractedMessages.length === 0) {
          return res.status(200).json({ status: 'ACK', processed: processedStatuses });
        }
      }

      if (extractedMessages.length === 0) {
        // Non-message, non-status events are acknowledged immediately
        return res.status(200).json({ status: 'ACK', processed: 0 });
      }

      let acknowledgedCount = 0;

      for (const msg of extractedMessages) {
        // 3. Idempotency Check (Deduplication)
        const { isDuplicate } = queue?.durable ? { isDuplicate: false } : await idempotencyStore.checkAndRecord(msg.wamid, options.idempotencyTtlSeconds);
        if (isDuplicate) {
          logger.info(`WhatsAppWebhookRouter: Dropped duplicate webhook event for wamid [${msg.wamid}]`);
          continue;
        }

        // 4. Server-side Phone Number -> Account Resolution
        let mapping;
        try {
          mapping = await numberService.resolveAccountByPhoneNumberId(msg.phoneNumberId);
        } catch (error) {
          if (!queue?.durable) await idempotencyStore.delete(msg.wamid);
          throw error;
        }
        if (!mapping) {
          logger.warn(`WhatsAppWebhookRouter: Received message for unregistered or disabled phoneNumberId [${msg.phoneNumberId}]`);
          continue;
        }

        // 5. Asynchronous Queue Enqueue (if message queue is configured)
        if (queue) {
          const partitionKey = `${mapping.tenantId}:${mapping.accountId}:${msg.waId}`;
          const job: InboundQueueJob = {
            id: msg.wamid,
            partitionKey,
            tenantId: mapping.tenantId,
            accountId: mapping.accountId,
            phoneNumberId: msg.phoneNumberId,
            waId: msg.waId,
            wamid: msg.wamid,
            message: msg.message,
            timestamp: msg.timestamp,
            contactName: msg.contactName,
            rawType: msg.rawType,
            enqueuedAt: Date.now()
          };

          let enqueued: boolean;
          try {
            enqueued = await queue.enqueue(job, partitionKey);
          } catch (error) {
            if (!queue.durable) await idempotencyStore.delete(msg.wamid);
            throw error;
          }
          if (!enqueued) {
            // Roll back idempotency record to allow Meta retry without permanent loss
            await idempotencyStore.delete(msg.wamid);
            logger.error(`WhatsAppWebhookRouter: Failed to enqueue job for wamid [${msg.wamid}] on partition [${partitionKey}]`);
            return res.status(500).json({ error: 'ENQUEUE_FAILED', wamid: msg.wamid });
          }
        }

        acknowledgedCount++;
        logger.info(`WhatsAppWebhookRouter: Acknowledged & enqueued inbound message from [${msg.waId}] on account [${mapping.accountId}] (wamid: ${msg.wamid})`);
      }

      // 6. Immediate HTTP 200 Acknowledgment
      return res.status(200).json({ status: 'ACK', processed: acknowledgedCount });
    } catch (err: any) {
      logger.error(`WhatsAppWebhookRouter: Unexpected error processing webhook: ${err.message || err}`);
      // Fail closed with HTTP 500 so Meta Cloud API will retry delivering the message
      return res.status(500).json({ error: 'WEBHOOK_PROCESSING_FAILED', message: 'The webhook could not be processed.' });
    }
  });

  return router;
}
