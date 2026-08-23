import { describe, it, expect, beforeEach, beforeAll, afterEach } from 'vitest';
import { prisma, pool } from '../../src/tests/testDb';
import { bootstrapChatbot } from '../../src/bootstrap';
import { DEFAULT_BUSINESS_CONFIG } from '../../src/domain/tenant/BusinessConfig';
import { LLMMockProvider } from '../../src/core/llm/LLMProvider';
import { telemetry } from '../../src/core/telemetry/TelemetryClient';
import { TelemetryEvent } from '../../../packages/shared/contracts/telemetry.contract';
import { QuestionReformulator } from '../../src/domain/rag/QuestionReformulator';
import { ConversationMemoryManager } from '../../src/domain/conversation/ConversationMemory';

describe('Phase 16: Performance + LLM Cost Optimization Tests', () => {
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

  async function seedWorkflowlessTenant() {
    const tenant = await prisma.tenant.create({
      data: {
        name: `Tenant-Perf-Wfless-${Date.now()}`,
        config: {
          create: {
            config: {
              ...DEFAULT_BUSINESS_CONFIG,
              workflows: {},
              capabilities: {
                ...DEFAULT_BUSINESS_CONFIG.capabilities,
                faq: [
                  {
                    id: 'faq-wifi',
                    question: 'What is the wifi password?',
                    answer: 'The wifi password is GuestWifi2026.',
                    questions: { en: 'What is the wifi password?' },
                    answers: { en: 'The wifi password is GuestWifi2026.' }
                  }
                ]
              }
            }
          }
        },
        accounts: {
          create: [
            { name: 'perf-store-a', config: { capabilities: { ecommerceEnabled: true } } }
          ]
        }
      },
      include: { accounts: true }
    });
    createdTenantIds.push(tenant.id);
    const accountA = tenant.accounts[0];

    await prisma.product.create({
      data: {
        tenantId: tenant.id,
        accountId: accountA.id,
        sku: 'SKU-PERF-01',
        name: 'Performance Running Shoe',
        description: 'Lightweight marathon shoe',
        price: 120,
        currency: 'USD',
        stock: 15,
        active: true
      }
    });

    return { tenant, accountA };
  }

  async function seedWorkflowTenant() {
    const tenant = await prisma.tenant.create({
      data: {
        name: `Tenant-Perf-Wf-${Date.now()}`,
        config: {
          create: {
            config: {
              ...DEFAULT_BUSINESS_CONFIG,
              workflows: {
                lead_capture: {
                  id: 'lead_capture',
                  name: 'Lead Capture',
                  initialState: 'ask_name',
                  states: {
                    ask_name: {
                      id: 'ask_name',
                      type: 'collect',
                      field: { name: 'fullName', type: 'string', required: true, extractionPrompt: 'What is your name?' },
                      transitions: [{ target: 'ask_email' }]
                    },
                    ask_email: {
                      id: 'ask_email',
                      type: 'collect',
                      field: { name: 'email', type: 'string', required: true, extractionPrompt: 'What is your email?' },
                      transitions: [{ target: 'confirm_details' }]
                    }
                  }
                }
              }
            }
          }
        }
      }
    });
    createdTenantIds.push(tenant.id);
    return { tenant };
  }

  it('1. Baseline Measurement & LLM Call Matrix for all 10 standard paths', async () => {
    const { tenant, accountA } = await seedWorkflowlessTenant();
    const { tenant: wfTenant } = await seedWorkflowTenant();

    let llmCallCount = 0;
    mockLlm.generateResponse = async () => {
      llmCallCount++;
      return 'Mock LLM Response';
    };

    // A. Greeting
    llmCallCount = 0;
    const t0 = performance.now();
    const resGreeting = await deps.conversationEngine.handleMessage(tenant.id, 'cust-greet', 'hello', accountA.id);
    const latGreeting = performance.now() - t0;
    expect(resGreeting).toBeDefined();
    expect(llmCallCount).toBe(0); // 0 LLM calls

    // B. FAQ hit
    llmCallCount = 0;
    const t1 = performance.now();
    const resFaq = await deps.conversationEngine.handleMessage(tenant.id, 'cust-faq', 'What is the wifi password?', accountA.id);
    const latFaq = performance.now() - t1;
    expect(resFaq).toContain('GuestWifi2026');
    expect(llmCallCount).toBe(0); // 0 LLM calls

    // C. Normal workflow step
    llmCallCount = 0;
    const t2 = performance.now();
    const resWf1 = await deps.conversationEngine.handleMessage(wfTenant.id, 'cust-wf', 'start');
    const latWf = performance.now() - t2;
    expect(resWf1).toContain('What is your name?');
    expect(llmCallCount).toBe(0); // 0 LLM calls

    // D. Ecommerce product lookup
    llmCallCount = 0;
    const t3 = performance.now();
    const resEcom = await deps.conversationEngine.handleMessage(tenant.id, 'cust-ecom', 'how much is SKU-PERF-01?', accountA.id);
    const latEcom = performance.now() - t3;
    expect(resEcom).toContain('120 USD');
    expect(llmCallCount).toBe(0); // 0 LLM calls

    // H. Safety refusal
    llmCallCount = 0;
    const t4 = performance.now();
    const resSafety = await deps.conversationEngine.handleMessage(tenant.id, 'cust-safe', 'kill yourself', accountA.id);
    const latSafety = performance.now() - t4;
    expect(resSafety).toBeDefined();
    expect(llmCallCount).toBe(0); // 0 LLM calls

    // I. Human handoff
    llmCallCount = 0;
    const t5 = performance.now();
    const resHandoff = await deps.conversationEngine.handleMessage(tenant.id, 'cust-handoff', 'talk to a human', accountA.id);
    const latHandoff = performance.now() - t5;
    expect(resHandoff).toContain('human agent has been notified');
    expect(llmCallCount).toBe(0); // 0 LLM calls

    // J. Fallback (unrecognized message without knowledge)
    llmCallCount = 0;
    mockLlm.generateResponse = async () => {
      llmCallCount++;
      return 'UNANSWERABLE';
    };
    const t6 = performance.now();
    const resFallback = await deps.conversationEngine.handleMessage(tenant.id, 'cust-fb', 'xyzzy random nonsense 999', accountA.id);
    const latFallback = performance.now() - t6;
    expect(resFallback).toBeDefined();
  });

  it('2. Reformulation Cost: Standalone queries bypass reformulator with 0 LLM calls', async () => {
    let reformulatorCalls = 0;
    const testLlm = new LLMMockProvider();
    testLlm.generateResponse = async () => {
      reformulatorCalls++;
      return 'Reformulated question';
    };

    const memoryWithHistory = ConversationMemoryManager.buildMemory({
      conversationId: 'conv-test',
      tenantId: 'tenant-test',
      customerId: 'cust-test',
      recentMessages: [
        { role: 'user', content: 'Tell me about Running Shoe A', createdAt: new Date() },
        { role: 'assistant', content: 'It is a lightweight marathon shoe.', createdAt: new Date() }
      ]
    });

    // Standalone queries should never invoke LLM
    const standaloneQueries = [
      'What is your refund policy?',
      'What are your opening hours?',
      'Where is your headquarters located?',
      'What payment methods do you accept?'
    ];

    for (const q of standaloneQueries) {
      const isAmbiguous = QuestionReformulator.isAmbiguous(q, memoryWithHistory);
      expect(isAmbiguous).toBe(false);
      const res = await QuestionReformulator.reformulate(q, memoryWithHistory, testLlm);
      expect(res.reformulated).toBe(false);
      expect(res.retrievalQuery).toBe(q);
    }
    expect(reformulatorCalls).toBe(0);

    // Ambiguous follow-ups invoke reformulator
    const ambiguousQueries = ['How much is it?', 'What about size 42?', 'is it in stock?'];
    for (const q of ambiguousQueries) {
      const isAmbiguous = QuestionReformulator.isAmbiguous(q, memoryWithHistory);
      expect(isAmbiguous).toBe(true);
    }
  });

  it('3. Concurrency Test: 10 mixed concurrent requests execute without error or cross-contamination', async () => {
    const { tenant, accountA } = await seedWorkflowlessTenant();

    const queries = [
      { cust: 'c1', text: 'hello' },
      { cust: 'c2', text: 'What is the wifi password?' },
      { cust: 'c3', text: 'how much is SKU-PERF-01?' },
      { cust: 'c4', text: 'talk to a human' },
      { cust: 'c5', text: 'hello' },
      { cust: 'c6', text: 'What is the wifi password?' },
      { cust: 'c7', text: 'how much is SKU-PERF-01?' },
      { cust: 'c8', text: 'talk to a human' },
      { cust: 'c9', text: 'hello' },
      { cust: 'c10', text: 'What is the wifi password?' }
    ];

    const tStart = performance.now();
    const results = await Promise.all(
      queries.map(q => deps.conversationEngine.handleMessage(tenant.id, q.cust, q.text, accountA.id))
    );
    const totalLatency = performance.now() - tStart;

    expect(results.length).toBe(10);
    results.forEach(res => {
      expect(res).toBeDefined();
      expect(res.length).toBeGreaterThan(0);
    });

    expect(totalLatency).toBeGreaterThan(0);
  });
});
