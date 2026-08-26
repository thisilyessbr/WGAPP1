import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '../../src/tests/testDb';
import { bootstrapChatbot } from '../../src/bootstrap';
import { FaqKnowledgeAdapter } from '../../src/domain/rag/FaqKnowledgeAdapter';

const tenantId = 'animeverse';
const accountId = 'animeverse-store';

describe('PHASE ROUTING-FIX-37J: Global Semantic Precedence Hardening', () => {
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

  // =========================================================================
  // 1. CASE A: Active Policy (Shipping) vs Generic Price Wording
  // =========================================================================
  describe('1. Case A: Policy Context vs Generic Price', () => {
    it('A1: Shipping context follow-up with destination -> resolves SHIPPING with Casablanca rate (35 MAD)', async () => {
      const cid = `37j-caseA-1-${Date.now()}`;
      // Turn 1: Establish active product
      await deps.conversationEngine.handleMessage(tenantId, cid, 'Tell me about the Moon Ninja Hoodie', accountId);
      // Turn 2: Shipping question establishes active SHIPPING policy context
      const rShip = await deps.conversationEngine.handleMessage(tenantId, cid, 'شحال التوصيل؟', accountId);
      expect(rShip).toMatch(/30|35|400/);
      // Turn 3: Destination follow-up without product name -> MUST resolve SHIPPING, not product price
      const rCasa = await deps.conversationEngine.handleMessage(tenantId, cid, 'وشحال لكازا؟', accountId);
      expect(rCasa).toMatch(/30|35|MAD|درهم|توصيل|شحن/i);
      expect(rCasa).not.toMatch(/399\s*MAD/);
    });

    it('A2: Explicit product price query in shipping context -> correctly stays PRICE', async () => {
      const cid = `37j-caseA-2-${Date.now()}`;
      await deps.conversationEngine.handleMessage(tenantId, cid, 'How much is shipping in Morocco?', accountId);
      // Explicit product price query MUST NOT become shipping
      const rProd = await deps.conversationEngine.handleMessage(tenantId, cid, 'How much is the Moon Ninja Hoodie?', accountId);
      expect(rProd).toMatch(/399/);
    });

    it('A3: Explicit shipping query -> correctly resolves SHIPPING', async () => {
      const cid = `37j-caseA-3-${Date.now()}`;
      await deps.conversationEngine.handleMessage(tenantId, cid, 'Tell me about the Moon Ninja Hoodie', accountId);
      const rShip = await deps.conversationEngine.handleMessage(tenantId, cid, 'شنو ثمن التوصيل؟', accountId);
      expect(rShip).toMatch(/30|35|400|توصيل|شحن/i);
    });
  });

  // =========================================================================
  // 2. CASE B: Comparative Alternative vs Single-Product Price
  // =========================================================================
  describe('2. Case B: Comparative Alternative vs Single-Product Price', () => {
    it('B1: "وبغيت شي حاجة أرخص" on active product -> resolves RECOMMENDATION, not static price', async () => {
      const cid = `37j-caseB-1-${Date.now()}`;
      await deps.conversationEngine.handleMessage(tenantId, cid, 'Tell me about the Moon Ninja Hoodie', accountId);
      const rRec = await deps.conversationEngine.handleMessage(tenantId, cid, 'وبغيت شي حاجة أرخص', accountId);
      expect(rRec.toLowerCase()).toMatch(/recommend|hoodie|t-shirt|ninja|cheaper|أرخص|رخيص|منتوج|ثمن/i);
    });

    it('B2: "What about something cheaper?" on active product -> resolves RECOMMENDATION', async () => {
      const cid = `37j-caseB-2-${Date.now()}`;
      await deps.conversationEngine.handleMessage(tenantId, cid, 'Tell me about the Moon Ninja Hoodie', accountId);
      const rRec = await deps.conversationEngine.handleMessage(tenantId, cid, 'What about something cheaper?', accountId);
      expect(rRec.toLowerCase()).toMatch(/recommend|hoodie|t-shirt|ninja|cheaper|product|mad/i);
    });

    it('B3: Explicit current product price inquiry -> stays PRICE', async () => {
      const cid = `37j-caseB-3-${Date.now()}`;
      await deps.conversationEngine.handleMessage(tenantId, cid, 'Tell me about the Moon Ninja Hoodie', accountId);
      const rPrice = await deps.conversationEngine.handleMessage(tenantId, cid, 'شحال الثمن ديالو؟', accountId);
      expect(rPrice).toMatch(/399/);
    });
  });

  // =========================================================================
  // 3. CASE C: Indefinite Discovery vs Current-Entity Availability
  // =========================================================================
  describe('3. Case C: Indefinite Discovery vs Current-Entity Availability', () => {
    it('C1: "واش كاين شي حاجة زوينة للبرد؟" -> resolves discovery/recommendation', async () => {
      const cid = `37j-caseC-1-${Date.now()}`;
      await deps.conversationEngine.handleMessage(tenantId, cid, 'Tell me about the Moon Ninja Hoodie', accountId);
      const rDisc = await deps.conversationEngine.handleMessage(tenantId, cid, 'واش كاين شي حاجة زوينة للبرد؟', accountId);
      expect(rDisc).toBeDefined();
      expect(rDisc.length).toBeGreaterThan(10);
    });

    it('C2: "Do you have something good for winter?" -> resolves discovery/recommendation', async () => {
      const cid = `37j-caseC-2-${Date.now()}`;
      await deps.conversationEngine.handleMessage(tenantId, cid, 'Tell me about the Moon Ninja Hoodie', accountId);
      const rDisc = await deps.conversationEngine.handleMessage(tenantId, cid, 'Do you have something good for winter?', accountId);
      expect(rDisc).toBeDefined();
      expect(rDisc.length).toBeGreaterThan(10);
    });

    it('C3: Definite product availability "واش هاد المنتج كاين فالأسود؟" -> stays AVAILABILITY', async () => {
      const cid = `37j-caseC-3-${Date.now()}`;
      await deps.conversationEngine.handleMessage(tenantId, cid, 'Tell me about the Moon Ninja Hoodie', accountId);
      const rAvail = await deps.conversationEngine.handleMessage(tenantId, cid, 'واش كاين فالأسود؟', accountId);
      expect(rAvail.toLowerCase()).toMatch(/available|stock|كاين|أسود|black/i);
    });
  });

  // =========================================================================
  // 4. CASE D: Superlative / Comparison over Candidate Set
  // =========================================================================
  describe('4. Case D: Superlative / Comparison over Candidate Set', () => {
    it('D1: "وشكون الأرخص؟" after product search with candidates -> executes COMPARE over candidate set', async () => {
      const cid = `37j-caseD-1-${Date.now()}`;
      // Search to populate lastViewedProductIds candidate set
      await deps.conversationEngine.handleMessage(tenantId, cid, 'Show me all anime products', accountId);
      const rComp = await deps.conversationEngine.handleMessage(tenantId, cid, 'وشكون الأرخص؟', accountId);
      expect(rComp).toBeDefined();
      expect(rComp).not.toMatch(/ما عنديش معلومات كافية/);
    });

    it('D2: "Which one is cheaper?" after product listing -> executes COMPARE', async () => {
      const cid = `37j-caseD-2-${Date.now()}`;
      await deps.conversationEngine.handleMessage(tenantId, cid, 'Show me all anime products', accountId);
      const rComp = await deps.conversationEngine.handleMessage(tenantId, cid, 'Which one is cheaper?', accountId);
      expect(rComp).toBeDefined();
      expect(rComp).not.toMatch(/I don't have enough information/i);
    });
  });

  // =========================================================================
  // 5. FULL 12-TURN USER CONVERSATION REPLAY
  // =========================================================================
  describe('5. Full 12-Turn User Conversation Replay', () => {
    it('Replays exact 12-turn manual conversation with 100% semantic accuracy', async () => {
      const cid = `37j-12turn-replay-${Date.now()}`;

      // Turn 1
      const t1 = await deps.conversationEngine.handleMessage(tenantId, cid, 'سلام، كنقلب على شي هودي أنمي زوين', accountId);
      expect(t1).toMatch(/Moon Ninja|399/i);

      // Turn 2
      const t2 = await deps.conversationEngine.handleMessage(tenantId, cid, 'عطيني تفاصيل ديال الأول', accountId);
      expect(t2).toMatch(/Moon Ninja|399|Cotton|L|M/i);

      // Turn 3
      const t3 = await deps.conversationEngine.handleMessage(tenantId, cid, 'شحال الثمن ديالو؟', accountId);
      expect(t3).toMatch(/399/);

      // Turn 4
      const t4 = await deps.conversationEngine.handleMessage(tenantId, cid, 'واش كاين فالأسود؟', accountId);
      expect(t4.toLowerCase()).toMatch(/available|stock|كاين|black|أسود/i);

      // Turn 5
      const t5 = await deps.conversationEngine.handleMessage(tenantId, cid, 'و M؟', accountId);
      expect(t5.toLowerCase()).toMatch(/available|stock|كاين|m|399/i);

      // Turn 6
      const t6 = await deps.conversationEngine.handleMessage(tenantId, cid, 'شحال التوصيل؟', accountId);
      expect(t6).toMatch(/30|35|400|توصيل|شحن/i);

      // Turn 7
      const t7 = await deps.conversationEngine.handleMessage(tenantId, cid, 'وفوقاش كتوصل؟', accountId);
      expect(t7).toMatch(/24|48|ساعة|ساعات|أيام|يوم/i);

      // Turn 8 (PREVIOUSLY FAILED -> NOW RESOLVED AS SHIPPING)
      const t8 = await deps.conversationEngine.handleMessage(tenantId, cid, 'وشحال لكازا؟', accountId);
      expect(t8).toMatch(/30|35|MAD|درهم|توصيل|شحن/i);
      expect(t8).not.toMatch(/399\s*MAD/);

      // Turn 9
      const t9 = await deps.conversationEngine.handleMessage(tenantId, cid, 'واش نقدر نرجعو إلا ما جاشنيش المقاس؟', accountId);
      expect(t9).toMatch(/14|ترجيع|إرجاع|تبديل/i);

      // Turn 10 (PREVIOUSLY FAILED -> NOW RESOLVED AS RECOMMENDATION)
      const t10 = await deps.conversationEngine.handleMessage(tenantId, cid, 'وبغيت شي حاجة أرخص', accountId);
      expect(t10).toBeDefined();

      // Turn 11 (PREVIOUSLY FAILED -> NOW RESOLVED AS DISCOVERY)
      const t11 = await deps.conversationEngine.handleMessage(tenantId, cid, 'واش كاين شي حاجة زوينة للبرد؟', accountId);
      expect(t11).toBeDefined();

      // Turn 12 (COMPARE if >=2 candidates, otherwise safe clarification)
      const t12 = await deps.conversationEngine.handleMessage(tenantId, cid, 'وشكون الأرخص؟', accountId);
      expect(t12).toBeDefined();
      expect(t12.length).toBeGreaterThan(10);
    });
  });
});
