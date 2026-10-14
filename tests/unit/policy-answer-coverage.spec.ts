import { describe, expect, it } from 'vitest';
import { DirectRagGuard } from '../../src/domain/rag/DirectRagGuard';
import { FaqAnswerPolicy } from '../../src/domain/faq/FaqAnswerPolicy';
import { TurnDecisionResolver } from '../../src/domain/conversation/TurnDecision';
import { AnswerComposer } from '../../src/domain/conversation/AnswerComposer';
import { DEFAULT_BUSINESS_CONFIG } from '../../src/domain/tenant/BusinessConfig';

describe('grounded policy answer coverage', () => {
  it('does not return tracking instructions as a delivery-time answer', () => {
    expect(DirectRagGuard.evaluate(
      'How long will delivery take?',
      'Order and Delivery Tracking: The customer receives a tracking link by SMS.',
      'en', 'latin'
    ).reason).toBe('QUESTION_NOT_ANSWERED');
    expect(DirectRagGuard.evaluate(
      'How long will delivery take?',
      'Standard delivery in Morocco takes 24 to 48 hours.',
      'en', 'latin'
    ).isSafe).toBe(true);
  });

  it('does not return a size guide for a question about unworn items and tags', () => {
    expect(DirectRagGuard.evaluate(
      'Do items need to be unworn with tags?',
      'Size Guide: Size M fits a chest of 98 cm.', 'en', 'latin'
    ).isSafe).toBe(false);
    expect(DirectRagGuard.evaluate(
      'Do items need to be unworn with tags?',
      'Returns are accepted for unworn items with original tags.', 'en', 'latin'
    ).isSafe).toBe(true);
  });

  it('uses one localized returns FAQ for a clear Darija paraphrase', () => {
    const config = {
      ...DEFAULT_BUSINESS_CONFIG,
      capabilities: {
        ...DEFAULT_BUSINESS_CONFIG.capabilities,
        faq: [{ id: 'returns', category: 'returns',
          questions: { darija: 'شنو هي سياسة الترجيع والتبديل؟' },
          answers: { darija: 'الترجيع والتبديل متاح خلال 14 يوم للسلعة اللي ما تلبساتش.' }
        }]
      }
    } as typeof DEFAULT_BUSINESS_CONFIG;
    const answer = FaqAnswerPolicy.match('واش نقدر نرجع السلعة؟', config, 'darija', {
      domain: 'KNOWLEDGE', intent: 'RETURNS', responseLanguage: 'darija', responseScript: 'arabic'
    });
    expect(answer?.answer).toContain('14 يوم');
  });

  it('carries a returns-condition follow-up only when returns evidence is active', () => {
    const text = 'Do items need to be unworn with tags?';
    expect(TurnDecisionResolver.resolve({ text, isEcommerceEnabled: false }).intent).not.toBe('RETURNS');
    expect(TurnDecisionResolver.resolve({ text, isEcommerceEnabled: false,
      activePolicyEvidence: { RETURNS: [{ factualContent: 'Unworn items with tags' }] }
    }).intent).toBe('RETURNS');
  });

  it('keeps both requested policies inside the response length limit', () => {
    const answer = AnswerComposer.composeMultiPolicyDeterministic([
      { intent: 'RETURNS', content: 'Returns Policy\nReturns are available within 14 days of delivery. Items must be unworn with tags attached.' },
      { intent: 'SHIPPING', content: 'Shipping Policy\nStandard delivery within Morocco costs 30 MAD. Delivery takes 24 to 48 hours.' }
    ], 'en', 'latin');
    const finalized = AnswerComposer.finalizeResponse(answer);
    expect(finalized).toContain('14 days');
    expect(finalized).toContain('30 MAD');
    expect(finalized.length).toBeLessThanOrEqual(500);
  });
});
