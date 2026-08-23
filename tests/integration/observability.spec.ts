import { describe, it, expect, beforeEach, beforeAll, afterEach } from 'vitest';
import { prisma, pool } from '../../src/tests/testDb';
import { bootstrapChatbot } from '../../src/bootstrap';
import { DEFAULT_BUSINESS_CONFIG } from '../../src/domain/tenant/BusinessConfig';
import { LLMMockProvider } from '../../src/core/llm/LLMProvider';
import { telemetry, TelemetryClient } from '../../src/core/telemetry/TelemetryClient';
import { ConversationTrace } from '../../src/core/telemetry/ConversationTrace';
import { TelemetryEvent } from '../../../packages/shared/contracts/telemetry.contract';

describe('Phase 15: Observability and Traceability Hardening Tests', () => {
  let deps: ReturnType<typeof bootstrapChatbot>;
  let mockLlm: LLMMockProvider;
  const createdTenantIds: string[] = [];
  const emittedEvents: TelemetryEvent[] = [];
  let unsubscribeTelemetry: () => void;

  beforeAll(async () => {
    const client = await pool.connect();
    try {
      await client.query('SET search_path TO test, public, extensions;');
    } finally {
      client.release();
    }
  });

  beforeEach(async () => {
    deps = bootstrapChatbot(prisma);
    mockLlm = new LLMMockProvider();
    deps.llmFactory.registerProvider('mock', 'mock-model', mockLlm);
    deps.tenantConfigService.clearCache();

    emittedEvents.length = 0;
    unsubscribeTelemetry = telemetry.onEvent(e => {
      emittedEvents.push(e);
    });
  });

  afterEach(async () => {
    if (unsubscribeTelemetry) {
      unsubscribeTelemetry();
    }
    for (const tenantId of createdTenantIds) {
      try {
        await prisma.tenant.delete({ where: { id: tenantId } });
      } catch (err) {}
    }
    createdTenantIds.length = 0;
  });

  async function seedStore() {
    const tenant = await prisma.tenant.create({
      data: {
        name: `Tenant-Obs-${Date.now()}`,
        config: {
          create: {
            config: {
              ...DEFAULT_BUSINESS_CONFIG,
              capabilities: {
                ...DEFAULT_BUSINESS_CONFIG.capabilities,
                faq: [
                  {
                    id: 'faq-hours',
                    question: 'What are your store hours?',
                    answer: 'We are open 9am-6pm daily.',
                    questions: { en: 'What are your store hours?' },
                    answers: { en: 'We are open 9am-6pm daily.' }
                  }
                ]
              }
            }
          }
        },
        accounts: {
          create: [
            { name: 'obs-store-a', config: { capabilities: { ecommerceEnabled: true } } },
            { name: 'obs-store-b', config: { capabilities: { ecommerceEnabled: true } } }
          ]
        }
      },
      include: { accounts: true }
    });
    createdTenantIds.push(tenant.id);

    const accountA = tenant.accounts.find(a => a.name === 'obs-store-a')!;
    const accountB = tenant.accounts.find(a => a.name === 'obs-store-b')!;

    await prisma.product.create({
      data: {
        tenantId: tenant.id,
        accountId: accountA.id,
        sku: 'SKU-OBS-01',
        name: 'Obs Running Shoes',
        description: 'Obs shoe',
        price: 99,
        currency: 'USD',
        stock: 10,
        active: true
      }
    });

    return { tenant, accountA, accountB };
  }

  it('1. End-to-End Turn Trace: Consistent correlationId & separate conversationId across all stages', async () => {
    const { tenant, accountA } = await seedStore();
    const custId = 'cust-trace-01';

    await deps.conversationEngine.handleMessage(tenant.id, custId, 'What are your store hours?', accountA.id);

    const entryEvent = emittedEvents.find(e => e.eventType === 'message_received');
    const completedEvent = emittedEvents.find(e => e.eventType === 'response_completed');

    expect(entryEvent).toBeDefined();
    expect(completedEvent).toBeDefined();
    expect(entryEvent?.correlationId).toBe(completedEvent?.correlationId);
    expect(completedEvent?.conversationId).toBeDefined();
    expect(completedEvent?.correlationId).not.toBe(completedEvent?.conversationId);
    expect(completedEvent?.metadata?.responseSource).toBe('FAQ');
    expect(completedEvent?.latencyMs).toBeGreaterThanOrEqual(0);

    const summary = ConversationTrace.summarize(emittedEvents.filter(e => e.correlationId === entryEvent?.correlationId));
    expect(summary).not.toBeNull();
    expect(summary?.primaryCapability).toBe('FAQ');
    expect(summary?.isSuccess).toBe(true);
  });

  it('2. Capability Identification: Accurately records ECOMMERCE & HANDOFF capabilities in telemetry', async () => {
    const { tenant, accountA } = await seedStore();

    // 1. Ecommerce
    emittedEvents.length = 0;
    await deps.conversationEngine.handleMessage(tenant.id, 'cust-ecom', 'how much is SKU-OBS-01?', accountA.id);
    const ecomCompleted = emittedEvents.find(e => e.eventType === 'response_completed');
    expect(ecomCompleted?.metadata?.responseSource).toBe('ECOMMERCE');

    const ecomExecuted = emittedEvents.find(e => e.eventType === 'ecommerce_executed');
    expect(ecomExecuted).toBeDefined();
    expect(ecomExecuted?.metadata?.intent).toBe('PRICE');

    // 2. Human Handoff
    emittedEvents.length = 0;
    await deps.conversationEngine.handleMessage(tenant.id, 'cust-handoff', 'I need to talk to a human', accountA.id);
    const handoffCompleted = emittedEvents.find(e => e.eventType === 'response_completed');
    expect(handoffCompleted?.metadata?.responseSource).toBe('HANDOFF');
  });

  it('3. Cross-Account Trace Isolation: Concurrent requests from Account A and B never mix correlation/account IDs', async () => {
    const { tenant, accountA, accountB } = await seedStore();

    const [resA, resB] = await Promise.all([
      deps.conversationEngine.handleMessage(tenant.id, 'cust-acc-a', 'What are your store hours?', accountA.id),
      deps.conversationEngine.handleMessage(tenant.id, 'cust-acc-b', 'What are your store hours?', accountB.id)
    ]);

    expect(resA).toContain('open 9am-6pm');
    expect(resB).toContain('open 9am-6pm');

    const eventsA = emittedEvents.filter(e => e.metadata?.accountId === accountA.id);
    const eventsB = emittedEvents.filter(e => e.metadata?.accountId === accountB.id);

    expect(eventsA.length).toBeGreaterThan(0);
    expect(eventsB.length).toBeGreaterThan(0);

    const corrIdsA = new Set(eventsA.map(e => e.correlationId));
    const corrIdsB = new Set(eventsB.map(e => e.correlationId));

    // Ensure zero overlap in correlation IDs
    for (const idA of corrIdsA) {
      expect(corrIdsB.has(idA)).toBe(false);
    }
  });

  it('4. Privacy & Sanitization: Forbidden sensitive keys (prompt, response, password, token) are redacted from telemetry', () => {
    const testCorrId = TelemetryClient.createCorrelationId();

    telemetry.emit({
      eventType: 'test_sanitization',
      tenantId: 'tenant-test',
      correlationId: testCorrId,
      stage: 'test',
      status: 'SUCCESS',
      metadata: {
        safeMetric: 42,
        prompt: 'SELECT * FROM users;',
        rawResponse: 'Secret API Response',
        password: 'SuperSecretPassword123',
        token: 'Bearer eyJhbGciOi...',
        apiKey: 'sk-1234567890'
      }
    });

    const testEvent = emittedEvents.find(e => e.correlationId === testCorrId);
    expect(testEvent).toBeDefined();
    expect(testEvent?.metadata?.safeMetric).toBe(42);
    expect(testEvent?.metadata?.prompt).toBeUndefined();
    expect(testEvent?.metadata?.rawResponse).toBeUndefined();
    expect(testEvent?.metadata?.password).toBeUndefined();
    expect(testEvent?.metadata?.token).toBeUndefined();
    expect(testEvent?.metadata?.apiKey).toBeUndefined();
  });
});
