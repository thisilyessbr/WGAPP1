import { describe, expect, it } from 'vitest';
import { RagRetrievalPlanner } from '../../src/domain/conversation/RagRetrievalPlanner';
import { BusinessConfig } from '../../src/domain/tenant/BusinessConfig';
import { TurnDecision } from '../../src/domain/conversation/TurnDecision';
import { PolicyEvidence } from '../../src/domain/rag/PolicyEvidence';

const config = { knowledge: { topK: 2 } } as BusinessConfig;
const decision = (overrides: Partial<TurnDecision>): TurnDecision => ({
  domain: 'KNOWLEDGE', intent: 'RETURNS', source: 'RAG',
  responseLanguage: 'en', responseScript: 'latin', ...overrides
});
const evidence = (intent: string, factualContent: string): PolicyEvidence => ({
  intent, factualContent, sourceDocumentId: `doc-${intent}`, sourceChunkId: `chunk-${intent}`,
  confidence: 0.95, chunkType: 'FACTUAL_POLICY', provenance: { tenantId: 'tenant' }
});

describe('RAG retrieval planner', () => {
  it('bypasses reformulation for a safe single canonical policy', () => {
    expect(RagRetrievalPlanner.canBypassReformulator({
      decision: decision({}), content: 'What is your return policy?', config, evidence: {}
    })).toBe(true);
  });

  it('does not bypass reformulation on scope expansion, comparison or multi-policy', () => {
    for (const variant of [
      { isScopeExpansion: true }, { isComparative: true },
      { isMultiPolicy: true, policyIntents: ['RETURNS', 'SHIPPING'] }
    ]) {
      expect(RagRetrievalPlanner.canBypassReformulator({
        decision: decision(variant), content: 'What about that?', config, evidence: {}
      })).toBe(false);
    }
  });

  it('retains bounded multi-policy topK without changing the account config', () => {
    const planned = RagRetrievalPlanner.knowledgeConfigForTurn(config, decision({ isMultiPolicy: true }));
    expect(planned.knowledge?.topK).toBe(4);
    expect(config.knowledge?.topK).toBe(2);
    expect(RagRetrievalPlanner.knowledgeConfigForTurn(config, decision({}))).toBe(config);
  });

  it('reuses sufficient single-policy evidence without vector retrieval', () => {
    const plan = RagRetrievalPlanner.planCachedEvidence({
      decision: decision({}), content: 'What is your return policy?', config,
      evidence: { RETURNS: [evidence('RETURNS', 'Returns are accepted for 14 days with tags.')] }
    });
    expect(plan.reusedSingle).toBe(true);
    expect(plan.result?.chunks).toHaveLength(1);
    expect(plan.missingIntents).toEqual([]);
  });

  it('retrieves only the missing topic in a partially cached multi-policy question', () => {
    const plan = RagRetrievalPlanner.planCachedEvidence({
      decision: decision({ isMultiPolicy: true, policyIntents: ['RETURNS', 'SHIPPING'] }),
      content: 'What are returns and shipping?', config,
      evidence: { RETURNS: [evidence('RETURNS', 'Returns are accepted for 14 days with tags.')] }
    });
    expect(plan.reusedMulti).toBe(false);
    expect(plan.cachedChunks).toHaveLength(1);
    expect(plan.missingIntents).toEqual(['SHIPPING']);
  });

  it('reuses a fully cached multi-policy answer', () => {
    const plan = RagRetrievalPlanner.planCachedEvidence({
      decision: decision({ isMultiPolicy: true, policyIntents: ['RETURNS', 'SHIPPING'] }),
      content: 'What are returns and shipping?', config,
      evidence: {
        RETURNS: [evidence('RETURNS', 'Returns are accepted for 14 days with tags.')],
        SHIPPING: [evidence('SHIPPING', 'Delivery across Morocco is 30 MAD.')]
      }
    });
    expect(plan.reusedMulti).toBe(true);
    expect(plan.result?.chunks).toHaveLength(2);
    expect(plan.missingIntents).toEqual([]);
  });
});
