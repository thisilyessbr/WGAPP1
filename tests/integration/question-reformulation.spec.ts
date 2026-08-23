import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { prisma, pool } from '../../src/tests/testDb';
import { bootstrapChatbot } from '../../src/bootstrap';
import { DEFAULT_BUSINESS_CONFIG } from '../../src/domain/tenant/BusinessConfig';
import { LLMMockProvider } from '../../src/core/llm/LLMProvider';
import { QuestionReformulator } from '../../src/domain/rag/QuestionReformulator';
import { ConversationMemoryManager } from '../../src/domain/conversation/ConversationMemory';

describe('Phase 6: Conditional Question Reformulation Integration Tests', () => {
  let deps: ReturnType<typeof bootstrapChatbot>;
  let mockLlm: LLMMockProvider;

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
  });

  it('1. Fast-Path: Standalone queries bypass reformulation with 0 extra calls', async () => {
    const standaloneQueries = [
      'What is your refund policy?',
      'What are your opening hours?',
      'How do returns work?',
      'Do you offer enterprise support?',
      'Where is your headquarters located?',
      'Can I change my subscription plan?',
      'What payment methods do you accept?',
      'How do I reset my password?',
      'Is there an API available?',
      'How do I contact customer support?'
    ];

    let reformulationCallCount = 0;
    mockLlm.generateResponse = async (sysPrompt: string) => {
      if (sysPrompt.includes('search query reformulator')) {
        reformulationCallCount++;
        return 'Reformulated query';
      }
      return 'UNANSWERABLE';
    };

    for (const query of standaloneQueries) {
      const isAmb = QuestionReformulator.isAmbiguous(query, null);
      expect(isAmb).toBe(false);

      const mem = ConversationMemoryManager.buildMemory({
        tenantId: 't1',
        customerId: 'c1',
        conversationId: 'conv1',
        recentMessages: [{ role: 'USER', content: 'hello', createdAt: new Date() }]
      });

      // Even with history, standalone queries must not be marked ambiguous
      const isAmbWithHistory = QuestionReformulator.isAmbiguous(query, mem);
      expect(isAmbWithHistory).toBe(false);
    }

    expect(reformulationCallCount).toBe(0);
  });

  it('2. Contextual follow-up queries are accurately detected and reformulated', async () => {
    const memory = ConversationMemoryManager.buildMemory({
      tenantId: 't1',
      customerId: 'c1',
      conversationId: 'conv1',
      recentMessages: [
        { role: 'ASSISTANT', content: 'Our Enterprise plan includes dedicated support and custom SLAs.', createdAt: new Date(Date.now() - 1000) },
        { role: 'USER', content: 'Tell me about the Enterprise plan.', createdAt: new Date(Date.now() - 2000) }
      ]
    });

    expect(QuestionReformulator.isAmbiguous('How much is it?', memory)).toBe(true);
    expect(QuestionReformulator.isAmbiguous('What about France?', memory)).toBe(true);
    expect(QuestionReformulator.isAmbiguous('What about size 42?', memory)).toBe(true);
    expect(QuestionReformulator.isAmbiguous('Combien ça coûte?', memory)).toBe(true);
    expect(QuestionReformulator.isAmbiguous('bch7al hadi?', memory)).toBe(true);

    mockLlm.generateResponse = async (sysPrompt: string, messages: any[]) => {
      const userContent = messages[0]?.content || '';
      if (userContent.includes('How much is it?')) {
        return 'Enterprise plan cost and pricing';
      }
      return 'UNANSWERABLE';
    };

    const res = await QuestionReformulator.reformulate('How much is it?', memory, mockLlm);
    expect(res.reformulated).toBe(true);
    expect(res.retrievalQuery).toBe('Enterprise plan cost and pricing');
  });

  it('3. Reformulation failure safely falls back to original customer query without crashing', async () => {
    const memory = ConversationMemoryManager.buildMemory({
      tenantId: 't1',
      customerId: 'c1',
      conversationId: 'conv1',
      recentMessages: [
        { role: 'USER', content: 'Tell me about the Enterprise plan.', createdAt: new Date() }
      ]
    });

    // Case A: LLM Error
    mockLlm.generateResponse = async () => {
      throw new Error('LLM Provider Rate Limit Exceeded');
    };

    const resA = await QuestionReformulator.reformulate('How much is it?', memory, mockLlm);
    expect(resA.reformulated).toBe(false);
    expect(resA.retrievalQuery).toBe('How much is it?');

    // Case B: LLM returns empty string
    mockLlm.generateResponse = async () => '';
    const resB = await QuestionReformulator.reformulate('How much is it?', memory, mockLlm);
    expect(resB.reformulated).toBe(false);
    expect(resB.retrievalQuery).toBe('How much is it?');
  });

  it('4. No-Context test: ambiguous phrasing without prior conversation is not reformulated', async () => {
    // Memory with 0 recent turns
    const emptyMemory = ConversationMemoryManager.buildMemory({
      tenantId: 't1',
      customerId: 'c1',
      conversationId: 'conv1',
      recentMessages: []
    });

    let reformCalled = false;
    mockLlm.generateResponse = async () => {
      reformCalled = true;
      return 'Hallucinated query';
    };

    const isAmb = QuestionReformulator.isAmbiguous('How much is it?', emptyMemory);
    expect(isAmb).toBe(false);

    const res = await QuestionReformulator.reformulate('How much is it?', emptyMemory, mockLlm);
    expect(res.reformulated).toBe(false);
    expect(res.retrievalQuery).toBe('How much is it?');
    expect(reformCalled).toBe(false);
  });

  it('5. Account isolation: Account A history cannot be used to reformulate Account B query', async () => {
    const tenant = await prisma.tenant.create({
      data: {
        name: `Tenant-Reform-Iso-${Date.now()}`,
        config: {
          create: {
            config: {
              ...DEFAULT_BUSINESS_CONFIG,
              llm: { provider: 'mock', model: 'mock-model', temperature: 0.1, maxTokens: 500, timeoutMs: 5000 },
              workflows: {},
              capabilities: { ...DEFAULT_BUSINESS_CONFIG.capabilities, faq: [] }
            }
          }
        }
      }
    });

    const accountA = await prisma.account.create({
      data: { tenantId: tenant.id, name: 'Account A', enabled: true }
    });
    const accountB = await prisma.account.create({
      data: { tenantId: tenant.id, name: 'Account B', enabled: true }
    });

    const custA = `cust-ref-a-${Date.now()}`;
    const custB = `cust-ref-b-${Date.now()}`;

    // Turn 1 for A: Enterprise plan
    await deps.conversationEngine.handleMessage(tenant.id, custA, 'Tell me about the Enterprise plan.', accountA.id);
    // Turn 1 for B: Student discount
    await deps.conversationEngine.handleMessage(tenant.id, custB, 'Tell me about student discounts.', accountB.id);

    let capturedReformPromptA = '';
    let capturedReformPromptB = '';

    mockLlm.generateResponse = async (sysPrompt: string, messages: any[]) => {
      const userContent = messages[0]?.content || '';
      if (sysPrompt.includes('search query reformulator')) {
        if (userContent.includes('Enterprise')) {
          capturedReformPromptA = userContent;
          return 'Enterprise plan pricing';
        }
        if (userContent.includes('student')) {
          capturedReformPromptB = userContent;
          return 'Student discount eligibility';
        }
      }
      return 'UNANSWERABLE';
    };

    // Turn 2: Ambiguous follow-up
    await deps.conversationEngine.handleMessage(tenant.id, custA, 'How much is it?', accountA.id);
    await deps.conversationEngine.handleMessage(tenant.id, custB, 'How much is it?', accountB.id);

    expect(capturedReformPromptA).toContain('Enterprise');
    expect(capturedReformPromptA).not.toContain('student');

    expect(capturedReformPromptB).toContain('student');
    expect(capturedReformPromptB).not.toContain('Enterprise');
  }, 30000);
});
