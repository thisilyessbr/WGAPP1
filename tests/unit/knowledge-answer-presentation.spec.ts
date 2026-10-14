import { describe, expect, it } from 'vitest';
import { AnswerComposer } from '../../src/domain/conversation/AnswerComposer';
import { DEFAULT_BUSINESS_CONFIG } from '../../src/domain/tenant/BusinessConfig';

const decision = { domain: 'KNOWLEDGE', intent: 'KNOWLEDGE', source: 'DETERMINISTIC', confidence: 1, responseLanguage: 'en', responseScript: 'latin' } as const;

describe('customer-facing knowledge answers', () => {
  it('omits a PDF title but preserves all care facts', () => {
    expect(AnswerComposer.formatDirectKnowledgeAnswer(
      'Atlas Boutique T-shirt care guide\nWash the Atlas cotton T-shirt at 30 degrees Celsius.\nAir dry it. Do not tumble dry.'
    )).toBe('Wash the Atlas cotton T-shirt at 30 degrees Celsius.\nAir dry it. Do not tumble dry.');
  });

  it('does not remove a factual first line merely because it has no period', () => {
    expect(AnswerComposer.formatDirectKnowledgeAnswer('Returns within 7 days\nContact us before returning.'))
      .toBe('Returns within 7 days\nContact us before returning.');
  });

  it('guides a standard business to configured topics without advertising products', () => {
    const config = structuredClone(DEFAULT_BUSINESS_CONFIG);
    config.capabilities.ecommerceEnabled = false;
    config.portalFacts = { policies: { shipping: 'Delivery in Morocco', returns: 'Within 7 days' }, services: [] };
    config.identity.businessHours = 'Monday to Friday';
    const answer = AnswerComposer.composeUnknownAnswer({ turnDecision: decision as any, responseLanguage: 'en', responseScript: 'latin', config });
    expect(answer).toContain('delivery, returns and opening hours');
    expect(answer).not.toContain('products');
  });

  it('offers products for commerce mode and keeps Darija in Arabizi script', () => {
    const config = structuredClone(DEFAULT_BUSINESS_CONFIG);
    config.capabilities.ecommerceEnabled = true;
    config.portalFacts = { policies: { shipping: 'Morocco delivery' } };
    const answer = AnswerComposer.composeUnknownAnswer({ turnDecision: decision as any, responseLanguage: 'darija', responseScript: 'arabizi', config });
    expect(answer).toContain('lmontojat');
    expect(answer).toContain('tawsil');
    expect(answer).not.toMatch(/[\u0600-\u06FF]/u);
  });
});
