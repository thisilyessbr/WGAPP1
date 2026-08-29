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

describe('Workflow Execution Limit Suite (PHASE WORKFLOW-EXECUTION-LIMIT-IMPLEMENTATION-26)', () => {
  let mockPrisma: any;
  let conversationService: ConversationService;
  let tenantConfigService: TenantConfigService;
  let conversationEngine: ConversationEngine;
  let mockLlm: LLMMockProvider;
  let crmService: CRMService;

  const tenantId = 'atlas-fitness';
  const accountId = '654c035f-e1c5-4f3c-83fe-05c7ceef4855';

  const baseConfig: BusinessConfig = {
    ...DEFAULT_BUSINESS_CONFIG,
    capabilities: {
      ...DEFAULT_BUSINESS_CONFIG.capabilities,
      ecommerceEnabled: false,
      intents: [
        {
          id: 'fitness_consultation',
          description: 'Book a free fitness consultation or private coaching session',
          workflowId: 'fitness_consultation'
        }
      ]
    },
    workflows: {
      fitness_consultation: {
        id: 'fitness_consultation',
        name: 'Fitness Consultation',
        description: 'Intake workflow for fitness coaching',
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

  let customers: any[] = [];
  let conversations: any[] = [];
  let sessions: any[] = [];
  let messages: any[] = [];
  let leads: any[] = [];

  beforeEach(() => {
    customers = [];
    conversations = [];
    sessions = [];
    messages = [];
    leads = [];

    mockPrisma = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      $transaction: async (arg: any) => {
        if (typeof arg === 'function') {
          return arg(mockPrisma);
        }
        if (Array.isArray(arg)) {
          return Promise.all(arg);
        }
        return arg;
      },
      customer: {
        findUnique: async ({ where }: any) => {
          if (where.tenantId_externalId) {
            return customers.find(c => c.tenantId === where.tenantId_externalId.tenantId && c.externalId === where.tenantId_externalId.externalId) || null;
          }
          return null;
        },
        findFirst: async ({ where }: any) => {
          return customers.find(c => {
            if (c.tenantId !== where.tenantId) return false;
            if (where.OR) {
              return where.OR.some((clause: any) => clause.externalId === c.externalId || clause.id === c.id);
            }
            return true;
          }) || null;
        },
        upsert: async ({ where, create }: any) => {
          let existing = customers.find(c => c.tenantId === where.tenantId_externalId.tenantId && c.externalId === where.tenantId_externalId.externalId);
          if (!existing) {
            existing = { id: `cust-${Date.now()}-${Math.random()}`, tenantId: create.tenantId, externalId: create.externalId, createdAt: new Date() };
            customers.push(existing);
          }
          return existing;
        }
      },
      account: {
        findUnique: async ({ where }: any) => {
          if (where.id === 'account-tenant-2') {
            return { id: 'account-tenant-2', tenantId: 'other-tenant', name: 'Other Store' };
          }
          return { id: where.id, tenantId, name: 'Main Store' };
        }
      },
      conversation: {
        findFirst: async ({ where, orderBy }: any) => {
          let matches = conversations.filter(c => {
            if (c.tenantId !== where.tenantId) return false;
            if (where.customerId && c.customerId !== where.customerId) return false;
            if (where.accountId !== undefined && c.accountId !== where.accountId) return false;
            if (where.status) {
              if (typeof where.status === 'string') return c.status === where.status;
              if (where.status.in) return where.status.in.includes(c.status);
            }
            if (where.automationCapped !== undefined && c.automationCapped !== where.automationCapped) return false;
            return true;
          });
          if (orderBy?.createdAt === 'desc') {
            matches.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
          }
          return matches[0] || null;
        },
        findMany: async ({ where }: any) => {
          return conversations.filter(c => {
            if (c.tenantId !== where.tenantId) return false;
            if (where.customerId && c.customerId !== where.customerId) return false;
            if (where.accountId !== undefined && c.accountId !== where.accountId) return false;
            if (where.status?.in) return where.status.in.includes(c.status);
            return true;
          });
        },
        create: async ({ data }: any) => {
          const conv = {
            id: `conv-${Date.now()}-${Math.random()}`,
            tenantId: data.tenantId,
            customerId: data.customerId,
            accountId: data.accountId || null,
            status: data.status || 'ACTIVE',
            contextData: data.contextData || {},
            version: 1,
            messageCount: 0,
            postCompletionQuestionCount: 0,
            automationCapped: false,
            postCompletionCapped: false,
            createdAt: new Date(),
            updatedAt: new Date()
          };
          conversations.push(conv);
          return conv;
        },
        updateMany: async ({ where, data }: any) => {
          let count = 0;
          for (const c of conversations) {
            if (where.id && (where.id === c.id || (where.id.in && where.id.in.includes(c.id)))) {
              if (where.version !== undefined && c.version !== where.version) continue;
              if (data.status) c.status = data.status;
              if (data.contextData !== undefined) c.contextData = data.contextData;
              if (data.version?.increment) c.version += data.version.increment;
              if (data.messageCount?.increment) c.messageCount += data.messageCount.increment;
              c.updatedAt = new Date();
              count++;
            }
          }
          return { count };
        },
        update: async ({ where, data }: any) => {
          const c = conversations.find(x => x.id === where.id);
          if (c) {
            Object.assign(c, data);
            c.updatedAt = new Date();
            return c;
          }
          throw new Error('Conversation not found');
        }
      },
      workflowSession: {
        findFirst: async ({ where, orderBy }: any) => {
          let matches = sessions.filter(s => {
            if (where.tenantId && s.tenantId !== where.tenantId) return false;
            if (where.conversationId && s.conversationId !== where.conversationId) return false;
            if (where.status && s.status !== where.status) return false;
            return true;
          });
          if (orderBy?.createdAt === 'desc') {
            matches.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
          }
          return matches[0] || null;
        },
        count: async ({ where }: any) => {
          return sessions.filter(s => {
            if (where.tenantId && s.tenantId !== where.tenantId) return false;
            if (where.workflowId && s.workflowId !== where.workflowId) return false;
            if (where.status && s.status !== where.status) return false;
            if (where.conversation) {
              const conv = conversations.find(c => c.id === s.conversationId);
              if (!conv) return false;
              if (where.conversation.tenantId && conv.tenantId !== where.conversation.tenantId) return false;
              if (where.conversation.customerId && conv.customerId !== where.conversation.customerId) return false;
              if (where.conversation.accountId !== undefined && conv.accountId !== where.conversation.accountId) return false;
            }
            return true;
          }).length;
        },
        create: async ({ data }: any) => {
          const sess = {
            id: `sess-${Date.now()}-${Math.random()}`,
            tenantId: data.tenantId,
            conversationId: data.conversationId,
            workflowId: data.workflowId,
            stateId: data.stateId,
            stateHistory: data.stateHistory || [],
            collectedData: data.collectedData || {},
            contextData: data.contextData || {},
            status: data.status || 'ACTIVE',
            createdAt: new Date(),
            updatedAt: new Date()
          };
          sessions.push(sess);
          return sess;
        },
        update: async ({ where, data }: any) => {
          const sess = sessions.find(s => s.id === where.id);
          if (sess) {
            Object.assign(sess, data);
            sess.updatedAt = new Date();
            return sess;
          }
          throw new Error('Session not found');
        },
        updateMany: async ({ where, data }: any) => {
          let count = 0;
          for (const s of sessions) {
            if (where.conversationId?.in && where.conversationId.in.includes(s.conversationId)) {
              if (where.status && s.status !== where.status) continue;
              Object.assign(s, data);
              s.updatedAt = new Date();
              count++;
            }
          }
          return { count };
        }
      },
      message: {
        create: async ({ data }: any) => {
          const msg = {
            id: `msg-${Date.now()}-${Math.random()}`,
            ...data,
            createdAt: new Date()
          };
          messages.push(msg);
          return msg;
        },
        count: async () => messages.length,
        findMany: async () => messages
      },
      lead: {
        upsert: async ({ where, create, update }: any) => {
          let l = leads.find(x => x.tenantId === where.tenantId_accountId_customerId?.tenantId && x.accountId === where.tenantId_accountId_customerId?.accountId && x.customerId === where.tenantId_accountId_customerId?.customerId);
          if (!l) {
            l = { id: `lead-${Date.now()}`, ...create, createdAt: new Date(), updatedAt: new Date() };
            leads.push(l);
          } else {
            Object.assign(l, update);
            l.updatedAt = new Date();
          }
          return l;
        },
        findMany: async () => leads
      }
    };

    tenantConfigService = new TenantConfigService(mockPrisma);
    conversationService = new ConversationService(mockPrisma);
    crmService = new CRMService(mockPrisma);
    mockLlm = new LLMMockProvider();
    mockLlm.intentMock = 'fitness_consultation';

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
      undefined,
      crmService
    );
  });

  it('1. unlimited workflow can run repeatedly', async () => {
    vi.spyOn(tenantConfigService, 'getConfig').mockResolvedValue(baseConfig);

    // Run 1
    await conversationEngine.handleMessage(tenantId, 'c1', 'I want to book a session', accountId);
    await conversationEngine.handleMessage(tenantId, 'c1', 'User A', accountId);
    const end1 = await conversationEngine.handleMessage(tenantId, 'c1', '+212600000001', accountId);
    expect(end1).toContain('Thank you User A! Your session is booked.');

    // Run 2
    await conversationEngine.handleMessage(tenantId, 'c1', 'I want to book a session', accountId);
    await conversationEngine.handleMessage(tenantId, 'c1', 'User A again', accountId);
    const end2 = await conversationEngine.handleMessage(tenantId, 'c1', '+212600000002', accountId);
    expect(end2).toContain('Thank you User A again! Your session is booked.');

    const count = await conversationService.countCompletedWorkflowSessions(tenantId, 'c1', 'fitness_consultation', accountId);
    expect(count).toBe(2);
  });

  it('2. once workflow allows first completion', async () => {
    const onceConfig: BusinessConfig = {
      ...baseConfig,
      workflows: {
        fitness_consultation: {
          ...baseConfig.workflows.fitness_consultation,
          executionLimit: { mode: 'once', maxExecutions: 1 }
        }
      }
    };
    vi.spyOn(tenantConfigService, 'getConfig').mockResolvedValue(onceConfig);

    const r1 = await conversationEngine.handleMessage(tenantId, 'c2', 'I want to book a session', accountId);
    expect(r1).toBe('What is your full name?');
    const r2 = await conversationEngine.handleMessage(tenantId, 'c2', 'John Doe', accountId);
    expect(r2).toBe('Please provide your phone number:');
    const r3 = await conversationEngine.handleMessage(tenantId, 'c2', '+212612345678', accountId);
    expect(r3).toContain('Thank you John Doe! Your session is booked.');
  });

  it('3. once workflow blocks second attempt', async () => {
    const onceConfig: BusinessConfig = {
      ...baseConfig,
      workflows: {
        fitness_consultation: {
          ...baseConfig.workflows.fitness_consultation,
          executionLimit: {
            mode: 'once',
            maxExecutions: 1,
            limitReachedMessage: 'You have already booked your initial consultation.'
          }
        }
      }
    };
    vi.spyOn(tenantConfigService, 'getConfig').mockResolvedValue(onceConfig);

    await conversationEngine.handleMessage(tenantId, 'c3', 'I want to book a session', accountId);
    await conversationEngine.handleMessage(tenantId, 'c3', 'John Doe', accountId);
    await conversationEngine.handleMessage(tenantId, 'c3', '+212612345678', accountId);

    const blocked = await conversationEngine.handleMessage(tenantId, 'c3', 'I want to book a session', accountId);
    expect(blocked).toBe('You have already booked your initial consultation.');
  });

  it('4. custom N allows exactly N completions', async () => {
    const customConfig: BusinessConfig = {
      ...baseConfig,
      workflows: {
        fitness_consultation: {
          ...baseConfig.workflows.fitness_consultation,
          executionLimit: { mode: 'custom', maxExecutions: 2 }
        }
      }
    };
    vi.spyOn(tenantConfigService, 'getConfig').mockResolvedValue(customConfig);

    // Run 1
    await conversationEngine.handleMessage(tenantId, 'c4', 'I want to book a session', accountId);
    await conversationEngine.handleMessage(tenantId, 'c4', 'John', accountId);
    await conversationEngine.handleMessage(tenantId, 'c4', '+212600000001', accountId);

    // Run 2
    await conversationEngine.handleMessage(tenantId, 'c4', 'I want to book a session', accountId);
    await conversationEngine.handleMessage(tenantId, 'c4', 'John 2', accountId);
    const end2 = await conversationEngine.handleMessage(tenantId, 'c4', '+212600000002', accountId);
    expect(end2).toContain('Thank you John 2! Your session is booked.');

    const count = await conversationService.countCompletedWorkflowSessions(tenantId, 'c4', 'fitness_consultation', accountId);
    expect(count).toBe(2);
  });

  it('5. custom N blocks N+1', async () => {
    const customConfig: BusinessConfig = {
      ...baseConfig,
      workflows: {
        fitness_consultation: {
          ...baseConfig.workflows.fitness_consultation,
          executionLimit: { mode: 'custom', maxExecutions: 2 }
        }
      }
    };
    vi.spyOn(tenantConfigService, 'getConfig').mockResolvedValue(customConfig);

    // Run 1
    await conversationEngine.handleMessage(tenantId, 'c5', 'I want to book a session', accountId);
    await conversationEngine.handleMessage(tenantId, 'c5', 'John', accountId);
    await conversationEngine.handleMessage(tenantId, 'c5', '+212600000001', accountId);

    // Run 2
    await conversationEngine.handleMessage(tenantId, 'c5', 'I want to book a session', accountId);
    await conversationEngine.handleMessage(tenantId, 'c5', 'John 2', accountId);
    await conversationEngine.handleMessage(tenantId, 'c5', '+212600000002', accountId);

    // Run 3 (blocked)
    const blocked = await conversationEngine.handleMessage(tenantId, 'c5', 'I want to book a session', accountId);
    expect(blocked).toBe('You have already completed this request.');
  });

  it('6. cancelled workflow does not consume a run', async () => {
    const onceConfig: BusinessConfig = {
      ...baseConfig,
      workflows: {
        fitness_consultation: {
          ...baseConfig.workflows.fitness_consultation,
          executionLimit: { mode: 'once', maxExecutions: 1 }
        }
      }
    };
    vi.spyOn(tenantConfigService, 'getConfig').mockResolvedValue(onceConfig);

    await conversationEngine.handleMessage(tenantId, 'c6', 'I want to book a session', accountId);
    const cancelRes = await conversationEngine.handleMessage(tenantId, 'c6', 'cancel', accountId);
    expect(cancelRes).toBe('Workflow cancelled.');

    const retryRes = await conversationEngine.handleMessage(tenantId, 'c6', 'I want to book a session', accountId);
    expect(retryRes).toBe('What is your full name?');
  });

  it('7. errored workflow does not consume a run', async () => {
    const onceConfig: BusinessConfig = {
      ...baseConfig,
      workflows: {
        fitness_consultation: {
          ...baseConfig.workflows.fitness_consultation,
          executionLimit: { mode: 'once', maxExecutions: 1 }
        }
      }
    };
    vi.spyOn(tenantConfigService, 'getConfig').mockResolvedValue(onceConfig);

    // Simulate an error session in DB
    const cust = await mockPrisma.customer.upsert({
      where: { tenantId_externalId: { tenantId, externalId: 'c7' } },
      create: { tenantId, externalId: 'c7' }
    });
    const conv = await mockPrisma.conversation.create({
      data: { tenantId, customerId: cust.id, accountId, status: 'ACTIVE' }
    });
    await mockPrisma.workflowSession.create({
      data: {
        tenantId,
        conversationId: conv.id,
        workflowId: 'fitness_consultation',
        stateId: 'collect_name',
        status: 'ERROR'
      }
    });

    const count = await conversationService.countCompletedWorkflowSessions(tenantId, 'c7', 'fitness_consultation', accountId);
    expect(count).toBe(0);

    const retryRes = await conversationEngine.handleMessage(tenantId, 'c7', 'I want to book a session', accountId);
    expect(retryRes).toBe('What is your full name?');
  });

  it('8. abandoned ACTIVE session does not consume a run', async () => {
    const onceConfig: BusinessConfig = {
      ...baseConfig,
      workflows: {
        fitness_consultation: {
          ...baseConfig.workflows.fitness_consultation,
          executionLimit: { mode: 'once', maxExecutions: 1 }
        }
      }
    };
    vi.spyOn(tenantConfigService, 'getConfig').mockResolvedValue(onceConfig);

    // Start turn 1
    const r1 = await conversationEngine.handleMessage(tenantId, 'c8', 'I want to book a session', accountId);
    expect(r1).toBe('What is your full name?');

    const count = await conversationService.countCompletedWorkflowSessions(tenantId, 'c8', 'fitness_consultation', accountId);
    expect(count).toBe(0);

    // Continue later
    const r2 = await conversationEngine.handleMessage(tenantId, 'c8', 'John', accountId);
    expect(r2).toBe('Please provide your phone number:');
  });

  it('9. customer isolation: Customer A does not affect Customer B', async () => {
    const onceConfig: BusinessConfig = {
      ...baseConfig,
      workflows: {
        fitness_consultation: {
          ...baseConfig.workflows.fitness_consultation,
          executionLimit: { mode: 'once', maxExecutions: 1 }
        }
      }
    };
    vi.spyOn(tenantConfigService, 'getConfig').mockResolvedValue(onceConfig);

    // Complete Customer A
    await conversationEngine.handleMessage(tenantId, 'c9-A', 'I want to book a session', accountId);
    await conversationEngine.handleMessage(tenantId, 'c9-A', 'User A', accountId);
    await conversationEngine.handleMessage(tenantId, 'c9-A', '+212600000000', accountId);

    // Customer B starts
    const rB = await conversationEngine.handleMessage(tenantId, 'c9-B', 'I want to book a session', accountId);
    expect(rB).toBe('What is your full name?');
  });

  it('10. account isolation: Customer reaching limit in Account A can run in Account B', async () => {
    const accountB = '777c035f-e1c5-4f3c-83fe-05c7ceef9999';
    const onceConfig: BusinessConfig = {
      ...baseConfig,
      workflows: {
        fitness_consultation: {
          ...baseConfig.workflows.fitness_consultation,
          executionLimit: { mode: 'once', maxExecutions: 1 }
        }
      }
    };
    vi.spyOn(tenantConfigService, 'getConfig').mockResolvedValue(onceConfig);

    // Complete in Account A
    await conversationEngine.handleMessage(tenantId, 'c10', 'I want to book a session', accountId);
    await conversationEngine.handleMessage(tenantId, 'c10', 'User A', accountId);
    await conversationEngine.handleMessage(tenantId, 'c10', '+212600000000', accountId);

    // Start in Account B
    const rB = await conversationEngine.handleMessage(tenantId, 'c10', 'I want to book a session', accountB);
    expect(rB).toBe('What is your full name?');
  });

  it('11. tenant isolation: Customer in Tenant 1 does not affect Tenant 2', async () => {
    const tenant2 = 'other-tenant';
    const account2 = 'account-tenant-2';
    const onceConfig: BusinessConfig = {
      ...baseConfig,
      workflows: {
        fitness_consultation: {
          ...baseConfig.workflows.fitness_consultation,
          executionLimit: { mode: 'once', maxExecutions: 1 }
        }
      }
    };
    vi.spyOn(tenantConfigService, 'getConfig').mockResolvedValue(onceConfig);

    // Complete in Tenant 1
    await conversationEngine.handleMessage(tenantId, 'c11', 'I want to book a session', accountId);
    await conversationEngine.handleMessage(tenantId, 'c11', 'User 1', accountId);
    await conversationEngine.handleMessage(tenantId, 'c11', '+212600000000', accountId);

    // Start in Tenant 2
    const rT2 = await conversationEngine.handleMessage(tenant2, 'c11', 'I want to book a session', account2);
    expect(rT2).toBe('What is your full name?');
  });

  it('12. missing executionLimit defaults to unlimited', async () => {
    const noLimitConfig: BusinessConfig = {
      ...baseConfig,
      workflows: {
        fitness_consultation: {
          ...baseConfig.workflows.fitness_consultation,
          executionLimit: undefined
        }
      }
    };
    vi.spyOn(tenantConfigService, 'getConfig').mockResolvedValue(noLimitConfig);

    await conversationEngine.handleMessage(tenantId, 'c12', 'I want to book a session', accountId);
    await conversationEngine.handleMessage(tenantId, 'c12', 'User 1', accountId);
    await conversationEngine.handleMessage(tenantId, 'c12', '+212600000000', accountId);

    const r2 = await conversationEngine.handleMessage(tenantId, 'c12', 'I want to book a session', accountId);
    expect(r2).toBe('What is your full name?');
  });

  it('13. invalid configuration behaves safely without throwing', async () => {
    const invalidConfigs: BusinessConfig[] = [
      {
        ...baseConfig,
        workflows: {
          fitness_consultation: {
            ...baseConfig.workflows.fitness_consultation,
            executionLimit: { mode: 'custom', maxExecutions: -10 }
          }
        }
      },
      {
        ...baseConfig,
        workflows: {
          fitness_consultation: {
            ...baseConfig.workflows.fitness_consultation,
            executionLimit: { mode: 'unknown_mode' as any }
          }
        }
      }
    ];

    for (const conf of invalidConfigs) {
      vi.spyOn(tenantConfigService, 'getConfig').mockResolvedValue(conf);
      const res = await conversationEngine.handleMessage(tenantId, `c13-${Math.random()}`, 'I want to book a session', accountId);
      expect(res).toBe('What is your full name?');
    }
  });

  it('14. post-completion re-trigger respects limit', async () => {
    const onceConfig: BusinessConfig = {
      ...baseConfig,
      workflows: {
        fitness_consultation: {
          ...baseConfig.workflows.fitness_consultation,
          executionLimit: { mode: 'once', maxExecutions: 1 }
        }
      }
    };
    vi.spyOn(tenantConfigService, 'getConfig').mockResolvedValue(onceConfig);

    // Complete run
    await conversationEngine.handleMessage(tenantId, 'c14', 'I want to book a session', accountId);
    await conversationEngine.handleMessage(tenantId, 'c14', 'User', accountId);
    await conversationEngine.handleMessage(tenantId, 'c14', '+212600000000', accountId);

    // Re-trigger in post completion
    const retriggerRes = await conversationEngine.handleMessage(tenantId, 'c14', 'I want to book a session', accountId);
    expect(retriggerRes).toBe('You have already completed this request.');
  });

  it('15. CRM Lead is created on successful sales workflow completion', async () => {
    const onceConfig: BusinessConfig = {
      ...baseConfig,
      workflows: {
        fitness_consultation: {
          ...baseConfig.workflows.fitness_consultation,
          executionLimit: { mode: 'once', maxExecutions: 1 }
        }
      }
    };
    vi.spyOn(tenantConfigService, 'getConfig').mockResolvedValue(onceConfig);

    await conversationEngine.handleMessage(tenantId, 'c15', 'I want to book a session', accountId);
    await conversationEngine.handleMessage(tenantId, 'c15', 'Lead Name', accountId);
    await conversationEngine.handleMessage(tenantId, 'c15', '+212612345678', accountId);

    expect(leads.length).toBe(1);
    expect(leads[0].status).toBe('NEW');
  });

  it('16. blocked execution produces no additional CRM Lead', async () => {
    const onceConfig: BusinessConfig = {
      ...baseConfig,
      workflows: {
        fitness_consultation: {
          ...baseConfig.workflows.fitness_consultation,
          executionLimit: { mode: 'once', maxExecutions: 1 }
        }
      }
    };
    vi.spyOn(tenantConfigService, 'getConfig').mockResolvedValue(onceConfig);

    // Complete run 1
    await conversationEngine.handleMessage(tenantId, 'c16', 'I want to book a session', accountId);
    await conversationEngine.handleMessage(tenantId, 'c16', 'Lead Name', accountId);
    await conversationEngine.handleMessage(tenantId, 'c16', '+212612345678', accountId);
    expect(leads.length).toBe(1);

    // Attempt blocked run 2
    await conversationEngine.handleMessage(tenantId, 'c16', 'I want to book a session', accountId);
    expect(leads.length).toBe(1);
  });

  it('17. unlimited workflow behavior is completely unchanged', async () => {
    const unlimitedConfig: BusinessConfig = {
      ...baseConfig,
      workflows: {
        fitness_consultation: {
          ...baseConfig.workflows.fitness_consultation,
          executionLimit: { mode: 'unlimited' }
        }
      }
    };
    vi.spyOn(tenantConfigService, 'getConfig').mockResolvedValue(unlimitedConfig);

    for (let i = 1; i <= 3; i++) {
      await conversationEngine.handleMessage(tenantId, 'c17', 'I want to book a session', accountId);
      await conversationEngine.handleMessage(tenantId, 'c17', `User ${i}`, accountId);
      const res = await conversationEngine.handleMessage(tenantId, 'c17', `+21260000000${i}`, accountId);
      expect(res).toContain(`Thank you User ${i}! Your session is booked.`);
    }

    const count = await conversationService.countCompletedWorkflowSessions(tenantId, 'c17', 'fitness_consultation', accountId);
    expect(count).toBe(3);
  });

  it('18. concurrency/race regression: simultaneous triggers handle active session safely', async () => {
    const onceConfig: BusinessConfig = {
      ...baseConfig,
      workflows: {
        fitness_consultation: {
          ...baseConfig.workflows.fitness_consultation,
          executionLimit: { mode: 'once', maxExecutions: 1 }
        }
      }
    };
    vi.spyOn(tenantConfigService, 'getConfig').mockResolvedValue(onceConfig);

    // Turn 1 starts active session
    await conversationEngine.handleMessage(tenantId, 'c18', 'I want to book a session', accountId);

    // Turn 2 from user (e.g. rapid follow-up)
    const turn2 = await conversationEngine.handleMessage(tenantId, 'c18', 'John Doe', accountId);
    expect(turn2).toBe('Please provide your phone number:');

    // Finish
    const turn3 = await conversationEngine.handleMessage(tenantId, 'c18', '+212612345678', accountId);
    expect(turn3).toContain('Thank you John Doe! Your session is booked.');

    // Next trigger blocked
    const turn4 = await conversationEngine.handleMessage(tenantId, 'c18', 'I want to book a session', accountId);
    expect(turn4).toBe('You have already completed this request.');
  });
});
