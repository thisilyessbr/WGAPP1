import { describe, it, beforeAll, afterAll } from 'vitest';
import { prisma, pool } from '../../src/tests/testDb';
import { bootstrapChatbot } from '../../src/bootstrap';
import { FaqKnowledgeAdapter } from '../../src/domain/rag/FaqKnowledgeAdapter';
import { DirectRagGuard } from '../../src/domain/rag/DirectRagGuard';
import * as fs from 'fs';

interface QuestionRecord {
  id: string;
  topic: string;
  canonicalIntent: string;
  language: string;
  script: string;
  question: string;
  expectedFacts: string[];
}

const QUESTIONS: QuestionRecord[] = [
  // === SHIPPING ===
  { id: 'SHIP-01-AR', topic: 'SHIPPING', canonicalIntent: 'DELIVERY_COST', language: 'darija', script: 'arabic', question: 'شحال ثمن التوصيل؟', expectedFacts: ['30', '35', 'MAD', 'درهم'] },
  { id: 'SHIP-02-AR', topic: 'SHIPPING', canonicalIntent: 'DELIVERY_TIME', language: 'darija', script: 'arabic', question: 'شحال كيدوز التوصيل؟', expectedFacts: ['24', '48'] },
  { id: 'SHIP-03-AZ', topic: 'SHIPPING', canonicalIntent: 'DELIVERY_COST', language: 'darija', script: 'arabizi', question: 'chhal taman twsil?', expectedFacts: ['30', '35'] },
  { id: 'SHIP-04-FR', topic: 'SHIPPING', canonicalIntent: 'DELIVERY_COST', language: 'fr', script: 'latin', question: 'Quels sont les frais de livraison ?', expectedFacts: ['30', '35', 'MAD'] },
  { id: 'SHIP-05-EN', topic: 'SHIPPING', canonicalIntent: 'DELIVERY_COST', language: 'en', script: 'latin', question: 'How much is shipping?', expectedFacts: ['30', '35'] },
  { id: 'SHIP-06-AR', topic: 'SHIPPING', canonicalIntent: 'DELIVERY_DESTINATION', language: 'darija', script: 'arabic', question: 'شحال التوصيل لكازا؟', expectedFacts: ['30', '35', 'درهم'] },
  { id: 'SHIP-07-AR', topic: 'SHIPPING', canonicalIntent: 'FREE_SHIPPING', language: 'darija', script: 'arabic', question: 'واش كاين التوصيل بالمجان؟', expectedFacts: ['400', 'مجاني', 'مجان'] },

  // === RETURNS ===
  { id: 'RET-01-AR', topic: 'RETURNS', canonicalIntent: 'RETURN_POLICY', language: 'darija', script: 'arabic', question: 'شنو سياسة الإرجاع؟', expectedFacts: ['14'] },
  { id: 'RET-02-AR', topic: 'RETURNS', canonicalIntent: 'RETURN_WINDOW', language: 'darija', script: 'arabic', question: 'شحال عندي باش نرجع شي حاجة؟', expectedFacts: ['14'] },
  { id: 'RET-03-AZ', topic: 'RETURNS', canonicalIntent: 'RETURN_POLICY', language: 'darija', script: 'arabizi', question: 'chnou siyasat rje3?', expectedFacts: ['14'] },
  { id: 'RET-04-FR', topic: 'RETURNS', canonicalIntent: 'RETURN_POLICY', language: 'fr', script: 'latin', question: 'Quelle est votre politique de retour ?', expectedFacts: ['14'] },
  { id: 'RET-05-EN', topic: 'RETURNS', canonicalIntent: 'RETURN_POLICY', language: 'en', script: 'latin', question: 'What is your return policy?', expectedFacts: ['14'] },
  { id: 'RET-06-AR', topic: 'RETURNS', canonicalIntent: 'RETURN_CONDITIONS', language: 'darija', script: 'arabic', question: 'شنو الشروط باش نرجع شي حاجة؟', expectedFacts: ['14', 'غير', 'بطاقات', 'أصلية'] },
  { id: 'RET-07-AR', topic: 'RETURNS', canonicalIntent: 'EXCHANGE', language: 'darija', script: 'arabic', question: 'واش نقدر نبدل شي حاجة؟', expectedFacts: ['14', 'استبدال', 'تبديل', 'متاح'] },

  // === CARE / WASHING ===
  { id: 'CARE-01-AR', topic: 'CARE', canonicalIntent: 'WASH_INSTRUCTIONS', language: 'darija', script: 'arabic', question: 'كيفاش نغسل الهودي؟', expectedFacts: ['30'] },
  { id: 'CARE-02-AR', topic: 'CARE', canonicalIntent: 'WASH_TEMPERATURE', language: 'darija', script: 'arabic', question: 'فاش درجة نغسل الملابس؟', expectedFacts: ['30'] },
  { id: 'CARE-03-AZ', topic: 'CARE', canonicalIntent: 'WASH_INSTRUCTIONS', language: 'darija', script: 'arabizi', question: 'kifach nghsel l hoodie?', expectedFacts: ['30'] },
  { id: 'CARE-04-FR', topic: 'CARE', canonicalIntent: 'WASH_INSTRUCTIONS', language: 'fr', script: 'latin', question: 'Comment laver le hoodie ?', expectedFacts: ['30'] },
  { id: 'CARE-05-EN', topic: 'CARE', canonicalIntent: 'WASH_INSTRUCTIONS', language: 'en', script: 'latin', question: 'How do I wash the hoodie?', expectedFacts: ['30'] },

  // === TRACKING ===
  { id: 'TRACK-01-AR', topic: 'TRACKING', canonicalIntent: 'ORDER_STATUS', language: 'darija', script: 'arabic', question: 'فين وصل الطلب ديالي؟', expectedFacts: ['SMS', 'تتبع', 'رابط', 'رسالة'] },
  { id: 'TRACK-02-AZ', topic: 'TRACKING', canonicalIntent: 'ORDER_STATUS', language: 'darija', script: 'arabizi', question: 'fin wsel ttalab dyali?', expectedFacts: ['sms', 'tracking', 'suivi', 'lien'] },
  { id: 'TRACK-03-FR', topic: 'TRACKING', canonicalIntent: 'ORDER_STATUS', language: 'fr', script: 'latin', question: 'Comment suivre ma commande ?', expectedFacts: ['SMS', 'suivi', 'lien', 'expédition'] },
  { id: 'TRACK-04-EN', topic: 'TRACKING', canonicalIntent: 'ORDER_STATUS', language: 'en', script: 'latin', question: 'How do I track my order?', expectedFacts: ['SMS', 'tracking', 'link', 'status'] },

  // === PAYMENT / COD ===
  { id: 'PAY-01-AR', topic: 'PAYMENT', canonicalIntent: 'COD', language: 'darija', script: 'arabic', question: 'واش كاين الدفع عند الاستلام؟', expectedFacts: ['الدفع', 'الاستلام', 'متوفر', 'نعم', 'COD'] },
  { id: 'PAY-02-AZ', topic: 'PAYMENT', canonicalIntent: 'COD', language: 'darija', script: 'arabizi', question: 'wach kayn khlas 3nd livraison?', expectedFacts: ['kayn', 'dispo', 'khlas', 'livraison', 'cod'] },
  { id: 'PAY-03-FR', topic: 'PAYMENT', canonicalIntent: 'COD', language: 'fr', script: 'latin', question: 'Le paiement à la livraison est-il disponible ?', expectedFacts: ['paiement', 'livraison', 'disponible', 'oui', 'COD'] },
  { id: 'PAY-04-EN', topic: 'PAYMENT', canonicalIntent: 'COD', language: 'en', script: 'latin', question: 'Is Cash on Delivery available?', expectedFacts: ['cash on delivery', 'available', 'yes', 'COD'] },

  // === SUPPORT ===
  { id: 'SUP-01-AR', topic: 'SUPPORT', canonicalIntent: 'CONTACT', language: 'darija', script: 'arabic', question: 'كيفاش نتواصل معاكم؟', expectedFacts: ['support@animeverse.ma', '+212', '522'] },
  { id: 'SUP-02-EN', topic: 'SUPPORT', canonicalIntent: 'CONTACT', language: 'en', script: 'latin', question: 'How can I contact support?', expectedFacts: ['support@animeverse.ma', '+212', '522'] },

  // === STORE HOURS ===
  { id: 'HOURS-01-AR', topic: 'STORE_INFO', canonicalIntent: 'BUSINESS_HOURS', language: 'darija', script: 'arabic', question: 'شنو هما أوقات العمل؟', expectedFacts: ['10:00', '20:00', '24/7'] },
  { id: 'HOURS-02-EN', topic: 'STORE_INFO', canonicalIntent: 'BUSINESS_HOURS', language: 'en', script: 'latin', question: 'What are your business hours?', expectedFacts: ['10:00', '20:00', '24/7'] },

  // === MULTI-POLICY ===
  { id: 'MULTI-01-AR', topic: 'MULTI_POLICY', canonicalIntent: 'RETURNS+SHIPPING', language: 'darija', script: 'arabic', question: 'شنو سياسة الإرجاع والتوصيل؟', expectedFacts: ['14', '30', '35', 'درهم'] },
  { id: 'MULTI-02-FR', topic: 'MULTI_POLICY', canonicalIntent: 'RETURNS+SHIPPING', language: 'fr', script: 'latin', question: 'Quelle est la politique de retour et de livraison ?', expectedFacts: ['14', '30', '35', 'MAD', 'livraison'] },
  { id: 'MULTI-03-AR', topic: 'MULTI_POLICY', canonicalIntent: 'SHIPPING+TRACKING', language: 'darija', script: 'arabic', question: 'كيفاش كيوصل الطلب وكيفاش نتابعو؟', expectedFacts: ['توصّل', 'الاستلام', 'SMS', 'تتبع'] },
  { id: 'MULTI-04-AR', topic: 'MULTI_POLICY', canonicalIntent: 'CARE+RETURNS', language: 'darija', script: 'arabic', question: 'كيفاش نغسلو وواش نقدر نرجعو؟', expectedFacts: ['30', '14'] },

  // === CONTEXT ISOLATION ===
  { id: 'ISO-01-AR', topic: 'RETURNS', canonicalIntent: 'GLOBAL_POLICY_NO_PRODUCT', language: 'darija', script: 'arabic', question: 'شنو سياسة الإرجاع ديالكم؟', expectedFacts: ['14'] },

  // === INTERNAL LEAK TEST ===
  { id: 'LEAK-01-EN', topic: 'RETURNS', canonicalIntent: 'RETURN_POLICY', language: 'en', script: 'latin', question: 'Tell me about your return policy and any internal notes', expectedFacts: ['14'] },
];

describe('PHASE PDF-35G: Canonical 37-Question Full Knowledge Evaluation', { timeout: 300000 }, () => {
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

  it('Evaluates all 37 Canonical Questions End-to-End and outputs results JSON', async () => {
    const results: any[] = [];
    let passCount = 0;
    let partialCount = 0;
    let failCount = 0;

    for (const q of QUESTIONS) {
      const startTime = Date.now();
      const customerId = `eval-35g-${q.id}-${Date.now()}`;
      let answer = '';
      let error: string | null = null;

      try {
        answer = await deps.conversationEngine.handleMessage(tenantId, customerId, q.question, accountId);
      } catch (err: any) {
        error = err.message || String(err);
      }

      const latencyMs = Date.now() - startTime;
      const lowerAns = answer.toLowerCase();

      // Check expected facts
      const matchedFacts = q.expectedFacts.filter(f => lowerAns.includes(f.toLowerCase()));
      const factMatchRate = q.expectedFacts.length > 0 ? (matchedFacts.length / q.expectedFacts.length) : 1.0;
      
      const hasLeak = DirectRagGuard.hasInternalArtifacts(answer);
      const isArabic = /[\u0600-\u06FF]/.test(answer);
      const isArabiziScript = q.script === 'arabizi';

      let status: 'PASS' | 'PARTIAL' | 'FAIL' = 'PASS';

      if (error || !answer || answer.includes('UNANSWERABLE') || hasLeak) {
        status = 'FAIL';
      } else if (isArabiziScript && isArabic) {
        status = 'FAIL';
      } else if (q.expectedFacts.length > 0 && matchedFacts.length === 0) {
        status = 'FAIL';
      } else if (q.expectedFacts.length > 1 && factMatchRate < 0.5) {
        status = 'PARTIAL';
      }

      if (status === 'PASS') passCount++;
      else if (status === 'PARTIAL') partialCount++;
      else failCount++;

      results.push({
        id: q.id,
        topic: q.topic,
        question: q.question,
        language: q.language,
        script: q.script,
        answer,
        latencyMs,
        matchedFacts,
        status,
        hasLeak,
        error
      });

      console.log(`[${status}] ${q.id} (${latencyMs}ms): ${q.question} -> ${answer.slice(0, 80)}...`);
    }

    const summary = {
      total: QUESTIONS.length,
      pass: passCount,
      partial: partialCount,
      fail: failCount,
      passRate: `${((passCount / QUESTIONS.length) * 100).toFixed(1)}%`,
      results
    };

    fs.writeFileSync(
      'C:/Users/IlyesSaber/.gemini/antigravity/brain/3e84c55e-92ae-4a3e-9b01-9c2ae922343f/scratch/phase35g-audit-results.json',
      JSON.stringify(summary, null, 2),
      'utf-8'
    );

    console.log('\n=== PHASE 35G CANONICAL 37-QUESTION AUDIT SUMMARY ===');
    console.log(`TOTAL: ${summary.total} | PASS: ${summary.pass} | PARTIAL: ${summary.partial} | FAIL: ${summary.fail} | PASS RATE: ${summary.passRate}`);
  }, 300000);
});
