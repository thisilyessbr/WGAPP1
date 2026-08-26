import { describe, it, expect } from 'vitest';
import { ProductRecommendationService, RecommendationCriteria } from '../../src/domain/ecommerce/ProductRecommendationService';
import { EcommerceIntentParser } from '../../src/domain/ecommerce/EcommerceIntent';
import { TurnDecisionResolver } from '../../src/domain/conversation/TurnDecision';
import { ProductWithVariants } from '../../src/domain/ecommerce/ProductRepository';

describe('PHASE ARCH-FIX-47G — Generic Recommendation Engine', () => {
  // Test A: Fashion
  it('A. Fashion: recommends clothing item based on category and budget', () => {
    const products: ProductWithVariants[] = [
      {
        id: 'hoodie-1',
        name: 'Classic Black Hoodie',
        description: 'Cotton blend comfortable hoodie',
        price: 250 as any,
        currency: 'MAD',
        stock: 10,
        active: true,
        category: 'Hoodies',
        metadata: { tags: ['casual', 'comfort'] },
        variants: []
      } as any,
      {
        id: 'jacket-1',
        name: 'Winter Parka',
        description: 'Heavy waterproof winter coat',
        price: 600 as any,
        currency: 'MAD',
        stock: 5,
        active: true,
        category: 'Jackets',
        metadata: {},
        variants: []
      } as any
    ];

    const result = ProductRecommendationService.rankProducts(products, {
      category: 'Hoodies',
      budget: 300
    });

    expect(result.hasGroundedRecommendation).toBe(true);
    expect(result.topFact?.product.id).toBe('hoodie-1');
    expect(result.rationale).toContain('Category: Hoodies');
  });

  // Test B: Electronics
  it('B. Electronics: recommends laptop based on specification metadata and tags', () => {
    const laptops: ProductWithVariants[] = [
      {
        id: 'lap-office',
        name: 'OfficeBook 14',
        description: 'Basic laptop for spreadsheet work',
        price: 4000 as any,
        currency: 'MAD',
        stock: 5,
        active: true,
        category: 'Laptops',
        metadata: { ram: '8GB', tags: ['office', 'student'] },
        variants: []
      } as any,
      {
        id: 'lap-gaming',
        name: 'PowerPro Gaming 16',
        description: 'High performance gaming machine with dedicated GPU',
        price: 9000 as any,
        currency: 'MAD',
        stock: 3,
        active: true,
        category: 'Laptops',
        metadata: { ram: '32GB', gpu: 'RTX 4070', tags: ['gaming', 'developer'] },
        variants: []
      } as any
    ];

    const result = ProductRecommendationService.rankProducts(laptops, {
      category: 'Laptops',
      searchKeywords: 'gaming',
      preferredAttributes: { ram: '32GB' }
    });

    expect(result.hasGroundedRecommendation).toBe(true);
    expect(result.topFact?.product.id).toBe('lap-gaming');
    expect(result.rationale).toContain('Attribute match: ram=32GB');
  });

  // Test C: Books
  it('C. Books: recommends book based on author and genre metadata', () => {
    const books: ProductWithVariants[] = [
      {
        id: 'book-1',
        name: 'Dune',
        description: 'Epic science fiction masterpiece',
        price: 150 as any,
        currency: 'MAD',
        stock: 8,
        active: true,
        category: 'Books',
        metadata: { author: 'Frank Herbert', genre: 'Sci-Fi' },
        variants: []
      } as any,
      {
        id: 'book-2',
        name: 'The Hobbit',
        description: 'Classic fantasy novel',
        price: 120 as any,
        currency: 'MAD',
        stock: 4,
        active: true,
        category: 'Books',
        metadata: { author: 'J.R.R. Tolkien', genre: 'Fantasy' },
        variants: []
      } as any
    ];

    const result = ProductRecommendationService.rankProducts(books, {
      category: 'Books',
      preferredAttributes: { author: 'Frank Herbert' }
    });

    expect(result.hasGroundedRecommendation).toBe(true);
    expect(result.topFact?.product.id).toBe('book-1');
    expect(result.rationale).toContain('Attribute match: author=Frank Herbert');
  });

  // Test D: Furniture
  it('D. Furniture: recommends table based on keyword and dimensions', () => {
    const furniture: ProductWithVariants[] = [
      {
        id: 'table-large',
        name: 'Grand Dining Table 8-Seater',
        description: 'Spacious oak table for large dining rooms',
        price: 3500 as any,
        currency: 'MAD',
        stock: 2,
        active: true,
        category: 'Tables',
        metadata: { material: 'Oak' },
        variants: []
      } as any,
      {
        id: 'table-compact',
        name: 'Compact Folding Table',
        description: 'Space-saving foldable design ideal for small apartments',
        price: 1200 as any,
        currency: 'MAD',
        stock: 6,
        active: true,
        category: 'Tables',
        metadata: { material: 'Pine', tags: ['compact', 'folding'] },
        variants: []
      } as any
    ];

    const result = ProductRecommendationService.rankProducts(furniture, {
      category: 'Tables',
      searchKeywords: 'compact space-saving',
      budget: 1500
    });

    expect(result.hasGroundedRecommendation).toBe(true);
    expect(result.topFact?.product.id).toBe('table-compact');
  });

  // Test E: Metadata / Tag scoring
  it('E. Metadata/Tag scoring: boosts products matching metadata tags', () => {
    const products: ProductWithVariants[] = [
      {
        id: 'p1',
        name: 'Serum Alpha',
        description: 'Hydrating serum',
        price: 200 as any,
        stock: 5,
        category: 'Skincare',
        metadata: { tags: ['organic', 'vegan'] },
        variants: []
      } as any,
      {
        id: 'p2',
        name: 'Serum Beta',
        description: 'Anti-aging serum',
        price: 200 as any,
        stock: 5,
        category: 'Skincare',
        metadata: { tags: ['anti-aging'] },
        variants: []
      } as any
    ];

    const result = ProductRecommendationService.rankProducts(products, {
      category: 'Skincare',
      searchKeywords: 'organic'
    });

    expect(result.topFact?.product.id).toBe('p1');
    expect(result.rationale).toContain('Tag match: organic');
  });

  // Test F: Budget constraint enforcement
  it('F. Budget: penalizes products over budget and selects affordable option', () => {
    const products: ProductWithVariants[] = [
      {
        id: 'p-expensive',
        name: 'Luxury Watch',
        description: 'Diamond bezel watch',
        price: 5000 as any,
        stock: 5,
        category: 'Watches',
        variants: []
      } as any,
      {
        id: 'p-affordable',
        name: 'Everyday Watch',
        description: 'Classic quartz watch',
        price: 800 as any,
        stock: 5,
        category: 'Watches',
        variants: []
      } as any
    ];

    const result = ProductRecommendationService.rankProducts(products, {
      category: 'Watches',
      budget: 1000
    });

    expect(result.hasGroundedRecommendation).toBe(true);
    expect(result.topFact?.product.id).toBe('p-affordable');
  });

  // Test G: Stock weighting
  it('G. Stock: penalizes out-of-stock items and recommends in-stock candidate', () => {
    const products: ProductWithVariants[] = [
      {
        id: 'out-of-stock-item',
        name: 'Popular Item',
        description: 'Great item',
        price: 100 as any,
        stock: 0,
        category: 'Items',
        variants: []
      } as any,
      {
        id: 'in-stock-item',
        name: 'Available Item',
        description: 'Good item in stock',
        price: 100 as any,
        stock: 4,
        category: 'Items',
        variants: []
      } as any
    ];

    const result = ProductRecommendationService.rankProducts(products, {
      category: 'Items'
    });

    expect(result.hasGroundedRecommendation).toBe(true);
    expect(result.topFact?.product.id).toBe('in-stock-item');
  });

  // Test H: Variant availability
  it('H. Variant availability: scores variant stock when color/size requested', () => {
    const products: ProductWithVariants[] = [
      {
        id: 'shoes-1',
        name: 'Runner Pro',
        description: 'Running shoes',
        price: 500 as any,
        stock: 10,
        category: 'Shoes',
        variants: [
          { id: 'v1', size: '42', color: 'Blue', stock: 0 } as any,
          { id: 'v2', size: '43', color: 'Blue', stock: 5 } as any
        ]
      } as any
    ];

    const result = ProductRecommendationService.rankProducts(products, {
      category: 'Shoes',
      size: '43',
      color: 'Blue'
    });

    expect(result.hasGroundedRecommendation).toBe(true);
    expect(result.topFact?.selectedVariant?.size).toBe('43');
  });

  // Test I: Missing evidence
  it('I. Missing evidence: returns ungrounded result when catalog has no matching candidates', () => {
    const result = ProductRecommendationService.rankProducts([], {
      category: 'Desks'
    });

    expect(result.hasGroundedRecommendation).toBe(false);
    expect(result.topFact).toBeNull();
    expect(result.rationale).toBe('NO_CATALOG_CANDIDATES');
  });

  // Test J: Tenant isolation
  it('J. Tenant isolation: recommendation parsing operates within scoped options', () => {
    const tenantACats = ['Laptops', 'Monitors'];
    const tenantBCats = ['Skincare', 'Perfumes'];

    const parsedA = EcommerceIntentParser.parse('Which laptop should I choose?', null, 'en', {
      catalogCategories: tenantACats
    });
    expect(parsedA.intent).toBe('RECOMMENDATION');
    expect(parsedA.category).toBe('Laptops');

    const parsedB = EcommerceIntentParser.parse('Which perfume should I choose?', null, 'en', {
      catalogCategories: tenantBCats
    });
    expect(parsedB.intent).toBe('RECOMMENDATION');
    expect(parsedB.category).toBe('Perfumes');
  });

  // Test K: Multilingual recommendation triggers
  it('K. Multilingual recommendation triggers in French, Arabic, and Darija', () => {
    const frParsed = EcommerceIntentParser.parse('Quel produit me conseillez-vous ?');
    expect(frParsed.intent).toBe('RECOMMENDATION');

    const arParsed = EcommerceIntentParser.parse('شنو أحسن منتج تنصحني به؟');
    expect(arParsed.intent).toBe('RECOMMENDATION');

    const darijaParsed = EcommerceIntentParser.parse('ach tnessehni nakhod?');
    expect(darijaParsed.intent).toBe('RECOMMENDATION');
  });

  // Test L: Normal product search unchanged
  it('L. Normal product search: straightforward catalog search remains intact', () => {
    const parsed = EcommerceIntentParser.parse('Show me blue hoodies under 300 MAD');
    expect(parsed.intent).toBe('PRODUCT_SEARCH');
    expect(parsed.category).toBe('Hoodies');
    expect(parsed.color).toBe('Blue');
    expect(parsed.maxPrice).toBe(300);
  });

  // Test M: Price / detail / variant behavior unchanged
  it('M. Price / detail / variant: exact intent classification preserved', () => {
    const priceParsed = EcommerceIntentParser.parse('What is the price of the laptop?');
    expect(priceParsed.intent).toBe('PRICE');

    const detailParsed = EcommerceIntentParser.parse('Tell me more details about this item', { selectedProductId: 'prod-1' });
    expect(detailParsed.intent).toBe('PRODUCT_DETAIL');
  });

  // Test N: Ecommerce disabled gating
  it('N. Ecommerce disabled: routes to general conversation without calling recommendation engine', () => {
    const decision = TurnDecisionResolver.resolve({
      text: 'Which one should I choose?',
      isEcommerceEnabled: false
    });
    expect(decision.domain).not.toBe('ECOMMERCE');
  });
});
