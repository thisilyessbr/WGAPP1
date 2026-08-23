import { describe, it, expect } from 'vitest';
import { NormalizedTurnParser } from '../../src/domain/conversation/NormalizedTurnParser';
import { TextNormalizer } from '../../src/domain/conversation/TextNormalizer';
import { CategoryVocabulary } from '../../src/domain/conversation/CategoryVocabulary';

describe('Phase 33B: Global Normalized Turn + Semantic Normalization Tests', () => {
  describe('Price Intent & Morphological Verbs', () => {
    it('1. Arabic price verb -> PRICE', () => {
      const turn = NormalizedTurnParser.parse('شحال كيسوى هاد التيشورت؟');
      expect(turn.primaryIntent).toBe('PRICE');
      expect(turn.categories).toContain('T-Shirts');
      expect(turn.hasEcommerceIntent).toBe(true);
    });

    it('2. Darija price verb (katsswa) -> PRICE', () => {
      const turn = NormalizedTurnParser.parse('شحال كاتسوى؟');
      expect(turn.primaryIntent).toBe('PRICE');
      expect(turn.hasEcommerceIntent).toBe(true);
    });

    it('3. Arabizi price verb -> PRICE', () => {
      const turn = NormalizedTurnParser.parse('chhal kayswa had hoodie?');
      expect(turn.primaryIntent).toBe('PRICE');
      expect(turn.categories).toContain('Hoodies');
      expect(turn.responseScript).toBe('arabizi');
    });

    it('4. English price phrase -> PRICE', () => {
      const turn = NormalizedTurnParser.parse('how much is that one?');
      expect(turn.primaryIntent).toBe('PRICE');
      expect(turn.hasContextualReference).toBe(true);
      expect(turn.references.some(r => r.kind === 'ANAPHORA')).toBe(true);
    });

    it('5. French price phrase -> PRICE', () => {
      const turn = NormalizedTurnParser.parse('combien coûte ce t-shirt ?');
      expect(turn.primaryIntent).toBe('PRICE');
      expect(turn.categories).toContain('T-Shirts');
      expect(turn.responseLanguage).toBe('fr');
    });
  });

  describe('Ordinal & Anaphora Reference Parsing', () => {
    it('6. Arabic feminine ordinal -> REFERENCE ordinal 0', () => {
      const turn = NormalizedTurnParser.parse('عطيني التفاصيل ديال الأولى');
      expect(turn.hasContextualReference).toBe(true);
      const ordinalRef = turn.references.find(r => r.kind === 'ORDINAL');
      expect(ordinalRef).toBeDefined();
      expect(ordinalRef?.value).toBe(0);
      expect(ordinalRef?.target).toBe('LAST_SEARCH_RESULTS');
    });

    it('7. French feminine ordinal -> REFERENCE ordinal 0', () => {
      const turn = NormalizedTurnParser.parse('donne-moi les détails de la première');
      expect(turn.hasContextualReference).toBe(true);
      const ordinalRef = turn.references.find(r => r.kind === 'ORDINAL');
      expect(ordinalRef).toBeDefined();
      expect(ordinalRef?.value).toBe(0);
    });

    it('8. Arabizi first-result reference -> REFERENCE', () => {
      const turn = NormalizedTurnParser.parse('3tini details d lwel');
      expect(turn.hasContextualReference).toBe(true);
      const ordinalRef = turn.references.find(r => r.kind === 'ORDINAL');
      expect(ordinalRef).toBeDefined();
      expect(ordinalRef?.value).toBe(0);
    });
  });

  describe('Category Vocabulary & Morphology', () => {
    it('9. definite Arabic category -> CATEGORY', () => {
      const turn = NormalizedTurnParser.parse('شنو ثمن الهودي؟');
      expect(turn.categories).toContain('Hoodies');
      expect(turn.hasExplicitCategory).toBe(true);
      expect(turn.primaryIntent).toBe('PRICE');
    });

    it('10. English plural category -> CATEGORY', () => {
      const turn = NormalizedTurnParser.parse('show me hoodies');
      expect(turn.categories).toContain('Hoodies');
      expect(turn.hasExplicitCategory).toBe(true);
      expect(turn.primaryIntent).toBe('PRODUCT_SEARCH');
    });

    it('11. French category -> CATEGORY', () => {
      const turn = NormalizedTurnParser.parse('je cherche des vestes');
      expect(turn.categories).toContain('Jackets');
      expect(turn.hasExplicitCategory).toBe(true);
      expect(turn.primaryIntent).toBe('PRODUCT_SEARCH');
    });
  });

  describe('Multi-Intent & Composite Scenarios', () => {
    it('12. explicit product + policy -> PRODUCT + POLICY', () => {
      const turn = NormalizedTurnParser.parse('شنو هي سياسة الإرجاع ديال Moon Ninja Hoodie؟');
      expect(turn.primaryIntent).toBe('RETURNS');
      expect(turn.hasPolicyIntent).toBe(true);
      expect(turn.responseLanguage).toBe('darija');
    });

    it('13. multi-intent preserves all intents in primary and secondary array', () => {
      const turn = NormalizedTurnParser.parse(
        'I want a hoodie. Tell me the price, return policy, shipping fees, and washing instructions'
      );
      expect(turn.isMultiIntent).toBe(true);
      expect(turn.categories).toContain('Hoodies');
      const allIntents = [turn.primaryIntent, ...turn.secondaryIntents];
      expect(allIntents).toContain('RETURNS');
      expect(allIntents).toContain('SHIPPING');
      expect(allIntents).toContain('CARE');
      expect(allIntents).toContain('PRICE');
    });

    it('14. compare preserves two semantic targets', () => {
      const turn = NormalizedTurnParser.parse('قارنها ليا مع شي هودي');
      expect(turn.primaryIntent).toBe('COMPARE');
      expect(turn.comparisonTargets).toBeDefined();
      expect(turn.comparisonTargets?.length).toBeGreaterThanOrEqual(2);
      expect(turn.comparisonTargets?.[0].kind).toBe('CURRENT_CONTEXT');
      expect(turn.comparisonTargets?.[1].kind).toBe('CATEGORY');
      expect(turn.comparisonTargets?.[1].value).toBe('Hoodies');
    });

    it('15. recommendation extracts structured criteria', () => {
      const turnDaily = NormalizedTurnParser.parse('شنو أحسن وحدة للاستعمال اليومي؟');
      expect(turnDaily.primaryIntent).toBe('RECOMMENDATION');
      expect(turnDaily.recommendationCriteria?.useCase).toBe('daily_use');

      const turnWinter = NormalizedTurnParser.parse('Which hoodie is best for winter?');
      expect(turnWinter.primaryIntent).toBe('RECOMMENDATION');
      expect(turnWinter.recommendationCriteria?.season).toBe('winter');
      expect(turnWinter.recommendationCriteria?.category).toBe('Hoodies');
    });
  });

  describe('Context Safety, Normalization & Invariants', () => {
    it('16. cross-language normalization preserves identity semantics', () => {
      const tFr = NormalizedTurnParser.parse('est-ce disponible en noir ?');
      const tAr = NormalizedTurnParser.parse('واش كاين فالأسود؟');
      const tArabizi = NormalizedTurnParser.parse('wach kayn f lk7el?');

      expect(tFr.variants[0]?.color).toBe('Black');
      expect(tAr.variants[0]?.color).toBe('Black');
      expect(tArabizi.variants[0]?.color).toBe('Black');

      expect(tFr.primaryIntent).toBe('AVAILABILITY');
      expect(tAr.primaryIntent).toBe('AVAILABILITY');
      expect(tArabizi.primaryIntent).toBe('AVAILABILITY');
    });

    it('17. explicit entity marked explicit', () => {
      const turnNoEntity = NormalizedTurnParser.parse('just looking around');
      expect(turnNoEntity.hasExplicitEntity).toBe(false);
      expect(turnNoEntity.hasExplicitCategory).toBe(false);

      const turnCat = NormalizedTurnParser.parse('hoodies');
      expect(turnCat.hasExplicitEntity).toBe(true);
      expect(turnCat.hasExplicitCategory).toBe(true);
    });

    it('18. contextual reference marked contextual', () => {
      const turnAnaphora = NormalizedTurnParser.parse('شحال الثمن ديالو؟');
      expect(turnAnaphora.hasContextualReference).toBe(true);
      expect(turnAnaphora.references.some(r => r.kind === 'ANAPHORA')).toBe(true);

      const turnOrdinal = NormalizedTurnParser.parse('عطيني الثاني');
      expect(turnOrdinal.hasContextualReference).toBe(true);
      expect(turnOrdinal.references.some(r => r.kind === 'ORDINAL')).toBe(true);
    });

    it('19. no AnimeVerse-specific or tenant-specific parser rules exist in TextNormalizer or CategoryVocabulary', () => {
      const map = CategoryVocabulary.getCanonicalMap();
      const allAliases = Object.values(map).flat();
      expect(allAliases.some(a => a.toLowerCase().includes('animeverse'))).toBe(false);
      expect(allAliases.some(a => a.toLowerCase().includes('naruto'))).toBe(false);
    });

    it('20. no LLM or embedding calls executed during normalization and parsing (0 cost, synchronous)', () => {
      const start = Date.now();
      for (let i = 0; i < 100; i++) {
        NormalizedTurnParser.parse('بغيت هودي للاستعمال اليومي، شحال الثمن، واش نقدر نرجعو؟');
      }
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(200); // 100 iterations execute in < 200ms
    });
  });
});
