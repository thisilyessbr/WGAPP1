/**
 * ProductRecommendationService.ts
 *
 * Catalog-Constrained Deterministic Product Recommendation Engine.
 * Scores and ranks catalog products based strictly on authoritative catalog
 * attributes, tags, categories, variants, metadata, and budget constraints.
 * 100% deterministic, 0 LLM calls, 0 embeddings.
 */

import { ProductWithVariants } from './ProductRepository';
import { SupportedLanguage } from '../faq/FaqMatcher';
import { ProductLookupResult } from './EcommerceService';

export interface RecommendationCriteria {
  category?: string;
  budget?: number;
  color?: string;
  size?: string;
  searchKeywords?: string;
  attributeKeywords?: string;
  attributeName?: string;
  preferredAttributes?: Record<string, string | number | boolean>;
}

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

      // 1. In-stock weighting (+20 / -50)
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

      // 3. Budget Constraint Match (+15 / -30)
      const priceNum = Number(product.price);
      if (criteria.budget !== undefined && criteria.budget !== null) {
        if (priceNum <= criteria.budget) {
          score += 15;
          matchedReasons.push(`Within budget: ${priceNum} <= ${criteria.budget}`);
        } else {
          score -= 30; // Over budget penalty
        }
      }

      // 4. Variant Match (Color / Size) (+15 / -20)
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

      // 5. Metadata / Preferred Attributes / Tags Match (+25)
      const productMeta = (product.metadata as Record<string, any>) || {};
      const variantMeta = (selectedVariant?.metadata as Record<string, any>) || {};
      const combinedMeta = { ...productMeta, ...variantMeta };

      if (criteria.preferredAttributes && Object.keys(criteria.preferredAttributes).length > 0) {
        for (const [key, val] of Object.entries(criteria.preferredAttributes)) {
          if (combinedMeta[key] !== undefined) {
            const metaStr = String(combinedMeta[key]).toLowerCase();
            const valStr = String(val).toLowerCase();
            if (metaStr === valStr || metaStr.includes(valStr)) {
              score += 25;
              matchedReasons.push(`Attribute match: ${key}=${val}`);
            }
          }
        }
      }

      if (criteria.attributeName && combinedMeta[criteria.attributeName] !== undefined) {
        score += 25;
        matchedReasons.push(`Attribute match: ${criteria.attributeName}`);
      }

      // Metadata tags match
      const tags: string[] = Array.isArray(productMeta.tags) ? productMeta.tags : [];
      if (tags.length > 0 && (criteria.searchKeywords || criteria.attributeKeywords)) {
        const queryTerms = `${criteria.searchKeywords || ''} ${criteria.attributeKeywords || ''}`.toLowerCase().split(/\s+/).filter(t => t.length > 2);
        for (const tag of tags) {
          const tagLower = String(tag).toLowerCase();
          if (queryTerms.some(term => tagLower.includes(term) || term.includes(tagLower))) {
            score += 20;
            matchedReasons.push(`Tag match: ${tag}`);
            break;
          }
        }
      }

      // 6. Generic Product Name / Description Keyword Match (+15)
      const inquiryKeywords = (criteria.searchKeywords || criteria.attributeKeywords || '').toLowerCase().trim();
      if (inquiryKeywords) {
        const tokens = inquiryKeywords.split(/\s+/).filter(t => t.length > 2);
        if (tokens.length > 0) {
          const matchedToken = tokens.find(t => combinedText.includes(t));
          if (matchedToken) {
            score += 15;
            matchedReasons.push(`Keyword match: ${matchedToken}`);
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
      criteria.category || criteria.budget || criteria.color || criteria.size ||
      criteria.searchKeywords || criteria.attributeKeywords || criteria.attributeName ||
      (criteria.preferredAttributes && Object.keys(criteria.preferredAttributes).length > 0)
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
