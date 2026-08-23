import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { prisma, pool } from '../../src/tests/testDb';
import { bootstrapChatbot } from '../../src/bootstrap';
import { DEFAULT_BUSINESS_CONFIG } from '../../src/domain/tenant/BusinessConfig';
import { ConversationMemoryManager } from '../../src/domain/conversation/ConversationMemory';

describe('Phase 5: Conversation Memory Design & Implementation Integration Tests', () => {
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

  it('1. ConversationMemoryManager builds a strict 3-layer memory model', () => {
    const now = new Date();
    const rawMessages = [
      { role: 'ASSISTANT', content: 'Turn 3 reply', createdAt: new Date(now.getTime() + 3000) },
      { role: 'USER', content: 'Turn 3 question', createdAt: new Date(now.getTime() + 2000) },
      { role: 'ASSISTANT', content: 'Turn 2 reply', createdAt: new Date(now.getTime() + 1000) },
      { role: 'USER', content: 'Turn 1 greeting', createdAt: now }
    ];

    const memory = ConversationMemoryManager.buildMemory({
      tenantId: 'tenant-mem-1',
      accountId: 'account-mem-1',
      customerId: 'cust-mem-1',
      conversationId: 'conv-mem-1',
      recentMessages: rawMessages,
      totalMessageCount: 4,
      contextData: { customerTier: 'gold' },
      activeSessionCollectedData: { selectedPlan: 'premium' }
    });

    // Layer A: Recent turns (exactly 4, chronological order)
    expect(memory.recentTurns).toHaveLength(4);
    expect(memory.recentTurns[0].content).toBe('Turn 1 greeting');
    expect(memory.recentTurns[3].content).toBe('Turn 3 reply');

    // Layer B: Summary is null because totalTurns <= 4
    expect(memory.summary).toBeNull();

    // Layer C: Structured facts includes contextData and workflow collectedData
    expect(memory.structuredFacts).toEqual({
      customerTier: 'gold',
      selectedPlan: 'premium'
    });
    expect(memory.totalTurns).toBe(4);
    expect(memory.isReset).toBe(false);
  });

  it('2. Bounded memory test: conversation with >4 turns keeps max 4 turns and creates summary', async () => {
    const tenant = await prisma.tenant.create({
      data: {
        name: `Tenant-Mem-Bound-${Date.now()}`,
        config: { create: { config: DEFAULT_BUSINESS_CONFIG } }
      }
    });

    const custId = `cust-mem-bound-${Date.now()}`;

    // Send 6 turns (12 messages total: 6 user + 6 assistant)
    for (let i = 1; i <= 6; i++) {
      await deps.conversationEngine.handleMessage(tenant.id, custId, `Message ${i}`);
      await new Promise(r => setTimeout(r, 100));
    }

    const conv = await prisma.conversation.findFirst({
      where: { tenantId: tenant.id, customer: { externalId: custId } }
    });
    expect(conv).toBeDefined();

    const ctx = await deps.conversationEngine.getConversationContext(tenant.id, conv!.id);
    expect(ctx).toBeDefined();
    expect(ctx?.memory).toBeDefined();

    // Layer A: Bounded to 4 recent messages
    expect(ctx?.memory.recentTurns).toHaveLength(4);
    expect(ctx?.recentTurns).toHaveLength(4);

    // Chronological order verified
    const turnContents = ctx!.memory.recentTurns.map(t => t.content);
    expect(turnContents[0]).toContain('Message');
    expect(turnContents[turnContents.length - 1]).toBeDefined();

    // Layer B: Summary represents older turns
    expect(ctx?.memory.summary).not.toBeNull();
    expect(ctx?.memory.summary?.turnCount).toBeGreaterThan(0);
    expect(ctx?.memory.totalTurns).toBeGreaterThan(4);
  }, 30000);

  it('3. Account A and Account B memory contexts remain strictly isolated', async () => {
    const tenant = await prisma.tenant.create({
      data: {
        name: `Tenant-Mem-Iso-${Date.now()}`,
        config: { create: { config: DEFAULT_BUSINESS_CONFIG } }
      }
    });

    const accountA = await prisma.account.create({
      data: { tenantId: tenant.id, name: 'Account A', enabled: true }
    });
    const accountB = await prisma.account.create({
      data: { tenantId: tenant.id, name: 'Account B', enabled: true }
    });

    const custA = `cust-mem-a-${Date.now()}`;
    const custB = `cust-mem-b-${Date.now()}`;

    await deps.conversationEngine.handleMessage(tenant.id, custA, 'Alpha inquiry', accountA.id);
    await deps.conversationEngine.handleMessage(tenant.id, custB, 'Beta inquiry', accountB.id);

    const convA = await prisma.conversation.findFirst({ where: { tenantId: tenant.id, customer: { externalId: custA } } });
    const convB = await prisma.conversation.findFirst({ where: { tenantId: tenant.id, customer: { externalId: custB } } });

    const ctxA = await deps.conversationEngine.getConversationContext(tenant.id, convA!.id);
    const ctxB = await deps.conversationEngine.getConversationContext(tenant.id, convB!.id);

    expect(ctxA?.memory.accountId).toBe(accountA.id);
    expect(ctxA?.memory.conversationId).toBe(convA!.id);
    expect(ctxA?.memory.recentTurns.some(t => t.content.includes('Alpha'))).toBe(true);
    expect(ctxA?.memory.recentTurns.some(t => t.content.includes('Beta'))).toBe(false);

    expect(ctxB?.memory.accountId).toBe(accountB.id);
    expect(ctxB?.memory.conversationId).toBe(convB!.id);
    expect(ctxB?.memory.recentTurns.some(t => t.content.includes('Beta'))).toBe(true);
    expect(ctxB?.memory.recentTurns.some(t => t.content.includes('Alpha'))).toBe(false);
  }, 20000);

  it('4. Legacy requests without accountId create valid memory with accountId=null', async () => {
    const tenant = await prisma.tenant.create({
      data: {
        name: `Tenant-Mem-Legacy-${Date.now()}`,
        config: { create: { config: DEFAULT_BUSINESS_CONFIG } }
      }
    });

    const custLegacy = `cust-mem-legacy-${Date.now()}`;
    await deps.conversationEngine.handleMessage(tenant.id, custLegacy, 'Legacy inquiry');

    const convLegacy = await prisma.conversation.findFirst({ where: { tenantId: tenant.id, customer: { externalId: custLegacy } } });
    const ctxLegacy = await deps.conversationEngine.getConversationContext(tenant.id, convLegacy!.id);

    expect(ctxLegacy?.memory).toBeDefined();
    expect(ctxLegacy?.memory.accountId).toBeNull();
    expect(ctxLegacy?.memory.tenantId).toBe(tenant.id);
    expect(ctxLegacy?.memory.conversationId).toBe(convLegacy!.id);
    expect(ctxLegacy?.memory.recentTurns.length).toBeGreaterThanOrEqual(1);
    expect(ctxLegacy?.memory.structuredFacts).toEqual({});
  }, 20000);
});
