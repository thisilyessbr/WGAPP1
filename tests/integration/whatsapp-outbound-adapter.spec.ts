import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { prisma, pool } from '../../src/tests/testDb';
import { bootstrapChatbot } from '../../src/bootstrap';
import { WhatsAppOutboundAdapter } from '../../src/domain/channel/whatsapp/WhatsAppOutboundAdapter';
import { WhatsAppWorker } from '../../src/domain/channel/whatsapp/WhatsAppWorker';
import { PostgresMessageQueue, InboundQueueJob } from '../../src/domain/channel/whatsapp/MessageQueue';
import { DEFAULT_BUSINESS_CONFIG } from '../../src/domain/tenant/BusinessConfig';

describe('PHASE WHATSAPP-OUTBOUND-ADAPTER-AUDIT-IMPLEMENT-44: WhatsApp Outbound Adapter Integration Tests', () => {
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
    const tenantId = `tenant-out-${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    createdTenantIds.push(tenantId);

    const tenant = await prisma.tenant.create({
      data: { id: tenantId, name: `Tenant ${prefix}` }
    });

    const accountA = await prisma.account.create({
      data: { tenantId, name: 'Main Account' }
    });

    // Register Number 1 (Enabled)
    const phoneNum1 = `phone-id-1-${Date.now()}`;
    await deps.whatsAppNumberService!.registerNumber({
      tenantId,
      accountId: accountA.id,
      phoneNumberId: phoneNum1,
      displayPhoneNumber: '+15550001',
      enabled: true
    });

    // Register Number 2 (Enabled)
    const phoneNum2 = `phone-id-2-${Date.now()}`;
    await deps.whatsAppNumberService!.registerNumber({
      tenantId,
      accountId: accountA.id,
      phoneNumberId: phoneNum2,
      displayPhoneNumber: '+15550002',
      enabled: true
    });

    // Register Number 3 (Disabled)
    const phoneNum3 = `phone-id-3-disabled-${Date.now()}`;
    await deps.whatsAppNumberService!.registerNumber({
      tenantId,
      accountId: accountA.id,
      phoneNumberId: phoneNum3,
      displayPhoneNumber: '+15550003',
      enabled: false
    });

    await deps.tenantConfigService.updateConfig(tenantId, {
      ...DEFAULT_BUSINESS_CONFIG,
      identity: { botName: 'OutboundBot', brand: 'Outbound Brand' },
      capabilities: {
        ...DEFAULT_BUSINESS_CONFIG.capabilities,
        ecommerceEnabled: true,
        faq: [
          { id: 'f1', question: 'What is your shipping policy?', answer: 'We ship worldwide in 3 days!', category: 'SHIPPING' }
        ]
      }
    });

    return { tenantId, accountA, phoneNum1, phoneNum2, phoneNum3 };
  }

  function makeJob(tenantId: string, accountId: string, phoneNumberId: string, waId: string, wamid: string, msg: string): InboundQueueJob {
    return {
      id: wamid,
      partitionKey: `${tenantId}:${accountId}:${waId}`,
      tenantId,
      accountId,
      phoneNumberId,
      waId,
      wamid,
      message: msg,
      timestamp: Date.now(),
      rawType: 'text',
      enqueuedAt: Date.now()
    };
  }

  it('1, 2, 3, 4, 5, 6. Successful text send invokes Meta Cloud API with correct URL, headers, and captures providerMessageId', async () => {
    const { tenantId, accountA, phoneNum1 } = await createTestTenantWithNumbers('success');
    const user = '212688888881';
    const wamid = `wamid.out.1.${Date.now()}`;
    const job = makeJob(tenantId, accountA.id, phoneNum1, user, wamid, 'What is your shipping policy?');

    let capturedUrl = '';
    let capturedHeaders: Record<string, string> = {};
    let capturedBody: any = null;

    const mockFetch = vi.fn(async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedHeaders = (init?.headers as Record<string, string>) || {};
      capturedBody = JSON.parse((init?.body as string) || '{}');

      return {
        ok: true,
        status: 200,
        json: async () => ({
          messaging_product: 'whatsapp',
          contacts: [{ input: user, wa_id: user }],
          messages: [{ id: 'wamid.meta.reply.999001' }]
        })
      } as Response;
    });

    const outboundAdapter = new WhatsAppOutboundAdapter({
      defaultAccessToken: 'EAAG_test_system_token_12345',
      fetchFn: mockFetch as any
    });

    const worker = new WhatsAppWorker(queue, deps.conversationEngine, outboundAdapter, deps.whatsAppNumberService);
    const result = await worker.processJob(job);

    expect(result.response).toContain('We ship worldwide in 3 days!');
    expect(result.outboundResult?.success).toBe(true);
    expect(result.outboundResult?.providerMessageId).toBe('wamid.meta.reply.999001');

    // Verify Meta Cloud API URL structure: https://graph.facebook.com/v22.0/{phoneNumberId}/messages
    expect(capturedUrl).toBe(`https://graph.facebook.com/v22.0/${phoneNum1}/messages`);
    expect(capturedHeaders['Authorization']).toBe('Bearer EAAG_test_system_token_12345');
    expect(capturedHeaders['Content-Type']).toBe('application/json');

    // Verify payload
    expect(capturedBody.messaging_product).toBe('whatsapp');
    expect(capturedBody.recipient_type).toBe('individual');
    expect(capturedBody.to).toBe(user);
    expect(capturedBody.type).toBe('text');
    expect(capturedBody.text.body).toContain('We ship worldwide in 3 days!');
  }, 25000);

  it('7. Temporary Meta rate limit (HTTP 429 / Code 130429) retries with exponential backoff and succeeds on retry', async () => {
    const { tenantId, accountA, phoneNum1 } = await createTestTenantWithNumbers('retry-ok');
    const user = '212688888882';
    const wamid = `wamid.out.retry.${Date.now()}`;
    const job = makeJob(tenantId, accountA.id, phoneNum1, user, wamid, 'What is your shipping policy?');

    let callCount = 0;
    const mockFetch = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        // First attempt: Rate limit hit
        return {
          ok: false,
          status: 429,
          json: async () => ({
            error: {
              message: 'Cloud API message throughput reached',
              type: 'OAuthException',
              code: 130429
            }
          })
        } as Response;
      }
      // Second attempt: Success
      return {
        ok: true,
        status: 200,
        json: async () => ({
          messages: [{ id: 'wamid.meta.recovered.002' }]
        })
      } as Response;
    });

    const outboundAdapter = new WhatsAppOutboundAdapter({
      defaultAccessToken: 'EAAG_test_token',
      maxRetries: 3,
      initialBackoffMs: 50,
      fetchFn: mockFetch as any
    });

    const worker = new WhatsAppWorker(queue, deps.conversationEngine, outboundAdapter, deps.whatsAppNumberService);
    const result = await worker.processJob(job);

    expect(callCount).toBe(2);
    expect(result.outboundResult?.success).toBe(true);
    expect(result.outboundResult?.providerMessageId).toBe('wamid.meta.recovered.002');
  }, 25000);

  it('8. Permanent Meta error (HTTP 401 / Invalid Token 190) fails immediately without retry loops', async () => {
    const { tenantId, accountA, phoneNum1 } = await createTestTenantWithNumbers('perm-fail');
    const user = '212688888883';
    const wamid = `wamid.out.perm.${Date.now()}`;
    const job = makeJob(tenantId, accountA.id, phoneNum1, user, wamid, 'What is your shipping policy?');

    let callCount = 0;
    const mockFetch = vi.fn(async () => {
      callCount++;
      return {
        ok: false,
        status: 401,
        json: async () => ({
          error: {
            message: 'Invalid OAuth access token.',
            type: 'OAuthException',
            code: 190
          }
        })
      } as Response;
    });

    const outboundAdapter = new WhatsAppOutboundAdapter({
      defaultAccessToken: 'EAAG_bad_token',
      maxRetries: 3,
      fetchFn: mockFetch as any
    });

    const worker = new WhatsAppWorker(queue, deps.conversationEngine, outboundAdapter, deps.whatsAppNumberService);
    const result = await worker.processJob(job);

    expect(callCount).toBe(1); // Permanent failure returned immediately
    expect(result.outboundResult?.success).toBe(false);
    expect(result.outboundResult?.errorCode).toBe(190);
    expect(result.outboundResult?.isRetryable).toBe(false);
  }, 25000);

  it('9 & 10. Failure Isolation: If Meta outbound fails, the committed turn remains intact and retry NEVER re-runs ConversationEngine', async () => {
    const { tenantId, accountA, phoneNum1 } = await createTestTenantWithNumbers('iso-fail');
    const user = '212688888884';
    const wamid = `wamid.out.failiso.${Date.now()}`;
    const job = makeJob(tenantId, accountA.id, phoneNum1, user, wamid, 'What is your shipping policy?');

    // Outbound mock that always fails with network error
    const mockFailFetch = vi.fn(async () => {
      throw new Error('Meta API Connection Reset');
    });

    const outboundAdapter = new WhatsAppOutboundAdapter({
      defaultAccessToken: 'EAAG_token',
      maxRetries: 1,
      fetchFn: mockFailFetch as any
    });

    const worker = new WhatsAppWorker(queue, deps.conversationEngine, outboundAdapter, deps.whatsAppNumberService);

    // 1st Execution: ConversationEngine runs and commits turn, but outbound fails
    const res1 = await worker.processJob(job);
    expect(res1.response).toContain('We ship worldwide in 3 days!');
    expect(res1.outboundResult?.success).toBe(false);

    // Verify turn is saved in DB with externalId
    const savedMsg = await prisma.message.findFirst({ where: { tenantId, externalId: wamid } });
    expect(savedMsg).not.toBeNull();

    // 2nd Execution (Retry): Turn is fetched via idempotency fast-path (0 LLM, 0 duplicate messages)
    const userMsgsBefore = await prisma.message.count({ where: { tenantId, role: 'USER' } });
    const asstMsgsBefore = await prisma.message.count({ where: { tenantId, role: 'ASSISTANT' } });

    const res2 = await worker.processJob(job);
    expect(res2.response).toBe(res1.response);

    const userMsgsAfter = await prisma.message.count({ where: { tenantId, role: 'USER' } });
    const asstMsgsAfter = await prisma.message.count({ where: { tenantId, role: 'ASSISTANT' } });

    expect(userMsgsAfter).toBe(userMsgsBefore);
    expect(asstMsgsAfter).toBe(asstMsgsBefore);
  }, 25000);

  it('11 & 12. Multi-number routing: Inbound on Number 1 sends from Number 1, Inbound on Number 2 sends from Number 2', async () => {
    const { tenantId, accountA, phoneNum1, phoneNum2 } = await createTestTenantWithNumbers('multi-num');
    const userA = '212688888885';
    const userB = '212688888886';

    const outboundCalls: { url: string; to: string }[] = [];
    const mockFetch = vi.fn(async (url: string, init?: RequestInit) => {
      const body = JSON.parse((init?.body as string) || '{}');
      outboundCalls.push({ url, to: body.to });
      return {
        ok: true,
        status: 200,
        json: async () => ({ messages: [{ id: `wamid.meta.${Date.now()}` }] })
      } as Response;
    });

    const outboundAdapter = new WhatsAppOutboundAdapter({
      defaultAccessToken: 'EAAG_token',
      fetchFn: mockFetch as any
    });

    const worker = new WhatsAppWorker(queue, deps.conversationEngine, outboundAdapter, deps.whatsAppNumberService);

    // User A messages Number 1
    await worker.processJob(makeJob(tenantId, accountA.id, phoneNum1, userA, `wamid.num1.${Date.now()}`, 'What is your shipping policy?'));

    // User B messages Number 2
    await worker.processJob(makeJob(tenantId, accountA.id, phoneNum2, userB, `wamid.num2.${Date.now()}`, 'What is your shipping policy?'));

    expect(outboundCalls).toHaveLength(2);
    expect(outboundCalls[0].url).toContain(phoneNum1);
    expect(outboundCalls[0].to).toBe(userA);

    expect(outboundCalls[1].url).toContain(phoneNum2);
    expect(outboundCalls[1].to).toBe(userB);
  }, 25000);

  it('13 & 14. Disabled or Unknown phone number is blocked from sending outbound messages', async () => {
    const { tenantId, accountA, phoneNum3 } = await createTestTenantWithNumbers('disabled-block');
    const user = '212688888887';

    const mockFetch = vi.fn();
    const outboundAdapter = new WhatsAppOutboundAdapter({
      defaultAccessToken: 'EAAG_token',
      fetchFn: mockFetch as any
    });

    const worker = new WhatsAppWorker(queue, deps.conversationEngine, outboundAdapter, deps.whatsAppNumberService);

    // Attempt with disabled number (phoneNum3)
    const disabledJob = makeJob(tenantId, accountA.id, phoneNum3, user, `wamid.dis.${Date.now()}`, 'hi');
    const disResult = await worker.processJob(disabledJob);

    expect(disResult.outboundResult?.success).toBe(false);
    expect(disResult.outboundResult?.error).toContain('disabled');
    expect(mockFetch).not.toHaveBeenCalled();

    // Attempt with unknown number
    const unknownJob = makeJob(tenantId, accountA.id, 'phone-unknown-999', user, `wamid.unk.${Date.now()}`, 'hi');
    const unkResult = await worker.processJob(unknownJob);

    expect(unkResult.outboundResult?.success).toBe(false);
    expect(unkResult.outboundResult?.error).toContain('unknown');
    expect(mockFetch).not.toHaveBeenCalled();
  }, 25000);
});
