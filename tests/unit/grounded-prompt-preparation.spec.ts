import { describe, expect, it } from 'vitest';
import { GroundedPromptBuilder } from '../../src/domain/conversation/GroundedPromptBuilder';
import { BusinessConfig } from '../../src/domain/tenant/BusinessConfig';
import { RAGResult } from '../../src/domain/rag/RAGService';
import { TurnDecision } from '../../src/domain/conversation/TurnDecision';

const config = {
  identity: { botName: 'Relayqo', language: 'en' },
  knowledge: { maxContextSize: 100 }
} as BusinessConfig;

const chunks = [
  { id: 'one', documentId: 'doc', content: 'Returns take 14 days.', score: 0.9, similarity: 0.9 },
  { id: 'two', documentId: 'doc', content: 'Shipping takes 3 days.', score: 0.7, similarity: 0.7 }
];

describe('grounded prompt preparation', () => {
  it('keeps post-completion evidence bounded to the dominant chunk', () => {
    const result = GroundedPromptBuilder.prepareGroundedAnswer({
      config, turnDecision: { domain: 'KNOWLEDGE', intent: 'RETURNS', source: 'RAG' } as TurnDecision,
      ragResult: { context: 'raw context', chunks }, content: 'Returns?',
      language: 'en', recentTurns: []
    });
    expect(result.groundingEvidence).toContain('Returns take 14 days.');
    expect(result.groundingEvidence).not.toContain('Shipping takes 3 days.');
    expect(result.userPromptContent).toContain('Returns?');
  });

  it('preserves full multi-policy context and live catalog facts for the fresh path', () => {
    const ragResult: RAGResult = { context: 'Raw complete policy context', chunks };
    const result = GroundedPromptBuilder.prepareGroundedAnswer({
      config, turnDecision: {
        domain: 'KNOWLEDGE', intent: 'RETURNS', source: 'RAG',
        isMultiPolicy: true, policyIntents: ['RETURNS', 'SHIPPING']
      } as TurnDecision,
      ragResult, content: 'Returns and shipping?', language: 'en', recentTurns: [],
      productContextInfo: '\nLive Store Catalog Fact: Shirt in stock', useRawMultiPolicyContext: true
    });
    expect(result.groundingEvidence).toContain('Raw complete policy context');
    expect(result.groundingEvidence).toContain('Shirt in stock');
    expect(result.userPromptContent).toContain('RETURNS AND SHIPPING');
  });
});
