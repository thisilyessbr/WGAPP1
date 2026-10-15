import { describe, expect, it } from 'vitest';
import { publishState } from '../../src/portal/PortalStore';

const plan: any = { modules: ['services', 'knowledge'] };
const data = { name: 'Relayqo', faqs: [{ question: 'Q', answer: 'A', language: 'en' }], services: [], products: [] };

describe('publishState', () => {
  it('is NOT_PUBLISHED before the first publication', () => {
    expect(publishState({ draft: data, published: null, planSnapshot: plan } as any)).toBe('NOT_PUBLISHED');
  });
  it('is LIVE when the saved data matches the publication, whatever the key order', () => {
    const reordered = { products: [], services: [], faqs: [{ language: 'en', answer: 'A', question: 'Q' }], name: 'Relayqo' };
    expect(publishState({ draft: data, published: reordered, planSnapshot: plan } as any)).toBe('LIVE');
  });
  it('ignores modules outside the plan, which are never published', () => {
    const draft = { ...data, products: [{ sku: 'X' }] };
    expect(publishState({ draft, published: data, planSnapshot: plan } as any)).toBe('LIVE');
  });
  it('is CHANGES_WAITING after an unpublished edit', () => {
    expect(publishState({ draft: { ...data, name: 'Relayqo 2' }, published: data, planSnapshot: plan } as any)).toBe('CHANGES_WAITING');
  });
});
