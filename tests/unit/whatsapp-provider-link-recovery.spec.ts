import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { ConversationService } from '../../src/domain/conversation/ConversationService';
import { WhatsAppDeliveryReceiptProcessor } from '../../src/domain/channel/whatsapp/WhatsAppDeliveryReceiptProcessor';
import { PostgresMessageQueue } from '../../src/domain/channel/whatsapp/MessageQueue';

function queueFixture() {
  const job: any = { id: 'job-1', wamid: 'inbound-1', tenantId: 'tenant-1',
    status: 'PROCESSING', outboundError: null, outboundMessageId: null };
  const db: any = {
    whatsAppMessageJob: {
      updateMany: vi.fn(async ({ data }: any) => { Object.assign(job, data); return { count: 1 }; }),
      findUnique: vi.fn(async () => ({ ...job })),
      findMany: vi.fn(async () => job.outboundError === 'PROVIDER_LINK_PENDING' ? [{ id: job.id }] : [])
    },
    message: { findFirst: vi.fn(async () => null) }
  };
  return { job, db };
}

describe('durable WhatsApp provider-message linking', () => {
  it('stores the provider ID even when immediate linking fails, then repairs it after restart', async () => {
    const { job, db } = queueFixture();
    const link = vi.spyOn(ConversationService.prototype, 'updateOutboundAssistantMessage')
      .mockRejectedValueOnce(new Error('temporary storage failure'))
      .mockResolvedValueOnce({ id: 'assistant-1' } as any);
    try {
      const original = new PostgresMessageQueue(db, { workerId: 'worker-1' });
      await original.completeJob(job.id, { leaseAttempt: 1, response: 'Hello',
        outboundStatus: 'SENT', outboundMessageId: 'meta-1' });
      expect(job.status).toBe('COMPLETED');
      expect(job.outboundMessageId).toBe('meta-1');
      expect(job.outboundError).toBe('PROVIDER_LINK_PENDING');

      const restarted = new PostgresMessageQueue(db, { workerId: 'worker-2' });
      expect(await restarted.reconcilePendingOutboundLinks()).toBe(1);
      expect(link).toHaveBeenCalledTimes(2);
      expect(job.outboundError).toBeNull();
    } finally { link.mockRestore(); }
  });

  it('does not reset READ to SENT when an already-linked message is reconciled', async () => {
    const { job, db } = queueFixture();
    const metadata = { deliveryStatus: 'READ' };
    db.message.findFirst.mockResolvedValue({ id: 'assistant-1', metadata });
    const reconcile = vi.spyOn(WhatsAppDeliveryReceiptProcessor.prototype, 'reconcileReceiptsForProviderId').mockResolvedValue(0);
    const link = vi.spyOn(ConversationService.prototype, 'updateOutboundAssistantMessage');
    try {
      const queue = new PostgresMessageQueue(db, { workerId: 'worker-1' });
      await queue.completeJob(job.id, { leaseAttempt: 1, outboundStatus: 'SENT', outboundMessageId: 'meta-1' });
      expect(metadata.deliveryStatus).toBe('READ');
      expect(link).not.toHaveBeenCalled();
      expect(reconcile).toHaveBeenCalledWith('tenant-1', 'meta-1');
      expect(job.outboundError).toBeNull();
    } finally { link.mockRestore(); reconcile.mockRestore(); }
  });
});

describe('production readiness', () => {
  it('reports an unavailable in-process message worker rather than database-only health', async () => {
    const app = await createApp({ prisma: { $queryRawUnsafe: vi.fn(async () => [{ '?column?': 1 }]) } } as any,
      { workerReady: () => false });
    const response = await request(app).get('/health');
    expect(response.status).toBe(503);
    expect(response.body.error).toBe('MESSAGE_WORKER_UNAVAILABLE');
  });
});
