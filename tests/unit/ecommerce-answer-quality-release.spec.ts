import { describe, expect, it, vi } from 'vitest';
import { TurnDecisionResolver } from '../../src/domain/conversation/TurnDecision';
import { EcommerceIntentParser } from '../../src/domain/ecommerce/EcommerceIntent';
import { EcommerceService } from '../../src/domain/ecommerce/EcommerceService';
import { AnswerComposer } from '../../src/domain/conversation/AnswerComposer';

const product = {
  id: 'jeans-1', name: 'Jean Atlas bleu', description: 'Jeans', category: 'Pants',
  price: 299, currency: 'MAD', stock: 8, nameLocalized: null,
  descriptionLocalized: null, variants: [
    { id: 'blue-34', sku: 'BLUE-34', color: 'Blue', size: '34', stock: 4, priceOverride: null },
    { id: 'red-34', sku: 'RED-34', color: 'Red', size: '34', stock: 3, priceOverride: null }
  ]
};

describe('commerce answer quality release', () => {
  it.each([
    ['Vous avez le jean bleu en taille 34 ? Combien coûte-t-il ?', 'fr', 'latin', 'En stock : 4'],
    ['Is the blue jeans size 34 available, and how much is it?', 'en', 'latin', 'In stock: 4'],
    ['هل الجينز الأزرق مقاس 34 متوفر وكم سعره؟', 'ar', 'arabic', 'الكمية المتوفرة: 4'],
    ['سلام، واش عندكم جينز أزرق مقاس 34 وشحال الثمن؟', 'darija', 'arabic', 'كاين منو: 4']
  ] as const)('keeps price and stock in the same reply: %s', (message, language, script, stockPhrase) => {
    const turnDecision = TurnDecisionResolver.resolve({
      text: message, language, script, isEcommerceEnabled: true
    });
    expect(turnDecision.intent).toBe('PRICE');
    expect(turnDecision.requestedAvailability).toBe(true);
    const answer = AnswerComposer.composeEcommerce({
      turnDecision, userMessage: message, responseLanguage: language,
      responseScript: script, productFacts: {
        product, selectedVariant: product.variants[0], effectivePrice: 299,
        currency: 'MAD', availableStock: 4, inStock: true,
        displayName: product.name, displayDescription: product.description
      } as any
    });
    expect(answer).toContain('299 MAD');
    expect(answer).toContain(stockPhrase);
  });

  it('keeps a pure price question price-only', () => {
    const message = 'شحال الثمن ديال جينز أزرق مقاس 34؟';
    const turnDecision = TurnDecisionResolver.resolve({
      text: message, language: 'darija', script: 'arabic', isEcommerceEnabled: true
    });
    expect(turnDecision.requestedAvailability).toBe(false);
  });

  it('sums size stock across colors without attributing it to one variant', async () => {
    const service = new EcommerceService({ findById: vi.fn().mockResolvedValue(product) } as any);
    const fact = await service.getProductFact('tenant', 'account', { id: product.id, size: '34' }, 'en');
    expect(fact?.availableStock).toBe(7);
    expect(fact?.selectedVariant).toBeNull();
    const absent = await service.getProductFact('tenant', 'account', { id: product.id, size: '36' }, 'en');
    expect(absent?.availableStock).toBe(0);
    expect(absent?.inStock).toBe(false);
  });

  it('matches a canonical requested color with a localized variant color', async () => {
    const frenchCatalog = { ...product, variants: [
      { id: 'bleu-32', sku: 'BLEU-32', color: 'Bleu moyen', size: '32', stock: 4, priceOverride: null },
      { id: 'bleu-34', sku: 'BLEU-34', color: 'Bleu moyen', size: '34', stock: 4, priceOverride: null }
    ] };
    const service = new EcommerceService({
      findById: vi.fn().mockResolvedValue(frenchCatalog),
      search: vi.fn().mockResolvedValue([frenchCatalog])
    } as any);
    const fact = await service.getProductFact('tenant', 'account', { id: product.id, color: 'Blue' }, 'darija');
    expect(fact?.availableStock).toBe(8);
    expect(fact?.inStock).toBe(true);
    const sizeFact = await service.getProductFact('tenant', 'account', { id: product.id, color: 'Blue', size: '34' }, 'darija');
    expect(sizeFact?.availableStock).toBe(4);
    const search = await service.searchProducts('tenant', 'account', undefined, 'darija', { color: 'Blue' });
    expect(search[0].availableStock).toBe(8);
  });

  it('does not use parent stock for a filtered search with no matching variant', async () => {
    const service = new EcommerceService({ search: vi.fn().mockResolvedValue([product]) } as any);
    const result = await service.searchProducts('tenant', 'account', undefined, 'en', { size: '36' });
    expect(result[0].availableStock).toBe(0);
    expect(result[0].inStock).toBe(false);
  });

  it('asks for product identity instead of declaring an unresolved product out of stock', () => {
    const message = 'شحال ثمن داك المنتوج؟';
    const answer = AnswerComposer.composeEcommerce({
      turnDecision: TurnDecisionResolver.resolve({ text: message, language: 'darija', script: 'arabic' }),
      userMessage: message, responseLanguage: 'darija', responseScript: 'arabic', productFacts: null
    });
    expect(answer).toContain('صيفط ليا سميتو');
    expect(answer).not.toContain('ما كاينش');
  });

  it('recognizes common Moroccan jeans sizes', () => {
    for (const size of ['28', '30', '32', '34']) {
      expect(EcommerceIntentParser.parse(`بغيت نطلب جينز أزرق مقاس ${size}`).size).toBe(size);
    }
  });
});
