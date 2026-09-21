import { afterEach, expect, it, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createHmac } from 'crypto';
import { createWhatsAppWebhookRouter } from '../../src/domain/channel/whatsapp/WhatsAppWebhookRouter';
import { MemoryIdempotencyStore } from '../../src/domain/channel/whatsapp/IdempotencyStore';
import { createApp } from '../../src/app';
import { createSignedToken } from '../../src/dev/chatApi';
import { ClientSafetyGuard } from '../../src/domain/channel/guard/ClientSafetyGuard';
import { PostgresMessageQueue } from '../../src/domain/channel/whatsapp/MessageQueue';

afterEach(() => vi.unstubAllEnvs());

it('accepts a retry after enqueue throws', async () => {
  const enqueue = vi.fn().mockRejectedValueOnce(new Error('database interrupted')).mockResolvedValue(true);
  const app = express();
  app.use(express.json({ verify: (req, _res, buf) => { (req as any).rawBody = buf; } }));
  app.use('/webhook', createWhatsAppWebhookRouter({
    resolveAccountByPhoneNumberId: vi.fn().mockResolvedValue({ tenantId: 't', accountId: 'a' })
  } as any, { appSecret: 'audit-only-webhook-secret' }, new MemoryIdempotencyStore(), { enqueue } as any));
  const payload = JSON.stringify({ entry: [{ changes: [{ field: 'messages', value: {
    metadata: { phone_number_id: 'number-a' },
    messages: [{ id: 'wamid.audit-retry', from: 'customer-a', timestamp: '1789258500', type: 'text', text: { body: 'hello' } }]
  } }] }] });
  const signature = 'sha256=' + createHmac('sha256', 'audit-only-webhook-secret').update(payload).digest('hex');
  const send = () => request(app).post('/webhook').set('Content-Type', 'application/json')
    .set('X-Hub-Signature-256', signature).send(payload);
  expect((await send()).status).toBe(500);
  const retry = await send();
  expect(retry.status).toBe(200);
  expect(retry.body.processed).toBe(1);
  expect(enqueue).toHaveBeenCalledTimes(2);
});

// Regression tests for the September audit findings.
it('allows ordinary users through to chat validation while protecting channels', async () => {
  vi.stubEnv('AUTH_SECRET', 'audit-only-signing-secret-32-bytes-long');
  vi.stubEnv('NODE_ENV', 'production');
  const app = await createApp({
    prisma: { tenant: { findUnique: vi.fn().mockResolvedValue({ id: 'tenant-a' }) } }, whatsAppNumberService: {}, clientSafetyGuard: {}
  } as any);
  const token = createSignedToken({ tenantId: 'tenant-a', customerId: 'customer-a', role: 'user' });
  const response = await request(app).post('/api/v1/chat')
    .set('Authorization', `Bearer ${token}`)
    .send({ customerId: 'customer-a' });
  expect(response.status).toBe(400);
  const denied = await request(app).get('/api/v1/channels/dashboard').set('Authorization', `Bearer ${token}`);
  expect(denied.status).toBe(403);
});

it('defers delivery when safety state cannot be read', async () => {
  const guard = new ClientSafetyGuard({
    tenantConfig: { findUnique: vi.fn().mockRejectedValue(new Error('temporary database failure')) },
    customer: { findFirst: vi.fn().mockRejectedValue(new Error('temporary database failure')) }
  } as any, {
    resolveAccountByPhoneNumberId: vi.fn().mockResolvedValue({
      tenantId: 'tenant-a', accountId: 'account-a', enabled: true, status: 'CONNECTED', transport: 'META_CLOUD'
    })
  } as any);
  await expect(guard.evaluateOutbound({
    tenantId: 'tenant-a', accountId: 'account-a', phoneNumberId: 'number-a', recipientWaId: 'customer-a'
  })).rejects.toThrow('SAFETY_STATE_UNAVAILABLE');
});

it('rejects completion without an owned lease', async () => {
  const update = vi.fn().mockResolvedValue({});
  const queue = new PostgresMessageQueue({ whatsAppMessageJob: { update } } as any, { workerId: 'old-worker' });
  await expect(queue.completeJob('job-reclaimed-by-new-worker', { response: 'old response' })).rejects.toThrow('LEASE_NOT_OWNED');
  expect(update).not.toHaveBeenCalled();
});

it('resumes a HUMAN_ACTIVE conversation atomically', async () => {
  const conversation = { id: 'conv-a', tenantId: 'tenant-a', accountId: 'account-a', status: 'HUMAN_ACTIVE', humanRequested: true };
  let state = { humanTakeover: true, botEnabled: false };
  const db: any = {
    conversation: {
      findUnique: vi.fn().mockImplementation(async () => conversation),
      update: vi.fn().mockImplementation(async ({ data }) => Object.assign(conversation, data)),
      updateMany: vi.fn().mockImplementation(async ({ data }) => { Object.assign(conversation, data); return { count: 1 }; })
    },
    conversationAutomationState: {
      upsert: vi.fn().mockImplementation(async ({ update }) => { state = { ...state, ...update }; return state; }),
      findUnique: vi.fn().mockImplementation(async () => state)
    },
    tenantConfig: { findUnique: vi.fn().mockResolvedValue({ config: {} }) },
    channelAuditEvent: { create: vi.fn().mockResolvedValue({}) }
  };
  db.$transaction = vi.fn(async (fn) => fn(db));
  const guard = new ClientSafetyGuard(db);
  await guard.setHumanTakeover('tenant-a', 'conv-a', false);
  const result = await guard.evaluateOutbound({ tenantId: 'tenant-a', accountId: 'account-a', phoneNumberId: 'number-a', recipientWaId: 'customer-a', conversationId: 'conv-a' });
  expect(state.botEnabled).toBe(true);
  expect(result.code).toBe('ALLOWED');
  expect(conversation.status).toBe('ACTIVE');
});
