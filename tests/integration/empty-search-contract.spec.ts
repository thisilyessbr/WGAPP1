import { describe, it, expect } from 'vitest';
import { EcommerceIntentParser } from '../../src/domain/ecommerce/EcommerceIntent';
import { TurnDecisionResolver } from '../../src/domain/conversation/TurnDecision';
import { AnswerComposer } from '../../src/domain/conversation/AnswerComposer';

describe('Empty Search Target Presentation Contract (RC-ECOM-4)', () => {
  describe('A. Explicit unknown product + intent verb', () => {
    it('should present cleaned product target without intent verb (EN)', () => {
      const text = 'I want Naruto sneakers';
      const parsed = EcommerceIntentParser.parse(text, null, 'en');
      const decision = TurnDecisionResolver.resolve({ text, language: 'en', ecommerceParams: parsed });
      const target = AnswerComposer.getSearchTarget(decision, 'en', 'latin');
      const response = AnswerComposer.composeEcommerce({
        turnDecision: decision,
        productFacts: [],
        responseLanguage: 'en',
        responseScript: 'latin'
      });

      expect(target).toBe('Naruto sneakers');
      expect(response).toContain('Naruto sneakers');
      expect(response).not.toContain('I want');
    });

    it('should present cleaned product target without intent verb (FR)', () => {
      const text = 'Je cherche des figurines Dragon Ball';
      const parsed = EcommerceIntentParser.parse(text, null, 'fr');
      const decision = TurnDecisionResolver.resolve({ text, language: 'fr', ecommerceParams: parsed });
      const target = AnswerComposer.getSearchTarget(decision, 'fr', 'latin');
      const response = AnswerComposer.composeEcommerce({
        turnDecision: decision,
        productFacts: [],
        responseLanguage: 'fr',
        responseScript: 'latin'
      });

      expect(target).toContain('figurines Dragon Ball');
      expect(response).toContain('figurines Dragon Ball');
      expect(response).not.toContain('Je cherche');
    });
  });

  describe('B. Explicit unknown product + question wrapper', () => {
    it('should strip question scaffolding and present clean product target (EN)', () => {
      const text = "Do you sell Levi's jeans?";
      const parsed = EcommerceIntentParser.parse(text, null, 'en');
      const decision = TurnDecisionResolver.resolve({ text, language: 'en', ecommerceParams: parsed });
      const target = AnswerComposer.getSearchTarget(decision, 'en', 'latin');
      const response = AnswerComposer.composeEcommerce({
        turnDecision: decision,
        productFacts: [],
        responseLanguage: 'en',
        responseScript: 'latin'
      });

      expect(target).toContain('jeans');
      expect(response).not.toContain('Do you sell');
      expect(response).not.toContain('?');
    });

    it('should strip availability question wrapper in Darija (Arabic script)', () => {
      const text = 'واش عندكم فيقورات ناروتو؟';
      const parsed = EcommerceIntentParser.parse(text, null, 'darija');
      const decision = TurnDecisionResolver.resolve({ text, language: 'darija', ecommerceParams: parsed });
      const target = AnswerComposer.getSearchTarget(decision, 'darija', 'arabic');
      const response = AnswerComposer.composeEcommerce({
        turnDecision: decision,
        productFacts: [],
        responseLanguage: 'darija',
        responseScript: 'arabic'
      });

      expect(target).toBe('فيقورات ناروتو');
      expect(response).toContain('فيقورات ناروتو');
      expect(response).not.toContain('واش عندكم');
      expect(response).not.toContain('؟');
    });
  });

  describe('C. Unknown category search', () => {
    it('should present clean category target without conversational wrapper', () => {
      const text = 'Do you have any sunglasses?';
      const parsed = EcommerceIntentParser.parse(text, null, 'en');
      const decision = TurnDecisionResolver.resolve({ text, language: 'en', ecommerceParams: parsed });
      const target = AnswerComposer.getSearchTarget(decision, 'en', 'latin');
      const response = AnswerComposer.composeEcommerce({
        turnDecision: decision,
        productFacts: [],
        responseLanguage: 'en',
        responseScript: 'latin'
      });

      expect(target).toBe('sunglasses');
      expect(response).toContain('sunglasses');
      expect(response).not.toContain('Do you have');
      expect(response).not.toContain('any sunglasses');
    });
  });

  describe('D. Multilingual empty search', () => {
    it('should handle French empty search target correctly', () => {
      const text = 'Je cherche des posters One Piece';
      const parsed = EcommerceIntentParser.parse(text, null, 'fr');
      const decision = TurnDecisionResolver.resolve({ text, language: 'fr', ecommerceParams: parsed });
      const target = AnswerComposer.getSearchTarget(decision, 'fr', 'latin');
      const response = AnswerComposer.composeEcommerce({
        turnDecision: decision,
        productFacts: [],
        responseLanguage: 'fr',
        responseScript: 'latin'
      });

      expect(target).toBe('posters One Piece');
      expect(response).toContain('Désolé');
      expect(response).toContain('posters One Piece');
      expect(response).not.toContain('Je cherche');
    });

    it('should handle Arabic empty search target correctly', () => {
      const text = 'أريد مجسمات غوكو';
      const parsed = EcommerceIntentParser.parse(text, null, 'ar');
      const decision = TurnDecisionResolver.resolve({ text, language: 'ar', ecommerceParams: parsed });
      const target = AnswerComposer.getSearchTarget(decision, 'ar', 'arabic');
      const response = AnswerComposer.composeEcommerce({
        turnDecision: decision,
        productFacts: [],
        responseLanguage: 'ar',
        responseScript: 'arabic'
      });

      expect(target).toBe('مجسمات غوكو');
      expect(response).toContain('مجسمات غوكو');
      expect(response).not.toContain('أريد');
    });
  });

  describe('E. Arabizi empty search', () => {
    it('should present clean target in Arabizi without scaffolding', () => {
      const text = 'bghit chi casquette luffy';
      const parsed = EcommerceIntentParser.parse(text, null, 'darija');
      const decision = TurnDecisionResolver.resolve({ text, language: 'darija', script: 'arabizi', ecommerceParams: parsed });
      const target = AnswerComposer.getSearchTarget(decision, 'darija', 'arabizi');
      const response = AnswerComposer.composeEcommerce({
        turnDecision: decision,
        productFacts: [],
        responseLanguage: 'darija',
        responseScript: 'arabizi'
      });

      expect(target).toBe('casquette luffy');
      expect(response).toContain('casquette luffy');
      expect(response).not.toContain('bghit');
      expect(response).not.toContain('chi casquette');
    });
  });

  describe('F. Constrained empty search', () => {
    it('should present meaningful target with color and category constraints (EN)', () => {
      const text = 'looking for a black hoodie under 300';
      const parsed = EcommerceIntentParser.parse(text, null, 'en');
      const decision = TurnDecisionResolver.resolve({ text, language: 'en', ecommerceParams: parsed });
      const target = AnswerComposer.getSearchTarget(decision, 'en', 'latin');
      const response = AnswerComposer.composeEcommerce({
        turnDecision: decision,
        productFacts: [],
        responseLanguage: 'en',
        responseScript: 'latin'
      });

      expect(target).toBe('Black Hoodies');
      expect(response).toContain('Black Hoodies');
      expect(response).not.toContain('looking for');
      expect(response).not.toContain('under 300');
    });
  });

  describe('G. Empty search after active product context', () => {
    it('should clear active context and not leak previous product ID', () => {
      const activeCtx = { selectedProductId: 'prod-hoodie-1', selectedSku: 'ANV-H001' };
      const text = 'bghit casquette dragon ball';
      const parsed = EcommerceIntentParser.parse(text, activeCtx, 'darija');
      const decision = TurnDecisionResolver.resolve({
        text,
        language: 'darija',
        productContext: activeCtx,
        ecommerceParams: parsed
      });

      // Active product must be cleared because user explicitly searched for a new target
      expect(decision.productId).toBeNull();
      expect(decision.domain).toBe('ECOMMERCE');
      expect(decision.intent).toBe('PRODUCT_SEARCH');

      const target = AnswerComposer.getSearchTarget(decision, 'darija', 'arabizi');
      expect(target).toBe('casquette dragon ball');
    });
  });

  describe('H & I. Follow-up after empty search & no stale context leakage', () => {
    it('should preserve null context and not revive stale products', () => {
      const emptySearchCtx = {
        selectedProductId: null,
        unresolvedTarget: {
          rawQuery: 'bghit casquette dragon ball',
          normalizedEntity: 'casquette dragon ball',
          reason: 'NOT_FOUND',
          timestamp: Date.now()
        }
      };

      const followUp = 'wa wach kaynin f noir?';
      const parsed = EcommerceIntentParser.parse(followUp, emptySearchCtx, 'darija');
      const decision = TurnDecisionResolver.resolve({
        text: followUp,
        language: 'darija',
        productContext: emptySearchCtx,
        ecommerceParams: parsed
      });

      // Should not attach to any stale product
      expect(decision.productId).toBeNull();
    });
  });

  describe('J. No raw conversational wrapper in final response', () => {
    it('should never contain raw conversational scaffolding inside quotation marks', () => {
      const testCases = [
        { text: 'I want Naruto sneakers', lang: 'en', script: 'latin' },
        { text: 'Je cherche des figurines Dragon Ball', lang: 'fr', script: 'latin' },
        { text: 'واش عندكم فيقورات ناروتو؟', lang: 'darija', script: 'arabic' },
        { text: 'bghit chi casquette luffy', lang: 'darija', script: 'arabizi' },
        { text: 'looking for a black hoodie under 300', lang: 'en', script: 'latin' }
      ];

      for (const tc of testCases) {
        const parsed = EcommerceIntentParser.parse(tc.text, null, tc.lang as any);
        const decision = TurnDecisionResolver.resolve({
          text: tc.text,
          language: tc.lang as any,
          script: tc.script,
          ecommerceParams: parsed
        });
        const target = AnswerComposer.getSearchTarget(decision, tc.lang, tc.script);

        // Target must not contain raw prefixes
        expect(target).not.toMatch(/^(?:i want|je cherche|bghit|looking for|do you have|واش عندكم|أريد)\b/i);
        expect(target).not.toMatch(/[?؟]/);
      }
    });
  });
});
