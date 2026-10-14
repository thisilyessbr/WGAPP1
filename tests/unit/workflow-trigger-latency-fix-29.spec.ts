import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConversationEngine } from '../../src/domain/conversation/ConversationEngine';
import { ConversationService } from '../../src/domain/conversation/ConversationService';
import { WorkflowEngine } from '../../src/core/engine/WorkflowEngine';
import { WorkflowStateEvaluator } from '../../src/core/engine/WorkflowStateEvaluator';
import { ResponseBuilder } from '../../src/domain/conversation/ResponseBuilder';
import { FieldValidator } from '../../src/core/engine/FieldValidator';
import { TenantConfigService } from '../../src/domain/tenant/TenantConfigService';
import { CRMService } from '../../src/domain/crm/CRMService';
import { LLMMockProvider } from '../../src/core/llm/LLMProvider';
import { DEFAULT_BUSINESS_CONFIG, BusinessConfig } from '../../src/domain/tenant/BusinessConfig';

describe('Workflow Trigger Latency Fix (PHASE WORKFLOW-TRIGGER-LATENCY-FIX-29)', () => {
  let conversationEngine: ConversationEngine;
  let mockPrisma: any;
  let mockLlm: LLMMockProvider;
  let tenantConfigService: TenantConfigService;
  let conversationService: ConversationService;
  let crmService: CRMService;

  const tenantId = 'test-fitness-tenant';
  const customerId = 'cust-test-29';
  const accountId = 'acc-test-29';

  const testConfig: BusinessConfig = {
    ...DEFAULT_BUSINESS_CONFIG,
    capabilities: {
      ...DEFAULT_BUSINESS_CONFIG.capabilities,
      ecommerceEnabled: false,
      intents: [
        {
          id: 'fitness_consultation',
          description: 'Book a free fitness consultation or training session',
          workflowId: 'fitness_consultation',
          keywords: ['book a session', 'book consultation', 'réserver une séance', 'حجز جلسة', 'bghit n7jez']
        }
      ]
    },
    workflows: {
      fitness_consultation: {
        id: 'fitness_consultation',
        name: 'Fitness Consultation',
        description: 'Intake workflow for booking coaching sessions',
        initialState: 'collect_name',
        allowInterruption: true,
        activation: {
          mode: 'explicit_intent',
          allowManualStart: true,
          intents: ['fitness_consultation'],
          keywords: ['schedule a session', 'prendre rendez-vous']
        },
        executionLimit: {
          mode: 'once',
          maxExecutions: 1,
          limitReachedMessage: 'You have done this request'
        },
        states: {
          collect_name: {
            type: 'collect',
            prompt: 'What is your full name?',
            field: { name: 'userName', type: 'string', required: true },
            transitions: [{ target: 'collect_phone', default: true }]
          },
          collect_phone: {
            type: 'collect',
            prompt: 'Please provide your phone number:',
            field: { name: 'phone', type: 'phone', required: true },
            transitions: [{ target: 'end_step', default: true }]
          },
          end_step: {
            type: 'end',
            prompt: 'Thank you {{userName}}! Your session is booked.'
          }
        }
      }
    }
  };

  beforeEach(() => {
    mockLlm = new LLMMockProvider();
    mockLlm.intentMock = null;

    let mockConversation: any = {
      id: 'conv-29-1',
      tenantId,
      accountId,
      customerId,
      status: 'ACTIVE',
      contextData: {},
      messageCount: 0,
      version: 1,
      postCompletionQuestionCount: 0,
      customer: { id: customerId, tenantId, externalId: customerId }
    };

    let completedSessions: any[] = [];
    let activeSessions: any[] = [];

    mockPrisma = {
      tenant: { findUnique: vi.fn().mockResolvedValue({ id: tenantId, name: 'Fitness Test' }) },
      account: { findUnique: vi.fn().mockResolvedValue({ id: accountId, tenantId, enabled: true }) },
      customer: {
        findFirst: vi.fn().mockImplementation(() => Promise.resolve({ id: customerId, tenantId, externalId: customerId })),
        findUnique: vi.fn().mockImplementation(() => Promise.resolve({ id: customerId, tenantId, externalId: customerId })),
        upsert: vi.fn().mockImplementation(() => Promise.resolve({ id: customerId, tenantId, externalId: customerId }))
      },
      conversation: {
        findFirst: vi.fn().mockImplementation(() => Promise.resolve(mockConversation)),
        findUnique: vi.fn().mockImplementation(() => Promise.resolve(mockConversation)),
        create: vi.fn().mockImplementation(({ data }: any) => {
          mockConversation = { ...data, id: 'conv-new-29', version: 1 };
          return Promise.resolve(mockConversation);
        }),
        update: vi.fn().mockImplementation(({ data }: any) => {
          mockConversation = { ...mockConversation, ...data, version: (mockConversation.version || 1) + 1 };
          return Promise.resolve(mockConversation);
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 })
      },
      workflowSession: {
        findFirst: vi.fn().mockImplementation(({ where }: any) => {
          if (where.status === 'ACTIVE') {
            return Promise.resolve(activeSessions[activeSessions.length - 1] || null);
          }
          if (where.status === 'COMPLETED') {
            return Promise.resolve(completedSessions[completedSessions.length - 1] || null);
          }
          return Promise.resolve(null);
        }),
        create: vi.fn().mockImplementation(({ data }: any) => {
          const session = { ...data, id: `sess-${Date.now()}` };
          activeSessions.push(session);
          return Promise.resolve(session);
        }),
        update: vi.fn().mockImplementation(({ where, data }: any) => {
          const idx = activeSessions.findIndex(s => s.id === where.id);
          if (idx !== -1) {
            activeSessions[idx] = { ...activeSessions[idx], ...data };
            if (data.status === 'COMPLETED') {
              completedSessions.push(activeSessions[idx]);
              activeSessions.splice(idx, 1);
            }
            return Promise.resolve(activeSessions[idx]);
          }
          return Promise.resolve({ id: where.id, ...data });
        }),
        count: vi.fn().mockImplementation(({ where }: any) => {
          return Promise.resolve(completedSessions.filter(s => s.workflowId === where.workflowId && s.status === 'COMPLETED').length);
        })
      },
      message: {
        create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: `msg-${Date.now()}`, ...data })),
        count: vi.fn().mockResolvedValue(2),
        findMany: vi.fn().mockResolvedValue([])
      },
      lead: {
        findFirst: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue({ id: 'lead-1', status: 'NEW' })
      },
      $executeRaw: vi.fn().mockResolvedValue(1),
      $transaction: vi.fn().mockImplementation(async (callback: any) => {
        return callback(mockPrisma);
      })
    };

    conversationService = new ConversationService(mockPrisma);
    tenantConfigService = new TenantConfigService(mockPrisma);
    tenantConfigService.getConfig = vi.fn().mockResolvedValue(testConfig);
    crmService = new CRMService(mockPrisma);
    const responseBuilder = new ResponseBuilder();
    const evaluator = new WorkflowStateEvaluator(responseBuilder, new FieldValidator());
    const workflowEngine = new WorkflowEngine(evaluator, undefined, responseBuilder);

    conversationEngine = new ConversationEngine(
      conversationService,
      tenantConfigService,
      workflowEngine,
      mockLlm,
      responseBuilder,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      crmService
    );
  });

  it('1. Deterministically triggers workflow on exact and natural sentence match with 0 LLM calls', async () => {
    const classifySpy = vi.spyOn(mockLlm, 'classifyIntent');

    // Natural sentence containing intent keyword "book a session"
    const res1 = await conversationEngine.handleMessage(tenantId, customerId, 'I want to book a session', accountId);
    expect(res1).toBe('What is your full name?');
    expect(classifySpy).not.toHaveBeenCalled();

    // Reset conversation to test another phrase
    mockPrisma.workflowSession.findFirst.mockResolvedValue(null);

    // Natural sentence containing workflow activation keyword "schedule a session"
    const res2 = await conversationEngine.handleMessage(tenantId, customerId, 'Can you help me schedule a session please?', accountId);
    expect(res2).toBe('What is your full name?');
    expect(classifySpy).not.toHaveBeenCalled();
  });

  it('2. Handles case, whitespace, and punctuation normalization without calling LLM', async () => {
    const classifySpy = vi.spyOn(mockLlm, 'classifyIntent');

    const res = await conversationEngine.handleMessage(tenantId, customerId, '   I  WANT  TO   BOOK A SESSION!!!  ', accountId);
    expect(res).toBe('What is your full name?');
    expect(classifySpy).not.toHaveBeenCalled();
  });

  it('3. Supports multilingual trigger phrases (French, Arabic, Darija) with 0 LLM calls', async () => {
    const classifySpy = vi.spyOn(mockLlm, 'classifyIntent');

    // French
    const resFr = await conversationEngine.handleMessage(tenantId, customerId, 'Je voudrais réserver une séance', accountId);
    expect(resFr).toBe('What is your full name?');
    expect(classifySpy).not.toHaveBeenCalled();

    // Arabic
    mockPrisma.workflowSession.findFirst.mockResolvedValue(null);
    const resAr = await conversationEngine.handleMessage(tenantId, customerId, 'أريد حجز جلسة تدريب', accountId);
    expect(resAr).toBe('What is your full name?');
    expect(classifySpy).not.toHaveBeenCalled();

    // Darija
    mockPrisma.workflowSession.findFirst.mockResolvedValue(null);
    const resDarija = await conversationEngine.handleMessage(tenantId, customerId, 'bghit n7jez m3akom', accountId);
    expect(resDarija).toBe('What is your full name?');
    expect(classifySpy).not.toHaveBeenCalled();
  });

  it('4. Negative tests: Pricing, services, order tracking, and returns do NOT trigger workflow', async () => {
    const classifySpy = vi.spyOn(mockLlm, 'classifyIntent');

    // Pricing question
    const resPrice = await conversationEngine.handleMessage(tenantId, customerId, 'How much does a session cost?', accountId);
    expect(resPrice).not.toBe('What is your full name?');

    // General question
    const resServices = await conversationEngine.handleMessage(tenantId, customerId, 'What services do you offer?', accountId);
    expect(resServices).not.toBe('What is your full name?');

    // Tracking question
    const resTrack = await conversationEngine.handleMessage(tenantId, customerId, 'Where is my order tracking number?', accountId);
    expect(resTrack).not.toBe('What is your full name?');

    // Return question
    const resReturn = await conversationEngine.handleMessage(tenantId, customerId, 'Can I return my order?', accountId);
    expect(resReturn).not.toBe('What is your full name?');
  });

  it('5. Execution limit block: Blocked turn returns limit message with 0 LLM calls', async () => {
    const classifySpy = vi.spyOn(mockLlm, 'classifyIntent');

    // Simulate customer already completed 1 session
    mockPrisma.workflowSession.count.mockResolvedValue(1);

    const resBlocked = await conversationEngine.handleMessage(tenantId, customerId, 'I want to book a session', accountId);
    expect(resBlocked).toBe('You have done this request');
    expect(classifySpy).not.toHaveBeenCalled();
  });

  it('6. Unmatched semantic phrasing falls back safely to LLM intent classifier (max 1 call)', async () => {
    const classifySpy = vi.spyOn(mockLlm, 'classifyIntent').mockResolvedValue('fitness_consultation');

    // Unstructured phrasing not matching any keyword
    const res = await conversationEngine.handleMessage(
      tenantId,
      customerId,
      'I would really love to arrange some personalized one-on-one fitness coaching guidance',
      accountId
    );

    expect(classifySpy).toHaveBeenCalledTimes(1);
    expect(res).toBe('What is your full name?');
  });

  it('7. Active workflow field collection does not trigger any workflow-intent LLM calls', async () => {
    const classifySpy = vi.spyOn(mockLlm, 'classifyIntent');

    // Simulate active session waiting for name
    mockPrisma.workflowSession.findFirst.mockImplementation(({ where }: any) => {
      if (where.status === 'ACTIVE') {
        return Promise.resolve({
          id: 'sess-active-1',
          tenantId,
          conversationId: 'conv-29-1',
          workflowId: 'fitness_consultation',
          stateId: 'collect_name',
          stateHistory: [],
          collectedData: {},
          status: 'ACTIVE',
          contextData: { _started: true }
        });
      }
      return Promise.resolve(null);
    });

    const res = await conversationEngine.handleMessage(tenantId, customerId, 'John Smith', accountId);
    expect(res).toContain('Please provide your phone number:');
    expect(classifySpy).not.toHaveBeenCalled();
  });
});
