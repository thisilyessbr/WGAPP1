import { describe, it, expect } from 'vitest';
import { EcommerceIntentParser } from '../../src/domain/ecommerce/EcommerceIntent';
import { TurnDecisionResolver } from '../../src/domain/conversation/TurnDecision';

describe('PHASE ARCH-FIX-47C — Dynamic Ecommerce Category Resolution', () => {
  // Test 1: Fashion catalog: Hoodies
  it('1. Fashion catalog: resolves dynamic "Hoodies" category from catalogCategories', () => {
    const catalog = ['Hoodies', 'T-Shirts', 'Jeans'];
    const parsed = EcommerceIntentParser.parse('show me hoodies', null, 'en', {
      catalogCategories: catalog
    });
    expect(parsed.intent).toBe('PRODUCT_SEARCH');
    expect(parsed.category).toBe('Hoodies');
  });

  // Test 2: Electronics catalog: Laptops
  it('2. Electronics catalog: resolves dynamic "Laptops" category from catalogCategories without code hardcoding', () => {
    const catalog = ['Laptops', 'Smartphones', 'Headphones'];
    const parsed = EcommerceIntentParser.parse('show me laptops', null, 'en', {
      catalogCategories: catalog
    });
    expect(parsed.intent).toBe('PRODUCT_SEARCH');
    expect(parsed.category).toBe('Laptops');
  });

  // Test 3: Books catalog: Fiction
  it('3. Books catalog: resolves dynamic "Fiction" category from catalogCategories', () => {
    const catalog = ['Fiction', 'Non-Fiction', 'Science'];
    const parsed = EcommerceIntentParser.parse('I want fiction books', null, 'en', {
      catalogCategories: catalog
    });
    expect(parsed.intent).toBe('PRODUCT_SEARCH');
    expect(parsed.category).toBe('Fiction');
  });

  // Test 4: Custom alias: "notebook" -> Laptops
  it('4. Custom alias: resolves configured alias "notebook" to canonical "Laptops"', () => {
    const catalog = ['Laptops', 'Tablets'];
    const customAliases = {
      'Laptops': ['notebook', 'laptop computer', 'pc portable', 'حاسوب']
    };
    const parsed = EcommerceIntentParser.parse('bghit chi notebook', null, 'en', {
      catalogCategories: catalog,
      customCategoryAliases: customAliases
    });
    expect(parsed.intent).toBe('PRODUCT_SEARCH');
    expect(parsed.category).toBe('Laptops');
  });

  // Test 5: Different tenant with different categories
  it('5. Multi-tenant isolation: different tenants resolve their own specific categories', () => {
    const tenantACatalog = ['Skincare', 'Makeup'];
    const tenantBCatalog = ['Sofas', 'Chairs', 'Tables'];

    const parsedA = EcommerceIntentParser.parse('show me skincare products', null, 'en', {
      catalogCategories: tenantACatalog
    });
    expect(parsedA.category).toBe('Skincare');

    const parsedB = EcommerceIntentParser.parse('show me skincare products', null, 'en', {
      catalogCategories: tenantBCatalog
    });
    // For Tenant B, "skincare" is not in their catalog or config
    expect(parsedB.category).toBeUndefined();

    const parsedBChairs = EcommerceIntentParser.parse('show me chairs', null, 'en', {
      catalogCategories: tenantBCatalog
    });
    expect(parsedBChairs.category).toBe('Chairs');
  });

  // Test 6: Unknown category
  it('6. Unknown category: query with unknown category returns category undefined and extracts keywords', () => {
    const catalog = ['Electronics', 'Accessories'];
    const parsed = EcommerceIntentParser.parse('looking for guitars', null, 'en', {
      catalogCategories: catalog
    });
    expect(parsed.intent).toBe('PRODUCT_SEARCH');
    expect(parsed.category).toBeUndefined();
    expect(parsed.searchKeywords).toBe('guitars');
  });

  // Test 7: Product search without category
  it('7. Product search without category: extracts color and maxPrice filters correctly', () => {
    const catalog = ['Laptops', 'Phones'];
    const parsed = EcommerceIntentParser.parse('show me blue items under 50', null, 'en', {
      catalogCategories: catalog
    });
    expect(parsed.intent).toBe('PRODUCT_SEARCH');
    expect(parsed.category).toBeUndefined();
    expect(parsed.color).toBe('Blue');
    expect(parsed.maxPrice).toBe(50);
  });

  // Test 8: Existing AnimeVerse regression / Legacy fallback
  it('8. Legacy fallback: existing apparel categories resolve even if catalogCategories is omitted', () => {
    const parsedHoodie = EcommerceIntentParser.parse('bghit chi hoodie', null, 'en');
    expect(parsedHoodie.category).toBe('Hoodies');

    const parsedShoes = EcommerceIntentParser.parse('werini les sneakers', null, 'en');
    expect(parsedShoes.category).toBe('Shoes');
  });

  // Test 9: ecommerceEnabled=false gating
  it('9. Gating: when isEcommerceEnabled=false, TurnDecisionResolver disables ecommerce routing', () => {
    const decision = TurnDecisionResolver.resolve({
      text: 'show me laptops',
      isEcommerceEnabled: false,
      catalogCategories: ['Laptops']
    });
    expect(decision.domain).not.toBe('ECOMMERCE');
  });

  // Test 10: TurnDecisionResolver integration with dynamic catalogCategories and customAliases
  it('10. TurnDecisionResolver: passes catalogCategories and customCategoryAliases to resolve turnDecision', () => {
    const decision = TurnDecisionResolver.resolve({
      text: 'bghit notebook f noir under 1000',
      isEcommerceEnabled: true,
      catalogCategories: ['Laptops'],
      customCategoryAliases: {
        'Laptops': ['notebook', 'ordinateur']
      }
    });
    expect(decision.domain).toBe('ECOMMERCE');
    expect(decision.intent).toBe('PRODUCT_SEARCH');
    expect(decision.category).toBe('Laptops');
    expect(decision.color).toBe('Black');
    expect(decision.maxPrice).toBe(1000);
  });
});
