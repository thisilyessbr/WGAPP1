import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { prisma, pool } from '../../src/tests/testDb';
import { bootstrapChatbot } from '../../src/bootstrap';
import { DEFAULT_BUSINESS_CONFIG, BusinessConfig } from '../../src/domain/tenant/BusinessConfig';
import { LLMMockProvider } from '../../src/core/llm/LLMProvider';
import { MockEmbeddingProvider } from '../../src/core/rag/EmbeddingProvider';
import { KnowledgeRepository } from '../../src/domain/rag/KnowledgeRepository';

describe('Phase 25B: Conversation Automation Cap Rollover Integration Tests', { timeout: 30000 }, () => {
  let deps: ReturnType<typeof bootstrapChatbot>;
  let mockLlm: LLMMockProvider;

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
    (deps.ragService as any)['embeddingProvider'] = new MockEmbeddingProvider();
    deps.llmFactory.registerProvider('mock', 'mock-model', mockLlm);
    deps.tenantConfigService.clearCache();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('1-11. Automation cap rollover: 49 turns normal -> 50th boundary limitExceeded -> old closed -> new ACTIVE conversation on next turn', async () => {
    const tenant = await prisma.tenant.create({
      data: {
        name: `Tenant-Rollover-${Date.now()}`,
        config: {
          create: {
            config: {
              ...DEFAULT_BUSINESS_CONFIG,
              limits: {
                ...DEFAULT_BUSINESS_CONFIG.limits,
                maxAutomationTurns: 50, // Test boundary at 50 turns
                maxConversationHistory: 20 // Stays independent
              },
              prompts: {
                ...DEFAULT_BUSINESS_CONFIG.prompts,
                limitExceeded: 'Conversation limit reached. Please continue.'
              }
            }
          }
        }
      }
    });

    const account = await prisma.account.create({
      data: { tenantId: tenant.id, name: 'Main Store', enabled: true }
    });

    const customerExtId = `cust-rollover-${Date.now()}`;

    // Create conversation pre-populated at messageCount = 49 (turn 49 completed)
    const initialConv = await deps.conversationService.getOrCreateConversation(tenant.id, customerExtId, account.id);
    await prisma.conversation.update({
      where: { id: initialConv.id },
      data: { messageCount: 49 }
    });

    // 1. Turn 50 (messageCount is 49 < 50) -> processed normally
    const resTurn50 = await deps.conversationEngine.handleMessage(tenant.id, customerExtId, 'Hello turn 50', account.id);
    expect(resTurn50).not.toBe('Conversation limit reached. Please continue.');
    expect(resTurn50.length).toBeGreaterThan(0);

    const convAfter50 = await prisma.conversation.findUnique({ where: { id: initialConv.id } });
    expect(convAfter50?.messageCount).toBe(50);
    expect(convAfter50?.status).toBe('ACTIVE');
    expect(convAfter50?.automationCapped).toBe(false);

    // 2 & 3. Turn 51 (messageCount is 50 >= maxAutomationTurns) -> returns limitExceeded exactly once
    const resTurn51 = await deps.conversationEngine.handleMessage(tenant.id, customerExtId, 'Hello turn 51', account.id);
    expect(resTurn51).toBe('Conversation limit reached. Please continue.');

    // 4. Old conversation becomes CLOSED / COMPLETED
    const convAfter51 = await prisma.conversation.findUnique({ where: { id: initialConv.id } });
    expect(convAfter51?.status).toBe('COMPLETED');
    expect(convAfter51?.automationCapped).toBe(true);
    expect(convAfter51?.messageCount).toBe(51);

    // 5. Old messages remain intact in Message table
    const oldMessages = await prisma.message.findMany({ where: { conversationId: initialConv.id } });
    expect(oldMessages.length).toBeGreaterThanOrEqual(4); // 2 messages from turn 50 + 2 from turn 51

    // 6. Next customer message creates a NEW ACTIVE conversation
    const resTurn52 = await deps.conversationEngine.handleMessage(tenant.id, customerExtId, 'Hello fresh turn 1', account.id);
    expect(resTurn52).not.toBe('Conversation limit reached. Please continue.');
    expect(resTurn52).not.toBe(''); // Not silent!

    // Find all conversations for customer
    const customer = await prisma.customer.findUnique({
      where: { tenantId_externalId: { tenantId: tenant.id, externalId: customerExtId } }
    });
    const allConvs = await prisma.conversation.findMany({
      where: { tenantId: tenant.id, customerId: customer!.id },
      orderBy: { createdAt: 'asc' }
    });
    expect(allConvs.length).toBe(2);

    const newConv = allConvs[1];
    expect(newConv.id).not.toBe(initialConv.id);

    // 7. New conversation messageCount starts fresh (turn 1 committed => count 1)
    expect(newConv.messageCount).toBe(1);

    // 8. automationCapped = false on new conversation
    expect(newConv.automationCapped).toBe(false);
    expect(newConv.postCompletionCapped).toBe(false);
    expect(newConv.status).toBe('ACTIVE');

    // 9, 10, 11. tenantId, accountId, customerId preserved
    expect(newConv.tenantId).toBe(tenant.id);
    expect(newConv.accountId).toBe(account.id);
    expect(newConv.customerId).toBe(customer!.id);
  });

  it('12. Concurrency: Simultaneous messages on capped conversation create exactly ONE replacement active conversation', async () => {
    const tenant = await prisma.tenant.create({
      data: {
        name: `Tenant-Concurrent-${Date.now()}`,
        config: {
          create: {
            config: {
              ...DEFAULT_BUSINESS_CONFIG,
              limits: { ...DEFAULT_BUSINESS_CONFIG.limits, maxAutomationTurns: 5 }
            }
          }
        }
      }
    });

    const customerExtId = `cust-concurrent-${Date.now()}`;
    const initialConv = await deps.conversationService.getOrCreateConversation(tenant.id, customerExtId);
    
    // Mark initial conversation COMPLETED / capped
    await prisma.conversation.update({
      where: { id: initialConv.id },
      data: { status: 'COMPLETED', automationCapped: true, messageCount: 5 }
    });

    // Fire 2 concurrent getOrCreateConversation calls
    const [c1, c2] = await Promise.all([
      deps.conversationService.getOrCreateConversation(tenant.id, customerExtId),
      deps.conversationService.getOrCreateConversation(tenant.id, customerExtId)
    ]);

    // Both should receive the exact same new active conversation
    expect(c1.id).toBe(c2.id);
    expect(c1.id).not.toBe(initialConv.id);
    expect(c1.status).toBe('ACTIVE');
    expect(c1.automationCapped).toBe(false);

    const customer = await prisma.customer.findUnique({
      where: { tenantId_externalId: { tenantId: tenant.id, externalId: customerExtId } }
    });
    const activeConvs = await prisma.conversation.findMany({
      where: { tenantId: tenant.id, customerId: customer!.id, status: 'ACTIVE' }
    });
    expect(activeConvs.length).toBe(1);
  });

  it('13. resolveHandoff clears automationCapped and postCompletionCapped without resetting history', async () => {
    const tenant = await prisma.tenant.create({
      data: { name: `Tenant-Handoff-Clear-${Date.now()}` }
    });
    const customerExtId = `cust-handoff-clear-${Date.now()}`;
    const conv = await deps.conversationService.getOrCreateConversation(tenant.id, customerExtId);

    // Simulate capped state + human takeover
    await prisma.conversation.update({
      where: { id: conv.id },
      data: {
        status: 'HUMAN_ACTIVE',
        humanRequested: true,
        automationCapped: true,
        postCompletionCapped: true,
        messageCount: 50
      }
    });

    // Human agent resolves handoff
    const resolved = await deps.conversationService.resolveHandoff(tenant.id, conv.id);

    expect(resolved.status).toBe('ACTIVE');
    expect(resolved.humanRequested).toBe(false);
    expect(resolved.automationCapped).toBe(false);
    expect(resolved.postCompletionCapped).toBe(false);
    expect(resolved.messageCount).toBe(50); // Historical messageCount preserved
  });

  it('14 & 15. Limits config: maxAutomationTurns defaults to 500 and maxConversationHistory remains 20', () => {
    expect(DEFAULT_BUSINESS_CONFIG.limits.maxAutomationTurns).toBe(500);
    expect(DEFAULT_BUSINESS_CONFIG.limits.maxConversationHistory).toBe(20);
  });

  it('16. Ecommerce functionality works seamlessly after conversation rollover', async () => {
    const tenant = await prisma.tenant.create({
      data: {
        name: `Tenant-Ecom-Rollover-${Date.now()}`,
        config: {
          create: {
            config: {
              ...DEFAULT_BUSINESS_CONFIG,
              limits: { ...DEFAULT_BUSINESS_CONFIG.limits, maxAutomationTurns: 2 }
            }
          }
        }
      }
    });

    const account = await prisma.account.create({
      data: { tenantId: tenant.id, name: 'Anime Store', enabled: true }
    });

    // Seed product
    await prisma.product.create({
      data: {
        tenantId: tenant.id,
        accountId: account.id,
        sku: 'ANV-H001',
        name: 'Capuchon Moon Ninja',
        description: 'Capuchon Moon Ninja',
        category: 'Hoodies',
        price: 399,
        stock: 5,
        currency: 'MAD'
      }
    });

    const customerExtId = `cust-ecom-roll-${Date.now()}`;

    // Turn 1: Normal
    await deps.conversationEngine.handleMessage(tenant.id, customerExtId, 'Hello', account.id);
    // Turn 2: Normal
    await deps.conversationEngine.handleMessage(tenant.id, customerExtId, 'Hello 2', account.id);
    // Turn 3: Cap triggered -> limitExceeded, conversation closes
    const capRes = await deps.conversationEngine.handleMessage(tenant.id, customerExtId, 'Hello 3', account.id);
    expect(capRes).toContain('Conversation has reached the maximum allowed length');

    // Turn 4 (First turn of new rolled-over conversation): Product Price Query
    const priceRes = await deps.conversationEngine.handleMessage(
      tenant.id,
      customerExtId,
      'شحال ثمن Capuchon Moon Ninja؟',
      account.id
    );
    expect(priceRes).toContain('399');
  });

  it('17. RAG / Knowledge retrieval works seamlessly after conversation rollover', async () => {
    const tenant = await prisma.tenant.create({
      data: {
        name: `Tenant-RAG-Rollover-${Date.now()}`,
        config: {
          create: {
            config: {
              ...DEFAULT_BUSINESS_CONFIG,
              limits: { ...DEFAULT_BUSINESS_CONFIG.limits, maxAutomationTurns: 1 },
              capabilities: {
                ...DEFAULT_BUSINESS_CONFIG.capabilities,
                faq: [
                  {
                    id: 'faq-ship',
                    question: {
                      en: 'How much is shipping to Casablanca?',
                      darija: 'ch7al dyal livraison l Casablanca?'
                    },
                    answer: {
                      en: 'Delivery to Casablanca is 35 MAD.',
                      darija: 'Delivery to Casablanca is 35 MAD.'
                    }
                  }
                ]
              }
            }
          }
        }
      }
    });

    const account = await prisma.account.create({
      data: { tenantId: tenant.id, name: 'Knowledge Store', enabled: true }
    });

    const knowledgeRepo = new KnowledgeRepository(prisma);
    const src = await prisma.knowledgeSource.create({
      data: { tenantId: tenant.id, name: 'Shipping Docs', type: 'PDF', status: 'COMPLETED' }
    });
    const doc = await prisma.knowledgeDocument.create({
      data: { tenantId: tenant.id, sourceId: src.id, accountId: account.id, title: 'Shipping Policy', content: 'Delivery to Casablanca is 35 MAD.' }
    });
    const emb = await (deps.ragService as any)['embeddingProvider'].embedText('ch7al dyal livraison l Casablanca');
    await knowledgeRepo.insertChunk(tenant.id, doc.id, 'Delivery to Casablanca is 35 MAD.', emb, account.id);

    const customerExtId = `cust-rag-roll-${Date.now()}`;

    // Turn 1: Normal
    await deps.conversationEngine.handleMessage(tenant.id, customerExtId, 'Hi', account.id);
    // Turn 2: Cap triggered -> closed
    await deps.conversationEngine.handleMessage(tenant.id, customerExtId, 'Hi 2', account.id);

    // Turn 3 (New active conversation): Knowledge inquiry
    const ragRes = await deps.conversationEngine.handleMessage(
      tenant.id,
      customerExtId,
      'ch7al dyal livraison l Casablanca?',
      account.id
    );
    expect(ragRes).toContain('35 MAD');
  });

  it('18. Arabic and Darija conversations work accurately after rollover', async () => {
    const tenant = await prisma.tenant.create({
      data: {
        name: `Tenant-Lang-Rollover-${Date.now()}`,
        config: {
          create: {
            config: {
              ...DEFAULT_BUSINESS_CONFIG,
              limits: { ...DEFAULT_BUSINESS_CONFIG.limits, maxAutomationTurns: 1 }
            }
          }
        }
      }
    });

    const account = await prisma.account.create({
      data: { tenantId: tenant.id, name: 'Lang Store', enabled: true }
    });

    await prisma.product.create({
      data: {
        tenantId: tenant.id,
        accountId: account.id,
        sku: 'ANV-H001',
        name: 'Capuchon Moon Ninja',
        description: 'Capuchon Moon Ninja',
        category: 'Hoodies',
        price: 399,
        stock: 5,
        currency: 'MAD'
      }
    });

    const customerExtId = `cust-lang-roll-${Date.now()}`;

    // Trigger cap
    await deps.conversationEngine.handleMessage(tenant.id, customerExtId, 'Hello 1', account.id);
    await deps.conversationEngine.handleMessage(tenant.id, customerExtId, 'Hello 2', account.id);

    // New active conversation: Darija Arabizi
    const darijaRes = await deps.conversationEngine.handleMessage(
      tenant.id,
      customerExtId,
      'ch7al taman dyal Capuchon Moon Ninja?',
      account.id
    );
    expect(darijaRes).toContain('399');
  });
});
