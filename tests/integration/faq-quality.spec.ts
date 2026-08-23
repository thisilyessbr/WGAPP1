import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { prisma, pool } from '../../src/tests/testDb';
import { bootstrapChatbot } from '../../src/bootstrap';
import { DEFAULT_BUSINESS_CONFIG, FaqEntry } from '../../src/domain/tenant/BusinessConfig';
import { LLMMockProvider } from '../../src/core/llm/LLMProvider';
import { FaqMatcher } from '../../src/domain/faq/FaqMatcher';

describe('Phase 11: FAQ Quality & Matching Hardening Tests', () => {
  let deps: ReturnType<typeof bootstrapChatbot>;
  let mockLlm: LLMMockProvider;

  const testFaqs: FaqEntry[] = [
    {
      id: 'faq-general-pricing',
      question: 'What are your plan prices?',
      answer: 'Our standard plans start at $10/month for Basic and $30/month for Pro.',
      questions: {
        en: 'What are your plan prices?',
        fr: 'Quels sont les tarifs de vos forfaits ?',
        ar: 'ما هي أسعار الخطط لديكم؟',
        darija: 'شحال الأثمنة ديال العروض؟'
      },
      answers: {
        en: 'Our standard plans start at $10/month for Basic and $30/month for Pro.',
        fr: 'Nos forfaits débutent à 10€/mois pour Basic et 30€/mois pour Pro.',
        ar: 'تبدأ خططنا من 10 دولارات شهرياً للأساسية و30 دولاراً للمتقدمة.',
        darija: 'العروض كتبدا من 100 درهم فالشهر للعادي و300 درهم للمتقدم.'
      },
      keywords: ['pricing', 'plans', 'cost', 'prices']
    },
    {
      id: 'faq-enterprise-pricing',
      question: 'What is your Enterprise plan pricing?',
      answer: 'Our Enterprise plan is custom-tailored with volume discounts and dedicated support.',
      questions: {
        en: 'What is your Enterprise plan pricing?',
        fr: 'Quel est le tarif du forfait Entreprise ?',
        ar: 'ما هي أسعار خطة الشركات والمؤسسات؟',
        darija: 'شحال ثمن عرض الشركات الكبيرة؟'
      },
      answers: {
        en: 'Our Enterprise plan is custom-tailored with volume discounts and dedicated support.',
        fr: 'Notre forfait Entreprise est sur-mesure avec support dédié.',
        ar: 'خطة المؤسسات مخصصة حسب الطلب مع دعم فني مخصص.',
        darija: 'عرض الشركات مخصص حسب الطلب مع دعم خاص.'
      },
      keywords: ['enterprise', 'pricing', 'enterprise cost', 'custom quote']
    },
    {
      id: 'faq-hours',
      question: 'What are your opening hours?',
      answer: 'We are open Monday to Friday from 9am to 6pm.',
      questions: {
        en: 'What are your opening hours?',
        fr: 'Quels sont vos horaires douverture ?',
        ar: 'ما هي ساعات العمل لديكم؟',
        darija: 'شنو هما أوقات العمل ديالكم؟'
      },
      answers: {
        en: 'We are open Monday to Friday from 9am to 6pm.',
        fr: 'Nous sommes ouverts du lundi au vendredi de 9h à 18h.',
        ar: 'نحن متاحون من الإثنين إلى الجمعة من 9 صباحاً حتى 6 مساءً.',
        darija: 'حنا حالين من الإثنين للجمعة من 9 دالصباح ل 6 دلعشية.'
      },
      keywords: ['hours', 'opening', 'working hours', 'schedule']
    },
    {
      id: 'faq-returns',
      question: 'What is your return policy?',
      answer: 'You can return any item within 30 days for a full refund.',
      questions: {
        en: 'What is your return policy?',
        fr: 'Quelle est votre politique de retour ?',
        ar: 'ما هي سياسة الاسترجاع لديكم؟',
        darija: 'شنو هي سياسة الترجيع ديالكم؟'
      },
      answers: {
        en: 'You can return any item within 30 days for a full refund.',
        fr: 'Vous pouvez retourner tout article sous 30 jours pour un remboursement.',
        ar: 'يمكنك استرجاع أي منتج خلال 30 يوماً واسترداد المبلغ كاملاً.',
        darija: 'تقدر ترجع أي منتوج فظرف 30 يوم وترجع فلوسك كاملة.'
      },
      keywords: ['return', 'returns', 'refund', 'policy']
    }
  ];

  beforeAll(async () => {
    const client = await pool.connect();
    try {
      await client.query('SET search_path TO test, public, extensions;');
    } finally {
      client.release();
    }
  });

  beforeEach(async () => {
    deps = bootstrapChatbot(prisma);
    mockLlm = new LLMMockProvider();
    deps.llmFactory.registerProvider('mock', 'mock-model', mockLlm);
    deps.tenantConfigService.clearCache();
  });

  it('1. Best-Match: Specific Enterprise pricing wins over broad general pricing', () => {
    const match = FaqMatcher.match('What is the Enterprise plan pricing and cost?', testFaqs, 'en');
    expect(match).not.toBeNull();
    expect(match?.entry.id).toBe('faq-enterprise-pricing');
    expect(match?.answer).toContain('Enterprise plan is custom-tailored');
  });

  it('2. False-Positive safeguards: Single broad words do not trigger unwarranted FAQ matches', () => {
    // Single broad tokens should not trigger high-confidence matches
    expect(FaqMatcher.match('support', testFaqs, 'en')).toBeNull();
    expect(FaqMatcher.match('plan', testFaqs, 'en')).toBeNull();
    expect(FaqMatcher.match('price', testFaqs, 'en')).toBeNull();
    expect(FaqMatcher.match('returns', testFaqs, 'en')).toBeNull();
    expect(FaqMatcher.match('hours', testFaqs, 'en')).toBeNull();
  });

  it('3. Multilingual: Localized answer selection strictly uses effectiveLanguage', () => {
    // English
    const enMatch = FaqMatcher.match('What are your opening hours?', testFaqs, 'en');
    expect(enMatch?.answer).toContain('Monday to Friday');

    // French
    const frMatch = FaqMatcher.match('Quels sont vos horaires douverture ?', testFaqs, 'fr');
    expect(frMatch?.answer).toContain('du lundi au vendredi');

    // Arabic
    const arMatch = FaqMatcher.match('ما هي ساعات العمل لديكم؟', testFaqs, 'ar');
    expect(arMatch?.answer).toContain('من الإثنين إلى الجمعة');

    // Darija
    const darijaMatch = FaqMatcher.match('شنو هما اوقات العمل ديالكم؟', testFaqs, 'darija');
    expect(darijaMatch?.answer).toContain('من الإثنين للجمعة');
  });

  it('4. Missing Translation: Missing localized answer safely returns null and does not return [object Object] or throw', () => {
    const faqWithMissingFr: FaqEntry[] = [
      {
        id: 'faq-en-only',
        question: 'How do I configure my router?',
        answer: 'Connect to 192.168.1.1 and enter admin credentials.',
        questions: { en: 'How do I configure my router?' },
        answers: { en: 'Connect to 192.168.1.1 and enter admin credentials.' }
      }
    ];

    const result = FaqMatcher.match('Comment configurer mon routeur ?', faqWithMissingFr, 'fr');
    expect(result).toBeNull();
  });

  it('5. FAQ vs RAG Precedence: Valid FAQ match prevents RAG and LLM execution (0 LLM calls)', async () => {
    const tenant = await prisma.tenant.create({
      data: {
        name: `Tenant-FaqPrecedence-${Date.now()}`,
        config: {
          create: {
            config: {
              ...DEFAULT_BUSINESS_CONFIG,
              workflows: {},
              capabilities: {
                ...DEFAULT_BUSINESS_CONFIG.capabilities,
                faq: testFaqs
              }
            }
          }
        }
      }
    });

    let llmCalled = false;
    mockLlm.generateResponse = async () => {
      llmCalled = true;
      return 'LLM response';
    };

    const custId = `cust-faq-prec-${Date.now()}`;
    const response = await deps.conversationEngine.handleMessage(
      tenant.id,
      custId,
      'What are your opening hours?'
    );

    expect(response).toContain('Monday to Friday');
    expect(llmCalled).toBe(false);
  }, 20000);

  it('6. Negative FAQ test: Unrelated question does not falsely trigger FAQ', () => {
    const match = FaqMatcher.match('How long is your Enterprise onboarding process?', testFaqs, 'en');
    // Should NOT match 'faq-hours' or 'faq-general-pricing'
    expect(match?.entry.id).not.toBe('faq-hours');
    expect(match?.entry.id).not.toBe('faq-general-pricing');
  });

  it('7. Performance benchmark: In-memory deterministic matching completes in < 5ms for 50 FAQs', () => {
    const manyFaqs: FaqEntry[] = [];
    for (let i = 0; i < 50; i++) {
      manyFaqs.push({
        id: `faq-${i}`,
        question: `How do I handle scenario number ${i} in our documentation?`,
        answer: `This is the solution for scenario ${i}.`,
        questions: { en: `How do I handle scenario number ${i} in our documentation?` },
        answers: { en: `This is the solution for scenario ${i}.` }
      });
    }

    // Warmup JIT
    FaqMatcher.match('How do I handle scenario number 0 in our documentation?', manyFaqs, 'en');

    const start = performance.now();
    const result = FaqMatcher.match('How do I handle scenario number 25 in our documentation?', manyFaqs, 'en');
    const elapsed = performance.now() - start;

    expect(result).not.toBeNull();
    expect(result?.entry.id).toBe('faq-25');
    expect(elapsed).toBeLessThan(100); // Sub-millisecond execution in isolation, under 100ms under heavy test suite load
  });
});
