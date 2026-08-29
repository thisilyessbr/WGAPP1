import { describe, it, expect, beforeEach } from 'vitest';
import { EcommerceIntentParser } from '../../src/domain/ecommerce/EcommerceIntent';
import { TurnDecisionResolver } from '../../src/domain/conversation/TurnDecision';
import { AnswerComposer } from '../../src/domain/conversation/AnswerComposer';
import { CRMService } from '../../src/domain/crm/CRMService';
import { ProductFact } from '../../src/domain/ecommerce/ProductRepository';

describe('Phase CRM-D-FIX — Purchase Intent & Lead Flow Contract (52A)', () => {
  const dummyProductFact: ProductFact = {
    product: {
      id: 'prod-hoodie-1',
      tenantId: 'tech-haven',
      accountId: 'tech-haven-flagship',
      sku: 'ANV-H001',
      name: 'Moon Ninja Hoodie',
      price: 399,
      currency: 'MAD',
      stock: 25,
      category: 'Hoodies',
      active: true,
      description: 'Premium heavyweight anime ninja graphic hoodie.',
      nameLocalized: {
        en: 'Moon Ninja Hoodie',
        fr: 'Sweat à Capuche Moon Ninja',
        ar: 'هودي نينجا القمر',
        darija: 'Capuchon Moon Ninja'
      },
      descriptionLocalized: null,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date()
    },
    displayName: 'Moon Ninja Hoodie',
    displayDescription: 'Premium heavyweight anime ninja graphic hoodie.',
    effectivePrice: 399,
    currency: 'MAD',
    inStock: true,
    availableStock: 25,
    selectedVariant: {
      id: 'var-1',
      productId: 'prod-hoodie-1',
      sku: 'ANV-H001-BLK-M',
      size: 'M',
      color: 'Black',
      price: 399,
      stock: 10,
      active: true,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date()
    }
  };

  describe('1. Multilingual Purchase Intent Parsing', () => {
    it('A. parses "I want to buy this" as BUY_INTENT with anaphoric entity', () => {
      const parsed = EcommerceIntentParser.parse('I want to buy this');
      expect(parsed.intent).toBe('BUY_INTENT');
      expect(parsed.productName).toBeUndefined();
    });

    it('B. parses "I want to buy it" as BUY_INTENT with anaphoric entity', () => {
      const parsed = EcommerceIntentParser.parse('I want to buy it');
      expect(parsed.intent).toBe('BUY_INTENT');
      expect(parsed.productName).toBeUndefined();
    });

    it('C. parses "I want to order this" as BUY_INTENT', () => {
      const parsed = EcommerceIntentParser.parse('I want to order this');
      expect(parsed.intent).toBe('BUY_INTENT');
      expect(parsed.productName).toBeUndefined();
    });

    it('D. parses "I want to purchase this" as BUY_INTENT', () => {
      const parsed = EcommerceIntentParser.parse('I want to purchase this');
      expect(parsed.intent).toBe('BUY_INTENT');
      expect(parsed.productName).toBeUndefined();
    });

    it('E. parses "i wantto buy it" with glued normalization as BUY_INTENT', () => {
      const parsed = EcommerceIntentParser.parse('i wantto buy it');
      expect(parsed.intent).toBe('BUY_INTENT');
      expect(parsed.productName).toBeUndefined();
    });

    it('F. parses "i want to bu it" with bounded typo normalization as BUY_INTENT', () => {
      const parsed = EcommerceIntentParser.parse('i want to bu it');
      expect(parsed.intent).toBe('BUY_INTENT');
      expect(parsed.productName).toBeUndefined();
    });

    it('G. parses French "je veux acheter ça" as BUY_INTENT', () => {
      const parsed = EcommerceIntentParser.parse('je veux acheter ça');
      expect(parsed.intent).toBe('BUY_INTENT');
      expect(parsed.productName).toBeUndefined();
    });

    it('H. parses French "je veux commander ça" as BUY_INTENT', () => {
      const parsed = EcommerceIntentParser.parse('je veux commander ça');
      expect(parsed.intent).toBe('BUY_INTENT');
      expect(parsed.productName).toBeUndefined();
    });

    it('I. parses Darija "bghit nchri hadchi" as BUY_INTENT', () => {
      const parsed = EcommerceIntentParser.parse('bghit nchri hadchi');
      expect(parsed.intent).toBe('BUY_INTENT');
      expect(parsed.productName).toBeUndefined();
    });

    it('J. parses Darija "bghit ncommandi" as BUY_INTENT', () => {
      const parsed = EcommerceIntentParser.parse('bghit ncommandi');
      expect(parsed.intent).toBe('BUY_INTENT');
      expect(parsed.productName).toBeUndefined();
    });

    it('K. parses Arabic "أريد شراء هذا" as BUY_INTENT', () => {
      const parsed = EcommerceIntentParser.parse('أريد شراء هذا');
      expect(parsed.intent).toBe('BUY_INTENT');
      expect(parsed.productName).toBeUndefined();
    });

    it('L. parses Arabic "بغيت نشري هادشي" as BUY_INTENT', () => {
      const parsed = EcommerceIntentParser.parse('بغيت نشري هادشي');
      expect(parsed.intent).toBe('BUY_INTENT');
      expect(parsed.productName).toBeUndefined();
    });
  });

  describe('2. Context Resolution & Anaphora Preservation', () => {
    it('M. preserves active selectedProductId on "I want to buy this"', () => {
      const context = { selectedProductId: 'prod-hoodie-1', selectedSku: 'ANV-H001' };
      const parsed = EcommerceIntentParser.parse('I want to buy this', context, 'en');
      const decision = TurnDecisionResolver.resolve({
        text: 'I want to buy this',
        language: 'en',
        productContext: context,
        ecommerceParams: parsed,
        isEcommerceEnabled: true
      });

      expect(decision.domain).toBe('ECOMMERCE');
      expect(decision.intent).toBe('BUY_INTENT');
      expect(decision.productId).toBe('prod-hoodie-1');
      expect(decision.productName).toBeNull();
    });

    it('N. preserves active selectedProductId on "I want to buy it"', () => {
      const context = { selectedProductId: 'prod-hoodie-1', selectedSku: 'ANV-H001' };
      const parsed = EcommerceIntentParser.parse('I want to buy it', context, 'en');
      const decision = TurnDecisionResolver.resolve({
        text: 'I want to buy it',
        language: 'en',
        productContext: context,
        ecommerceParams: parsed,
        isEcommerceEnabled: true
      });

      expect(decision.domain).toBe('ECOMMERCE');
      expect(decision.intent).toBe('BUY_INTENT');
      expect(decision.productId).toBe('prod-hoodie-1');
    });

    it('O. resolves explicit named product on "I want to buy the Video Doorbell"', () => {
      const context = { selectedProductId: 'prod-hoodie-1', selectedSku: 'ANV-H001' };
      const parsed = EcommerceIntentParser.parse('I want to buy the Video Doorbell', context, 'en');
      const decision = TurnDecisionResolver.resolve({
        text: 'I want to buy the Video Doorbell',
        language: 'en',
        productContext: context,
        ecommerceParams: parsed,
        isEcommerceEnabled: true
      });

      expect(decision.domain).toBe('ECOMMERCE');
      expect(decision.intent).toBe('BUY_INTENT');
      expect(parsed.productName).toBe('Video Doorbell');
      expect(decision.productId).toBeNull();
      expect(decision.productName).toBe('Video Doorbell');
    });
  });

  describe('3. Regression Protection (Other intents must not be hijacked)', () => {
    it('P. "show me hoodies" remains PRODUCT_SEARCH', () => {
      const parsed = EcommerceIntentParser.parse('show me hoodies');
      expect(parsed.intent).toBe('PRODUCT_SEARCH');
      expect(parsed.category).toBe('Hoodies');
    });

    it('Q. "how much is it?" remains PRICE', () => {
      const parsed = EcommerceIntentParser.parse('how much is it?');
      expect(parsed.intent).toBe('PRICE');
    });

    it('R. "is it in stock?" remains AVAILABILITY', () => {
      const parsed = EcommerceIntentParser.parse('is it in stock?');
      expect(parsed.intent).toBe('AVAILABILITY');
    });

    it('S. "which hoodie do you recommend?" remains RECOMMENDATION', () => {
      const parsed = EcommerceIntentParser.parse('which hoodie do you recommend?');
      expect(parsed.intent).toBe('RECOMMENDATION');
    });

    it('T. "where is my order?" remains UNKNOWN (routes to Knowledge/Tracking)', () => {
      const parsed = EcommerceIntentParser.parse('where is my order?');
      expect(parsed.intent).toBe('UNKNOWN');
    });

    it('U. "show me a video of it" remains PRODUCT_DETAIL with video media', () => {
      const parsed = EcommerceIntentParser.parse('show me a video of it');
      expect(parsed.intent).toBe('PRODUCT_DETAIL');
      expect(parsed.requestedMediaType).toBe('video');
    });

    it('V. "show me pictures of it" remains PRODUCT_DETAIL with image media', () => {
      const parsed = EcommerceIntentParser.parse('show me pictures of it');
      expect(parsed.intent).toBe('PRODUCT_DETAIL');
      expect(parsed.requestedMediaType).toBe('image');
    });
  });

  describe('4. Deterministic Response Composition (0 LLM Calls)', () => {
    it('W. formats deterministic purchase instructions in English, French, Arabic, and Darija', () => {
      const decisionEn = {
        domain: 'ECOMMERCE' as const,
        intent: 'BUY_INTENT',
        source: 'ECOMMERCE' as const,
        productId: 'prod-hoodie-1',
        productName: null,
        category: null,
        sku: null,
        variantId: null,
        color: null,
        size: null,
        confidence: 0.95,
        responseLanguage: 'en' as const,
        responseScript: 'latin' as const
      };

      const responseEn = AnswerComposer.composeEcommerce({
        turnDecision: decisionEn,
        productFacts: dummyProductFact,
        responseLanguage: 'en',
        responseScript: 'latin'
      });

      expect(responseEn).toContain('Moon Ninja Hoodie');
      expect(responseEn).toContain('399 MAD');
      expect(responseEn).toContain('delivery address');

      const responseFr = AnswerComposer.composeEcommerce({
        turnDecision: { ...decisionEn, responseLanguage: 'fr' },
        productFacts: dummyProductFact,
        responseLanguage: 'fr',
        responseScript: 'latin'
      });
      expect(responseFr).toContain('Sweat à Capuche Moon Ninja');
      expect(responseFr).toContain('399 MAD');
      expect(responseFr).toContain('commander');

      const responseAr = AnswerComposer.composeEcommerce({
        turnDecision: { ...decisionEn, responseLanguage: 'ar', responseScript: 'arabic' },
        productFacts: dummyProductFact,
        responseLanguage: 'ar',
        responseScript: 'arabic'
      });
      expect(responseAr).toContain('399 MAD');
      expect(responseAr).toContain('عنوان التوصيل');

      const responseDarija = AnswerComposer.composeEcommerce({
        turnDecision: { ...decisionEn, responseLanguage: 'darija', responseScript: 'arabizi' },
        productFacts: dummyProductFact,
        responseLanguage: 'darija',
        responseScript: 'arabizi'
      });
      expect(responseDarija).toContain('399 MAD');
      expect(responseDarija).toContain('tcommandi');
    });
  });

  describe('5. CRM Lead Signal Integration', () => {
    let mockPrisma: any;
    let crmService: CRMService;
    let mockLeads: Map<string, any>;

    beforeEach(() => {
      mockLeads = new Map();
      mockPrisma = {
        lead: {
          upsert: async ({ where, create, update }: any) => {
            const key = `${where.tenantId_accountId_customerId.tenantId}_${where.tenantId_accountId_customerId.accountId}_${where.tenantId_accountId_customerId.customerId}`;
            if (mockLeads.has(key)) {
              const existing = mockLeads.get(key);
              const updated = { ...existing, updatedAt: new Date() };
              mockLeads.set(key, updated);
              return updated;
            }
            const created = {
              id: `lead-${Date.now()}-${Math.random()}`,
              tenantId: create.tenantId,
              accountId: create.accountId,
              customerId: create.customerId,
              status: create.status,
              createdAt: new Date(),
              updatedAt: new Date()
            };
            mockLeads.set(key, created);
            return created;
          }
        }
      };
      crmService = new CRMService(mockPrisma);
    });

    it('X. creates exactly 1 Lead on BUY_INTENT turn decision', async () => {
      const lead = await crmService.processTurnSignal({
        tenantId: 'tech-haven',
        accountId: 'tech-haven-flagship',
        customerId: 'cust-123',
        turnDecision: {
          domain: 'ECOMMERCE',
          intent: 'BUY_INTENT',
          source: 'ECOMMERCE',
          productId: 'prod-hoodie-1',
          productName: null,
          category: null,
          sku: null,
          variantId: null,
          color: null,
          size: null,
          confidence: 0.95,
          responseLanguage: 'en',
          responseScript: 'latin'
        },
        userMessage: 'I want to buy this'
      });

      expect(lead).not.toBeNull();
      expect(lead?.customerId).toBe('cust-123');
      expect(lead?.status).toBe('NEW');
      expect(mockLeads.size).toBe(1);
    });

    it('Y. preserves idempotent Lead record on repeated BUY_INTENT turns', async () => {
      const params = {
        tenantId: 'tech-haven',
        accountId: 'tech-haven-flagship',
        customerId: 'cust-123',
        turnDecision: {
          domain: 'ECOMMERCE' as const,
          intent: 'BUY_INTENT',
          source: 'ECOMMERCE' as const,
          productId: 'prod-hoodie-1',
          productName: null,
          category: null,
          sku: null,
          variantId: null,
          color: null,
          size: null,
          confidence: 0.95,
          responseLanguage: 'en' as const,
          responseScript: 'latin' as const
        },
        userMessage: 'I want to buy this'
      };

      const lead1 = await crmService.processTurnSignal(params);
      const lead2 = await crmService.processTurnSignal({ ...params, userMessage: 'I want to order this' });
      const lead3 = await crmService.processTurnSignal({ ...params, userMessage: 'i wantto buy it' });

      expect(lead1?.id).toBe(lead2?.id);
      expect(lead2?.id).toBe(lead3?.id);
      expect(mockLeads.size).toBe(1);
    });

    it('Z. does not create Lead on regular non-sales inquiries', async () => {
      const lead = await crmService.processTurnSignal({
        tenantId: 'tech-haven',
        accountId: 'tech-haven-flagship',
        customerId: 'cust-456',
        turnDecision: {
          domain: 'ECOMMERCE',
          intent: 'PRODUCT_SEARCH',
          source: 'ECOMMERCE',
          productId: null,
          productName: null,
          category: 'Hoodies',
          sku: null,
          variantId: null,
          color: null,
          size: null,
          confidence: 0.95,
          responseLanguage: 'en',
          responseScript: 'latin'
        },
        userMessage: 'show me hoodies'
      });

      expect(lead).toBeNull();
      expect(mockLeads.size).toBe(0);
    });
  });
});
