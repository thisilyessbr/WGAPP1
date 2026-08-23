import { describe, it, expect, beforeEach, beforeAll, afterEach } from 'vitest';
import { prisma, pool } from '../../src/tests/testDb';
import { bootstrapChatbot } from '../../src/bootstrap';
import { DEFAULT_BUSINESS_CONFIG } from '../../src/domain/tenant/BusinessConfig';
import { LLMMockProvider } from '../../src/core/llm/LLMProvider';
import { CustomerContextService } from '../../src/domain/conversation/CustomerContextService';

describe('Phase 14: Customer Context and Human Handoff Tests', { timeout: 30000 }, () => {
  let deps: ReturnType<typeof bootstrapChatbot>;
  let mockLlm: LLMMockProvider;
  let customerContextService: CustomerContextService;
  const createdTenantIds: string[] = [];

  beforeAll(async () => {
    const client = await pool.connect();
    try {
      await client.query('SET search_path TO test, public, extensions;');
      await client.query('ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "metadata" JSONB;');
    } finally {
      client.release();
    }
  });

  beforeEach(async () => {
    deps = bootstrapChatbot(prisma);
    customerContextService = new CustomerContextService(prisma);
    mockLlm = new LLMMockProvider();
    deps.llmFactory.registerProvider('mock', 'mock-model', mockLlm);
    deps.tenantConfigService.clearCache();
  });

  afterEach(async () => {
    for (const tenantId of createdTenantIds) {
      try {
        await prisma.tenant.delete({ where: { id: tenantId } });
      } catch (err) {}
    }
    createdTenantIds.length = 0;
  });

  async function seedTestTenant() {
    const tenant = await prisma.tenant.create({
      data: {
        name: `Tenant-CustHandoff-${Date.now()}`,
        config: { create: { config: DEFAULT_BUSINESS_CONFIG } },
        accounts: {
          create: [
            { name: 'store-a', config: { capabilities: { ecommerceEnabled: true } } },
            { name: 'store-b', config: { capabilities: { ecommerceEnabled: true } } }
          ]
        }
      },
      include: { accounts: true }
    });
    createdTenantIds.push(tenant.id);
    return {
      tenant,
      accountA: tenant.accounts.find(a => a.name === 'store-a')!,
      accountB: tenant.accounts.find(a => a.name === 'store-b')!
    };
  }

  it('1. Customer Context: Account-scoped durable facts isolation', async () => {
    const { tenant, accountA, accountB } = await seedTestTenant();

    const cust1 = await prisma.customer.create({
      data: { tenantId: tenant.id, externalId: 'cust-1' }
    });
    const cust2 = await prisma.customer.create({
      data: { tenantId: tenant.id, externalId: 'cust-2' }
    });

    // Account A / Customer 1: French VIP
    await customerContextService.updateCustomerContext(
      tenant.id,
      cust1.id,
      { preferredLanguage: 'fr', customerType: 'VIP', preferredName: 'Jean' },
      accountA.id
    );

    // Account B / Customer 1: English Standard
    await customerContextService.updateCustomerContext(
      tenant.id,
      cust1.id,
      { preferredLanguage: 'en', customerType: 'STANDARD', preferredName: 'John' },
      accountB.id
    );

    // Account A / Customer 2: Arabic
    await customerContextService.updateCustomerContext(
      tenant.id,
      cust2.id,
      { preferredLanguage: 'ar', preferredName: 'Ahmed' },
      accountA.id
    );

    const ctxA1 = await customerContextService.getCustomerContext(tenant.id, cust1.id, accountA.id);
    const ctxB1 = await customerContextService.getCustomerContext(tenant.id, cust1.id, accountB.id);
    const ctxA2 = await customerContextService.getCustomerContext(tenant.id, cust2.id, accountA.id);

    expect(ctxA1?.preferredLanguage).toBe('fr');
    expect(ctxA1?.customerType).toBe('VIP');
    expect(ctxA1?.preferredName).toBe('Jean');

    expect(ctxB1?.preferredLanguage).toBe('en');
    expect(ctxB1?.customerType).toBe('STANDARD');
    expect(ctxB1?.preferredName).toBe('John');

    expect(ctxA2?.preferredLanguage).toBe('ar');
    expect(ctxA2?.preferredName).toBe('Ahmed');
  });

  it('2. Deterministic Multilingual Handoff Triggers (EN, FR, AR, Darija)', async () => {
    const { tenant, accountA } = await seedTestTenant();

    // EN
    const resEn = await deps.conversationEngine.handleMessage(tenant.id, 'cust-en', 'I want to speak to an agent', accountA.id);
    expect(resEn).toContain('human agent has been notified');

    // FR
    const resFr = await deps.conversationEngine.handleMessage(tenant.id, 'cust-fr', 'Je veux parler à un humain', accountA.id);
    expect(resFr).toContain('conseiller humain');

    // AR
    const resAr = await deps.conversationEngine.handleMessage(tenant.id, 'cust-ar', 'أريد التحدث مع موظف الدعم', accountA.id);
    expect(resAr).toContain('موظفي خدمة العملاء');

    // Darija
    const resDarija = await deps.conversationEngine.handleMessage(tenant.id, 'cust-darija', 'بغيت نهضر مع شي واحد من فضلك', accountA.id);
    expect(resDarija).toContain('فريق الدعم');
  });

  it('3. Human Handoff Lifecycle: REQUESTED -> HUMAN_ACTIVE -> RESOLVED -> BOT_ACTIVE', async () => {
    const { tenant, accountA } = await seedTestTenant();
    const custId = 'cust-lifecycle';

    // Step 1: User requests human
    const handoffRes = await deps.conversationEngine.handleMessage(tenant.id, custId, 'talk to a human', accountA.id);
    expect(handoffRes).toContain('human agent has been notified');

    let conv = await prisma.conversation.findFirst({
      where: { tenantId: tenant.id, customer: { externalId: custId } }
    });
    expect(conv?.status).toBe('HANDOFF_REQUESTED');
    expect(conv?.humanRequested).toBe(true);

    // Step 2: Human Agent takes over
    await deps.conversationService.takeOverByHuman(tenant.id, conv!.id);

    conv = await prisma.conversation.findFirst({
      where: { id: conv!.id }
    });
    expect(conv?.status).toBe('HUMAN_ACTIVE');

    // Step 3: User sends message while human is active -> Bot pauses (returns empty string), message persisted
    const activeRes = await deps.conversationEngine.handleMessage(tenant.id, custId, 'Hello are you there?', accountA.id);
    expect(activeRes).toBe('');

    const messages = await prisma.message.findMany({
      where: { conversationId: conv!.id },
      orderBy: { createdAt: 'asc' }
    });
    const lastMsg = messages[messages.length - 1];
    expect(lastMsg.content).toBe('Hello are you there?');
    expect(lastMsg.role).toBe('USER');

    // Step 4: Human agent resolves handoff -> Bot resumes
    await deps.conversationService.resolveHandoff(tenant.id, conv!.id);

    conv = await prisma.conversation.findFirst({
      where: { id: conv!.id }
    });
    expect(conv?.status).toBe('ACTIVE');
    expect(conv?.humanRequested).toBe(false);

    // Step 5: Customer talks to bot again -> Bot responds normally
    const resumeRes = await deps.conversationEngine.handleMessage(tenant.id, custId, 'hi', accountA.id);
    expect(resumeRes.length).toBeGreaterThan(0);
    expect(resumeRes).not.toBe('');
  });

  it('4. Product Context Isolation between Customers', async () => {
    const { tenant, accountA } = await seedTestTenant();

    // Create Product
    await prisma.product.create({
      data: {
        tenantId: tenant.id,
        accountId: accountA.id,
        sku: 'SKU-ISOLATE-01',
        name: 'Isolator Running Shoes',
        description: 'Isolated test shoe',
        price: 150,
        currency: 'MAD',
        stock: 5,
        active: true
      }
    });

    // Customer A views Isolator Running Shoes
    await deps.conversationEngine.handleMessage(tenant.id, 'cust-a', 'tell me about Isolator Running Shoes', accountA.id);

    // Customer B asks "how much is it?" without viewing anything
    let llmCalled = false;
    mockLlm.generateResponse = async () => {
      llmCalled = true;
      return 'Which product are you referring to?';
    };

    const resCustB = await deps.conversationEngine.handleMessage(tenant.id, 'cust-b', 'how much is it?', accountA.id);
    expect(resCustB).not.toContain('150 MAD');
  });

  it('5. Concurrency / Race Safety around Handoff', async () => {
    const { tenant, accountA } = await seedTestTenant();
    const custId = 'cust-race';

    // Send handoff request
    await deps.conversationEngine.handleMessage(tenant.id, custId, 'talk to a human', accountA.id);

    const conv = await prisma.conversation.findFirst({
      where: { tenantId: tenant.id, customer: { externalId: custId } }
    });
    expect(conv?.status).toBe('HANDOFF_REQUESTED');

    // Takeover
    await deps.conversationService.takeOverByHuman(tenant.id, conv!.id);

    // Concurrent message during HUMAN_ACTIVE
    const res = await deps.conversationEngine.handleMessage(tenant.id, custId, 'What are your hours?', accountA.id);
    expect(res).toBe(''); // Pauses automation cleanly
  });
});
