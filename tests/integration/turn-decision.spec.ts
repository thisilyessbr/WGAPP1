import { describe, it, expect } from 'vitest';
import { TurnDecisionResolver } from '../../src/domain/conversation/TurnDecision';
import { ProductContext } from '../../src/domain/conversation/ConversationContext';

describe('Phase 26B: Global Turn Decision Layer Tests', () => {
  it('1. Greeting maps to GREETING domain with DETERMINISTIC source', () => {
    const decision = TurnDecisionResolver.resolve({
      text: 'Salamo 3alaykom'
    });

    expect(decision.domain).toBe('GREETING');
    expect(decision.intent).toBe('GREETING');
    expect(decision.source).toBe('DETERMINISTIC');
  });

  it('2. Product discovery search maps to ECOMMERCE domain with ECOMMERCE source', () => {
    const decision = TurnDecisionResolver.resolve({
      text: 'bghit chi hoodie dial l anime'
    });

    expect(decision.domain).toBe('ECOMMERCE');
    expect(decision.intent).toBe('PRODUCT_SEARCH');
    expect(decision.source).toBe('ECOMMERCE');
  });

  it('3. Price follow-up maps to ECOMMERCE domain with resolved context productId', () => {
    const mockContext: ProductContext = {
      selectedProductId: 'prod-hoodie-123',
      selectedVariantId: null,
      selectedSku: 'SKU-001',
      selectedColor: 'BLACK',
      selectedSize: 'L',
      lastViewedProductIds: ['prod-hoodie-123']
    };

    const decision = TurnDecisionResolver.resolve({
      text: 'وشحال الثمن ديالو؟',
      productContext: mockContext
    });

    expect(decision.domain).toBe('ECOMMERCE');
    expect(decision.intent).toBe('PRICE');
    expect(decision.source).toBe('ECOMMERCE');
    expect(decision.productId).toBe('prod-hoodie-123');
    expect(decision.color).toBe('BLACK');
    expect(decision.size).toBe('L');
  });

  it('4. Care question maps to KNOWLEDGE domain with RAG source', () => {
    const decision = TurnDecisionResolver.resolve({
      text: 'kifach nghsel l hoodie?',
      responseSource: 'RAG'
    });

    expect(decision.domain).toBe('KNOWLEDGE');
    expect(decision.intent).toBe('CARE');
    expect(decision.source).toBe('RAG');
  });

  it('5. Return policy + explicit product maps to KNOWLEDGE domain with HYBRID source', () => {
    const mockContext: ProductContext = {
      selectedProductId: 'prod-jacket-456',
      selectedVariantId: null,
      selectedSku: 'JKT-001',
      selectedColor: null,
      selectedSize: null,
      lastViewedProductIds: ['prod-jacket-456']
    };

    const decision = TurnDecisionResolver.resolve({
      text: 'شنو هي سياسة الإرجاع ديال Cyber Spirit Jacket؟',
      productContext: mockContext,
      responseSource: 'LLM'
    });

    expect(decision.domain).toBe('KNOWLEDGE');
    expect(decision.intent).toBe('RETURNS');
    expect(decision.source).toBe('HYBRID');
    expect(decision.productName?.toLowerCase()).toContain('cyber spirit jacket');
  });

  it('6. Human handoff request maps to HANDOFF domain with DETERMINISTIC source', () => {
    const decision = TurnDecisionResolver.resolve({
      text: 'بغيت نهضر مع شي واحد حقيقي / human agent'
    });

    expect(decision.domain).toBe('HANDOFF');
    expect(decision.intent).toBe('HANDOFF_REQUEST');
    expect(decision.source).toBe('DETERMINISTIC');
  });

  it('7. Unknown / Fallback inquiry maps to GENERAL domain', () => {
    const decision = TurnDecisionResolver.resolve({
      text: 'random unrelated query xyz 12345',
      responseSource: 'FALLBACK'
    });

    expect(decision.domain).toBe('GENERAL');
    expect(decision.intent).toBe('FALLBACK');
    expect(decision.source).toBe('DETERMINISTIC');
  });

  it('8. Arabic query produces Arabic language and Arabic script', () => {
    const decision = TurnDecisionResolver.resolve({
      text: 'السلام عليكم، واش كاين شي هودي؟'
    });

    expect(decision.responseLanguage).toMatch(/^(?:ar|darija)$/);
    expect(decision.responseScript).toBe('arabic');
  });

  it('9. Darija Arabizi query produces Darija language and Arabizi script', () => {
    const decision = TurnDecisionResolver.resolve({
      text: 'bghit n3rf ch7al taman dyalo 3afak'
    });

    expect(decision.responseLanguage).toBe('darija');
    expect(decision.responseScript).toBe('arabizi');
  });

  it('10. English query produces English language and Latin script', () => {
    const decision = TurnDecisionResolver.resolve({
      text: 'Do you have anime jackets in black color?'
    });

    expect(decision.responseLanguage).toBe('en');
    expect(decision.responseScript).toBe('latin');
  });

  it('11. French query produces French language and Latin script', () => {
    const decision = TurnDecisionResolver.resolve({
      text: 'Quel est le prix de la veste Cyber Spirit ?'
    });

    expect(decision.responseLanguage).toBe('fr');
    expect(decision.responseScript).toBe('latin');
  });
});
