import { describe, it, expect } from 'vitest';
import { EcommerceIntentParser } from '../../src/domain/ecommerce/EcommerceIntent';
import { TurnDecisionResolver } from '../../src/domain/conversation/TurnDecision';
import { AnswerComposer } from '../../src/domain/conversation/AnswerComposer';
import { ProductLookupResult } from '../../src/domain/ecommerce/EcommerceService';
import { ProductWithVariants } from '../../src/domain/ecommerce/ProductRepository';

describe('PHASE ARCH-FIX-47F — Dynamic Ecommerce Attribute & Specification Resolution', () => {
  // Test A: Fashion (Cotton / Waterproof)
  it('A. Fashion: resolves cotton & waterproof attribute queries', () => {
    const parsedCotton = EcommerceIntentParser.parse('What is the material? Is it cotton?', { selectedProductId: 'prod-hoodie' });
    expect(parsedCotton.intent).toBe('ATTRIBUTE_QUERY');
    expect(parsedCotton.attributeFamily).toBe('MATERIAL');

    const parsedWaterproof = EcommerceIntentParser.parse('Is the jacket waterproof?', { selectedProductId: 'prod-jacket' });
    expect(parsedWaterproof.intent).toBe('ATTRIBUTE_QUERY');
    expect(parsedWaterproof.attributeFamily).toBe('PERFORMANCE');
  });

  // Test B: Electronics (RAM, storage, battery, screen size)
  it('B. Electronics: resolves RAM, storage, battery, screen size attribute queries', () => {
    const options = {
      candidateMetadataKeys: ['ram', 'storage', 'battery', 'screen_size']
    };

    const parsedRam = EcommerceIntentParser.parse('How much RAM does it have?', { selectedProductId: 'laptop-1' }, 'en', options);
    expect(parsedRam.intent).toBe('ATTRIBUTE_QUERY');
    expect(parsedRam.attributeFamily).toBe('RAM');
    expect(parsedRam.attributeName).toBe('ram');

    const parsedStorage = EcommerceIntentParser.parse('What is the storage capacity?', { selectedProductId: 'laptop-1' }, 'en', options);
    expect(parsedStorage.intent).toBe('ATTRIBUTE_QUERY');
    expect(parsedStorage.attributeName).toBe('storage');

    const parsedBattery = EcommerceIntentParser.parse('What is the battery life?', { selectedProductId: 'laptop-1' }, 'en', options);
    expect(parsedBattery.intent).toBe('ATTRIBUTE_QUERY');
    expect(parsedBattery.attributeName).toBe('battery');

    const parsedScreen = EcommerceIntentParser.parse('What is the screen size?', { selectedProductId: 'laptop-1' }, 'en', options);
    expect(parsedScreen.intent).toBe('ATTRIBUTE_QUERY');
    expect(parsedScreen.attributeName).toBe('screen_size');
  });

  // Test C: Beauty (SPF, ingredients, volume)
  it('C. Beauty: resolves SPF, ingredients, volume attribute queries', () => {
    const options = {
      candidateMetadataKeys: ['spf', 'ingredients', 'volume']
    };

    const parsedSpf = EcommerceIntentParser.parse('What is the SPF rating?', { selectedProductId: 'cream-1' }, 'en', options);
    expect(parsedSpf.intent).toBe('ATTRIBUTE_QUERY');
    expect(parsedSpf.attributeName).toBe('spf');

    const parsedIngredients = EcommerceIntentParser.parse('What are the ingredients?', { selectedProductId: 'cream-1' }, 'en', options);
    expect(parsedIngredients.intent).toBe('ATTRIBUTE_QUERY');
    expect(parsedIngredients.attributeName).toBe('ingredients');

    const parsedVolume = EcommerceIntentParser.parse('What is the volume in ml?', { selectedProductId: 'cream-1' }, 'en', options);
    expect(parsedVolume.intent).toBe('ATTRIBUTE_QUERY');
    expect(parsedVolume.attributeName).toBe('volume');
  });

  // Test D: Books (Author, language, format)
  it('D. Books: resolves author, language, format attribute queries', () => {
    const options = {
      candidateMetadataKeys: ['author', 'language', 'format']
    };

    const parsedAuthor = EcommerceIntentParser.parse('Who is the author of this book?', { selectedProductId: 'book-1' }, 'en', options);
    expect(parsedAuthor.intent).toBe('ATTRIBUTE_QUERY');
    expect(parsedAuthor.attributeName).toBe('author');

    const parsedLang = EcommerceIntentParser.parse('What language is this edition in?', { selectedProductId: 'book-1' }, 'en', options);
    expect(parsedLang.intent).toBe('ATTRIBUTE_QUERY');
    expect(parsedLang.attributeName).toBe('language');

    const parsedFormat = EcommerceIntentParser.parse('Is it in hardcover format?', { selectedProductId: 'book-1' }, 'en', options);
    expect(parsedFormat.intent).toBe('ATTRIBUTE_QUERY');
    expect(parsedFormat.attributeName).toBe('format');
  });

  // Test E: Furniture (Dimensions, material, weight)
  it('E. Furniture: resolves universal dimensions, material, and weight', () => {
    const parsedDim = EcommerceIntentParser.parse('What are the dimensions in cm?', { selectedProductId: 'table-1' });
    expect(parsedDim.intent).toBe('ATTRIBUTE_QUERY');
    expect(parsedDim.attributeFamily).toBe('DIMENSIONS');

    const parsedMat = EcommerceIntentParser.parse('What is the material?', { selectedProductId: 'table-1' });
    expect(parsedMat.intent).toBe('ATTRIBUTE_QUERY');
    expect(parsedMat.attributeFamily).toBe('MATERIAL');

    const parsedWeight = EcommerceIntentParser.parse('What is the weight?', { selectedProductId: 'table-1' });
    expect(parsedWeight.intent).toBe('ATTRIBUTE_QUERY');
    expect(parsedWeight.attributeFamily).toBe('WEIGHT');
  });

  // Test F: Config alias ("autonomie" -> battery)
  it('F. Config alias: maps "autonomie" to canonical battery attribute', () => {
    const options = {
      customAttributeAliases: {
        battery: ['autonomie', 'durée de batterie', 'شارج']
      }
    };

    const parsed = EcommerceIntentParser.parse('Quelle est l\'autonomie de ce modèle ?', { selectedProductId: 'phone-1' }, 'fr', options);
    expect(parsed.intent).toBe('ATTRIBUTE_QUERY');
    expect(parsed.attributeFamily).toBe('BATTERY');
    expect(parsed.attributeName).toBe('battery');
  });

  // Test G: Multilingual alias resolution
  it('G. Multilingual alias resolution in Arabic / Darija', () => {
    const options = {
      customAttributeAliases: {
        ram: ['الرام', 'رام', 'mémoire'],
        battery: ['شارج', 'البطارية', 'بطارية']
      }
    };

    const parsedAr = EcommerceIntentParser.parse('شحال فيه فالرام؟', { selectedProductId: 'phone-1' }, 'ar', options);
    expect(parsedAr.intent).toBe('ATTRIBUTE_QUERY');
    expect(parsedAr.attributeName).toBe('ram');

    const parsedDarija = EcommerceIntentParser.parse('chhal fih f charg?', { selectedProductId: 'phone-1' }, 'darija', {
      customAttributeAliases: { battery: ['charg', 'chareg'] }
    });
    expect(parsedDarija.intent).toBe('ATTRIBUTE_QUERY');
    expect(parsedDarija.attributeName).toBe('battery');
  });

  // Test H: Missing attribute does not hallucinate
  it('H. Missing attribute: returns graceful refusal without hallucinating', () => {
    const mockLaptopFact: ProductLookupResult = {
      product: {
        id: 'laptop-1',
        tenantId: 'tenant-tech',
        accountId: 'acc-1',
        sku: 'LAP-001',
        name: 'Pro Laptop 15',
        description: 'High performance laptop with sleek design.',
        price: 999 as any,
        currency: 'USD',
        stock: 5,
        active: true,
        category: 'Laptops',
        metadata: { ram: '16GB', storage: '512GB SSD' },
        createdAt: new Date(),
        updatedAt: new Date(),
        variants: []
      } as any,
      effectivePrice: 999,
      currency: 'USD',
      inStock: true,
      availableStock: 5,
      displayName: 'Pro Laptop 15',
      displayDescription: 'High performance laptop with sleek design.'
    };

    const decision = TurnDecisionResolver.resolve({
      text: 'Does it have a touch screen?',
      productContext: { selectedProductId: 'laptop-1' },
      resolvedProductFact: mockLaptopFact as any,
      candidateMetadataKeys: ['ram', 'storage', 'touch_screen']
    });

    const response = AnswerComposer.composeEcommerce({
      turnDecision: decision,
      productFacts: mockLaptopFact as any,
      responseLanguage: 'en',
      responseScript: 'latin'
    });
    expect(response).toContain('do not specify this particular feature');
  });

  // Test I: Different tenants attribute vocabulary isolation
  it('I. Tenant isolation: Tenant A aliases do not leak to Tenant B', () => {
    const tenantAOptions = {
      customAttributeAliases: { skin_type: ['type de peau', 'peau'] }
    };
    const tenantBOptions = {
      customAttributeAliases: { ram: ['mémoire vive'] }
    };

    const parsedA = EcommerceIntentParser.parse('C\'est pour quel type de peau ?', { selectedProductId: 'p1' }, 'fr', tenantAOptions);
    expect(parsedA.attributeName).toBe('skin_type');

    const parsedB = EcommerceIntentParser.parse('C\'est pour quel type de peau ?', { selectedProductId: 'p1' }, 'fr', tenantBOptions);
    expect(parsedB.attributeName).toBeUndefined();
  });

  // Test J: Variant metadata verification
  it('J. Variant metadata: finds attribute defined on specific variant', () => {
    const mockVariantFact: ProductLookupResult = {
      product: {
        id: 'phone-1',
        name: 'Smartphone X',
        description: 'Modern smartphone',
        metadata: { display: 'OLED' },
        variants: []
      } as any,
      selectedVariant: {
        id: 'var-512',
        productId: 'phone-1',
        sku: 'PH-512',
        color: 'Black',
        size: '512GB',
        metadata: { storage: '512GB' }
      } as any,
      effectivePrice: 799,
      currency: 'USD',
      inStock: true,
      availableStock: 3,
      displayName: 'Smartphone X',
      displayDescription: 'Modern smartphone'
    };

    const decision = TurnDecisionResolver.resolve({
      text: 'What is the storage capacity?',
      productContext: { selectedProductId: 'phone-1' },
      resolvedProductFact: mockVariantFact as any,
      candidateMetadataKeys: ['storage', 'display']
    });

    const response = AnswerComposer.composeEcommerce({
      turnDecision: decision,
      productFacts: mockVariantFact as any,
      responseLanguage: 'en',
      responseScript: 'latin'
    });
    expect(response).toBe('Regarding Smartphone X (storage): 512GB. Modern smartphone');
  });

  // Test K: Product metadata verification
  it('K. Product metadata: finds attribute defined on product', () => {
    const mockProductFact: ProductLookupResult = {
      product: {
        id: 'laptop-1',
        name: 'Pro Laptop 15',
        description: 'Powerful machine',
        metadata: { ram: '32GB' },
        variants: []
      } as any,
      effectivePrice: 1200,
      currency: 'USD',
      inStock: true,
      availableStock: 2,
      displayName: 'Pro Laptop 15',
      displayDescription: 'Powerful machine'
    };

    const decision = TurnDecisionResolver.resolve({
      text: 'How much RAM?',
      productContext: { selectedProductId: 'laptop-1' },
      resolvedProductFact: mockProductFact as any,
      candidateMetadataKeys: ['ram']
    });

    const response = AnswerComposer.composeEcommerce({
      turnDecision: decision,
      productFacts: mockProductFact as any,
      responseLanguage: 'en',
      responseScript: 'latin'
    });
    expect(response).toBe('Regarding Pro Laptop 15 (ram): 32GB. Powerful machine');
  });

  // Test L: Description fallback verification
  it('L. Description fallback: finds keyword in product description when metadata is empty', () => {
    const mockDescFact: ProductLookupResult = {
      product: {
        id: 'bottle-1',
        name: 'Sports Bottle',
        description: 'Thermal insulation keeps water cold for 24 hours.',
        metadata: {},
        variants: []
      } as any,
      effectivePrice: 25,
      currency: 'USD',
      inStock: true,
      availableStock: 10,
      displayName: 'Sports Bottle',
      displayDescription: 'Thermal insulation keeps water cold for 24 hours.'
    };

    const decision = TurnDecisionResolver.resolve({
      text: 'Is it cold thermal insulated?',
      productContext: { selectedProductId: 'bottle-1' },
      resolvedProductFact: mockDescFact as any
    });

    const response = AnswerComposer.composeEcommerce({
      turnDecision: decision,
      productFacts: mockDescFact as any,
      responseLanguage: 'en',
      responseScript: 'latin'
    });
    expect(response).toBe('Regarding Sports Bottle: Thermal insulation keeps water cold for 24 hours.');
  });

  // Test M: Existing apparel regression
  it('M. Existing apparel regression: oversized hoodie inquiry works seamlessly', () => {
    const parsed = EcommerceIntentParser.parse('Is the hoodie oversized fit?', { selectedProductId: 'hoodie-1' });
    expect(parsed.intent).toBe('ATTRIBUTE_QUERY');
    expect(parsed.attributeFamily).toBe('FIT');
  });

  // Test N: ecommerceEnabled=false gating
  it('N. ecommerceEnabled=false: skips attribute resolution and routes to general/knowledge', () => {
    const decision = TurnDecisionResolver.resolve({
      text: 'How much RAM does it have?',
      isEcommerceEnabled: false
    });
    expect(decision.domain).not.toBe('ECOMMERCE');
  });

  // Test O: Product search without attributes unchanged
  it('O. Product search without attributes: extracts category, price, and clean keywords correctly', () => {
    const parsed = EcommerceIntentParser.parse('Show me blue hoodies under 300 MAD');
    expect(parsed.intent).toBe('PRODUCT_SEARCH');
    expect(parsed.category).toBe('Hoodies');
    expect(parsed.color).toBe('Blue');
    expect(parsed.maxPrice).toBe(300);
  });

  // Test P: Price / product detail / variant behavior unchanged
  it('P. Price and Product Detail intents resolve with 100% fidelity', () => {
    const parsedPrice = EcommerceIntentParser.parse('How much is the black hoodie?');
    expect(parsedPrice.intent).toBe('PRICE');
    expect(parsedPrice.color).toBe('Black');

    const parsedDetail = EcommerceIntentParser.parse('Tell me more details about this item', { selectedProductId: 'prod-1' });
    expect(parsedDetail.intent).toBe('PRODUCT_DETAIL');
  });
});
