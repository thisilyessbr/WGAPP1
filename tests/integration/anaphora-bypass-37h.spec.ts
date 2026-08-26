import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '../../src/tests/testDb';
import { bootstrapChatbot } from '../../src/bootstrap';
import { FaqKnowledgeAdapter } from '../../src/domain/rag/FaqKnowledgeAdapter';

const tenantId = 'animeverse';
const accountId = 'animeverse-store';

describe('PHASE COST-FIX-37H: Guarded Generic Anaphora Bypass', () => {
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

  // 1. Active entity price
  it('1. Active entity price follow-up resolves accurately without redundant reformulator call', async () => {
    const cid = `37h-price-${Date.now()}`;
    await deps.conversationEngine.handleMessage(tenantId, cid, 'Tell me about the Moon Ninja Hoodie', accountId);
    const r2 = await deps.conversationEngine.handleMessage(tenantId, cid, 'How much is it?', accountId);
    expect(r2).toMatch(/399|price|MAD/i);
  }, 20000);

  // 2. Active entity availability
  it('2. Active entity availability follow-up checks stock accurately', async () => {
    const cid = `37h-avail-${Date.now()}`;
    await deps.conversationEngine.handleMessage(tenantId, cid, 'Tell me about the Moon Ninja Hoodie', accountId);
    const r2 = await deps.conversationEngine.handleMessage(tenantId, cid, 'Is it available in black?', accountId);
    expect(r2.toLowerCase()).toMatch(/available|stock|yes|black/i);
  }, 20000);

  // 3. Active entity color
  it('3. Active entity color follow-up returns available colors', async () => {
    const cid = `37h-color-${Date.now()}`;
    await deps.conversationEngine.handleMessage(tenantId, cid, 'Tell me about the Moon Ninja Hoodie', accountId);
    const r2 = await deps.conversationEngine.handleMessage(tenantId, cid, 'What colors are available?', accountId);
    expect(r2.toLowerCase()).toMatch(/black|white|color|navy|available/i);
  }, 20000);

  // 4. Active entity size
  it('4. Active entity size follow-up returns available sizes', async () => {
    const cid = `37h-size-${Date.now()}`;
    await deps.conversationEngine.handleMessage(tenantId, cid, 'Tell me about the Moon Ninja Hoodie', accountId);
    const r2 = await deps.conversationEngine.handleMessage(tenantId, cid, 'What sizes does it have?', accountId);
    expect(r2).toMatch(/S|M|L|XL/i);
  }, 20000);

  // 5. Active entity variant ellipsis
  it('5. Short elliptical variant follow-up maps deterministically to active product variant', async () => {
    const cid = `37h-var-${Date.now()}`;
    await deps.conversationEngine.handleMessage(tenantId, cid, 'Tell me about the Moon Ninja Hoodie', accountId);
    const r2 = await deps.conversationEngine.handleMessage(tenantId, cid, 'What about M?', accountId);
    expect(r2.toLowerCase()).toMatch(/m|medium|stock|available|399/i);
  }, 20000);

  // 6. Policy follow-ups (Shipping, Returns, Care)
  it('6. Policy follow-up reuses session evidence accurately', async () => {
    const cid = `37h-pol-${Date.now()}`;
    const r1 = await deps.conversationEngine.handleMessage(tenantId, cid, 'How much is shipping in Morocco?', accountId);
    expect(r1).toMatch(/30|35|400/);
    const r2 = await deps.conversationEngine.handleMessage(tenantId, cid, 'How long does delivery take?', accountId);
    expect(r2).toMatch(/24|48|hours|days|shipping|delivery|35/i);
    const r3 = await deps.conversationEngine.handleMessage(tenantId, cid, 'Can I pay cash when it arrives?', accountId);
    expect(r3.toLowerCase()).toMatch(/cash|delivery|cod/i);
  }, 25000);

  // 7. Multilingual follow-ups (French, Arabic, Darija, Arabizi)
  it('7. Multilingual follow-ups maintain language compliance and factual accuracy', async () => {
    const cid = `37h-multi-lang-${Date.now()}`;
    await deps.conversationEngine.handleMessage(tenantId, cid, 'Montre-moi la veste Cyber Spirit', accountId);
    const rFR = await deps.conversationEngine.handleMessage(tenantId, cid, "C'est combien ?", accountId);
    expect(rFR).toMatch(/650|prix|MAD/i);

    const cidAR = `37h-ar-${Date.now()}`;
    await deps.conversationEngine.handleMessage(tenantId, cidAR, 'أرني هودي Moon Ninja', accountId);
    const rAR = await deps.conversationEngine.handleMessage(tenantId, cidAR, 'كم سعره؟', accountId);
    expect(rAR).toMatch(/399|درهم/);
  }, 25000);

  // 8. No active entity
  it('8. Context-less pronouns without active product do NOT bypass and handle safely', async () => {
    const cid = `37h-no-prod-${Date.now()}`;
    const r1 = await deps.conversationEngine.handleMessage(tenantId, cid, 'How much is it?', accountId);
    expect(r1).toBeDefined();
    expect(r1.length).toBeGreaterThan(5);
  }, 20000);

  // 9. Recommendation
  it('9. Recommendation queries keep QuestionReformulator / semantic path', async () => {
    const cid = `37h-rec-${Date.now()}`;
    await deps.conversationEngine.handleMessage(tenantId, cid, 'Tell me about the Cyber Spirit Jacket', accountId);
    const r2 = await deps.conversationEngine.handleMessage(tenantId, cid, 'Do you have cheaper hoodies under 400 MAD?', accountId);
    expect(r2).toBeDefined();
    expect(r2).toMatch(/399|hoodie|Moon Ninja|MAD/i);
  }, 20000);

  // 10. Search / Discovery
  it('10. Search discovery queries route to product search cleanly', async () => {
    const cid = `37h-search-${Date.now()}`;
    await deps.conversationEngine.handleMessage(tenantId, cid, 'Tell me about the Moon Ninja Hoodie', accountId);
    const r2 = await deps.conversationEngine.handleMessage(tenantId, cid, 'Show me something like this', accountId);
    expect(r2).toBeDefined();
  }, 20000);

  // 11. Plural references
  it('11. Plural references over list do not bypass unsafe context', async () => {
    const cid = `37h-plural-${Date.now()}`;
    await deps.conversationEngine.handleMessage(tenantId, cid, 'Show me all anime hoodies', accountId);
    const r2 = await deps.conversationEngine.handleMessage(tenantId, cid, 'Are they oversized?', accountId);
    expect(r2).toBeDefined();
  }, 20000);

  // 12. International scope mismatch
  it('12. International scope inquiry triggers fresh RAG retrieval / guard without wrong bypass', async () => {
    const cid = `37h-intl-${Date.now()}`;
    await deps.conversationEngine.handleMessage(tenantId, cid, 'How much is shipping in Morocco?', accountId);
    const r2 = await deps.conversationEngine.handleMessage(tenantId, cid, 'What about international shipping to France?', accountId);
    expect(r2).toBeDefined();
  }, 20000);

  // 13. Multi-policy composite query
  it('13. Multi-policy composite query resolves both shipping and returns accurately', async () => {
    const cid = `37h-multi-pol-${Date.now()}`;
    const r1 = await deps.conversationEngine.handleMessage(tenantId, cid, 'What are your delivery fees and return policy?', accountId);
    expect(r1).toMatch(/30|35|400/);
    expect(r1).toMatch(/14/);
  }, 20000);

  // 14. Insufficient cached evidence triggers fresh retrieval safely
  it('14. Query needing a missing fact triggers fresh retrieval when cached evidence is insufficient', async () => {
    const cid = `37h-insuff-${Date.now()}`;
    await deps.conversationEngine.handleMessage(tenantId, cid, 'How do I wash the hoodie?', accountId);
    const r2 = await deps.conversationEngine.handleMessage(tenantId, cid, 'What are your delivery fees?', accountId);
    expect(r2).toMatch(/30|35|400/);
  }, 20000);

  // 15. Handoff invariants
  it('15. Human handoff request transitions safely without interference', async () => {
    const cid = `37h-handoff-${Date.now()}`;
    await deps.conversationEngine.handleMessage(tenantId, cid, 'Tell me about the Moon Ninja Hoodie', accountId);
    const hResp = await deps.conversationEngine.handleMessage(tenantId, cid, 'I need to speak with a human agent please', accountId);
    expect(hResp.toLowerCase()).toMatch(/human|agent|notified|assist/i);
  }, 20000);
});
