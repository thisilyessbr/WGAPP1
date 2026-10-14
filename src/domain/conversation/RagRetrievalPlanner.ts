import { PolicyEvidenceReuse } from '../rag/PolicyEvidenceReuse';
import { PolicyEvidence } from '../rag/PolicyEvidence';
import { BusinessConfig } from '../tenant/BusinessConfig';
import { ProductContext } from './ConversationContext';
import { TurnDecision } from './TurnDecision';
import { RAGChunk, RAGResult } from '../rag/RAGService';

interface CachedEvidencePlan {
  result: RAGResult | null;
  reusedSingle: boolean;
  reusedMulti: boolean;
  missingIntents: string[];
  cachedChunks: RAGChunk[];
}

/** Pure routing decisions for knowledge retrieval; no embeddings or session writes. */
export class RagRetrievalPlanner {
  static planCachedEvidence(input: {
    decision: TurnDecision;
    content: string;
    config: BusinessConfig;
    evidence: Record<string, PolicyEvidence[]>;
  }): CachedEvidencePlan {
    const { decision, content, config, evidence } = input;
    const plan: CachedEvidencePlan = {
      result: null, reusedSingle: false, reusedMulti: false,
      missingIntents: [], cachedChunks: []
    };
    if (!decision.isMultiPolicy && PolicyEvidenceReuse.isCanonicalPolicy(decision.intent)) {
      const cached = evidence[decision.intent];
      if (cached?.length && PolicyEvidenceReuse.isSufficient(decision.intent, content, cached, config).isSufficient) {
        const chunks = PolicyEvidenceReuse.evidenceToChunks(cached);
        plan.result = { context: chunks.map(chunk => chunk.content).join('\n---\n'), chunks };
        plan.reusedSingle = true;
      }
    }
    if (!plan.reusedSingle && decision.isMultiPolicy && (decision.policyIntents?.length || 0) > 1) {
      for (const intent of decision.policyIntents!) {
        const cached = evidence[intent];
        if (PolicyEvidenceReuse.isCanonicalPolicy(intent) && cached?.length &&
            PolicyEvidenceReuse.isSufficient(intent, content, cached, config).isSufficient) {
          plan.cachedChunks.push(...PolicyEvidenceReuse.evidenceToChunks(cached));
        } else {
          plan.missingIntents.push(intent);
        }
      }
      if (plan.missingIntents.length === 0 && plan.cachedChunks.length > 0) {
        plan.result = {
          context: plan.cachedChunks.map(chunk => chunk.content).join('\n---\n'),
          chunks: plan.cachedChunks
        };
        plan.reusedMulti = true;
      }
    }
    return plan;
  }

  static canBypassReformulator(input: {
    decision: TurnDecision;
    content: string;
    config: BusinessConfig;
    evidence: Record<string, PolicyEvidence[]>;
    productContext?: ProductContext | null;
  }): boolean {
    const { decision, content, config, evidence, productContext } = input;
    const hasSufficientSessionPolicyEvidence = !decision.isMultiPolicy &&
      PolicyEvidenceReuse.isCanonicalPolicy(decision.intent) &&
      Boolean(evidence[decision.intent]?.length) &&
      PolicyEvidenceReuse.isSufficient(decision.intent, content, evidence[decision.intent], config).isSufficient;
    const isSafeSingleCanonicalPolicy = !decision.isMultiPolicy &&
      PolicyEvidenceReuse.isCanonicalPolicy(decision.intent) &&
      !decision.isScopeExpansion &&
      !PolicyEvidenceReuse.isScopeExpanded(decision.intent, content, config);
    const isSafeProductContextFollowUp = Boolean(
      productContext?.selectedProductId &&
      ['PRICE', 'AVAILABILITY', 'COLOR', 'SIZE', 'VARIANT_SELECTION'].includes(decision.intent) &&
      !decision.isMultiPolicy
    );
    const isUnsafeToBypass = Boolean(
      ['RECOMMENDATION', 'SEARCH', 'PRODUCT_SEARCH', 'UNKNOWN'].includes(decision.intent) ||
      decision.isComparative || decision.isPluralReference || decision.isScopeExpansion || decision.isMultiPolicy
    );
    return (hasSufficientSessionPolicyEvidence || isSafeSingleCanonicalPolicy || isSafeProductContextFollowUp) &&
      !isUnsafeToBypass;
  }

  static knowledgeConfigForTurn(config: BusinessConfig, decision: TurnDecision): BusinessConfig {
    if (!decision.isMultiPolicy || !config.knowledge) return config;
    return {
      ...config,
      knowledge: { ...config.knowledge, topK: Math.min(6, Math.max(config.knowledge.topK || 3, 4)) }
    };
  }
}
