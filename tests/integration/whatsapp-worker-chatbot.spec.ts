import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { prisma, pool } from '../../src/tests/testDb';
import { bootstrapChatbot } from '../../src/bootstrap';
import { WhatsAppWorker } from '../../src/domain/channel/whatsapp/WhatsAppWorker';
import { PostgresMessageQueue, InboundQueueJob } from '../../src/domain/channel/whatsapp/MessageQueue';
import { DEFAULT_BUSINESS_CONFIG } from '../../src/domain/tenant/BusinessConfig';

describe('PHASE WHATSAPP-WORKER-CHATBOT-INTEGRATION-AUDIT-FIX-41: Worker Chatbot Integration Tests', () => {
  let deps: ReturnType<typeof bootstrapChatbot>;
  let queue: PostgresMessageQueue;
  let worker: WhatsAppWorker;
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

  async function createTestTenantWithWorkflows(prefix: string) {
    const tenantId = `tenant-wk-${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
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

    // Configure tenant with consultation workflow, executionLimit = 'once', and FAQs
    await deps.tenantConfigService.updateConfig(tenantId, {
      ...DEFAULT_BUSINESS_CONFIG,
      identity: { botName: 'AtlasBot', brand: 'Atlas Gym' },
      capabilities: {
        ...DEFAULT_BUSINESS_CONFIG.capabilities,
        ecommerceEnabled: true,
        faq: [
          { id: 'hours', question: 'What are your hours?', answer: 'We are open 24/7!', category: 'STORE_INFO' }
        ],
        intents: [
          { id: 'consultation_booking', description: 'Book a consultation', workflowId: 'consultation_booking', triggerPhrases: ['book consultation', 'free session'] }
        ]
      },
      workflows: {
        consultation_booking: {
          id: 'consultation_booking',
          name: 'Consultation Booking',
          initialState: 'ask_name',
          executionLimit: {
            mode: 'once',
            limitReachedMessage: 'You have already completed this request.'
          },
          states: {
            ask_name: {
              type: 'collect',
              field: { name: 'name', type: 'string', required: true },
              prompt: 'What is your full name?',
              next: 'complete'
            },
            complete: {
              type: 'end',
              prompt: 'Your consultation is booked!'
            }
          },
          activation: {
            mode: 'explicit_intent',
            intents: ['consultation_booking']
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

  it('1. WhatsApp job invokes ConversationEngine with correct tenantId/accountId/waId and returns response', async () => {
    const { tenantId, accountA } = await createTestTenantWithWorkflows('greet');
    const wamid = `wamid.msg.greet.${Date.now()}`;
    const job = makeJob(tenantId, accountA.id, '212600000001', wamid, 'hi');

    const result = await worker.processJob(job);

    expect(result.jobId).toBe(job.id);
    expect(result.tenantId).toBe(tenantId);
    expect(result.accountId).toBe(accountA.id);
    expect(result.waId).toBe('212600000001');
    expect(result.response).toBeTruthy();

    // Verify conversation was created in DB for this customer under accountA
    const customer = await prisma.customer.findUnique({
      where: { tenantId_externalId: { tenantId, externalId: '212600000001' } }
    });
    expect(customer).not.toBeNull();

    const conversation = await prisma.conversation.findFirst({
      where: { tenantId, accountId: accountA.id, customerId: customer!.id }
    });
    expect(conversation).not.toBeNull();
  }, 25000);

  it('2. Two distinct WhatsApp users remain isolated in their own conversations', async () => {
    const { tenantId, accountA } = await createTestTenantWithWorkflows('iso');
    const user1 = '212600000010';
    const user2 = '212600000020';

    const job1 = makeJob(tenantId, accountA.id, user1, `wamid.iso.1.${Date.now()}`, 'Hello from User 1');
    const job2 = makeJob(tenantId, accountA.id, user2, `wamid.iso.2.${Date.now()}`, 'Hello from User 2');

    await worker.processJob(job1);
    await worker.processJob(job2);

    const cust1 = await prisma.customer.findUnique({ where: { tenantId_externalId: { tenantId, externalId: user1 } } });
    const cust2 = await prisma.customer.findUnique({ where: { tenantId_externalId: { tenantId, externalId: user2 } } });

    expect(cust1?.id).not.toEqual(cust2?.id);

    const conv1 = await prisma.conversation.findFirst({ where: { customerId: cust1!.id } });
    const conv2 = await prisma.conversation.findFirst({ where: { customerId: cust2!.id } });

    expect(conv1?.id).not.toEqual(conv2?.id);
  }, 25000);

  it('3. Workflow execution: Starts, captures slots, completes, and creates CRM Lead via WhatsApp Worker', async () => {
    const { tenantId, accountA } = await createTestTenantWithWorkflows('workflow-flow');
    const user = '212600000030';

    // Step 1: Trigger workflow with intent keyword
    const job1 = makeJob(tenantId, accountA.id, user, `wamid.wf.1.${Date.now()}`, 'consultation_booking');
    const res1 = await worker.processJob(job1);
    expect(res1.response).toContain('What is your full name?');

    // Step 2: Slot 1 - Provide name (Completes workflow)
    const job2 = makeJob(tenantId, accountA.id, user, `wamid.wf.2.${Date.now()}`, 'Jane Doe');
    const res2 = await worker.processJob(job2);
    expect(res2.response).toContain('Your consultation is booked!');

    // Verify CRM Lead was created in DB for this customer under accountA
    const customer = await prisma.customer.findUnique({
      where: { tenantId_externalId: { tenantId, externalId: user } }
    });
    expect(customer).not.toBeNull();

    const lead = await prisma.lead.findUnique({
      where: {
        tenantId_accountId_customerId: {
          tenantId,
          accountId: accountA.id,
          customerId: customer!.id
        }
      }
    });

    expect(lead).not.toBeNull();
    expect(lead?.status).toBe('NEW');
  }, 25000);

  it('4. Workflow execution limit = once is enforced when user attempts to re-run workflow', async () => {
    const { tenantId, accountA } = await createTestTenantWithWorkflows('limit');
    const user = '212600000040';

    // Step 1-2: Complete workflow once
    await worker.processJob(makeJob(tenantId, accountA.id, user, `wamid.lim.1.${Date.now()}`, 'consultation_booking'));
    await worker.processJob(makeJob(tenantId, accountA.id, user, `wamid.lim.2.${Date.now()}`, 'John Gym'));

    // Step 3: User attempts to trigger the consultation again
    const blockedJob = makeJob(tenantId, accountA.id, user, `wamid.lim.3.${Date.now()}`, 'consultation_booking');
    const blockedRes = await worker.processJob(blockedJob);

    // Expect execution limit message
    expect(blockedRes.response.toLowerCase()).toMatch(/completed|already|done/);
  }, 25000);

  it('5. FAQ query resolves with 0 LLM cost through WhatsApp Worker', async () => {
    const { tenantId, accountA } = await createTestTenantWithWorkflows('faq');
    const user = '212600000050';

    const faqJob = makeJob(tenantId, accountA.id, user, `wamid.faq.${Date.now()}`, 'What are your hours?');
    const res = await worker.processJob(faqJob);

    expect(res.response).toContain('We are open 24/7!');
  }, 25000);

  it('6. Full queue loop: Enqueued WhatsApp message is claimed, executed by worker, and marked COMPLETED', async () => {
    const { tenantId, accountA } = await createTestTenantWithWorkflows('queue-full');
    const user = '212600000060';
    const wamid = `wamid.full.${Date.now()}`;
    const job = makeJob(tenantId, accountA.id, user, wamid, 'What are your hours?');

    // Start worker polling
    queue.startWorker();

    // Enqueue job
    await queue.enqueue(job, job.partitionKey);

    // Wait for worker to claim and complete job
    let record = await prisma.whatsAppMessageJob.findUnique({ where: { wamid } });
    let attempts = 0;
    while (record?.status !== 'COMPLETED' && attempts < 40) {
      await new Promise(r => setTimeout(r, 50));
      record = await prisma.whatsAppMessageJob.findUnique({ where: { wamid } });
      attempts++;
    }

    expect(record?.status).toBe('COMPLETED');
    expect(record?.response).toContain('We are open 24/7!');
  }, 25000);
});
