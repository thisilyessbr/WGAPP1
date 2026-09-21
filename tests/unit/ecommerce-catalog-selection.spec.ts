import { describe, expect, it } from 'vitest';
import { EcommerceIntentParser } from '../../src/domain/ecommerce/EcommerceIntent';

describe('catalog browsing and numbered product selection', () => {
  it('treats a general catalog request as an unfiltered product search', () => {
    const parsed = EcommerceIntentParser.parse('tell me about ur products', null, 'en');

    expect(parsed).toMatchObject({ intent: 'PRODUCT_SEARCH' });
    expect(parsed.productName).toBeUndefined();
    expect(parsed.searchKeywords).toBeUndefined();
  });

  it('resolves a numbered follow-up against the previously displayed products', () => {
    const parsed = EcommerceIntentParser.parse(
      'i want number one',
      { lastViewedProductIds: ['jacket-id', 'shirt-id', 'hoodie-id'] },
      'en'
    );

    expect(parsed).toMatchObject({ intent: 'VARIANT_SELECTION', ordinalIndex: 0 });
  });
});
