import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '../../src/tests/testDb';
import { bootstrapChatbot } from '../../src/bootstrap';
import { DirectRagGuard } from '../../src/domain/rag/DirectRagGuard';

const tenantId = 'animeverse';
const accountId = 'animeverse-store';

describe('PHASE COST-FIX-38B: FAQ Fast-Path Wiring', () => {
  let deps: ReturnType<typeof bootstrapChatbot>;

  beforeAll(async () => {
    deps = bootstrapChatbot(prisma);
  }, 30000);

  // 1. Darija Arabic FAQ Fast-Path
  describe('1. Darija Arabic FAQ Fast-Path', () => {
    it('resolves shipping query accurately via FAQ fast-path ("شحال التوصيل؟")', async () => {
      const cid = `38b-dar-ship-${Date.now()}`;
      const answer = await deps.conversationEngine.handleMessage(tenantId, cid, 'شحال التوصيل؟', accountId);

      expect(answer).toMatch(/30\s*(?:MAD|درهم)/i);
      expect(DirectRagGuard.hasInternalArtifacts(answer)).toBe(false);
    });

    it('resolves COD payment query accurately ("واش كاين الدفع عند الاستلام؟")', async () => {
      const cid = `38b-dar-cod-${Date.now()}`;
      const answer = await deps.conversationEngine.handleMessage(tenantId, cid, 'واش كاين الدفع عند الاستلام؟', accountId);

      expect(answer).toMatch(/الدفع عند الاستلام|متوفر|المغرب/i);
      expect(DirectRagGuard.hasInternalArtifacts(answer)).toBe(false);
    });

    it('resolves store hours query ("شنو أوقات الخدمة؟")', async () => {
      const cid = `38b-dar-hrs-${Date.now()}`;
      const answer = await deps.conversationEngine.handleMessage(tenantId, cid, 'شنو أوقات الخدمة؟', accountId);

      expect(answer).toMatch(/24\/7|10:00|18:00|الاثنين/i);
      expect(DirectRagGuard.hasInternalArtifacts(answer)).toBe(false);
    });

    it('resolves customer support query ("كيفاش نتاصل بخدمة العملاء؟")', async () => {
      const cid = `38b-dar-sup-${Date.now()}`;
      const answer = await deps.conversationEngine.handleMessage(tenantId, cid, 'كيفاش نتاصل بخدمة العملاء؟', accountId);

      expect(answer).toMatch(/support@animeverse\.ma|\+212/i);
      expect(DirectRagGuard.hasInternalArtifacts(answer)).toBe(false);
    });

    it('resolves delivery timeframe correctly ("وفوقاش كتوصل؟")', async () => {
      const cid = `38b-dar-time-${Date.now()}`;
      const answer = await deps.conversationEngine.handleMessage(tenantId, cid, 'وفوقاش كتوصل؟', accountId);

      expect(answer).toMatch(/24|48|ساعة|يوم/i);
      expect(DirectRagGuard.hasInternalArtifacts(answer)).toBe(false);
    });

    it('resolves return window query ("واش نقدر نرجع السلعة؟")', async () => {
      const cid = `38b-dar-ret-${Date.now()}`;
      const answer = await deps.conversationEngine.handleMessage(tenantId, cid, 'واش نقدر نرجع السلعة؟', accountId);

      expect(answer).toMatch(/14\s*(?:يوم|يومًا)|الترجيع|التبديل/i);
      expect(DirectRagGuard.hasInternalArtifacts(answer)).toBe(false);
    });

    it('resolves order tracking query ("كيفاش نتبع الطلب؟")', async () => {
      const cid = `38b-dar-trk-${Date.now()}`;
      const answer = await deps.conversationEngine.handleMessage(tenantId, cid, 'كيفاش نتبع الطلب؟', accountId);

      expect(answer).toMatch(/SMS|تتبع|الرابط|رسالة/i);
      expect(DirectRagGuard.hasInternalArtifacts(answer)).toBe(false);
    });
  });

  // 2. Arabic MSA FAQ Fast-Path
  describe('2. Arabic MSA FAQ Fast-Path', () => {
    it('resolves shipping inquiry in MSA ("كم تكلفة التوصيل؟")', async () => {
      const cid = `38b-ar-ship-${Date.now()}`;
      const answer = await deps.conversationEngine.handleMessage(tenantId, cid, 'كم تكلفة التوصيل؟', accountId);

      expect(answer).toMatch(/30\s*(?:درهم|درهمًا|MAD)/i);
      expect(DirectRagGuard.hasInternalArtifacts(answer)).toBe(false);
    });

    it('resolves returns inquiry in MSA ("هل يمكنني إرجاع المنتج؟")', async () => {
      const cid = `38b-ar-ret-${Date.now()}`;
      const answer = await deps.conversationEngine.handleMessage(tenantId, cid, 'هل يمكنني إرجاع المنتج؟', accountId);

      expect(answer).toMatch(/14\s*(?:يوم|يومًا)/i);
      expect(DirectRagGuard.hasInternalArtifacts(answer)).toBe(false);
    });

    it('resolves tracking inquiry in MSA ("كيف أتتبع طلبي؟")', async () => {
      const cid = `38b-ar-trk-${Date.now()}`;
      const answer = await deps.conversationEngine.handleMessage(tenantId, cid, 'كيف أتتبع طلبي؟', accountId);

      expect(answer).toMatch(/SMS|تتبع|رابط/i);
      expect(DirectRagGuard.hasInternalArtifacts(answer)).toBe(false);
    });
  });

  // 3. Arabizi Queries
  describe('3. Arabizi Queries', () => {
    it('resolves Arabizi shipping query ("ch7al livraison?")', async () => {
      const cid = `38b-arz-ship-${Date.now()}`;
      const answer = await deps.conversationEngine.handleMessage(tenantId, cid, 'ch7al livraison?', accountId);

      expect(answer).toMatch(/30|35/);
      expect(DirectRagGuard.hasInternalArtifacts(answer)).toBe(false);
    });

    it('resolves Arabizi returns query ("wach n9der nrje3 l-produit?")', async () => {
      const cid = `38b-arz-ret-${Date.now()}`;
      const answer = await deps.conversationEngine.handleMessage(tenantId, cid, 'wach n9der nrje3 l-produit?', accountId);

      expect(answer).toMatch(/14/);
      expect(DirectRagGuard.hasInternalArtifacts(answer)).toBe(false);
    });

    it('resolves Arabizi tracking query ("kifach ntbe3 l-commande?")', async () => {
      const cid = `38b-arz-trk-${Date.now()}`;
      const answer = await deps.conversationEngine.handleMessage(tenantId, cid, 'kifach ntbe3 l-commande?', accountId);

      expect(answer.toLowerCase()).toMatch(/sms|tracking|suivi|lien|commande|support/i);
      expect(DirectRagGuard.hasInternalArtifacts(answer)).toBe(false);
    });
  });

  // 4. Safety Regressions (Must NOT use FAQ fast-path)
  describe('4. Safety Regressions (Excluded from FAQ fast-path)', () => {
    it('destination scope expansion does NOT use FAQ fast-path ("وشحال لكازا؟")', async () => {
      const cid = `38b-reg-dest-${Date.now()}`;
      await deps.conversationEngine.handleMessage(tenantId, cid, 'شحال التوصيل؟', accountId);
      const answer = await deps.conversationEngine.handleMessage(tenantId, cid, 'وشحال لكازا؟', accountId);

      // Must evaluate destination Casablanca (30 or 35 MAD), not fall back to generic price or stale un-scoped answer
      expect(answer).toMatch(/30|35/);
      expect(answer).not.toMatch(/399/); // not hoodie price
    });

    it('product price query stays in ECOMMERCE ("شحال الثمن ديالو؟")', async () => {
      const cid = `38b-reg-price-${Date.now()}`;
      await deps.conversationEngine.handleMessage(tenantId, cid, 'Tell me about the Moon Ninja Hoodie', accountId);
      const answer = await deps.conversationEngine.handleMessage(tenantId, cid, 'شحال الثمن ديالو؟', accountId);

      expect(answer).toMatch(/399/);
    });

    it('product availability query stays in ECOMMERCE ("واش كاين فالأسود؟")', async () => {
      const cid = `38b-reg-avail-${Date.now()}`;
      await deps.conversationEngine.handleMessage(tenantId, cid, 'Tell me about the Moon Ninja Hoodie', accountId);
      const answer = await deps.conversationEngine.handleMessage(tenantId, cid, 'واش كاين فالأسود؟', accountId);

      expect(answer.toLowerCase()).toMatch(/متوفر|موجود|disponible|stock|black|noir/i);
    });

    it('multi-policy query does NOT use single-policy fast-path', async () => {
      const cid = `38b-reg-multi-${Date.now()}`;
      const answer = await deps.conversationEngine.handleMessage(tenantId, cid, 'What are your shipping fees and return policy?', accountId);

      expect(answer).toMatch(/30|35/);
      expect(answer).toMatch(/14/);
    });

    it('candidate comparison stays in ECOMMERCE ("وشكون الأرخص؟")', async () => {
      const cid = `38b-reg-comp-${Date.now()}`;
      await deps.conversationEngine.handleMessage(tenantId, cid, 'Show me all anime products', accountId);
      const answer = await deps.conversationEngine.handleMessage(tenantId, cid, 'وشكون الأرخص؟', accountId);

      expect(answer).toMatch(/Moon Ninja|Cyber Spirit|399|449|أرخص/i);
    });
  });
});
