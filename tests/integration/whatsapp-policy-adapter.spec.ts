import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { prisma, pool } from '../../src/tests/testDb';
import { bootstrapChatbot } from '../../src/bootstrap';
import { WhatsAppPolicyAdapter } from '../../src/domain/channel/whatsapp/WhatsAppPolicyAdapter';
import { WhatsAppOutboundAdapter } from '../../src/domain/channel/whatsapp/WhatsAppOutboundAdapter';
import { WhatsAppWorker } from '../../src/domain/channel/whatsapp/WhatsAppWorker';
import { PostgresMessageQueue, InboundQueueJob } from '../../src/domain/channel/whatsapp/MessageQueue';
import { DEFAULT_BUSINESS_CONFIG } from '../../src/domain/tenant/BusinessConfig';

describe('PHASE WHATSAPP-POLICY-ADAPTER-AUDIT-IMPLEMENT-45: WhatsApp Policy Adapter Integration Tests', () => {
  let deps: ReturnType<typeof bootstrapChatbot>;
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
    deps = bootstrapChatbot(prisma);
    queue = new PostgresMessageQueue(prisma, { workerConcurrency: 5, pollIntervalMs: 50, leaseSeconds: 5 });
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

  async function createTestTenantWithNumbers(prefix: string) {
    const tenantId = `tenant-pol-${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    createdTenantIds.push(tenantId);

    const tenant = await prisma.tenant.create({
      data: { id: tenantId, name: `Tenant ${prefix}` }
    });

    const accountA = await prisma.account.create({
      data: { tenantId, name: 'Main Account' }
    });

    const phoneNum1 = `phone-pol-1-${Date.now()}`;
    await deps.whatsAppNumberService!.registerNumber({
      tenantId,
      accountId: accountA.id,
      phoneNumberId: phoneNum1,
      displayPhoneNumber: '+15551111',
      enabled: true
    });

    await deps.tenantConfigService.updateConfig(tenantId, {
      ...DEFAULT_BUSINESS_CONFIG,
      identity: { botName: 'PolicyBot', brand: 'Policy Brand' },
      capabilities: {
        ...DEFAULT_BUSINESS_CONFIG.capabilities,
        faq: [
          { id: 'f1', question: 'How can I track my order?', answer: 'You can track your order at track.example.com!', category: 'SHIPPING' }
        ]
      }
    });

    return { tenantId, accountA, phoneNum1 };
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

  it('1. Inside 24-hour Customer Service Window -> Evaluates to SEND_TEXT and sends plain text payload', async () => {
    const { tenantId, accountA, phoneNum1 } = await createTestTenantWithNumbers('win-open');
    const user = '212699999001';
    const wamid = `wamid.pol.1.${Date.now()}`;
    // Message sent 5 minutes ago (well within 24 hours)
    const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
    const job = makeJob(tenantId, accountA.id, phoneNum1, user, wamid, 'How can I track my order?', fiveMinutesAgo);

    let sentPayload: any = null;
    const mockFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      sentPayload = JSON.parse((init?.body as string) || '{}');
      return {
        ok: true,
        status: 200,
        json: async () => ({ messages: [{ id: 'wamid.meta.text.1' }] })
      } as Response;
    });

    const outboundAdapter = new WhatsAppOutboundAdapter({ defaultAccessToken: 'EAAG_token', fetchFn: mockFetch as any });
    const policyAdapter = new WhatsAppPolicyAdapter(); // 24h window
    const worker = new WhatsAppWorker(queue, deps.conversationEngine, outboundAdapter, deps.whatsAppNumberService, policyAdapter);

    const result = await worker.processJob(job);

    expect(result.policyDecision?.action).toBe('SEND_TEXT');
    expect(result.policyDecision?.isWithinCustomerServiceWindow).toBe(true);
    expect(result.outboundResult?.success).toBe(true);
    expect(sentPayload.type).toBe('text');
    expect(sentPayload.text.body).toContain('track.example.com');
  }, 25000);

  it('2 & 3. Outside 24-hour Customer Service Window with NO template -> Safely BLOCKS outbound (preventing Meta 131047 error)', async () => {
    const { tenantId, accountA, phoneNum1 } = await createTestTenantWithNumbers('win-closed-block');
    const user = '212699999002';
    const wamid = `wamid.pol.2.${Date.now()}`;
    // Message timestamp is 25 hours ago (> 24 hours)
    const twentyFiveHoursAgo = Date.now() - (25 * 3600 * 1000);
    const job = makeJob(tenantId, accountA.id, phoneNum1, user, wamid, 'How can I track my order?', twentyFiveHoursAgo);

    const mockFetch = vi.fn();
    const outboundAdapter = new WhatsAppOutboundAdapter({ defaultAccessToken: 'EAAG_token', fetchFn: mockFetch as any });
    const policyAdapter = new WhatsAppPolicyAdapter(); // 24h window
    const worker = new WhatsAppWorker(queue, deps.conversationEngine, outboundAdapter, deps.whatsAppNumberService, policyAdapter);

    const result = await worker.processJob(job);

    expect(result.policyDecision?.action).toBe('BLOCK');
    expect(result.policyDecision?.isWithinCustomerServiceWindow).toBe(false);
    expect(result.policyDecision?.reason).toContain('expired');
    expect(result.outboundResult?.success).toBe(false);
    // Verified: Meta HTTP API was NOT called, preventing Meta Error 131047
    expect(mockFetch).not.toHaveBeenCalled();

    // Turn itself is still safely committed in database
    const savedMsg = await prisma.message.findFirst({ where: { tenantId, externalId: wamid } });
    expect(savedMsg).not.toBeNull();
  }, 25000);

  it('4, 5, 6. Outside 24-hour window WITH approved template -> Evaluates to SEND_TEMPLATE and formats template payload', async () => {
    const { tenantId, accountA, phoneNum1 } = await createTestTenantWithNumbers('win-template');
    const user = '212699999003';
    const wamid = `wamid.pol.3.${Date.now()}`;
    const twentyFiveHoursAgo = Date.now() - (25 * 3600 * 1000);
    const job = makeJob(tenantId, accountA.id, phoneNum1, user, wamid, 'How can I track my order?', twentyFiveHoursAgo);

    let sentPayload: any = null;
    const mockFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      sentPayload = JSON.parse((init?.body as string) || '{}');
      return {
        ok: true,
        status: 200,
        json: async () => ({ messages: [{ id: 'wamid.meta.tpl.1' }] })
      } as Response;
    });

    const outboundAdapter = new WhatsAppOutboundAdapter({ defaultAccessToken: 'EAAG_token', fetchFn: mockFetch as any });

    // Custom policy adapter simulating approved fallback template
    const policyAdapter = new WhatsAppPolicyAdapter();
    const approvedTemplates = {
      reengagement_template: {
        name: 'order_status_update',
        languageCode: 'en_US',
        category: 'UTILITY' as const,
        components: [
          {
            type: 'body' as const,
            parameters: [{ type: 'text' as const, text: 'track.example.com' }]
          }
        ]
      }
    };

    // Override evaluateOutbound with approved template context
    const origEvaluate = policyAdapter.evaluateOutbound.bind(policyAdapter);
    policyAdapter.evaluateOutbound = (ctx) => {
      return origEvaluate({ ...ctx, approvedTemplates });
    };

    const worker = new WhatsAppWorker(queue, deps.conversationEngine, outboundAdapter, deps.whatsAppNumberService, policyAdapter);
    const result = await worker.processJob(job);

    expect(result.policyDecision?.action).toBe('SEND_TEMPLATE');
    expect(result.policyDecision?.isWithinCustomerServiceWindow).toBe(false);
    expect(result.outboundResult?.success).toBe(true);

    expect(sentPayload.type).toBe('template');
    expect(sentPayload.template.name).toBe('order_status_update');
    expect(sentPayload.template.language.code).toBe('en_US');
    expect(sentPayload.template.components[0].parameters[0].text).toBe('track.example.com');
  }, 25000);

  it('9 & 17. Policy Blocked outbound NEVER reruns ConversationEngine on retry (Zero extra AI/DB cost)', async () => {
    const { tenantId, accountA, phoneNum1 } = await createTestTenantWithNumbers('retry-zero-cost');
    const user = '212699999004';
    const wamid = `wamid.pol.4.${Date.now()}`;
    const twentyFiveHoursAgo = Date.now() - (25 * 3600 * 1000);
    const job = makeJob(tenantId, accountA.id, phoneNum1, user, wamid, 'How can I track my order?', twentyFiveHoursAgo);

    const outboundAdapter = new WhatsAppOutboundAdapter({ defaultAccessToken: 'EAAG_token', fetchFn: vi.fn() as any });
    const policyAdapter = new WhatsAppPolicyAdapter();
    const worker = new WhatsAppWorker(queue, deps.conversationEngine, outboundAdapter, deps.whatsAppNumberService, policyAdapter);

    // 1st Execution: Commits turn in DB, blocks outbound because window is closed
    const res1 = await worker.processJob(job);
    expect(res1.policyDecision?.action).toBe('BLOCK');

    const userMsgsBefore = await prisma.message.count({ where: { tenantId, role: 'USER' } });
    const asstMsgsBefore = await prisma.message.count({ where: { tenantId, role: 'ASSISTANT' } });

    // 2nd Execution (Worker Retry): Hits turn idempotency fast-path
    const res2 = await worker.processJob(job);
    expect(res2.response).toBe(res1.response);

    const userMsgsAfter = await prisma.message.count({ where: { tenantId, role: 'USER' } });
    const asstMsgsAfter = await prisma.message.count({ where: { tenantId, role: 'ASSISTANT' } });

    // ZERO duplicate message rows created
    expect(userMsgsAfter).toBe(userMsgsBefore);
    expect(asstMsgsAfter).toBe(asstMsgsBefore);
  }, 25000);
});
