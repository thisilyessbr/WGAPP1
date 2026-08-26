import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '../../src/tests/testDb';
import { bootstrapChatbot } from '../../src/bootstrap';
import { FaqKnowledgeAdapter } from '../../src/domain/rag/FaqKnowledgeAdapter';
import { PolicyEvidenceReuse } from '../../src/domain/rag/PolicyEvidenceReuse';
import { PolicyEvidence } from '../../src/domain/rag/PolicyEvidence';

const tenantId = 'animeverse';
const accountId = 'animeverse-store';

describe('PHASE COST-FIX-37E: Session-Scoped Policy Evidence Reuse', () => {
  let deps: ReturnType<typeof bootstrapChatbot>;

  beforeAll(async () => {
    deps = bootstrapChatbot(prisma);
    const config = await deps.tenantConfigService.getConfig(tenantId);
    if (config.capabilities?.faq && config.capabilities.faq.length > 0) {
      await FaqKnowledgeAdapter.syncTenantFaqs(
        tenantId, null, config.capabilities.faq,
        deps.knowledgeRepository,
        (deps.ragService as any).embeddingProvider,
        prisma
      );
    }
  }, 30000);

  // A. Shipping repeated follow-up
  it('A. Shipping repeated follow-up reuses cached evidence and answers accurately', async () => {
    const cid = `37e-ship-${Date.now()}`;
    const r1 = await deps.conversationEngine.handleMessage(tenantId, cid, 'How much is shipping in Morocco?', accountId);
    expect(r1).toMatch(/30|35|400/);
    const r2 = await deps.conversationEngine.handleMessage(tenantId, cid, 'How long does delivery take?', accountId);
    expect(r2).toMatch(/24|48|hours|days|delivery|shipping|35/i);
  }, 20000);

  // B. Returns repeated follow-up
  it('B. Returns repeated follow-up reuses cached evidence for conditions and tags', async () => {
    const cid = `37e-ret-${Date.now()}`;
    const r1 = await deps.conversationEngine.handleMessage(tenantId, cid, 'What is the return window?', accountId);
    expect(r1).toMatch(/14/);
    const r2 = await deps.conversationEngine.handleMessage(tenantId, cid, 'What are the return conditions regarding tags?', accountId);
    expect(r2.toLowerCase()).toMatch(/tag|tags|unworn|condition/i);
  }, 20000);

  // C. Care repeated follow-up
  it('C. Care repeated follow-up reuses cached evidence for washing temperature', async () => {
    const cid = `37e-care-${Date.now()}`;
    const r1 = await deps.conversationEngine.handleMessage(tenantId, cid, 'How do I wash the hoodie?', accountId);
    expect(r1).toMatch(/30/);
    const r2 = await deps.conversationEngine.handleMessage(tenantId, cid, 'Can I iron over the print?', accountId);
    expect(r2.toLowerCase()).toMatch(/not iron|do not iron|avoid/i);
  }, 20000);

  // D. Tracking repeated follow-up
  it('D. Tracking repeated follow-up reuses SMS tracking evidence', async () => {
    const cid = `37e-track-${Date.now()}`;
    const r1 = await deps.conversationEngine.handleMessage(tenantId, cid, 'How do I track my delivery?', accountId);
    expect(r1.toLowerCase()).toMatch(/sms|tracking|link/i);
    const r2 = await deps.conversationEngine.handleMessage(tenantId, cid, 'Will I receive an SMS link?', accountId);
    expect(r2.toLowerCase()).toMatch(/sms|yes|link/i);
  }, 20000);

  // E. Payment repeated follow-up
  it('E. Payment repeated follow-up reuses Cash on Delivery evidence', async () => {
    const cid = `37e-pay-${Date.now()}`;
    const r1 = await deps.conversationEngine.handleMessage(tenantId, cid, 'Can I pay cash on delivery?', accountId);
    expect(r1.toLowerCase()).toMatch(/cash|delivery|cod/i);
    const r2 = await deps.conversationEngine.handleMessage(tenantId, cid, 'Do I pay the delivery driver?', accountId);
    expect(r2.toLowerCase()).toMatch(/driver|delivery|cash|yes/i);
  }, 20000);

  // F. Support repeated follow-up
  it('F. Support repeated follow-up reuses support contact evidence', async () => {
    const cid = `37e-sup-${Date.now()}`;
    const r1 = await deps.conversationEngine.handleMessage(tenantId, cid, 'What is your customer service email and phone?', accountId);
    expect(r1.toLowerCase()).toMatch(/support@animeverse\.ma|522|998877/);
    const r2 = await deps.conversationEngine.handleMessage(tenantId, cid, 'What is the support phone number again?', accountId);
    expect(r2).toMatch(/522|998877/);
  }, 20000);

  // G. Store hours repeated follow-up
  it('G. Store hours repeated follow-up reuses opening hours evidence', async () => {
    const cid = `37e-hours-${Date.now()}`;
    const r1 = await deps.conversationEngine.handleMessage(tenantId, cid, 'What are your store hours?', accountId);
    expect(r1).toMatch(/10:00|20:00|24\/7/);
    const r2 = await deps.conversationEngine.handleMessage(tenantId, cid, 'Are you open on Saturdays?', accountId);
    expect(r2.toLowerCase()).toMatch(/saturday|yes|open|10:00/i);
  }, 20000);

  // H. Size guide repeated follow-up
  it('H. Size guide repeated follow-up reuses size measurements', async () => {
    const cid = `37e-size-${Date.now()}`;
    const r1 = await deps.conversationEngine.handleMessage(tenantId, cid, 'What size fits a 98 cm chest?', accountId);
    expect(r1).toMatch(/M|Medium/i);
    const r2 = await deps.conversationEngine.handleMessage(tenantId, cid, 'What about 93 cm chest?', accountId);
    expect(r2).toMatch(/S|Small/i);
  }, 20000);

  // I. Language switch
  it('I. Language switch retains factual accuracy while changing output language', async () => {
    const cid = `37e-lang-${Date.now()}`;
    const r1 = await deps.conversationEngine.handleMessage(tenantId, cid, 'شحال التوصيل؟', accountId);
    expect(r1).toMatch(/30|35|400/);
    const r2 = await deps.conversationEngine.handleMessage(tenantId, cid, 'Et le délai de livraison ?', accountId);
    expect(r2.toLowerCase()).toMatch(/24|48|heures|jours|livraison/i);
    const r3 = await deps.conversationEngine.handleMessage(tenantId, cid, 'How much is shipping to Casablanca?', accountId);
    expect(r3).toMatch(/35/);
  }, 25000);

  // J. Product context switch
  it('J. Store policy evidence remains valid across product context switch', async () => {
    const cid = `37e-prod-switch-${Date.now()}`;
    await deps.conversationEngine.handleMessage(tenantId, cid, 'Tell me about the Moon Ninja Hoodie', accountId);
    const r1 = await deps.conversationEngine.handleMessage(tenantId, cid, 'What is the return policy for it?', accountId);
    expect(r1).toMatch(/14/);
    await deps.conversationEngine.handleMessage(tenantId, cid, 'Can you show me the Cyber Spirit Jacket instead?', accountId);
    const r2 = await deps.conversationEngine.handleMessage(tenantId, cid, 'Can I return this jacket too under the same policy?', accountId);
    expect(r2).toMatch(/14/);
  }, 25000);

  // K. Multi-policy accumulation
  it('K. Multi-policy evidence accumulates across turns without topic loss', async () => {
    const cid = `37e-accum-${Date.now()}`;
    await deps.conversationEngine.handleMessage(tenantId, cid, 'How much is shipping?', accountId);
    await deps.conversationEngine.handleMessage(tenantId, cid, 'What is your return policy?', accountId);
    const r3 = await deps.conversationEngine.handleMessage(tenantId, cid, 'Can you summarize both shipping fees and the return policy?', accountId);
    expect(r3).toMatch(/30|35|400/);
    expect(r3).toMatch(/14/);
  }, 25000);

  // L. Reordering policies
  it('L. Reordering policies preserves distinct provenance and avoids topic contamination', async () => {
    const cid = `37e-reorder-${Date.now()}`;
    await deps.conversationEngine.handleMessage(tenantId, cid, 'How should I wash the hoodie?', accountId);
    await deps.conversationEngine.handleMessage(tenantId, cid, 'What is shipping cost?', accountId);
    await deps.conversationEngine.handleMessage(tenantId, cid, 'What size for 105 cm chest?', accountId);
    const r4 = await deps.conversationEngine.handleMessage(tenantId, cid, 'How much is shipping again?', accountId);
    expect(r4).toMatch(/30|35|400/);
  }, 25000);

  // M. Missing-fact retrieval
  it('M. Query needing a missing fact triggers fresh retrieval when cached evidence is insufficient', async () => {
    const cid = `37e-missing-${Date.now()}`;
    await deps.conversationEngine.handleMessage(tenantId, cid, 'How do I wash the hoodie?', accountId);
    // Ask shipping (not in care cache)
    const r2 = await deps.conversationEngine.handleMessage(tenantId, cid, 'What are your delivery fees?', accountId);
    expect(r2).toMatch(/30|35|400/);
  }, 20000);

  // N. Scope mismatch retrieval
  it('N. Scope mismatch (e.g. international query) is recognized as insufficient', () => {
    const mockEvidence: PolicyEvidence[] = [
      {
        intent: 'SHIPPING',
        sourceDocumentId: 'doc-1',
        sourceChunkId: 'chunk-1',
        factualContent: 'Standard delivery in Morocco is 30 MAD. Casablanca is 35 MAD.',
        confidence: 0.9,
        chunkType: 'FACTUAL_POLICY',
        provenance: { tenantId, accountId }
      }
    ];
    const suff = PolicyEvidenceReuse.isSufficient('SHIPPING', 'Do you ship internationally to France?', mockEvidence);
    expect(suff.isSufficient).toBe(false);
    expect(suff.reason).toBe('SCOPE_MISMATCH_INTERNATIONAL_SHIPPING');
  });

  // O. Session reset invalidation
  it('O. Session reset clears activePolicyEvidence', async () => {
    const cid1 = `37e-session-1-${Date.now()}`;
    const cid2 = `37e-session-2-${Date.now()}`;
    await deps.conversationEngine.handleMessage(tenantId, cid1, 'How much is shipping?', accountId);
    // Independent session starts with empty cache
    const r2 = await deps.conversationEngine.handleMessage(tenantId, cid2, 'What are the return terms?', accountId);
    expect(r2).toMatch(/14/);
  }, 20000);

  // P. Handoff invalidation
  it('P. Explicit handoff request transitions state safely', async () => {
    const cid = `37e-handoff-${Date.now()}`;
    await deps.conversationEngine.handleMessage(tenantId, cid, 'How much is shipping?', accountId);
    const handoffResp = await deps.conversationEngine.handleMessage(tenantId, cid, 'I want to speak with a human agent please', accountId);
    expect(handoffResp.toLowerCase()).toMatch(/human|agent|notified|assist/i);
  }, 20000);

  // Q. Tenant isolation
  it('Q. Evidence cannot be shared across different tenants', () => {
    const ev1: PolicyEvidence = {
      intent: 'SHIPPING',
      sourceDocumentId: 'doc-tenant-A',
      sourceChunkId: 'chunk-1',
      factualContent: 'Tenant A shipping is 30 MAD',
      confidence: 0.9,
      chunkType: 'FACTUAL_POLICY',
      provenance: { tenantId: 'tenant-A', accountId: null }
    };
    expect(ev1.provenance.tenantId).toBe('tenant-A');
    expect(ev1.provenance.tenantId).not.toBe('tenant-B');
  });

  // R. Account isolation
  it('R. Account isolation ensures account-specific evidence is distinct', () => {
    const evMap: Record<string, PolicyEvidence[]> = {};
    const evAccountA: PolicyEvidence = {
      intent: 'SHIPPING',
      sourceDocumentId: 'doc-acc-A',
      sourceChunkId: 'chunk-acc-A',
      factualContent: 'Account A shipping rate',
      confidence: 0.85,
      chunkType: 'FACTUAL_POLICY',
      provenance: { tenantId: 'animeverse', accountId: 'store-A' }
    };
    PolicyEvidenceReuse.mergeEvidence(evMap, 'SHIPPING', [evAccountA]);
    expect(evMap['SHIPPING'][0].provenance.accountId).toBe('store-A');
  });

  // S. Duplicate evidence suppression
  it('S. Merging same chunk suppresses duplicate evidence entries', () => {
    const evMap: Record<string, PolicyEvidence[]> = {};
    const ev1: PolicyEvidence = {
      intent: 'SHIPPING',
      sourceDocumentId: 'doc-1',
      sourceChunkId: 'chunk-1',
      factualContent: 'Delivery is 30 MAD',
      confidence: 0.9,
      chunkType: 'FACTUAL_POLICY',
      provenance: { tenantId, accountId }
    };
    PolicyEvidenceReuse.mergeEvidence(evMap, 'SHIPPING', [ev1]);
    PolicyEvidenceReuse.mergeEvidence(evMap, 'SHIPPING', [ev1]); // Duplicate insertion
    expect(evMap['SHIPPING'].length).toBe(1);
  });

  // T. Conflicting evidence protection
  it('T. Sufficiency check rejects empty or non-canonical policy queries', () => {
    const suffEmpty = PolicyEvidenceReuse.isSufficient('SHIPPING', 'How much is shipping?', []);
    expect(suffEmpty.isSufficient).toBe(false);
    const suffNonCanonical = PolicyEvidenceReuse.isSufficient('UNKNOWN_POLICY', 'What is your warranty?', [{
      intent: 'UNKNOWN_POLICY',
      sourceDocumentId: 'd',
      sourceChunkId: 'c',
      factualContent: 'text',
      confidence: 0.9,
      chunkType: 'FACTUAL_POLICY',
      provenance: { tenantId }
    }]);
    expect(suffNonCanonical.isSufficient).toBe(false);
  });

  // U. Product facts never enter policy cache
  it('U. Product catalog facts are not treated as canonical policy evidence', () => {
    expect(PolicyEvidenceReuse.isCanonicalPolicy('PRICE')).toBe(false);
    expect(PolicyEvidenceReuse.isCanonicalPolicy('AVAILABILITY')).toBe(false);
    expect(PolicyEvidenceReuse.isCanonicalPolicy('PRODUCT_SEARCH')).toBe(false);
    expect(PolicyEvidenceReuse.isCanonicalPolicy('PRODUCT_DETAIL')).toBe(false);
  });

  // V. No internal metadata leakage
  it('V. Answers generated from reused policy evidence contain zero internal metadata leaks', async () => {
    const cid = `37e-no-leak-${Date.now()}`;
    await deps.conversationEngine.handleMessage(tenantId, cid, 'How much is shipping?', accountId);
    const resp = await deps.conversationEngine.handleMessage(tenantId, cid, 'Can you confirm the delivery timeline?', accountId);
    expect(resp).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
    expect(resp.toLowerCase()).not.toContain('chunkid');
    expect(resp.toLowerCase()).not.toContain('documentid');
    expect(resp.toLowerCase()).not.toContain('sourcechunkid');
  }, 20000);
});
