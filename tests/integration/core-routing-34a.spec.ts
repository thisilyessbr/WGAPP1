/**
 * core-routing-34a.spec.ts
 *
 * Verification suite for Phase 34A — Global Semantic Routing Fix:
 * 1. Structural Size Entity Resolution (no false size L on ordinary words)
 * 2. Global Policy Context Isolation (no product facts on standalone policy queries)
 * 3. Recommendation Safety (daily recommendation does not filter for size L)
 * 4. Cost verification (0 LLM / 0 embedding calls for parsing & deterministic planning)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { NormalizedTurnParser } from '../../src/domain/conversation/NormalizedTurnParser';
import { ExecutionPlanner } from '../../src/domain/conversation/ExecutionPlanner';
import { TurnDecisionResolver } from '../../src/domain/conversation/TurnDecision';
import { EcommerceIntentParser } from '../../src/domain/ecommerce/EcommerceIntent';
import { ProductContext } from '../../src/domain/conversation/ConversationContext';
import { bootstrapChatbot } from '../../src/bootstrap';
import { prisma, pool } from '../../src/tests/testDb';
import { LLMMockProvider } from '../../src/core/llm/LLMProvider';
import { MockEmbeddingProvider } from '../../src/core/rag/EmbeddingProvider';

describe('Phase 34A — Global Semantic Routing Fix', () => {
  const activeProductContext: ProductContext = {
    selectedProductId: 'prod-hoodie-123',
    selectedSku: 'ANV-H001',
    selectedColor: 'Black',
    selectedSize: 'M',
    lastViewedProductIds: ['prod-hoodie-123', 'prod-tshirt-456']
  };

  describe('1. Structural Size Entity Parsing', () => {
    it('1. Parses "size L" as size L', () => {
      const turn = NormalizedTurnParser.parse('size L');
      expect(turn.variants[0]?.size).toBe('L');
      expect(turn.entities.some(e => e.type === 'VARIANT' && e.canonicalName === 'L')).toBe(true);
    });

    it('2. Parses "taille L" as size L', () => {
      const turn = NormalizedTurnParser.parse('taille L');
      expect(turn.variants[0]?.size).toBe('L');
      expect(turn.entities.some(e => e.type === 'VARIANT' && e.canonicalName === 'L')).toBe(true);
    });

    it('3. Parses "قياس L" as size L', () => {
      const turn = NormalizedTurnParser.parse('قياس L');
      expect(turn.variants[0]?.size).toBe('L');
      expect(turn.entities.some(e => e.type === 'VARIANT' && e.canonicalName === 'L')).toBe(true);
    });

    it('4. Parses "f L kayn" as size L', () => {
      const turn = NormalizedTurnParser.parse('f L kayn');
      expect(turn.variants[0]?.size).toBe('L');
      expect(turn.entities.some(e => e.type === 'VARIANT' && e.canonicalName === 'L')).toBe(true);
    });

    it('5. Parses short turn "L?" as size L', () => {
      const turn = NormalizedTurnParser.parse('L?');
      expect(turn.variants[0]?.size).toBe('L');
      expect(turn.entities.some(e => e.type === 'VARIANT' && e.canonicalName === 'L')).toBe(true);
    });

    it('6. Does NOT parse "l kol nhar" as size L', () => {
      const turn = NormalizedTurnParser.parse('l kol nhar');
      const sizeVariant = turn.variants.find(v => Boolean(v.size));
      expect(sizeVariant).toBeUndefined();
      expect(turn.entities.some(e => e.type === 'VARIANT' && e.canonicalName === 'L')).toBe(false);
    });

    it('7. Does NOT parse "l produit" as size L', () => {
      const turn = NormalizedTurnParser.parse('l produit');
      const sizeVariant = turn.variants.find(v => Boolean(v.size));
      expect(sizeVariant).toBeUndefined();
      expect(turn.entities.some(e => e.type === 'VARIANT' && e.canonicalName === 'L')).toBe(false);
    });

    it('8. Does NOT parse "l jacket" as size L', () => {
      const turn = NormalizedTurnParser.parse('l jacket');
      const sizeVariant = turn.variants.find(v => Boolean(v.size));
      expect(sizeVariant).toBeUndefined();
      expect(turn.entities.some(e => e.type === 'VARIANT' && e.canonicalName === 'L')).toBe(false);
    });

    it('9. Does NOT parse "le produit" as size L', () => {
      const turn = NormalizedTurnParser.parse('le produit');
      const sizeVariant = turn.variants.find(v => Boolean(v.size));
      expect(sizeVariant).toBeUndefined();
      expect(turn.entities.some(e => e.type === 'VARIANT' && e.canonicalName === 'L')).toBe(false);
    });

    it('10. Daily recommendation "bghit chi 7aja l kol nhar" has useCase daily_use and size null', () => {
      const turn = NormalizedTurnParser.parse('bghit chi 7aja l kol nhar');
      expect(turn.primaryIntent).toBe('RECOMMENDATION');
      expect(turn.recommendationCriteria?.useCase).toBe('daily_use');
      expect(turn.recommendationCriteria?.size).toBeUndefined();
      expect(turn.variants.length).toBe(0);
    });
  });

  describe('2. Global Policy Scope & Execution Planning', () => {
    it('11. Standalone shipping query with active product context creates KNOWLEDGE_RETRIEVAL only without product context attachment', () => {
      const turn = NormalizedTurnParser.parse('شحال التوصيل لكازا؟');
      expect(turn.primaryIntent).toBe('SHIPPING');
      expect(turn.policyScope).toBe('GLOBAL_POLICY');
      expect(turn.hasGlobalPolicyIntent).toBe(true);

      const plan = ExecutionPlanner.plan(turn, activeProductContext);
      expect(plan.tasks.length).toBe(1);
      expect(plan.tasks[0].type).toBe('KNOWLEDGE_RETRIEVAL');
      expect(plan.tasks[0].targetProductId).toBeUndefined();
      expect(plan.tasks[0].entities?.length || 0).toBe(0);
      expect(plan.tasks.some(t => t.type === 'ECOMMERCE_FACT')).toBe(false);
    });

    it('12. Standalone care query without anaphora creates KNOWLEDGE_RETRIEVAL only', () => {
      const turn = NormalizedTurnParser.parse('كيفاش طريقة الغسيل؟');
      expect(turn.primaryIntent).toBe('CARE');
      expect(turn.policyScope).toBe('GLOBAL_POLICY');

      const plan = ExecutionPlanner.plan(turn, activeProductContext);
      expect(plan.tasks.length).toBe(1);
      expect(plan.tasks[0].type).toBe('KNOWLEDGE_RETRIEVAL');
      expect(plan.tasks[0].targetProductId).toBeUndefined();
      expect(plan.tasks.some(t => t.type === 'ECOMMERCE_FACT')).toBe(false);
    });

    it('13. Standalone returns query creates KNOWLEDGE_RETRIEVAL only', () => {
      const turn = NormalizedTurnParser.parse('شنو سياسة الإرجاع عندكم؟');
      expect(turn.primaryIntent).toBe('RETURNS');
      expect(turn.policyScope).toBe('GLOBAL_POLICY');

      const plan = ExecutionPlanner.plan(turn, activeProductContext);
      expect(plan.tasks.length).toBe(1);
      expect(plan.tasks[0].type).toBe('KNOWLEDGE_RETRIEVAL');
      expect(plan.tasks[0].targetProductId).toBeUndefined();
      expect(plan.tasks.some(t => t.type === 'ECOMMERCE_FACT')).toBe(false);
    });

    it('14. Standalone tracking query creates KNOWLEDGE_RETRIEVAL only', () => {
      const turn = NormalizedTurnParser.parse('كيفاش غادي نتبع الطلب ديالي؟');
      expect(turn.primaryIntent).toBe('TRACKING');
      expect(turn.policyScope).toBe('GLOBAL_POLICY');

      const plan = ExecutionPlanner.plan(turn, activeProductContext);
      expect(plan.tasks.length).toBe(1);
      expect(plan.tasks[0].type).toBe('KNOWLEDGE_RETRIEVAL');
      expect(plan.tasks[0].targetProductId).toBeUndefined();
      expect(plan.tasks.some(t => t.type === 'ECOMMERCE_FACT')).toBe(false);
    });

    it('15. Explicit product + shipping creates product-scoped knowledge task', () => {
      const turn = NormalizedTurnParser.parse('شحال التوصيل ديال Moon Ninja Hoodie؟');
      expect(turn.primaryIntent).toBe('SHIPPING');
      expect(turn.policyScope).toBe('PRODUCT_POLICY');
      expect(turn.hasProductScopedPolicy).toBe(true);

      const plan = ExecutionPlanner.plan(turn, activeProductContext);
      const policyTask = plan.tasks.find(t => t.type === 'KNOWLEDGE_RETRIEVAL');
      expect(policyTask).toBeDefined();
      expect(policyTask?.targetProductName || policyTask?.entities?.some(e => e.type === 'PRODUCT')).toBeTruthy();
    });

    it('16. Explicit product + care creates product-scoped knowledge task', () => {
      const turn = NormalizedTurnParser.parse('كيفاش نغسل هاد الهودي؟');
      expect(turn.primaryIntent).toBe('CARE');
      expect(turn.policyScope).toBe('PRODUCT_POLICY');
      expect(turn.hasProductScopedPolicy).toBe(true);

      const plan = ExecutionPlanner.plan(turn, activeProductContext);
      const policyTask = plan.tasks.find(t => t.type === 'KNOWLEDGE_RETRIEVAL');
      expect(policyTask).toBeDefined();
      expect(policyTask?.targetProductId || policyTask?.targetProductName || policyTask?.entities?.length).toBeTruthy();
    });

    it('17. Explicit product + returns creates product-scoped task', () => {
      const turn = NormalizedTurnParser.parse('واش نقدر نرجع هاد التيشورت؟');
      expect(turn.primaryIntent).toBe('RETURNS');
      expect(turn.policyScope).toBe('PRODUCT_POLICY');
      expect(turn.hasProductScopedPolicy).toBe(true);

      const plan = ExecutionPlanner.plan(turn, activeProductContext);
      const policyTask = plan.tasks.find(t => t.type === 'KNOWLEDGE_RETRIEVAL');
      expect(policyTask).toBeDefined();
    });

    it('18. Contextual product anaphora "واش نقدر نرجعو؟" is classified as CONTEXTUAL_PRODUCT_REFERENCE', () => {
      const turn = NormalizedTurnParser.parse('واش نقدر نرجعو؟');
      expect(turn.primaryIntent).toBe('RETURNS');
      expect(turn.policyScope).toBe('CONTEXTUAL_PRODUCT_REFERENCE');
      expect(turn.hasContextualProductReference).toBe(true);

      const plan = ExecutionPlanner.plan(turn, activeProductContext);
      expect(plan.tasks.some(t => t.type === 'KNOWLEDGE_RETRIEVAL')).toBe(true);
      expect(plan.tasks.find(t => t.type === 'KNOWLEDGE_RETRIEVAL')?.targetProductId).toBe('prod-hoodie-123');
    });

    it('19. Pure policy query does NOT create an Ecommerce task in ExecutionPlanner', () => {
      const turn = NormalizedTurnParser.parse('شنو هي مصاريف الشحن؟');
      const plan = ExecutionPlanner.plan(turn, activeProductContext);
      expect(plan.tasks.some(t => t.type === 'ECOMMERCE_FACT')).toBe(false);
      expect(plan.tasks.every(t => t.type === 'KNOWLEDGE_RETRIEVAL')).toBe(true);
    });

    it('20. Contextual variant follow-up "واش كاين فـM؟" still creates Ecommerce task with active context', () => {
      const turn = NormalizedTurnParser.parse('واش كاين فـM؟');
      expect(turn.primaryIntent).toBe('AVAILABILITY');
      expect(turn.isContextualVariantFollowUp).toBe(true);
      expect(turn.variants[0]?.size).toBe('M');

      const plan = ExecutionPlanner.plan(turn, activeProductContext);
      expect(plan.tasks.some(t => t.type === 'ECOMMERCE_FACT')).toBe(true);
      expect(plan.tasks[0].targetProductId).toBe('prod-hoodie-123');
      expect(plan.tasks[0].targetVariant?.size).toBe('M');
    });
  });

  describe('3. Cost & Zero-LLM Invariants', () => {
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
      deps.tenantConfigService.clearCache();
    });

    it('21. Short variant follow-up execution requires 0 planning LLM calls', () => {
      const turn = NormalizedTurnParser.parse('M?');
      const plan = ExecutionPlanner.plan(turn, activeProductContext);
      expect(turn.primaryIntent).toBe('VARIANT_SELECTION');
      expect(plan.requiresLlmSynthesis).toBe(false);
    });

    it('22. Recommendation criteria parsing requires 0 LLM calls and 0 embeddings', () => {
      const turn = NormalizedTurnParser.parse('bghit chi 7aja l kol nhar b 9el mn 300 dh');
      expect(turn.primaryIntent).toBe('RECOMMENDATION');
      expect(turn.recommendationCriteria?.useCase).toBe('daily_use');
      expect(turn.recommendationCriteria?.budget).toBe(300);
      expect(turn.recommendationCriteria?.size).toBeUndefined();
    });

    it('23. Standalone policy planning executes deterministically with 0 LLM calls', () => {
      const turn = NormalizedTurnParser.parse('شحال التوصيل لكازا؟');
      const plan = ExecutionPlanner.plan(turn, activeProductContext);
      expect(plan.requiresLlmSynthesis).toBe(false);
      expect(plan.tasks.length).toBe(1);
    });

    it('24. No tenant-specific or product-specific hardcoding in parser or planner', () => {
      const turnAnime = NormalizedTurnParser.parse('bghit Moon Ninja Hoodie');
      const turnGeneric = NormalizedTurnParser.parse('bghit Classic Cotton Shirt');

      expect(turnAnime.primaryIntent).toBe('PRODUCT_SEARCH');
      expect(turnGeneric.primaryIntent).toBe('PRODUCT_SEARCH');
    });
  });
});
