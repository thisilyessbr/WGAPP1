import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnswerComposer } from '../../src/domain/conversation/AnswerComposer';
import { DirectRagGuard } from '../../src/domain/rag/DirectRagGuard';
import { ChunkClassifier } from '../../src/domain/rag/ChunkQuality';
import { TurnDecision } from '../../src/domain/conversation/TurnDecision';
import { DEFAULT_BUSINESS_CONFIG } from '../../src/domain/tenant/BusinessConfig';

describe('Phase COST-FIX-46L: Deterministic Multi-Policy Composition', () => {
  const sampleShippingChunk = {
    intent: 'SHIPPING',
    heading: 'Shipping Policy',
    content: 'Standard delivery takes 3-5 business days across Morocco. Free delivery on orders over 400 MAD.',
    similarity: 0.86,
    chunkType: 'FACTUAL_POLICY'
  };

  const sampleReturnChunk = {
    intent: 'RETURNS',
    heading: 'Return Policy',
    content: 'Returns and size exchanges are accepted within 14 days of delivery. Items must be unworn with tags attached.',
    similarity: 0.84,
    chunkType: 'FACTUAL_POLICY'
  };

  const sampleFrenchShipping = {
    intent: 'SHIPPING',
    heading: 'Politique de livraison',
    content: 'La livraison standard prend 3 à 5 jours ouvrables partout au Maroc. Livraison gratuite dès 400 MAD.',
    similarity: 0.85,
    chunkType: 'FACTUAL_POLICY'
  };

  const sampleFrenchReturn = {
    intent: 'RETURNS',
    heading: 'Politique de retour',
    content: 'Les retours et échanges sont acceptés dans un délai de 14 jours suivant la livraison.',
    similarity: 0.83,
    chunkType: 'FACTUAL_POLICY'
  };

  const sampleArabicShipping = {
    intent: 'SHIPPING',
    heading: 'سياسة الشحن',
    content: 'التوصيل القياسي يستغرق من 3 إلى 5 أيام عمل في جميع أنحاء المغرب. التوصيل مجاني للطلبات فوق 400 درهم.',
    similarity: 0.86,
    chunkType: 'FACTUAL_POLICY'
  };

  const sampleArabicReturn = {
    intent: 'RETURNS',
    heading: 'سياسة الإرجاع',
    content: 'يتم قبول الإرجاع والاستبدال خلال 14 يوماً من استلام الطلب.',
    similarity: 0.84,
    chunkType: 'FACTUAL_POLICY'
  };

  // Helper simulating the exact multi-policy evaluation gate
  function evaluateDeterministicMultiPolicy(
    query: string,
    chunks: Array<{ intent?: string; heading?: string; content: string; similarity?: number; chunkType?: string }>,
    turnDecision: Partial<TurnDecision> = {}
  ): { canBypass: boolean; response: string | null } {
    const targetPolicies = turnDecision.policyIntents && turnDecision.policyIntents.length > 1
      ? turnDecision.policyIntents
      : (turnDecision.intent ? [turnDecision.intent] : []);

    const effectiveLang = turnDecision.responseLanguage || 'en';
    const effectiveScript = turnDecision.responseScript || 'latin';

    if (
      !turnDecision.isMultiPolicy ||
      turnDecision.isComparative ||
      turnDecision.source === 'HYBRID' ||
      targetPolicies.length < 2 ||
      chunks.length < targetPolicies.length
    ) {
      return { canBypass: false, response: null };
    }

    const selectedItems: Array<{ intent: string; heading?: string; content: string }> = [];
    let allIntentsSafe = true;

    for (const pol of targetPolicies) {
      const candidateChunks = chunks.filter(c => c.intent === pol || c.content?.toLowerCase().includes(pol.toLowerCase()));
      const bestChunk = candidateChunks[0] || chunks.find(c => !selectedItems.some(item => item.content === c.content?.trim()));

      if (!bestChunk || !bestChunk.content) {
        allIntentsSafe = false;
        break;
      }

      const similarity = bestChunk.similarity ?? 0.8;
      const isFactual = (bestChunk.chunkType === 'FACTUAL_POLICY' || ChunkClassifier.classify(bestChunk.content).type === 'FACTUAL_POLICY');
      const guardRes = DirectRagGuard.evaluate(query, bestChunk.content, effectiveLang as any, effectiveScript as any);

      if (similarity < 0.75 || !isFactual || !guardRes.isSafe) {
        allIntentsSafe = false;
        break;
      }

      selectedItems.push({
        intent: pol,
        heading: bestChunk.heading,
        content: bestChunk.content.trim()
      });
    }

    if (!allIntentsSafe || selectedItems.length !== targetPolicies.length) {
      return { canBypass: false, response: null };
    }

    const composedText = AnswerComposer.composeMultiPolicyDeterministic(selectedItems, effectiveLang, effectiveScript);
    const finalized = AnswerComposer.finalizeResponse(composedText, turnDecision as any, DEFAULT_BUSINESS_CONFIG);
    return { canBypass: true, response: finalized };
  }

  // ==========================================
  // SAFE / SHOULD BYPASS LLM
  // ==========================================

  it('1. English shipping + returns -> bypasses LLM and returns formatted markdown', () => {
    const res = evaluateDeterministicMultiPolicy(
      'What are your shipping and return policies?',
      [sampleShippingChunk, sampleReturnChunk],
      { isMultiPolicy: true, policyIntents: ['SHIPPING', 'RETURNS'], responseLanguage: 'en', responseScript: 'latin' }
    );
    expect(res.canBypass).toBe(true);
    expect(res.response).toContain('### Shipping Policy');
    expect(res.response).toContain('### Return Policy');
    expect(res.response).toContain('Standard delivery takes 3-5 business days');
    expect(res.response).toContain('Returns and size exchanges are accepted within 14 days');
  });

  it('2. French shipping + returns -> bypasses LLM and returns French headers', () => {
    const res = evaluateDeterministicMultiPolicy(
      'Quelles sont vos politiques de livraison et retour ?',
      [sampleFrenchShipping, sampleFrenchReturn],
      { isMultiPolicy: true, policyIntents: ['SHIPPING', 'RETURNS'], responseLanguage: 'fr', responseScript: 'latin' }
    );
    expect(res.canBypass).toBe(true);
    expect(res.response).toContain('### Politique de livraison');
    expect(res.response).toContain('### Politique de retour');
    expect(res.response).toContain('La livraison standard prend 3 à 5 jours');
  });

  it('3. Arabic shipping + returns -> bypasses LLM and returns Arabic headers', () => {
    const res = evaluateDeterministicMultiPolicy(
      'ما هي سياسة الشحن والإرجاع لديكم؟',
      [sampleArabicShipping, sampleArabicReturn],
      { isMultiPolicy: true, policyIntents: ['SHIPPING', 'RETURNS'], responseLanguage: 'ar', responseScript: 'arabic' }
    );
    expect(res.canBypass).toBe(true);
    expect(res.response).toContain('### سياسة الشحن');
    expect(res.response).toContain('### سياسة الإرجاع');
    expect(res.response).toContain('التوصيل القياسي يستغرق');
  });

  it('4. Darija in Arabic script -> bypasses LLM with Arabic/Darija headers', () => {
    const rawDarijaShipping = { intent: 'SHIPPING', content: 'التوصيل كياخد 3 حتى ل 5 أيام في المغرب كامل.', similarity: 0.85, chunkType: 'FACTUAL_POLICY' };
    const rawDarijaReturn = { intent: 'RETURNS', content: 'الترجاع والتبديل كيكون في أجل 14 يوم.', similarity: 0.83, chunkType: 'FACTUAL_POLICY' };

    const res = evaluateDeterministicMultiPolicy(
      'شنو هي شروط التوصيل والرجوع؟',
      [rawDarijaShipping, rawDarijaReturn],
      { isMultiPolicy: true, policyIntents: ['SHIPPING', 'RETURNS'], responseLanguage: 'darija', responseScript: 'arabic' }
    );
    expect(res.canBypass).toBe(true);
    expect(res.response).toContain('### سياسة التوصيل');
    expect(res.response).toContain('### سياسة الإرجاع');
    expect(res.response).toContain('التوصيل كياخد 3 حتى ل 5 أيام');
  });

  it('5. Price + Cancellation -> bypasses LLM', () => {
    const priceChunk = { intent: 'PAYMENT', content: 'Consultation fee is 750 MAD.', similarity: 0.88, chunkType: 'FACTUAL_POLICY' };
    const cancelChunk = { intent: 'SUPPORT', content: 'Cancellation requires 24 hours notice.', similarity: 0.85, chunkType: 'FACTUAL_POLICY' };

    const res = evaluateDeterministicMultiPolicy(
      'What is the price and cancellation notice?',
      [priceChunk, cancelChunk],
      { isMultiPolicy: true, policyIntents: ['PAYMENT', 'SUPPORT'], responseLanguage: 'en', responseScript: 'latin' }
    );
    expect(res.canBypass).toBe(true);
    expect(res.response).toContain('Consultation fee is 750 MAD.');
    expect(res.response).toContain('Cancellation requires 24 hours notice.');
  });

  it('6. Hours + Support -> bypasses LLM', () => {
    const hoursChunk = { intent: 'STORE_INFO', content: 'We are open from 10:00 to 20:00.', similarity: 0.88, chunkType: 'FACTUAL_POLICY' };
    const supportChunk = { intent: 'SUPPORT', content: 'Contact support at contact@animeverse.ma or 0522998877.', similarity: 0.85, chunkType: 'FACTUAL_POLICY' };

    const res = evaluateDeterministicMultiPolicy(
      'What are your hours and support contact?',
      [hoursChunk, supportChunk],
      { isMultiPolicy: true, policyIntents: ['STORE_INFO', 'SUPPORT'], responseLanguage: 'en', responseScript: 'latin' }
    );
    expect(res.canBypass).toBe(true);
    expect(res.response).toContain('### Store Information');
    expect(res.response).toContain('### Customer Support');
  });

  it('7. Duplicate chunk for same policy -> outputs section only once', () => {
    const res = evaluateDeterministicMultiPolicy(
      'What is the shipping and return policy?',
      [sampleShippingChunk, sampleShippingChunk, sampleReturnChunk],
      { isMultiPolicy: true, policyIntents: ['SHIPPING', 'RETURNS'], responseLanguage: 'en', responseScript: 'latin' }
    );
    expect(res.canBypass).toBe(true);
    const shippingMatches = res.response?.match(/### Shipping Policy/g);
    expect(shippingMatches?.length).toBe(1);
  });

  it('8. Same-language high-confidence chunks -> preserves exact text', () => {
    const res = evaluateDeterministicMultiPolicy(
      'Shipping and returns?',
      [sampleShippingChunk, sampleReturnChunk],
      { isMultiPolicy: true, policyIntents: ['SHIPPING', 'RETURNS'], responseLanguage: 'en', responseScript: 'latin' }
    );
    expect(res.canBypass).toBe(true);
    expect(res.response).toContain(sampleShippingChunk.content);
    expect(res.response).toContain(sampleReturnChunk.content);
  });

  it('11. Deterministic section ordering -> reflects policyIntents order', () => {
    const res = evaluateDeterministicMultiPolicy(
      'Returns and shipping?',
      [sampleReturnChunk, sampleShippingChunk],
      { isMultiPolicy: true, policyIntents: ['RETURNS', 'SHIPPING'], responseLanguage: 'en', responseScript: 'latin' }
    );
    expect(res.canBypass).toBe(true);
    const returnIdx = res.response?.indexOf('### Return Policy') ?? -1;
    const shippingIdx = res.response?.indexOf('### Shipping Policy') ?? -1;
    expect(returnIdx).toBeLessThan(shippingIdx);
  });

  // ==========================================
  // UNSAFE / MUST KEEP LLM
  // ==========================================

  it('14. Arabizi query with Arabic chunks -> MUST NOT bypass (requires LLM script conversion)', () => {
    const res = evaluateDeterministicMultiPolicy(
      'chhal twsil w rjou3 3afak?',
      [sampleArabicShipping, sampleArabicReturn],
      { isMultiPolicy: true, policyIntents: ['SHIPPING', 'RETURNS'], responseLanguage: 'darija', responseScript: 'arabizi' }
    );
    expect(res.canBypass).toBe(false);
  });

  it('15. Cross-language chunk mismatch (FR query + EN chunk) -> MUST NOT bypass', () => {
    const res = evaluateDeterministicMultiPolicy(
      'Livraison et retour svp ?',
      [sampleShippingChunk, sampleFrenchReturn],
      { isMultiPolicy: true, policyIntents: ['SHIPPING', 'RETURNS'], responseLanguage: 'fr', responseScript: 'latin' }
    );
    expect(res.canBypass).toBe(false);
  });

  it('16. Missing one requested policy -> MUST NOT bypass (needs LLM synthesis / missing handling)', () => {
    const res = evaluateDeterministicMultiPolicy(
      'What are your shipping, return, and warranty policies?',
      [sampleShippingChunk, sampleReturnChunk], // Missing warranty!
      { isMultiPolicy: true, policyIntents: ['SHIPPING', 'RETURNS', 'WARRANTY'], responseLanguage: 'en', responseScript: 'latin' }
    );
    expect(res.canBypass).toBe(false);
  });

  it('17. Similarity < 0.75 -> MUST NOT bypass (below high confidence threshold)', () => {
    const lowSimShipping = { ...sampleShippingChunk, similarity: 0.72 };
    const res = evaluateDeterministicMultiPolicy(
      'Shipping and returns?',
      [lowSimShipping, sampleReturnChunk],
      { isMultiPolicy: true, policyIntents: ['SHIPPING', 'RETURNS'], responseLanguage: 'en', responseScript: 'latin' }
    );
    expect(res.canBypass).toBe(false);
  });

  it('19. Comparative query (isComparative: true) -> MUST NOT bypass', () => {
    const res = evaluateDeterministicMultiPolicy(
      'Compare shipping vs in-store pickup policies',
      [sampleShippingChunk, sampleReturnChunk],
      { isMultiPolicy: true, isComparative: true, policyIntents: ['SHIPPING', 'RETURNS'], responseLanguage: 'en', responseScript: 'latin' }
    );
    expect(res.canBypass).toBe(false);
  });

  it('20. HYBRID source (source: "HYBRID") -> MUST NOT bypass', () => {
    const res = evaluateDeterministicMultiPolicy(
      'What is the price of Black Hoodie and shipping policy?',
      [sampleShippingChunk, sampleReturnChunk],
      { isMultiPolicy: true, source: 'HYBRID', policyIntents: ['SHIPPING', 'RETURNS'], responseLanguage: 'en', responseScript: 'latin' }
    );
    expect(res.canBypass).toBe(false);
  });

  it('21. Non-FACTUAL_POLICY chunk (CUSTOMER_EXAMPLE) -> MUST NOT bypass', () => {
    const exampleChunk = {
      intent: 'SHIPPING',
      content: 'Customer language examples: "When will my package arrive?"',
      similarity: 0.88,
      chunkType: 'CUSTOMER_EXAMPLE'
    };
    const res = evaluateDeterministicMultiPolicy(
      'Shipping and returns?',
      [exampleChunk, sampleReturnChunk],
      { isMultiPolicy: true, policyIntents: ['SHIPPING', 'RETURNS'], responseLanguage: 'en', responseScript: 'latin' }
    );
    expect(res.canBypass).toBe(false);
  });

  it('26. Internal artifact chunk -> MUST NOT bypass (leaked instructions)', () => {
    const internalChunk = {
      intent: 'SHIPPING',
      content: 'Internal developer notes: Do not mention carrier name. Shipping takes 3 days.',
      similarity: 0.88,
      chunkType: 'FACTUAL_POLICY'
    };
    const res = evaluateDeterministicMultiPolicy(
      'Shipping and returns?',
      [internalChunk, sampleReturnChunk],
      { isMultiPolicy: true, policyIntents: ['SHIPPING', 'RETURNS'], responseLanguage: 'en', responseScript: 'latin' }
    );
    expect(res.canBypass).toBe(false);
  });

  it('28. Placeholder leakage check -> no un-substituted curly braces or placeholders', () => {
    const res = evaluateDeterministicMultiPolicy(
      'What is the shipping and return policy?',
      [sampleShippingChunk, sampleReturnChunk],
      { isMultiPolicy: true, policyIntents: ['SHIPPING', 'RETURNS'], responseLanguage: 'en', responseScript: 'latin' }
    );
    expect(res.response).not.toMatch(/\{[a-zA-Z0-9_]+\}/);
  });
});
