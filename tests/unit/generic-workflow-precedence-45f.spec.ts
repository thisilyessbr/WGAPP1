import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../../src/tests/testDb';
import { bootstrapChatbot } from '../../src/bootstrap';
import { WorkflowEngine } from '../../src/core/engine/WorkflowEngine';
import { BusinessConfig, DEFAULT_BUSINESS_CONFIG, WorkflowConfig } from '../../src/domain/tenant/BusinessConfig';
import { WorkflowSession } from '@prisma/client';

describe('Generic Global Workflow Precedence & Question Guard (Phase 45F)', () => {
  const deps = bootstrapChatbot(prisma);
  const tenantId = 'test-prec-tenant';
  const accountId = 'test-prec-account';

  const testWorkflow: WorkflowConfig = {
    id: 'consultation_booking',
    name: 'Consultation Booking',
    description: 'Book a consultation session',
    initialState: 'collect_name',
    states: {
      collect_name: {
        type: 'collect',
        field: {
          name: 'name',
          type: 'string',
          required: true,
          minLength: 2
        },
        prompt: 'Please enter your full name:',
        next: 'collect_phone'
      },
      collect_phone: {
        type: 'collect',
        field: {
          name: 'phone',
          type: 'string',
          required: true,
          pattern: '^[0-9+() -]{8,20}$'
        },
        prompt: 'Please provide your phone number:',
        next: 'step_confirm'
      },
      step_confirm: {
        type: 'confirm',
        prompt: 'Please confirm your appointment for {{name}} (Phone: {{phone}}):',
        confirmKeywords: ['yes', 'confirm', 'نعم', 'واخا', 'wah'],
        cancelKeywords: ['no', 'cancel', 'لا', 'annuler'],
        next: 'step_end'
      },
      step_end: {
        type: 'end',
        prompt: 'Thank you! Your appointment has been booked.'
      }
    }
  };

  const testConfig: BusinessConfig = {
    ...DEFAULT_BUSINESS_CONFIG,
    capabilities: {
      ecommerceEnabled: false,
      imageEnabled: false,
      intents: [
        {
          id: 'book_consultation',
          description: 'Book or schedule a consultation session',
          workflowId: 'consultation_booking',
          keywords: ['حجز استشارة', 'book consultation']
        }
      ],
      faq: [
        {
          id: 'consult-services',
          questions: {
            ar: 'ما هي الخدمات التي تقدمونها؟',
            fr: 'Quels services proposez-vous ?',
            en: 'What services do you offer?'
          },
          answers: {
            ar: 'نقدم استشارات متخصصة في تطوير الأعمال والتسويق الرقمي.',
            fr: 'Nous proposons du conseil en business et marketing.',
            en: 'We offer business strategy and digital marketing consulting.'
          }
        },
        {
          id: 'consult-price',
          questions: {
            ar: 'كم تبلغ تكلفة الاستشارة؟',
            darija: 'شحال الثمن ديال الاستشارة؟',
            en: 'How much is the consultation?'
          },
          answers: {
            ar: 'سعر الجلسة هو 500 درهم مغربي.',
            darija: 'Taman dyal l-jalssa howa 500 DH.',
            en: 'The fee is 500 MAD per session.'
          }
        },
        {
          id: 'consult-duration',
          questions: {
            ar: 'كم تستغرق الاستشارة؟',
            darija: 'شحال كتدوم الاستشارة؟',
            en: 'How long is the consultation?'
          },
          answers: {
            ar: 'مدة كل جلسة هي 45 دقيقة.',
            darija: 'Kola jalssa fiha 45 d9i9a.',
            en: 'Each session is 45 minutes.'
          }
        }
      ]
    },
    workflows: {
      consultation_booking: testWorkflow
    }
  };

  beforeEach(async () => {
    deps.tenantConfigService.clearCache();
    await prisma.workflowSession.deleteMany({ where: { tenantId } });
    await prisma.conversation.deleteMany({ where: { tenantId } });
    await prisma.customer.deleteMany({ where: { tenantId } });
    await prisma.account.deleteMany({ where: { tenantId } });
    await prisma.tenantConfig.deleteMany({ where: { tenantId } });
    await prisma.tenant.deleteMany({ where: { id: tenantId } });

    await prisma.tenant.create({
      data: {
        id: tenantId,
        name: 'Precedence Test Tenant',
        config: {
          create: {
            config: testConfig as any
          }
        }
      }
    });

    await prisma.account.create({
      data: {
        id: accountId,
        tenantId,
        name: 'Precedence Test Account'
      }
    });
  });

  it('1. Arabic FAQ does not start workflow', async () => {
    const custId = `test-faq-ar-${Date.now()}`;
    const res = await deps.conversationEngine.handleMessage(tenantId, custId, 'ما هي الخدمات التي تقدمونها؟', accountId);
    
    expect(res).toContain('نقدم استشارات متخصصة');
    expect(res).not.toContain('Please enter your full name:');

    const sessions = await prisma.workflowSession.findMany({ where: { tenantId } });
    expect(sessions.length).toBe(0);
  });

  it('2. Arabic price question does not start workflow', async () => {
    const custId = `test-price-ar-${Date.now()}`;
    const res = await deps.conversationEngine.handleMessage(tenantId, custId, 'كم تبلغ تكلفة الاستشارة؟', accountId);
    
    expect(res).toContain('500 درهم مغربي');
    expect(res).not.toContain('Please enter your full name:');

    const sessions = await prisma.workflowSession.findMany({ where: { tenantId } });
    expect(sessions.length).toBe(0);
  });

  it('3. Darija FAQ does not start workflow', async () => {
    const custId = `test-faq-dar-${Date.now()}`;
    const res = await deps.conversationEngine.handleMessage(tenantId, custId, 'شحال كتدوم الاستشارة؟', accountId);
    
    expect(res).toContain('Kola jalssa fiha 45 d9i9a');
    expect(res).not.toContain('Please enter your full name:');

    const sessions = await prisma.workflowSession.findMany({ where: { tenantId } });
    expect(sessions.length).toBe(0);
  });

  it('4. Arabizi question does not corrupt slot', async () => {
    const engine = new WorkflowEngine();
    const session: WorkflowSession = {
      id: 'session-arbz',
      tenantId,
      conversationId: 'conv-arbz',
      workflowId: 'consultation_booking',
      stateId: 'collect_name',
      status: 'ACTIVE',
      contextData: { _started: true },
      stateHistory: [],
      collectedData: {},
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const res = await engine.process(session, 'ch7al taman?', testWorkflow, testConfig);
    expect(res.isComplete).toBe(false);
    expect(res.nextStateId).toBe('collect_name');
    expect(res.updatedCollectedData?.['name']).toBeUndefined();
  });

  it('5. Explicit booking intent starts workflow', async () => {
    const custId = `test-booking-intent-${Date.now()}`;
    const res = await deps.conversationEngine.handleMessage(tenantId, custId, 'أريد حجز استشارة', accountId);
    
    expect(res).toContain('Please enter your full name:');

    const sessions = await prisma.workflowSession.findMany({ where: { tenantId } });
    expect(sessions.length).toBe(1);
    expect(sessions[0].stateId).toBe('collect_name');
  });

  it('6. Active workflow + Arabic side question preserves state', async () => {
    const engine = new WorkflowEngine();
    const session: WorkflowSession = {
      id: 'session-ar-side',
      tenantId,
      conversationId: 'conv-ar-side',
      workflowId: 'consultation_booking',
      stateId: 'collect_name',
      status: 'ACTIVE',
      contextData: { _started: true },
      stateHistory: [],
      collectedData: {},
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const res = await engine.process(session, 'كم تبلغ تكلفة الاستشارة؟', testWorkflow, testConfig);
    expect(res.isComplete).toBe(false);
    expect(res.nextStateId).toBe('collect_name');
    expect(res.response).toContain('500 درهم مغربي');
    expect(res.response).toContain('Please enter your full name:');
    expect(res.updatedCollectedData?.['name']).toBeUndefined();
  });

  it('7. Active workflow + Arabizi side question preserves state', async () => {
    const engine = new WorkflowEngine();
    const session: WorkflowSession = {
      id: 'session-dar-side',
      tenantId,
      conversationId: 'conv-dar-side',
      workflowId: 'consultation_booking',
      stateId: 'collect_name',
      status: 'ACTIVE',
      contextData: { _started: true },
      stateHistory: [],
      collectedData: {},
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const res = await engine.process(session, 'ch7al katswa l-consultation?', testWorkflow, testConfig);
    expect(res.isComplete).toBe(false);
    expect(res.nextStateId).toBe('collect_name');
    expect(res.updatedCollectedData?.['name']).toBeUndefined();
  });

  it('8. Valid field input advances workflow', async () => {
    const engine = new WorkflowEngine();
    const session: WorkflowSession = {
      id: 'session-adv',
      tenantId,
      conversationId: 'conv-adv',
      workflowId: 'consultation_booking',
      stateId: 'collect_name',
      status: 'ACTIVE',
      contextData: { _started: true },
      stateHistory: [],
      collectedData: {},
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const res = await engine.process(session, 'Mohamed Saber', testWorkflow, testConfig);
    expect(res.isComplete).toBe(false);
    expect(res.nextStateId).toBe('collect_phone');
    expect(res.updatedCollectedData?.['name']).toBe('Mohamed Saber');
    expect(res.response).toContain('Please provide your phone number:');
  });

  it('9. Invalid field input does not mutate state', async () => {
    const engine = new WorkflowEngine();
    const session: WorkflowSession = {
      id: 'session-inv',
      tenantId,
      conversationId: 'conv-inv',
      workflowId: 'consultation_booking',
      stateId: 'collect_phone',
      status: 'ACTIVE',
      contextData: { _started: true },
      stateHistory: ['collect_name'],
      collectedData: { name: 'Mohamed Saber' },
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const res = await engine.process(session, 'not-a-phone-number', testWorkflow, testConfig);
    expect(res.isComplete).toBe(false);
    expect(res.nextStateId).toBe('collect_phone');
    expect(res.updatedCollectedData?.['phone']).toBeUndefined();
    expect(res.updatedCollectedData?.['name']).toBe('Mohamed Saber');
  });
});
