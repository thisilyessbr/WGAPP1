import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../../src/tests/testDb';
import { bootstrapChatbot } from '../../src/bootstrap';
import { TurnDecisionResolver } from '../../src/domain/conversation/TurnDecision';
import { EcommerceIntentParser } from '../../src/domain/ecommerce/EcommerceIntent';
import { FaqKnowledgeAdapter } from '../../src/domain/rag/FaqKnowledgeAdapter';

const tenantId = 'animeverse';
const accountId = 'animeverse-store';

describe('PHASE PDF-SIZE-FIX-36G: Global Size Guide Routing Contract', () => {
  let deps: ReturnType<typeof bootstrapChatbot>;

  beforeAll(async () => {
    deps = bootstrapChatbot(prisma);
    const config = await deps.tenantConfigService.getConfig(tenantId);
    if (config.capabilities?.faq && config.capabilities.faq.length > 0) {
      await FaqKnowledgeAdapter.syncTenantFaqs(
        tenantId,
        null,
        config.capabilities.faq,
        deps.knowledgeRepository,
        (deps.ragService as any).embeddingProvider,
        prisma
      );
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('1. Policy Signal & TurnDecision Classification', () => {
    it('A. chest 98cm -> intent SIZE_GUIDE, domain KNOWLEDGE', () => {
      const q = 'What size should I choose if my body measurements are chest 98 cm?';
      const sigs = TurnDecisionResolver.detectPolicySignals(q);
      expect(sigs.isPolicy).toBe(true);
      expect(sigs.intent).toBe('SIZE_GUIDE');

      const decision = TurnDecisionResolver.resolve({ text: q, language: 'en' });
      expect(decision.domain).toBe('KNOWLEDGE');
      expect(decision.intent).toBe('SIZE_GUIDE');
    });

    it('B. chest 105cm -> intent SIZE_GUIDE, domain KNOWLEDGE', () => {
      const q = 'My chest is 105 cm, which size fits me?';
      const sigs = TurnDecisionResolver.detectPolicySignals(q);
      expect(sigs.isPolicy).toBe(true);
      expect(sigs.intent).toBe('SIZE_GUIDE');

      const decision = TurnDecisionResolver.resolve({ text: q, language: 'en' });
      expect(decision.domain).toBe('KNOWLEDGE');
      expect(decision.intent).toBe('SIZE_GUIDE');
    });

    it('C. chest 93cm -> intent SIZE_GUIDE, domain KNOWLEDGE', () => {
      const q = 'I have a 93 cm chest, what size should I take?';
      const sigs = TurnDecisionResolver.detectPolicySignals(q);
      expect(sigs.isPolicy).toBe(true);
      expect(sigs.intent).toBe('SIZE_GUIDE');

      const decision = TurnDecisionResolver.resolve({ text: q, language: 'en' });
      expect(decision.domain).toBe('KNOWLEDGE');
      expect(decision.intent).toBe('SIZE_GUIDE');
    });

    it('D. generic size guide -> intent SIZE_GUIDE, domain KNOWLEDGE', () => {
      const q = 'Do you have a size guide or chart for hoodies?';
      const sigs = TurnDecisionResolver.detectPolicySignals(q);
      expect(sigs.isPolicy).toBe(true);
      expect(sigs.intent).toBe('SIZE_GUIDE');

      const decision = TurnDecisionResolver.resolve({ text: q, language: 'en' });
      expect(decision.domain).toBe('KNOWLEDGE');
      expect(decision.intent).toBe('SIZE_GUIDE');
    });

    it('E. "which size fits" -> intent SIZE_GUIDE, domain KNOWLEDGE', () => {
      const q = 'Which size fits 98 cm?';
      const sigs = TurnDecisionResolver.detectPolicySignals(q);
      expect(sigs.isPolicy).toBe(true);
      expect(sigs.intent).toBe('SIZE_GUIDE');

      const decision = TurnDecisionResolver.resolve({ text: q, language: 'en' });
      expect(decision.domain).toBe('KNOWLEDGE');
      expect(decision.intent).toBe('SIZE_GUIDE');
    });

    it('F. product + chest measurement -> intent SIZE_GUIDE, domain KNOWLEDGE (preserves scope, no Ecom hijack)', () => {
      const q = 'For the Moon Ninja Hoodie, what size should I get if my chest is 98 cm?';
      const sigs = TurnDecisionResolver.detectPolicySignals(q);
      expect(sigs.isPolicy).toBe(true);
      expect(sigs.intent).toBe('SIZE_GUIDE');

      const decision = TurnDecisionResolver.resolve({ text: q, language: 'en' });
      expect(decision.domain).toBe('KNOWLEDGE');
      expect(decision.intent).toBe('SIZE_GUIDE');
    });

    it('G. active product context + chest measurement -> intent SIZE_GUIDE, domain KNOWLEDGE', () => {
      const q = 'What size fits a 98 cm chest for this hoodie?';
      const decision = TurnDecisionResolver.resolve({
        text: q,
        language: 'en',
        productContext: { selectedProductId: 'ANV-H001', selectedProductName: 'Moon Ninja Hoodie' }
      });
      expect(decision.domain).toBe('KNOWLEDGE');
      expect(decision.intent).toBe('SIZE_GUIDE');
    });

    it('H. follow-up measurement -> intent SIZE_GUIDE, domain KNOWLEDGE', () => {
      const q = 'And what if my chest is 104 cm?';
      const sigs = TurnDecisionResolver.detectPolicySignals(q);
      expect(sigs.isPolicy).toBe(true);
      expect(sigs.intent).toBe('SIZE_GUIDE');

      const decision = TurnDecisionResolver.resolve({ text: q, language: 'en' });
      expect(decision.domain).toBe('KNOWLEDGE');
      expect(decision.intent).toBe('SIZE_GUIDE');
    });
  });

  describe('2. Multilingual Coverage', () => {
    it('I. Arabic chest measurement -> intent SIZE_GUIDE, domain KNOWLEDGE', () => {
      const q = 'ما هو المقاس المناسب إذا كان مقاس الصدر 98 سم؟';
      const sigs = TurnDecisionResolver.detectPolicySignals(q);
      expect(sigs.isPolicy).toBe(true);
      expect(sigs.intent).toBe('SIZE_GUIDE');

      const decision = TurnDecisionResolver.resolve({ text: q, language: 'ar' });
      expect(decision.domain).toBe('KNOWLEDGE');
      expect(decision.intent).toBe('SIZE_GUIDE');
    });

    it('J. Darija Arabic chest measurement -> intent SIZE_GUIDE, domain KNOWLEDGE', () => {
      const q = 'عندي 98 ف الصدر شنو هي لاطاي اللي غاتجيني مزيانة؟';
      const sigs = TurnDecisionResolver.detectPolicySignals(q);
      expect(sigs.isPolicy).toBe(true);
      expect(sigs.intent).toBe('SIZE_GUIDE');

      const decision = TurnDecisionResolver.resolve({ text: q, language: 'darija' });
      expect(decision.domain).toBe('KNOWLEDGE');
      expect(decision.intent).toBe('SIZE_GUIDE');
    });

    it('K. Arabizi chest measurement -> intent SIZE_GUIDE, domain KNOWLEDGE', () => {
      const q = '3ndi 98cm f sder, ashna hiya la taille li tji mzyana?';
      const sigs = TurnDecisionResolver.detectPolicySignals(q);
      expect(sigs.isPolicy).toBe(true);
      expect(sigs.intent).toBe('SIZE_GUIDE');

      const decision = TurnDecisionResolver.resolve({ text: q, language: 'darija' });
      expect(decision.domain).toBe('KNOWLEDGE');
      expect(decision.intent).toBe('SIZE_GUIDE');
    });

    it('L. French tour de poitrine -> intent SIZE_GUIDE, domain KNOWLEDGE', () => {
      const q = 'Quelle taille choisir pour un tour de poitrine de 98 cm ?';
      const sigs = TurnDecisionResolver.detectPolicySignals(q);
      expect(sigs.isPolicy).toBe(true);
      expect(sigs.intent).toBe('SIZE_GUIDE');

      const decision = TurnDecisionResolver.resolve({ text: q, language: 'fr' });
      expect(decision.domain).toBe('KNOWLEDGE');
      expect(decision.intent).toBe('SIZE_GUIDE');
    });

    it('M. English chest size -> intent SIZE_GUIDE, domain KNOWLEDGE', () => {
      const q = 'Which size should I choose for 98 cm chest?';
      const sigs = TurnDecisionResolver.detectPolicySignals(q);
      expect(sigs.isPolicy).toBe(true);
      expect(sigs.intent).toBe('SIZE_GUIDE');

      const decision = TurnDecisionResolver.resolve({ text: q, language: 'en' });
      expect(decision.domain).toBe('KNOWLEDGE');
      expect(decision.intent).toBe('SIZE_GUIDE');
    });

    it('N. Mixed language (French / Darija) -> intent SIZE_GUIDE, domain KNOWLEDGE', () => {
      const q = 'شنو هو guide de taille ديال les sweats pour 98 cm ?';
      const sigs = TurnDecisionResolver.detectPolicySignals(q);
      expect(sigs.isPolicy).toBe(true);
      expect(sigs.intent).toBe('SIZE_GUIDE');

      const decision = TurnDecisionResolver.resolve({ text: q, language: 'darija' });
      expect(decision.domain).toBe('KNOWLEDGE');
      expect(decision.intent).toBe('SIZE_GUIDE');
    });
  });

  describe('3. Regression Protection: Ecommerce Integrity', () => {
    it('O. ATTRIBUTE_QUERY regression: normal product material inquiry stays ATTRIBUTE_QUERY', () => {
      const q = 'What material is the hoodie crafted with?';
      const sigs = TurnDecisionResolver.detectPolicySignals(q);
      expect(sigs.isPolicy).toBe(false);

      const decision = TurnDecisionResolver.resolve({ text: q, language: 'en' });
      expect(decision.domain).toBe('ECOMMERCE');
      expect(decision.intent).toBe('ATTRIBUTE_QUERY');
    });

    it('P. PRODUCT_SEARCH regression: catalog query with size filter stays PRODUCT_SEARCH', () => {
      const q = 'Show me anime hoodies in size M';
      const sigs = TurnDecisionResolver.detectPolicySignals(q);
      expect(sigs.isPolicy).toBe(false);

      const decision = TurnDecisionResolver.resolve({ text: q, language: 'en' });
      expect(decision.domain).toBe('ECOMMERCE');
      expect(decision.intent).toBe('PRODUCT_SEARCH');
    });
  });

  describe('4. End-to-End Grounding Verification', () => {
    it('Q. English 98 cm chest returns grounded Size M without dumping product fabric bio', async () => {
      const custId = `size-grounding-en-${Date.now()}`;
      const response = await deps.conversationEngine.handleMessage(
        tenantId,
        custId,
        'What size should I choose if my body measurements are chest 98 cm?',
        accountId
      );
      expect(response).toMatch(/M|Medium|97|102/i);
      expect(response).not.toMatch(/Stock:\s*\d+/i);
      expect(response).not.toMatch(/human agent/i);
    });

    it('R. French 105 cm tour de poitrine returns grounded Size L', async () => {
      const custId = `size-grounding-fr-${Date.now()}`;
      const response = await deps.conversationEngine.handleMessage(
        tenantId,
        custId,
        'Mon tour de poitrine fait 105 cm, quelle est ma taille ?',
        accountId
      );
      expect(response).toMatch(/L|Large|103|108/i);
      expect(response).not.toMatch(/conseiller humain/i);
    });
  });
});
