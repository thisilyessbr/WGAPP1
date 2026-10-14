import express, { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { timingSafeEqual } from 'crypto';
import { SecretBox } from '../../../core/security/SecretBox';
import { WhatsAppNumberService } from './WhatsAppNumberService';
import { IdempotencyStore } from './IdempotencyStore';
import { InboundQueueJob, MessageQueue } from './MessageQueue';
import { createWhatsAppWebhookRouter } from './WhatsAppWebhookRouter';
import { ClientOwnedMetaCredentials } from './ClientOwnedMetaService';

function equalToken(a: unknown, b: string): boolean {
  if (typeof a !== 'string') return false;
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function createClientOwnedMetaWebhookRouter(
  db: PrismaClient,
  numberService: WhatsAppNumberService,
  idempotencyStore?: IdempotencyStore,
  queue?: MessageQueue<InboundQueueJob>
): Router {
  const router = express.Router();
  let secretBox: SecretBox | undefined;
  // Inner ingestion routers keyed by connection; the encrypted credential blob is
  // part of the entry so a credential rotation transparently rebuilds the router.
  const ingestionRouters = new Map<string, { credentialsBlob: string; router: Router }>();
  const MAX_CACHED_ROUTERS = 500;

  router.use('/:connectionId', async (req, res, next) => {
    try {
      const connectionId = String(req.params.connectionId);
      if (!/^[0-9a-f-]{36}$/i.test(connectionId)) return res.status(404).send('Not found');
      const connection = await db.channelConnection.findUnique({ where: { id: connectionId } });
      if (!connection || !connection.connectionKey.startsWith('CLIENT_OWNED:') || !connection.encryptedCredentials) {
        return res.status(404).send('Not found');
      }
      secretBox ??= new SecretBox();
      const credentials = secretBox.decryptJson<ClientOwnedMetaCredentials>(connection.encryptedCredentials);
      if (!credentials.appSecret || !credentials.verifyToken) return res.status(500).send('Webhook unavailable');

      if (req.method === 'GET') {
        if (req.query['hub.mode'] !== 'subscribe' || !equalToken(req.query['hub.verify_token'], credentials.verifyToken)) {
          return res.status(403).send('Forbidden');
        }
        if (connection.status === 'PENDING') {
          await db.channelConnection.update({ where: { id: connectionId }, data: { status: 'WEBHOOK_VERIFIED' } });
        }
        // Handshake fully validated above; no need to build the ingestion router.
        return res.status(200).type('text/plain').send(String(req.query['hub.challenge'] ?? ''));
      } else if (req.method === 'POST' && connection.status !== 'CONNECTED') {
        // Acknowledge without processing: a non-2xx makes Meta retry and can get the
        // webhook flagged while the connection is pending or disconnected.
        return res.status(200).json({ ignored: 'CONNECTION_NOT_ACTIVE' });
      }
      // Reuse the existing durable ingestion path with this app's own HMAC key.
      let cached = ingestionRouters.get(connectionId);
      if (!cached || cached.credentialsBlob !== connection.encryptedCredentials) {
        if (ingestionRouters.size >= MAX_CACHED_ROUTERS) {
          const oldest = ingestionRouters.keys().next().value;
          if (oldest !== undefined) ingestionRouters.delete(oldest);
        }
        cached = {
          credentialsBlob: connection.encryptedCredentials,
          router: createWhatsAppWebhookRouter(numberService, {
            appSecret: credentials.appSecret, verifyToken: credentials.verifyToken, expectedConnectionId: connectionId
          }, idempotencyStore, queue, db)
        };
        ingestionRouters.set(connectionId, cached);
      }
      return cached.router(req, res, next);
    } catch {
      return res.status(500).send('Webhook unavailable');
    }
  });
  return router;
}
