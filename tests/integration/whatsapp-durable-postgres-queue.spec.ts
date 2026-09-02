import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { prisma, pool } from '../../src/tests/testDb';
import { PostgresMessageQueue, InboundQueueJob } from '../../src/domain/channel/whatsapp/MessageQueue';

describe('PHASE WHATSAPP-DURABLE-QUEUE-AUDIT-FIX-40: PostgreSQL Durable Queue Integration Tests', () => {
  let queue: PostgresMessageQueue;
  const createdTenantIds: string[] = [];

  beforeAll(async () => {
    const client = await pool.connect();
    try {
      await client.query('SET search_path TO test, public, extensions;');
    } finally {
      client.release();
    }
  });

  beforeEach(() => {
    queue = new PostgresMessageQueue(prisma, { workerConcurrency: 5, pollIntervalMs: 50, leaseSeconds: 2 });
  });

  afterEach(async () => {
    await queue.shutdown();
    for (const tenantId of createdTenantIds) {
      try {
        await prisma.whatsAppMessageJob.deleteMany({ where: { tenantId } });
        await prisma.whatsAppBusinessNumber.deleteMany({ where: { tenantId } });
        await prisma.conversation.deleteMany({ where: { tenantId } });
        await prisma.customer.deleteMany({ where: { tenantId } });
        await prisma.account.deleteMany({ where: { tenantId } });
        await prisma.tenant.deleteMany({ where: { id: tenantId } });
      } catch (err) {}
    }
    createdTenantIds.length = 0;
  });

  async function createTestFixture(prefix: string) {
    const tenantId = `tenant-dur-${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    createdTenantIds.push(tenantId);

    const tenant = await prisma.tenant.create({
      data: { id: tenantId, name: `Tenant ${prefix}` }
    });

    const accountA = await prisma.account.create({
      data: { tenantId, name: 'Account A' }
    });

    const accountB = await prisma.account.create({
      data: { tenantId, name: 'Account B' }
    });

    return { tenantId, accountA, accountB };
  }

  function makeJob(tenantId: string, accountId: string, waId: string, wamid: string, msg: string): InboundQueueJob {
    return {
      id: wamid,
      partitionKey: `${tenantId}:${accountId}:${waId}`,
      tenantId,
      accountId,
      phoneNumberId: 'phone-test',
      waId,
      wamid,
      message: msg,
      timestamp: Date.now(),
      rawType: 'text',
      enqueuedAt: Date.now()
    };
  }

  it('1. Job persists in PostgreSQL with PENDING status and valid metadata', async () => {
    const { tenantId, accountA } = await createTestFixture('persist');
    const wamid = `wamid.dur.001.${Date.now()}`;
    const job = makeJob(tenantId, accountA.id, 'user-1', wamid, 'Hello Durable Queue');

    const success = await queue.enqueue(job, job.partitionKey);
    expect(success).toBe(true);

    const dbRecord = await prisma.whatsAppMessageJob.findUnique({ where: { wamid } });
    expect(dbRecord).not.toBeNull();
    expect(dbRecord?.status).toBe('PENDING');
    expect(dbRecord?.tenantId).toBe(tenantId);
    expect(dbRecord?.accountId).toBe(accountA.id);
    expect(dbRecord?.waId).toBe('user-1');
    expect(dbRecord?.message).toBe('Hello Durable Queue');
  });

  it('2. Duplicate wamid cannot create a second job (atomicity)', async () => {
    const { tenantId, accountA } = await createTestFixture('dup');
    const wamid = `wamid.dur.dup.${Date.now()}`;
    const job = makeJob(tenantId, accountA.id, 'user-1', wamid, 'First delivery');

    const first = await queue.enqueue(job, job.partitionKey);
    expect(first).toBe(true);

    const second = await queue.enqueue(job, job.partitionKey);
    expect(second).toBe(false);

    const count = await prisma.whatsAppMessageJob.count({ where: { wamid } });
    expect(count).toBe(1);
  });

  it('3. Two concurrent workers cannot claim the same job (FOR UPDATE SKIP LOCKED)', async () => {
    const { tenantId, accountA } = await createTestFixture('claim-race');
    const wamid = `wamid.dur.race.${Date.now()}`;
    const job = makeJob(tenantId, accountA.id, 'user-1', wamid, 'Race Job');

    await queue.enqueue(job, job.partitionKey);

    const worker1 = new PostgresMessageQueue(prisma, { workerId: 'w1' });
    const worker2 = new PostgresMessageQueue(prisma, { workerId: 'w2' });

    // Both workers attempt to claim the single available job concurrently
    const [claimed1, claimed2] = await Promise.all([
      worker1.claimNextJob(),
      worker2.claimNextJob()
    ]);

    const winners = [claimed1, claimed2].filter(c => c !== null);
    expect(winners).toHaveLength(1);
    expect(winners[0]?.wamid).toBe(wamid);

    const dbRecord = await prisma.whatsAppMessageJob.findUnique({ where: { wamid } });
    expect(dbRecord?.status).toBe('PROCESSING');
  });

  it('4. FIFO within one partition: M2 cannot execute or be claimed while M1 is PENDING or PROCESSING', async () => {
    const { tenantId, accountA } = await createTestFixture('fifo-lock');
    const user = 'user-fifo-test';
    const partitionKey = `${tenantId}:${accountA.id}:${user}`;

    const m1 = makeJob(tenantId, accountA.id, user, `wamid.m1.${Date.now()}`, 'M1');
    const m2 = makeJob(tenantId, accountA.id, user, `wamid.m2.${Date.now()}`, 'M2');

    await queue.enqueue(m1, partitionKey);
    await queue.enqueue(m2, partitionKey);

    // 1st claim MUST return M1
    const claimedM1 = await queue.claimNextJob();
    expect(claimedM1).not.toBeNull();
    expect(claimedM1?.wamid).toBe(m1.wamid);

    // While M1 is PROCESSING, claiming again for the same partition MUST return null (M2 is blocked)
    const claimedWhileM1Active = await queue.claimNextJob();
    expect(claimedWhileM1Active).toBeNull();

    // Complete M1
    await queue.completeJob(claimedM1!.id);

    // Now M2 can be claimed
    const claimedM2 = await queue.claimNextJob();
    expect(claimedM2).not.toBeNull();
    expect(claimedM2?.wamid).toBe(m2.wamid);

    await queue.completeJob(claimedM2!.id);
  });

  it('5. Concurrency across different partitions: User A and User B execute in parallel', async () => {
    const { tenantId, accountA } = await createTestFixture('cross-part');

    const jobA = makeJob(tenantId, accountA.id, 'user-A', `wamid.A.${Date.now()}`, 'Msg A');
    const jobB = makeJob(tenantId, accountA.id, 'user-B', `wamid.B.${Date.now()}`, 'Msg B');

    await queue.enqueue(jobA, jobA.partitionKey);
    await queue.enqueue(jobB, jobB.partitionKey);

    const claimed1 = await queue.claimNextJob();
    const claimed2 = await queue.claimNextJob();

    expect(claimed1).not.toBeNull();
    expect(claimed2).not.toBeNull();
    expect(claimed1?.waId).not.toEqual(claimed2?.waId);

    await queue.completeJob(claimed1!.id);
    await queue.completeJob(claimed2!.id);
  });

  it('6. Failed job is retried with backoff and eventually marks FAILED after max attempts', async () => {
    const { tenantId, accountA } = await createTestFixture('fail-retry');
    const wamid = `wamid.fail.${Date.now()}`;
    const job = makeJob(tenantId, accountA.id, 'user-fail', wamid, 'Fail Msg');

    await queue.enqueue(job, job.partitionKey);

    // Attempt 1
    const claim1 = await queue.claimNextJob();
    expect(claim1).not.toBeNull();
    await queue.failJob(claim1!.id, new Error('Temporary API error'), 0); // 0s backoff for test

    let record = await prisma.whatsAppMessageJob.findUnique({ where: { wamid } });
    expect(record?.status).toBe('PENDING');
    expect(record?.attempts).toBe(1);

    // Attempt 2
    const claim2 = await queue.claimNextJob();
    expect(claim2).not.toBeNull();
    await queue.failJob(claim2!.id, new Error('Temporary API error'), 0);

    record = await prisma.whatsAppMessageJob.findUnique({ where: { wamid } });
    expect(record?.status).toBe('PENDING');
    expect(record?.attempts).toBe(2);

    // Attempt 3 (Max attempts reached)
    const claim3 = await queue.claimNextJob();
    expect(claim3).not.toBeNull();
    await queue.failJob(claim3!.id, new Error('Final failure'), 0);

    record = await prisma.whatsAppMessageJob.findUnique({ where: { wamid } });
    expect(record?.status).toBe('FAILED');
    expect(record?.lastError).toBe('Final failure');
  });

  it('7. Stale worker crash: uncompleted PROCESSING job recovers after lease expiration', async () => {
    const { tenantId, accountA } = await createTestFixture('lease-exp');
    const wamid = `wamid.stale.${Date.now()}`;
    const job = makeJob(tenantId, accountA.id, 'user-crash', wamid, 'Crash Msg');

    await queue.enqueue(job, job.partitionKey);

    // Claim job with short 1s lease
    const shortLeaseQueue = new PostgresMessageQueue(prisma, { leaseSeconds: 1, workerId: 'crashed-worker' });
    const claimed = await shortLeaseQueue.claimNextJob();
    expect(claimed).not.toBeNull();

    // Simulate worker crashing without calling completeJob or failJob
    // Immediately after crash: job cannot be claimed because lease is active
    const immediateReclaim = await queue.claimNextJob();
    expect(immediateReclaim).toBeNull();

    // Wait 1.2s for 1s lease to expire
    await new Promise(r => setTimeout(r, 1200));

    // After lease expiration: new worker with 1s lease re-claims the job
    const recoveryWorker = new PostgresMessageQueue(prisma, { leaseSeconds: 1, workerId: 'recovery-worker' });
    const recoveredClaim = await recoveryWorker.claimNextJob();
    expect(recoveredClaim).not.toBeNull();
    expect(recoveredClaim?.wamid).toBe(wamid);

    await recoveryWorker.completeJob(recoveredClaim!.id);
  });

  it('8. Queue survives application restart and processes backlog in strict FIFO order', async () => {
    const { tenantId, accountA } = await createTestFixture('restart');
    const user = 'user-restart-test';
    const partitionKey = `${tenantId}:${accountA.id}:${user}`;

    // 1. Enqueue 3 messages
    for (let i = 1; i <= 3; i++) {
      const job = makeJob(tenantId, accountA.id, user, `wamid.rst.${i}.${Date.now()}`, `Msg ${i}`);
      await queue.enqueue(job, partitionKey);
    }

    // 2. Simulate complete application restart (create fresh instance)
    const freshAppQueue = new PostgresMessageQueue(prisma, { workerConcurrency: 2, pollIntervalMs: 20 });
    const processedMessages: string[] = [];

    freshAppQueue.registerHandler(async (j) => {
      processedMessages.push(j.message);
    });

    freshAppQueue.startWorker();

    // Wait for all 3 jobs to complete
    while (processedMessages.length < 3) {
      await new Promise(r => setTimeout(r, 50));
    }

    await freshAppQueue.shutdown();

    expect(processedMessages).toEqual(['Msg 1', 'Msg 2', 'Msg 3']);
  });
});
