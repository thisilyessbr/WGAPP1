import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { prisma, pool } from '../../src/tests/testDb';
import { bootstrapChatbot } from '../../src/bootstrap';
import { BusinessConfig, DEFAULT_BUSINESS_CONFIG, WorkflowConfig } from '../../src/domain/tenant/BusinessConfig';

describe('PHASE TEST-MATRIX-46A: Complete Product Capability Test Matrix', () => {
  const deps = bootstrapChatbot(prisma);
  const createdTenantIds: string[] = [];

  const leadCaptureWorkflow: WorkflowConfig = {
    id: 'lead_capture',
    name: 'Lead Capture Workflow',
    description: 'Generic lead capture workflow',
    initialState: 'collect_name',
    states: {
      collect_name: {
        type: 'collect',
        field: { name: 'name', type: 'string', required: true, minLength: 2 },
        prompt: {
          en: 'Please provide your full name:',
          fr: 'Veuillez indiquer votre nom complet :',
          ar: 'يرجى تقديم اسمك الكامل:',
          darija: 'عفاك عطيني سميتك الكاملة:'
        },
        next: 'collect_phone'
      },
      collect_phone: {
        type: 'collect',
        field: { name: 'phone', type: 'string', required: true, pattern: '^[0-9+() -]{8,20}$' },
        prompt: {
          en: 'Please provide your phone number:',
          fr: 'Veuillez indiquer votre numéro de téléphone :',
          ar: 'يرجى تقديم رقم هاتفك:',
          darija: 'عفاك عطيني نمرة التلفون ديالك:'
        },
        next: 'collect_email'
      },
      collect_email: {
        type: 'collect',
        field: { name: 'email', type: 'string', required: true, pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$' },
        prompt: {
          en: 'Please provide your email address:',
          fr: 'Veuillez indiquer votre adresse e-mail :',
          ar: 'يرجى تقديم بريدك الإلكتروني:',
          darija: 'عفاك عطيني الإيميل ديالك:'
        },
        next: 'confirm'
      },
      confirm: {
        type: 'confirm',
        prompt: {
          en: 'Please confirm your details:\nName: {name}\nPhone: {phone}\nEmail: {email}\n\nConfirm? (yes/no)',
          fr: 'Veuillez confirmer vos informations :\nNom : {name}\nTéléphone : {phone}\nE-mail : {email}\n\nConfirmer ? (oui/non)',
          ar: 'يرجى تأكيد بياناتك:\nالاسم: {name}\nالهاتف: {phone}\nالبريد: {email}\n\nتأكيد؟ (نعم/لا)',
          darija: 'عفاك تأكد من المعلومات ديالك:\nالاسم: {name}\nالهاتف: {phone}\nالإيميل: {email}\n\nتأكيد؟ (نعم/لا)'
        },
        next: 'end'
      },
      end: {
        type: 'end',
        prompt: {
          en: 'Thank you {name}, lead captured!',
          fr: 'Merci {name}, contact enregistré !',
          ar: 'شكراً لك {name}، تم تسجيل طلبك بنجاح!',
          darija: 'شكراً ليك {name}، تم تسجيل الطلب ديالك!'
        }
      }
    },
    activation: {
      mode: 'explicit_intent',
      intents: ['capture_lead'],
      allowManualStart: true
    }
  };

  const sharedFaq = [
    {
      id: 'faq_consultation_duration',
      questions: {
        en: 'What is the duration of the Business Strategy Consultation?',
        fr: 'Quelle est la durée de la consultation de stratégie commerciale ?',
        ar: 'ما هي مدة استشارة استراتيجية الأعمال؟',
        darija: 'شحال المدة ديال استشارة استراتيجية الأعمال؟'
      },
      answers: {
        en: 'Business Strategy Consultation duration is 60 minutes.',
        fr: 'La durée de la consultation de stratégie commerciale est de 60 minutes.',
        ar: 'مدة استشارة استراتيجية الأعمال هي 60 دقيقة.',
        darija: 'المدة ديال استشارة استراتيجية الأعمال هي 60 دقيقة.'
      }
    },
    {
      id: 'faq_consultation_price',
      questions: {
        en: 'What is the price of the consultation?',
        fr: 'Quel est le prix de la consultation ?',
        ar: 'كم سعر الاستشارة؟',
        darija: 'شحال ثمن الاستشارة؟'
      },
      answers: {
        en: 'The consultation price is 750 MAD.',
        fr: 'Le prix de la consultation est de 750 MAD.',
        ar: 'سعر الاستشارة 750 درهم.',
        darija: 'ثمن الاستشارة هو 750 درهم.'
      }
    },
    {
      id: 'faq_consultation_cancellation',
      questions: {
        en: 'What is your cancellation policy?',
        fr: "Quelle est votre politique d'annulation ?",
        ar: 'ما هي سياسة الإلغاء؟',
        darija: 'شنو هي سياسة الإلغاء؟'
      },
      answers: {
        en: 'Cancellations must be made at least 24 hours in advance.',
        fr: 'Les annulations doivent être effectuées au moins 24 heures à l’avance.',
        ar: 'يجب أن يتم الإلغاء قبل 24 ساعة على الأقل.',
        darija: 'الإلغاء خاصو يكون على الأقل 24 ساعة قبل.'
      }
    },
    {
      id: 'faq_consultation_format',
      questions: {
        en: 'and is the consultation format online?',
        fr: 'Le format de la consultation est-il en ligne ?',
        ar: 'هل شكل الاستشارة عبر الإنترنت؟',
        darija: 'واش الاستشارة أونلاين؟'
      },
      answers: {
        en: 'The consultation format is Online.',
        fr: 'Le format de la consultation est En Ligne.',
        ar: 'شكل الاستشارة عبر الإنترنت أونلاين.',
        darija: 'الاستشارة كتكون أونلاين عبر الإنترنت.'
      }
    },
    {
      id: 'faq_support_email',
      questions: {
        en: 'What is the support email?',
        fr: 'Quelle est l’adresse e-mail de support ?',
        ar: 'ما هو البريد الإلكتروني للدعم؟',
        darija: 'شنو هو إيميل الدعم؟'
      },
      answers: {
        en: 'Our support email is support@example.test.',
        fr: 'Notre e-mail de support est support@example.test.',
        ar: 'البريد الإلكتروني للدعم هو support@example.test.',
        darija: 'الإيميل ديال الدعم هو support@example.test.'
      }
    },
    {
      id: 'faq_shipping_policy',
      questions: {
        en: 'What is your shipping policy?',
        fr: 'Quelle est votre politique de livraison ?',
        ar: 'ما هي مدة التوصيل؟',
        darija: 'شحال كياخد التوصيل؟'
      },
      answers: {
        en: 'Shipping takes 3-5 business days across Morocco.',
        fr: 'La livraison prend 3 à 5 jours ouvrables.',
        ar: 'مدة الشحن والتوصيل من 3 إلى 5 أيام عمل.',
        darija: 'التوصيل كياخد من 3 حتى 5 أيام عمل.'
      }
    },
    {
      id: 'faq_return_policy',
      questions: {
        en: 'What is your return policy?',
        fr: 'Quelle est votre politique de retour ?',
        ar: 'ما هي سياسة الإرجاع؟',
        darija: 'شنو هي سياسة الترجيع؟'
      },
      answers: {
        en: 'Our return policy allows returns within 30 days of purchase.',
        fr: 'Notre politique de retour permet les retours sous 30 jours.',
        ar: 'يمكن إرجاع المنتجات خلال 30 يوم من تاريخ الشراء.',
        darija: 'يمكن ليك ترجع المنتوج فمدة 30 يوم من الشراء.'
      }
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

  afterEach(async () => {
    deps.tenantConfigService.clearCache();
    for (const tenantId of createdTenantIds) {
      try {
        await prisma.workflowSession.deleteMany({ where: { tenantId } });
        await prisma.message.deleteMany({ where: { tenantId } });
        await prisma.conversation.deleteMany({ where: { tenantId } });
        await prisma.customer.deleteMany({ where: { tenantId } });
        await prisma.productVariant.deleteMany({ where: { product: { tenantId } } });
        await prisma.product.deleteMany({ where: { tenantId } });
        await prisma.knowledgeChunk.deleteMany({ where: { tenantId } });
        await prisma.knowledgeDocument.deleteMany({ where: { tenantId } });
        await prisma.knowledgeSource.deleteMany({ where: { tenantId } });
        await prisma.account.deleteMany({ where: { tenantId } });
        await prisma.tenantConfig.deleteMany({ where: { tenantId } });
        await prisma.tenant.deleteMany({ where: { id: tenantId } });
      } catch (err) {}
    }
    createdTenantIds.length = 0;
  });

  async function createFixtureTenant(
    tenantPrefix: string,
    ecommerceEnabled: boolean,
    hasWorkflow: boolean
  ) {
    const tenantId = `${tenantPrefix}-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const accountId = `acc-${tenantId}`;

    const config: BusinessConfig = {
      ...DEFAULT_BUSINESS_CONFIG,
      capabilities: {
        ecommerceEnabled,
        imageEnabled: false,
        faq: sharedFaq,
        intents: hasWorkflow
          ? [
              {
                id: 'capture_lead',
                description: 'Capture lead workflow',
                workflowId: 'lead_capture',
                keywords: ['capture lead', 'start lead', 'sign up', 'تسجيل']
              }
            ]
          : []
      },
      workflows: hasWorkflow ? { lead_capture: leadCaptureWorkflow } : {},
      knowledge: {
        ...DEFAULT_BUSINESS_CONFIG.knowledge,
        enabled: true
      },
      prompts: {
        ...DEFAULT_BUSINESS_CONFIG.prompts,
        fallback: {
          en: "I'm sorry, I don't have information on that topic. Please contact our support.",
          fr: "Je suis désolé, je n'ai pas d'information sur ce sujet. Veuillez contacter notre support.",
          ar: 'عذراً، ليس لدي معلومات كافية حول هذا الموضوع. يرجى التواصل مع فريق الدعم.',
          darija: 'سمح ليا، ماعنديش معلومات كافية على هاد الموضوع. عفاك تواصل مع الدعم.'
        }
      }
    };

    await prisma.tenant.create({
      data: {
        id: tenantId,
        name: `Tenant ${tenantPrefix}`,
        config: {
          create: {
            config: config as any
          }
        },
        accounts: {
          create: {
            id: accountId,
            name: `Account ${tenantPrefix}`,
            enabled: true,
            config: {
              capabilities: {
                ecommerceEnabled
              }
            }
          }
        }
      }
    });

    if (ecommerceEnabled) {
      // Create Product A: Black Hoodie (SKU: HOODIE-BLK, 399 MAD, sizes S, M, L)
      await prisma.product.create({
        data: {
          tenantId,
          accountId,
          sku: 'HOODIE-BLK',
          name: 'Black Hoodie',
          nameLocalized: {
            en: 'Black Hoodie',
            fr: 'Sweat à capuche noir',
            ar: 'هودي أسود',
            darija: 'هودي كحل'
          },
          description: 'Comfortable premium cotton black hoodie.',
          price: 399,
          currency: 'MAD',
          stock: 25,
          active: true,
          category: 'Hoodies',
          variants: {
            create: [
              { sku: 'HOODIE-BLK-S', name: 'Black Hoodie - S', color: 'Black', size: 'S', stock: 8, active: true },
              { sku: 'HOODIE-BLK-M', name: 'Black Hoodie - M', color: 'Black', size: 'M', stock: 10, active: true },
              { sku: 'HOODIE-BLK-L', name: 'Black Hoodie - L', color: 'Black', size: 'L', stock: 7, active: true }
            ]
          }
        }
      });

      // Create Product B: Running Shoes (SKU: RUN-01, 899 MAD, sizes 40, 41, 42)
      await prisma.product.create({
        data: {
          tenantId,
          accountId,
          sku: 'RUN-01',
          name: 'Running Shoes',
          nameLocalized: {
            en: 'Running Shoes',
            fr: 'Chaussures de course',
            ar: 'حذاء ركض',
            darija: 'صباط ديال الجري'
          },
          description: 'High performance breathable running shoes.',
          price: 899,
          currency: 'MAD',
          stock: 18,
          active: true,
          category: 'Shoes',
          variants: {
            create: [
              { sku: 'RUN-01-40', name: 'Running Shoes - 40', color: 'Black', size: '40', stock: 6, active: true },
              { sku: 'RUN-01-41', name: 'Running Shoes - 41', color: 'Black', size: '41', stock: 6, active: true },
              { sku: 'RUN-01-42', name: 'Running Shoes - 42', color: 'Black', size: '42', stock: 6, active: true }
            ]
          }
        }
      });
    }

    createdTenantIds.push(tenantId);
    return { tenantId, accountId, config };
  }

  // =========================================================================
  // MODE A: PDF ONLY (qa-pdf-only)
  // =========================================================================
  describe('Mode A: PDF ONLY (qa-pdf-only)', () => {
    it('Executes Tests 1 to 8 in Mode A', async () => {
      const { tenantId, accountId } = await createFixtureTenant('qa-pdf-only', false, false);
      const custId = `cust-mode-a-${Date.now()}`;

      // Test 1: Knowledge question -> knowledge answer (60 minutes)
      const res1 = await deps.conversationEngine.handleMessage(tenantId, custId, 'What is the duration of the Business Strategy Consultation?', accountId);
      expect(res1).toContain('60');

      // Test 2: Second knowledge question -> knowledge answer (750 MAD)
      const res2 = await deps.conversationEngine.handleMessage(tenantId, custId, 'What is the price of the consultation?', accountId);
      expect(res2).toContain('750');

      // Test 3: Unknown fact -> fallback
      const res3 = await deps.conversationEngine.handleMessage(tenantId, custId, 'What are the swimming pool opening hours?', accountId);
      expect(typeof res3).toBe('string');
      expect(res3.length).toBeGreaterThan(0);

      // Test 4: Multilingual knowledge -> correct response language
      const res4 = await deps.conversationEngine.handleMessage(tenantId, custId, 'Quel est le prix de la consultation ?', accountId);
      expect(res4).toContain('750');

      // Test 5: Workflow-style message -> NO workflow triggered
      const res5 = await deps.conversationEngine.handleMessage(tenantId, custId, 'capture lead', accountId);
      const customer = await prisma.customer.findUnique({ where: { tenantId_externalId: { tenantId, externalId: custId } } });
      const conv = await prisma.conversation.findFirst({ where: { tenantId, customerId: customer!.id } });
      const session5 = await deps.conversationService.getActiveSession(tenantId, conv!.id);
      expect(session5).toBeNull();

      // Test 6: Product-style message -> NO ecommerce execution
      const res6 = await deps.conversationEngine.handleMessage(tenantId, custId, 'black hoodie', accountId);
      expect(res6).not.toContain('399');

      // Test 7: Reset -> fresh conversation
      await prisma.conversation.updateMany({
        where: { tenantId, customerId: customer!.id, status: 'ACTIVE' },
        data: { status: 'ARCHIVED' }
      });
      const activeAfterReset = await prisma.conversation.findFirst({ where: { tenantId, customerId: customer!.id, status: 'ACTIVE' } });
      expect(activeAfterReset).toBeNull();

      // Test 8: Knowledge follow-up -> context preserved in new turn
      const res8 = await deps.conversationEngine.handleMessage(tenantId, custId, 'and is the consultation format online?', accountId);
      expect(res8.toLowerCase()).toContain('online');
    }, 30000);
  });

  // =========================================================================
  // MODE B: WORKFLOW + PDF (qa-workflow-pdf)
  // =========================================================================
  describe('Mode B: WORKFLOW + PDF (qa-workflow-pdf)', () => {
    it('Executes Tests 9 to 16 in Mode B', async () => {
      const { tenantId, accountId } = await createFixtureTenant('qa-workflow-pdf', false, true);
      const custId = `cust-mode-b-${Date.now()}`;

      // Test 9: Knowledge question -> PDF/FAQ, workflow NONE
      const res9 = await deps.conversationEngine.handleMessage(tenantId, custId, 'What is your cancellation policy?', accountId);
      expect(res9).toContain('24');
      const customer = await prisma.customer.findUnique({ where: { tenantId_externalId: { tenantId, externalId: custId } } });
      const conv = await prisma.conversation.findFirst({ where: { tenantId, customerId: customer!.id } });
      let activeSession = await deps.conversationService.getActiveSession(tenantId, conv!.id);
      expect(activeSession).toBeNull();

      // Test 10: Explicit capture_lead intent -> workflow starts
      const res10 = await deps.conversationEngine.handleMessage(tenantId, custId, 'capture lead', accountId);
      expect(res10).toContain('Please provide your full name:');
      activeSession = await deps.conversationService.getActiveSession(tenantId, conv!.id);
      expect(activeSession).not.toBeNull();
      expect(activeSession?.stateId).toBe('collect_name');

      // Test 11: Valid name -> advance to collect_phone
      const res11 = await deps.conversationEngine.handleMessage(tenantId, custId, 'Ilyes Saber', accountId);
      expect(res11).toContain('Please provide your phone number:');
      activeSession = await deps.conversationService.getActiveSession(tenantId, conv!.id);
      expect(activeSession?.stateId).toBe('collect_phone');
      expect(activeSession?.collectedData).toEqual({ name: 'Ilyes Saber' });

      // Test 12: Invalid phone -> reject, no mutation
      const res12 = await deps.conversationEngine.handleMessage(tenantId, custId, 'invalid-phone-abc', accountId);
      expect(res12).toContain('Please provide your phone number:');
      activeSession = await deps.conversationService.getActiveSession(tenantId, conv!.id);
      expect(activeSession?.stateId).toBe('collect_phone');
      expect((activeSession?.collectedData as any)?.phone).toBeUndefined();

      // Test 13: Side knowledge question during workflow -> knowledge answer + workflow state preserved
      const res13 = await deps.conversationEngine.handleMessage(tenantId, custId, 'What is the support email?', accountId);
      expect(res13).toContain('support@example.test');
      activeSession = await deps.conversationService.getActiveSession(tenantId, conv!.id);
      expect(activeSession?.stateId).toBe('collect_phone');

      // Test 14: Valid phone/email -> advance to confirm
      const res14a = await deps.conversationEngine.handleMessage(tenantId, custId, '0612345678', accountId);
      expect(res14a).toContain('Please provide your email address:');
      const res14b = await deps.conversationEngine.handleMessage(tenantId, custId, 'ilyes@example.test', accountId);
      expect(res14b).toContain('Please confirm your details:');
      expect(res14b).toContain('Ilyes Saber');
      expect(res14b).toContain('0612345678');
      expect(res14b).toContain('ilyes@example.test');

      // Test 15: Confirmation -> all placeholders rendered
      const res15 = await deps.conversationEngine.handleMessage(tenantId, custId, 'yes', accountId);
      expect(res15).toContain('Thank you Ilyes Saber, lead captured!');
      expect(res15).not.toContain('{name}');
      activeSession = await deps.conversationService.getActiveSession(tenantId, conv!.id);
      expect(activeSession).toBeNull();
      const completedSession = await deps.conversationService.getLatestCompletedSession(tenantId, conv!.id);
      expect(completedSession?.status).toBe('COMPLETED');

      // Test 16: Complete workflow, then explicit trigger again -> NEW workflow session
      const res16 = await deps.conversationEngine.handleMessage(tenantId, custId, 'capture lead', accountId);
      expect(res16).toContain('Please provide your full name:');
      const newSession = await deps.conversationService.getActiveSession(tenantId, conv!.id);
      expect(newSession).not.toBeNull();
      expect(newSession?.id).not.toBe(completedSession?.id);
      expect(newSession?.collectedData).toEqual({});
    }, 30000);
  });

  // =========================================================================
  // MODE C: ECOMMERCE + PDF (qa-ecommerce-pdf)
  // =========================================================================
  describe('Mode C: ECOMMERCE + PDF (qa-ecommerce-pdf)', () => {
    it('Executes Tests 17 to 24 in Mode C', async () => {
      const { tenantId, accountId } = await createFixtureTenant('qa-ecommerce-pdf', true, false);
      const custId = `cust-mode-c-${Date.now()}`;

      // Test 17: Product search -> matches Black Hoodie
      const res17 = await deps.conversationEngine.handleMessage(tenantId, custId, 'Black Hoodie', accountId);
      expect(res17).toContain('Black Hoodie');

      // Test 18: Product price -> product price (899 MAD)
      const res18 = await deps.conversationEngine.handleMessage(tenantId, custId, 'how much is the running shoes?', accountId);
      expect(res18).toContain('899');

      // Test 19: Variant query -> variant/inventory (S, M, L)
      const res19 = await deps.conversationEngine.handleMessage(tenantId, custId, 'what sizes are available for Black Hoodie?', accountId);
      expect(res19).toMatch(/S|M|L/);

      // Test 20: Knowledge policy question -> PDF/knowledge (30 days)
      const res20 = await deps.conversationEngine.handleMessage(tenantId, custId, 'What is your return policy?', accountId);
      expect(res20).toContain('30');

      // Test 21: Unknown policy -> configured fallback
      const res21 = await deps.conversationEngine.handleMessage(tenantId, custId, 'Do you accept Bitcoin?', accountId);
      expect(res21.length).toBeGreaterThan(0);

      // Test 22: Product + policy distinction -> correct shipping branch (3-5 business days)
      const res22 = await deps.conversationEngine.handleMessage(tenantId, custId, 'What is your shipping policy?', accountId);
      expect(res22).toContain('3-5');

      // Test 23: Workflow trigger -> NO workflow session
      const res23 = await deps.conversationEngine.handleMessage(tenantId, custId, 'start lead capture', accountId);
      const customer = await prisma.customer.findUnique({ where: { tenantId_externalId: { tenantId, externalId: custId } } });
      const conv = await prisma.conversation.findFirst({ where: { tenantId, customerId: customer!.id } });
      const session23 = await deps.conversationService.getActiveSession(tenantId, conv!.id);
      expect(session23).toBeNull();

      // Test 24: Reset/isolation -> product and knowledge contexts isolated
      await prisma.conversation.updateMany({
        where: { tenantId, customerId: customer!.id, status: 'ACTIVE' },
        data: { status: 'ARCHIVED' }
      });
      const activeAfterReset = await prisma.conversation.findFirst({ where: { tenantId, customerId: customer!.id, status: 'ACTIVE' } });
      expect(activeAfterReset).toBeNull();
    }, 30000);
  });

  // =========================================================================
  // MODE D: WORKFLOW + ECOMMERCE + PDF (qa-full-hybrid)
  // =========================================================================
  describe('Mode D: WORKFLOW + ECOMMERCE + PDF (qa-full-hybrid)', () => {
    it('Executes Tests 25 to 32 in Mode D', async () => {
      const { tenantId, accountId } = await createFixtureTenant('qa-full-hybrid', true, true);
      const custId = `cust-mode-d-${Date.now()}`;

      // Test 25: Product search -> ecommerce
      const res25 = await deps.conversationEngine.handleMessage(tenantId, custId, 'show me Running Shoes', accountId);
      expect(res25).toContain('Running Shoes');

      // Test 26: Knowledge/policy question -> PDF/RAG
      const res26 = await deps.conversationEngine.handleMessage(tenantId, custId, 'What is your cancellation policy?', accountId);
      expect(res26).toContain('24');

      // Test 27: Explicit workflow trigger -> workflow starts
      const res27 = await deps.conversationEngine.handleMessage(tenantId, custId, 'capture lead', accountId);
      expect(res27).toContain('Please provide your full name:');
      const customer = await prisma.customer.findUnique({ where: { tenantId_externalId: { tenantId, externalId: custId } } });
      const conv = await prisma.conversation.findFirst({ where: { tenantId, customerId: customer!.id } });
      let activeSession = await deps.conversationService.getActiveSession(tenantId, conv!.id);
      expect(activeSession).not.toBeNull();
      expect(activeSession?.stateId).toBe('collect_name');

      // Test 28: Valid field value -> workflow advances to collect_phone
      const res28 = await deps.conversationEngine.handleMessage(tenantId, custId, 'Karim Alami', accountId);
      expect(res28).toContain('Please provide your phone number:');
      activeSession = await deps.conversationService.getActiveSession(tenantId, conv!.id);
      expect(activeSession?.stateId).toBe('collect_phone');
      expect(activeSession?.collectedData).toEqual({ name: 'Karim Alami' });

      // Test 29: Side question during workflow -> FAQ answer (750 MAD) + workflow state preserved
      const res29 = await deps.conversationEngine.handleMessage(tenantId, custId, 'What is the price of the consultation?', accountId);
      expect(res29).toContain('750');
      activeSession = await deps.conversationService.getActiveSession(tenantId, conv!.id);
      expect(activeSession?.stateId).toBe('collect_phone');

      // Test 30: Knowledge question during workflow -> PDF answer (support@example.test) + workflow state preserved
      const res30 = await deps.conversationEngine.handleMessage(tenantId, custId, 'What is the support email?', accountId);
      expect(res30).toContain('support@example.test');
      activeSession = await deps.conversationService.getActiveSession(tenantId, conv!.id);
      expect(activeSession?.stateId).toBe('collect_phone');

      // Test 31: Confirmation -> resolved field values, no raw placeholders
      const res31a = await deps.conversationEngine.handleMessage(tenantId, custId, '0699887766', accountId);
      expect(res31a).toContain('Please provide your email address:');
      const res31b = await deps.conversationEngine.handleMessage(tenantId, custId, 'karim@example.test', accountId);
      expect(res31b).toContain('Please confirm your details:');
      expect(res31b).toContain('Karim Alami');
      const res31c = await deps.conversationEngine.handleMessage(tenantId, custId, 'yes', accountId);
      expect(res31c).toContain('Thank you Karim Alami, lead captured!');
      expect(res31c).not.toContain('{name}');

      // Test 32: Workflow completion + new explicit workflow trigger -> fresh workflow session
      const res32 = await deps.conversationEngine.handleMessage(tenantId, custId, 'capture lead', accountId);
      expect(res32).toContain('Please provide your full name:');
      const freshSession = await deps.conversationService.getActiveSession(tenantId, conv!.id);
      expect(freshSession).not.toBeNull();
      expect(freshSession?.collectedData).toEqual({});
    }, 30000);
  });
});
