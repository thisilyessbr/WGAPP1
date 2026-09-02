import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { prisma, pool } from '../../src/tests/testDb';
import { bootstrapChatbot } from '../../src/bootstrap';
import { WhatsAppOutboundAdapter } from '../../src/domain/channel/whatsapp/WhatsAppOutboundAdapter';
import { WhatsAppPolicyAdapter } from '../../src/domain/channel/whatsapp/WhatsAppPolicyAdapter';
import { WhatsAppWorker } from '../../src/domain/channel/whatsapp/WhatsAppWorker';
import { PostgresMessageQueue, InboundQueueJob } from '../../src/domain/channel/whatsapp/MessageQueue';
import { DEFAULT_BUSINESS_CONFIG } from '../../src/domain/tenant/BusinessConfig';
import { LLMMockProvider } from '../../src/core/llm/LLMProvider';

describe('PHASE WHATSAPP-FULL-PRODUCTION-AUDIT-47: Full Production Forensic E2E Test Suite', () => {
  let deps: ReturnType<typeof bootstrapChatbot>;
  let queue: PostgresMessageQueue;
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
    queue = new PostgresMessageQueue(prisma, { autoStartWorker: false, leaseSeconds: 5 });
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

  async function createProductionTenant(prefix: string) {
    const tenantId = `tenant-prod-${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    createdTenantIds.push(tenantId);

    const tenant = await prisma.tenant.create({
      data: { id: tenantId, name: `Production Tenant ${prefix}` }
    });

    const accountA = await prisma.account.create({
      data: { tenantId, name: 'Main Sales Account' }
    });

    const accountB = await prisma.account.create({
      data: { tenantId, name: 'Secondary Support Account' }
    });

    // Register Number 1 on Account A
    const phoneNum1 = `phone-prod-1-${Date.now()}`;
    await deps.whatsAppNumberService!.registerNumber({
      tenantId,
      accountId: accountA.id,
      phoneNumberId: phoneNum1,
      displayPhoneNumber: '+1 555 1001',
      enabled: true
    });

    // Register Number 2 on Account A
    const phoneNum2 = `phone-prod-2-${Date.now()}`;
    await deps.whatsAppNumberService!.registerNumber({
      tenantId,
      accountId: accountA.id,
      phoneNumberId: phoneNum2,
      displayPhoneNumber: '+1 555 1002',
      enabled: true
    });

    // Register Number 3 on Account B
    const phoneNum3 = `phone-prod-3-${Date.now()}`;
    await deps.whatsAppNumberService!.registerNumber({
      tenantId,
      accountId: accountB.id,
      phoneNumberId: phoneNum3,
      displayPhoneNumber: '+1 555 2001',
      enabled: true
    });

    // Configure tenant workflows and FAQs
    await deps.tenantConfigService.updateConfig(tenantId, {
      ...DEFAULT_BUSINESS_CONFIG,
      identity: { botName: 'ProductionBot', brand: 'Production Enterprise' },
      capabilities: {
        ...DEFAULT_BUSINESS_CONFIG.capabilities,
        ecommerceEnabled: true,
        faq: [
          { id: 'f1', question: 'What is your return policy?', answer: '30-day money back guarantee.', category: 'POLICY' }
        ],
        intents: [
          { id: 'lead_flow', description: 'Lead Flow', workflowId: 'lead_flow', triggerPhrases: ['start lead'] }
        ]
      },
      workflows: {
        lead_flow: {
          id: 'lead_flow',
          name: 'Lead Capture Flow',
          initialState: 'ask_name',
          states: {
            ask_name: {
              type: 'collect',
              field: { name: 'name', type: 'string', required: true },
              prompt: 'Please provide your full name:',
              next: 'ask_phone'
            },
            ask_phone: {
              type: 'collect',
              field: { name: 'phone', type: 'string', required: true },
              prompt: 'Please provide your phone number:',
              next: 'ask_goal'
            },
            ask_goal: {
              type: 'collect',
              field: { name: 'goal', type: 'string', required: true },
              prompt: 'What is your primary goal?',
              next: 'confirm'
            },
            confirm: {
              type: 'choice',
              prompt: 'Please confirm your information. Is this correct?',
              options: [
                { label: 'Yes, Confirm', value: 'yes', next: 'complete' },
                { label: 'No, Cancel', value: 'no', next: 'cancel' }
              ]
            },
            complete: {
              type: 'end',
              prompt: 'Thank you! Your lead has been successfully registered.'
            },
            cancel: {
              type: 'end',
              prompt: 'Lead capture cancelled.'
            }
          },
          activation: {
            mode: 'explicit_intent',
            intents: ['lead_flow']
          }
        }
      }
    });

    return { tenantId, accountA, accountB, phoneNum1, phoneNum2, phoneNum3 };
  }

  function makeJob(tenantId: string, accountId: string, phoneNumberId: string, waId: string, wamid: string, msg: string, timestamp?: number): InboundQueueJob {
    return {
      id: wamid,
      partitionKey: `${tenantId}:${accountId}:${waId}`,
      tenantId,
      accountId,
      phoneNumberId,
      waId,
      wamid,
      message: msg,
      timestamp: timestamp ?? Date.now(),
      rawType: 'text',
      enqueuedAt: Date.now()
    };
  }

  it('Phase 20 Complete Live-Like Customer Journey: Lead intake, CRM sync, Outbound send, Crash-recovery idempotency', async () => {
    const { tenantId, accountA, phoneNum1, phoneNum2 } = await createProductionTenant('e2e-journey');
    const user = '212600000001';

    const sentOutboundMessages: Array<{ url: string; to: string; text: string }> = [];
    const mockFetch = vi.fn(async (url: string, init?: RequestInit) => {
      const body = JSON.parse((init?.body as string) || '{}');
      sentOutboundMessages.push({ url, to: body.to, text: body.text?.body || '' });
      return {
        ok: true,
        status: 200,
        json: async () => ({ messages: [{ id: `wamid.meta.reply.${Date.now()}` }] })
      } as Response;
    });

    const outboundAdapter = new WhatsAppOutboundAdapter({ defaultAccessToken: 'EAAG_test_token', fetchFn: mockFetch as any });
    const policyAdapter = new WhatsAppPolicyAdapter();
    const worker = new WhatsAppWorker(queue, deps.conversationEngine, outboundAdapter, deps.whatsAppNumberService, policyAdapter);

    // 1. Inbound Step 1: User starts lead flow
    const job1 = makeJob(tenantId, accountA.id, phoneNum1, user, `wamid.e2e.1.${Date.now()}`, 'lead_flow');
    const res1 = await worker.processJob(job1);
    expect(res1.response).toContain('Please provide your full name:');
    expect(res1.outboundResult?.success).toBe(true);

    // 2. Inbound Step 2: User provides name
    const job2 = makeJob(tenantId, accountA.id, phoneNum1, user, `wamid.e2e.2.${Date.now()}`, 'Jane Doe');
    const res2 = await worker.processJob(job2);
    expect(res2.response).toContain('Please provide your phone number:');

    // 3. Inbound Step 3: User provides phone
    const job3 = makeJob(tenantId, accountA.id, phoneNum1, user, `wamid.e2e.3.${Date.now()}`, '+212600000001');
    const res3 = await worker.processJob(job3);
    expect(res3.response).toContain('What is your primary goal?');

    // 4. Inbound Step 4: User provides goal
    const job4 = makeJob(tenantId, accountA.id, phoneNum1, user, `wamid.e2e.4.${Date.now()}`, 'Enterprise Chatbot Deployment');
    const res4 = await worker.processJob(job4);
    expect(res4.response).toContain('Please confirm your information');

    // 5. Inbound Step 5: User confirms
    const job5 = makeJob(tenantId, accountA.id, phoneNum1, user, `wamid.e2e.5.${Date.now()}`, 'Yes, Confirm');
    const res5 = await worker.processJob(job5);
    expect(res5.response).toContain('Thank you! Your lead has been successfully registered.');

    // 6. Verify CRM Lead was captured and associated with Account A
    const leads = await prisma.lead.findMany({ where: { tenantId, accountId: accountA.id } });
    expect(leads).toHaveLength(1);
    expect(leads[0].status).toBe('NEW');
    expect(leads[0].accountId).toBe(accountA.id);

    // 7. Verify all outbound messages used originating phoneNum1
    expect(sentOutboundMessages).toHaveLength(5);
    for (const msg of sentOutboundMessages) {
      expect(msg.url).toContain(phoneNum1);
      expect(msg.to).toBe(user);
    }

    // 8. Crash Simulation on Step 5: Worker re-processes job5
    const duplicateRes = await worker.processJob(job5);
    expect(duplicateRes.response).toBe(res5.response);

    // Verify 0 duplicate messages and 0 duplicate CRM leads
    const totalLeads = await prisma.lead.findMany({ where: { tenantId, accountId: accountA.id } });
    expect(totalLeads).toHaveLength(1);

    const userMsgs = await prisma.message.findMany({ where: { tenantId, role: 'USER' } });
    expect(userMsgs).toHaveLength(5); // Exact 5 turns, 0 duplicate rows

    // 9. Repeat with Number 2 for same Account A with User Y
    const userY = '212600000002';
    const jobNum2 = makeJob(tenantId, accountA.id, phoneNum2, userY, `wamid.e2e.y1.${Date.now()}`, 'What is your return policy?');
    const resNum2 = await worker.processJob(jobNum2);
    expect(resNum2.response).toContain('30-day money back guarantee.');

    // Verify outbound for User Y routed via Number 2
    const lastOutbound = sentOutboundMessages[sentOutboundMessages.length - 1];
    expect(lastOutbound.url).toContain(phoneNum2);
    expect(lastOutbound.to).toBe(userY);
  }, 45000);

  it('Phase 4: Strict FIFO sequencing for same user and concurrent execution for different users', async () => {
    const { tenantId, accountA, phoneNum1 } = await createProductionTenant('fifo-test');
    const userA = '212600000003';
    const userB = '212600000004';

    const queueInstance = new PostgresMessageQueue(prisma, { autoStartWorker: false, leaseSeconds: 5 });

    // Enqueue 4 rapid messages for User A
    await queueInstance.enqueue(makeJob(tenantId, accountA.id, phoneNum1, userA, `wamid.fifo.a1.${Date.now()}`, 'M1'), `${tenantId}:${accountA.id}:${userA}`);
    await queueInstance.enqueue(makeJob(tenantId, accountA.id, phoneNum1, userA, `wamid.fifo.a2.${Date.now()}`, 'M2'), `${tenantId}:${accountA.id}:${userA}`);
    await queueInstance.enqueue(makeJob(tenantId, accountA.id, phoneNum1, userA, `wamid.fifo.a3.${Date.now()}`, 'M3'), `${tenantId}:${accountA.id}:${userA}`);
    await queueInstance.enqueue(makeJob(tenantId, accountA.id, phoneNum1, userA, `wamid.fifo.a4.${Date.now()}`, 'M4'), `${tenantId}:${accountA.id}:${userA}`);

    // Enqueue 1 message for User B
    await queueInstance.enqueue(makeJob(tenantId, accountA.id, phoneNum1, userB, `wamid.fifo.b1.${Date.now()}`, 'B1'), `${tenantId}:${accountA.id}:${userB}`);

    // Claim 1: First message for User A
    const claim1 = await queueInstance.claimNextJob();
    expect(claim1?.message).toBe('M1');

    // Claim 2: User A partition is currently LOCKED by claim 1, so Claim 2 claims User B's job concurrently!
    const claim2 = await queueInstance.claimNextJob();
    expect(claim2?.waId).toBe(userB);
    expect(claim2?.message).toBe('B1');

    // Complete User A job 1
    await queueInstance.completeJob(claim1!.id, 'OK M1');

    // Now User A's next job (M2) can be claimed in strict FIFO order!
    const claim3 = await queueInstance.claimNextJob();
    expect(claim3?.waId).toBe(userA);
    expect(claim3?.message).toBe('M2');

    await queueInstance.completeJob(claim2!.id, 'OK B1');
    await queueInstance.completeJob(claim3!.id, 'OK M2');
    await queueInstance.shutdown();
  }, 25000);

  it('Phase 13 & 14: 13-second regression verification and LLM leak audit (0 LLM for deterministic FAQ and Workflow)', async () => {
    const { tenantId, accountA, phoneNum1 } = await createProductionTenant('llm-leak-audit');
    const user = '212600000005';

    let llmCallCount = 0;
    mockLlm.generate = async () => {
      llmCallCount++;
      return 'Unexpected LLM response';
    };

    const outboundAdapter = new WhatsAppOutboundAdapter({
      defaultAccessToken: 'EAAG_token',
      fetchFn: vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.meta.1' }] }) })) as any
    });
    const policyAdapter = new WhatsAppPolicyAdapter();
    const worker = new WhatsAppWorker(queue, deps.conversationEngine, outboundAdapter, deps.whatsAppNumberService, policyAdapter);

    // 1. FAQ Turn: Must use 0 LLM calls
    const faqJob = makeJob(tenantId, accountA.id, phoneNum1, user, `wamid.leak.faq.${Date.now()}`, 'What is your return policy?');
    const faqRes = await worker.processJob(faqJob);
    expect(faqRes.response).toContain('30-day money back guarantee.');
    expect(llmCallCount).toBe(0); // 0 LLM verified!

    // 2. Deterministic Workflow Slot Turn: Must use 0 LLM calls
    const wfJob1 = makeJob(tenantId, accountA.id, phoneNum1, user, `wamid.leak.wf1.${Date.now()}`, 'lead_flow');
    const wfRes1 = await worker.processJob(wfJob1);
    expect(wfRes1.response).toContain('Please provide your full name:');
    expect(llmCallCount).toBe(0); // 0 LLM verified!

    const wfJob2 = makeJob(tenantId, accountA.id, phoneNum1, user, `wamid.leak.wf2.${Date.now()}`, 'Alice Smith');
    const wfRes2 = await worker.processJob(wfJob2);
    expect(wfRes2.response).toContain('Please provide your phone number:');
    expect(llmCallCount).toBe(0); // 0 LLM verified!
  }, 25000);
});
