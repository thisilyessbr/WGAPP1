import { describe, it, expect } from 'vitest';
import { TurnDecisionResolver } from '../../src/domain/conversation/TurnDecision';
import { ProductContext } from '../../src/domain/conversation/ConversationContext';
import { EcommerceService, ProductFact } from '../../src/domain/ecommerce/EcommerceService';

describe('Phase 26C: Authoritative Turn Decision for Ecommerce Tests', () => {
  it('1. Product search inquiry resolves to ECOMMERCE domain with PRODUCT_SEARCH intent', () => {
    const decision = TurnDecisionResolver.resolve({
      text: 'bghit chi hoodie anime under 300 MAD'
    });

    expect(decision.domain).toBe('ECOMMERCE');
    expect(decision.intent).toBe('PRODUCT_SEARCH');
    expect(decision.source).toBe('ECOMMERCE');
    expect(decision.searchKeywords).toBeDefined();
    expect(decision.maxPrice).toBe(300);
  });

  it('2. Price inquiry resolves to ECOMMERCE domain with PRICE intent', () => {
    const decision = TurnDecisionResolver.resolve({
      text: 'ch7al taman dyal Capuchon Moon Ninja?'
    });

    expect(decision.domain).toBe('ECOMMERCE');
    expect(decision.intent).toBe('PRICE');
    expect(decision.source).toBe('ECOMMERCE');
    expect(decision.productName?.toLowerCase()).toContain('moon ninja');
  });

  it('3. Detail inquiry resolves to ECOMMERCE domain with PRODUCT_DETAIL intent', () => {
    const mockContext: ProductContext = {
      selectedProductId: 'prod-hoodie-1',
      selectedVariantId: null,
      selectedSku: 'HOOD-01',
      selectedColor: null,
      selectedSize: null
    };

    const decision = TurnDecisionResolver.resolve({
      text: 'وريني تفاصيل ديالو شنو المميزات والمادة ديالو؟',
      productContext: mockContext
    });

    expect(decision.domain).toBe('ECOMMERCE');
    expect(decision.intent).toBe('PRODUCT_DETAIL');
    expect(decision.source).toBe('ECOMMERCE');
    expect(decision.productId).toBe('prod-hoodie-1');
  });

  it('4. Availability inquiry resolves to ECOMMERCE domain with AVAILABILITY intent', () => {
    const mockContext: ProductContext = {
      selectedProductId: 'prod-hoodie-1',
      selectedVariantId: null,
      selectedSku: 'HOOD-01',
      selectedColor: null,
      selectedSize: null
    };

    const decision = TurnDecisionResolver.resolve({
      text: 'واش كاين فالأسود؟',
      productContext: mockContext
    });

    expect(decision.domain).toBe('ECOMMERCE');
    expect(decision.intent).toBe('AVAILABILITY');
    expect(decision.source).toBe('ECOMMERCE');
    expect(decision.productId).toBe('prod-hoodie-1');
    expect(decision.color?.toUpperCase()).toBe('BLACK');
  });

  it('5. Variant selection resolves to ECOMMERCE domain with VARIANT_SELECTION intent', () => {
    const mockContext: ProductContext = {
      selectedProductId: 'prod-hoodie-1',
      selectedVariantId: null,
      selectedSku: 'HOOD-01',
      selectedColor: 'BLACK',
      selectedSize: null
    };

    const decision = TurnDecisionResolver.resolve({
      text: 'f M',
      productContext: mockContext
    });

    expect(decision.domain).toBe('ECOMMERCE');
    expect(decision.intent).toBe('VARIANT_SELECTION');
    expect(decision.source).toBe('ECOMMERCE');
    expect(decision.productId).toBe('prod-hoodie-1');
    expect(decision.color).toBe('BLACK');
    expect(decision.size).toBe('M');
  });

  it('6. Explicit product reference overrides stale context and clears old variant selections', () => {
    const staleContext: ProductContext = {
      selectedProductId: 'old-jacket-id',
      selectedVariantId: 'old-var-id',
      selectedSku: 'OLD-JKT',
      selectedColor: 'BLACK',
      selectedSize: 'XL'
    };

    const decision = TurnDecisionResolver.resolve({
      text: 'w l hoodie Neon Ronin, ch7al kan taman dyalo?',
      productContext: staleContext
    });

    expect(decision.domain).toBe('ECOMMERCE');
    expect(decision.intent).toBe('PRICE');
    expect(decision.productName?.toLowerCase()).toContain('neon ronin');
    expect(decision.productId).toBeNull(); // Old product context cleared for explicit switch
    expect(decision.color).toBeNull(); // Stale variant cleared
    expect(decision.size).toBeNull(); // Stale variant cleared
  });

  it('7. Contextual follow-up inherits selected product and prior variant attributes', () => {
    const activeContext: ProductContext = {
      selectedProductId: 'prod-jacket-99',
      selectedVariantId: 'var-99-white',
      selectedSku: 'JKT-WHT-L',
      selectedColor: 'WHITE',
      selectedSize: 'L'
    };

    const decision = TurnDecisionResolver.resolve({
      text: 'bch7al hada daba?',
      productContext: activeContext
    });

    expect(decision.domain).toBe('ECOMMERCE');
    expect(decision.intent).toBe('PRICE');
    expect(decision.productId).toBe('prod-jacket-99');
    expect(decision.color).toBe('WHITE');
    expect(decision.size).toBe('L');
  });

  it('8. Invalid variant does not fall back to base product stock in EcommerceService', () => {
    const fakeProduct: any = {
      id: 'prod-shoe-1',
      title: 'Running Shoes',
      price: '100.00',
      currency: 'MAD',
      stock: 50, // Base product has stock 50
      variants: [
        { id: 'v-black-42', color: 'BLACK', size: '42', stock: 10, priceOverride: null }
      ]
    };

    // Instantiate mock repo to test EcommerceService behavior on non-existent variant
    const mockRepo: any = {
      findById: async () => fakeProduct
    };
    const ecomService = new EcommerceService(mockRepo);

    // Request non-existent variant: RED size 45
    return ecomService.getProductFact('t1', 'acc1', { id: 'prod-shoe-1', color: 'RED', size: '45' }, 'en')
      .then((fact: ProductFact | null) => {
        expect(fact).not.toBeNull();
        expect(fact!.selectedVariant).toBeNull();
        expect(fact!.availableStock).toBe(0); // Must be 0, NOT 50
        expect(fact!.inStock).toBe(false); // Must be false
      });
  });

  it('9. Zero-match ecommerce search stays in ECOMMERCE domain and does not fall through to RAG', () => {
    const decision = TurnDecisionResolver.resolve({
      text: 'واش عندكم Attack on Titan collection جديدة؟'
    });

    expect(decision.domain).toBe('ECOMMERCE');
    expect(decision.intent).toBe('PRODUCT_SEARCH');
    expect(decision.source).toBe('ECOMMERCE');
  });

  it('10. Response language and script metadata are preserved across decisions', () => {
    const arDecision = TurnDecisionResolver.resolve({
      text: 'شحال الثمن ديال هاد التيشيرت؟'
    });
    expect(arDecision.responseLanguage).toMatch(/^(?:ar|darija)$/);
    expect(arDecision.responseScript).toBe('arabic');

    const arabiziDecision = TurnDecisionResolver.resolve({
      text: 'ch7al taman dyalo?'
    });
    expect(arabiziDecision.responseLanguage).toBe('darija');
    expect(arabiziDecision.responseScript).toBe('arabizi');

    const frDecision = TurnDecisionResolver.resolve({
      text: 'Est-ce que vous avez des vestes en noir ?'
    });
    expect(frDecision.responseLanguage).toBe('fr');
    expect(frDecision.responseScript).toBe('latin');
  });
});
