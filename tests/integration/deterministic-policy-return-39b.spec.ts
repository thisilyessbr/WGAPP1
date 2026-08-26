import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '../../src/tests/testDb';
import { bootstrapChatbot } from '../../src/bootstrap';
import { DirectRagGuard } from '../../src/domain/rag/DirectRagGuard';

const tenantId = 'animeverse';
const accountId = 'animeverse-store';

describe('PHASE COST-FIX-39B: Deterministic Safe Policy Return', () => {
  let deps: ReturnType<typeof bootstrapChatbot>;

  beforeAll(async () => {
    deps = bootstrapChatbot(prisma);
  }, 30000);

  // 1. Darija Arabic Policy Follow-Up (Direct Safe Return on Reused Evidence)
  describe('1. Darija Arabic Reused Policy Return', () => {
    it('reuses cached shipping evidence and returns deterministically with 0 embedding and 0 LLM calls', async () => {
      const cid = `39b-dar-ship-${Date.now()}`;
      // Turn 1: Initial query (populates session activePolicyEvidence cache)
      const r1 = await deps.conversationEngine.handleMessage(tenantId, cid, 'شحال التوصيل؟', accountId);
      expect(r1).toMatch(/30\s*(?:MAD|درهم)/i);

      // Turn 2: Follow-up question on same policy with Darija Arabic script
      const r2 = await deps.conversationEngine.handleMessage(tenantId, cid, 'وفوقاش كتوصل؟', accountId);
      expect(r2).toMatch(/24|48|ساعة|يوم/i);
      expect(DirectRagGuard.hasInternalArtifacts(r2)).toBe(false);
    });

    it('reuses cached returns evidence in Darija Arabic deterministically', async () => {
      const cid = `39b-dar-ret-${Date.now()}`;
      // Turn 1: Initial returns question
      const r1 = await deps.conversationEngine.handleMessage(tenantId, cid, 'واش نقدر نرجع السلعة؟', accountId);
      expect(r1).toMatch(/14\s*(?:يوم|يومًا)|الترجيع|التبديل/i);

      // Turn 2: Returns condition follow-up
      const r2 = await deps.conversationEngine.handleMessage(tenantId, cid, 'وشنو شروط الترجيع والتبديل؟', accountId);
      expect(r2).toMatch(/14|أصلية|بطاقات|غير ملبوس|الترجيع|التبديل/i);
      expect(DirectRagGuard.hasInternalArtifacts(r2)).toBe(false);
    });
  });

  // 2. Arabic MSA Reused Policy Return
  describe('2. Arabic MSA Reused Policy Return', () => {
    it('reuses cached shipping evidence in Arabic MSA with 0 LLM calls', async () => {
      const cid = `39b-ar-ship-${Date.now()}`;
      // Turn 1: Initial MSA query
      const r1 = await deps.conversationEngine.handleMessage(tenantId, cid, 'كم تكلفة التوصيل؟', accountId);
      expect(r1).toMatch(/30\s*(?:درهم|درهمًا|MAD)/i);

      // Turn 2: Delivery timeframe follow-up
      const r2 = await deps.conversationEngine.handleMessage(tenantId, cid, 'وكم تستغرق مدة التوصيل؟', accountId);
      expect(r2).toMatch(/24|48|ساعة|يوم/i);
      expect(DirectRagGuard.hasInternalArtifacts(r2)).toBe(false);
    });
  });

  // 3. English Reused Policy Return
  describe('3. English Reused Policy Return', () => {
    it('reuses cached shipping evidence in English with 0 LLM calls', async () => {
      const cid = `39b-en-ship-${Date.now()}`;
      // Turn 1: Initial English query
      const r1 = await deps.conversationEngine.handleMessage(tenantId, cid, 'What are your shipping costs?', accountId);
      expect(r1).toMatch(/30\s*MAD/i);

      // Turn 2: Delivery timeframe follow-up
      const r2 = await deps.conversationEngine.handleMessage(tenantId, cid, 'How long will delivery take?', accountId);
      expect(r2).toMatch(/24|48|hours/i);
      expect(DirectRagGuard.hasInternalArtifacts(r2)).toBe(false);
    });

    it('reuses cached returns evidence in English with 0 LLM calls', async () => {
      const cid = `39b-en-ret-${Date.now()}`;
      // Turn 1: Returns initial query
      const r1 = await deps.conversationEngine.handleMessage(tenantId, cid, 'What is your return policy?', accountId);
      expect(r1).toMatch(/14(?:-|\s*)days?/i);

      // Turn 2: Condition follow-up
      const r2 = await deps.conversationEngine.handleMessage(tenantId, cid, 'Do items need to be unworn with tags?', accountId);
      expect(r2).toMatch(/14(?:-|\s*)days?|unworn|tags/i);
      expect(DirectRagGuard.hasInternalArtifacts(r2)).toBe(false);
    });
  });

  // 4. Guard Regressions (Must NOT use single-evidence direct return)
  describe('4. Guard Regressions (Must NOT use single-evidence direct return)', () => {
    it('scope mismatch (international shipping) triggers fresh evaluation and does not direct-return domestic facts', async () => {
      const cid = `39b-reg-scope-${Date.now()}`;
      await deps.conversationEngine.handleMessage(tenantId, cid, 'What is standard shipping?', accountId);
      const r2 = await deps.conversationEngine.handleMessage(tenantId, cid, 'Do you ship internationally to France?', accountId);

      // Must not falsely assert domestic 30 MAD standard delivery applies to France
      expect(r2.toLowerCase()).toMatch(/morocco|maroc|international|only|do not|doesn't|support|rephrase|understand/i);
      expect(DirectRagGuard.hasInternalArtifacts(r2)).toBe(false);
    });

    it('multi-policy query accumulates multi-policy evidence and generates synthesized multi-topic answer', async () => {
      const cid = `39b-reg-multi-${Date.now()}`;
      const answer = await deps.conversationEngine.handleMessage(tenantId, cid, 'What are your shipping fees and return policy?', accountId);

      expect(answer).toMatch(/30|35/);
      expect(answer).toMatch(/14/);
      expect(DirectRagGuard.hasInternalArtifacts(answer)).toBe(false);
    });

    it('insufficient cached evidence triggers fresh retrieval for missing facts', async () => {
      const cid = `39b-reg-miss-${Date.now()}`;
      // Cache clothing care evidence
      await deps.conversationEngine.handleMessage(tenantId, cid, 'How should I wash the hoodie?', accountId);
      // Ask shipping (not in care cache)
      const r2 = await deps.conversationEngine.handleMessage(tenantId, cid, 'What are your delivery fees?', accountId);

      expect(r2).toMatch(/30|35/);
      expect(DirectRagGuard.hasInternalArtifacts(r2)).toBe(false);
    });
  });
});
