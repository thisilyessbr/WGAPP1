import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { prisma, pool } from '../../src/tests/testDb';
import { bootstrapChatbot } from '../../src/bootstrap';
import { WhatsAppWorker } from '../../src/domain/channel/whatsapp/WhatsAppWorker';
import { PostgresMessageQueue, InboundQueueJob } from '../../src/domain/channel/whatsapp/MessageQueue';
import { DEFAULT_BUSINESS_CONFIG } from '../../src/domain/tenant/BusinessConfig';
import { LLMMockProvider } from '../../src/core/llm/LLMProvider';

describe('PHASE WHATSAPP-TURN-IDEMPOTENCY-IMPLEMENT-43: Turn Idempotency Integration Tests', () => {
  let deps: ReturnType<typeof bootstrapChatbot>;
  let queue: PostgresMessageQueue;
  let worker: WhatsAppWorker;
  let mockLlm: LLMMockProvider;
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
    deps = bootstrapChatbot(prisma);
    mockLlm = new LLMMockProvider();
    deps.llmFactory.registerProvider('mock', 'mock-model', mockLlm);
    queue = new PostgresMessageQueue(prisma, { workerConcurrency: 5, pollIntervalMs: 50, leaseSeconds: 5 });
    worker = new WhatsAppWorker(queue, deps.conversationEngine);
  });

  afterEach(async () => {
    await queue.shutdown();
    for (const tenantId of createdTenantIds) {
      try {
        await prisma.whatsAppMessageJob.deleteMany({ where: { tenantId } });
        await prisma.whatsAppBusinessNumber.deleteMany({ where: { tenantId } });
        await prisma.lead.deleteMany({ where: { tenantId } });
        await prisma.message.deleteMany({ where: { tenantId } });
        await prisma.workflowSession.deleteMany({ where: { tenantId } });
        await prisma.conversation.deleteMany({ where: { tenantId } });
        await prisma.customer.deleteMany({ where: { tenantId } });
        await prisma.account.deleteMany({ where: { tenantId } });
        await prisma.tenantConfig.deleteMany({ where: { tenantId } });
        await prisma.tenant.deleteMany({ where: { id: tenantId } });
      } catch (err) {}
    }
    createdTenantIds.length = 0;
  });

  async function createTestTenant(prefix: string) {
    const tenantId = `tenant-idemp-${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    createdTenantIds.push(tenantId);

    const tenant = await prisma.tenant.create({
      data: { id: tenantId, name: `Tenant ${prefix}` }
    });

    const accountA = await prisma.account.create({
      data: { tenantId, name: 'Main Account' }
    });

    const accountB = await prisma.account.create({
      data: { tenantId, name: 'Secondary Account' }
    });

    await deps.tenantConfigService.updateConfig(tenantId, {
      ...DEFAULT_BUSINESS_CONFIG,
      identity: { botName: 'IdempBot', brand: 'Idemp Brand' },
      capabilities: {
        ...DEFAULT_BUSINESS_CONFIG.capabilities,
        ecommerceEnabled: true,
        faq: [
          { id: 'faq1', question: 'What is your refund policy?', answer: 'Full refund within 30 days!', category: 'RETURNS' }
        ],
        intents: [
          { id: 'lead_flow', description: 'Lead Intake', workflowId: 'lead_flow', triggerPhrases: ['start lead'] }
        ]
      },
      workflows: {
        lead_flow: {
          id: 'lead_flow',
          name: 'Lead Flow',
          initialState: 'ask_name',
          states: {
            ask_name: {
              type: 'collect',
              field: { name: 'name', type: 'string', required: true },
              prompt: 'Please enter your name:',
              next: 'complete'
            },
            complete: {
              type: 'end',
              prompt: 'Thank you! We will contact you.'
            }
          },
          activation: {
            mode: 'explicit_intent',
            intents: ['lead_flow']
          }
        }
      }
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

  it('1 & 2. New externalMessageId executes normally and persists externalId on USER message', async () => {
    const { tenantId, accountA } = await createTestTenant('new-ext');
    const user = '212611111111';
    const wamid = `wamid.ext.1.${Date.now()}`;
    const job = makeJob(tenantId, accountA.id, user, wamid, 'What is your refund policy?');

    const result = await worker.processJob(job);
    expect(result.response).toContain('Full refund within 30 days!');

    const userMsg = await prisma.message.findFirst({
      where: { tenantId, externalId: wamid }
    });
    expect(userMsg).not.toBeNull();
    expect(userMsg?.role).toBe('USER');
    expect(userMsg?.externalId).toBe(wamid);
  }, 25000);

  it('3, 4, 5, 6, 7, 8, 9. Retry with same externalMessageId returns original response with ZERO duplicate rows or AI cost', async () => {
    const { tenantId, accountA } = await createTestTenant('retry-idemp');
    const user = '212622222222';
    const wamid = `wamid.retry.1.${Date.now()}`;
    const job = makeJob(tenantId, accountA.id, user, wamid, 'What is your refund policy?');

    // First execution
    const res1 = await worker.processJob(job);
    expect(res1.response).toContain('Full refund within 30 days!');

    const userCountBefore = await prisma.message.count({ where: { tenantId, role: 'USER' } });
    const asstCountBefore = await prisma.message.count({ where: { tenantId, role: 'ASSISTANT' } });
    const sessionCountBefore = await prisma.workflowSession.count({ where: { tenantId } });

    // Track LLM call count
    let llmCallsOnRetry = 0;
    mockLlm.generate = async () => {
      llmCallsOnRetry++;
      return 'Mocked unexpected response';
    };

    // Second execution (Simulated retry with identical wamid)
    const res2 = await worker.processJob(job);
    expect(res2.response).toBe(res1.response);

    const userCountAfter = await prisma.message.count({ where: { tenantId, role: 'USER' } });
    const asstCountAfter = await prisma.message.count({ where: { tenantId, role: 'ASSISTANT' } });
    const sessionCountAfter = await prisma.workflowSession.count({ where: { tenantId } });

    // Verify ZERO duplicate rows created
    expect(userCountAfter).toBe(userCountBefore);
    expect(asstCountAfter).toBe(asstCountBefore);
    expect(sessionCountAfter).toBe(sessionCountBefore);

    // Verify ZERO LLM calls on retry
    expect(llmCallsOnRetry).toBe(0);
  }, 25000);

  it('10. Different externalMessageId executes normally and creates new turn', async () => {
    const { tenantId, accountA } = await createTestTenant('diff-ext');
    const user = '212633333333';

    const job1 = makeJob(tenantId, accountA.id, user, `wamid.turn.1.${Date.now()}`, 'What is your refund policy?');
    const res1 = await worker.processJob(job1);

    const job2 = makeJob(tenantId, accountA.id, user, `wamid.turn.2.${Date.now()}`, 'lead_flow');
    const res2 = await worker.processJob(job2);

    expect(res1.response).toContain('Full refund within 30 days!');
    expect(res2.response).toContain('Please enter your name:');

    const totalMessages = await prisma.message.count({ where: { tenantId } });
    expect(totalMessages).toBe(4); // 2 USER + 2 ASSISTANT
  }, 25000);

  it('11. Same externalId in another tenant remains completely isolated', async () => {
    const tenant1 = await createTestTenant('t1');
    const tenant2 = await createTestTenant('t2');
    const sharedWamid = `wamid.shared.${Date.now()}`;

    const jobT1 = makeJob(tenant1.tenantId, tenant1.accountA.id, '212644444444', sharedWamid, 'What is your refund policy?');
    const jobT2 = makeJob(tenant2.tenantId, tenant2.accountA.id, '212644444444', sharedWamid, 'What is your refund policy?');

    const resT1 = await worker.processJob(jobT1);
    const resT2 = await worker.processJob(jobT2);

    expect(resT1.response).toBeTruthy();
    expect(resT2.response).toBeTruthy();

    const msgT1 = await prisma.message.findFirst({ where: { tenantId: tenant1.tenantId, externalId: sharedWamid } });
    const msgT2 = await prisma.message.findFirst({ where: { tenantId: tenant2.tenantId, externalId: sharedWamid } });

    expect(msgT1).not.toBeNull();
    expect(msgT2).not.toBeNull();
    expect(msgT1?.tenantId).toBe(tenant1.tenantId);
    expect(msgT2?.tenantId).toBe(tenant2.tenantId);
  }, 25000);

  it('13 & 14. Concurrent duplicate requests result in exactly one persisted turn without crash', async () => {
    const { tenantId, accountA } = await createTestTenant('concurrent');
    const user = '212655555555';
    const wamid = `wamid.race.${Date.now()}`;
    const job = makeJob(tenantId, accountA.id, user, wamid, 'What is your refund policy?');

    // Two worker threads simultaneously process the same externalMessageId
    const [res1, res2] = await Promise.all([
      worker.processJob(job),
      worker.processJob(job)
    ]);

    expect(res1.response).toBe(res2.response);

    const userMsgs = await prisma.message.findMany({
      where: { tenantId, externalId: wamid }
    });
    expect(userMsgs).toHaveLength(1);
  }, 25000);

  it('15. Crash-after-commit simulation: job retries after uncompleted lease and returns persisted response', async () => {
    const { tenantId, accountA } = await createTestTenant('crash-sim');
    const user = '212666666666';
    const wamid = `wamid.crash.${Date.now()}`;
    const job = makeJob(tenantId, accountA.id, user, wamid, 'What is your refund policy?');

    const manualQueue = new PostgresMessageQueue(prisma, { autoStartWorker: false, leaseSeconds: 2 });

    // 1. Enqueue job
    await manualQueue.enqueue(job, job.partitionKey);

    // 2. Worker 1 claims job and executes ConversationEngine, but crashes before completeJob
    const claim1 = await manualQueue.claimNextJob();
    expect(claim1).not.toBeNull();

    // Worker 1 executes ConversationEngine directly (simulating crash before completeJob)
    const engineResp = await deps.conversationEngine.handleMessage(
      claim1!.tenantId,
      claim1!.waId,
      claim1!.message,
      claim1!.accountId,
      { externalMessageId: claim1!.wamid }
    );
    expect(engineResp).toContain('Full refund within 30 days!');

    // 3. Worker 1 crashes (job remains in PROCESSING status in DB, completeJob NOT called)
    let jobInDb = await prisma.whatsAppMessageJob.findUnique({ where: { wamid } });
    expect(jobInDb?.status).toBe('PROCESSING');

    // 4. Time passes, lease expires, Worker 2 re-claims the job
    await new Promise(r => setTimeout(r, 2200)); // leaseSeconds = 2

    const claim2 = await manualQueue.claimNextJob();
    expect(claim2).not.toBeNull();
    expect(claim2?.wamid).toBe(wamid);

    // Worker 2 executes job and calls completeJob
    const res = await worker.processJob(claim2!);
    expect(res.response).toBe(engineResp);
    await manualQueue.completeJob(claim2!.id, res.response);
    await manualQueue.shutdown();

    // 5. Verify database state
    jobInDb = await prisma.whatsAppMessageJob.findUnique({ where: { wamid } });
    expect(jobInDb?.status).toBe('COMPLETED');

    const userMsgs = await prisma.message.findMany({ where: { tenantId, externalId: wamid } });
    expect(userMsgs).toHaveLength(1);

    const asstMsgs = await prisma.message.findMany({ where: { tenantId, role: 'ASSISTANT' } });
    expect(asstMsgs).toHaveLength(1);
  }, 30000);

  it('16. Standard chat without externalMessageId (/api/dev/chat) continues to function unchanged', async () => {
    const { tenantId, accountA } = await createTestTenant('standard-chat');
    const user = '212677777777';

    // Call handleMessage without options (standard web chat / dev API)
    const resp = await deps.conversationEngine.handleMessage(
      tenantId,
      user,
      'What is your refund policy?',
      accountA.id
    );

    expect(resp).toContain('Full refund within 30 days!');

    const userMsg = await prisma.message.findFirst({
      where: { tenantId, role: 'USER' }
    });
    expect(userMsg).not.toBeNull();
    expect(userMsg?.externalId).toBeNull();
  }, 25000);
});
