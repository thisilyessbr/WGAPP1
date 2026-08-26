import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, pool } from '../../src/tests/testDb';
import { bootstrapChatbot } from '../../src/bootstrap';
import { HandoffService } from '../../src/domain/conversation/HandoffService';
import { TurnDecisionResolver } from '../../src/domain/conversation/TurnDecision';
import { FaqKnowledgeAdapter } from '../../src/domain/rag/FaqKnowledgeAdapter';

describe('PHASE HANDOFF-FIX-36C: Global Escalation Semantic Contract', { timeout: 45000 }, () => {
  let deps: ReturnType<typeof bootstrapChatbot>;
  const tenantId = 'animeverse';
  const accountId = 'animeverse-store';

  beforeAll(async () => {
    const client = await pool.connect();
    try {
      await client.query('SET search_path TO test, public, extensions;');
    } finally {
      client.release();
    }
    deps = bootstrapChatbot(prisma);

    const productCount = await prisma.product.count({ where: { tenantId } });
    const chunkCount = await prisma.knowledgeChunk.count({ where: { tenantId } });
    if (productCount === 0 || chunkCount === 0) {
      const { execSync } = await import('child_process');
      execSync('npx tsx scripts/seed-animeverse-client.ts', { stdio: 'inherit' });
    }

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
  }, 60000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('1. Pure Unit Semantic Contract: HandoffService.isHandoffRequested', () => {
    it('A. Explicit human requests return true across all languages', () => {
      // English
      expect(HandoffService.isHandoffRequested('I want to talk to a human')).toBe(true);
      expect(HandoffService.isHandoffRequested('Connect me with a real person please')).toBe(true);
      expect(HandoffService.isHandoffRequested('Transfer me to an agent')).toBe(true);
      expect(HandoffService.isHandoffRequested('Speak with a live agent')).toBe(true);

      // French
      expect(HandoffService.isHandoffRequested('Je veux parler à un conseiller humain')).toBe(true);
      expect(HandoffService.isHandoffRequested('Passez-moi un agent svp')).toBe(true);
      expect(HandoffService.isHandoffRequested('Transférez-moi à un conseiller')).toBe(true);

      // Arabic
      expect(HandoffService.isHandoffRequested('أريد التحدث مع موظف حقيقي فوراً')).toBe(true);
      expect(HandoffService.isHandoffRequested('حولني إلى أحد موظفي الدعم')).toBe(true);
      expect(HandoffService.isHandoffRequested('اريد كلام مع موظف')).toBe(true);

      // Darija Arabic & Arabizi
      expect(HandoffService.isHandoffRequested('بغيت نهضر مع شي موظف حقيقي دابا')).toBe(true);
      expect(HandoffService.isHandoffRequested('هضر معايا بنادم عافاك')).toBe(true);
      expect(HandoffService.isHandoffRequested('dwez liya chi agent direct')).toBe(true);
      expect(HandoffService.isHandoffRequested('bghit nhedar m3a l-agent direct')).toBe(true);
      expect(HandoffService.isHandoffRequested('passe liya un conseiller bghit nhedar m3a bnadm')).toBe(true);
    });

    it('B. Informational support & store hours questions return false (NO false escalation)', () => {
      // English
      expect(HandoffService.isHandoffRequested('What is customer support email?')).toBe(false);
      expect(HandoffService.isHandoffRequested('What are your customer service opening hours?')).toBe(false);
      expect(HandoffService.isHandoffRequested('What is your support phone number?')).toBe(false);
      expect(HandoffService.isHandoffRequested('How can I contact customer service?')).toBe(false);

      // French
      expect(HandoffService.isHandoffRequested('Quel est l\'email du support client ?')).toBe(false);
      expect(HandoffService.isHandoffRequested('Quels sont les horaires du service client ?')).toBe(false);
      expect(HandoffService.isHandoffRequested('Numéro de téléphone du service client')).toBe(false);

      // Arabic & Darija
      expect(HandoffService.isHandoffRequested('ما هو رقم هاتف وإيميل خدمة العملاء؟')).toBe(false);
      expect(HandoffService.isHandoffRequested('ما هي ساعات عمل خدمة العملاء؟')).toBe(false);
      expect(HandoffService.isHandoffRequested('فوقاش كتخدم خدمة الزبناء؟')).toBe(false);
      expect(HandoffService.isHandoffRequested('عطيني نمرة التيليفون والإيميل ديال السيبور')).toBe(false);
      expect(HandoffService.isHandoffRequested('kifach nconnecti m3a support email wla telephone?')).toBe(false);
    });
  });

  describe('2. End-to-End Chatbot-Solvable vs Escalation Verification', () => {
    it('C. Customer service hours inquiry answers with store hours, not handoff', async () => {
      const custId = `test-hours-${Date.now()}`;
      const answer = await deps.conversationEngine.handleMessage(
        tenantId,
        custId,
        'What are your customer service opening hours?',
        accountId
      );

      expect(answer).not.toMatch(/human agent|notified|assist you shortly/i);
      expect(answer).toMatch(/10:00|20:00|24\/7|hours|Monday|Saturday/i);
    });

    it('D. French service client hours inquiry answers with hours in French', async () => {
      const custId = `test-hours-fr-${Date.now()}`;
      const answer = await deps.conversationEngine.handleMessage(
        tenantId,
        custId,
        'Quels sont les horaires du service client ?',
        accountId
      );

      expect(answer).not.toMatch(/conseiller humain a été prévenu/i);
      expect(answer).toMatch(/10h|20h|24\/7|10:00|20:00|lundi|samedi/i);
    });

    it('E. Explicit human request escalates immediately', async () => {
      const custId = `test-escalate-en-${Date.now()}`;
      const answer = await deps.conversationEngine.handleMessage(
        tenantId,
        custId,
        'Transfer me to a live agent right now',
        accountId
      );

      expect(answer).toMatch(/human agent has been notified|assist you shortly/i);
    });

    it('F. Explicit Arabizi human request escalates cleanly', async () => {
      const custId = `test-escalate-dz-${Date.now()}`;
      const answer = await deps.conversationEngine.handleMessage(
        tenantId,
        custId,
        'bghit nhedar m3a l-agent direct',
        accountId
      );

      expect(answer).toMatch(/support|9riban|l'equipe|agent|conseiller/i);
    });

    it('G. Stateful transaction flow: commerce continues normally, explicit handoff overrides', async () => {
      const custId = `test-txn-override-${Date.now()}`;

      // Turn 1: Product search
      const ans1 = await deps.conversationEngine.handleMessage(tenantId, custId, 'Show me anime hoodies', accountId);
      expect(ans1).toContain('Moon Ninja Hoodie');
      expect(ans1).not.toMatch(/human agent/i);

      // Turn 2: Variant selection
      const ans2 = await deps.conversationEngine.handleMessage(tenantId, custId, 'Do you have Black in size M?', accountId);
      expect(ans2).toContain('Moon Ninja Hoodie (Black / M)');
      expect(ans2).not.toMatch(/human agent/i);

      // Turn 3: Informational support inquiry during active transaction
      const ans3 = await deps.conversationEngine.handleMessage(tenantId, custId, 'Does customer service assist with delivery?', accountId);
      expect(ans3).not.toMatch(/human agent has been notified/i);

      // Turn 4: Explicit human handoff mid-transaction
      const ans4 = await deps.conversationEngine.handleMessage(tenantId, custId, 'Actually, transfer me to an agent', accountId);
      expect(ans4).toMatch(/human agent has been notified/i);

      // Verify conversation state was updated to humanRequested
      const customer = await prisma.customer.findFirst({ where: { tenantId, externalId: custId } });
      const conv = await prisma.conversation.findFirst({ where: { tenantId, customerId: customer!.id } });
      expect(conv?.humanRequested).toBe(true);
    });
  });
});
