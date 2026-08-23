import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConversationEngine } from '../../src/domain/conversation/ConversationEngine';
import { telemetry } from '../../src/core/telemetry/TelemetryClient';
import { TelemetryEvent } from '../../packages/shared/contracts/telemetry.contract';
import { LLMMockProvider } from '../../src/core/llm/LLMProvider';
import { LLMFactory } from '../../src/core/llm/LLMFactory';
import { DEFAULT_BUSINESS_CONFIG } from '../../src/domain/tenant/BusinessConfig';
import { ResponseBuilder } from '../../src/domain/conversation/ResponseBuilder';

describe('Phase 29B: Cost Optimization & Token Observability', () => {
  let emittedEvents: TelemetryEvent[] = [];

  beforeEach(() => {
    emittedEvents = [];
    telemetry.onEvent((event) => {
      emittedEvents.push(event);
    });
  });

  it('1. eliminates redundant Account DB lookup by using already-resolved effective config', async () => {
    const accountFindUniqueSpy = vi.fn();
    const mockPrisma: any = {
      account: {
        findUnique: accountFindUniqueSpy
      },
      customer: {
        findUnique: vi.fn().mockResolvedValue({ id: 'cust-1' }),
        upsert: vi.fn().mockResolvedValue({ id: 'cust-1' })
      },
      conversation: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({
          id: 'conv-1',
          tenantId: 'animeverse',
          customerId: 'cust-1',
          accountId: 'animeverse-store',
          version: 1,
          status: 'ACTIVE',
          messageCount: 0,
          postCompletionQuestionCount: 0,
          contextData: {}
        }),
        update: vi.fn().mockResolvedValue({})
      },
      message: {
        create: vi.fn().mockResolvedValue({})
      },
      $transaction: vi.fn().mockImplementation(async (cb) => cb(mockPrisma))
    };

    const mockConfigService: any = {
      getConfig: vi.fn().mockResolvedValue({
        ...DEFAULT_BUSINESS_CONFIG,
        capabilities: { ...DEFAULT_BUSINESS_CONFIG.capabilities, ecommerceEnabled: true }
      })
    };

    const mockAccountConfigService: any = {
      getEffectiveConfig: vi.fn().mockResolvedValue({
        ...DEFAULT_BUSINESS_CONFIG,
        capabilities: { ...DEFAULT_BUSINESS_CONFIG.capabilities, ecommerceEnabled: true }
      })
    };

    const mockConversationService: any = {
      prisma: mockPrisma,
      getOrCreateConversation: vi.fn().mockResolvedValue({
        id: 'conv-1',
        tenantId: 'animeverse',
        customerId: 'cust-1',
        accountId: 'animeverse-store',
        version: 1,
        status: 'ACTIVE',
        messageCount: 0,
        postCompletionQuestionCount: 0,
        contextData: {}
      }),
      getActiveSession: vi.fn().mockResolvedValue(null),
      getRecentMessages: vi.fn().mockResolvedValue([]),
      commitConversationTurn: vi.fn().mockResolvedValue({}),
      getConversationContext: vi.fn().mockResolvedValue({
        effectiveLanguage: 'en',
        memory: null,
        productContext: null
      })
    };

    const mockEcommerceService: any = {
      getProductFact: vi.fn().mockResolvedValue({
        product: { id: 'prod-cyber', sku: 'ANV-001', variants: [] },
        displayName: 'Cyber Spirit Jacket',
        effectivePrice: '599.00',
        currency: 'MAD',
        inStock: true,
        availableStock: 10,
        displayDescription: 'Premium Cyber Jacket'
      })
    };

    const engine = new ConversationEngine(
      mockConversationService,
      mockConfigService,
      {} as any,
      new LLMMockProvider(),
      new ResponseBuilder(),
      undefined,
      undefined,
      undefined,
      mockAccountConfigService,
      mockEcommerceService
    );

    const reply = await engine.handleMessage('animeverse', 'user-123', 'How much is the Cyber Spirit Jacket?', 'animeverse-store');

    expect(reply).toContain('599.00 MAD');
    // AccountConfigService was called once at entry:
    expect(mockAccountConfigService.getEffectiveConfig).toHaveBeenCalledTimes(1);
    // Redundant direct prisma.account.findUnique in ConversationEngine was completely removed:
    expect(accountFindUniqueSpy).toHaveBeenCalledTimes(0);
  });

  it('2. emits RAG telemetry with embeddingCalls, retryAttempts, model, and input size', async () => {
    const mockRAGService: any = {
      retrieve: vi.fn().mockResolvedValue({
        chunks: [
          { id: 'c1', documentId: 'd1', content: 'Standard shipping across Morocco is 30 MAD.', score: 0.85, similarity: 0.85 }
        ],
        context: 'Standard shipping across Morocco is 30 MAD.'
      })
    };

    const mockConfigService: any = {
      getConfig: vi.fn().mockResolvedValue({
        ...DEFAULT_BUSINESS_CONFIG,
        knowledge: {
          ...DEFAULT_BUSINESS_CONFIG.knowledge,
          enabled: true,
          embeddingProvider: 'gemini',
          embeddingModel: 'gemini-embedding-001'
        }
      })
    };

    const mockConversationService: any = {
      getOrCreateConversation: vi.fn().mockResolvedValue({
        id: 'conv-rag-1',
        tenantId: 'tenant-rag',
        customerId: 'cust-1',
        version: 1,
        status: 'ACTIVE',
        messageCount: 0,
        postCompletionQuestionCount: 0,
        contextData: {}
      }),
      getActiveSession: vi.fn().mockResolvedValue(null),
      getRecentMessages: vi.fn().mockResolvedValue([]),
      commitConversationTurn: vi.fn().mockResolvedValue({}),
      getConversationContext: vi.fn().mockResolvedValue({
        effectiveLanguage: 'en',
        memory: null,
        productContext: null
      })
    };

    const engine = new ConversationEngine(
      mockConversationService,
      mockConfigService,
      {} as any,
      new LLMMockProvider(),
      new ResponseBuilder(),
      mockRAGService
    );

    await engine.handleMessage('tenant-rag', 'user-456', 'What is your shipping policy?');

    const ragEvents = emittedEvents.filter(e => e.eventType === 'rag_completed');
    expect(ragEvents.length).toBeGreaterThanOrEqual(1);

    const ragEvent = ragEvents[0];
    expect(ragEvent.metadata?.embeddingCalls).toBe(1);
    expect(ragEvent.metadata?.retryAttempts).toBe(0);
    expect(ragEvent.metadata?.provider).toBe('gemini');
    expect(ragEvent.metadata?.model).toBe('gemini-embedding-001');
    expect(typeof ragEvent.metadata?.inputSizeChars).toBe('number');
  });

  it('3. emits LLM telemetry with inputTokens, outputTokens, retryAttempts, and model info', async () => {
    const mockRAGService: any = {
      retrieve: vi.fn().mockResolvedValue({
        chunks: [
          { id: 'c1', documentId: 'd1', content: 'We offer express delivery on request.', score: 0.60, similarity: 0.60 }
        ],
        context: 'We offer express delivery on request.'
      })
    };

    const mockConfigService: any = {
      getConfig: vi.fn().mockResolvedValue({
        ...DEFAULT_BUSINESS_CONFIG,
        knowledge: {
          ...DEFAULT_BUSINESS_CONFIG.knowledge,
          enabled: true,
          minSimilarityScore: 0.70
        },
        llm: {
          provider: 'deepseek',
          model: 'deepseek-chat',
          temperature: 0.2,
          maxTokens: 500
        }
      })
    };

    const mockConversationService: any = {
      getOrCreateConversation: vi.fn().mockResolvedValue({
        id: 'conv-llm-1',
        tenantId: 'tenant-llm',
        customerId: 'cust-1',
        version: 1,
        status: 'ACTIVE',
        messageCount: 0,
        postCompletionQuestionCount: 0,
        contextData: {}
      }),
      getActiveSession: vi.fn().mockResolvedValue(null),
      getRecentMessages: vi.fn().mockResolvedValue([]),
      commitConversationTurn: vi.fn().mockResolvedValue({}),
      getConversationContext: vi.fn().mockResolvedValue({
        effectiveLanguage: 'en',
        memory: null,
        productContext: null
      })
    };

    const mockLlm: any = {
      generateResponse: vi.fn().mockResolvedValue('Yes, we offer express delivery across all major cities.')
    };

    const factory = new LLMFactory();
    factory.registerProvider('deepseek', 'deepseek-chat', mockLlm);

    const engine = new ConversationEngine(
      mockConversationService,
      mockConfigService,
      {} as any,
      factory,
      new ResponseBuilder(),
      mockRAGService
    );

    await engine.handleMessage('tenant-llm', 'user-789', 'Can I get fast delivery?');

    const llmEvents = emittedEvents.filter(e => e.eventType === 'llm_completed');
    expect(llmEvents.length).toBeGreaterThanOrEqual(1);

    const llmEvent = llmEvents[0];
    expect(llmEvent.provider).toBe('deepseek');
    expect(llmEvent.model).toBe('deepseek-chat');
    expect(typeof llmEvent.metadata?.inputTokens).toBe('number');
    expect(Number(llmEvent.metadata?.inputTokens)).toBeGreaterThan(0);
    expect(typeof llmEvent.metadata?.outputTokens).toBe('number');
    expect(Number(llmEvent.metadata?.outputTokens)).toBeGreaterThan(0);
    expect(llmEvent.metadata?.retryAttempts).toBe(0);
  });

  it('4. zero-cost fast paths (FAQ, Ecommerce, Known Greeting) emit 0 LLM and 0 RAG events', async () => {
    const mockConfigService: any = {
      getConfig: vi.fn().mockResolvedValue({
        ...DEFAULT_BUSINESS_CONFIG,
        capabilities: {
          ...DEFAULT_BUSINESS_CONFIG.capabilities,
          faq: [
            { id: 'faq-ship', question: 'How much is shipping?', answer: 'Shipping is 30 MAD.' }
          ]
        }
      })
    };

    const mockConversationService: any = {
      getOrCreateConversation: vi.fn().mockResolvedValue({
        id: 'conv-faq-1',
        tenantId: 'tenant-faq',
        customerId: 'cust-1',
        version: 1,
        status: 'ACTIVE',
        messageCount: 0,
        postCompletionQuestionCount: 0,
        contextData: {}
      }),
      getActiveSession: vi.fn().mockResolvedValue(null),
      getRecentMessages: vi.fn().mockResolvedValue([]),
      commitConversationTurn: vi.fn().mockResolvedValue({}),
      getConversationContext: vi.fn().mockResolvedValue({
        effectiveLanguage: 'en',
        memory: null,
        productContext: null
      })
    };

    const engine = new ConversationEngine(
      mockConversationService,
      mockConfigService,
      {} as any,
      new LLMMockProvider(),
      new ResponseBuilder()
    );

    // Turn 1: Greeting
    emittedEvents = [];
    const greetReply = await engine.handleMessage('tenant-faq', 'user-1', 'Hello!');
    expect(greetReply).toContain('Hello');
    expect(emittedEvents.filter(e => e.eventType === 'llm_completed' || e.eventType === 'rag_completed').length).toBe(0);

    // Turn 2: FAQ
    emittedEvents = [];
    const faqReply = await engine.handleMessage('tenant-faq', 'user-1', 'How much is shipping?');
    expect(faqReply).toBe('Shipping is 30 MAD.');
    expect(emittedEvents.filter(e => e.eventType === 'llm_completed' || e.eventType === 'rag_completed').length).toBe(0);
  });
});
