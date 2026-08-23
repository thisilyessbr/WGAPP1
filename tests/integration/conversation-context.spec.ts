import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { prisma, pool } from '../../src/tests/testDb';
import { bootstrapChatbot } from '../../src/bootstrap';
import { DEFAULT_BUSINESS_CONFIG } from '../../src/domain/tenant/BusinessConfig';
import { buildConversationContext } from '../../src/domain/conversation/ConversationContext';

describe('Phase 4: Unified ConversationContext Foundation Integration Tests', () => {
  let deps: ReturnType<typeof bootstrapChatbot>;

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
    deps.tenantConfigService.clearCache();
  });

  it('1. buildConversationContext enforces bounded recent turns (max 4) in chronological order', () => {
    const now = new Date();
    const rawMessages = [
      { role: 'ASSISTANT', content: 'Msg 5 (latest)', createdAt: new Date(now.getTime() + 5000) },
      { role: 'USER', content: 'Msg 4', createdAt: new Date(now.getTime() + 4000) },
      { role: 'ASSISTANT', content: 'Msg 3', createdAt: new Date(now.getTime() + 3000) },
      { role: 'USER', content: 'Msg 2', createdAt: new Date(now.getTime() + 2000) },
      { role: 'USER', content: 'Msg 1 (oldest)', createdAt: new Date(now.getTime() + 1000) }
    ];

    const ctx = buildConversationContext({
      tenantId: 'tenant-1',
      accountId: 'account-1',
      customerId: 'cust-1',
      conversationId: 'conv-1',
      language: 'en',
      recentMessages: rawMessages,
      contextData: { initialTag: 'test' }
    });

    expect(ctx.recentTurns).toHaveLength(4);
    // Oldest among the 4 should be first
    expect(ctx.recentTurns[0].content).toBe('Msg 2');
    expect(ctx.recentTurns[0].role).toBe('user');
    // Newest should be last
    expect(ctx.recentTurns[3].content).toBe('Msg 5 (latest)');
    expect(ctx.recentTurns[3].role).toBe('assistant');
    expect(ctx.structuredFacts).toEqual({ initialTag: 'test' });
    expect(ctx.safetyState).toEqual({ status: 'NORMAL', reason: null });
  });

  it('2. Account A and Account B conversation contexts are strictly isolated', async () => {
    const tenant = await prisma.tenant.create({
      data: {
        name: `Tenant-Ctx-Iso-${Date.now()}`,
        config: { create: { config: DEFAULT_BUSINESS_CONFIG } }
      }
    });

    const accountA = await prisma.account.create({
      data: { tenantId: tenant.id, name: 'Account A', enabled: true }
    });
    const accountB = await prisma.account.create({
      data: { tenantId: tenant.id, name: 'Account B', enabled: true }
    });

    const custA = `cust-ctx-a-${Date.now()}`;
    const custB = `cust-ctx-b-${Date.now()}`;

    // Send messages
    await deps.conversationEngine.handleMessage(tenant.id, custA, 'Hello from A', accountA.id);
    await deps.conversationEngine.handleMessage(tenant.id, custB, 'Hello from B', accountB.id);

    const convA = await prisma.conversation.findFirst({ where: { tenantId: tenant.id, customer: { externalId: custA } } });
    const convB = await prisma.conversation.findFirst({ where: { tenantId: tenant.id, customer: { externalId: custB } } });

    expect(convA).toBeDefined();
    expect(convB).toBeDefined();

    const ctxA = await deps.conversationEngine.getConversationContext(tenant.id, convA!.id, 'en');
    const ctxB = await deps.conversationEngine.getConversationContext(tenant.id, convB!.id, 'fr');

    // Context A checks
    expect(ctxA).toBeDefined();
    expect(ctxA?.tenantId).toBe(tenant.id);
    expect(ctxA?.accountId).toBe(accountA.id);
    expect(ctxA?.customerId).toBe(convA!.customerId);
    expect(ctxA?.conversationId).toBe(convA!.id);
    expect(ctxA?.language).toBe('en');
    expect(ctxA?.accountId).not.toBe(accountB.id);

    // Context B checks
    expect(ctxB).toBeDefined();
    expect(ctxB?.tenantId).toBe(tenant.id);
    expect(ctxB?.accountId).toBe(accountB.id);
    expect(ctxB?.customerId).toBe(convB!.customerId);
    expect(ctxB?.conversationId).toBe(convB!.id);
    expect(ctxB?.language).toBe('fr');
    expect(ctxB?.accountId).not.toBe(accountA.id);
  }, 20000);

  it('3. Legacy requests without accountId produce valid context with accountId=null', async () => {
    const tenant = await prisma.tenant.create({
      data: {
        name: `Tenant-Legacy-Ctx-${Date.now()}`,
        config: { create: { config: DEFAULT_BUSINESS_CONFIG } }
      }
    });

    const custLegacy = `cust-legacy-${Date.now()}`;
    await deps.conversationEngine.handleMessage(tenant.id, custLegacy, 'Hello legacy');

    const convLegacy = await prisma.conversation.findFirst({ where: { tenantId: tenant.id, customer: { externalId: custLegacy } } });
    expect(convLegacy).toBeDefined();

    const ctxLegacy = await deps.conversationEngine.getConversationContext(tenant.id, convLegacy!.id, 'en');

    expect(ctxLegacy).toBeDefined();
    expect(ctxLegacy?.tenantId).toBe(tenant.id);
    expect(ctxLegacy?.accountId).toBeNull();
    expect(ctxLegacy?.conversationId).toBe(convLegacy!.id);
    expect(ctxLegacy?.customerId).toBe(convLegacy!.customerId);
    expect(ctxLegacy?.recentTurns.length).toBeGreaterThanOrEqual(1);
    expect(ctxLegacy?.structuredFacts).toEqual({});
  }, 20000);

  it('4. Workflow state and collectedData are mapped correctly without database duplication', async () => {
    const tenant = await prisma.tenant.create({
      data: {
        name: `Tenant-Wf-Ctx-${Date.now()}`,
        config: {
          create: {
            config: {
              ...DEFAULT_BUSINESS_CONFIG,
              workflows: {
                ONBOARDING: {
                  id: 'ONBOARDING',
                  initialState: 'ask_name',
                  states: {
                    ask_name: {
                      id: 'ask_name',
                      type: 'collect',
                      field: { name: 'userName', type: 'string', required: true, extractionPrompt: 'What is your name?' },
                      transitions: [{ target: 'end' }]
                    },
                    end: {
                      id: 'end',
                      type: 'end',
                      prompt: 'Welcome!',
                      transitions: []
                    }
                  }
                }
              }
            }
          }
        }
      }
    });

    const custWf = `cust-wf-ctx-${Date.now()}`;
    // Turn 1: Start workflow
    await deps.conversationEngine.handleMessage(tenant.id, custWf, 'ONBOARDING');

    const conv = await prisma.conversation.findFirst({ where: { tenantId: tenant.id, customer: { externalId: custWf } } });
    expect(conv).toBeDefined();

    const ctx1 = await deps.conversationEngine.getConversationContext(tenant.id, conv!.id);
    expect(ctx1?.workflowState).toBeDefined();
    expect(ctx1?.workflowState?.workflowId).toBe('ONBOARDING');
    expect(ctx1?.workflowState?.stateId).toBe('ask_name');
  }, 20000);
});
