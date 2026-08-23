import { describe, it, expect, vi } from 'vitest';
import { ConversationEngine } from '../../src/domain/conversation/ConversationEngine';
import { AnswerComposer } from '../../src/domain/conversation/AnswerComposer';
import { ContentSafetyGuard } from '../../src/domain/safety/ContentSafetyGuard';
import { DirectRagGuard } from '../../src/domain/rag/DirectRagGuard';
import { LLMMockProvider } from '../../src/core/llm/LLMProvider';
import { ResponseBuilder } from '../../src/domain/conversation/ResponseBuilder';
import { DEFAULT_BUSINESS_CONFIG, BusinessConfig } from '../../src/domain/tenant/BusinessConfig';
import { EcommerceService } from '../../src/domain/ecommerce/EcommerceService';

describe('Phase 31B: Final Response Boundary + Knowledge Trust Tests', () => {
  const mockConfig: BusinessConfig = {
    ...DEFAULT_BUSINESS_CONFIG,
    capabilities: {
      ...DEFAULT_BUSINESS_CONFIG.capabilities,
      faq: [
        {
          id: 'faq-returns-ar',
          question: 'واش نقدر نرجع السلعة؟',
          answer: 'نعم، يمكنك إرجاع أو استبدال أي منتج خلال 14 يوماً من تاريخ الاستلام بشرط أن يكون في حالته الأصلية.',
          category: 'RETURNS',
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
    },
    limits: {
      ...DEFAULT_BUSINESS_CONFIG.limits,
      maxResponseLength: 150
    }
  };

  describe('1. Safety Refusal Language & Script Invariant', () => {
    it('1. Safety English → correct English refusal', () => {
      const refusal = ContentSafetyGuard.getSafetyRefusal('en', 'latin');
      expect(refusal).toBe('Please keep our conversation respectful. How can I help you with your inquiry?');
    });

    it('2. Safety Arabic → correct Arabic refusal', () => {
      const refusal = ContentSafetyGuard.getSafetyRefusal('ar', 'arabic');
      expect(refusal).toBe('يرجى الحفاظ على حوار محترم. كيف يمكنني مساعدتك في استفسارك؟');
      expect(/[\u0600-\u06FF]/.test(refusal)).toBe(true);
    });

    it('3. Safety Arabizi → correct Arabizi refusal', () => {
      const refusal = ContentSafetyGuard.getSafetyRefusal('darija', 'arabizi');
      expect(refusal).toBe('3afak khlli l-hiwar mo7taram. Kifach n9der n3awnek f talab dyalek?');
      expect(/[\u0600-\u06FF]/.test(refusal)).toBe(false);
    });
  });

  describe('2. FAQ Script Compatibility & Translation', () => {
    it('4. FAQ Arabic answer + Arabizi request → Arabizi output via synthesis', async () => {
      const mockLlm = new LLMMockProvider();
      mockLlm.generateResponse = vi.fn().mockResolvedValue('Iyeh, t9der trje3 ay produit f modat 14 yum mn nhar wslat.');

      const engine = new ConversationEngine(
        {
          getOrCreateConversation: async () => ({
            id: 'conv-faq-arabizi',
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
          getConfig: async () => mockConfig
        } as any,
        {
          process: async () => ({ response: 'workflow' })
        } as any,
        mockLlm,
        new ResponseBuilder()
      );

      const response = await engine.handleMessage('animeverse', 'cust-1', 'wach n9der nrje3 l hoodie ila ma3jebnich?', 'animeverse-store');

      expect(mockLlm.generateResponse).toHaveBeenCalled();
      expect(response).toContain('Iyeh, t9der trje3');
      expect(/[\u0600-\u06FF]/.test(response)).toBe(false);
    });

    it('5. FAQ Arabic answer + Arabic request → Arabic output directly', async () => {
      const mockLlm = new LLMMockProvider();
      const engine = new ConversationEngine(
        {
          getOrCreateConversation: async () => ({
            id: 'conv-faq-arabic',
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
          getConfig: async () => mockConfig
        } as any,
        {
          process: async () => ({ response: 'workflow' })
        } as any,
        mockLlm,
        new ResponseBuilder()
      );

      const response = await engine.handleMessage('animeverse', 'cust-1', 'واش نقدر نرجع السلعة؟', 'animeverse-store');

      expect(response).toContain('نعم، يمكنك إرجاع');
      expect(/[\u0600-\u06FF]/.test(response)).toBe(true);
    });
  });

  describe('3. Knowledge Content Trust & Direct RAG Guard', () => {
    it('6. English RAG chunk with internal examples → never returned raw', () => {
      const chunkWithExamples = 'Order Tracking: Enter tracking number on tracking page. Customer language examples: where is my order, trace package, فين وصل الطلب.';
      const res = DirectRagGuard.evaluate('where is my order?', chunkWithExamples, 'en', 'latin');

      expect(res.isSafe).toBe(false);
      expect(res.reason).toBe('UNSAFE_INTERNAL_CONTENT');
    });

    it('7. English RAG + Arabizi query → synthesized Arabizi', async () => {
      const mockRagService = {
        retrieve: vi.fn().mockResolvedValue({
          chunks: [{ id: 'c1', content: 'Standard delivery takes 24-48 hours across Morocco and costs 30 MAD.', similarity: 0.88 }]
        })
      };

      const mockLlm = new LLMMockProvider();
      mockLlm.generateResponse = vi.fn().mockResolvedValue('Livraison katakhod bin 24 w 48 sa3a f ga3 l-mowdon b 30 MAD.');

      const engine = new ConversationEngine(
        {
          getOrCreateConversation: async () => ({
            id: 'conv-rag-arabizi',
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
          getConfig: async () => mockConfig
        } as any,
        {
          process: async () => ({ response: 'workflow' })
        } as any,
        mockLlm,
        new ResponseBuilder(),
        mockRagService as any
      );

      const response = await engine.handleMessage('animeverse', 'cust-1', 'ch7al katakhod livraison?', 'animeverse-store');

      expect(mockLlm.generateResponse).toHaveBeenCalled();
      expect(response).toContain('Livraison katakhod');
      expect(/[\u0600-\u06FF]/.test(response)).toBe(false);
    });

    it('8. English RAG + Arabic query → synthesized Arabic', async () => {
      const mockRagService = {
        retrieve: vi.fn().mockResolvedValue({
          chunks: [{ id: 'c1', content: 'Standard delivery takes 24-48 hours across Morocco and costs 30 MAD.', similarity: 0.88 }]
        })
      };

      const mockLlm = new LLMMockProvider();
      mockLlm.generateResponse = vi.fn().mockResolvedValue('يستغرق التوصيل العادي من 24 إلى 48 ساعة في جميع أنحاء المغرب بتكلفة 30 درهم.');

      const engine = new ConversationEngine(
        {
          getOrCreateConversation: async () => ({
            id: 'conv-rag-arabic',
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
          getConfig: async () => mockConfig
        } as any,
        {
          process: async () => ({ response: 'workflow' })
        } as any,
        mockLlm,
        new ResponseBuilder(),
        mockRagService as any
      );

      const response = await engine.handleMessage('animeverse', 'cust-1', 'شحال كياخد التوصيل فالمغرب؟', 'animeverse-store');

      expect(mockLlm.generateResponse).toHaveBeenCalled();
      expect(response).toContain('يستغرق التوصيل');
      expect(/[\u0600-\u06FF]/.test(response)).toBe(true);
    });

    it('9. English RAG + English query → direct answer still possible when clean', () => {
      const cleanChunk = 'Standard delivery takes 24-48 hours across Morocco and costs 30 MAD.';
      const res = DirectRagGuard.evaluate('How long is standard delivery in Morocco?', cleanChunk, 'en', 'latin');

      expect(res.isSafe).toBe(true);
      expect(res.reason).toBe('SAFE');
    });

    it('10. Grounded LLM receives explicit responseScript in system prompt', async () => {
      const mockRagService = {
        retrieve: vi.fn().mockResolvedValue({
          chunks: [{ id: 'c1', content: 'Care guide: wash cold, hang dry.', similarity: 0.85 }]
        })
      };

      const mockLlm = new LLMMockProvider();
      let capturedSystemPrompt = '';
      mockLlm.generateResponse = vi.fn().mockImplementation(async (sys) => {
        capturedSystemPrompt = sys;
        return 'Ghslo b l-ma l-bared w nchfo f ddel.';
      });

      const engine = new ConversationEngine(
        {
          getOrCreateConversation: async () => ({
            id: 'conv-prompt-script',
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
          getConfig: async () => mockConfig
        } as any,
        {
          process: async () => ({ response: 'workflow' })
        } as any,
        mockLlm,
        new ResponseBuilder(),
        mockRagService as any
      );

      await engine.handleMessage('animeverse', 'cust-1', 'kifach nghsel l hoodie dyali?', 'animeverse-store');

      expect(capturedSystemPrompt).toContain('Target Script: "arabizi"');
      expect(capturedSystemPrompt).toContain('CRITICAL SCRIPT RULE');
    });

    it('11. Tracking query never leaks "Customer language examples"', async () => {
      const mockRagService = {
        retrieve: vi.fn().mockResolvedValue({
          chunks: [{
            id: 'c-track',
            content: 'تتبع الطلب: يمكنك تتبع طلبك عبر إدخال رقم الطلب في صفحة التتبع.\nCustomer language examples: فين وصل طلبي، كيفاش نتبع الطلب.\nInternal notes: Verify tracking carrier status.',
            similarity: 0.92
          }]
        })
      };

      const mockLlm = new LLMMockProvider();
      mockLlm.generateResponse = vi.fn().mockResolvedValue('يمكنك تتبع طلبك بإدخال رقم الطلب في صفحة التتبع الخاصة بنا.');

      const engine = new ConversationEngine(
        {
          getOrCreateConversation: async () => ({
            id: 'conv-track-leak',
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
          getConfig: async () => mockConfig
        } as any,
        {
          process: async () => ({ response: 'workflow' })
        } as any,
        mockLlm,
        new ResponseBuilder(),
        mockRagService as any
      );

      const response = await engine.handleMessage('animeverse', 'cust-1', 'طلبت من عندكم، كيفاش غادي نتبع الطلب ديالي؟', 'animeverse-store');

      expect(response).not.toContain('Customer language examples');
      expect(response).not.toContain('Internal notes');
      expect(response).toContain('يمكنك تتبع طلبك');
    });
  });

  describe('4. Central Final Response Boundary Validation', () => {
    it('12. Finalizer rejects and sanitizes internal labels', () => {
      const leakedString = 'Our delivery takes 24 hours. Customer language examples: how long is shipping? Training examples: delivery speed.';
      const finalized = AnswerComposer.finalizeResponse(leakedString, {
        domain: 'KNOWLEDGE',
        intent: 'POLICY_INQUIRY',
        confidence: 1,
        responseLanguage: 'en',
        responseScript: 'latin'
      }, mockConfig);

      expect(finalized).not.toContain('Customer language examples');
      expect(finalized).not.toContain('Training examples');
      expect(finalized).toContain('Our delivery takes 24 hours.');
    });

    it('13. Finalizer rejects script mismatch (Arabic characters in Arabizi turn)', () => {
      const leakedArabic = 'هذا الجواب بالعربية وهو غير مطابق للأرابيزي';
      const finalized = AnswerComposer.finalizeResponse(leakedArabic, {
        domain: 'KNOWLEDGE',
        intent: 'POLICY_INQUIRY',
        confidence: 1,
        responseLanguage: 'darija',
        responseScript: 'arabizi'
      }, mockConfig);

      // Must fall back to safe Arabizi response and eliminate Arabic script
      expect(/[\u0600-\u06FF]/.test(finalized)).toBe(false);
    });

    it('14. Finalizer preserves valid Ecommerce response', () => {
      const ecomResponse = 'Cyber Spirit Hoodie is available for 350 MAD. (In stock: 10)';
      const finalized = AnswerComposer.finalizeResponse(ecomResponse, {
        domain: 'ECOMMERCE',
        intent: 'AVAILABILITY',
        confidence: 1,
        responseLanguage: 'en',
        responseScript: 'latin'
      }, mockConfig);

      expect(finalized).toBe(ecomResponse);
    });

    it('15. Finalizer preserves valid hybrid response', () => {
      const hybridResponse = 'Moon Ninja Hoodie is 350 MAD and in stock. You can return it within 14 days in original condition.';
      const finalized = AnswerComposer.finalizeResponse(hybridResponse, {
        domain: 'KNOWLEDGE',
        intent: 'HYBRID',
        source: 'HYBRID',
        confidence: 1,
        responseLanguage: 'en',
        responseScript: 'latin'
      }, mockConfig);

      expect(finalized).toBe(hybridResponse);
    });

    it('16. Finalizer preserves safe fallback on empty/null input', () => {
      const finalized = AnswerComposer.finalizeResponse('', {
        domain: 'FALLBACK',
        intent: 'FALLBACK',
        confidence: 1,
        responseLanguage: 'en',
        responseScript: 'latin'
      }, mockConfig);

      expect(finalized).toBe('I did not understand that. Could you rephrase?');
    });

    it('17. Long response remains boundary-safe', () => {
      const longResponse = 'Sentence one is complete. Sentence two contains extra details. Sentence three exceeds the limit.';
      const finalized = AnswerComposer.finalizeResponse(longResponse, {
        domain: 'KNOWLEDGE',
        intent: 'POLICY_INQUIRY',
        confidence: 1,
        responseLanguage: 'en',
        responseScript: 'latin'
      }, mockConfig, { maxResponseLength: 70 });

      expect(finalized).toBe('Sentence one is complete. Sentence two contains extra details.');
      expect(finalized.length).toBeLessThanOrEqual(70);
    });

    it('18. No customer-visible internal errors or stack traces', () => {
      const errorDump = 'Error: CONCURRENCY_CONFLICT at /app/src/domain/conversation/ConversationService.ts:250';
      const finalized = AnswerComposer.finalizeResponse(errorDump, {
        domain: 'FALLBACK',
        intent: 'FALLBACK',
        confidence: 1,
        responseLanguage: 'en',
        responseScript: 'latin'
      }, mockConfig);

      expect(finalized).toBeDefined();
      expect(finalized).not.toContain('ConversationService.ts');
    });
  });
});
