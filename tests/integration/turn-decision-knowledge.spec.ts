import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TurnDecisionResolver } from '../../src/domain/conversation/TurnDecision';
import { ProductContext } from '../../src/domain/conversation/ConversationContext';
import { ConversationEngine } from '../../src/domain/conversation/ConversationEngine';
import { BusinessConfig } from '../../src/domain/types';

describe('Phase 26D: Authoritative Turn Decision for Knowledge / RAG Tests', () => {
  it('1. Care inquiry resolves to KNOWLEDGE domain with CARE intent and RAG source', () => {
    const decision = TurnDecisionResolver.resolve({
      text: 'kifach nghsel l hoodie?'
    });

    expect(decision.domain).toBe('KNOWLEDGE');
    expect(decision.intent).toBe('CARE');
    expect(decision.source).toBe('RAG');
    expect(decision.productId).toBeNull();
  });

  it('2. Returns inquiry resolves to KNOWLEDGE domain with RETURNS intent and RAG source', () => {
    const decision = TurnDecisionResolver.resolve({
      text: 'شنو هي سياسة الإرجاع ديالكم؟'
    });

    expect(decision.domain).toBe('KNOWLEDGE');
    expect(decision.intent).toBe('RETURNS');
    expect(decision.source).toBe('RAG');
    expect(decision.productId).toBeNull();
  });

  it('3. Shipping inquiry resolves to KNOWLEDGE domain with SHIPPING intent and RAG source', () => {
    const decision = TurnDecisionResolver.resolve({
      text: 'شحال التوصيل للمغرب؟'
    });

    expect(decision.domain).toBe('KNOWLEDGE');
    expect(decision.intent).toBe('SHIPPING');
    expect(decision.source).toBe('RAG');
    expect(decision.productId).toBeNull();
  });

  it('4. Tracking inquiry resolves to KNOWLEDGE domain with TRACKING intent and RAG source', () => {
    const decision = TurnDecisionResolver.resolve({
      text: 'كيفاش نتبع الطلب ديالي فين وصل؟'
    });

    expect(decision.domain).toBe('KNOWLEDGE');
    expect(decision.intent).toBe('TRACKING');
    expect(decision.source).toBe('RAG');
    expect(decision.productId).toBeNull();
  });

  it('5. Product mention + Returns inquiry resolves to KNOWLEDGE domain with RETURNS intent and HYBRID source', () => {
    const decision = TurnDecisionResolver.resolve({
      text: 'شنو هي سياسة الإرجاع ديال Cyber Spirit Jacket؟'
    });

    expect(decision.domain).toBe('KNOWLEDGE');
    expect(decision.intent).toBe('RETURNS');
    expect(decision.source).toBe('HYBRID');
    expect(decision.productName?.toLowerCase()).toContain('cyber spirit jacket');
  });

  it('6. Product mention + Care inquiry resolves to KNOWLEDGE domain with CARE intent and HYBRID source', () => {
    const decision = TurnDecisionResolver.resolve({
      text: 'كيفاش نعتني بتيشيرت Neon Ronin؟'
    });

    expect(decision.domain).toBe('KNOWLEDGE');
    expect(decision.intent).toBe('CARE');
    expect(decision.source).toBe('HYBRID');
    expect(decision.productName?.toLowerCase()).toContain('neon ronin');
  });

  it('7. Product mention + Shipping inquiry resolves to KNOWLEDGE domain with SHIPPING intent and HYBRID source', () => {
    const decision = TurnDecisionResolver.resolve({
      text: 'شحال ثمن التوصيل ديال Capuchon Moon Ninja؟'
    });

    expect(decision.domain).toBe('KNOWLEDGE');
    expect(decision.intent).toBe('SHIPPING');
    expect(decision.source).toBe('HYBRID');
    expect(decision.productName?.toLowerCase()).toContain('moon ninja');
  });

  it('8. Missing knowledge returns localized fallback without falling through to Ecommerce', async () => {
    const mockRagService: any = {
      retrieve: vi.fn().mockResolvedValue({ chunks: [] })
    };

    const mockEcommerceService: any = {
      searchProducts: vi.fn().mockResolvedValue([]),
      getProductFact: vi.fn()
    };

    const mockConversationService: any = {
      getOrCreateConversation: vi.fn().mockResolvedValue({
        id: 'c1', tenantId: 't1', accountId: 'acc1', contextData: {}
      }),
      getActiveSession: vi.fn().mockResolvedValue(null),
      getRecentMessages: vi.fn().mockResolvedValue([]),
      appendMessage: vi.fn().mockResolvedValue({ id: 'm1' }),
      commitConversationTurn: vi.fn().mockResolvedValue(undefined)
    };

    const mockLlm: any = {
      generateResponse: vi.fn().mockResolvedValue('UNANSWERABLE')
    };

    const config: BusinessConfig = {
      businessName: 'AnimeVerse',
      capabilities: { ecommerceEnabled: true },
      knowledge: { enabled: true },
      prompts: {
        fallback: {
          fr: 'Désolé, je ne dispose pas de cette information.',
          ar: 'عذراً، لا تتوفر لدي هذه المعلومة حالياً.',
          darija: 'سمح ليا، ما عنديش هاد المعلومة حالياً.'
        }
      }
    };

    const mockWorkflowEngine: any = {
      handleUserMessage: vi.fn().mockResolvedValue({ handled: false })
    };
    const mockConfigService: any = {
      getConfig: vi.fn().mockResolvedValue(config)
    };
    const mockAccountConfigService: any = {
      getEffectiveConfig: vi.fn().mockResolvedValue(config)
    };

    const engine = new ConversationEngine(
      mockConversationService,
      mockConfigService,
      mockWorkflowEngine,
      mockLlm,
      {} as any,
      mockRagService,
      undefined,
      undefined,
      mockAccountConfigService,
      mockEcommerceService
    );

    const result = await engine.handleMessage(
      't1',
      'user1',
      'واش عندكم فرع فكندا؟',
      config,
      'acc1'
    );

    expect(mockRagService.retrieve).toHaveBeenCalled();
    expect(mockEcommerceService.searchProducts).not.toHaveBeenCalled();
    expect(result).toContain('سمح ليا، ما عنديش هاد المعلومة');
  });

  it('9. English PDF + Darija user resolves Darija output metadata and script', () => {
    const decision = TurnDecisionResolver.resolve({
      text: 'kifach tewsil f rabat?'
    });

    expect(decision.domain).toBe('KNOWLEDGE');
    expect(decision.responseLanguage).toBe('darija');
    expect(decision.responseScript).toBe('arabizi');
  });

  it('10. English PDF + Arabic-script user resolves Arabic-script output metadata', () => {
    const decision = TurnDecisionResolver.resolve({
      text: 'كيفاش كيوصل لمدينة الرباط؟'
    });

    expect(decision.domain).toBe('KNOWLEDGE');
    expect(decision.responseLanguage).toMatch(/^(?:ar|darija)$/);
    expect(decision.responseScript).toBe('arabic');
  });

  it('11. Knowledge turn cannot fall through to Ecommerce search', async () => {
    const mockRagService: any = {
      retrieve: vi.fn().mockResolvedValue({
        chunks: [{ content: 'Standard shipping in Morocco takes 2-4 business days.', similarity: 0.88 }]
      })
    };

    const mockEcommerceService: any = {
      searchProducts: vi.fn(),
      getProductFact: vi.fn()
    };

    const mockConversationService: any = {
      getOrCreateConversation: vi.fn().mockResolvedValue({
        id: 'c1', tenantId: 't1', accountId: 'acc1', contextData: {}
      }),
      getActiveSession: vi.fn().mockResolvedValue(null),
      getRecentMessages: vi.fn().mockResolvedValue([]),
      appendMessage: vi.fn().mockResolvedValue({ id: 'm1' }),
      commitConversationTurn: vi.fn().mockResolvedValue(undefined)
    };

    const config: BusinessConfig = {
      businessName: 'AnimeVerse',
      capabilities: { ecommerceEnabled: true },
      knowledge: { enabled: true }
    };

    const mockWorkflowEngine: any = {
      handleUserMessage: vi.fn().mockResolvedValue({ handled: false })
    };
    const mockConfigService: any = {
      getConfig: vi.fn().mockResolvedValue(config)
    };
    const mockAccountConfigService: any = {
      getEffectiveConfig: vi.fn().mockResolvedValue(config)
    };

    const engine = new ConversationEngine(
      mockConversationService,
      mockConfigService,
      mockWorkflowEngine,
      { generateResponse: vi.fn() } as any,
      {} as any,
      mockRagService,
      undefined,
      undefined,
      mockAccountConfigService,
      mockEcommerceService
    );

    const result = await engine.handleMessage(
      't1',
      'user1',
      'How long does shipping take?',
      config,
      'acc1'
    );

    expect(mockRagService.retrieve).toHaveBeenCalled();
    expect(mockEcommerceService.searchProducts).not.toHaveBeenCalled();
    expect(result).toContain('Standard shipping in Morocco takes 2-4 business days.');
  });

  it('12. Hybrid turn uses product DB + RAG and synthesizes with Grounded LLM', async () => {
    const mockProductFact = {
      product: { id: 'prod-jacket-1', title: 'Cyber Spirit Jacket', sku: 'CYBER-JKT', price: '450.00', currency: 'MAD', stock: 10 },
      displayName: 'Cyber Spirit Jacket',
      effectivePrice: '450.00',
      currency: 'MAD',
      inStock: true,
      availableStock: 10,
      displayDescription: 'Premium anime cyberpunk jacket'
    };

    const mockRagService: any = {
      retrieve: vi.fn().mockResolvedValue({
        chunks: [{ content: 'You can return jackets within 14 days of delivery in unworn condition.', similarity: 0.85 }]
      })
    };

    const mockEcommerceService: any = {
      getProductFact: vi.fn().mockResolvedValue(mockProductFact),
      searchProducts: vi.fn()
    };

    const mockLlm: any = {
      generateResponse: vi.fn().mockResolvedValue('Pour la Cyber Spirit Jacket, vous pouvez la retourner sous 14 jours si elle est non portée.')
    };

    const mockConversationService: any = {
      getOrCreateConversation: vi.fn().mockResolvedValue({
        id: 'c1', tenantId: 't1', accountId: 'acc1', contextData: {}
      }),
      getActiveSession: vi.fn().mockResolvedValue(null),
      getRecentMessages: vi.fn().mockResolvedValue([]),
      appendMessage: vi.fn().mockResolvedValue({ id: 'm1' }),
      commitConversationTurn: vi.fn().mockResolvedValue(undefined)
    };

    const config: BusinessConfig = {
      businessName: 'AnimeVerse',
      capabilities: { ecommerceEnabled: true },
      knowledge: { enabled: true },
      llm: { provider: 'gemini', model: 'mock-gemini' }
    };

    const mockWorkflowEngine: any = {
      handleUserMessage: vi.fn().mockResolvedValue({ handled: false })
    };
    const mockConfigService: any = {
      getConfig: vi.fn().mockResolvedValue(config)
    };
    const mockAccountConfigService: any = {
      getEffectiveConfig: vi.fn().mockResolvedValue(config)
    };

    const engine = new ConversationEngine(
      mockConversationService,
      mockConfigService,
      mockWorkflowEngine,
      mockLlm,
      {} as any,
      mockRagService,
      undefined,
      undefined,
      mockAccountConfigService,
      mockEcommerceService
    );

    const result = await engine.handleMessage(
      't1',
      'user1',
      'Quelle est la politique de retour pour Cyber Spirit Jacket ?',
      config,
      'acc1'
    );

    expect(mockEcommerceService.getProductFact).toHaveBeenCalled();
    expect(mockRagService.retrieve).toHaveBeenCalled();
    expect(mockLlm.generateResponse).toHaveBeenCalled();
    expect(result).toContain('Cyber Spirit Jacket');
  });
});
