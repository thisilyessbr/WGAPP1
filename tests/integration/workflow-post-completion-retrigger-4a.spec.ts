import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { prisma } from '../../src/tests/testDb';
import { bootstrapChatbot } from '../../src/bootstrap';
import { BusinessConfig, DEFAULT_BUSINESS_CONFIG, WorkflowConfig } from '../../src/domain/tenant/BusinessConfig';

describe('Phase FIX-PROBLEM-4A: Post-Completion Explicit Workflow Retrigger', () => {
  const deps = bootstrapChatbot(prisma);
  const tenantId = `tenant-retrigger-${Date.now()}`;
  const customerExternalId = `cust-retrigger-${Date.now()}`;

  const bookingWorkflow: WorkflowConfig = {
    id: 'consultation_booking',
    name: 'Consultation Booking',
    description: 'Booking workflow',
    initialState: 'collect_name',
    states: {
      collect_name: {
        type: 'collect',
        field: { name: 'name', type: 'string', required: true },
        prompt: 'Please provide your full name:',
        next: 'booking_end'
      },
      booking_end: {
        type: 'end',
        prompt: 'Your consultation is booked!'
      }
    },
    activation: {
      mode: 'explicit_intent',
      intents: ['book_consultation'],
      allowManualStart: true
    }
  };

  const supportWorkflow: WorkflowConfig = {
    id: 'support_request',
    name: 'Support Request',
    description: 'Support workflow',
    initialState: 'collect_issue',
    states: {
      collect_issue: {
        type: 'collect',
        field: { name: 'issue', type: 'string', required: true },
        prompt: 'Please describe your technical issue:',
        next: 'support_end'
      },
      support_end: {
        type: 'end',
        prompt: 'Support ticket created.'
      }
    },
    activation: {
      mode: 'explicit_intent',
      intents: ['request_support'],
      allowManualStart: true
    }
  };

  const testConfig: BusinessConfig = {
    ...DEFAULT_BUSINESS_CONFIG,
    knowledge: {
      ...DEFAULT_BUSINESS_CONFIG.knowledge,
      enabled: false
    },
    capabilities: {
      ecommerceEnabled: false,
      imageEnabled: false,
      intents: [
        {
          id: 'book_consultation',
          description: 'Book consultation appointment',
          workflowId: 'consultation_booking',
          keywords: ['بغيت نحجز', 'book consultation', 'حجز استشارة']
        },
        {
          id: 'request_support',
          description: 'Technical support request',
          workflowId: 'support_request',
          keywords: ['need support', 'طلب دعم', 'technical help']
        }
      ],
      faq: [
        {
          id: 'faq_pricing',
          questions: {
            en: 'How much is a consultation?',
            darija: 'شحال الثمن؟',
            ar: 'كم سعر الاستشارة؟'
          },
          answers: {
            en: 'Consultation costs 500 MAD.',
            darija: 'Taman howa 500 DH.',
            ar: 'سعر الاستشارة 500 درهم.'
          }
        }
      ]
    },
    workflows: {
      consultation_booking: bookingWorkflow,
      support_request: supportWorkflow
    },
    prompts: {
      ...DEFAULT_BUSINESS_CONFIG.prompts,
      postCompletionFallback: 'I can help with questions related to your request. Our support team will follow up with you shortly.'
    }
  };

  beforeEach(async () => {
    deps.tenantConfigService.clearCache();
    await prisma.workflowSession.deleteMany({ where: { tenantId } });
    await prisma.message.deleteMany({ where: { tenantId } });
    await prisma.conversation.deleteMany({ where: { tenantId } });
    await prisma.customer.deleteMany({ where: { tenantId } });
    await prisma.tenantConfig.deleteMany({ where: { tenantId } });
    await prisma.tenant.deleteMany({ where: { id: tenantId } });

    await prisma.tenant.create({
      data: {
        id: tenantId,
        name: 'Retrigger Tenant',
        config: {
          create: {
            config: testConfig as any
          }
        }
      }
    });
  });

  afterEach(async () => {
    deps.tenantConfigService.clearCache();
    await prisma.workflowSession.deleteMany({ where: { tenantId } });
    await prisma.message.deleteMany({ where: { tenantId } });
    await prisma.conversation.deleteMany({ where: { tenantId } });
    await prisma.customer.deleteMany({ where: { tenantId } });
    await prisma.tenantConfig.deleteMany({ where: { tenantId } });
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
  });

  it('runs complete lifecycle: Workflow 1 complete -> FAQ -> Fallback -> Workflow 1 Retrigger -> Workflow 2 Trigger', async () => {
    // 1. Initial workflow trigger
    const res1 = await deps.conversationEngine.handleMessage(tenantId, customerExternalId, 'بغيت نحجز');
    expect(res1).toContain('Please provide your full name:');

    const customer = await prisma.customer.findUnique({ where: { tenantId_externalId: { tenantId, externalId: customerExternalId } } });
    const conv = await prisma.conversation.findFirst({ where: { tenantId, customerId: customer!.id } });

    let activeSession = await deps.conversationService.getActiveSession(tenantId, conv!.id);
    expect(activeSession).not.toBeNull();
    expect(activeSession?.workflowId).toBe('consultation_booking');
    expect(activeSession?.status).toBe('ACTIVE');

    // 2. User provides name -> completes workflow 1
    const res2 = await deps.conversationEngine.handleMessage(tenantId, customerExternalId, 'Mohamed Saber');
    expect(res2).toContain('Your consultation is booked!');

    // Verify session 1 is COMPLETED
    activeSession = await deps.conversationService.getActiveSession(tenantId, conv!.id);
    expect(activeSession).toBeNull();

    const session1 = await deps.conversationService.getLatestCompletedSession(tenantId, conv!.id);
    expect(session1?.status).toBe('COMPLETED');
    expect(session1?.collectedData).toEqual({ name: 'Mohamed Saber' });

    // 3. Post-completion FAQ query ("شحال الثمن؟") -> returns FAQ answer without starting workflow
    const res3 = await deps.conversationEngine.handleMessage(tenantId, customerExternalId, 'شحال الثمن؟');
    expect(res3).toContain('500');

    // 4. Post-completion unsupported question -> returns post-completion response
    const res4 = await deps.conversationEngine.handleMessage(tenantId, customerExternalId, 'Do you offer parking?');
    expect(res4.length).toBeGreaterThan(0);

    // 5. Explicit same workflow re-trigger ("بغيت نحجز") -> creates a NEW ACTIVE session
    const res5 = await deps.conversationEngine.handleMessage(tenantId, customerExternalId, 'بغيت نحجز');
    expect(res5).toContain('Please provide your full name:');

    const session2 = await deps.conversationService.getActiveSession(tenantId, conv!.id);
    expect(session2).not.toBeNull();
    expect(session2?.id).not.toBe(session1?.id);
    expect(session2?.status).toBe('ACTIVE');
    expect(session2?.workflowId).toBe('consultation_booking');
    expect(session2?.collectedData).toEqual({});

    // Verify session 1 is still COMPLETED in database
    const session1Check = await prisma.workflowSession.findUnique({ where: { id: session1!.id } });
    expect(session1Check?.status).toBe('COMPLETED');

    // 6. Complete session 2 with a new name
    const res6 = await deps.conversationEngine.handleMessage(tenantId, customerExternalId, 'Amine Bennani');
    expect(res6).toContain('Your consultation is booked!');

    const session2Check = await prisma.workflowSession.findUnique({ where: { id: session2!.id } });
    expect(session2Check?.status).toBe('COMPLETED');

    // 7. Explicit different workflow trigger ("need support") -> starts support_request workflow
    const res7 = await deps.conversationEngine.handleMessage(tenantId, customerExternalId, 'need support');
    expect(res7).toContain('Please describe your technical issue:');

    const session3 = await deps.conversationService.getActiveSession(tenantId, conv!.id);
    expect(session3).not.toBeNull();
    expect(session3?.workflowId).toBe('support_request');
    expect(session3?.status).toBe('ACTIVE');
    expect(session3?.collectedData).toEqual({});
  }, 30000);
});
