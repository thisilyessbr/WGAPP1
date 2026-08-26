import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../../src/tests/testDb';
import { bootstrapChatbot } from '../../src/bootstrap';
import { WorkflowEngine } from '../../src/core/engine/WorkflowEngine';
import { BusinessConfig, DEFAULT_BUSINESS_CONFIG, WorkflowConfig } from '../../src/domain/tenant/BusinessConfig';
import { WorkflowSession } from '@prisma/client';

describe('Phase 45G: Generic Config-Driven Workflow Activation & Interruption', () => {
  const deps = bootstrapChatbot(prisma);
  const tenantId = 'test-config-driven-45g';
  const accountId = 'test-config-driven-account';

  const baseWorkflow: WorkflowConfig = {
    id: 'lead_intake_workflow',
    name: 'Lead Intake Workflow',
    description: 'Collects customer name and contact details for lead qualification.',
    initialState: 'collect_name',
    allowInterruption: true,
    activation: {
      mode: 'explicit_intent',
      intents: ['lead_inquiry'],
      allowManualStart: true
    },
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
        next: 'confirm_step'
      },
      confirm_step: {
        type: 'confirm',
        prompt: 'Please confirm your details for {{name}} (Phone: {{phone}}):',
        confirmKeywords: ['yes', 'confirm'],
        cancelKeywords: ['no', 'cancel'],
        next: 'end_step'
      },
      end_step: {
        type: 'end',
        prompt: 'Your inquiry has been submitted successfully!'
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
          id: 'lead_inquiry',
          description: 'Submit an inquiry or request lead qualification',
          workflowId: 'lead_intake_workflow',
          keywords: ['request consultation', 'lead inquiry', 'submit inquiry']
        }
      ],
      faq: [
        {
          id: 'faq_company_services',
          questions: {
            en: 'What services do you provide?',
            ar: 'ما هي الخدمات التي تقدمونها؟'
          },
          answers: {
            en: 'We provide specialized enterprise advisory and consulting services.',
            ar: 'نقدم خدمات استشارية متخصصة للشركات والمؤسسات.'
          }
        },
        {
          id: 'faq_pricing',
          questions: {
            en: 'How much are your services?',
            ar: 'كم تبلغ تكلفة الخدمات؟'
          },
          answers: {
            en: 'Our standard advisory package is $500 per session.',
            ar: 'تكلفة باقة الاستشارة القياسية هي 500 دولار.'
          }
        }
      ]
    },
    workflows: {
      lead_intake_workflow: baseWorkflow
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
        name: 'Config Driven Test Tenant',
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
        name: 'Config Driven Test Account'
      }
    });
  });

  it('Scenario A: Workflow configured with explicit_intent -> unrelated first turn does NOT start workflow', async () => {
    const custId = `test-a-${Date.now()}`;
    const res = await deps.conversationEngine.handleMessage(tenantId, custId, 'What services do you provide?', accountId);

    expect(res).toContain('We provide specialized enterprise advisory');
    expect(res).not.toContain('Please enter your full name:');

    const sessions = await prisma.workflowSession.findMany({ where: { tenantId } });
    expect(sessions.length).toBe(0);
  });

  it('Scenario B: Matching configured intent -> workflow starts', async () => {
    const custId = `test-b-${Date.now()}`;
    const res = await deps.conversationEngine.handleMessage(tenantId, custId, 'I want to submit an inquiry', accountId);

    expect(res).toContain('Please enter your full name:');

    const sessions = await prisma.workflowSession.findMany({ where: { tenantId } });
    expect(sessions.length).toBe(1);
    expect(sessions[0].stateId).toBe('collect_name');
  });

  it('Scenario C: Active workflow + question -> answers question and preserves workflow state', async () => {
    const engine = new WorkflowEngine();
    const session: WorkflowSession = {
      id: 'session-c',
      tenantId,
      conversationId: 'conv-c',
      workflowId: 'lead_intake_workflow',
      stateId: 'collect_name',
      status: 'ACTIVE',
      contextData: { _started: true },
      stateHistory: [],
      collectedData: {},
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const res = await engine.process(session, 'How much are your services?', baseWorkflow, testConfig);

    expect(res.isComplete).toBe(false);
    expect(res.nextStateId).toBe('collect_name');
    expect(res.response).toContain('Our standard advisory package is $500 per session.');
    expect(res.response).toContain('Please enter your full name:');
    expect(res.updatedCollectedData?.['name']).toBeUndefined();
  });

  it('Scenario D: Active workflow + valid field input -> advances to next step', async () => {
    const engine = new WorkflowEngine();
    const session: WorkflowSession = {
      id: 'session-d',
      tenantId,
      conversationId: 'conv-d',
      workflowId: 'lead_intake_workflow',
      stateId: 'collect_name',
      status: 'ACTIVE',
      contextData: { _started: true },
      stateHistory: [],
      collectedData: {},
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const res = await engine.process(session, 'John Doe', baseWorkflow, testConfig);

    expect(res.isComplete).toBe(false);
    expect(res.nextStateId).toBe('collect_phone');
    expect(res.updatedCollectedData?.['name']).toBe('John Doe');
    expect(res.response).toContain('Please provide your phone number:');
  });

  it('Scenario E: Active workflow + invalid field input -> remains in same state without data corruption', async () => {
    const engine = new WorkflowEngine();
    const session: WorkflowSession = {
      id: 'session-e',
      tenantId,
      conversationId: 'conv-e',
      workflowId: 'lead_intake_workflow',
      stateId: 'collect_phone',
      status: 'ACTIVE',
      contextData: { _started: true },
      stateHistory: ['collect_name'],
      collectedData: { name: 'John Doe' },
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const res = await engine.process(session, 'not-a-valid-phone', baseWorkflow, testConfig);

    expect(res.isComplete).toBe(false);
    expect(res.nextStateId).toBe('collect_phone');
    expect(res.updatedCollectedData?.['phone']).toBeUndefined();
    expect(res.updatedCollectedData?.['name']).toBe('John Doe');
    expect(res.response).toContain('Value format is invalid');
  });

  it('Scenario F: allowInterruption=false -> strict behavior preserved (FAQ/RAG side-questions skipped)', async () => {
    const strictWorkflow: WorkflowConfig = {
      ...baseWorkflow,
      allowInterruption: false
    };

    const engine = new WorkflowEngine();
    const session: WorkflowSession = {
      id: 'session-f',
      tenantId,
      conversationId: 'conv-f',
      workflowId: 'lead_intake_workflow',
      stateId: 'collect_name',
      status: 'ACTIVE',
      contextData: { _started: true },
      stateHistory: [],
      collectedData: {},
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const res = await engine.process(session, 'How much are your services?', strictWorkflow, testConfig);

    expect(res.isComplete).toBe(false);
    expect(res.nextStateId).toBe('collect_name');
    expect(res.response).not.toContain('$500 per session');
    expect(res.response).toContain('Please enter your full name:');
    expect(res.updatedCollectedData?.['name']).toBeUndefined();
  });

  it('Scenario G: allowInterruption=true -> side-question FAQ answering enabled', async () => {
    const permissiveWorkflow: WorkflowConfig = {
      ...baseWorkflow,
      allowInterruption: true
    };

    const engine = new WorkflowEngine();
    const session: WorkflowSession = {
      id: 'session-g',
      tenantId,
      conversationId: 'conv-g',
      workflowId: 'lead_intake_workflow',
      stateId: 'collect_name',
      status: 'ACTIVE',
      contextData: { _started: true },
      stateHistory: [],
      collectedData: {},
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const res = await engine.process(session, 'How much are your services?', permissiveWorkflow, testConfig);

    expect(res.isComplete).toBe(false);
    expect(res.nextStateId).toBe('collect_name');
    expect(res.response).toContain('$500 per session');
    expect(res.response).toContain('Please enter your full name:');
  });

  it('Scenario H: auto_start mode -> workflow starts automatically on fresh turn according to config', async () => {
    const autoStartWorkflow: WorkflowConfig = {
      ...baseWorkflow,
      activation: {
        mode: 'auto_start',
        allowManualStart: true
      }
    };

    const autoStartConfig: BusinessConfig = {
      ...testConfig,
      workflows: {
        lead_intake_workflow: autoStartWorkflow
      }
    };

    await prisma.tenantConfig.updateMany({
      where: { tenantId },
      data: { config: autoStartConfig as any }
    });
    deps.tenantConfigService.clearCache();

    const custId = `test-h-${Date.now()}`;
    const res = await deps.conversationEngine.handleMessage(tenantId, custId, 'Tell me more about your company', accountId);

    expect(res).toContain('Please enter your full name:');

    const sessions = await prisma.workflowSession.findMany({ where: { tenantId } });
    expect(sessions.length).toBe(1);
    expect(sessions[0].stateId).toBe('collect_name');
  });
});
