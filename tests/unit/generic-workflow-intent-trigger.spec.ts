import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConversationEngine } from '../../src/domain/conversation/ConversationEngine';
import { ConversationService } from '../../src/domain/conversation/ConversationService';
import { WorkflowEngine } from '../../src/core/engine/WorkflowEngine';
import { WorkflowStateEvaluator } from '../../src/core/engine/WorkflowStateEvaluator';
import { ResponseBuilder } from '../../src/domain/conversation/ResponseBuilder';
import { FieldValidator } from '../../src/core/engine/FieldValidator';
import { TenantConfigService } from '../../src/domain/tenant/TenantConfigService';
import { CRMService } from '../../src/domain/crm/CRMService';
import { EcommerceService } from '../../src/domain/ecommerce/EcommerceService';
import { ProductRepository } from '../../src/domain/ecommerce/ProductRepository';
import { LLMMockProvider } from '../../src/core/llm/LLMProvider';
import { DEFAULT_BUSINESS_CONFIG, BusinessConfig } from '../../src/domain/tenant/BusinessConfig';

describe('Generic Workflow Intent Trigger & Prompt Compatibility (PHASE WORKFLOW-TRIGGER-FIX-23)', () => {
  let conversationEngine: ConversationEngine;
  let mockPrisma: any;
  let mockLlm: LLMMockProvider;
  let tenantConfigService: TenantConfigService;
  let conversationService: ConversationService;
  let crmService: CRMService;
  let ecommerceService: EcommerceService;
  let productRepo: ProductRepository;

  const tenantId = 'generic-test-tenant';
  const accountId = 'generic-test-account';
  const customerId = 'generic-customer-1';

  const multiCapabilityConfig: BusinessConfig = {
    ...DEFAULT_BUSINESS_CONFIG,
    capabilities: {
      ...DEFAULT_BUSINESS_CONFIG.capabilities,
      ecommerceEnabled: true,
      intents: [
        {
          id: 'fitness_consultation',
          description: 'Book a free fitness consultation, coaching program, or private training session',
          workflowId: 'fitness_consultation',
          keywords: ['consultation', 'coaching intake']
        },
        {
          id: 'demo_request',
          description: 'Customer wants to request a product demonstration',
          workflowId: 'product_demo'
        }
      ]
    },
    workflows: {
      fitness_consultation: {
        id: 'fitness_consultation',
        name: 'Fitness Consultation',
        description: 'Intake workflow for booking fitness coaching programs and sessions',
        initialState: 'collect_name',
        allowInterruption: true,
        activation: {
          mode: 'explicit_intent',
          allowManualStart: true,
          intents: ['fitness_consultation']
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
            transitions: [{ target: 'collect_goal', default: true }]
          },
          collect_goal: {
            type: 'collect',
            prompt: 'What is your fitness goal?',
            field: { name: 'fitnessGoal', type: 'string', required: true },
            transitions: [{ target: 'confirm_step', default: true }]
          },
          confirm_step: {
            type: 'confirm',
            prompt: 'Please confirm your booking:',
            confirmKeywords: ['yes', 'confirm', 'oui', 'wakha', 'نعم', 'yeah'],
            cancelKeywords: ['no', 'cancel', 'non', 'لا'],
            transitions: [{ target: 'end_step', default: true }]
          },
          end_step: {
            type: 'end',
            prompt: 'Thank you {{userName}}! Your consultation for {{fitnessGoal}} is booked.'
          }
        }
      },
      product_demo: {
        id: 'product_demo',
        name: 'Product Demo',
        description: 'Schedule a live demo with product specialist',
        initialState: 'ask_company',
        allowInterruption: true,
        activation: {
          mode: 'explicit_intent',
          allowManualStart: true,
          intents: ['demo_request']
        },
        states: {
          ask_company: {
            type: 'collect',
            prompt: 'What company are you with?',
            field: { name: 'company', type: 'string', required: true },
            transitions: [{ target: 'demo_end', default: true }]
          },
          demo_end: {
            type: 'end',
            prompt: 'Thanks! A demo specialist will reach out.'
          }
        }
      }
    }
  };

  beforeEach(() => {
    mockLlm = new LLMMockProvider();
    mockLlm.intentMock = 'fitness_consultation';

    const sampleProduct = {
      id: 'prod-1',
      tenantId,
      accountId,
      name: 'Black Training Hoodie',
      title: 'Black Training Hoodie',
      description: 'High quality training hoodie',
      price: 49.99,
      currency: 'USD',
      active: true,
      variants: [
        {
          id: 'var-1',
          productId: 'prod-1',
          sku: 'HOOD-1',
          name: 'Default',
          price: 49.99,
          stock: 10,
          active: true
        }
      ],
      images: [],
      reviews: []
    };

    mockPrisma = {
      tenant: { findUnique: vi.fn() },
      tenantConfig: { findUnique: vi.fn(), upsert: vi.fn() },
      customer: { findFirst: vi.fn(), upsert: vi.fn() },
      account: { findUnique: vi.fn() },
      conversation: {
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn()
      },
      message: {
        create: vi.fn(),
        count: vi.fn().mockResolvedValue(0),
        findMany: vi.fn().mockResolvedValue([])
      },
      workflowSession: {
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn()
      },
      lead: {
        upsert: vi.fn(),
        findUnique: vi.fn(),
        findMany: vi.fn()
      },
      product: {
        findMany: vi.fn().mockResolvedValue([sampleProduct]),
        findFirst: vi.fn().mockResolvedValue(sampleProduct)
      }
    };

    tenantConfigService = new TenantConfigService(mockPrisma);
    vi.spyOn(tenantConfigService, 'getConfig').mockResolvedValue(multiCapabilityConfig);

    conversationService = new ConversationService(mockPrisma);
    crmService = new CRMService(mockPrisma);
    productRepo = new ProductRepository(mockPrisma);
    ecommerceService = new EcommerceService(productRepo);

    const evaluator = new WorkflowStateEvaluator();
    const responseBuilder = new ResponseBuilder();
    const fieldValidator = new FieldValidator();
    const workflowEngine = new WorkflowEngine(evaluator, undefined, responseBuilder, fieldValidator);

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
      ecommerceService,
      crmService
    );
  });

  it('1. Legacy {{intents}} prompt is augmented with semantic descriptions and correctly triggers workflow', async () => {
    const legacyConfig: BusinessConfig = {
      ...multiCapabilityConfig,
      prompts: {
        ...multiCapabilityConfig.prompts,
        intentClassification: 'You are an intent classification engine. Classify into [{{intents}}]. Reply with exact ID or null.'
      }
    };
    vi.spyOn(tenantConfigService, 'getConfig').mockResolvedValue(legacyConfig);

    const mockConv = {
      id: 'conv-legacy',
      tenantId,
      customerId,
      accountId,
      status: 'ACTIVE',
      contextData: {},
      messageCount: 0,
      postCompletionQuestionCount: 0,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    vi.spyOn(conversationService, 'getOrCreateConversation').mockResolvedValue(mockConv as any);
    vi.spyOn(conversationService, 'getActiveSession').mockResolvedValue(null);
    vi.spyOn(conversationService, 'getLatestCompletedSession').mockResolvedValue(null);
    vi.spyOn(conversationService, 'createSession').mockResolvedValue({
      id: 'sess-leg',
      conversationId: 'conv-legacy',
      workflowId: 'fitness_consultation',
      stateId: 'collect_name',
      status: 'ACTIVE'
    } as any);
    vi.spyOn(conversationService, 'commitConversationTurn').mockResolvedValue(mockConv as any);

    let passedSystemPrompt = '';
    mockLlm.classifyIntent = async (sysPrompt, msg, allowed) => {
      passedSystemPrompt = sysPrompt;
      return 'fitness_consultation';
    };

    const response = await conversationEngine.handleMessage(tenantId, customerId, 'I want to book a session', accountId);

    expect(response).toBe('What is your full name?');
    expect(passedSystemPrompt).toContain('fitness_consultation');
    expect(passedSystemPrompt).toContain('Book a free fitness consultation');
    expect(passedSystemPrompt).toContain('Workflow: Fitness Consultation');
  });

  it('2. Modern {{intentDescriptions}} prompt is correctly populated without duplicating descriptions', async () => {
    const modernConfig: BusinessConfig = {
      ...multiCapabilityConfig,
      prompts: {
        ...multiCapabilityConfig.prompts,
        intentClassification: 'Custom classifier:\n{{intentDescriptions}}\nChoose one or null.'
      }
    };
    vi.spyOn(tenantConfigService, 'getConfig').mockResolvedValue(modernConfig);

    const mockConv = {
      id: 'conv-modern',
      tenantId,
      customerId,
      accountId,
      status: 'ACTIVE',
      contextData: {},
      messageCount: 0,
      postCompletionQuestionCount: 0,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    vi.spyOn(conversationService, 'getOrCreateConversation').mockResolvedValue(mockConv as any);
    vi.spyOn(conversationService, 'getActiveSession').mockResolvedValue(null);
    vi.spyOn(conversationService, 'getLatestCompletedSession').mockResolvedValue(null);
    vi.spyOn(conversationService, 'createSession').mockResolvedValue({
      id: 'sess-mod',
      conversationId: 'conv-modern',
      workflowId: 'fitness_consultation',
      stateId: 'collect_name',
      status: 'ACTIVE'
    } as any);
    vi.spyOn(conversationService, 'commitConversationTurn').mockResolvedValue(mockConv as any);

    let passedSystemPrompt = '';
    mockLlm.classifyIntent = async (sysPrompt, msg, allowed) => {
      passedSystemPrompt = sysPrompt;
      return 'fitness_consultation';
    };

    const response = await conversationEngine.handleMessage(tenantId, customerId, 'I want to book a session', accountId);

    expect(response).toBe('What is your full name?');
    expect(passedSystemPrompt).toContain('Custom classifier:\n- "fitness_consultation": Book a free fitness consultation');
    expect(passedSystemPrompt).not.toContain('Candidate intent descriptions (support English');
  });

  it('3. Multilingual booking triggers (English, French, Arabic, Darija, Arabizi) map to workflow', async () => {
    const testCases = [
      { text: 'I want to book a session', intent: 'fitness_consultation' },
      { text: 'I want a private session', intent: 'fitness_consultation' },
      { text: "I'd like a consultation", intent: 'fitness_consultation' },
      { text: 'Je veux réserver une séance', intent: 'fitness_consultation' },
      { text: 'أريد حجز جلسة', intent: 'fitness_consultation' },
      { text: 'بغيت نحجز سيانس', intent: 'fitness_consultation' },
      { text: 'bghit n7jez séance', intent: 'fitness_consultation' }
    ];

    for (const tc of testCases) {
      const mockConv = {
        id: `conv-${tc.text.substring(0, 5)}`,
        tenantId,
        customerId,
        accountId,
        status: 'ACTIVE',
        contextData: {},
        messageCount: 0,
        postCompletionQuestionCount: 0,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      vi.spyOn(conversationService, 'getOrCreateConversation').mockResolvedValue(mockConv as any);
      vi.spyOn(conversationService, 'getActiveSession').mockResolvedValue(null);
      vi.spyOn(conversationService, 'getLatestCompletedSession').mockResolvedValue(null);
      const createSpy = vi.spyOn(conversationService, 'createSession').mockResolvedValue({
        id: 'sess-multi',
        conversationId: mockConv.id,
        workflowId: 'fitness_consultation',
        stateId: 'collect_name',
        status: 'ACTIVE'
      } as any);
      vi.spyOn(conversationService, 'commitConversationTurn').mockResolvedValue(mockConv as any);
      vi.spyOn(mockLlm, 'classifyIntent').mockResolvedValue(tc.intent);

      const response = await conversationEngine.handleMessage(tenantId, customerId, tc.text, accountId);
      expect(response).toBe('What is your full name?');
      expect(createSpy).toHaveBeenCalledWith(tenantId, mockConv.id, 'fitness_consultation', 'collect_name');
    }
  });

  it('4. Generic custom workflow (demo_request -> product_demo) triggers without hardcoded logic', async () => {
    const mockConv = {
      id: 'conv-demo',
      tenantId,
      customerId,
      accountId,
      status: 'ACTIVE',
      contextData: {},
      messageCount: 0,
      postCompletionQuestionCount: 0,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    vi.spyOn(conversationService, 'getOrCreateConversation').mockResolvedValue(mockConv as any);
    vi.spyOn(conversationService, 'getActiveSession').mockResolvedValue(null);
    vi.spyOn(conversationService, 'getLatestCompletedSession').mockResolvedValue(null);
    const createSpy = vi.spyOn(conversationService, 'createSession').mockResolvedValue({
      id: 'sess-demo',
      conversationId: 'conv-demo',
      workflowId: 'product_demo',
      stateId: 'ask_company',
      status: 'ACTIVE'
    } as any);
    vi.spyOn(conversationService, 'commitConversationTurn').mockResolvedValue(mockConv as any);
    vi.spyOn(mockLlm, 'classifyIntent').mockResolvedValue('demo_request');

    const response = await conversationEngine.handleMessage(tenantId, customerId, "I'd like a demonstration", accountId);

    expect(response).toBe('What company are you with?');
    expect(createSpy).toHaveBeenCalledWith(tenantId, 'conv-demo', 'product_demo', 'ask_company');
  });

  it('5. Negative routing (questions/inquiries) returns null intent and does NOT start workflow', async () => {
    const negativeQueries = [
      'what do you offer?',
      'how much does shipping cost?',
      'where is my order?',
      'can I return this?',
      'show me your services'
    ];

    for (const q of negativeQueries) {
      const mockConv = {
        id: `conv-neg`,
        tenantId,
        customerId,
        accountId,
        status: 'ACTIVE',
        contextData: {},
        messageCount: 0,
        postCompletionQuestionCount: 0,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      vi.spyOn(conversationService, 'getOrCreateConversation').mockResolvedValue(mockConv as any);
      vi.spyOn(conversationService, 'getActiveSession').mockResolvedValue(null);
      vi.spyOn(conversationService, 'getLatestCompletedSession').mockResolvedValue(null);
      const createSpy = vi.spyOn(conversationService, 'createSession');
      vi.spyOn(conversationService, 'commitConversationTurn').mockResolvedValue(mockConv as any);
      vi.spyOn(mockLlm, 'classifyIntent').mockResolvedValue(null);
      mockLlm.generatedResponseMock = 'Here is information regarding your inquiry.';

      const response = await conversationEngine.handleMessage(tenantId, customerId, q, accountId);
      expect(createSpy).not.toHaveBeenCalled();
      expect(response).toBeTruthy();
    }
  });

  it('6. Deterministic BUY_INTENT fast path continues with 0 workflow LLM calls', async () => {
    const mockConv = {
      id: 'conv-buy',
      tenantId,
      customerId,
      accountId,
      status: 'ACTIVE',
      contextData: {
        productContext: { selectedProductId: 'prod-1' }
      },
      messageCount: 1,
      postCompletionQuestionCount: 0,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    vi.spyOn(conversationService, 'getOrCreateConversation').mockResolvedValue(mockConv as any);
    vi.spyOn(conversationService, 'getActiveSession').mockResolvedValue(null);
    vi.spyOn(conversationService, 'getLatestCompletedSession').mockResolvedValue(null);
    vi.spyOn(conversationService, 'commitConversationTurn').mockResolvedValue(mockConv as any);
    const classifySpy = vi.spyOn(mockLlm, 'classifyIntent');
    const leadSpy = vi.spyOn(crmService, 'upsertLead').mockResolvedValue({ id: 'lead-1', status: 'NEW' } as any);

    const phrases = ['I want to buy this', 'بغيت نشري هادشي', 'bghit nchri hadchi'];
    for (const p of phrases) {
      classifySpy.mockClear();
      await conversationEngine.handleMessage(tenantId, customerId, p, accountId);
      expect(classifySpy).not.toHaveBeenCalled();
      expect(leadSpy).toHaveBeenCalled();
    }
  });

  it('7. Workflow completion creates exactly 1 CRM lead', async () => {
    const activeSession = {
      id: 'sess-fitness-finish',
      conversationId: 'conv-finish',
      workflowId: 'fitness_consultation',
      stateId: 'confirm_step',
      stateHistory: ['collect_name', 'collect_phone', 'collect_goal', 'confirm_step'],
      collectedData: {
        userName: 'John Doe',
        phone: '+212612345678',
        fitnessGoal: 'Muscle gain'
      },
      contextData: {
        _started: true,
        userName: 'John Doe',
        phone: '+212612345678',
        fitnessGoal: 'Muscle gain'
      },
      status: 'ACTIVE'
    };

    const mockConv = {
      id: 'conv-finish',
      tenantId,
      customerId,
      accountId,
      status: 'ACTIVE',
      contextData: {},
      messageCount: 4,
      postCompletionQuestionCount: 0,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    vi.spyOn(conversationService, 'getOrCreateConversation').mockResolvedValue(mockConv as any);
    vi.spyOn(conversationService, 'getActiveSession').mockResolvedValue(activeSession as any);
    vi.spyOn(conversationService, 'commitConversationTurn').mockResolvedValue(mockConv as any);
    const leadSpy = vi.spyOn(crmService, 'upsertLead').mockResolvedValue({ id: 'lead-finish', status: 'NEW' } as any);

    const response = await conversationEngine.handleMessage(tenantId, customerId, 'yes', accountId);

    expect(response).toContain('Thank you John Doe! Your consultation for Muscle gain is booked.');
    expect(leadSpy).toHaveBeenCalledTimes(1);
    expect(leadSpy).toHaveBeenCalledWith(tenantId, accountId, customerId, 'NEW');
  });

  it('8. Operational workflow completion produces ZERO CRM leads', async () => {
    const operationalConfig: BusinessConfig = {
      ...DEFAULT_BUSINESS_CONFIG,
      workflows: {
        feedback_survey: {
          id: 'feedback_survey',
          name: 'Feedback Survey',
          initialState: 'rating',
          states: {
            rating: {
              type: 'choice',
              prompt: 'How was your experience?',
              options: [{ label: 'Great', value: '5', next: 'thanks' }]
            },
            thanks: {
              type: 'end',
              prompt: 'Thank you for your feedback!'
            }
          }
        }
      }
    };

    vi.spyOn(tenantConfigService, 'getConfig').mockResolvedValue(operationalConfig);

    const activeSession = {
      id: 'sess-op',
      conversationId: 'conv-123',
      workflowId: 'feedback_survey',
      stateId: 'rating',
      stateHistory: [],
      collectedData: {},
      contextData: { _started: true },
      status: 'ACTIVE'
    };

    const mockConv = {
      id: 'conv-123',
      tenantId,
      customerId,
      accountId,
      status: 'ACTIVE',
      contextData: {},
      messageCount: 1,
      postCompletionQuestionCount: 0,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    vi.spyOn(conversationService, 'getOrCreateConversation').mockResolvedValue(mockConv as any);
    vi.spyOn(conversationService, 'getActiveSession').mockResolvedValue(activeSession as any);
    vi.spyOn(conversationService, 'commitConversationTurn').mockResolvedValue(mockConv as any);

    const upsertSpy = vi.spyOn(crmService, 'upsertLead');

    const response = await conversationEngine.handleMessage(tenantId, customerId, '1', accountId);
    expect(response).toBe('Thank you for your feedback!');
    expect(upsertSpy).not.toHaveBeenCalled();
  });
});
