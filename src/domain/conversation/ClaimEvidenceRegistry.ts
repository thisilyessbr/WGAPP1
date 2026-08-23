/**
 * ClaimEvidenceRegistry.ts
 *
 * Authoritative evidence registry for post-generation factual grounding.
 * Aggregates ProductFacts, Variants, Knowledge Chunks, Comparisons, and Recommendation Criteria.
 * Strictly enforces source authority:
 * PRODUCT/VARIANT DATA > STORE KNOWLEDGE/RAG > LLM GENERATED LANGUAGE.
 * 100% deterministic, 0 LLM calls, 0 embeddings.
 */

import { ProductLookupResult } from '../ecommerce/EcommerceService';
import { ProductFact } from '../ecommerce/ProductRepository';
import { RetrievedChunk } from '../rag/RAGService';
import { EvidenceBundle, RecommendationEvidence } from './EvidenceBundle';

export interface GroundedProductRecord {
  id: string;
  sku: string;
  names: string[];
  descriptions: string[];
  price: number;
  currency: string;
  stock: number;
  inStock: boolean;
  category?: string;
  tags: string[];
  materials: string[];
  features: string[];
  variants: Array<{
    sku: string;
    color?: string | null;
    size?: string | null;
    price: number;
    stock: number;
  }>;
}

export class ClaimEvidenceRegistry {
  private products: Map<string, GroundedProductRecord> = new Map();
  private policyChunksByTopic: Map<string, string[]> = new Map();
  private allKnowledgeText: string[] = [];
  private recommendation: RecommendationEvidence | null = null;
  private comparisonProducts: GroundedProductRecord[] = [];

  /**
   * Constructs an authoritative evidence registry from an EvidenceBundle.
   */
  public static fromEvidenceBundle(bundle?: EvidenceBundle | null): ClaimEvidenceRegistry {
    const registry = new ClaimEvidenceRegistry();
    if (!bundle) return registry;

    for (const fact of bundle.productFacts) {
      registry.addProductFact(fact);
    }
    if (bundle.primaryProductFact && !registry.hasProduct(bundle.primaryProductFact.product.id)) {
      registry.addProductFact(bundle.primaryProductFact);
    }

    for (const [topic, ev] of Object.entries(bundle.policyEvidenceByIntent)) {
      if (ev.found && ev.chunks) {
        const contents = ev.chunks.map(c => typeof c === 'string' ? c : c.content).filter(Boolean);
        registry.addPolicyChunks(topic, contents);
      }
    }

    if (bundle.policyChunks && bundle.policyChunks.length > 0) {
      const contents = bundle.policyChunks.map(c => typeof c === 'string' ? c : c.content).filter(Boolean);
      registry.addPolicyChunks('GENERAL', contents);
    }

    if (bundle.recommendationResults) {
      registry.setRecommendation(bundle.recommendationResults);
    }

    if (bundle.comparisonFacts && bundle.comparisonFacts.length > 0) {
      for (const compFact of bundle.comparisonFacts) {
        registry.addProductFact(compFact);
        registry.addComparisonProduct(compFact);
      }
    }

    return registry;
  }

  /**
   * Constructs an authoritative evidence registry from individual facts.
   */
  public static fromFacts(
    productFacts?: ProductFact | ProductFact[] | ProductLookupResult | ProductLookupResult[] | null,
    knowledgeFacts?: Array<string | RetrievedChunk> | null
  ): ClaimEvidenceRegistry {
    const registry = new ClaimEvidenceRegistry();
    if (productFacts) {
      const factsArray = Array.isArray(productFacts) ? productFacts : [productFacts];
      for (const f of factsArray) {
        registry.addProductFact(f);
      }
    }

    if (knowledgeFacts && knowledgeFacts.length > 0) {
      const chunks = knowledgeFacts.map(k => typeof k === 'string' ? k : k.content).filter(Boolean);
      registry.addPolicyChunks('GENERAL', chunks);
    }

    return registry;
  }

  public hasProduct(id: string): boolean {
    return this.products.has(id);
  }

  public addProductFact(fact: ProductLookupResult | ProductFact): this {
    const p = 'product' in fact ? fact.product : (fact as any);
    if (!p) return this;

    const names: string[] = [p.name, p.title].filter(Boolean);
    if (p.nameLocalized && typeof p.nameLocalized === 'object') {
      for (const val of Object.values(p.nameLocalized)) {
        if (typeof val === 'string' && val.trim()) names.push(val.trim());
      }
    }
    if ('displayName' in fact && fact.displayName) {
      names.push(fact.displayName);
    }

    const descriptions: string[] = [p.description].filter(Boolean);
    if (p.descriptionLocalized && typeof p.descriptionLocalized === 'object') {
      for (const val of Object.values(p.descriptionLocalized)) {
        if (typeof val === 'string' && val.trim()) descriptions.push(val.trim());
      }
    }
    if ('displayDescription' in fact && fact.displayDescription) {
      descriptions.push(fact.displayDescription);
    }

    const tags: string[] = Array.isArray(p.tags) ? p.tags.map((t: any) => String(t).toLowerCase()) : [];
    const variants = (p.variants || []).map((v: any) => ({
      sku: v.sku || '',
      color: v.color || null,
      size: v.size || null,
      price: Number(v.priceOverride !== undefined && v.priceOverride !== null ? v.priceOverride : (v.price !== undefined && v.price !== null ? v.price : ('effectivePrice' in fact ? fact.effectivePrice : p.price))),
      stock: Number(v.stock ?? 0)
    }));

    // Extract materials & features from descriptions and tags
    const descLower = descriptions.join(' ').toLowerCase();
    const materials: string[] = [];
    const knownMaterials = ['cotton', 'fleece', 'wool', 'polyester', 'nylon', 'leather', 'silk', 'linen', 'denim', 'قطن', 'صوف', 'جلد', 'كتان', 'coton', 'molleton', 'laine'];
    for (const mat of knownMaterials) {
      if (descLower.includes(mat) || tags.includes(mat)) {
        materials.push(mat);
      }
    }

    const features: string[] = [];
    const knownFeatures = ['waterproof', 'water-resistant', 'windbreaker', 'heavyweight', 'lightweight', 'breathable', 'insulated', 'stretch', 'مقاوم للماء', 'واقي من الرياح', 'ثقيل', 'خفيف', 'مريح', 'شتوي', 'صيفي', 'imperméable', 'coupe-vent', 'winter', 'daily_use', 'sports'];
    for (const feat of knownFeatures) {
      if (descLower.includes(feat) || tags.includes(feat)) {
        features.push(feat);
      }
    }

    const record: GroundedProductRecord = {
      id: p.id || p.sku || 'prod-default',
      sku: p.sku || '',
      names: Array.from(new Set(names)),
      descriptions,
      price: Number('effectivePrice' in fact ? fact.effectivePrice : p.price),
      currency: fact.currency || p.currency || 'MAD',
      stock: Number('availableStock' in fact ? fact.availableStock : (p.stock || 0)),
      inStock: 'inStock' in fact ? Boolean(fact.inStock) : (Number(p.stock || 0) > 0),
      category: p.category || undefined,
      tags,
      materials,
      features,
      variants
    };

    this.products.set(record.id, record);
    if (record.sku) this.products.set(record.sku, record);
    return this;
  }

  public addPolicyChunks(topic: string, chunks: string[]): this {
    const t = topic.toUpperCase();
    const existing = this.policyChunksByTopic.get(t) || [];
    this.policyChunksByTopic.set(t, [...existing, ...chunks]);
    this.allKnowledgeText.push(...chunks);
    return this;
  }

  public setRecommendation(rec: RecommendationEvidence): this {
    this.recommendation = rec;
    if (rec.topFact) {
      this.addProductFact(rec.topFact);
    }
    for (const c of rec.candidates || []) {
      this.addProductFact(c);
    }
    return this;
  }

  public addComparisonProduct(fact: ProductLookupResult | ProductFact): this {
    const p = 'product' in fact ? fact.product : (fact as any);
    if (!p) return this;
    const record = this.products.get(p.id) || this.products.get(p.sku);
    if (record && !this.comparisonProducts.some(cp => cp.id === record.id)) {
      this.comparisonProducts.push(record);
    }
    return this;
  }

  // --- Authoritative Grounding Query Methods ---

  public getAllProducts(): GroundedProductRecord[] {
    const unique = new Map<string, GroundedProductRecord>();
    for (const [_, prod] of this.products.entries()) {
      unique.set(prod.id, prod);
    }
    return Array.from(unique.values());
  }

  public findProductByNameOrSku(token: string): GroundedProductRecord | null {
    if (!token || !token.trim()) return null;
    const clean = token.toLowerCase().trim();
    for (const prod of this.getAllProducts()) {
      if (prod.sku.toLowerCase() === clean) return prod;
      for (const name of prod.names) {
        if (name.toLowerCase().includes(clean) || clean.includes(name.toLowerCase())) {
          return prod;
        }
      }
    }
    return null;
  }

  public isPriceGrounded(price: number, currency?: string, subject?: string): boolean {
    const products = subject ? [this.findProductByNameOrSku(subject)].filter(Boolean) as GroundedProductRecord[] : this.getAllProducts();
    if (products.length === 0) return false;

    const numPrice = Number(price);
    return products.some(p => {
      if (Number(p.price) === numPrice) return true;
      return p.variants.some(v => Number(v.price) === numPrice);
    });
  }

  public isStockGrounded(stock: number, subject?: string): boolean {
    const products = subject ? [this.findProductByNameOrSku(subject)].filter(Boolean) as GroundedProductRecord[] : this.getAllProducts();
    if (products.length === 0) return false;

    const numStock = Number(stock);
    return products.some(p => {
      if (Number(p.stock) === numStock) return true;
      return p.variants.some(v => Number(v.stock) === numStock);
    });
  }

  public isSkuGrounded(sku: string): boolean {
    const cleanSku = sku.toUpperCase().trim();
    for (const p of this.getAllProducts()) {
      if (p.sku.toUpperCase() === cleanSku) return true;
      if (p.variants.some(v => v.sku.toUpperCase() === cleanSku)) return true;
    }
    return false;
  }

  public isMaterialGrounded(material: string, subject?: string): boolean {
    const matLower = material.toLowerCase().trim();
    const products = subject ? [this.findProductByNameOrSku(subject)].filter(Boolean) as GroundedProductRecord[] : this.getAllProducts();
    if (products.length === 0) return false;

    return products.some(p => {
      if (p.materials.some(m => m.includes(matLower) || matLower.includes(m))) return true;
      return p.descriptions.some(d => d.toLowerCase().includes(matLower));
    });
  }

  public isFeatureGrounded(feature: string, subject?: string): boolean {
    const featLower = feature.toLowerCase().trim();
    const products = subject ? [this.findProductByNameOrSku(subject)].filter(Boolean) as GroundedProductRecord[] : this.getAllProducts();
    if (products.length === 0) return false;

    const featureSynonyms: Record<string, string[]> = {
      waterproof: ['waterproof', 'water-resistant', 'imperméable', 'مقاوم للماء', 'ضد الماء'],
      windbreaker: ['windbreaker', 'coupe-vent', 'واقي من الرياح'],
      thermal: ['fleece', 'heavyweight', 'winter', 'warm', 'cold', 'شتوي', 'صوف']
    };

    const searchTerms = featureSynonyms[featLower] || [featLower];

    return products.some(p => {
      const allText = [...p.features, ...p.tags, ...p.descriptions].join(' ').toLowerCase();
      return searchTerms.some(term => allText.includes(term));
    });
  }

  public isPolicyFactGrounded(topic: string, claimTermOrNumber: string | number): boolean {
    const termStr = String(claimTermOrNumber).toLowerCase().trim();
    const chunks = this.policyChunksByTopic.get(topic.toUpperCase()) || this.allKnowledgeText;
    if (chunks.length === 0) return false;

    return chunks.some(c => c.toLowerCase().includes(termStr));
  }

  public isComparisonGrounded(subjectA: string, comparisonType: 'CHEAPER' | 'MORE_EXPENSIVE' | 'MORE_STOCK' | 'LESS_STOCK', subjectB: string): boolean {
    const prodA = this.findProductByNameOrSku(subjectA);
    const prodB = this.findProductByNameOrSku(subjectB);
    if (!prodA || !prodB) return false;

    switch (comparisonType) {
      case 'CHEAPER':
        return prodA.price < prodB.price;
      case 'MORE_EXPENSIVE':
        return prodA.price > prodB.price;
      case 'MORE_STOCK':
        return prodA.stock > prodB.stock;
      case 'LESS_STOCK':
        return prodA.stock < prodB.stock;
      default:
        return false;
    }
  }

  public isRecommendationGrounded(subject: string, criterionOrReason: string): boolean {
    if (!this.recommendation) return false;
    const prod = this.findProductByNameOrSku(subject) || this.getAllProducts()[0];
    if (!prod) return false;

    const crit = criterionOrReason.toLowerCase().trim();
    const words = crit.split(/\s+/).filter(w => w.length > 2);
    const allDesc = prod.descriptions.join(' ').toLowerCase();
    const allTags = prod.tags.join(' ').toLowerCase();

    if (allTags.includes(crit) || allDesc.includes(crit) || (prod.category && prod.category.toLowerCase().includes(crit))) {
      return true;
    }

    return words.some(w => allTags.includes(w) || allDesc.includes(w) || prod.features.some(f => f.includes(w)));
  }

  public getAllKnowledgeText(): string {
    return this.allKnowledgeText.join('\n');
  }

  public getComparisonProducts(): GroundedProductRecord[] {
    return [...this.comparisonProducts];
  }
}
