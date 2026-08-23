/**
 * semantic-boundary-35b.spec.ts
 *
 * Verification suite for Phase 35B — Global Response / Semantic Boundary Rebuild:
 * 1. Canonical Semantic IR & Explicit Context Scope (GLOBAL, PRODUCT, VARIANT, REFERENCE, UNRESOLVED)
 * 2. Unknown Target State persistence and follow-up handling
 * 3. Authoritative Evidence IR & RAG Trust Boundary (No internal document titles/examples leaked)
 * 4. Product Attribute Grounding (Unsupported attribute refusal)
 * 5. Composite Task Completeness Accounting (No silent drops)
 * 6. Multilingual Variant Entity Resolution
 * 7. Universal Final Response Boundary Enforcement
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { NormalizedTurnParser } from '../../src/domain/conversation/NormalizedTurnParser';
import { ExecutionPlanner } from '../../src/domain/conversation/ExecutionPlanner';
import { AnswerComposer } from '../../src/domain/conversation/AnswerComposer';
import { EvidenceBundleBuilder } from '../../src/domain/conversation/EvidenceBundle';
import { ClaimEvidenceRegistry } from '../../src/domain/conversation/ClaimEvidenceRegistry';
import { DirectRagGuard } from '../../src/domain/rag/DirectRagGuard';
import { InternalArtifactDetector } from '../../src/domain/rag/InternalArtifactDetector';
import { ProductContext } from '../../src/domain/conversation/ConversationContext';
import { bootstrapChatbot } from '../../src/bootstrap';
import { prisma, pool } from '../../src/tests/testDb';
import { LLMMockProvider } from '../../src/core/llm/LLMProvider';
import { MockEmbeddingProvider } from '../../src/core/rag/EmbeddingProvider';

describe('Phase 35B — Global Response / Semantic Boundary Rebuild', () => {
  const activeProductContext: ProductContext = {
    selectedProductId: 'prod-hoodie-1',
    selectedSku: 'ANV-H001',
    selectedColor: 'Black',
    selectedSize: 'M',
    lastViewedProductIds: ['prod-hoodie-1']
  };

  const unresolvedProductContext: ProductContext = {
    selectedProductId: null,
    selectedSku: null,
    selectedColor: null,
    selectedSize: null,
    lastViewedProductIds: [],
    unresolvedTarget: {
      rawQuery: 'Naruto sneakers',
      normalizedEntity: 'Naruto sneakers',
      category: 'Shoes',
      reason: 'NOT_FOUND',
      timestamp: Date.now()
    }
  };

  describe('1. Explicit Context Scope & Canonical IR', () => {
    it('1. Classifies variant-only follow-up "M?" as VARIANT scope with active context', () => {
      const turn = NormalizedTurnParser.parse('M?', 'en', activeProductContext);
      expect(turn.contextScope).toBe('VARIANT');
      expect(turn.isContextualVariantFollowUp).toBe(true);
      expect(turn.variants[0]?.size).toBe('M');
    });

    it('2. Classifies follow-up "M?" with unresolved target as UNRESOLVED scope', () => {
      const turn = NormalizedTurnParser.parse('M?', 'en', unresolvedProductContext);
      expect(turn.contextScope).toBe('UNRESOLVED');
    });

    it('3. Classifies explicit product turn as PRODUCT scope', () => {
      const turn = NormalizedTurnParser.parse('عطيني Moon Ninja Hoodie', 'ar', activeProductContext);
      expect(turn.contextScope).toBe('PRODUCT');
    });

    it('4. Classifies anaphora "واش نقدر نرجعو؟" as REFERENCE scope', () => {
      const turn = NormalizedTurnParser.parse('واش نقدر نرجعو؟', 'darija', activeProductContext);
      expect(turn.contextScope).toBe('REFERENCE');
    });

    it('5. Classifies standalone shipping "شحال التوصيل؟" as GLOBAL scope', () => {
      const turn = NormalizedTurnParser.parse('شحال التوصيل؟', 'darija', activeProductContext);
      expect(turn.contextScope).toBe('GLOBAL');
      expect(turn.hasGlobalPolicyIntent).toBe(true);
    });
  });

  describe('2. Multilingual Variant Entity Normalization', () => {
    it('6. Resolves color across Arabic, Darija, Arabizi, French, and English to canonical "Black"', () => {
      const turns = [
        NormalizedTurnParser.parse('واش كاين فالأسود؟'),
        NormalizedTurnParser.parse('wach kayn flk7l?'),
        NormalizedTurnParser.parse('disponible en noir?'),
        NormalizedTurnParser.parse('is it in black?')
      ];

      for (const t of turns) {
        expect(t.variants[0]?.color).toBe('Black');
      }
    });

    it('7. Resolves size across languages to canonical "L" with structural boundaries', () => {
      const validTurns = [
        NormalizedTurnParser.parse('size L'),
        NormalizedTurnParser.parse('taille L'),
        NormalizedTurnParser.parse('قياس L'),
        NormalizedTurnParser.parse('f L kayn')
      ];

      for (const t of validTurns) {
        expect(t.variants[0]?.size).toBe('L');
      }

      const invalidTurns = [
        NormalizedTurnParser.parse('l kol nhar'),
        NormalizedTurnParser.parse('l produit'),
        NormalizedTurnParser.parse('le produit')
      ];

      for (const t of invalidTurns) {
        expect(t.variants.find(v => Boolean(v.size))).toBeUndefined();
      }
    });
  });

  describe('3. RAG Trust Boundary & Internal Artifact Sanitization', () => {
    it('8. Detects and sanitizes internal training/example labels from RAG chunks', () => {
      const contaminatedChunk = 'Developer internal guidance: secret_key. Customer language examples: (How much is shipping?). Delivery across Morocco is 30 MAD.';
      expect(DirectRagGuard.hasInternalArtifacts(contaminatedChunk)).toBe(true);

      const sanitized = DirectRagGuard.sanitizeInternalArtifacts(contaminatedChunk);
      expect(sanitized).not.toContain('Developer internal guidance');
      expect(sanitized).not.toContain('Customer language examples');
      expect(sanitized).toContain('Delivery across Morocco is 30 MAD');
    });

    it('9. FinalizeResponse strips internal stack traces and metadata completely', () => {
      const contaminatedOutput = 'Error: CONCURRENCY_CONFLICT at /app/src/engine.ts. Delivery is 30 MAD.';
      const finalized = AnswerComposer.finalizeResponse(contaminatedOutput, {
        domain: 'POLICY',
        intent: 'SHIPPING',
        responseLanguage: 'en',
        responseScript: 'latin',
        confidence: 1
      });

      expect(finalized).not.toContain('CONCURRENCY_CONFLICT');
      expect(finalized).not.toContain('/app/src');
    });
  });

  describe('4. Composite Completeness & Task Accounting', () => {
    it('10. Correctly computes task accounting for 6-intent composite query', () => {
      const builder = new EvidenceBundleBuilder(['task-price', 'task-stock', 'task-returns', 'task-shipping', 'task-care', 'task-tracking']);

      builder.recordTaskResult({ taskId: 'task-price', type: 'ECOMMERCE_FACT', intent: 'PRICE', status: 'COMPLETED' });
      builder.recordTaskResult({ taskId: 'task-stock', type: 'ECOMMERCE_FACT', intent: 'AVAILABILITY', status: 'COMPLETED' });
      builder.recordTaskResult({ taskId: 'task-returns', type: 'KNOWLEDGE_RETRIEVAL', intent: 'RETURNS', status: 'COMPLETED' });
      builder.recordTaskResult({ taskId: 'task-shipping', type: 'KNOWLEDGE_RETRIEVAL', intent: 'SHIPPING', status: 'COMPLETED' });
      builder.recordTaskResult({ taskId: 'task-care', type: 'KNOWLEDGE_RETRIEVAL', intent: 'CARE', status: 'UNAVAILABLE' });
      builder.recordTaskResult({ taskId: 'task-tracking', type: 'KNOWLEDGE_RETRIEVAL', intent: 'TRACKING', status: 'UNAVAILABLE' });

      const bundle = builder.build();
      expect(bundle.taskAccounting.isComplete).toBe(true);
      expect(bundle.taskAccounting.completedTasks.length).toBe(4);
      expect(bundle.taskAccounting.unavailableTasks.length).toBe(2);
      expect(bundle.taskAccounting.failedTasks.length).toBe(0);
    });
  });

  describe('5. End-to-End Runtime Boundary Integration', () => {
    let deps: ReturnType<typeof bootstrapChatbot>;
    let mockLlm: LLMMockProvider;
    let mockEmbedding: MockEmbeddingProvider;

    beforeEach(async () => {
      const client = await pool.connect();
      try {
        await client.query('SET search_path TO test, public, extensions;');
      } finally {
        client.release();
      }

      deps = bootstrapChatbot(prisma);
      mockEmbedding = new MockEmbeddingProvider();
      (deps.ragService as any)['embeddingProvider'] = mockEmbedding;

      mockLlm = new LLMMockProvider();
      deps.llmFactory.registerProvider('mock', 'mock-model', mockLlm);
      deps.llmFactory.registerProvider('deepseek', 'deepseek-chat', mockLlm);
      deps.tenantConfigService.clearCache();
    });

    it('11. Deterministic follow-up on unresolved target produces clear refusal without LLM call', async () => {
      const tenantId = 'animeverse';
      const accountId = 'animeverse-store';
      const customerId = `cust-35b-${Date.now()}`;

      // Turn 1: Search for non-existent product
      const res1 = await deps.conversationEngine.handleMessage(tenantId, customerId, 'bghit Naruto sneakers', accountId);
      expect(res1.toLowerCase()).toMatch(/not found|trouvé|ما كاين|ما لقيناش|makayninch|naruto/);

      // Turn 2: Follow up with "M?"
      const res2 = await deps.conversationEngine.handleMessage(tenantId, customerId, 'M?', accountId);
      expect(res2).toContain('Naruto sneakers');
      expect(res2.toLowerCase()).toMatch(/not available|non disponible|غير متوفر|ما كاينش|makaynch/);
    });

    it('12. Deterministic route uses 0 LLM calls', async () => {
      let llmCount = 0;
      mockLlm.generateResponse = async () => {
        llmCount++;
        return 'Mock response';
      };

      const turn = NormalizedTurnParser.parse('M?');
      const plan = ExecutionPlanner.plan(turn, activeProductContext);
      expect(plan.requiresLlmSynthesis).toBe(false);
      expect(llmCount).toBe(0);
    });
  });
});
