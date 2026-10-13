import { describe, expect, it } from 'vitest';
import { AnswerComposer } from '../../src/domain/conversation/AnswerComposer';
import { responseMediaStorage } from '../../src/domain/conversation/ResponseMediaContext';

const productFact = {
  product: {
    id: 'jean-1', name: 'Jean Atlas bleu', sku: 'JNS-001',
    metadata: { images: ['https://example.test/jean.jpg'] }, variants: []
  },
  effectivePrice: 299, currency: 'MAD', inStock: true,
  availableStock: 8, displayName: 'Jean Atlas bleu', displayDescription: 'Jean bleu'
} as any;

describe('response media context', () => {
  it('returns the selected product image only for an image request', async () => {
    const context = { media: [] as any[] };
    await responseMediaStorage.run(context, async () => {
      AnswerComposer.composeEcommerce({
        turnDecision: { domain: 'ECOMMERCE', intent: 'PRODUCT_DETAIL', requestedMediaType: 'image' } as any,
        productFacts: productFact, userMessage: 'bghit nchouf tswira dyalo',
        responseLanguage: 'darija', responseScript: 'arabizi'
      });
    });
    expect(context.media).toMatchObject([{ type: 'image', url: 'https://example.test/jean.jpg' }]);

    const nextTurn = { media: [] as any[] };
    responseMediaStorage.run(nextTurn, () => {
      AnswerComposer.composeEcommerce({
        turnDecision: { domain: 'ECOMMERCE', intent: 'PRICE' } as any,
        productFacts: productFact, userMessage: 'ch7al taman?',
        responseLanguage: 'darija', responseScript: 'arabizi'
      });
    });
    expect(nextTurn.media).toEqual([]);
  });
});
