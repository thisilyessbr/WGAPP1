import { describe, it, expect } from 'vitest';
import { EcommerceIntentParser } from '../../src/domain/ecommerce/EcommerceIntent';
import { TurnDecisionResolver } from '../../src/domain/conversation/TurnDecision';
import { ProductContext } from '../../src/domain/conversation/ConversationContext';

describe('PHASE ECOMMERCE-FIX-1: Global Entity Extraction & Semantic Contract Tests', () => {
  const activeHoodieContext: ProductContext = {
    selectedProductId: 'prod-hoodie-001',
    selectedSku: 'ANV-H001',
    selectedColor: null,
    selectedSize: null,
    lastViewedProductIds: ['prod-hoodie-001', 'prod-jacket-002', 'prod-tshirt-003']
  };

  const activeTshirtContext: ProductContext = {
    selectedProductId: 'prod-tshirt-003',
    selectedSku: 'ANV-T001',
    selectedColor: null,
    selectedSize: null,
    lastViewedProductIds: ['prod-tshirt-003']
  };

  describe('1. Availability + Color Contract (Preserving Active Context)', () => {
    it('Darija Arabic: "واش كاينة فالأسود؟" (Feminine verb should not become product "ة")', () => {
      const p = EcommerceIntentParser.parse('واش كاينة فالأسود؟', activeHoodieContext, 'darija');
      expect(p.intent).toBe('AVAILABILITY');
      expect(p.color).toBe('Black');
      expect(p.productName).toBeUndefined();

      const decision = TurnDecisionResolver.resolve({
        messageText: 'واش كاينة فالأسود؟',
        ecommerceParams: p,
        productContext: activeHoodieContext,
        responseSource: 'ECOMMERCE'
      });
      expect(decision.domain).toBe('ECOMMERCE');
      expect(decision.intent).toBe('AVAILABILITY');
      expect(decision.color).toBe('Black');
      expect(decision.productId).toBe('prod-hoodie-001'); // Inherited!
    });

    it('Darija Arabic: "واش باقي كاين فالأسود؟" (Compound state phrase should not become product)', () => {
      const p = EcommerceIntentParser.parse('واش باقي كاين فالأسود؟', activeTshirtContext, 'darija');
      expect(p.intent).toBe('AVAILABILITY');
      expect(p.color).toBe('Black');
      expect(p.productName).toBeUndefined();

      const decision = TurnDecisionResolver.resolve({
        messageText: 'واش باقي كاين فالأسود؟',
        ecommerceParams: p,
        productContext: activeTshirtContext,
        responseSource: 'ECOMMERCE'
      });
      expect(decision.productId).toBe('prod-tshirt-003');
      expect(decision.color).toBe('Black');
    });

    it('MSA Arabic: "هل هي متوفرة بالأسود؟"', () => {
      const p = EcommerceIntentParser.parse('هل هي متوفرة بالأسود؟', activeHoodieContext, 'ar');
      expect(p.intent).toBe('AVAILABILITY');
      expect(p.color).toBe('Black');
      expect(p.productName).toBeUndefined();

      const decision = TurnDecisionResolver.resolve({
        messageText: 'هل هي متوفرة بالأسود؟',
        ecommerceParams: p,
        productContext: activeHoodieContext,
        responseSource: 'ECOMMERCE'
      });
      expect(decision.productId).toBe('prod-hoodie-001');
      expect(decision.color).toBe('Black');
    });

    it('Arabizi: "wash kayna f noir?"', () => {
      const p = EcommerceIntentParser.parse('wash kayna f noir?', activeHoodieContext, 'darija');
      expect(p.intent).toBe('AVAILABILITY');
      expect(p.color).toBe('Black');
      expect(p.productName).toBeUndefined();

      const decision = TurnDecisionResolver.resolve({
        messageText: 'wash kayna f noir?',
        ecommerceParams: p,
        productContext: activeHoodieContext,
        responseSource: 'ECOMMERCE'
      });
      expect(decision.productId).toBe('prod-hoodie-001');
      expect(decision.color).toBe('Black');
    });

    it('French: "Est-elle disponible en noir ?"', () => {
      const p = EcommerceIntentParser.parse('Est-elle disponible en noir ?', activeHoodieContext, 'fr');
      expect(p.intent).toBe('AVAILABILITY');
      expect(p.color).toBe('Black');
      expect(p.productName).toBeUndefined();

      const decision = TurnDecisionResolver.resolve({
        messageText: 'Est-elle disponible en noir ?',
        ecommerceParams: p,
        productContext: activeHoodieContext,
        responseSource: 'ECOMMERCE'
      });
      expect(decision.productId).toBe('prod-hoodie-001');
      expect(decision.color).toBe('Black');
    });

    it('English: "Is it available in black?"', () => {
      const p = EcommerceIntentParser.parse('Is it available in black?', activeHoodieContext, 'en');
      expect(p.intent).toBe('AVAILABILITY');
      expect(p.color).toBe('Black');
      expect(p.productName).toBeUndefined();

      const decision = TurnDecisionResolver.resolve({
        messageText: 'Is it available in black?',
        ecommerceParams: p,
        productContext: activeHoodieContext,
        responseSource: 'ECOMMERCE'
      });
      expect(decision.productId).toBe('prod-hoodie-001');
      expect(decision.color).toBe('Black');
    });
  });

  describe('2. Availability + Size Contract (Preserving Active Context)', () => {
    it('Darija Arabic: "واش كاين M؟"', () => {
      const p = EcommerceIntentParser.parse('واش كاين M؟', activeHoodieContext, 'darija');
      expect(p.intent).toBe('AVAILABILITY');
      expect(p.size).toBe('M');
      expect(p.productName).toBeUndefined();

      const decision = TurnDecisionResolver.resolve({
        messageText: 'واش كاين M؟',
        ecommerceParams: p,
        productContext: activeHoodieContext,
        responseSource: 'ECOMMERCE'
      });
      expect(decision.productId).toBe('prod-hoodie-001');
      expect(decision.size).toBe('M');
    });

    it('Darija Arabic with proclitic: "واش كاينة فـ L؟"', () => {
      const p = EcommerceIntentParser.parse('واش كاينة فـ L؟', activeHoodieContext, 'darija');
      expect(p.intent).toBe('AVAILABILITY');
      expect(p.size).toBe('L');
      expect(p.productName).toBeUndefined();

      const decision = TurnDecisionResolver.resolve({
        messageText: 'واش كاينة فـ L؟',
        ecommerceParams: p,
        productContext: activeHoodieContext,
        responseSource: 'ECOMMERCE'
      });
      expect(decision.productId).toBe('prod-hoodie-001');
      expect(decision.size).toBe('L');
    });

    it('Arabizi: "size L kayn?"', () => {
      const p = EcommerceIntentParser.parse('size L kayn?', activeHoodieContext, 'darija');
      expect(p.intent).toBe('AVAILABILITY');
      expect(p.size).toBe('L');
      expect(p.productName).toBeUndefined();

      const decision = TurnDecisionResolver.resolve({
        messageText: 'size L kayn?',
        ecommerceParams: p,
        productContext: activeHoodieContext,
        responseSource: 'ECOMMERCE'
      });
      expect(decision.productId).toBe('prod-hoodie-001');
      expect(decision.size).toBe('L');
    });

    it('French: "Est-ce disponible en taille XL ?"', () => {
      const p = EcommerceIntentParser.parse('Est-ce disponible en taille XL ?', activeHoodieContext, 'fr');
      expect(p.intent).toBe('AVAILABILITY');
      expect(p.size).toBe('XL');
      expect(p.productName).toBeUndefined();

      const decision = TurnDecisionResolver.resolve({
        messageText: 'Est-ce disponible en taille XL ?',
        ecommerceParams: p,
        productContext: activeHoodieContext,
        responseSource: 'ECOMMERCE'
      });
      expect(decision.productId).toBe('prod-hoodie-001');
      expect(decision.size).toBe('XL');
    });

    it('English: "Do you have size 42 in stock?"', () => {
      const p = EcommerceIntentParser.parse('Do you have size 42 in stock?', activeHoodieContext, 'en');
      expect(p.intent).toBe('AVAILABILITY');
      expect(p.size).toBe('42');
      expect(p.productName).toBeUndefined();

      const decision = TurnDecisionResolver.resolve({
        messageText: 'Do you have size 42 in stock?',
        ecommerceParams: p,
        productContext: activeHoodieContext,
        responseSource: 'ECOMMERCE'
      });
      expect(decision.productId).toBe('prod-hoodie-001');
      expect(decision.size).toBe('42');
    });
  });

  describe('3. Availability + Compound Color + Size Contract', () => {
    it('Darija Arabic: "واش كاين فالأسود M؟"', () => {
      const p = EcommerceIntentParser.parse('واش كاين فالأسود M؟', activeHoodieContext, 'darija');
      expect(p.intent).toBe('AVAILABILITY');
      expect(p.color).toBe('Black');
      expect(p.size).toBe('M');
      expect(p.productName).toBeUndefined();

      const decision = TurnDecisionResolver.resolve({
        messageText: 'واش كاين فالأسود M؟',
        ecommerceParams: p,
        productContext: activeHoodieContext,
        responseSource: 'ECOMMERCE'
      });
      expect(decision.productId).toBe('prod-hoodie-001');
      expect(decision.color).toBe('Black');
      expect(decision.size).toBe('M');
    });

    it('Arabizi: "wash kayn f noir taille L?"', () => {
      const p = EcommerceIntentParser.parse('wash kayn f noir taille L?', activeHoodieContext, 'darija');
      expect(p.intent).toBe('AVAILABILITY');
      expect(p.color).toBe('Black');
      expect(p.size).toBe('L');
      expect(p.productName).toBeUndefined();

      const decision = TurnDecisionResolver.resolve({
        messageText: 'wash kayn f noir taille L?',
        ecommerceParams: p,
        productContext: activeHoodieContext,
        responseSource: 'ECOMMERCE'
      });
      expect(decision.productId).toBe('prod-hoodie-001');
      expect(decision.color).toBe('Black');
      expect(decision.size).toBe('L');
    });

    it('English: "Is it available in Black size M?"', () => {
      const p = EcommerceIntentParser.parse('Is it available in Black size M?', activeHoodieContext, 'en');
      expect(p.intent).toBe('AVAILABILITY');
      expect(p.color).toBe('Black');
      expect(p.size).toBe('M');
      expect(p.productName).toBeUndefined();
    });
  });

  describe('4. Variant-Only Follow-Up Contract', () => {
    it('Darija Arabic: "بغيت M"', () => {
      const p = EcommerceIntentParser.parse('بغيت M', activeHoodieContext, 'darija');
      expect(p.intent).toBe('VARIANT_SELECTION');
      expect(p.size).toBe('M');
      expect(p.productName).toBeUndefined();

      const decision = TurnDecisionResolver.resolve({
        messageText: 'بغيت M',
        ecommerceParams: p,
        productContext: activeHoodieContext,
        responseSource: 'ECOMMERCE'
      });
      expect(decision.productId).toBe('prod-hoodie-001');
      expect(decision.size).toBe('M');
    });

    it('Short turn isolated size: "M?"', () => {
      const p = EcommerceIntentParser.parse('M?', activeHoodieContext, 'darija');
      expect(p.intent).toBe('VARIANT_SELECTION');
      expect(p.size).toBe('M');
      expect(p.productName).toBeUndefined();
    });

    it('Short turn size with prefix: "و M؟"', () => {
      const p = EcommerceIntentParser.parse('و M؟', activeHoodieContext, 'darija');
      expect(p.intent).toBe('VARIANT_SELECTION');
      expect(p.size).toBe('M');
      expect(p.productName).toBeUndefined();
    });

    it('Arabizi size follow-up: "bghit taille L"', () => {
      const p = EcommerceIntentParser.parse('bghit taille L', activeHoodieContext, 'darija');
      expect(p.intent).toBe('VARIANT_SELECTION');
      expect(p.size).toBe('L');
    });
  });

  describe('5. Fresh Session (No Active Context)', () => {
    it('Availability inquiry without context does not crash or hallucinate explicit target', () => {
      const p = EcommerceIntentParser.parse('واش كاين فالأسود؟', null, 'darija');
      expect(p.intent).toBe('AVAILABILITY');
      expect(p.color).toBe('Black');
      expect(p.productName).toBeUndefined();

      const decision = TurnDecisionResolver.resolve({
        messageText: 'واش كاين فالأسود؟',
        ecommerceParams: p,
        productContext: null,
        responseSource: 'ECOMMERCE'
      });
      expect(decision.productId).toBeNull();
      expect(decision.color).toBe('Black');
    });
  });

  describe('6. Explicit Product Override Contract (Overrides Active Context)', () => {
    it('Explicit category search overrides active product: "Bonjour, et la veste, elle coûte combien ?"', () => {
      const p = EcommerceIntentParser.parse('Bonjour, et la veste, elle coûte combien ?', activeHoodieContext, 'fr');
      expect(p.intent).toBe('PRICE');
      expect(p.category).toBe('Jackets');

      const decision = TurnDecisionResolver.resolve({
        messageText: 'Bonjour, et la veste, elle coûte combien ?',
        ecommerceParams: p,
        productContext: activeHoodieContext,
        responseSource: 'ECOMMERCE'
      });
      // Context invariant: Explicit category overrides active product!
      expect(decision.productId).toBeNull();
      expect(decision.category).toBe('Jackets');
    });

    it('Explicit named product search overrides active product: "بغيـت شي تيشورت أنمي أقل من 300 درهم"', () => {
      const p = EcommerceIntentParser.parse('بغيـت شي تيشورت أنمي أقل من 300 درهم', activeHoodieContext, 'darija');
      expect(p.intent).toBe('PRODUCT_SEARCH');
      expect(p.category).toBe('T-Shirts');
      expect(p.maxPrice).toBe(300);
      expect(p.productName).toBe('تيشورت أنمي');

      const decision = TurnDecisionResolver.resolve({
        messageText: 'بغيـت شي تيشورت أنمي أقل من 300 درهم',
        ecommerceParams: p,
        productContext: activeHoodieContext,
        responseSource: 'ECOMMERCE'
      });
      expect(decision.productId).toBeNull();
      expect(decision.category).toBe('T-Shirts');
      expect(decision.maxPrice).toBe(300);
    });

    it('Explicit out-of-catalog search: "بغيـت Naruto sneakers"', () => {
      const p = EcommerceIntentParser.parse('بغيـت Naruto sneakers', activeHoodieContext, 'ar');
      expect(p.intent).toBe('PRODUCT_SEARCH');
      expect(p.category).toBe('Shoes');
      expect(p.productName).toBe('Naruto sneakers');
    });
  });
});
