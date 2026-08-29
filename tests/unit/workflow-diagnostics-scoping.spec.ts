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

describe('Workflow Diagnostics & Session Scoping (PHASE WORKFLOW-DIAGNOSTICS-AUDIT-24)', () => {
  let mockPrisma: any;
  let conversationService: ConversationService;
  let tenantConfigService: TenantConfigService;
  let conversationEngine: ConversationEngine;
  let mockLlm: LLMMockProvider;

  const tenantId = 'atlas-fitness';
  const accountId = '654c035f-e1c5-4f3c-83fe-05c7ceef4855';

  const fitnessConfig: BusinessConfig = {
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

  beforeEach(() => {
    customers = [];
    conversations = [];
    sessions = [];
    messages = [];

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
          if (where.id === accountId) {
            return { id: accountId, tenantId, name: 'Main Store' };
          }
          return null;
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
        upsert: vi.fn().mockResolvedValue({ id: 'lead-1', status: 'NEW' })
      }
    };

    tenantConfigService = new TenantConfigService(mockPrisma);
    vi.spyOn(tenantConfigService, 'getConfig').mockResolvedValue(fitnessConfig);

    conversationService = new ConversationService(mockPrisma);
    const crmService = new CRMService(mockPrisma);
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

  // Helper function simulating the fixed POST /chat diagnostics lookup
  async function resolveDiagnostics(tenantId: string, customerId: string, accountId?: string) {
    const customer = await mockPrisma.customer.findUnique({
      where: { tenantId_externalId: { tenantId, externalId: customerId } }
    });
    const trimmedAccountId = accountId && typeof accountId === 'string' && accountId.trim() ? accountId.trim() : null;
    let conversation: any = null;
    if (customer) {
      const baseWhere: any = {
        tenantId,
        customerId: customer.id,
        ...(trimmedAccountId ? { accountId: trimmedAccountId } : {})
      };
      conversation = await mockPrisma.conversation.findFirst({
        where: {
          ...baseWhere,
          status: { in: ['ACTIVE', 'HANDOFF_REQUESTED', 'HUMAN_ACTIVE'] }
        },
        orderBy: { createdAt: 'desc' }
      });
      if (!conversation) {
        conversation = await mockPrisma.conversation.findFirst({
          where: baseWhere,
          orderBy: { createdAt: 'desc' }
        });
      }
    }

    let activeWorkflowId: string | null = null;
    let activeStateId: string | null = null;
    let activeSessionContext: any = {};
    let sessionCollectedData: any = {};

    if (conversation) {
      const latestSession = await mockPrisma.workflowSession.findFirst({
        where: { conversationId: conversation.id },
        orderBy: { createdAt: 'desc' }
      });

      if (latestSession) {
        activeSessionContext = latestSession.contextData || {};
        sessionCollectedData = latestSession.collectedData || {};

        if (latestSession.status === 'ACTIVE') {
          activeWorkflowId = latestSession.workflowId;
          activeStateId = latestSession.stateId;
        }
      }
    }

    return {
      conversationId: conversation?.id || null,
      workflow: activeWorkflowId || null,
      state: activeStateId || null,
      context: {
        ...(conversation?.contextData || {}),
        ...activeSessionContext,
        _collectedData: sessionCollectedData
      }
    };
  }

  it('1. New customer gets a fresh conversation and workflow start stores workflowId + initial state', async () => {
    const response = await conversationEngine.handleMessage(tenantId, 'new-cust-1', 'I want to book a session', accountId);
    expect(response).toBe('What is your full name?');

    const diag = await resolveDiagnostics(tenantId, 'new-cust-1', accountId);
    expect(diag.conversationId).toBeTruthy();
    expect(diag.workflow).toBe('fitness_consultation');
    expect(diag.state).toBe('collect_name');
    expect(diag.context._collectedData).toEqual({});
  });

  it('2. Next workflow turn advances state and diagnostics reports the updated active state and collected data', async () => {
    // Turn 1
    await conversationEngine.handleMessage(tenantId, 'adv-cust', 'I want to book a session', accountId);
    // Turn 2
    const response2 = await conversationEngine.handleMessage(tenantId, 'adv-cust', 'Ilyes Saber', accountId);
    expect(response2).toBe('Please provide your phone number:');

    const diag = await resolveDiagnostics(tenantId, 'adv-cust', accountId);
    expect(diag.workflow).toBe('fitness_consultation');
    expect(diag.state).toBe('collect_phone');
    expect(diag.context.userName).toBe('Ilyes Saber');
    expect(diag.context._collectedData.userName).toBe('Ilyes Saber');
  });

  it('3. Old customer collectedData does not appear in a new customer diagnostics even with same account', async () => {
    // Customer 1 completes workflow
    await conversationEngine.handleMessage(tenantId, 'cust-old', 'I want to book a session', accountId);
    await conversationEngine.handleMessage(tenantId, 'cust-old', 'Old User', accountId);
    await conversationEngine.handleMessage(tenantId, 'cust-old', '+212600000000', accountId);

    // Customer 2 starts fresh
    await conversationEngine.handleMessage(tenantId, 'cust-new', 'I want to book a session', accountId);
    await conversationEngine.handleMessage(tenantId, 'cust-new', 'New User', accountId);

    const diagNew = await resolveDiagnostics(tenantId, 'cust-new', accountId);
    expect(diagNew.workflow).toBe('fitness_consultation');
    expect(diagNew.state).toBe('collect_phone');
    expect(diagNew.context.userName).toBe('New User');
    expect(diagNew.context.userName).not.toBe('Old User');
    expect(diagNew.context.phone).toBeUndefined();
  });

  it('4. Diagnostics is correctly scoped to accountId and does not pick up stale un-scoped conversations', async () => {
    // Setup stale conversation with accountId: null for customer "manual-A"
    const custA = await mockPrisma.customer.upsert({
      where: { tenantId_externalId: { tenantId, externalId: 'manual-A' } },
      create: { tenantId, externalId: 'manual-A' }
    });
    const oldConv = await mockPrisma.conversation.create({
      data: {
        tenantId,
        customerId: custA.id,
        accountId: null,
        status: 'ACTIVE',
        contextData: { userName: 'Old Darija Name', phone: '0608466543' }
      }
    });
    await mockPrisma.workflowSession.create({
      data: {
        tenantId,
        conversationId: oldConv.id,
        workflowId: 'fitness_consultation',
        stateId: 'end_step',
        status: 'COMPLETED',
        collectedData: { userName: 'Old Darija Name' }
      }
    });

    // Now user interacts with accountId
    await conversationEngine.handleMessage(tenantId, 'manual-A', 'I want to book a session', accountId);
    await conversationEngine.handleMessage(tenantId, 'manual-A', 'Ilyes Saber', accountId);

    const diag = await resolveDiagnostics(tenantId, 'manual-A', accountId);
    expect(diag.conversationId).not.toBe(oldConv.id);
    expect(diag.workflow).toBe('fitness_consultation');
    expect(diag.state).toBe('collect_phone');
    expect(diag.context.userName).toBe('Ilyes Saber');
    expect(diag.context.userName).not.toBe('Old Darija Name');
  });

  it('5. Completing a workflow clears active workflow state in diagnostics but preserves historical collectedData', async () => {
    await conversationEngine.handleMessage(tenantId, 'cust-complete', 'I want to book a session', accountId);
    await conversationEngine.handleMessage(tenantId, 'cust-complete', 'John Doe', accountId);
    const finishMsg = await conversationEngine.handleMessage(tenantId, 'cust-complete', '+212612345678', accountId);
    expect(finishMsg).toContain('Thank you John Doe! Your session is booked.');

    const diag = await resolveDiagnostics(tenantId, 'cust-complete', accountId);
    // When completed, active workflow is null
    expect(diag.workflow).toBeNull();
    expect(diag.state).toBeNull();
    // Historical collectedData is preserved
    expect(diag.context.userName).toBe('John Doe');
    expect(diag.context.phone).toBe('+212612345678');
    expect(diag.context._collectedData.userName).toBe('John Doe');
  });
});
