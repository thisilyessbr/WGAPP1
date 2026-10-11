import { describe, expect, it } from 'vitest';
import { FaqAnswerPolicy } from '../../src/domain/faq/FaqAnswerPolicy';
import { TurnDecisionResolver } from '../../src/domain/conversation/TurnDecision';
import { DEFAULT_BUSINESS_CONFIG } from '../../src/domain/tenant/BusinessConfig';
import { DirectRagGuard } from '../../src/domain/rag/DirectRagGuard';

const shipping = {
  id: 'shipping', category: 'shipping',
  questions: { en: 'What is shipping?', darija: 'شحال التوصيل؟' },
  answers: { en: 'Shipping across Morocco is 30 MAD.', darija: 'التوصيل فالمغرب بـ30 درهم.' }
};
const returns = {
  id: 'returns', category: 'returns',
  questions: { en: 'What is the return policy?', darija: 'شنو سياسة الترجيع؟' },
  answers: { en: 'Returns within 14 days for unworn items with tags.', darija: 'الترجيع فـ14 يوم للسلعة اللي ما ملبوساش ومع التيكيت.' }
};
const config = {
  ...DEFAULT_BUSINESS_CONFIG,
  identity: { ...DEFAULT_BUSINESS_CONFIG.identity, country: 'Morocco' },
  capabilities: { ...DEFAULT_BUSINESS_CONFIG.capabilities, faq: [shipping, returns] }
};

describe('approved policy FAQ routing', () => {
  it('never returns serialized multilingual FAQ storage text verbatim', () => {
    const stored = 'FAQ [HOURS]: What are your opening hours?\nAnswer: 10:00.\nMultilingual Answers:\n- [ar] 10:00';
    expect(DirectRagGuard.evaluate('كيفاش نتبع الطلب؟', stored, 'darija', 'arabic').isSafe).toBe(false);
    expect(DirectRagGuard.hasInternalArtifacts(stored)).toBe(true);
  });
  it('uses a unique approved returns FAQ for a short unqualified Darija question', () => {
    expect(FaqAnswerPolicy.match('واش نقدر نرجع السلعة؟', config, 'darija')?.answer).toContain('14 يوم');
  });

  it('answers a paraphrase from the sole approved category, but not an uncovered shipping detail', () => {
    const decision = TurnDecisionResolver.resolve({ text: 'How long does delivery take?', language: 'en', isEcommerceEnabled: false });
    const detailed = { ...config, capabilities: { ...config.capabilities, faq: [
      { ...shipping, answers: { ...shipping.answers, en: 'Shipping across Morocco is 30 MAD and takes 24–48 hours.' } }, returns
    ] } };
    expect(FaqAnswerPolicy.match('How long does delivery take?', detailed, 'en', decision)?.answer).toContain('24–48');
    expect(FaqAnswerPolicy.match('Do you have express delivery?', detailed, 'en', decision)).toBeNull();
    expect(FaqAnswerPolicy.match('How much is shipping to Casablanca?', detailed, 'en', decision)).toBeNull();
  });

  it('does not use the generic answer for a qualified return or ambiguous FAQ category', () => {
    expect(FaqAnswerPolicy.match('واش نقدر نرجع السلعة بلا تيكيت؟', config, 'darija')).toBeNull();
    const ambiguous = { ...config, capabilities: { ...config.capabilities,
      faq: [...config.capabilities.faq, { ...returns, id: 'returns-sale', questions: { darija: 'شنو سياسة الترجيع فالصولد؟' } }] } };
    expect(FaqAnswerPolicy.match('واش نقدر نرجع السلعة؟', ambiguous, 'darija')).toBeNull();
  });

  it('combines only unique localized policy facts and rejects foreign shipping scope', () => {
    expect(FaqAnswerPolicy.matchPolicySet('Shipping fees and return policy?', config, 'en', ['SHIPPING', 'RETURNS'], 'latin'))
      .toMatchObject([{ intent: 'SHIPPING' }, { intent: 'RETURNS' }]);
    expect(FaqAnswerPolicy.matchPolicySet('Shipping to France and return policy?', config, 'en', ['SHIPPING', 'RETURNS'], 'latin')).toBeNull();
    const missingFrench = { ...config, capabilities: { ...config.capabilities,
      faq: [shipping, { ...returns, answers: { en: returns.answers.en } }] } };
    expect(FaqAnswerPolicy.matchPolicySet('Frais de livraison et retours ?', missingFrench, 'fr', ['SHIPPING', 'RETURNS'], 'latin')).toBeNull();
  });

  it('does not treat tracking and shipping FAQs as the same category', () => {
    const tracking = { id: 'tracking', category: 'tracking', answers: { en: 'A tracking link is sent by SMS after dispatch.' } };
    const withTracking = { ...config, capabilities: { ...config.capabilities, faq: [shipping, returns, tracking] } };
    expect(FaqAnswerPolicy.matchPolicySet('Shipping fees and return policy?', withTracking, 'en', ['SHIPPING', 'RETURNS'], 'latin'))
      .toMatchObject([{ faqId: 'shipping' }, { faqId: 'returns' }]);
    expect(FaqAnswerPolicy.isCategoryCompatible('SHIPPING', 'TRACKING')).toBe(false);
  });

  it('inherits return conditions only from a sole prior returns topic', () => {
    const input = { text: 'Do items need to be unworn with tags?', language: 'en', isEcommerceEnabled: false };
    expect(TurnDecisionResolver.resolve(input).intent).not.toBe('RETURNS');
    expect(TurnDecisionResolver.resolve({ ...input, activePolicyEvidence: { RETURNS: [{}] } }).intent).toBe('RETURNS');
    expect(TurnDecisionResolver.resolve({ ...input, activePolicyEvidence: { RETURNS: [{}], SHIPPING: [{}] } }).intent).not.toBe('RETURNS');
  });

  it('does not mistake tracking or paying on delivery for two shipping policies', () => {
    expect(TurnDecisionResolver.detectPolicySignals('How do I track my delivery?')).toMatchObject({ intent: 'TRACKING', isMultiPolicy: false });
    expect(TurnDecisionResolver.detectPolicySignals('Do I pay the delivery driver?')).toMatchObject({ intent: 'PAYMENT', isMultiPolicy: false });
    expect(TurnDecisionResolver.detectPolicySignals('What is the delivery cost and can I pay cash?').isMultiPolicy).toBe(true);
  });
  it('uses a sole cached topic for clear tracking and opening-hours follow-ups', () => {
    expect(TurnDecisionResolver.resolve({ text: 'Will I receive an SMS link?', activePolicyEvidence: { TRACKING: [{}] } }).intent).toBe('TRACKING');
    expect(TurnDecisionResolver.resolve({ text: 'Are you open on Saturdays?', activePolicyEvidence: { STORE_INFO: [{}] } }).intent).toBe('STORE_INFO');
    expect(TurnDecisionResolver.resolve({ text: 'Will I receive an SMS link?', activePolicyEvidence: { TRACKING: [{}], SHIPPING: [{}] } }).intent).not.toBe('TRACKING');
    expect(TurnDecisionResolver.resolve({ text: 'What is your customer service email and phone?' }).intent).toBe('SUPPORT');
  });
  it('states only the general returns policy in a product conversation, with an exception caveat', () => {
    const hybrid = { domain: 'KNOWLEDGE' as const, source: 'HYBRID' as const, intent: 'RETURNS' };
    const answer = FaqAnswerPolicy.match('What is the return policy for it?', config, 'en', hybrid)?.answer;
    expect(answer).toContain('14 days');
    expect(answer).toMatch(/exception/i);
    expect(FaqAnswerPolicy.match('Can I return this sale item?', config, 'en', hybrid)).toBeNull();
  });
});
