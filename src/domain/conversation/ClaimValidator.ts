/**
 * ClaimValidator.ts
 *
 * Deterministic Post-Generation Factual Claim Validator.
 * Extracts and verifies factual claims against the authoritative ClaimEvidenceRegistry.
 * Enforces Invariants A-H:
 * - Invariant A: Factual prices must match authoritative ProductFact / variant / shipping fee.
 * - Invariant B: Stock quantities must match authoritative ProductFact or Variant.
 * - Invariant C: SKUs must match catalog data.
 * - Invariant D: Product attribute claims (material, features, fit) must exist in catalog evidence.
 * - Invariant E: Policy claims (return window, delivery fee, tracking method) must exist in retrieved Knowledge evidence.
 * - Invariant F: Recommendation explanations must only cite attributes that contributed to ranking.
 * - Invariant G: Comparison claims must be derived only from the compared ProductFacts.
 * - Invariant H: LLM cannot introduce a new unsupported factual attribute.
 *
 * 100% deterministic, 0 LLM calls, 0 embeddings.
 */

import { FactualClaim, ClaimValidationResult, ClaimType } from './ClaimGrounding';
import { ClaimEvidenceRegistry, GroundedProductRecord } from './ClaimEvidenceRegistry';

export class ClaimValidator {
  /**
   * Validates all factual claims in candidate text against the authoritative Evidence Registry.
   * Returns a ClaimValidationResult with detailed claim accounting and sanitized output text.
   */
  public static validate(
    candidateText: string,
    registry: ClaimEvidenceRegistry,
    options?: { fallbackLanguage?: 'en' | 'fr' | 'ar' | 'darija'; fallbackScript?: 'latin' | 'arabic' | 'arabizi' }
  ): ClaimValidationResult {
    if (!candidateText || !candidateText.trim()) {
      return {
        isValid: true,
        claims: [],
        groundedClaims: [],
        unsupportedClaims: [],
        sanitizedText: candidateText,
        claimCount: 0,
        groundedClaimCount: 0,
        unsupportedClaimCount: 0,
        removedClaimCount: 0,
        groundingFallbackUsed: false,
        groundingSourceTypes: []
      };
    }

    const claims: FactualClaim[] = [];
    const sourceTypes = new Set<string>();
    let sanitizedText = candidateText;
    let removedClaimCount = 0;
    const products = registry.getAllProducts();

    // 1. PRICE CLAIMS
    const priceRegex = /(?:^|[^\d.])(\d+(?:\.\d+)?)\s*(?:MAD|USD|EUR|درهم|DH)(?=$|[^\p{L}\p{N}])/gui;
    let priceMatch: RegExpExecArray | null;
    while ((priceMatch = priceRegex.exec(candidateText)) !== null) {
      const numVal = parseFloat(priceMatch[1]);
      const fullText = priceMatch[0].trim();

      // Check if price is grounded in product price, variant price, or shipping fee in knowledge
      const isProductPrice = registry.isPriceGrounded(numVal);
      const isShippingPrice = registry.isPolicyFactGrounded('SHIPPING', numVal);
      const isKnowledgePrice = registry.getAllKnowledgeText().includes(String(numVal));
      const grounded = isProductPrice || isShippingPrice || isKnowledgePrice;

      const claim: FactualClaim = {
        text: fullText,
        type: 'PRICE',
        value: numVal,
        sourceType: isProductPrice ? 'PRODUCT' : (isShippingPrice || isKnowledgePrice ? 'KNOWLEDGE' : 'UNGROUNDED'),
        grounded,
        unsupportedReason: grounded ? undefined : `Price ${numVal} not found in catalog or store knowledge`
      };
      claims.push(claim);
      if (grounded) sourceTypes.add(claim.sourceType);
      else {
        // Enforce Invariant A: Replace wrong price with authoritative product price if 1 primary product exists
        if (products.length === 1) {
          const authPrice = `${products[0].price} ${products[0].currency}`;
          sanitizedText = sanitizedText.replace(new RegExp(`(?:^|[^\\d.])${numVal}\\s*(?:MAD|USD|EUR|درهم|DH)`, 'gi'), ` ${authPrice}`);
          removedClaimCount++;
        }
      }
    }

    // 2. STOCK CLAIMS
    const stockRegex = /(?:^|[^\d.])(\d+)\s*(?:available|in stock|disponibles|en stock|قطع|قطعة|بياسات|habba)(?=$|[^\p{L}\p{N}])/gui;
    let stockMatch: RegExpExecArray | null;
    while ((stockMatch = stockRegex.exec(candidateText)) !== null) {
      const numVal = parseInt(stockMatch[1], 10);
      const fullText = stockMatch[0].trim();
      const grounded = registry.isStockGrounded(numVal);

      const claim: FactualClaim = {
        text: fullText,
        type: 'STOCK',
        value: numVal,
        sourceType: grounded ? 'PRODUCT' : 'UNGROUNDED',
        grounded,
        unsupportedReason: grounded ? undefined : `Stock quantity ${numVal} not supported by catalog facts`
      };
      claims.push(claim);
      if (grounded) sourceTypes.add('PRODUCT');
      else {
        // Enforce Invariant B: Correct stock quantity to authoritative availableStock
        if (products.length === 1) {
          sanitizedText = sanitizedText.replace(new RegExp(`(?:^|[^\\d.])${numVal}\\s*(?=available|in stock|disponibles|en stock|قطع|قطعة|بياسات|habba)`, 'gi'), ` ${products[0].stock} `);
          removedClaimCount++;
        }
      }
    }

    // 3. SKU CLAIMS
    const skuRegex = /\b([A-Z0-9]{3,}-[A-Z0-9-]{3,})\b/g;
    let skuMatch: RegExpExecArray | null;
    while ((skuMatch = skuRegex.exec(candidateText)) !== null) {
      const skuVal = skuMatch[1];
      const grounded = registry.isSkuGrounded(skuVal);

      const claim: FactualClaim = {
        text: skuVal,
        type: 'SKU',
        value: skuVal,
        sourceType: grounded ? 'PRODUCT' : 'UNGROUNDED',
        grounded,
        unsupportedReason: grounded ? undefined : `SKU ${skuVal} does not exist in catalog`
      };
      claims.push(claim);
      if (grounded) sourceTypes.add('PRODUCT');
      else {
        // Enforce Invariant C: Remove unsupported SKU
        sanitizedText = sanitizedText.replace(skuVal, '').replace(/\s{2,}/g, ' ');
        removedClaimCount++;
      }
    }

    // 4. MATERIAL & COMPOSITION CLAIMS
    const materialTerms = [
      { key: 'cotton', patterns: ['100% cotton', 'cotton', 'قطن', 'coton'] },
      { key: 'fleece', patterns: ['fleece', 'molleton', 'صوف'] },
      { key: 'wool', patterns: ['wool', 'laine', 'صوف'] },
      { key: 'polyester', patterns: ['polyester', 'بوليستر'] },
      { key: 'nylon', patterns: ['nylon', 'نايلون'] },
      { key: 'leather', patterns: ['genuine leather', 'leather', 'cuir', 'جلد'] },
      { key: 'silk', patterns: ['silk', 'soie', 'حرير'] },
      { key: 'linen', patterns: ['linen', 'lin', 'كتان'] },
      { key: 'denim', patterns: ['denim', 'جينز'] }
    ];

    for (const mat of materialTerms) {
      for (const pat of mat.patterns) {
        const matPattern = new RegExp(`(?:^|[^\\p{L}\\p{N}])${pat}(?=$|[^\\p{L}\\p{N}])`, 'gui');
        if (matPattern.test(candidateText)) {
          const grounded = registry.isMaterialGrounded(mat.key);
          const claim: FactualClaim = {
            text: pat,
            type: 'MATERIAL',
            value: mat.key,
            sourceType: grounded ? 'PRODUCT' : 'UNGROUNDED',
            grounded,
            unsupportedReason: grounded ? undefined : `Material ${mat.key} is not in catalog description`
          };
          claims.push(claim);
          if (grounded) sourceTypes.add('PRODUCT');
          else {
            // Enforce Invariant D: Strip unsupported material claim clause
            sanitizedText = this.stripUnsupportedClause(sanitizedText, matPattern);
            removedClaimCount++;
          }
          break;
        }
      }
    }

    // 5. PERFORMANCE / WEATHER CLAIMS (e.g. waterproof, windbreaker, cold warmth)
    const featureTerms = [
      { key: 'waterproof', patterns: ['100% waterproof', 'waterproof', 'water-resistant', 'مقاوم للماء', 'ضد الماء', 'imperméable'] },
      { key: 'windbreaker', patterns: ['windbreaker', 'coupe-vent', 'واقي من الرياح'] },
      { key: 'thermal', patterns: ['heavyweight fleece', 'extreme cold', 'warm winter', 'فصل الشتاء البارد', 'البرد د الشتا'] }
    ];

    for (const feat of featureTerms) {
      for (const pat of feat.patterns) {
        const regex = new RegExp(`(?:^|[^\\p{L}\\p{N}])${pat}(?=$|[^\\p{L}\\p{N}])`, 'gui');
        if (regex.test(candidateText)) {
          const grounded = registry.isFeatureGrounded(feat.key);
          const claim: FactualClaim = {
            text: pat,
            type: 'PERFORMANCE',
            value: feat.key,
            sourceType: grounded ? 'PRODUCT' : 'UNGROUNDED',
            grounded,
            unsupportedReason: grounded ? undefined : `Performance feature ${feat.key} not present in catalog`
          };
          claims.push(claim);
          if (grounded) sourceTypes.add('PRODUCT');
          else {
            // Enforce Invariant D: Strip ungrounded performance claim
            sanitizedText = this.stripUnsupportedClause(sanitizedText, regex);
            removedClaimCount++;
          }
          break;
        }
      }
    }

    // 6. POLICY CLAIMS: RETURN WINDOW
    const isReturnContext = /(?:return|retour|remboursement|إرجاع|استرجاع|استبدال|rtour)/i.test(candidateText);
    if (isReturnContext) {
      const returnDaysRegex = /(?:^|[^\d.])(\d+)\s*(?:days|jours|يوم|أيام|nhar)(?=$|[^\p{L}\p{N}])/gui;
      let returnMatch: RegExpExecArray | null;
      while ((returnMatch = returnDaysRegex.exec(candidateText)) !== null) {
        const numVal = parseInt(returnMatch[1], 10);
        const fullText = returnMatch[0].trim();
        const grounded = registry.isPolicyFactGrounded('RETURNS', numVal) || registry.getAllKnowledgeText().includes(String(numVal));

        const claim: FactualClaim = {
          text: fullText,
          type: 'RETURNS',
          value: numVal,
          sourceType: grounded ? 'KNOWLEDGE' : 'UNGROUNDED',
          grounded,
          unsupportedReason: grounded ? undefined : `Return window of ${numVal} days not supported by store policy`
        };
        claims.push(claim);
        if (grounded) sourceTypes.add('KNOWLEDGE');
        else {
          // Enforce Invariant E: Correct return window if knowledge has authoritative days
          const authMatch = registry.getAllKnowledgeText().match(/(?:^|[^\d.])(\d+)\s*(?:days|jours|يوم|أيام|nhar)/i);
          if (authMatch && authMatch[1]) {
            sanitizedText = sanitizedText.replace(new RegExp(`(?:^|[^\\d.])${numVal}\\s*(?=days|jours|يوم|أيام|nhar)`, 'gi'), ` ${authMatch[1]} `);
            removedClaimCount++;
          }
        }
      }
    }

    // 7. POLICY CLAIMS: SHIPPING DURATION & TRACKING
    const trackingRegex = /\b(?:sms updates|tracking portal|portal|suivi par sms|تتبع عبر الرسائل|بوابة التتبع)\b/gi;
    let trackMatch: RegExpExecArray | null;
    while ((trackMatch = trackingRegex.exec(candidateText)) !== null) {
      const fullText = trackMatch[0];
      const grounded = registry.isPolicyFactGrounded('TRACKING', fullText) || registry.getAllKnowledgeText().toLowerCase().includes('track');

      const claim: FactualClaim = {
        text: fullText,
        type: 'TRACKING',
        value: fullText,
        sourceType: grounded ? 'KNOWLEDGE' : 'UNGROUNDED',
        grounded,
        unsupportedReason: grounded ? undefined : `Tracking feature '${fullText}' not found in policy knowledge`
      };
      claims.push(claim);
      if (grounded) sourceTypes.add('KNOWLEDGE');
    }

    // 8. COMPARISON CLAIMS (Derived from compared ProductFacts)
    const compProducts = registry.getComparisonProducts();
    if (compProducts.length >= 2) {
      sourceTypes.add('COMPARISON');
      // Verify price ordering if cheaper / more expensive is asserted
      const cheaperPattern = /(?:is cheaper than|أرخص من|moins cher que)/i;
      if (cheaperPattern.test(candidateText)) {
        // Mathematical validation of Invariant G
        const prodA = compProducts[0];
        const prodB = compProducts[1];
        const isAcheaperThanB = prodA.price < prodB.price;
        const claim: FactualClaim = {
          text: 'price comparison',
          type: 'PRICE',
          sourceType: 'COMPARISON',
          grounded: isAcheaperThanB,
          unsupportedReason: isAcheaperThanB ? undefined : `Comparison claim contradicted by prices (${prodA.price} vs ${prodB.price})`
        };
        claims.push(claim);
      }
    }

    // 9. RECOMMENDATION CLAIMS (Must map to ranking matched criteria)
    const recRationaleMatch = candidateText.match(/(?:best for|recommandé pour|كنرشحو|نرشح لك|أحسن|افضل)\s+([a-zA-Z\u0600-\u06FF\s-]+?)(?:\s+(?:because|car|حيث|لأنه|بثمن|at|\.|\n|$))/i);
    if (recRationaleMatch && recRationaleMatch[1]) {
      const claimedCrit = recRationaleMatch[1].trim();
      if (products.length > 0) {
        const grounded = registry.isRecommendationGrounded(products[0].id, claimedCrit);
        const claim: FactualClaim = {
          text: claimedCrit,
          type: 'RECOMMENDATION',
          value: claimedCrit,
          sourceType: grounded ? 'RECOMMENDATION' : 'UNGROUNDED',
          grounded,
          unsupportedReason: grounded ? undefined : `Recommendation rationale '${claimedCrit}' not grounded in matched catalog attributes`
        };
        claims.push(claim);
        if (grounded) sourceTypes.add('RECOMMENDATION');
      }
    }

    const groundedClaims = claims.filter(c => c.grounded);
    const unsupportedClaims = claims.filter(c => !c.grounded);
    const isValid = unsupportedClaims.length === 0;

    let groundingFallbackUsed = false;
    // If multiple critical unsupported claims exist:
    if (!isValid && unsupportedClaims.length >= 2) {
      groundingFallbackUsed = true;
      sanitizedText = this.composeSafeGroundedFallback(registry, options?.fallbackLanguage || 'en', options?.fallbackScript || 'latin');
    }

    return {
      isValid,
      claims,
      groundedClaims,
      unsupportedClaims,
      sanitizedText: sanitizedText.trim(),
      claimCount: claims.length,
      groundedClaimCount: groundedClaims.length,
      unsupportedClaimCount: unsupportedClaims.length,
      removedClaimCount,
      groundingFallbackUsed,
      groundingSourceTypes: Array.from(sourceTypes)
    };
  }

  /**
   * Helper to strip an unsupported clause safely without breaking sentence structure.
   */
  private static stripUnsupportedClause(text: string, regex: RegExp): string {
    return text
      .replace(regex, '')
      .replace(/,\s*,/g, ',')
      .replace(/\s{2,}/g, ' ')
      .replace(/\(\s*\)/g, '')
      .trim();
  }

  /**
   * Deterministic safe grounded fallback composed strictly from ClaimEvidenceRegistry.
   */
  public static composeSafeGroundedFallback(
    registry: ClaimEvidenceRegistry,
    lang: 'en' | 'fr' | 'ar' | 'darija' = 'en',
    script: 'latin' | 'arabic' | 'arabizi' = 'latin'
  ): string {
    const products = registry.getAllProducts();
    if (products.length > 0) {
      const p = products[0];
      if (lang === 'fr') {
        return `${p.names[0] || 'Ce produit'} est disponible au prix de ${p.price} ${p.currency} (${p.inStock ? `en stock` : 'en rupture de stock'}).`;
      }
      if (lang === 'ar') {
        return `منتج ${p.names[0] || 'هذا المنتج'} سعره ${p.price} ${p.currency} (${p.inStock ? 'متوفر في المخزون' : 'غير متوفر'}).`;
      }
      if (lang === 'darija') {
        if (script === 'arabizi') {
          return `L-produit ${p.names[0] || 'had l-produit'} taman dyalo ${p.price} ${p.currency} (${p.inStock ? 'kayn f stock' : 'makaynch'}).`;
        }
        return `المنتوج ${p.names[0] || 'هاد المنتوج'} الثمن ديالو ${p.price} ${p.currency} (${p.inStock ? 'كاين فالمخزون' : 'ما كاينش'}).`;
      }
      return `${p.names[0] || 'This product'} is priced at ${p.price} ${p.currency} (${p.inStock ? `in stock` : 'out of stock'}).`;
    }

    const knowledge = registry.getAllKnowledgeText();
    if (knowledge) {
      return knowledge.split('\n')[0] || knowledge;
    }

    return lang === 'fr'
      ? "Désolé, les informations demandées ne sont pas disponibles actuellement."
      : (lang === 'ar' ? "عذراً، المعلومات المطلوبة غير متوفرة حالياً." : "Information is currently not available.");
  }
}
