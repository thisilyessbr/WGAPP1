import { describe, it, expect } from 'vitest';
import { EcommerceIntentParser } from '../../src/domain/ecommerce/EcommerceIntent';
import { TurnDecisionResolver } from '../../src/domain/conversation/TurnDecision';

describe('Phase CRM-D-FIX-AR — Purchase Intent Arabic / Darija / Arabizi Robustness', () => {
  const activeProductContext = {
    selectedProductId: 'moon-ninja-hoodie-123',
    selectedSku: 'ANV-MNH-001'
  };

  describe('1. Arabic (MSA) Purchase Patterns', () => {
    const arabicPhrases = [
      'أريد شراء هذا',
      'أريد أن أشتري هذا',
      'أريد شراء هذا المنتج',
      'أريد أن أطلب هذا',
      'أريد طلب هذا',
      'أريد الشراء',
      'أريد أشتري هذا',
      'أريد شراءه',
      'أريد أن أشتريه',
      'سأشتري هذا',
      'سوف أشتري هذا',
      'اريد شراء هذا',
      'اريد ان اشتري هذا',
      'اريد اشتري هذا'
    ];

    arabicPhrases.forEach(phrase => {
      it(`recognizes "${phrase}" as BUY_INTENT and preserves context`, () => {
        const params = EcommerceIntentParser.parse(phrase, activeProductContext, 'ar');
        expect(params.intent).toBe('BUY_INTENT');
        expect(params.productName).toBeUndefined();

        const decision = TurnDecisionResolver.resolve({
          text: phrase,
          language: 'ar',
          productContext: activeProductContext,
          ecommerceParams: params,
          isEcommerceEnabled: true
        });
        expect(decision.intent).toBe('BUY_INTENT');
        expect(decision.productId).toBe('moon-ninja-hoodie-123');
      });
    });
  });

  describe('2. Moroccan Darija (Arabic script) Purchase Patterns', () => {
    const darijaArabicPhrases = [
      'بغيت نشري هادشي',
      'بغيت نشري هادا',
      'بغيت نشري هاد المنتج',
      'بغيت نكموندي',
      'بغيت نكوموندي',
      'بغيت نطلب هادشي',
      'بغيت ناخد هادشي',
      'بغيت نشريه',
      'بغيت نطلبو',
      'باغي نشري هادشي',
      'باغية نشري هادشي',
      'بغيت الشراء',
      'نقدر نشري هادشي؟',
      'واش نقدر نشري هادشي؟',
      'واش نقدر نكوموندي؟',
      'كيفاش نكوموندي؟'
    ];

    darijaArabicPhrases.forEach(phrase => {
      it(`recognizes "${phrase}" as BUY_INTENT and preserves context`, () => {
        const params = EcommerceIntentParser.parse(phrase, activeProductContext, 'ar');
        expect(params.intent).toBe('BUY_INTENT');
        expect(params.productName).toBeUndefined();

        const decision = TurnDecisionResolver.resolve({
          text: phrase,
          language: 'ar',
          productContext: activeProductContext,
          ecommerceParams: params,
          isEcommerceEnabled: true
        });
        expect(decision.intent).toBe('BUY_INTENT');
        expect(decision.productId).toBe('moon-ninja-hoodie-123');
      });
    });
  });

  describe('3. Moroccan Darija (Arabizi / Latin script) Purchase Patterns', () => {
    const arabiziPhrases = [
      'bghit nchri hadchi',
      'bghit nchri hada',
      'bghit nchri had',
      'bghit nchri had lproduit',
      'bghit ncommandi',
      'bghit nkomandi',
      'bghit nkhod hadchi',
      'bghit nshri hadchi',
      'baghi nchri hadchi',
      'baghya nchri hadchi',
      'nchri hadchi',
      'ncommandi hadchi',
      'wach n9der nchri hadchi',
      'wach n9der ncommandi',
      'ana bghit nchri',
      'bghit nechri',
      'bghit chri hadchi'
    ];

    arabiziPhrases.forEach(phrase => {
      it(`recognizes "${phrase}" as BUY_INTENT and preserves context`, () => {
        const params = EcommerceIntentParser.parse(phrase, activeProductContext, 'ar');
        expect(params.intent).toBe('BUY_INTENT');
        expect(params.productName).toBeUndefined();

        const decision = TurnDecisionResolver.resolve({
          text: phrase,
          language: 'ar',
          productContext: activeProductContext,
          ecommerceParams: params,
          isEcommerceEnabled: true
        });
        expect(decision.intent).toBe('BUY_INTENT');
        expect(decision.productId).toBe('moon-ninja-hoodie-123');
      });
    });
  });

  describe('4. Explicit Product Purchase (Wins over anaphora)', () => {
    const explicitCases = [
      { phrase: 'بغيت نشري Moon Ninja Hoodie', expectedProd: 'Moon Ninja Hoodie' },
      { phrase: 'bghit nchri Moon Ninja Hoodie', expectedProd: 'Moon Ninja Hoodie' },
      { phrase: 'أريد شراء Video Doorbell', expectedProd: 'Video Doorbell' },
      { phrase: 'je veux acheter Moon Ninja Hoodie', expectedProd: 'Moon Ninja Hoodie' }
    ];

    explicitCases.forEach(({ phrase, expectedProd }) => {
      it(`extracts explicit product "${expectedProd}" from "${phrase}"`, () => {
        const params = EcommerceIntentParser.parse(phrase, activeProductContext, 'en');
        expect(params.intent).toBe('BUY_INTENT');
        expect(params.productName).toBe(expectedProd);

        const decision = TurnDecisionResolver.resolve({
          text: phrase,
          language: 'en',
          productContext: activeProductContext,
          ecommerceParams: params,
          isEcommerceEnabled: true
        });
        expect(decision.intent).toBe('BUY_INTENT');
        expect(decision.productName).toBe(expectedProd);
        expect(decision.productId).toBeNull();
      });
    });
  });

  describe('5. Negative Collision Disambiguation', () => {
    it('does NOT misclassify recommendation questions as BUY_INTENT', () => {
      const phrases = [
        'شنو نشري؟',
        'شنو أحسن لابتوب؟',
        'شنو أحسن حاجة نشري؟',
        'شنو تنصحني نشري؟',
        'achno nchri?',
        'which laptop should I buy?',
        'what should I buy?'
      ];

      phrases.forEach(phrase => {
        const params = EcommerceIntentParser.parse(phrase, activeProductContext, 'ar');
        expect(params.intent).toBe('RECOMMENDATION');
        expect(params.intent).not.toBe('BUY_INTENT');
      });
    });

    it('does NOT misclassify price / availability / search as BUY_INTENT', () => {
      expect(EcommerceIntentParser.parse('how much is it?', activeProductContext, 'en').intent).toBe('PRICE');
      expect(EcommerceIntentParser.parse('شحال الثمن؟', activeProductContext, 'ar').intent).toBe('PRICE');
      expect(EcommerceIntentParser.parse('is it in stock?', activeProductContext, 'en').intent).toBe('AVAILABILITY');
      expect(EcommerceIntentParser.parse('واش كاين؟', activeProductContext, 'ar').intent).toBe('AVAILABILITY');
      expect(EcommerceIntentParser.parse('show me hoodies', activeProductContext, 'en').intent).toBe('PRODUCT_SEARCH');
      expect(EcommerceIntentParser.parse('وريني هادشي', activeProductContext, 'ar').intent).toBe('PRODUCT_SEARCH');
    });

    it('does NOT misclassify returns or tracking inquiries as BUY_INTENT', () => {
      const ret = EcommerceIntentParser.parse('بغيت نرجع هادشي', activeProductContext, 'ar');
      expect(ret.intent).not.toBe('BUY_INTENT');

      const tracking = EcommerceIntentParser.parse('where is my order?', activeProductContext, 'en');
      expect(tracking.intent).not.toBe('BUY_INTENT');
    });
  });
});
