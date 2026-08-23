import { describe, it, expect, beforeEach, beforeAll, afterEach } from 'vitest';
import { prisma, pool } from '../../src/tests/testDb';
import { bootstrapChatbot } from '../../src/bootstrap';
import { DEFAULT_BUSINESS_CONFIG } from '../../src/domain/tenant/BusinessConfig';
import { LLMMockProvider } from '../../src/core/llm/LLMProvider';

describe('Phase 13C: Conversational Ecommerce Tests', { timeout: 20000 }, () => {
  let deps: ReturnType<typeof bootstrapChatbot>;
  let mockLlm: LLMMockProvider;
  const createdTenantIds: string[] = [];

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
    deps.llmFactory.registerProvider('deepseek', 'deepseek-chat', mockLlm);
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

  async function seedEcommerceStore() {
    const tenant = await prisma.tenant.create({
      data: {
        name: `Tenant-EcomConv-${Date.now()}`,
        config: {
          create: {
            config: {
              ...DEFAULT_BUSINESS_CONFIG,
              llm: { provider: 'mock', model: 'mock-model' }
            }
          }
        },
        accounts: {
          create: {
            name: 'main-store',
            config: {
              llm: { provider: 'mock', model: 'mock-model' },
              capabilities: { ecommerceEnabled: true }
            }
          }
        }
      },
      include: { accounts: true }
    });
    createdTenantIds.push(tenant.id);
    const account = tenant.accounts[0];

    // Product 1: Atlas Pro Running Shoes
    const prod1 = await prisma.product.create({
      data: {
        tenantId: tenant.id,
        accountId: account.id,
        sku: 'SKU-ATLAS-PRO',
        name: 'Atlas Pro Shoes',
        nameLocalized: {
          en: 'Atlas Pro Shoes',
          fr: 'Chaussures Atlas Pro',
          ar: 'حذاء أطلس برو',
          darija: 'سباط أطلس برو'
        },
        description: 'High performance running shoes',
        descriptionLocalized: {
          en: 'High performance running shoes',
          fr: 'Chaussures de course haute performance',
          ar: 'حذاء ركض عالي الأداء',
          darija: 'سباط ديال الجري ممتاز'
        },
        price: 120,
        currency: 'MAD',
        stock: 10,
        active: true,
        category: 'Shoes',
        variants: {
          create: [
            { sku: 'ATLAS-PRO-BLK-42', color: 'Black', size: '42', stock: 4, active: true },
            { sku: 'ATLAS-PRO-BLK-43', color: 'Black', size: '43', stock: 0, active: true },
            { sku: 'ATLAS-PRO-WHT-42', color: 'White', size: '42', stock: 6, active: true }
          ]
        }
      }
    });

    // Product 2: Atlas Lite Walking Shoes
    const prod2 = await prisma.product.create({
      data: {
        tenantId: tenant.id,
        accountId: account.id,
        sku: 'SKU-ATLAS-LITE',
        name: 'Atlas Lite Shoes',
        nameLocalized: {
          en: 'Atlas Lite Shoes',
          fr: 'Chaussures Atlas Lite',
          ar: 'حذاء أطلس لايت',
          darija: 'سباط أطلس لايت'
        },
        description: 'Lightweight everyday walking shoes',
        descriptionLocalized: {
          en: 'Lightweight everyday walking shoes',
          fr: 'Chaussures de marche légères',
          ar: 'حذاء مشي خفيف',
          darija: 'سباط خفيف للمشي'
        },
        price: 80,
        currency: 'MAD',
        stock: 5,
        active: true,
        category: 'Shoes'
      }
    });

    return { tenant, account, prod1, prod2 };
  }

  it('1. Product Search: Discovers matching products by keywords', async () => {
    const { tenant, account } = await seedEcommerceStore();
    const custId = `cust-search-${Date.now()}`;

    const res = await deps.conversationEngine.handleMessage(
      tenant.id,
      custId,
      'show me running shoes',
      account.id
    );

    expect(res).toContain('Atlas Pro Shoes');
    expect(res).toContain('120 MAD');
  });

  it('2. Product Detail: Returns localized description, price and variants', async () => {
    const { tenant, account } = await seedEcommerceStore();
    const custId = `cust-detail-${Date.now()}`;

    const res = await deps.conversationEngine.handleMessage(
      tenant.id,
      custId,
      'tell me about Atlas Pro Shoes',
      account.id
    );

    expect(res).toContain('Atlas Pro Shoes');
    expect(res).toContain('High performance running shoes');
    expect(res).toContain('120 MAD');
  });

  it('3. Multi-Turn Context & Variant Follow-Ups: "How much is it?" & "Is black size 42 in stock?"', async () => {
    const { tenant, account } = await seedEcommerceStore();
    const custId = `cust-multiturn-${Date.now()}`;

    // Turn 1: Ask about product
    await deps.conversationEngine.handleMessage(tenant.id, custId, 'tell me about Atlas Pro Shoes', account.id);

    // Turn 2: Follow-up reference "how much is it?"
    const resPrice = await deps.conversationEngine.handleMessage(tenant.id, custId, 'how much is it?', account.id);
    expect(resPrice).toContain('120 MAD');

    // Turn 3: Follow-up variant availability "is black size 42 in stock?"
    const resVariant1 = await deps.conversationEngine.handleMessage(tenant.id, custId, 'is black size 42 in stock?', account.id);
    expect(resVariant1).toContain('available');
    expect(resVariant1).toContain('4');

    // Turn 4: Follow-up out of stock variant "is black size 43 available?"
    const resVariant2 = await deps.conversationEngine.handleMessage(tenant.id, custId, 'is black size 43 available?', account.id);
    expect(resVariant2).toContain('out of stock');
  });

  it('4. Multi-Product List Selection: "tell me about the second one"', async () => {
    const { tenant, account } = await seedEcommerceStore();
    const custId = `cust-ordinal-${Date.now()}`;

    // Turn 1: Search returns 1. Atlas Lite, 2. Atlas Pro (or vice versa)
    await deps.conversationEngine.handleMessage(tenant.id, custId, 'show me shoes', account.id);

    // Turn 2: Ask about the second product in the list
    const resSecond = await deps.conversationEngine.handleMessage(tenant.id, custId, 'tell me about the second one', account.id);
    expect(resSecond).toContain('Shoes');
    expect(resSecond).toContain('Price:');
  });

  it('5. Price Filter: "shoes under 100 MAD"', async () => {
    const { tenant, account } = await seedEcommerceStore();
    const custId = `cust-filter-${Date.now()}`;

    const res = await deps.conversationEngine.handleMessage(
      tenant.id,
      custId,
      'show me shoes under 100 MAD',
      account.id
    );

    // Should include Atlas Lite (80 MAD) but not Atlas Pro (120 MAD)
    expect(res).toContain('Atlas Lite Shoes');
    expect(res).not.toContain('Atlas Pro Shoes');
  });

  it('6. Product Comparison: "compare Atlas Pro and Atlas Lite"', async () => {
    const { tenant, account } = await seedEcommerceStore();
    const custId = `cust-compare-${Date.now()}`;

    const res = await deps.conversationEngine.handleMessage(
      tenant.id,
      custId,
      'compare Atlas Pro Shoes and Atlas Lite Shoes',
      account.id
    );

    expect(res).toContain('Product Comparison:');
    expect(res).toContain('Atlas Pro Shoes: 120 MAD');
    expect(res).toContain('Atlas Lite Shoes: 80 MAD');
  });

  it('7. Multilingual Conversational Commerce (FR & AR)', async () => {
    const { tenant, account } = await seedEcommerceStore();

    // French
    const custFr = `cust-fr-${Date.now()}`;
    const resFr = await deps.conversationEngine.handleMessage(tenant.id, custFr, 'Quel est le prix de Chaussures Atlas Pro ?', account.id);
    expect(resFr).toContain('120 MAD');

    // Arabic
    const custAr = `cust-ar-${Date.now()}`;
    const resAr = await deps.conversationEngine.handleMessage(tenant.id, custAr, 'كم سعر حذاء أطلس برو؟', account.id);
    expect(resAr).toContain('120 MAD');
  });

  it('8. Hard Negative: Ambiguous reference with no context does not hallucinate product', async () => {
    const { tenant, account } = await seedEcommerceStore();
    const custId = `cust-neg-${Date.now()}`;

    let llmCalled = false;
    mockLlm.generateResponse = async () => {
      llmCalled = true;
      return 'Could you please specify which product you mean?';
    };

    // Customer immediately says "how much is that one?" without any previous context
    const res = await deps.conversationEngine.handleMessage(tenant.id, custId, 'how much is that one?', account.id);
    expect(res).not.toContain('120 MAD');
    expect(res).not.toContain('80 MAD');
  });

  it('9. TEST 1: Base product detail -> variant question -> base product detail (does not leak variant price)', async () => {
    const { tenant, account, prod1 } = await seedEcommerceStore();
    const custId = `cust-t1-${Date.now()}`;

    // Update prod1 base price to 199 and create variant with override 130
    await prisma.product.update({ where: { id: prod1.id }, data: { price: 199 } });
    await prisma.productVariant.updateMany({ where: { productId: prod1.id, sku: 'ATLAS-PRO-WHT-42' }, data: { priceOverride: 130 } });

    // Turn 1: Base product detail
    const t1 = await deps.conversationEngine.handleMessage(tenant.id, custId, 'tell me about Atlas Pro Shoes', account.id);
    expect(t1).toContain('199 MAD');

    // Turn 2: Variant question
    const t2 = await deps.conversationEngine.handleMessage(tenant.id, custId, 'what about white size 42?', account.id);
    expect(t2).toContain('130 MAD');

    // Turn 3: Base product detail again - MUST return base price 199, NOT 130
    const t3 = await deps.conversationEngine.handleMessage(tenant.id, custId, 'tell me about Atlas Pro Shoes', account.id);
    expect(t3).toContain('199 MAD');
    expect(t3).not.toContain('130 MAD');
  });

  it('10. TEST 2: Base product detail -> variant selection -> base product availability', async () => {
    const { tenant, account, prod1 } = await seedEcommerceStore();
    const custId = `cust-t2-${Date.now()}`;

    // prod1 has base stock = 0, variant WHT-42 has stock = 6
    await prisma.product.update({ where: { id: prod1.id }, data: { stock: 0 } });

    // Turn 1: Base product detail
    const t1 = await deps.conversationEngine.handleMessage(tenant.id, custId, 'tell me about Atlas Pro Shoes', account.id);
    expect(t1).toContain('Atlas Pro Shoes');

    // Turn 2: Variant question (in stock)
    const t2 = await deps.conversationEngine.handleMessage(tenant.id, custId, 'is white size 42 available?', account.id);
    expect(t2).toContain('available');
    expect(t2).toContain('6');

    // Turn 3: Base product availability - MUST evaluate base product stock (0 -> out of stock)
    const t3 = await deps.conversationEngine.handleMessage(tenant.id, custId, 'is Atlas Pro Shoes available?', account.id);
    expect(t3.toLowerCase()).toContain('out of stock');
  });

  it('11. TEST 3: Variant selection -> anaphoric follow-up (preserves variant context)', async () => {
    const { tenant, account, prod1 } = await seedEcommerceStore();
    const custId = `cust-t3-${Date.now()}`;

    await prisma.productVariant.updateMany({ where: { productId: prod1.id, sku: 'ATLAS-PRO-WHT-42' }, data: { priceOverride: 130 } });

    // Turn 1: Select product
    await deps.conversationEngine.handleMessage(tenant.id, custId, 'tell me about Atlas Pro Shoes', account.id);

    // Turn 2: Select variant
    const t2 = await deps.conversationEngine.handleMessage(tenant.id, custId, 'what about white size 42?', account.id);
    expect(t2).toContain('130 MAD');

    // Turn 3: Anaphoric price follow-up - MUST use selected variant price
    const t3 = await deps.conversationEngine.handleMessage(tenant.id, custId, 'how much is it?', account.id);
    expect(t3).toContain('130 MAD');
  });

  it('12. TEST 4: Product A selected -> explicit request for Product B (Product B wins and old variant context cleared)', async () => {
    const { tenant, account, prod1, prod2 } = await seedEcommerceStore();
    const custId = `cust-t4-${Date.now()}`;

    // Turn 1: Select variant on prod1
    await deps.conversationEngine.handleMessage(tenant.id, custId, 'what about white size 42 on Atlas Pro Shoes?', account.id);

    // Turn 2: Ask about prod2
    const t2 = await deps.conversationEngine.handleMessage(tenant.id, custId, 'tell me about Atlas Lite Shoes', account.id);
    expect(t2).toContain('Atlas Lite Shoes');
    expect(t2).toContain('80 MAD');

    // Turn 3: Follow-up price on prod2
    const t3 = await deps.conversationEngine.handleMessage(tenant.id, custId, 'how much is it?', account.id);
    expect(t3).toContain('80 MAD');
  });

  it('13. TEST 5: Product search after previous variant selection (search not contaminated)', async () => {
    const { tenant, account, prod1 } = await seedEcommerceStore();
    const custId = `cust-t5-${Date.now()}`;

    await prisma.product.update({ where: { id: prod1.id }, data: { price: 199 } });
    await prisma.productVariant.updateMany({ where: { productId: prod1.id, sku: 'ATLAS-PRO-WHT-42' }, data: { priceOverride: 130 } });

    // Turn 1: Select variant (130 MAD)
    await deps.conversationEngine.handleMessage(tenant.id, custId, 'what about white size 42?', account.id);

    // Turn 2: Search shoes
    const t2 = await deps.conversationEngine.handleMessage(tenant.id, custId, 'show me shoes', account.id);
    expect(t2).toContain('Atlas Pro Shoes — 199 MAD');
    expect(t2).toContain('Atlas Lite Shoes — 80 MAD');
  });

  it('14. TEST 6: Live price update -> query price -> DB price changed -> query price again', async () => {
    const { tenant, account, prod1 } = await seedEcommerceStore();
    const custId = `cust-t6-${Date.now()}`;

    // Turn 1: Initial price
    const t1 = await deps.conversationEngine.handleMessage(tenant.id, custId, 'how much is Atlas Pro Shoes?', account.id);
    expect(t1).toContain('120 MAD');

    // Live DB update
    await prisma.product.update({ where: { id: prod1.id }, data: { price: 250 } });

    // Turn 2: Query price again - MUST reflect 250 MAD immediately without cache staleness
    const t2 = await deps.conversationEngine.handleMessage(tenant.id, custId, 'how much is Atlas Pro Shoes?', account.id);
    expect(t2).toContain('250 MAD');
  });

  it('15. TEST 7: Live stock update -> query availability -> DB stock changed -> query availability again', async () => {
    const { tenant, account, prod1 } = await seedEcommerceStore();
    const custId = `cust-t7-${Date.now()}`;

    // Turn 1: Stock is 10
    const t1 = await deps.conversationEngine.handleMessage(tenant.id, custId, 'is Atlas Pro Shoes in stock?', account.id);
    expect(t1).toContain('available');
    expect(t1).toContain('10');

    // Live DB update stock -> 0
    await prisma.product.update({ where: { id: prod1.id }, data: { stock: 0 } });

    // Turn 2: Query availability again - MUST be out of stock
    const t2 = await deps.conversationEngine.handleMessage(tenant.id, custId, 'is Atlas Pro Shoes in stock?', account.id);
    expect(t2.toLowerCase()).toContain('out of stock');
  });

  it('16. TEST 8: Variant price override -> variant price query', async () => {
    const { tenant, account, prod1 } = await seedEcommerceStore();
    const custId = `cust-t8-${Date.now()}`;

    // Base price = 120, Variant WHT-42 override = 155
    await prisma.productVariant.updateMany({ where: { productId: prod1.id, sku: 'ATLAS-PRO-WHT-42' }, data: { priceOverride: 155 } });

    const res = await deps.conversationEngine.handleMessage(tenant.id, custId, 'how much is Atlas Pro Shoes in white size 42?', account.id);
    expect(res).toContain('155 MAD');
  });

  it('17. TEST 9: Variant without price override -> variant price query uses Product.price', async () => {
    const { tenant, account, prod1 } = await seedEcommerceStore();
    const custId = `cust-t9-${Date.now()}`;

    // Base price = 120, Variant BLK-42 has priceOverride = null
    await prisma.productVariant.updateMany({ where: { productId: prod1.id, sku: 'ATLAS-PRO-BLK-42' }, data: { priceOverride: null } });

    const res = await deps.conversationEngine.handleMessage(tenant.id, custId, 'how much is Atlas Pro Shoes in black size 42?', account.id);
    expect(res).toContain('120 MAD');
  });

  it('18. TEST 10: Multi-turn flow reproduction with generated fixtures', async () => {
    const { tenant, account, prod1 } = await seedEcommerceStore();
    const custId = `cust-t10-${Date.now()}`;

    // Setup: Base price = 199, Base stock = 0, White 42 = 130 MAD / stock 2
    await prisma.product.update({ where: { id: prod1.id }, data: { price: 199, stock: 0 } });
    await prisma.productVariant.updateMany({ where: { productId: prod1.id, sku: 'ATLAS-PRO-WHT-42' }, data: { priceOverride: 130, stock: 2 } });

    // Step 1: Search
    const r1 = await deps.conversationEngine.handleMessage(tenant.id, custId, 'show me shoes', account.id);
    expect(r1).toContain('Atlas Pro Shoes — 199 MAD');

    // Step 2: Explicit product detail -> base product (199 MAD)
    const r2 = await deps.conversationEngine.handleMessage(tenant.id, custId, 'tell me about Atlas Pro Shoes', account.id);
    expect(r2).toContain('199 MAD');

    // Step 3: Explicit variant selection -> White 42 (130 MAD / stock 2)
    const r3 = await deps.conversationEngine.handleMessage(tenant.id, custId, 'what about white size 42?', account.id);
    expect(r3).toContain('130 MAD');
    expect(r3).toContain('2');

    // Step 4: Explicit base product availability -> base product stock (0 -> out of stock)
    const r4 = await deps.conversationEngine.handleMessage(tenant.id, custId, 'is Atlas Pro Shoes available?', account.id);
    expect(r4.toLowerCase()).toContain('out of stock');
    expect(r4).not.toContain('130 MAD');
  });
});
