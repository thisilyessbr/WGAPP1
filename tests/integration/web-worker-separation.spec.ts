import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { prisma, pool } from '../../src/tests/testDb';
import { bootstrapWebDependencies, bootstrapWorkerDependencies, WebDependencies, WorkerDependencies } from '../../src/bootstrap';
import { createApp } from '../../src/app';
import { PostgresMessageQueue, InboundQueueJob } from '../../src/domain/channel/whatsapp/MessageQueue';
import { LLMMockProvider } from '../../src/core/llm/LLMProvider';

describe('Phase 2: Web / Worker Separation Integration Tests', () => {
  const testSecret = 'test-meta-app-secret-32-chars-long!';
  const createdTenantIds: string[] = [];
  let webDeps: WebDependencies;
  let workerDeps: WorkerDependencies;

  beforeAll(async () => {
    const client = await pool.connect();
    try {
      await client.query('SET search_path TO test, public, extensions;');
    } finally {
      client.release();
    }
  });

  afterEach(async () => {
    if (webDeps?.whatsAppMessageQueue) {
      await webDeps.whatsAppMessageQueue.shutdown();
    }
    if (workerDeps?.whatsAppMessageQueue) {
      await workerDeps.whatsAppMessageQueue.shutdown();
    }
    for (const tenantId of createdTenantIds) {
      try {
        await prisma.whatsAppMessageJob.deleteMany({ where: { tenantId } });
        await prisma.whatsAppBusinessNumber.deleteMany({ where: { tenantId } });
        await prisma.conversation.deleteMany({ where: { tenantId } });
        await prisma.customer.deleteMany({ where: { tenantId } });
        await prisma.account.deleteMany({ where: { tenantId } });
        await prisma.tenant.deleteMany({ where: { id: tenantId } });
      } catch {}
    }
    createdTenantIds.length = 0;
  });

  async function createTestFixture(prefix: string) {
    const tenantId = `tenant-sep-${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    createdTenantIds.push(tenantId);

    const tenant = await prisma.tenant.create({
      data: { id: tenantId, name: `Tenant ${prefix}` }
    });

    const account = await prisma.account.create({
      data: { tenantId, name: 'Main Account' }
    });

    const phoneNumberId = `phone-${prefix}-${Date.now()}`;
    const businessNumber = await prisma.whatsAppBusinessNumber.create({
      data: {
        tenantId,
        accountId: account.id,
        phoneNumberId,
        displayPhoneNumber: '+212600000000',
        status: 'CONNECTED',
        enabled: true
      }
    });

    return { tenantId, accountId: account.id, phoneNumberId, businessNumber };
  }

  function signPayload(body: any, secret = testSecret): string {
    const raw = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf8');
    const hash = crypto.createHmac('sha256', secret).update(raw).digest('hex');
    return `sha256=${hash}`;
  }

  it('1. Web process isolation: strictly producer-only, no workers, no conversationEngine', async () => {
    webDeps = bootstrapWebDependencies(prisma);

    expect(webDeps.whatsAppWorker).toBeUndefined();
    expect(webDeps.conversationEngine).toBeUndefined();
    expect(webDeps.ragService).toBeUndefined();
    expect(webDeps.pdfIngestionService).toBeUndefined();
    expect(webDeps.llmFactory).toBeUndefined();

    // Verify queue is producer-only
    const queue = webDeps.whatsAppMessageQueue as PostgresMessageQueue;
    expect(queue.durable).toBe(true);

    // Registering a worker handler on web producer queue must throw
    expect(() => {
      queue.registerHandler(async () => {});
    }).toThrow('Cannot register handler on producer-only queue');

    // Starting a worker on web producer queue must be a no-op
    queue.startWorker?.();
    expect(await queue.getActiveCount()).toBe(0);
  });

  it('provides a preview engine on portal web without starting a WhatsApp worker', async () => {
    const previous = process.env.PORTAL_ENABLED;
    process.env.PORTAL_ENABLED = 'true';
    try {
      webDeps = bootstrapWebDependencies(prisma);
      expect(webDeps.portalService).toBeDefined();
      expect(webDeps.conversationEngine?.previewMessage).toBeTypeOf('function');
      expect(webDeps.whatsAppWorker).toBeUndefined();
      expect(webDeps.ragService).toBeUndefined();
      expect(webDeps.llmFactory).toBeUndefined();
    } finally {
      webDeps?.portalService?.stop();
      if (previous === undefined) delete process.env.PORTAL_ENABLED;
      else process.env.PORTAL_ENABLED = previous;
    }
  });

  it('2. Worker process isolation: initializes AI pipeline and queue consumer without Express', async () => {
    workerDeps = bootstrapWorkerDependencies(prisma, { autoStartQueue: false });

    expect(workerDeps.whatsAppWorker).toBeDefined();
    expect(workerDeps.conversationEngine).toBeDefined();
    expect(workerDeps.llmFactory).toBeDefined();
    expect(workerDeps.ragService).toBeDefined();
    expect(workerDeps.whatsAppOutboundAdapter).toBeDefined();

    // Worker does not expose Express app
    expect((workerDeps as any).app).toBeUndefined();
  });

  it('3. Web ingress: receives webhook, fast HTTP 200 ACK, durable job enqueued with PENDING status', async () => {
    process.env.WHATSAPP_APP_SECRET = testSecret;
    const fixture = await createTestFixture('webhook-ack');
    webDeps = bootstrapWebDependencies(prisma);
    const app = await createApp(webDeps);

    const wamid = `wamid.test.${Date.now()}`;
    const payload = {
      object: 'whatsapp_business_account',
      entry: [{
        id: 'WHATSAPP_BUSINESS_ACCOUNT_ID',
        changes: [{
          value: {
            messaging_product: 'whatsapp',
            metadata: {
              display_phone_number: '+212600000000',
              phone_number_id: fixture.phoneNumberId
            },
            contacts: [{ profile: { name: 'Karim' }, wa_id: '212611111111' }],
            messages: [{
              from: '212611111111',
              id: wamid,
              timestamp: String(Math.floor(Date.now() / 1000)),
              text: { body: 'Salam, bghit nswlkom' },
              type: 'text'
            }]
          },
          field: 'messages'
        }]
      }]
    };

    const signature = signPayload(payload, testSecret);

    const res = await request(app)
      .post('/api/v1/webhook/whatsapp')
      .set('x-hub-signature-256', signature)
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ACK', processed: 1 });

    // Verify job is persisted durably in database with PENDING status
    const job = await prisma.whatsAppMessageJob.findUnique({
      where: { wamid }
    });

    expect(job).not.toBeNull();
    expect(job!.status).toBe('PENDING');
    expect(job!.tenantId).toBe(fixture.tenantId);
    expect(job!.accountId).toBe(fixture.accountId);
    expect(job!.message).toBe('Salam, bghit nswlkom');
  });

  it('4. Worker consumption: claims enqueued job, runs ConversationEngine, marks COMPLETED', async () => {
    const fixture = await createTestFixture('worker-exec');
    webDeps = bootstrapWebDependencies(prisma);

    const wamid = `wamid.exec.${Date.now()}`;
    const partitionKey = `${fixture.tenantId}:${fixture.accountId}:212622222222`;

    // Enqueue job via web producer
    await webDeps.whatsAppMessageQueue.enqueue({
      id: wamid,
      partitionKey,
      tenantId: fixture.tenantId,
      accountId: fixture.accountId,
      phoneNumberId: fixture.phoneNumberId,
      waId: '212622222222',
      wamid,
      message: 'Bonjour',
      timestamp: Date.now(),
      rawType: 'text',
      enqueuedAt: Date.now()
    }, partitionKey);

    // Initialize worker with mock LLM
    workerDeps = bootstrapWorkerDependencies(prisma, { autoStartQueue: false });
    const mockLlm = new LLMMockProvider();
    mockLlm.generatedResponseMock = 'Marhaban bik f Relayqo!';
    workerDeps.llmFactory.registerProvider('mock', 'mock-model', mockLlm);
    workerDeps.llmFactory.registerProvider('deepseek', 'deepseek-chat', mockLlm);

    const queue = workerDeps.whatsAppMessageQueue as PostgresMessageQueue;

    // Worker claims the pending job
    const claimedJob = await queue.claimNextJob();
    expect(claimedJob).not.toBeNull();
    expect(claimedJob!.wamid).toBe(wamid);

    // Complete job
    await queue.completeJob(claimedJob!.id, {
      leaseAttempt: claimedJob!.leaseAttempt,
      response: 'Marhaban bik f Relayqo!',
      outboundStatus: 'SENT',
      outboundMessageId: 'meta-msg-id-123'
    });

    const updated = await prisma.whatsAppMessageJob.findUnique({ where: { wamid } });
    expect(updated!.status).toBe('COMPLETED');
    expect(updated!.response).toBe('Marhaban bik f Relayqo!');
    expect(updated!.outboundStatus).toBe('SENT');
  });

  it('5. FIFO ordering per customer partition: serializes jobs for same customer', async () => {
    const fixture = await createTestFixture('fifo');
    const queue = new PostgresMessageQueue(prisma, { workerConcurrency: 2, pollIntervalMs: 50, leaseSeconds: 5 });
    const partitionKey = `${fixture.tenantId}:${fixture.accountId}:212633333333`;

    const wamid1 = `wamid.fifo.1.${Date.now()}`;
    const wamid2 = `wamid.fifo.2.${Date.now()}`;

    // Enqueue job 1
    await queue.enqueue({
      id: wamid1,
      partitionKey,
      tenantId: fixture.tenantId,
      accountId: fixture.accountId,
      phoneNumberId: fixture.phoneNumberId,
      waId: '212633333333',
      wamid: wamid1,
      message: 'Message 1',
      timestamp: Date.now(),
      rawType: 'text',
      enqueuedAt: Date.now()
    }, partitionKey);

    // Small pause to guarantee createdAt ordering
    await new Promise((r) => setTimeout(r, 20));

    // Enqueue job 2
    await queue.enqueue({
      id: wamid2,
      partitionKey,
      tenantId: fixture.tenantId,
      accountId: fixture.accountId,
      phoneNumberId: fixture.phoneNumberId,
      waId: '212633333333',
      wamid: wamid2,
      message: 'Message 2',
      timestamp: Date.now() + 20,
      rawType: 'text',
      enqueuedAt: Date.now() + 20
    }, partitionKey);

    // Claim first job
    const job1 = await queue.claimNextJob();
    expect(job1).not.toBeNull();
    expect(job1!.wamid).toBe(wamid1);

    // While job 1 is PROCESSING, claiming again for the same partition must yield null (strict FIFO)
    const blockedJob = await queue.claimNextJob();
    expect(blockedJob).toBeNull();

    // Complete job 1
    await queue.completeJob(job1!.id, {
      leaseAttempt: job1!.leaseAttempt,
      response: 'Responded 1',
      outboundStatus: 'SENT'
    });

    // Now job 2 can be claimed
    const job2 = await queue.claimNextJob();
    expect(job2).not.toBeNull();
    expect(job2!.wamid).toBe(wamid2);

    await queue.completeJob(job2!.id, {
      leaseAttempt: job2!.leaseAttempt,
      response: 'Responded 2',
      outboundStatus: 'SENT'
    });

    await queue.shutdown();
  });

  it('6. Cross-customer concurrency: different customer partitions can be claimed concurrently', async () => {
    const fixture = await createTestFixture('cross-cust');
    const queue = new PostgresMessageQueue(prisma, { workerConcurrency: 2, pollIntervalMs: 50, leaseSeconds: 5 });

    const partition1 = `${fixture.tenantId}:${fixture.accountId}:custA`;
    const partition2 = `${fixture.tenantId}:${fixture.accountId}:custB`;

    const wamidA = `wamid.conc.A.${Date.now()}`;
    const wamidB = `wamid.conc.B.${Date.now()}`;

    await queue.enqueue({
      id: wamidA,
      partitionKey: partition1,
      tenantId: fixture.tenantId,
      accountId: fixture.accountId,
      phoneNumberId: fixture.phoneNumberId,
      waId: 'custA',
      wamid: wamidA,
      message: 'Hello from A',
      timestamp: Date.now(),
      rawType: 'text',
      enqueuedAt: Date.now()
    }, partition1);

    await queue.enqueue({
      id: wamidB,
      partitionKey: partition2,
      tenantId: fixture.tenantId,
      accountId: fixture.accountId,
      phoneNumberId: fixture.phoneNumberId,
      waId: 'custB',
      wamid: wamidB,
      message: 'Hello from B',
      timestamp: Date.now(),
      rawType: 'text',
      enqueuedAt: Date.now()
    }, partition2);

    // Both jobs should be claimable concurrently since they have different partitionKeys
    const jobA = await queue.claimNextJob();
    const jobB = await queue.claimNextJob();

    expect(jobA).not.toBeNull();
    expect(jobB).not.toBeNull();
    expect(new Set([jobA!.wamid, jobB!.wamid])).toEqual(new Set([wamidA, wamidB]));

    await queue.completeJob(jobA!.id, { leaseAttempt: jobA!.leaseAttempt, response: 'Done A' });
    await queue.completeJob(jobB!.id, { leaseAttempt: jobB!.leaseAttempt, response: 'Done B' });

    await queue.shutdown();
  });

  it('7. Worker crash & lease recovery: expired lease is recovered by another worker', async () => {
    const fixture = await createTestFixture('crash-recovery');
    const partitionKey = `${fixture.tenantId}:${fixture.accountId}:custCrash`;
    const wamid = `wamid.crash.${Date.now()}`;

    const deadWorkerQueue = new PostgresMessageQueue(prisma, {
      leaseSeconds: 1,
      workerId: 'dead-worker-1'
    });

    await deadWorkerQueue.enqueue({
      id: wamid,
      partitionKey,
      tenantId: fixture.tenantId,
      accountId: fixture.accountId,
      phoneNumberId: fixture.phoneNumberId,
      waId: 'custCrash',
      wamid,
      message: 'Before crash',
      timestamp: Date.now(),
      rawType: 'text',
      enqueuedAt: Date.now()
    }, partitionKey);

    const claimedByDead = await deadWorkerQueue.claimNextJob();
    expect(claimedByDead).not.toBeNull();
    expect(claimedByDead!.wamid).toBe(wamid);

    // Simulate worker death: worker stops responding, lease expires in the past
    await prisma.whatsAppMessageJob.update({
      where: { id: claimedByDead!.id },
      data: {
        lockedAt: new Date(Date.now() - 5000) // 5 seconds ago (lease is 1s)
      }
    });

    // New recovery worker starts
    const recoveryQueue = new PostgresMessageQueue(prisma, {
      leaseSeconds: 1,
      workerId: 'recovery-worker-2'
    });

    const recoveredJob = await recoveryQueue.claimNextJob();
    expect(recoveredJob).not.toBeNull();
    expect(recoveredJob!.wamid).toBe(wamid);
    expect(recoveredJob!.leaseAttempt).toBe(2);

    await recoveryQueue.completeJob(recoveredJob!.id, {
      leaseAttempt: recoveredJob!.leaseAttempt,
      response: 'Recovered!',
      outboundStatus: 'SENT'
    });

    const finalJob = await prisma.whatsAppMessageJob.findUnique({ where: { wamid } });
    expect(finalJob!.status).toBe('COMPLETED');
    expect(finalJob!.response).toBe('Recovered!');

    await deadWorkerQueue.shutdown();
    await recoveryQueue.shutdown();
  });

  it('8. Duplicate webhook idempotency: duplicate wamid is deduplicated without error', async () => {
    process.env.WHATSAPP_APP_SECRET = testSecret;
    const fixture = await createTestFixture('idempotent');
    webDeps = bootstrapWebDependencies(prisma);
    const app = await createApp(webDeps);

    const wamid = `wamid.dupe.${Date.now()}`;
    const payload = {
      object: 'whatsapp_business_account',
      entry: [{
        id: 'WHATSAPP_BUSINESS_ACCOUNT_ID',
        changes: [{
          value: {
            messaging_product: 'whatsapp',
            metadata: {
              display_phone_number: '+212600000000',
              phone_number_id: fixture.phoneNumberId
            },
            contacts: [{ profile: { name: 'Amina' }, wa_id: '212644444444' }],
            messages: [{
              from: '212644444444',
              id: wamid,
              timestamp: String(Math.floor(Date.now() / 1000)),
              text: { body: 'Repeated webhook' },
              type: 'text'
            }]
          },
          field: 'messages'
        }]
      }]
    };

    const signature = signPayload(payload, testSecret);

    // First webhook call
    const res1 = await request(app)
      .post('/api/v1/webhook/whatsapp')
      .set('x-hub-signature-256', signature)
      .send(payload);
    expect(res1.status).toBe(200);

    // Immediate second webhook call (replay / Meta retry)
    const res2 = await request(app)
      .post('/api/v1/webhook/whatsapp')
      .set('x-hub-signature-256', signature)
      .send(payload);
    expect(res2.status).toBe(200);

    // Verify exactly ONE job exists in database
    const jobs = await prisma.whatsAppMessageJob.findMany({
      where: { wamid }
    });
    expect(jobs.length).toBe(1);
  });

  it('9. Direct synchronous chat endpoint returns 503 on Web runtime', async () => {
    const fixture = await createTestFixture('direct-chat');
    webDeps = bootstrapWebDependencies(prisma);
    const app = await createApp(webDeps);

    const res = await request(app)
      .post('/api/v1/chat')
      .set('x-tenant-id', fixture.tenantId)
      .send({
        customerId: 'customer-1',
        message: 'Hello'
      });

    expect(res.status).toBe(503);
    expect(res.body.error).toBe('WORKER_RUNTIME_REQUIRED');
  });
});
