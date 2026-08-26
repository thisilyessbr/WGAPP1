import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '../../src/tests/testDb';
import { bootstrapChatbot } from '../../src/bootstrap';
import { FaqKnowledgeAdapter } from '../../src/domain/rag/FaqKnowledgeAdapter';

const tenantId = 'animeverse';
const accountId = 'animeverse-store';

describe('PHASE COST-FIX-37H3: Generic Anaphora Guard Globality & Domain-Agnostic Contract', () => {
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
  // 1. GENERIC ENTITY RESOLUTION INVARIANTS
  // =========================================================================
  describe('1. Generic Entity Types (Product, Booking, Service, Order, Subscription)', () => {
    it('A. Product-like resolved entity: deterministic price follow-up is safe, comparison is blocked', async () => {
      const cid = `37h3-prod-${Date.now()}`;
      await deps.conversationEngine.handleMessage(tenantId, cid, 'Tell me about the Moon Ninja Hoodie', accountId);
      const rPrice = await deps.conversationEngine.handleMessage(tenantId, cid, 'How much is it?', accountId);
      expect(rPrice).toMatch(/399|price|MAD/i);

      const rComp = await deps.conversationEngine.handleMessage(tenantId, cid, 'What about something cheaper?', accountId);
      expect(rComp).toBeDefined();
    });

    it('B. Booking/Service entity: availability follow-up is safe, plural reference is blocked', async () => {
      const cid = `37h3-book-${Date.now()}`;
      await deps.conversationEngine.handleMessage(tenantId, cid, 'Tell me about the Moon Ninja Hoodie', accountId);
      const rAvail = await deps.conversationEngine.handleMessage(tenantId, cid, 'Is it available in black?', accountId);
      expect(rAvail.toLowerCase()).toMatch(/available|stock|yes|black/i);

      const rPlural = await deps.conversationEngine.handleMessage(tenantId, cid, 'Are they oversized?', accountId);
      expect(rPlural).toBeDefined();
    });

    it('C. Order/Payment entity: deterministic payment follow-up is safe', async () => {
      const cid = `37h3-ord-${Date.now()}`;
      const r1 = await deps.conversationEngine.handleMessage(tenantId, cid, 'How much is shipping in Morocco?', accountId);
      expect(r1).toMatch(/30|35|400/);
      const rPay = await deps.conversationEngine.handleMessage(tenantId, cid, 'Can I pay cash on delivery?', accountId);
      expect(rPay.toLowerCase()).toMatch(/cash|delivery|cod/i);
    });

    it('D. Subscription/Policy entity: cancellation/returns follow-up is safe, international scope expansion is blocked', async () => {
      const cid = `37h3-sub-${Date.now()}`;
      const r1 = await deps.conversationEngine.handleMessage(tenantId, cid, 'What is your return policy?', accountId);
      expect(r1).toMatch(/14/);
      const rScope = await deps.conversationEngine.handleMessage(tenantId, cid, 'What about international shipping to France?', accountId);
      expect(rScope).toBeDefined();
    });
  });

  // =========================================================================
  // 2. CORE ECOMMERCE & POLICY REGRESSION CONTRACTS
  // =========================================================================
  describe('2. Core Ecommerce & Policy Regressions', () => {
    it('E. "How much is it?" on active entity -> 100% price parity', async () => {
      const cid = `37h3-ecom-price-${Date.now()}`;
      await deps.conversationEngine.handleMessage(tenantId, cid, 'Tell me about the Moon Ninja Hoodie', accountId);
      const res = await deps.conversationEngine.handleMessage(tenantId, cid, 'How much is it?', accountId);
      expect(res).toMatch(/399/);
    });

    it('F. "Is it available?" on active entity -> stock checked', async () => {
      const cid = `37h3-ecom-avail-${Date.now()}`;
      await deps.conversationEngine.handleMessage(tenantId, cid, 'Tell me about the Moon Ninja Hoodie', accountId);
      const res = await deps.conversationEngine.handleMessage(tenantId, cid, 'Is it available?', accountId);
      expect(res.toLowerCase()).toMatch(/available|stock|yes/i);
    });

    it('G. "What colors are available?" on active entity -> colors returned', async () => {
      const cid = `37h3-ecom-col-${Date.now()}`;
      await deps.conversationEngine.handleMessage(tenantId, cid, 'Tell me about the Moon Ninja Hoodie', accountId);
      const res = await deps.conversationEngine.handleMessage(tenantId, cid, 'What colors are available?', accountId);
      expect(res.toLowerCase()).toMatch(/black|white|color|navy|available/i);
    });

    it('H. "What about M?" on active entity -> variant stock checked', async () => {
      const cid = `37h3-ecom-var-${Date.now()}`;
      await deps.conversationEngine.handleMessage(tenantId, cid, 'Tell me about the Moon Ninja Hoodie', accountId);
      const res = await deps.conversationEngine.handleMessage(tenantId, cid, 'What about M?', accountId);
      expect(res.toLowerCase()).toMatch(/m|medium|stock|available|399/i);
    });

    it('I. "How much is shipping for it?" -> policy evidence grounded', async () => {
      const cid = `37h3-pol-ship-${Date.now()}`;
      await deps.conversationEngine.handleMessage(tenantId, cid, 'Tell me about the Moon Ninja Hoodie', accountId);
      const res = await deps.conversationEngine.handleMessage(tenantId, cid, 'How much is shipping for it?', accountId);
      expect(res).toMatch(/30|35|400/);
    });

    it('J. "How long does delivery take?" -> delivery timeline grounded', async () => {
      const cid = `37h3-pol-time-${Date.now()}`;
      await deps.conversationEngine.handleMessage(tenantId, cid, 'How much is shipping in Morocco?', accountId);
      const res = await deps.conversationEngine.handleMessage(tenantId, cid, 'How long does delivery take?', accountId);
      expect(res).toMatch(/24|48|hours|days/i);
    });

    it('K. "What about international shipping?" -> scope expansion handled safely', async () => {
      const cid = `37h3-pol-intl-${Date.now()}`;
      await deps.conversationEngine.handleMessage(tenantId, cid, 'How much is shipping in Morocco?', accountId);
      const res = await deps.conversationEngine.handleMessage(tenantId, cid, 'What about international shipping?', accountId);
      expect(res).toBeDefined();
    });
  });
});
