import { describe, it, expect } from 'vitest';
import { EcommerceIntentParser } from '../../src/domain/ecommerce/EcommerceIntent';
import { TurnDecisionResolver } from '../../src/domain/conversation/TurnDecision';
import { AnswerComposer } from '../../src/domain/conversation/AnswerComposer';
import { ProductLookupResult } from '../../src/domain/ecommerce/EcommerceService';

describe('Ecommerce Attribute Semantic Contract (RC-ECOM-2)', () => {
  const sampleHoodieFact: ProductLookupResult = {
    product: {
      id: 'prod-hoodie-1',
      tenantId: 'animeverse',
      accountId: 'animeverse-store',
      sku: 'ANV-H001',
      name: 'Moon Ninja Hoodie',
      nameLocalized: {
        en: 'Moon Ninja Hoodie',
        fr: 'Sweat à capuche Moon Ninja',
        ar: 'هودي مون نينجا',
        darija: 'Moon Ninja Hoodie'
      },
      description: 'Warm cotton fleece hoodie with oversized fit and kangaroo pocket.',
      descriptionLocalized: {
        en: 'Warm cotton fleece hoodie with oversized fit and kangaroo pocket.',
        fr: 'Sweat à capuche chaud en polaire de coton avec coupe ample et poche kangourou.',
        ar: 'هودي دافئ من الصوف والقطن بقصة واسعة وجيب كنغر.',
        darija: 'هودي سخون من القطن وفصالة واسعة وفيه جيب.'
      },
      price: 399,
      currency: 'MAD',
      stock: 25,
      active: true,
      category: 'Hoodies',
      createdAt: new Date(),
      updatedAt: new Date(),
      variants: [
        {
          id: 'var-h1-black-m',
          productId: 'prod-hoodie-1',
          sku: 'ANV-H001-BLK-M',
          name: 'Moon Ninja Hoodie - Black / M',
          color: 'Black',
          size: 'M',
          stock: 10,
          active: true,
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ]
    },
    effectivePrice: 399,
    currency: 'MAD',
    inStock: true,
    availableStock: 25,
    displayName: 'Moon Ninja Hoodie',
    displayDescription: 'Warm cotton fleece hoodie with oversized fit and kangaroo pocket.'
  };

  const sampleJacketFact: ProductLookupResult = {
    product: {
      id: 'prod-jacket-1',
      tenantId: 'animeverse',
      accountId: 'animeverse-store',
      sku: 'ANV-J001',
      name: 'Cyber Spirit Jacket',
      nameLocalized: {
        en: 'Cyber Spirit Jacket',
        fr: 'Veste Cyber Spirit',
        ar: 'جاكيت سايبر سبيريت',
        darija: 'Cyber Spirit Jacket'
      },
      description: 'Waterproof biker jacket with multiple zip pockets.',
      descriptionLocalized: {
        en: 'Waterproof biker jacket with multiple zip pockets.',
        fr: 'Veste motard imperméable avec multiples poches zippées.',
        ar: 'جاكيت دراجة نارية مقاوم للماء بعدة جيوب بسحاب.',
        darija: 'جاكيط د الموطور ضد الما وفيها بزاف د السنسلات.'
      },
      price: 599,
      currency: 'MAD',
      stock: 12,
      active: true,
      category: 'Jackets',
      createdAt: new Date(),
      updatedAt: new Date(),
      variants: []
    },
    effectivePrice: 599,
    currency: 'MAD',
    inStock: true,
    availableStock: 12,
    displayName: 'Cyber Spirit Jacket',
    displayDescription: 'Waterproof biker jacket with multiple zip pockets.'
  };

  describe('1. Semantic Classification & Intent Precedence (ATTRIBUTE_QUERY > PRODUCT_SEARCH)', () => {
    it('should classify explicit product + MATERIAL as ATTRIBUTE_QUERY', () => {
      const parsed = EcommerceIntentParser.parse('What material is the Moon Ninja Hoodie made of?', null, 'en');
      expect(parsed.intent).toBe('ATTRIBUTE_QUERY');
      expect(parsed.attributeFamily).toBe('MATERIAL');
      expect(parsed.category).toBe('Hoodies');
      expect(parsed.productName).toBe('Moon Ninja Hoodie');
    });

    it('should classify category + MATERIAL as ATTRIBUTE_QUERY, not PRODUCT_SEARCH', () => {
      const parsed = EcommerceIntentParser.parse('What material are your hoodies made of?', null, 'en');
      expect(parsed.intent).toBe('ATTRIBUTE_QUERY');
      expect(parsed.attributeFamily).toBe('MATERIAL');
      expect(parsed.category).toBe('Hoodies');
    });

    it('should classify explicit product + PERFORMANCE as ATTRIBUTE_QUERY', () => {
      const parsed = EcommerceIntentParser.parse('Is Cyber Spirit Jacket waterproof?', null, 'en');
      expect(parsed.intent).toBe('ATTRIBUTE_QUERY');
      expect(parsed.attributeFamily).toBe('PERFORMANCE');
      expect(parsed.category).toBe('Jackets');
      expect(parsed.productName).toBe('Cyber Spirit Jacket');
    });

    it('should classify category + PERFORMANCE as ATTRIBUTE_QUERY in Darija', () => {
      const parsed = EcommerceIntentParser.parse('واش الجاكيطات اللي عندكم ضد الما؟', null, 'darija');
      expect(parsed.intent).toBe('ATTRIBUTE_QUERY');
      expect(parsed.attributeFamily).toBe('PERFORMANCE');
      expect(parsed.category).toBe('Jackets');
    });

    it('should preserve ordinary search intent when explicit search verbs are used with attribute words', () => {
      const parsed = EcommerceIntentParser.parse('bghit hoodie 100% cotton', null, 'darija');
      expect(parsed.intent).toBe('PRODUCT_SEARCH');
      expect(parsed.category).toBe('Hoodies');
    });
  });

  describe('2. Active Context & Anaphora Preservation', () => {
    const activeCtx = { selectedProductId: 'prod-hoodie-1', selectedSku: 'ANV-H001' };

    it('should preserve active context on MATERIAL follow-up (EN)', () => {
      const parsed = EcommerceIntentParser.parse('What material is it made of?', activeCtx, 'en');
      expect(parsed.intent).toBe('ATTRIBUTE_QUERY');
      expect(parsed.attributeFamily).toBe('MATERIAL');
      expect(parsed.productName).toBeUndefined();

      const decision = TurnDecisionResolver.resolve({
        text: 'What material is it made of?',
        language: 'en',
        productContext: activeCtx
      });
      expect(decision.domain).toBe('ECOMMERCE');
      expect(decision.intent).toBe('ATTRIBUTE_QUERY');
      expect(decision.productId).toBe('prod-hoodie-1');
    });

    it('should preserve active context on FIT follow-up (Darija)', () => {
      const parsed = EcommerceIntentParser.parse('واش واسع؟', activeCtx, 'darija');
      expect(parsed.intent).toBe('ATTRIBUTE_QUERY');
      expect(parsed.attributeFamily).toBe('FIT');

      const decision = TurnDecisionResolver.resolve({
        text: 'واش واسع؟',
        language: 'darija',
        productContext: activeCtx
      });
      expect(decision.domain).toBe('ECOMMERCE');
      expect(decision.intent).toBe('ATTRIBUTE_QUERY');
      expect(decision.productId).toBe('prod-hoodie-1');
    });

    it('should preserve active context on WEIGHT follow-up (EN)', () => {
      const parsed = EcommerceIntentParser.parse('Is it heavy or lightweight?', activeCtx, 'en');
      expect(parsed.intent).toBe('ATTRIBUTE_QUERY');
      expect(parsed.attributeFamily).toBe('WEIGHT');

      const decision = TurnDecisionResolver.resolve({
        text: 'Is it heavy or lightweight?',
        language: 'en',
        productContext: activeCtx
      });
      expect(decision.domain).toBe('ECOMMERCE');
      expect(decision.intent).toBe('ATTRIBUTE_QUERY');
      expect(decision.productId).toBe('prod-hoodie-1');
    });

    it('should preserve active context on FEATURE follow-up (FR)', () => {
      const jacketCtx = { selectedProductId: 'prod-jacket-1', selectedSku: 'ANV-J001' };
      const parsed = EcommerceIntentParser.parse('Est-ce qu’il a des poches zippées ?', jacketCtx, 'fr');
      expect(parsed.intent).toBe('ATTRIBUTE_QUERY');
      expect(parsed.attributeFamily).toBe('FEATURE');

      const decision = TurnDecisionResolver.resolve({
        text: 'Est-ce qu’il a des poches zippées ?',
        language: 'fr',
        productContext: jacketCtx
      });
      expect(decision.domain).toBe('ECOMMERCE');
      expect(decision.intent).toBe('ATTRIBUTE_QUERY');
      expect(decision.productId).toBe('prod-jacket-1');
    });

    it('should preserve active context on anaphoric pronoun inquiry (AR)', () => {
      const parsed = EcommerceIntentParser.parse('واش هاد المنتج قطن؟', activeCtx, 'ar');
      expect(parsed.intent).toBe('ATTRIBUTE_QUERY');
      expect(parsed.attributeFamily).toBe('MATERIAL');

      const decision = TurnDecisionResolver.resolve({
        text: 'واش هاد المنتج قطن؟',
        language: 'ar',
        productContext: activeCtx
      });
      expect(decision.domain).toBe('ECOMMERCE');
      expect(decision.intent).toBe('ATTRIBUTE_QUERY');
      expect(decision.productId).toBe('prod-hoodie-1');
    });
  });

  describe('3. Multilingual Attribute Support', () => {
    it('should handle French material inquiries', () => {
      const parsed = EcommerceIntentParser.parse('De quelle matière est cette veste ?', null, 'fr');
      expect(parsed.intent).toBe('ATTRIBUTE_QUERY');
      expect(parsed.attributeFamily).toBe('MATERIAL');
      expect(parsed.category).toBe('Jackets');
    });

    it('should handle Arabic fit inquiries', () => {
      const parsed = EcommerceIntentParser.parse('هل قصة هذا الهودي واسعة؟', null, 'ar');
      expect(parsed.intent).toBe('ATTRIBUTE_QUERY');
      expect(parsed.attributeFamily).toBe('FIT');
      expect(parsed.category).toBe('Hoodies');
    });

    it('should handle Arabizi performance inquiries', () => {
      const parsed = EcommerceIntentParser.parse('wach had l-veste d ded l-ma?', null, 'darija');
      expect(parsed.intent).toBe('ATTRIBUTE_QUERY');
      expect(parsed.attributeFamily).toBe('PERFORMANCE');
      expect(parsed.category).toBe('Jackets');
    });
  });

  describe('4. Grounded Response Generation with ProductFact', () => {
    it('should formulate focused material answer from ProductFact (EN)', () => {
      const response = AnswerComposer.composeEcommerce({
        turnDecision: {
          domain: 'ECOMMERCE',
          intent: 'ATTRIBUTE_QUERY',
          attributeFamily: 'MATERIAL',
          source: 'ECOMMERCE',
          responseLanguage: 'en',
          responseScript: 'latin'
        },
        productFacts: sampleHoodieFact,
        responseLanguage: 'en',
        responseScript: 'latin'
      });

      expect(response).toContain('Moon Ninja Hoodie');
      expect(response).toContain('cotton');
      expect(response).not.toContain('Price :'); // Does not dump static detail card
    });

    it('should formulate focused performance answer from ProductFact (FR)', () => {
      const response = AnswerComposer.composeEcommerce({
        turnDecision: {
          domain: 'ECOMMERCE',
          intent: 'ATTRIBUTE_QUERY',
          attributeFamily: 'PERFORMANCE',
          source: 'ECOMMERCE',
          responseLanguage: 'fr',
          responseScript: 'latin'
        },
        productFacts: sampleJacketFact,
        responseLanguage: 'fr',
        responseScript: 'latin'
      });

      expect(response).toContain('Veste Cyber Spirit');
      expect(response).toContain('imperméable');
    });

    it('should refuse unsupported attribute without hallucinating (EN)', () => {
      // Moon Ninja Hoodie has no waterproof evidence
      const response = AnswerComposer.composeEcommerce({
        turnDecision: {
          domain: 'ECOMMERCE',
          intent: 'ATTRIBUTE_QUERY',
          attributeFamily: 'PERFORMANCE',
          attributeKeywords: 'waterproof',
          source: 'ECOMMERCE',
          responseLanguage: 'en',
          responseScript: 'latin'
        },
        productFacts: sampleHoodieFact,
        responseLanguage: 'en',
        responseScript: 'latin'
      });

      expect(response).toContain('do not specify this particular feature');
    });
  });
});
