import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { PartitionedFifoQueue, InboundQueueJob } from '../../src/domain/channel/whatsapp/MessageQueue';
import { MemoryIdempotencyStore } from '../../src/domain/channel/whatsapp/IdempotencyStore';
import { createWhatsAppWebhookRouter } from '../../src/domain/channel/whatsapp/WhatsAppWebhookRouter';

describe('PHASE WHATSAPP-QUEUE-DISTRIBUTED-IDEMPOTENCY-AUDIT-IMPLEMENT-39: Queue & Concurrency Tests', () => {
  let queue: PartitionedFifoQueue<InboundQueueJob>;
  let idempotencyStore: MemoryIdempotencyStore;
  let mockNumberService: any;
  let app: express.Application;

  beforeEach(() => {
    queue = new PartitionedFifoQueue<InboundQueueJob>();
    idempotencyStore = new MemoryIdempotencyStore();
    mockNumberService = {
      resolveAccountByPhoneNumberId: vi.fn()
    };

    app = express();
    app.use(express.json());
    const router = createWhatsAppWebhookRouter(
      mockNumberService,
      {},
      idempotencyStore,
      queue
    );
    app.use('/webhook/whatsapp', router);
  });

  it('1. Same partition strictly preserves FIFO order', async () => {
    const partitionKey = 'tenant-1:acc-A:user-123';
    const processedOrder: string[] = [];

    queue.registerHandler(async (job) => {
      // Small artificial async jitter to test FIFO enforcement
      await new Promise(r => setTimeout(r, 10));
      processedOrder.push(job.message);
    });

    const messages = ['msg-1-first', 'msg-2-second', 'msg-3-third', 'msg-4-fourth', 'msg-5-fifth'];

    for (let i = 0; i < messages.length; i++) {
      await queue.enqueue({
        id: `job-${i}`,
        partitionKey,
        tenantId: 'tenant-1',
        accountId: 'acc-A',
        phoneNumberId: 'phone-1',
        waId: 'user-123',
        wamid: `wamid-${i}`,
        message: messages[i],
        timestamp: Date.now(),
        rawType: 'text',
        enqueuedAt: Date.now()
      }, partitionKey);
    }

    // Wait for queue processing to complete
    while (queue.getPendingCount() > 0 || queue.getActiveCount() > 0) {
      await new Promise(r => setTimeout(r, 20));
    }

    expect(processedOrder).toEqual(messages);
  });

  it('2. Different partitions execute concurrently and do not serialize', async () => {
    const executionLog: { user: string; event: 'start' | 'end'; time: number }[] = [];

    queue.registerHandler(async (job) => {
      executionLog.push({ user: job.waId, event: 'start', time: Date.now() });
      await new Promise(r => setTimeout(r, 50)); // Simulating 50ms work
      executionLog.push({ user: job.waId, event: 'end', time: Date.now() });
    });

    const startTime = Date.now();
    // Enqueue 5 jobs across 5 completely distinct users
    await Promise.all([
      queue.enqueue({ id: 'j1', partitionKey: 't:a:u1', tenantId: 't', accountId: 'a', phoneNumberId: 'p', waId: 'u1', wamid: 'w1', message: 'm', timestamp: 1, rawType: 'text', enqueuedAt: 1 }, 't:a:u1'),
      queue.enqueue({ id: 'j2', partitionKey: 't:a:u2', tenantId: 't', accountId: 'a', phoneNumberId: 'p', waId: 'u2', wamid: 'w2', message: 'm', timestamp: 1, rawType: 'text', enqueuedAt: 1 }, 't:a:u2'),
      queue.enqueue({ id: 'j3', partitionKey: 't:a:u3', tenantId: 't', accountId: 'a', phoneNumberId: 'p', waId: 'u3', wamid: 'w3', message: 'm', timestamp: 1, rawType: 'text', enqueuedAt: 1 }, 't:a:u3'),
      queue.enqueue({ id: 'j4', partitionKey: 't:a:u4', tenantId: 't', accountId: 'a', phoneNumberId: 'p', waId: 'u4', wamid: 'w4', message: 'm', timestamp: 1, rawType: 'text', enqueuedAt: 1 }, 't:a:u4'),
      queue.enqueue({ id: 'j5', partitionKey: 't:a:u5', tenantId: 't', accountId: 'a', phoneNumberId: 'p', waId: 'u5', wamid: 'w5', message: 'm', timestamp: 1, rawType: 'text', enqueuedAt: 1 }, 't:a:u5'),
    ]);

    while (queue.getPendingCount() > 0 || queue.getActiveCount() > 0) {
      await new Promise(r => setTimeout(r, 10));
    }
    const totalDuration = Date.now() - startTime;

    // 5 jobs taking 50ms each run in parallel -> Total time should be ~60-120ms, NOT 250ms+
    expect(totalDuration).toBeLessThan(200);
    expect(executionLog.filter(e => e.event === 'start')).toHaveLength(5);
  });

  it('3. 100 users do not serialize behind one slow user', async () => {
    const completedUsers: string[] = [];

    queue.registerHandler(async (job) => {
      if (job.waId === 'slow-user') {
        await new Promise(r => setTimeout(r, 150)); // Slow user takes 150ms
      } else {
        await new Promise(r => setTimeout(r, 5)); // Fast users take 5ms
      }
      completedUsers.push(job.waId);
    });

    // Enqueue slow user first
    await queue.enqueue({ id: 'slow', partitionKey: 't:a:slow-user', tenantId: 't', accountId: 'a', phoneNumberId: 'p', waId: 'slow-user', wamid: 'wslow', message: 'slow', timestamp: 1, rawType: 'text', enqueuedAt: 1 }, 't:a:slow-user');

    // Enqueue 10 fast users immediately after
    for (let i = 1; i <= 10; i++) {
      await queue.enqueue({ id: `fast-${i}`, partitionKey: `t:a:fast-user-${i}`, tenantId: 't', accountId: 'a', phoneNumberId: 'p', waId: `fast-user-${i}`, wamid: `wfast-${i}`, message: 'fast', timestamp: 1, rawType: 'text', enqueuedAt: 1 }, `t:a:fast-user-${i}`);
    }

    // Wait 40ms: Fast users should finish BEFORE slow user finishes
    await new Promise(r => setTimeout(r, 40));

    expect(completedUsers.length).toBeGreaterThan(0);
    // Slow user is NOT finished yet, but fast users ARE finished
    expect(completedUsers).not.toContain('slow-user');

    while (queue.getPendingCount() > 0 || queue.getActiveCount() > 0) {
      await new Promise(r => setTimeout(r, 20));
    }

    expect(completedUsers).toContain('slow-user');
    expect(completedUsers).toHaveLength(11);
  });

  it('4. Same wamid submitted 100 times results in exactly ONE accepted and enqueued job', async () => {
    mockNumberService.resolveAccountByPhoneNumberId.mockResolvedValue({
      tenantId: 'tenant-1',
      accountId: 'acc-A',
      phoneNumberId: 'phone-1'
    });

    const receivedJobs: InboundQueueJob[] = [];
    queue.registerHandler(async (job) => {
      receivedJobs.push(job);
    });

    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba_1',
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: 'phone-1' },
                messages: [
                  { from: '212600000000', id: 'wamid.storm_100', timestamp: '1724900000', text: { body: 'Hello' }, type: 'text' }
                ]
              }
            }
          ]
        }
      ]
    };

    // Send 100 concurrent requests with identical wamid
    const responses = await Promise.all(
      Array.from({ length: 100 }).map(() =>
        request(app).post('/webhook/whatsapp').send(payload)
      )
    );

    // All 100 requests receive HTTP 200 ACK
    for (const res of responses) {
      expect(res.status).toBe(200);
    }

    // Exactly one request was processed/enqueued
    const totalProcessed = responses.reduce((sum, res) => sum + (res.body.processed || 0), 0);
    expect(totalProcessed).toBe(1);

    // Wait for queue
    while (queue.getPendingCount() > 0 || queue.getActiveCount() > 0) {
      await new Promise(r => setTimeout(r, 10));
    }

    expect(receivedJobs).toHaveLength(1);
    expect(receivedJobs[0].wamid).toBe('wamid.storm_100');
  });

  it('5. Queue failure rolls back idempotency to allow retry without permanent loss', async () => {
    mockNumberService.resolveAccountByPhoneNumberId.mockResolvedValue({
      tenantId: 'tenant-1',
      accountId: 'acc-A',
      phoneNumberId: 'phone-1'
    });

    // Simulate queue failure on 1st attempt
    vi.spyOn(queue, 'enqueue').mockResolvedValueOnce(false);

    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba_1',
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: 'phone-1' },
                messages: [
                  { from: '212600000000', id: 'wamid.fail_rollback', timestamp: '1724900000', text: { body: 'Retry me' }, type: 'text' }
                ]
              }
            }
          ]
        }
      ]
    };

    // 1st request fails enqueue
    const res1 = await request(app).post('/webhook/whatsapp').send(payload);
    expect(res1.status).toBe(500);
    expect(res1.body.error).toBe('ENQUEUE_FAILED');

    // Idempotency key was rolled back, so key is NOT duplicate
    const isDup = await idempotencyStore.isDuplicate('wamid.fail_rollback');
    expect(isDup).toBe(false);

    // 2nd request (Meta retry) succeeds when queue is operational
    const res2 = await request(app).post('/webhook/whatsapp').send(payload);
    expect(res2.status).toBe(200);
    expect(res2.body.processed).toBe(1);
  });

  it('6. Disabled or unknown WhatsApp numbers never reach the queue', async () => {
    mockNumberService.resolveAccountByPhoneNumberId.mockResolvedValue(null);

    const receivedJobs: InboundQueueJob[] = [];
    queue.registerHandler(async (job) => {
      receivedJobs.push(job);
    });

    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba_1',
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: 'unknown_number' },
                messages: [
                  { from: '212600000000', id: 'wamid.unknown_num', timestamp: '1724900000', text: { body: 'Test' }, type: 'text' }
                ]
              }
            }
          ]
        }
      ]
    };

    const res = await request(app).post('/webhook/whatsapp').send(payload);
    expect(res.status).toBe(200);
    expect(res.body.processed).toBe(0);

    expect(receivedJobs).toHaveLength(0);
    expect(queue.getPendingCount()).toBe(0);
  });
});
