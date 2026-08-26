import { describe, it, expect } from 'vitest';
import { AnswerComposer } from '../../src/domain/conversation/AnswerComposer';
import { ProductLookupResult } from '../../src/domain/ecommerce/EcommerceService';

/**
 * PHASE ECOMMERCE-FIX-3: Variant Response Contract
 *
 * Verifies that when a specific variant is resolved, the response explicitly
 * identifies the resolved variant attributes (color, size, stock, price).
 */
describe('Variant Response Contract (RC-ECOM-3)', () => {
  // ── Fixtures ──────────────────────────────────────────────────────

  const makeVariant = (overrides: any) => ({
    id: 'var-1',
    productId: 'prod-hoodie-1',
    sku: 'ANV-H001-BLK-M',
    name: 'Moon Ninja Hoodie - Black / M',
    color: 'Black',
    size: 'M',
    stock: 10,
    active: true,
    priceOverride: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  });

  const makeFact = (overrides: Partial<ProductLookupResult> & { selectedVariant?: any }): ProductLookupResult => ({
    product: {
      id: 'prod-hoodie-1',
      tenantId: 'animeverse',
      accountId: 'animeverse-store',
      sku: 'ANV-H001',
      name: 'Moon Ninja Hoodie',
      nameLocalized: { en: 'Moon Ninja Hoodie', fr: 'Sweat à capuche Moon Ninja', ar: 'هودي مون نينجا', darija: 'Moon Ninja Hoodie' },
      description: 'Warm cotton fleece hoodie with oversized fit.',
      descriptionLocalized: { en: 'Warm cotton fleece hoodie with oversized fit.', fr: 'Sweat en polaire de coton chaud.', ar: 'هودي دافئ من القطن.', darija: 'هودي سخون من القطن.' },
      price: 399,
      currency: 'MAD',
      stock: 25,
      active: true,
      category: 'Hoodies',
      createdAt: new Date(),
      updatedAt: new Date(),
      variants: [
        makeVariant({ id: 'var-blk-m', sku: 'ANV-H001-BLK-M', color: 'Black', size: 'M', stock: 10 }),
        makeVariant({ id: 'var-blk-l', sku: 'ANV-H001-BLK-L', color: 'Black', size: 'L', stock: 5 }),
        makeVariant({ id: 'var-wht-m', sku: 'ANV-H001-WHT-M', color: 'White', size: 'M', stock: 0 }),
        makeVariant({ id: 'var-wht-l', sku: 'ANV-H001-WHT-L', color: 'White', size: 'L', stock: 3 }),
      ]
    },
    effectivePrice: 399,
    currency: 'MAD',
    inStock: true,
    availableStock: 25,
    displayName: 'Moon Ninja Hoodie',
    displayDescription: 'Warm cotton fleece hoodie with oversized fit.',
    selectedVariant: null,
    ...overrides
  });

  // ── A. Size-only variant ──────────────────────────────────────────

  describe('A. Size-only variant', () => {
    it('should explicitly identify size M in response (EN)', () => {
      const fact = makeFact({
        selectedVariant: makeVariant({ color: null, size: 'M', stock: 10 }),
        availableStock: 10,
        inStock: true
      });
      const response = AnswerComposer.composeEcommerce({
        turnDecision: { domain: 'ECOMMERCE', intent: 'AVAILABILITY', source: 'ECOMMERCE', size: 'M', responseLanguage: 'en', responseScript: 'latin' },
        productFacts: fact, responseLanguage: 'en', responseScript: 'latin'
      });
      expect(response).toContain('M');
      expect(response).toContain('10');
      expect(response).toContain('Moon Ninja Hoodie');
    });
  });

  // ── B. Color-only variant ─────────────────────────────────────────

  describe('B. Color-only variant', () => {
    it('should explicitly identify color Black in response (EN)', () => {
      const fact = makeFact({
        selectedVariant: makeVariant({ color: 'Black', size: null, stock: 10 }),
        availableStock: 10,
        inStock: true
      });
      const response = AnswerComposer.composeEcommerce({
        turnDecision: { domain: 'ECOMMERCE', intent: 'AVAILABILITY', source: 'ECOMMERCE', color: 'Black', responseLanguage: 'en', responseScript: 'latin' },
        productFacts: fact, responseLanguage: 'en', responseScript: 'latin'
      });
      expect(response).toContain('Black');
      expect(response).toContain('10');
      expect(response).toContain('Moon Ninja Hoodie');
    });
  });

  // ── C. Color + size variant ───────────────────────────────────────

  describe('C. Color + size variant', () => {
    it('should explicitly identify Black / M in response (EN)', () => {
      const fact = makeFact({
        selectedVariant: makeVariant({ color: 'Black', size: 'M', stock: 10 }),
        availableStock: 10,
        inStock: true
      });
      const response = AnswerComposer.composeEcommerce({
        turnDecision: { domain: 'ECOMMERCE', intent: 'AVAILABILITY', source: 'ECOMMERCE', color: 'Black', size: 'M', responseLanguage: 'en', responseScript: 'latin' },
        productFacts: fact, responseLanguage: 'en', responseScript: 'latin'
      });
      expect(response).toContain('Black / M');
      expect(response).toContain('10');
      expect(response).toContain('Moon Ninja Hoodie');
    });
  });

  // ── D. In-stock variant uses variant stock, not parent ────────────

  describe('D. In-stock variant authority', () => {
    it('should use variant stock (10), not parent stock (25)', () => {
      const fact = makeFact({
        selectedVariant: makeVariant({ color: 'Black', size: 'M', stock: 10 }),
        availableStock: 10,  // variant-level
        inStock: true
      });
      const response = AnswerComposer.composeEcommerce({
        turnDecision: { domain: 'ECOMMERCE', intent: 'AVAILABILITY', source: 'ECOMMERCE', color: 'Black', size: 'M', responseLanguage: 'en', responseScript: 'latin' },
        productFacts: fact, responseLanguage: 'en', responseScript: 'latin'
      });
      expect(response).toContain('10');
      expect(response).not.toContain('25');
    });
  });

  // ── E. Out-of-stock variant ───────────────────────────────────────

  describe('E. Out-of-stock variant', () => {
    it('should clearly identify White / M as out of stock (EN)', () => {
      const fact = makeFact({
        selectedVariant: makeVariant({ id: 'var-wht-m', color: 'White', size: 'M', stock: 0 }),
        availableStock: 0,
        inStock: false
      });
      const response = AnswerComposer.composeEcommerce({
        turnDecision: { domain: 'ECOMMERCE', intent: 'AVAILABILITY', source: 'ECOMMERCE', color: 'White', size: 'M', responseLanguage: 'en', responseScript: 'latin' },
        productFacts: fact, responseLanguage: 'en', responseScript: 'latin'
      });
      expect(response).toContain('White / M');
      expect(response).toContain('out of stock');
      expect(response).toContain('Moon Ninja Hoodie');
    });

    it('should NOT silently fall back to parent stock when variant is OOS', () => {
      const fact = makeFact({
        selectedVariant: makeVariant({ id: 'var-wht-m', color: 'White', size: 'M', stock: 0 }),
        availableStock: 0,
        inStock: false
      });
      const response = AnswerComposer.composeEcommerce({
        turnDecision: { domain: 'ECOMMERCE', intent: 'AVAILABILITY', source: 'ECOMMERCE', color: 'White', size: 'M', responseLanguage: 'en', responseScript: 'latin' },
        productFacts: fact, responseLanguage: 'en', responseScript: 'latin'
      });
      // Must not say "available" or "in stock"
      expect(response).not.toMatch(/\bis available\b/i);
      expect(response).not.toMatch(/\bIn stock: 25\b/);
    });
  });

  // ── F. Variant price override ─────────────────────────────────────

  describe('F. Variant price override', () => {
    it('should use variant effective price, not parent price', () => {
      const fact = makeFact({
        selectedVariant: makeVariant({ color: 'Black', size: 'L', stock: 5, priceOverride: 449 }),
        effectivePrice: 449,
        availableStock: 5,
        inStock: true
      });
      const response = AnswerComposer.composeEcommerce({
        turnDecision: { domain: 'ECOMMERCE', intent: 'PRICE', source: 'ECOMMERCE', color: 'Black', size: 'L', responseLanguage: 'en', responseScript: 'latin' },
        productFacts: fact, responseLanguage: 'en', responseScript: 'latin'
      });
      expect(response).toContain('449');
      expect(response).toContain('Black / L');
      expect(response).not.toContain('399');
    });
  });

  // ── G. Product-level availability remains unchanged ────────────────

  describe('G. Product-level availability (no variant)', () => {
    it('should NOT include variant label when no variant resolved (EN)', () => {
      const fact = makeFact({
        selectedVariant: null,
        availableStock: 25,
        inStock: true
      });
      const response = AnswerComposer.composeEcommerce({
        turnDecision: { domain: 'ECOMMERCE', intent: 'AVAILABILITY', source: 'ECOMMERCE', responseLanguage: 'en', responseScript: 'latin' },
        productFacts: fact, responseLanguage: 'en', responseScript: 'latin'
      });
      expect(response).toContain('Moon Ninja Hoodie');
      expect(response).toContain('25');
      // No variant label like (Black / M) — only stock parenthetical is allowed
      expect(response).not.toMatch(/Moon Ninja Hoodie \(/);
    });

    it('should NOT include variant label for product-level OOS', () => {
      const fact = makeFact({
        selectedVariant: null,
        availableStock: 0,
        inStock: false
      });
      const response = AnswerComposer.composeEcommerce({
        turnDecision: { domain: 'ECOMMERCE', intent: 'AVAILABILITY', source: 'ECOMMERCE', responseLanguage: 'en', responseScript: 'latin' },
        productFacts: fact, responseLanguage: 'en', responseScript: 'latin'
      });
      expect(response).toContain('Moon Ninja Hoodie');
      expect(response).toContain('out of stock');
      expect(response).not.toContain('Black');
      expect(response).not.toContain('/ M');
    });
  });

  // ── H. Arabic ─────────────────────────────────────────────────────

  describe('H. Arabic variant response', () => {
    it('should include variant label in Arabic response', () => {
      const fact = makeFact({
        selectedVariant: makeVariant({ color: 'Black', size: 'M', stock: 10 }),
        availableStock: 10,
        inStock: true
      });
      const response = AnswerComposer.composeEcommerce({
        turnDecision: { domain: 'ECOMMERCE', intent: 'AVAILABILITY', source: 'ECOMMERCE', color: 'Black', size: 'M', responseLanguage: 'ar', responseScript: 'arabic' },
        productFacts: fact, responseLanguage: 'ar', responseScript: 'arabic'
      });
      expect(response).toContain('Black / M');
      expect(response).toContain('10');
      expect(response).toContain('متوفر');
    });
  });

  // ── I. Darija Arabic ──────────────────────────────────────────────

  describe('I. Darija Arabic variant response', () => {
    it('should include variant label in Darija response', () => {
      const fact = makeFact({
        selectedVariant: makeVariant({ color: 'Black', size: 'M', stock: 10 }),
        availableStock: 10,
        inStock: true
      });
      const response = AnswerComposer.composeEcommerce({
        turnDecision: { domain: 'ECOMMERCE', intent: 'AVAILABILITY', source: 'ECOMMERCE', color: 'Black', size: 'M', responseLanguage: 'darija', responseScript: 'arabic' },
        productFacts: fact, responseLanguage: 'darija', responseScript: 'arabic'
      });
      expect(response).toContain('Black / M');
      expect(response).toContain('10');
      expect(response).toContain('كاين');
    });
  });

  // ── J. Arabizi ────────────────────────────────────────────────────

  describe('J. Arabizi variant response', () => {
    it('should include variant label in Arabizi response', () => {
      const fact = makeFact({
        selectedVariant: makeVariant({ color: 'Black', size: 'M', stock: 10 }),
        availableStock: 10,
        inStock: true
      });
      const response = AnswerComposer.composeEcommerce({
        turnDecision: { domain: 'ECOMMERCE', intent: 'AVAILABILITY', source: 'ECOMMERCE', color: 'Black', size: 'M', responseLanguage: 'darija', responseScript: 'arabizi' },
        productFacts: fact, responseLanguage: 'darija', responseScript: 'arabizi'
      });
      expect(response).toContain('Black / M');
      expect(response).toContain('10');
      expect(response).toContain('kayen');
    });
  });

  // ── K. French ─────────────────────────────────────────────────────

  describe('K. French variant response', () => {
    it('should include variant label in French in-stock response', () => {
      const fact = makeFact({
        selectedVariant: makeVariant({ color: 'Black', size: 'L', stock: 5 }),
        availableStock: 5,
        inStock: true
      });
      const response = AnswerComposer.composeEcommerce({
        turnDecision: { domain: 'ECOMMERCE', intent: 'AVAILABILITY', source: 'ECOMMERCE', color: 'Black', size: 'L', responseLanguage: 'fr', responseScript: 'latin' },
        productFacts: fact, responseLanguage: 'fr', responseScript: 'latin'
      });
      expect(response).toContain('Black / L');
      expect(response).toContain('5');
      expect(response).toContain('disponible');
    });

    it('should include variant label in French OOS response', () => {
      const fact = makeFact({
        selectedVariant: makeVariant({ color: 'White', size: 'M', stock: 0 }),
        availableStock: 0,
        inStock: false
      });
      const response = AnswerComposer.composeEcommerce({
        turnDecision: { domain: 'ECOMMERCE', intent: 'AVAILABILITY', source: 'ECOMMERCE', color: 'White', size: 'M', responseLanguage: 'fr', responseScript: 'latin' },
        productFacts: fact, responseLanguage: 'fr', responseScript: 'latin'
      });
      expect(response).toContain('White / M');
      expect(response).toContain('rupture de stock');
    });
  });

  // ── L. English ────────────────────────────────────────────────────

  describe('L. English variant response', () => {
    it('should include variant label in English in-stock response', () => {
      const fact = makeFact({
        selectedVariant: makeVariant({ color: 'Black', size: 'M', stock: 10 }),
        availableStock: 10,
        inStock: true
      });
      const response = AnswerComposer.composeEcommerce({
        turnDecision: { domain: 'ECOMMERCE', intent: 'AVAILABILITY', source: 'ECOMMERCE', color: 'Black', size: 'M', responseLanguage: 'en', responseScript: 'latin' },
        productFacts: fact, responseLanguage: 'en', responseScript: 'latin'
      });
      expect(response).toContain('Black / M');
      expect(response).toContain('is available');
      expect(response).toContain('10');
    });
  });

  // ── M. Variant identity across context switches ───────────────────

  describe('M. Variant identity consistency', () => {
    it('should use selectedVariant attributes even when turnDecision attributes differ', () => {
      // selectedVariant says Black/M but turnDecision has no explicit color/size
      // (context-inherited). The response should still use variant attributes.
      const fact = makeFact({
        selectedVariant: makeVariant({ color: 'Black', size: 'M', stock: 10 }),
        availableStock: 10,
        inStock: true
      });
      const response = AnswerComposer.composeEcommerce({
        turnDecision: { domain: 'ECOMMERCE', intent: 'AVAILABILITY', source: 'ECOMMERCE', responseLanguage: 'en', responseScript: 'latin' },
        productFacts: fact, responseLanguage: 'en', responseScript: 'latin'
      });
      // selectedVariant.color and .size are used even without turnDecision.color/size
      expect(response).toContain('Black / M');
      expect(response).toContain('10');
    });

    it('PRICE intent should also include variant label from selectedVariant', () => {
      const fact = makeFact({
        selectedVariant: makeVariant({ color: 'Black', size: 'L', stock: 5, priceOverride: 449 }),
        effectivePrice: 449,
        availableStock: 5,
        inStock: true
      });
      const response = AnswerComposer.composeEcommerce({
        turnDecision: { domain: 'ECOMMERCE', intent: 'PRICE', source: 'ECOMMERCE', responseLanguage: 'en', responseScript: 'latin' },
        productFacts: fact, responseLanguage: 'en', responseScript: 'latin'
      });
      expect(response).toContain('Black / L');
      expect(response).toContain('449');
    });
  });
});
