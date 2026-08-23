/**
 * ProductRecommendationService.ts
 *
 * Catalog-Constrained Deterministic Product Recommendation Engine.
 * Scores and ranks catalog products based strictly on authoritative catalog
 * attributes, tags, categories, variants, and budget constraints.
 * 100% deterministic, 0 LLM calls, 0 embeddings.
 */

import { ProductWithVariants } from './ProductRepository';
import { RecommendationCriteria } from '../conversation/NormalizedTurn';
import { SupportedLanguage } from '../faq/FaqMatcher';
import { ProductLookupResult } from './EcommerceService';

export interface ScoredRecommendation {
  fact: ProductLookupResult;
  score: number;
  matchedReasons: string[];
}

export interface RecommendationResult {
  recommendations: ScoredRecommendation[];
  hasGroundedRecommendation: boolean;
  topFact: ProductLookupResult | null;
  rationale: string;
}

export class ProductRecommendationService {
  /**
   * Deterministically scores and ranks catalog products against explicit recommendation criteria.
   */
  public static rankProducts(
    products: ProductWithVariants[],
    criteria: RecommendationCriteria,
    lang: SupportedLanguage = 'en'
  ): RecommendationResult {
    if (!products || products.length === 0) {
      return {
        recommendations: [],
        hasGroundedRecommendation: false,
        topFact: null,
        rationale: 'NO_CATALOG_CANDIDATES'
      };
    }

    const scoredList: ScoredRecommendation[] = [];

    for (const product of products) {
      let score = 0;
      const matchedReasons: string[] = [];

      const locName = (product.nameLocalized as Record<string, string> | null)?.[lang] || product.name || '';
      const locDesc = (product.descriptionLocalized as Record<string, string> | null)?.[lang] || product.description || '';
      const combinedText = `${product.name} ${locName} ${product.description} ${locDesc} ${product.category || ''}`.toLowerCase();

      // 1. In-stock weighting
      const inStock = product.stock > 0;
      if (inStock) {
        score += 20;
      } else {
        score -= 50; // Penalize out of stock
      }

      // 2. Category Match (+30)
      if (criteria.category) {
        const catLower = criteria.category.toLowerCase();
        const prodCat = product.category?.toLowerCase() || '';
        if (prodCat.includes(catLower) || combinedText.includes(catLower)) {
          score += 30;
          matchedReasons.push(`Category: ${criteria.category}`);
        }
      }

      // 3. Use-Case Match (+25)
      if (criteria.useCase) {
        const useCasePatterns: Record<string, RegExp> = {
          daily_use: /(?:daily|everyday|all-day|tous\s+les\s+jours|quotidien|يومي|استعمال\s+يومي|للاستعمال\s+اليومي|كل\s+نهار|casual)/iu,
          sports: /(?:sport|sports|gym|running|workout|رياضة|رياضي)/iu,
          streetwear: /(?:streetwear|urban|style|anime|graphic)/iu
        };

        const pattern = useCasePatterns[criteria.useCase] || new RegExp(criteria.useCase, 'iu');
        if (pattern.test(combinedText)) {
          score += 25;
          matchedReasons.push(`Use-case: ${criteria.useCase}`);
        }
      }

      // 4. Season Match (+20)
      if (criteria.season) {
        const seasonPatterns: Record<string, RegExp> = {
          winter: /(?:winter|hiver|cold|warm|fleece|heavy|شتاء|برد|شتوي|ثقيل)/iu,
          summer: /(?:summer|été|light|breathable|صيف|صيفي|خفيف)/iu
        };

        const pattern = seasonPatterns[criteria.season] || new RegExp(criteria.season, 'iu');
        if (pattern.test(combinedText)) {
          score += 20;
          matchedReasons.push(`Season: ${criteria.season}`);
        }
      }

      // 5. Budget Constraint Match (+15)
      const priceNum = Number(product.price);
      if (criteria.budget !== undefined && criteria.budget !== null) {
        if (priceNum <= criteria.budget) {
          score += 15;
          matchedReasons.push(`Within budget: ${priceNum} <= ${criteria.budget}`);
        } else {
          score -= 30; // Over budget penalty
        }
      }

      // 6. Variant Match (Color / Size) (+15)
      let selectedVariant = null;
      let availableStock = product.stock;

      if (criteria.color || criteria.size) {
        if (product.variants && product.variants.length > 0) {
          const matching = product.variants.filter(v => {
            const matchColor = !criteria.color || (v.color && v.color.toLowerCase() === criteria.color.toLowerCase());
            const matchSize = !criteria.size || (v.size && v.size.toLowerCase() === criteria.size.toLowerCase());
            return matchColor && matchSize;
          });

          if (matching.length > 0) {
            selectedVariant = matching.find(v => v.stock > 0) || matching[0];
            availableStock = selectedVariant.stock;
            if (availableStock > 0) {
              score += 15;
              matchedReasons.push(`Variant available (${criteria.color || ''} ${criteria.size || ''})`.trim());
            }
          } else {
            score -= 20; // Requested variant does not exist
          }
        }
      }

      const fact: ProductLookupResult = {
        product,
        selectedVariant,
        effectivePrice: selectedVariant?.priceOverride ? Number(selectedVariant.priceOverride) : priceNum,
        currency: product.currency,
        inStock: availableStock > 0,
        availableStock,
        displayName: locName,
        displayDescription: locDesc
      };

      scoredList.push({
        fact,
        score,
        matchedReasons
      });
    }

    // Sort descending by score
    scoredList.sort((a, b) => b.score - a.score);

    const top = scoredList[0];
    const hasCriteriaSpecified = Boolean(
      criteria.category || criteria.useCase || criteria.season || criteria.budget || criteria.color || criteria.size
    );

    // Require positive score and at least 1 explicit criteria match if criteria were requested
    const hasGroundedRecommendation = Boolean(
      top &&
      top.fact.inStock &&
      top.score >= 20 &&
      (!hasCriteriaSpecified || top.matchedReasons.length > 0)
    );

    return {
      recommendations: scoredList,
      hasGroundedRecommendation,
      topFact: hasGroundedRecommendation ? top.fact : null,
      rationale: hasGroundedRecommendation ? top.matchedReasons.join(', ') : 'INSUFFICIENT_CATALOG_EVIDENCE'
    };
  }
}
