import { describe, it, expect, vi } from 'vitest';
import { ConversationEngine } from '../../src/domain/conversation/ConversationEngine';
import { AnswerComposer } from '../../src/domain/conversation/AnswerComposer';
import { ConversationService } from '../../src/domain/conversation/ConversationService';
import { ResponseBuilder } from '../../src/domain/conversation/ResponseBuilder';
import { LLMMockProvider } from '../../src/core/llm/LLMProvider';
import { DEFAULT_BUSINESS_CONFIG, BusinessConfig } from '../../src/domain/tenant/BusinessConfig';
import { EcommerceService } from '../../src/domain/ecommerce/EcommerceService';

describe('Phase 30D: Final Response + Concurrency Contract Tests', () => {
  const mockAnimeConfig: BusinessConfig = {
    ...DEFAULT_BUSINESS_CONFIG,
    capabilities: {
      ...DEFAULT_BUSINESS_CONFIG.capabilities,
      ecommerceEnabled: true
    },
    limits: {
      ...DEFAULT_BUSINESS_CONFIG.limits,
      maxResponseLength: 120
    }
  };

  const sampleProductFact = {
    product: {
      id: 'prod-cyber-1',
      name: 'Cyber Spirit Hoodie',
      price: 350,
      currency: 'MAD',
      stock: 15,
      variants: [
        { id: 'v-blk-m', color: 'Black', size: 'M', stock: 5, priceOverride: null },
        { id: 'v-wht-l', color: 'White', size: 'L', stock: 10, priceOverride: null }
      ]
    },
    selectedVariant: { id: 'v-blk-m', color: 'Black', size: 'M', stock: 5, priceOverride: null },
    effectivePrice: 350,
    currency: 'MAD',
    inStock: true,
    availableStock: 5,
    displayName: 'Cyber Spirit Hoodie',
    displayDescription: 'Premium heavyweight anime hoodie.'
  };

  describe('1. Single Ecommerce Response Composition Path & Script Invariants', () => {
    it('1. Ecommerce Arabic output follows Arabic script', () => {
      const response = AnswerComposer.composeEcommerce({
        turnDecision: {
          domain: 'ECOMMERCE',
          intent: 'AVAILABILITY',
          productName: 'Cyber Spirit Hoodie',
          responseLanguage: 'ar',
          responseScript: 'arabic',
          confidence: 0.95
        },
        productFacts: sampleProductFact,
        responseLanguage: 'ar',
        responseScript: 'arabic',
        config: mockAnimeConfig
      });

      expect(response).toContain('Cyber Spirit Hoodie');
      expect(response).toContain('متوفر');
      expect(response).toContain('350');
      expect(/[\u0600-\u06FF]/.test(response)).toBe(true);
    });

    it('2. Ecommerce Arabizi output stays Arabizi', () => {
      const response = AnswerComposer.composeEcommerce({
        turnDecision: {
          domain: 'ECOMMERCE',
          intent: 'PRICE',
          productName: 'Cyber Spirit Hoodie',
          responseLanguage: 'darija',
          responseScript: 'arabizi',
          confidence: 0.95
        },
        productFacts: sampleProductFact,
        responseLanguage: 'darija',
        responseScript: 'arabizi',
        config: mockAnimeConfig
      });

      expect(response).toContain('Cyber Spirit Hoodie');
      expect(response).toContain('Taman dyal');
      expect(response).toContain('350 MAD');
      expect(/[\u0600-\u06FF]/.test(response)).toBe(false);
    });

    it('3. Ecommerce English output stays English', () => {
      const response = AnswerComposer.composeEcommerce({
        turnDecision: {
          domain: 'ECOMMERCE',
          intent: 'AVAILABILITY',
          productName: 'Cyber Spirit Hoodie',
          responseLanguage: 'en',
          responseScript: 'latin',
          confidence: 0.95
        },
        productFacts: sampleProductFact,
        responseLanguage: 'en',
        responseScript: 'latin',
        config: mockAnimeConfig
      });

      expect(response).toContain('Cyber Spirit Hoodie is available for 350 MAD. (In stock: 5)');
    });

    it('4. Ecommerce French output stays French', () => {
      const response = AnswerComposer.composeEcommerce({
        turnDecision: {
          domain: 'ECOMMERCE',
          intent: 'PRICE',
          productName: 'Cyber Spirit Hoodie',
          responseLanguage: 'fr',
          responseScript: 'latin',
          confidence: 0.95
        },
        productFacts: sampleProductFact,
        responseLanguage: 'fr',
        responseScript: 'latin',
        config: mockAnimeConfig
      });

      expect(response).toContain('Le prix de Cyber Spirit Hoodie est de 350 MAD.');
    });

    it('5. All Ecommerce answers use AnswerComposer path via ConversationEngine', async () => {
      const spyCompose = vi.spyOn(AnswerComposer, 'composeEcommerce');
      const mockEcommerceService = {
        getProductFact: vi.fn().mockResolvedValue(sampleProductFact)
      };

      const mockLlm = new LLMMockProvider();
      const engine = new ConversationEngine(
        {
          getOrCreateConversation: async () => ({
            id: 'conv-ecom-composer',
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
          process: async () => ({ response: 'workflow' })
        } as any,
        mockLlm,
        new ResponseBuilder(),
        undefined,
        undefined,
        undefined,
        undefined,
        mockEcommerceService as any
      );

      const res = await engine.handleMessage('animeverse', 'cust-1', 'How much is Cyber Spirit Hoodie?', 'animeverse-store');

      expect(spyCompose).toHaveBeenCalled();
      expect(res).toContain('Cyber Spirit Hoodie');
      expect(res).toContain('350');
      spyCompose.mockRestore();
    });
  });

  describe('2. Optimistic Concurrency Retry & Safety', () => {
    it('6. Concurrent commit conflict retries successfully', async () => {
      let attempts = 0;
      const mockPrisma = {
        $transaction: vi.fn().mockImplementation(async (callback) => {
          attempts++;
          const tx = {
            conversation: {
              updateMany: vi.fn().mockImplementation(async ({ where }) => {
                // First attempt fails due to stale version 1
                if (attempts === 1) {
                  return { count: 0 };
                }
                // Second attempt succeeds with fresh version 2
                return { count: 1 };
              })
            },
            message: {
              create: vi.fn().mockResolvedValue({ id: 'msg-1' })
            },
            workflowSession: {
              update: vi.fn().mockResolvedValue({})
            }
          };
          return callback(tx);
        }),
        conversation: {
          findUnique: vi.fn().mockResolvedValue({ version: 2 })
        }
      };

      const service = new ConversationService(mockPrisma as any);
      const result = await service.commitConversationTurn({
        tenantId: 'animeverse',
        conversationId: 'conv-1',
        expectedVersion: 1,
        userMessage: 'Test user message',
        assistantMessage: 'Test assistant message'
      });

      expect(attempts).toBe(2);
      expect(result.success).toBe(true);
      expect(mockPrisma.conversation.findUnique).toHaveBeenCalledWith({
        where: { id: 'conv-1' },
        select: { version: true }
      });
    });

    it('7. No duplicate turn after retry', async () => {
      let messageCreateCount = 0;
      let attempts = 0;
      const mockPrisma = {
        $transaction: vi.fn().mockImplementation(async (callback) => {
          attempts++;
          const tx = {
            conversation: {
              updateMany: vi.fn().mockImplementation(async () => {
                if (attempts === 1) return { count: 0 };
                return { count: 1 };
              })
            },
            message: {
              create: vi.fn().mockImplementation(async () => {
                messageCreateCount++;
                return { id: `msg-${messageCreateCount}` };
              })
            }
          };
          return callback(tx);
        }),
        conversation: {
          findUnique: vi.fn().mockResolvedValue({ version: 2 })
        }
      };

      const service = new ConversationService(mockPrisma as any);
      await service.commitConversationTurn({
        tenantId: 'animeverse',
        conversationId: 'conv-1',
        expectedVersion: 1,
        userMessage: 'User message',
        assistantMessage: 'Assistant response'
      });

      // 1 user message + 1 assistant message committed only on the successful second attempt
      expect(messageCreateCount).toBe(2);
    });

    it('8. No raw CONCURRENCY_CONFLICT reaches customer when retries exhaust', async () => {
      const mockPrisma = {
        $transaction: vi.fn().mockImplementation(async (callback) => {
          const tx = {
            conversation: {
              updateMany: vi.fn().mockResolvedValue({ count: 0 })
            }
          };
          return callback(tx);
        }),
        conversation: {
          findUnique: vi.fn().mockResolvedValue({ version: 10 })
        }
      };

      const service = new ConversationService(mockPrisma as any);
      let errorThrown: any;
      try {
        await service.commitConversationTurn({
          tenantId: 'animeverse',
          conversationId: 'conv-1',
          expectedVersion: 1,
          userMessage: 'Test user message'
        });
      } catch (err: any) {
        errorThrown = err;
      }

      expect(errorThrown).toBeDefined();
      expect(errorThrown.message).toContain('Concurrency Conflict');
    });
  });

  describe('3. Safe Response Length & Boundary Truncation', () => {
    const mockEngine = new ConversationEngine(
      {} as any,
      {} as any,
      {} as any,
      new LLMMockProvider(),
      new ResponseBuilder()
    );

    it('9. English response truncates safely at sentence boundary without word breaking', () => {
      const text = 'First sentence is clear and concise. Second sentence gives additional details about the order. Third sentence exceeds the limit.';
      const truncated = (mockEngine as any).applyResponseLimit(text, 100);

      expect(truncated).toBe('First sentence is clear and concise. Second sentence gives additional details about the order.');
      expect(truncated.length).toBeLessThanOrEqual(100);
      expect(truncated.endsWith('.')).toBe(true);
    });

    it('10. Arabic response truncates safely at sentence boundary without word breaking', () => {
      const text = 'التوصيل متوفر في جميع مدن المغرب. يستغرق التوصيل من 24 إلى 48 ساعة فقط. الثمن هو 30 درهم مغربي.';
      const truncated = (mockEngine as any).applyResponseLimit(text, 75);

      expect(truncated).toBe('التوصيل متوفر في جميع مدن المغرب. يستغرق التوصيل من 24 إلى 48 ساعة فقط.');
      expect(truncated.length).toBeLessThanOrEqual(75);
      expect(truncated.endsWith('.')).toBe(true);
    });

    it('11. Darija Arabic response truncates safely at sentence boundary', () => {
      const text = 'السلعة كتوصل في 24 ساعة لجميع المدن. الثمن هو 350 درهم والتوصيل فابور فهاد العرض. كاينين خيارات أخرى.';
      const truncated = (mockEngine as any).applyResponseLimit(text, 85);

      expect(truncated).toBe('السلعة كتوصل في 24 ساعة لجميع المدن. الثمن هو 350 درهم والتوصيل فابور فهاد العرض.');
      expect(truncated.length).toBeLessThanOrEqual(85);
      expect(truncated.endsWith('.')).toBe(true);
    });

    it('12. Arabizi response truncates safely at word/sentence boundary', () => {
      const text = 'Livraison kayna f ga3 l-mowdon dyal l-maghrib. Katakhod bin 24 w 48 sa3a. Taman howa 30 MAD.';
      const truncated = (mockEngine as any).applyResponseLimit(text, 75);

      expect(truncated).toBe('Livraison kayna f ga3 l-mowdon dyal l-maghrib. Katakhod bin 24 w 48 sa3a.');
      expect(truncated.length).toBeLessThanOrEqual(75);
      expect(truncated.endsWith('.')).toBe(true);
    });

    it('13. French response truncates safely at sentence boundary', () => {
      const text = 'La livraison standard prend entre 24 et 48 heures au Maroc. Les retours sont possibles sous 14 jours. Merci pour votre fidélité.';
      const truncated = (mockEngine as any).applyResponseLimit(text, 105);

      expect(truncated).toBe('La livraison standard prend entre 24 et 48 heures au Maroc. Les retours sont possibles sous 14 jours.');
      expect(truncated.length).toBeLessThanOrEqual(105);
      expect(truncated.endsWith('.')).toBe(true);
    });

    it('14. Existing price/stock invariants remain intact', async () => {
      const mockRepo = {
        findById: vi.fn().mockResolvedValue(null),
        findBySku: vi.fn().mockResolvedValue(null),
        findByName: vi.fn().mockResolvedValue(sampleProductFact.product),
        search: vi.fn().mockResolvedValue([sampleProductFact.product])
      };

      const ecommerceService = new EcommerceService(mockRepo as any);
      const fact = await ecommerceService.getProductFact(
        'animeverse',
        'animeverse-store',
        { name: 'Cyber Spirit Hoodie', color: 'Black', size: 'M' }
      );

      expect(fact?.effectivePrice).toBe(350);
      expect(fact?.inStock).toBe(true);
      expect(fact?.availableStock).toBe(5);
      expect(fact?.selectedVariant?.color).toBe('Black');
      expect(fact?.selectedVariant?.size).toBe('M');
    });
  });
});
