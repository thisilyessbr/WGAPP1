import { ProductRepository, ProductWithVariants, ProductFact } from './ProductRepository';
import { ProductVariant } from '@prisma/client';
import { SupportedLanguage } from '../faq/FaqMatcher';
import { ProductRecommendationService, RecommendationCriteria, RecommendationResult } from './ProductRecommendationService';

export type ProductLookupResult = ProductFact;
export type { ProductFact } from './ProductRepository';

export class EcommerceService {
  constructor(private productRepo: ProductRepository) {}

  /**
   * Resolves localized product display name.
   */
  getDisplayName(product: ProductWithVariants, lang: SupportedLanguage = 'en'): string {
    const loc = product.nameLocalized as Record<string, string> | null;
    return loc?.[lang] || loc?.en || product.name;
  }

  /**
   * Resolves localized product description.
   */
  getDisplayDescription(product: ProductWithVariants, lang: SupportedLanguage = 'en'): string {
    const loc = product.descriptionLocalized as Record<string, string> | null;
    return loc?.[lang] || loc?.en || product.description;
  }

  /**
   * Retrieves distinct active product categories for an account.
   */
  async getDistinctCategories(tenantId: string, accountId: string): Promise<string[]> {
    return this.productRepo.getDistinctCategories(tenantId, accountId);
  }

  /**
   * Looks up product by ID, SKU, name, or ordinal reference and resolves authoritative live price/stock.
   */
  async getProductFact(
    tenantId: string,
    accountId: string,
    identifier: { id?: string; sku?: string; name?: string; size?: string; color?: string },
    lang: SupportedLanguage = 'en'
  ): Promise<ProductLookupResult | null> {
    if (!tenantId || !accountId) return null;

    let product: ProductWithVariants | null = null;
    if (identifier.id) {
      product = await this.productRepo.findById(tenantId, accountId, identifier.id);
    }
    if (!product && identifier.sku) {
      product = await this.productRepo.findBySku(tenantId, accountId, identifier.sku);
    }
    if (!product && identifier.name) {
      product = await this.productRepo.findByName(tenantId, accountId, identifier.name);
      if (!product) {
        const searchResults = await this.productRepo.search({
          tenantId,
          accountId,
          query: identifier.name,
          limit: 1
        });
        if (searchResults && searchResults.length > 0) {
          product = searchResults[0];
        }
      }
      if (!product && typeof this.productRepo.matchCatalog === 'function') {
        product = await this.productRepo.matchCatalog(tenantId, accountId, identifier.name);
      }
    }

    if (!product) return null;

    // Resolve variant if size/color specified or if SKU was a variant SKU
    let selectedVariant: ProductVariant | null = null;
    let availableStock = product.stock;
    const isVariantRequested = Boolean(identifier.size || (identifier.color && identifier.color !== 'ALL'));

    if (isVariantRequested) {
      if (!product.variants || product.variants.length === 0) {
        // Product has no variants defined, but variant was requested -> unavailable!
        selectedVariant = null;
        availableStock = 0;
      } else {
        const matchingVariants = product.variants.filter(v => {
          const matchSize = !identifier.size || (v.size && v.size.toLowerCase() === identifier.size.toLowerCase());
          const matchColor = !identifier.color || identifier.color === 'ALL' || (v.color && (
            v.color.toLowerCase() === identifier.color.toLowerCase() ||
            v.color.toLowerCase().includes(identifier.color.toLowerCase()) ||
            identifier.color.toLowerCase().includes(v.color.toLowerCase())
          ));
          return matchSize && matchColor;
        });

        if (matchingVariants.length > 0) {
          // One variant cannot represent the stock of several colors/sizes.
          selectedVariant = matchingVariants.length === 1 ? matchingVariants[0] : null;
          if (identifier.size && identifier.color && identifier.color !== 'ALL') {
            availableStock = matchingVariants.reduce((sum, variant) => sum + variant.stock, 0);
          } else if (matchingVariants.length === 1) {
            availableStock = matchingVariants[0].stock;
          } else {
            availableStock = matchingVariants.reduce((sum, v) => sum + v.stock, 0);
          }
        } else {
          // Specific size/color variant does not exist
          selectedVariant = null;
          availableStock = 0;
        }
      }

      // Hard Variant Invariant Assertion:
      // If a variant was requested, product.stock must NEVER be returned as availableStock.
      if (availableStock < 0) {
        availableStock = 0;
      }
    } else if (product.variants && product.variants.length > 0 && identifier.sku) {
      const normSku = identifier.sku.trim().toUpperCase();
      selectedVariant = product.variants.find(v => v.sku.toUpperCase() === normSku) || null;
      if (selectedVariant) {
        availableStock = selectedVariant.stock;
      }
    }

    const effectivePrice = selectedVariant?.priceOverride
      ? Number(selectedVariant.priceOverride)
      : Number(product.price);

    const inStock = availableStock > 0;

    return {
      product,
      selectedVariant,
      effectivePrice,
      currency: product.currency,
      inStock,
      availableStock,
      displayName: this.getDisplayName(product, lang),
      displayDescription: this.getDisplayDescription(product, lang)
    };
  }

  /**
   * Searches catalog with filters (maxPrice, color, size, category) and returns live availability.
   */
  /** The product a customer message clearly names, in any language/script, or null. */
  async matchProductFromText(tenantId: string, accountId: string, text: string): Promise<{ id: string; name: string } | null> {
    if (!tenantId || !accountId || typeof this.productRepo.matchCatalog !== 'function') return null;
    const product = await this.productRepo.matchCatalog(tenantId, accountId, text);
    return product ? { id: product.id, name: product.name } : null;
  }

  async searchProducts(
    tenantId: string,
    accountId: string,
    query?: string,
    lang: SupportedLanguage = 'en',
    options?: { maxPrice?: number; color?: string; size?: string; category?: string; limit?: number }
  ): Promise<ProductLookupResult[]> {
    if (!tenantId || !accountId) return [];
    const products = await this.productRepo.search({
      tenantId,
      accountId,
      query,
      maxPrice: options?.maxPrice,
      color: options?.color,
      size: options?.size,
      category: options?.category,
      limit: options?.limit || 5
    });

    return products.map(product => {
      const hasVariantFilter = Boolean(options?.color || options?.size);
      const matchingVariants = hasVariantFilter ? product.variants.filter(v => {
          const matchSize = !options?.size || (v.size && v.size.toLowerCase() === options.size.toLowerCase());
          const matchColor = !options?.color || (v.color && (
            v.color.toLowerCase() === options.color.toLowerCase() ||
            v.color.toLowerCase().includes(options.color.toLowerCase()) ||
            options.color.toLowerCase().includes(v.color.toLowerCase())
          ));
          return matchSize && matchColor;
        }) : [];
      const selectedVariant: ProductVariant | null = matchingVariants.length === 1 ? matchingVariants[0] : null;

      const availableStock = hasVariantFilter
        ? matchingVariants.reduce((sum, variant) => sum + variant.stock, 0)
        : product.stock;
      const effectivePrice = selectedVariant?.priceOverride
        ? Number(selectedVariant.priceOverride)
        : Number(product.price);

      return {
        product,
        selectedVariant,
        effectivePrice,
        currency: product.currency,
        inStock: availableStock > 0,
        availableStock,
        displayName: this.getDisplayName(product, lang),
        displayDescription: this.getDisplayDescription(product, lang)
      };
    });
  }

  /**
   * Compares 2 or more products by identifiers/queries/categories and returns structured comparison facts.
   */
  async compareProducts(
    tenantId: string,
    accountId: string,
    targets: Array<{ id?: string; sku?: string; name?: string; category?: string; ordinalIndex?: number; color?: string; size?: string }>,
    lang: SupportedLanguage = 'en',
    contextProductIds?: string[]
  ): Promise<{ targets: ProductLookupResult[]; comparedAttributes: string[] }> {
    if (!tenantId || !accountId || !targets || targets.length === 0) {
      return { targets: [], comparedAttributes: [] };
    }

    const results: ProductLookupResult[] = [];
    const seenIds = new Set<string>();

    for (const t of targets) {
      let fact: ProductLookupResult | null = null;

      // 1. Explicit ID/SKU/name
      if (t.id || t.sku || t.name) {
        fact = await this.getProductFact(tenantId, accountId, { id: t.id, sku: t.sku, name: t.name, color: t.color, size: t.size }, lang);
      }
      // 2. Ordinal reference against search results
      else if (t.ordinalIndex !== undefined && t.ordinalIndex !== null && contextProductIds && contextProductIds[t.ordinalIndex]) {
        fact = await this.getProductFact(tenantId, accountId, { id: contextProductIds[t.ordinalIndex], color: t.color, size: t.size }, lang);
      }
      // 3. Category target
      else if (t.category) {
        const catProducts = await this.searchProducts(tenantId, accountId, undefined, lang, { category: t.category, limit: 1 });
        if (catProducts.length > 0) {
          fact = catProducts[0];
        }
      }

      if (fact && !seenIds.has(fact.product.id)) {
        seenIds.add(fact.product.id);
        results.push(fact);
      }
    }

    const comparedAttributes = ['price', 'stock', 'category', 'material', 'features', 'variants'];
    return { targets: results, comparedAttributes };
  }

  /**
   * Evaluates catalog candidates and returns ranked recommendations based on criteria.
   */
  async getRecommendations(
    tenantId: string,
    accountId: string,
    criteria: RecommendationCriteria,
    lang: SupportedLanguage = 'en'
  ): Promise<RecommendationResult> {
    if (!tenantId || !accountId) {
      return {
        recommendations: [],
        hasGroundedRecommendation: false,
        topFact: null,
        rationale: 'NO_TENANT_OR_ACCOUNT'
      };
    }

    // Query candidate products (scoped to category if specified, or top 10 products)
    const rawCandidates = await this.productRepo.search({
      tenantId,
      accountId,
      category: criteria.category,
      maxPrice: criteria.budget,
      color: criteria.color,
      size: criteria.size,
      query: criteria.searchKeywords,
      limit: 10
    });

    return ProductRecommendationService.rankProducts(rawCandidates, criteria, lang);
  }
}
