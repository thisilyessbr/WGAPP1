import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { prisma, pool } from '../../src/tests/testDb';
import { bootstrapChatbot } from '../../src/bootstrap';
import { DEFAULT_BUSINESS_CONFIG, BusinessConfig } from '../../src/domain/tenant/BusinessConfig';
import { LLMMockProvider } from '../../src/core/llm/LLMProvider';

describe('Workflow Execution Limit Manual Runtime Verification (Directive 11)', () => {
  let deps: ReturnType<typeof bootstrapChatbot>;
  let mockLlm: LLMMockProvider;
  const tenantId = 'atlas-fitness';
  let accountId: string;

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

    // Ensure tenant and account exist
    await prisma.tenant.upsert({
      where: { id: tenantId },
      create: { id: tenantId, name: 'Atlas Fitness' },
      update: {}
    });

    const account = await prisma.account.findFirst({ where: { tenantId } });
    if (account) {
      accountId = account.id;
    } else {
      const created = await prisma.account.create({
        data: { tenantId, name: 'Main Gym', enabled: true }
      });
      accountId = created.id;
    }
  });

  it('verifies once limit, blocking, CRM lead creation, and unlimited switch against real PostgreSQL test DB', async () => {
    const customerExtId = `runtime-cust-${Date.now()}`;
    mockLlm.intentMock = 'fitness_consultation';

    const onceConfig: BusinessConfig = {
      ...DEFAULT_BUSINESS_CONFIG,
      llm: {
        provider: 'mock',
        model: 'mock-model',
        temperature: 0,
        maxTokens: 500,
        timeoutMs: 5000
      },
      capabilities: {
        ...DEFAULT_BUSINESS_CONFIG.capabilities,
        ecommerceEnabled: false,
        intents: [
          {
            id: 'fitness_consultation',
            description: 'Book a free fitness consultation',
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
          executionLimit: {
            mode: 'once',
            maxExecutions: 1,
            limitReachedMessage: 'You have already booked your initial consultation.'
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

    deps.tenantConfigService.getConfig = async () => onceConfig;

    // --- Step 1: Trigger and Complete Run 1 ---
    const t1 = await deps.conversationEngine.handleMessage(tenantId, customerExtId, 'I want to book a session', accountId);
    expect(t1).toBe('What is your full name?');
    const t2 = await deps.conversationEngine.handleMessage(tenantId, customerExtId, 'Ilyes Saber', accountId);
    expect(t2).toBe('Please provide your phone number:');
    const t3 = await deps.conversationEngine.handleMessage(tenantId, customerExtId, '+212612345678', accountId);
    expect(t3).toContain('Thank you Ilyes Saber! Your session is booked.');

    // Verify 1 completed session in database
    const completedCount1 = await deps.conversationService.countCompletedWorkflowSessions(
      tenantId,
      customerExtId,
      'fitness_consultation',
      accountId
    );
    expect(completedCount1).toBe(1);

    // Verify CRM Lead created
    const customer = await prisma.customer.findFirst({ where: { tenantId, externalId: customerExtId } });
    expect(customer).toBeTruthy();
    const lead = await prisma.lead.findFirst({ where: { tenantId, accountId, customerId: customer!.id } });
    expect(lead).toBeTruthy();
    expect(lead?.status).toBe('NEW');

    // --- Step 2: Trigger Again -> Blocked ---
    const tBlocked = await deps.conversationEngine.handleMessage(tenantId, customerExtId, 'I want to book a session', accountId);
    expect(tBlocked).toBe('You have already booked your initial consultation.');

    // Verify count in DB remains 1
    const completedCountAfterBlock = await deps.conversationService.countCompletedWorkflowSessions(
      tenantId,
      customerExtId,
      'fitness_consultation',
      accountId
    );
    expect(completedCountAfterBlock).toBe(1);

    // --- Step 3: Change to Unlimited -> Should allow next completion ---
    const unlimConfig: BusinessConfig = {
      ...onceConfig,
      workflows: {
        fitness_consultation: {
          ...onceConfig.workflows.fitness_consultation,
          executionLimit: { mode: 'unlimited' }
        }
      }
    };
    deps.tenantConfigService.getConfig = async () => unlimConfig;

    const tUnlim1 = await deps.conversationEngine.handleMessage(tenantId, customerExtId, 'I want to book a session', accountId);
    expect(tUnlim1).toBe('What is your full name?');
    const tUnlim2 = await deps.conversationEngine.handleMessage(tenantId, customerExtId, 'Ilyes Saber 2', accountId);
    expect(tUnlim2).toBe('Please provide your phone number:');
    const tUnlim3 = await deps.conversationEngine.handleMessage(tenantId, customerExtId, '+212687654321', accountId);
    expect(tUnlim3).toContain('Thank you Ilyes Saber 2! Your session is booked.');

    const completedCountFinal = await deps.conversationService.countCompletedWorkflowSessions(
      tenantId,
      customerExtId,
      'fitness_consultation',
      accountId
    );
    expect(completedCountFinal).toBe(2);
  }, 30000);
});
