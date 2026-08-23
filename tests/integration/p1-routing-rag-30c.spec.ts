import { describe, it, expect, vi } from 'vitest';
import { ConversationEngine } from '../../src/domain/conversation/ConversationEngine';
import { DirectRagGuard } from '../../src/domain/rag/DirectRagGuard';
import { LLMMockProvider } from '../../src/core/llm/LLMProvider';
import { ResponseBuilder } from '../../src/domain/conversation/ResponseBuilder';
import { DEFAULT_BUSINESS_CONFIG, BusinessConfig } from '../../src/domain/tenant/BusinessConfig';
import { EcommerceService } from '../../src/domain/ecommerce/EcommerceService';

describe('Phase 30C: P1 Routing + RAG Contract Tests', () => {
  const mockAnimeConfig: BusinessConfig = {
    ...DEFAULT_BUSINESS_CONFIG,
    capabilities: {
      ...DEFAULT_BUSINESS_CONFIG.capabilities,
      faq: [
        {
          id: 'faq-availability-1',
          question: 'واش كاين التوصيل فالمغرب؟',
          answer: 'نعم التوصيل متوفر في جميع مدن المغرب خلال 24-48 ساعة.',
          category: 'SHIPPING',
          language: 'ar'
        },
        {
          id: 'faq-general-stock',
          question: 'واش كاينين منتجات متوفرة؟',
          answer: 'جميع المنتجات المعروضة في المتجر متوفرة في المخزون.',
          category: 'STORE',
          language: 'ar'
        }
      ],
      ecommerceEnabled: true
    },
    knowledge: {
      ...DEFAULT_BUSINESS_CONFIG.knowledge,
      enabled: true,
      topK: 3,
      minSimilarityScore: 0.70
    }
  };

  describe('1. TurnDecision Precedes Generic FAQ', () => {
    it('1. Generic FAQ does not steal Ecommerce availability ("واش كاين فالأسود؟")', async () => {
      const mockEcommerceService = {
        getProductFact: vi.fn().mockResolvedValue({
          product: { id: 'prod-hoodie-1', name: 'Moon Ninja Hoodie', price: 350, currency: 'MAD', stock: 25 },
          selectedVariant: { id: 'v-blk', color: 'Cyber Black', size: 'M', stock: 10, priceOverride: null },
          effectivePrice: 350,
          currency: 'MAD',
          inStock: true,
          availableStock: 10,
          displayName: 'Moon Ninja Hoodie',
          displayDescription: 'Premium hoodie'
        }),
        searchProducts: vi.fn()
      };

      const mockLlm = new LLMMockProvider();
      const engine = new ConversationEngine(
        {
          getOrCreateConversation: async () => ({
            id: 'conv-ecom-faq-1',
            tenantId: 'animeverse',
            accountId: 'animeverse-store',
            customerId: 'cust-1',
            messageCount: 1,
            version: 1,
            contextData: {
              productContext: {
                selectedProductId: 'prod-hoodie-1',
                selectedSku: 'MNH-01',
                selectedColor: null,
                selectedSize: null
              }
            },
            status: 'ACTIVE'
          }),
          getRecentMessages: async () => [],
          getActiveSession: async () => null,
          commitConversationTurn: async () => {}
        } as any,
        {
          getConfig: async () => mockAnimeConfig
        } as any,
        {
          process: async () => ({ response: 'workflow response' })
        } as any,
        mockLlm,
        new ResponseBuilder(),
        undefined,
        undefined,
        undefined,
        undefined,
        mockEcommerceService as any
      );

      const response = await engine.handleMessage('animeverse', 'cust-1', 'واش كاين فالأسود؟', 'animeverse-store');

      expect(mockEcommerceService.getProductFact).toHaveBeenCalled();
      expect(response).not.toContain('جميع المنتجات المعروضة في المتجر متوفرة');
      expect(response).toContain('Moon Ninja Hoodie');
    });

    it('2. Generic FAQ does not steal Ecommerce price ("شحال الثمن ديالو؟")', async () => {
      const mockEcommerceService = {
        getProductFact: vi.fn().mockResolvedValue({
          product: { id: 'prod-hoodie-1', name: 'Moon Ninja Hoodie', price: 350, currency: 'MAD', stock: 25 },
          selectedVariant: null,
          effectivePrice: 350,
          currency: 'MAD',
          inStock: true,
          availableStock: 25,
          displayName: 'Moon Ninja Hoodie',
          displayDescription: 'Premium hoodie'
        }),
        searchProducts: vi.fn()
      };

      const mockLlm = new LLMMockProvider();
      const engine = new ConversationEngine(
        {
          getOrCreateConversation: async () => ({
            id: 'conv-ecom-faq-2',
            tenantId: 'animeverse',
            accountId: 'animeverse-store',
            customerId: 'cust-1',
            messageCount: 1,
            version: 1,
            contextData: {
              productContext: {
                selectedProductId: 'prod-hoodie-1'
              }
            },
            status: 'ACTIVE'
          }),
          getRecentMessages: async () => [],
          getActiveSession: async () => null,
          commitConversationTurn: async () => {}
        } as any,
        {
          getConfig: async () => mockAnimeConfig
        } as any,
        {
          process: async () => ({ response: 'workflow response' })
        } as any,
        mockLlm,
        new ResponseBuilder(),
        undefined,
        undefined,
        undefined,
        undefined,
        mockEcommerceService as any
      );

      const response = await engine.handleMessage('animeverse', 'cust-1', 'شحال الثمن ديالو؟', 'animeverse-store');

      expect(mockEcommerceService.getProductFact).toHaveBeenCalled();
      expect(response).toContain('350');
    });

    it('3. Generic FAQ does not steal Ecommerce variant query ("wach kayn f M?")', async () => {
      const mockEcommerceService = {
        getProductFact: vi.fn().mockResolvedValue({
          product: { id: 'prod-hoodie-1', name: 'Moon Ninja Hoodie', price: 350, currency: 'MAD', stock: 25 },
          selectedVariant: { id: 'v-m', size: 'M', stock: 5, priceOverride: null },
          effectivePrice: 350,
          currency: 'MAD',
          inStock: true,
          availableStock: 5,
          displayName: 'Moon Ninja Hoodie',
          displayDescription: 'Premium hoodie'
        }),
        searchProducts: vi.fn()
      };

      const mockLlm = new LLMMockProvider();
      const engine = new ConversationEngine(
        {
          getOrCreateConversation: async () => ({
            id: 'conv-ecom-faq-3',
            tenantId: 'animeverse',
            accountId: 'animeverse-store',
            customerId: 'cust-1',
            messageCount: 1,
            version: 1,
            contextData: {
              productContext: {
                selectedProductId: 'prod-hoodie-1'
              }
            },
            status: 'ACTIVE'
          }),
          getRecentMessages: async () => [],
          getActiveSession: async () => null,
          commitConversationTurn: async () => {}
        } as any,
        {
          getConfig: async () => mockAnimeConfig
        } as any,
        {
          process: async () => ({ response: 'workflow response' })
        } as any,
        mockLlm,
        new ResponseBuilder(),
        undefined,
        undefined,
        undefined,
        undefined,
        mockEcommerceService as any
      );

      const response = await engine.handleMessage('animeverse', 'cust-1', 'wach kayn f M?', 'animeverse-store');

      expect(mockEcommerceService.getProductFact).toHaveBeenCalled();
      expect(response).toContain('Moon Ninja Hoodie');
    });
  });

  describe('2. Raw RAG Language & Script Contract', () => {
    it('4. English RAG + Darija Arabic input → rejects raw English chunk (SCRIPT/LANG MISMATCH)', () => {
      const englishChunk = 'Machine wash cold inside out with like colors. Tumble dry low or air dry to prevent shrinkage.';
      const res = DirectRagGuard.evaluate('كيفاش نغسل الهودي؟', englishChunk, 'darija', 'arabic');

      expect(res.isSafe).toBe(false);
      expect(['LANGUAGE_MISMATCH', 'SCRIPT_MISMATCH']).toContain(res.reason);
    });

    it('5. English RAG + Darija Arabizi input → rejects raw English chunk', () => {
      const englishChunk = 'Standard shipping takes 24-48 hours across Morocco and costs 30 MAD.';
      const res = DirectRagGuard.evaluate('kifach nghsel l hoodie?', englishChunk, 'darija', 'arabizi');

      expect(res.isSafe).toBe(false);
      expect(res.reason).toBe('LANGUAGE_MISMATCH');
    });

    it('6. English RAG + English input → direct answer allowed', () => {
      const englishChunk = 'Standard shipping takes 24-48 hours across Morocco and costs 30 MAD.';
      const res = DirectRagGuard.evaluate('What are the shipping times and cost in Morocco?', englishChunk, 'en', 'latin');

      expect(res.isSafe).toBe(true);
      expect(res.reason).toBe('SAFE');
    });

    it('7. Arabic RAG + Arabic input → direct answer allowed', () => {
      const arabicChunk = 'التوصيل العادي يستغرق من 24 إلى 48 ساعة في جميع أنحاء المغرب بتكلفة 30 درهم.';
      const res = DirectRagGuard.evaluate('ما هي مدة وتكلفة التوصيل في المغرب؟', arabicChunk, 'ar', 'arabic');

      expect(res.isSafe).toBe(true);
      expect(res.reason).toBe('SAFE');
    });
  });

  describe('3. Multi-Policy Completeness & Budget', () => {
    it('8. Multi-policy returns all requested policy topics when evidence exists', async () => {
      const mockChunks = [
        { id: 'c1', content: 'Returns policy: Items can be returned within 14 days in original condition.', similarity: 0.88 },
        { id: 'c2', content: 'Shipping policy: Standard delivery takes 24-48 hours across Morocco for 30 MAD.', similarity: 0.85 },
        { id: 'c3', content: 'Care guide: Machine wash cold inside out and hang dry.', similarity: 0.82 }
      ];

      const mockRagService = {
        retrieve: vi.fn().mockResolvedValue({ chunks: mockChunks })
      };

      const mockLlm = new LLMMockProvider();
      let generatedPrompt = '';
      mockLlm.generateResponse = vi.fn().mockImplementation(async (sys, msgs) => {
        generatedPrompt = msgs[0].content;
        return 'Detailed answer covering returns, shipping, and care instructions.';
      });

      const engine = new ConversationEngine(
        {
          getOrCreateConversation: async () => ({
            id: 'conv-multi-1',
            tenantId: 'animeverse',
            accountId: 'animeverse-store',
            customerId: 'cust-1',
            messageCount: 0,
            version: 1,
            contextData: {},
            status: 'ACTIVE'
          }),
          getRecentMessages: async () => [],
          getActiveSession: async () => null,
          commitConversationTurn: async () => {}
        } as any,
        {
          getConfig: async () => mockAnimeConfig
        } as any,
        {
          process: async () => ({ response: 'workflow response' })
        } as any,
        mockLlm,
        new ResponseBuilder(),
        mockRagService as any
      );

      const multiQuery = 'Moon Ninja Hoodie, واش نقدر نرجعو، شحال التوصيل، وكيفاش نغسلو؟';
      const response = await engine.handleMessage('animeverse', 'cust-1', multiQuery, 'animeverse-store');

      expect(mockRagService.retrieve).toHaveBeenCalled();
      expect(generatedPrompt).toContain('Returns policy');
      expect(generatedPrompt).toContain('Shipping policy');
      expect(generatedPrompt).toContain('Care guide');
      expect(response).toBe('Detailed answer covering returns, shipping, and care instructions.');
    });

    it('9. Multi-policy uses max 4 relevant chunks (does not drop 4th chunk)', async () => {
      const mockChunks = [
        { id: 'c1', content: 'Chunk 1: Returns policy details', similarity: 0.90 },
        { id: 'c2', content: 'Chunk 2: Shipping policy details', similarity: 0.85 },
        { id: 'c3', content: 'Chunk 3: Care washing instructions', similarity: 0.80 },
        { id: 'c4', content: 'Chunk 4: Warranty policy terms', similarity: 0.75 }
      ];

      const mockRagService = {
        retrieve: vi.fn().mockResolvedValue({ chunks: mockChunks })
      };

      const mockLlm = new LLMMockProvider();
      let capturedContext = '';
      mockLlm.generateResponse = vi.fn().mockImplementation(async (sys, msgs) => {
        capturedContext = msgs[0].content;
        return 'Multi-policy synthesized response.';
      });

      const engine = new ConversationEngine(
        {
          getOrCreateConversation: async () => ({
            id: 'conv-multi-2',
            tenantId: 'animeverse',
            accountId: 'animeverse-store',
            customerId: 'cust-1',
            messageCount: 0,
            version: 1,
            contextData: {},
            status: 'ACTIVE'
          }),
          getRecentMessages: async () => [],
          getActiveSession: async () => null,
          commitConversationTurn: async () => {}
        } as any,
        {
          getConfig: async () => mockAnimeConfig
        } as any,
        {
          process: async () => ({ response: 'workflow response' })
        } as any,
        mockLlm,
        new ResponseBuilder(),
        mockRagService as any
      );

      const multiQuery = 'واش كاين استرجاع، شحال الشحن، وكيفاش نغسلو؟';
      await engine.handleMessage('animeverse', 'cust-1', multiQuery, 'animeverse-store');

      expect(capturedContext).toContain('Chunk 1: Returns');
      expect(capturedContext).toContain('Chunk 2: Shipping');
      expect(capturedContext).toContain('Chunk 3: Care');
      expect(capturedContext).toContain('Chunk 4: Warranty');
    });

    it('10. Single-policy remains max 3 chunks', async () => {
      const mockChunks = [
        { id: 'c1', content: 'Chunk 1: Return window is 14 days.', similarity: 0.90 },
        { id: 'c2', content: 'Chunk 2: Return shipping is covered.', similarity: 0.85 },
        { id: 'c3', content: 'Chunk 3: Return refund method.', similarity: 0.80 },
        { id: 'c4', content: 'Chunk 4: Irrelevant 4th chunk.', similarity: 0.75 }
      ];

      const mockRagService = {
        retrieve: vi.fn().mockResolvedValue({ chunks: mockChunks })
      };

      const mockLlm = new LLMMockProvider();
      let capturedContext = '';
      mockLlm.generateResponse = vi.fn().mockImplementation(async (sys, msgs) => {
        capturedContext = msgs[0].content;
        return 'Single policy response.';
      });

      const engine = new ConversationEngine(
        {
          getOrCreateConversation: async () => ({
            id: 'conv-single-1',
            tenantId: 'animeverse',
            accountId: 'animeverse-store',
            customerId: 'cust-1',
            messageCount: 0,
            version: 1,
            contextData: {},
            status: 'ACTIVE'
          }),
          getRecentMessages: async () => [],
          getActiveSession: async () => null,
          commitConversationTurn: async () => {}
        } as any,
        {
          getConfig: async () => mockAnimeConfig
        } as any,
        {
          process: async () => ({ response: 'workflow response' })
        } as any,
        mockLlm,
        new ResponseBuilder(),
        mockRagService as any
      );

      const singleQuery = 'شنو هي سياسة الاسترجاع؟';
      await engine.handleMessage('animeverse', 'cust-1', singleQuery, 'animeverse-store');

      expect(capturedContext).toContain('Chunk 1');
      expect(capturedContext).toContain('Chunk 2');
      expect(capturedContext).toContain('Chunk 3');
      expect(capturedContext).not.toContain('Chunk 4');
    });

    it('11. No cross-account knowledge retrieval (account-scoped retrieval passes accountId)', async () => {
      const mockRagService = {
        retrieve: vi.fn().mockResolvedValue({ chunks: [] })
      };

      const mockLlm = new LLMMockProvider();
      const engine = new ConversationEngine(
        {
          getOrCreateConversation: async () => ({
            id: 'conv-account-1',
            tenantId: 'animeverse',
            accountId: 'animeverse-store',
            customerId: 'cust-1',
            messageCount: 0,
            version: 1,
            contextData: {},
            status: 'ACTIVE'
          }),
          getRecentMessages: async () => [],
          getActiveSession: async () => null,
          commitConversationTurn: async () => {}
        } as any,
        {
          getConfig: async () => mockAnimeConfig
        } as any,
        {
          process: async () => ({ response: 'workflow response' })
        } as any,
        mockLlm,
        new ResponseBuilder(),
        mockRagService as any
      );

      await engine.handleMessage('animeverse', 'cust-1', 'What is your shipping policy?', 'animeverse-store');

      expect(mockRagService.retrieve).toHaveBeenCalledWith(
        'animeverse',
        expect.any(String),
        expect.any(Object),
        'animeverse-store'
      );
    });

    it('12. Normal Ecommerce behavior remains unchanged', async () => {
      const mockProduct = {
        id: 'prod-hoodie-1',
        name: 'Moon Ninja Hoodie',
        price: 350,
        currency: 'MAD',
        stock: 25,
        variants: []
      };

      const mockRepo = {
        findById: vi.fn().mockResolvedValue(null),
        findBySku: vi.fn().mockResolvedValue(null),
        findByName: vi.fn().mockResolvedValue(mockProduct),
        search: vi.fn().mockResolvedValue([mockProduct])
      };

      const service = new EcommerceService(mockRepo as any);
      const fact = await service.getProductFact(
        'animeverse',
        'animeverse-store',
        { name: 'Moon Ninja Hoodie' }
      );

      expect(fact).toBeDefined();
      expect(fact?.effectivePrice).toBe(350);
      expect(fact?.inStock).toBe(true);
    });
  });
});
