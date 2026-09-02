import express, { Request, Response, Router } from 'express';
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
  queue?: MessageQueue<InboundQueueJob>
): Router {
  const router = express.Router();
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
    // 1. HMAC Signature Verification
    if (appSecret) {
      const signatureHeader = req.headers['x-hub-signature-256'] as string | undefined;
      const rawBody = (req as any).rawBody || (typeof req.body === 'string' ? req.body : Buffer.from(JSON.stringify(req.body || {})));

      const isSignatureValid = WhatsAppSignatureValidator.isValid(rawBody, signatureHeader, appSecret);
      if (!isSignatureValid) {
        logger.warn('WhatsAppWebhookRouter: Inbound webhook signature verification failed');
        return res.status(401).json({ error: 'INVALID_SIGNATURE' });
      }
    }

    try {
      // 2. Safe Message Extraction
      const extractedMessages = WhatsAppWebhookExtractor.extractMessages(req.body);

      if (extractedMessages.length === 0) {
        // Status updates or non-text events are acknowledged immediately
        return res.status(200).json({ status: 'ACK', processed: 0 });
      }

      let acknowledgedCount = 0;

      for (const msg of extractedMessages) {
        // 3. Idempotency Check (Deduplication)
        const { isDuplicate } = await idempotencyStore.checkAndRecord(msg.wamid, options.idempotencyTtlSeconds);
        if (isDuplicate) {
          logger.info(`WhatsAppWebhookRouter: Dropped duplicate webhook event for wamid [${msg.wamid}]`);
          continue;
        }

        // 4. Server-side Phone Number -> Account Resolution
        const mapping = await numberService.resolveAccountByPhoneNumberId(msg.phoneNumberId);
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

          const enqueued = await queue.enqueue(job, partitionKey);
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
      return res.status(200).json({ status: 'ACK_WITH_ERROR' });
    }
  });

  return router;
}
