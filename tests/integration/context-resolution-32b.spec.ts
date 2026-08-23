import { describe, it, expect, beforeEach, beforeAll, afterEach } from 'vitest';
import { prisma, pool } from '../../src/tests/testDb';
import { bootstrapChatbot } from '../../src/bootstrap';
import { DEFAULT_BUSINESS_CONFIG } from '../../src/domain/tenant/BusinessConfig';
import { LLMMockProvider } from '../../src/core/llm/LLMProvider';
import { EcommerceIntentParser } from '../../src/domain/ecommerce/EcommerceIntent';
import { TurnDecisionResolver } from '../../src/domain/conversation/TurnDecision';

describe('Phase 32B: Global Context & Entity Resolution Invariants', () => {
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
    deps.llmFactory.registerProvider('gemini', 'gemini-1.5-flash', mockLlm);
    deps.llmFactory.registerProvider('gemini', 'gemini-1.5-pro', mockLlm);
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

  async function seedStore() {
    const tenant = await prisma.tenant.create({
      data: {
        name: `Tenant-Context32B-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        config: {
          create: {
            config: {
              ...DEFAULT_BUSINESS_CONFIG,
              llm: {
                provider: 'mock',
                model: 'mock-model'
              },
              capabilities: {
                ...DEFAULT_BUSINESS_CONFIG.capabilities,
                ecommerceEnabled: true
              }
            }
          }
        },
        accounts: {
          create: {
            name: 'main-store',
            config: {
              llm: {
                provider: 'mock',
                model: 'mock-model'
              },
              capabilities: { ecommerceEnabled: true }
            }
          }
        }
      },
      include: { accounts: true }
    });
    createdTenantIds.push(tenant.id);
    const account = tenant.accounts[0];

    // Product 1: Classic Hoodie (Category: Hoodies)
    const hoodie = await prisma.product.create({
      data: {
        tenantId: tenant.id,
        accountId: account.id,
        sku: 'HOOD-CLASSIC',
        name: 'Classic Urban Hoodie',
        nameLocalized: {
          en: 'Classic Urban Hoodie',
          fr: 'Sweat à capuche classique',
          ar: 'هودي كلاسيكي',
          darija: 'هودي كلاسيك'
        },
        description: 'Warm cotton hoodie',
        descriptionLocalized: {
          en: 'Warm cotton hoodie',
          fr: 'Sweat chaud en coton',
          ar: 'هودي قطني دافئ',
          darija: 'هودي دافئ من القطن'
        },
        price: 350,
        currency: 'MAD',
        stock: 20,
        active: true,
        category: 'Hoodies',
        variants: {
          create: [
            { sku: 'HOOD-CLASSIC-BLK-M', name: 'Classic Hoodie Black M', color: 'Black', size: 'M', stock: 5, active: true },
            { sku: 'HOOD-CLASSIC-BLK-L', name: 'Classic Hoodie Black L', color: 'Black', size: 'L', stock: 8, active: true },
            { sku: 'HOOD-CLASSIC-RED-L', name: 'Classic Hoodie Red L', color: 'Red', size: 'L', stock: 4, active: true }
          ]
        }
      },
      include: { variants: true }
    });

    // Product 2: Graphic T-Shirt (Category: T-Shirts)
    const tshirt = await prisma.product.create({
      data: {
        tenantId: tenant.id,
        accountId: account.id,
        sku: 'TSHIRT-GRAPHIC',
        name: 'Graphic Print T-Shirt',
        nameLocalized: {
          en: 'Graphic Print T-Shirt',
          fr: 'T-shirt imprimé graphique',
          ar: 'تيشيرت مطبوع',
          darija: 'تيشورت مطبوع'
        },
        description: 'Lightweight summer t-shirt',
        descriptionLocalized: {
          en: 'Lightweight summer t-shirt',
          fr: 'T-shirt léger pour été',
          ar: 'تيشيرت صيفي خفيف',
          darija: 'تيشورت صيفي خفيف'
        },
        price: 180,
        currency: 'MAD',
        stock: 15,
        active: true,
        category: 'T-Shirts',
        variants: {
          create: [
            { sku: 'TSHIRT-GRAPHIC-BLK-S', name: 'T-Shirt Black S', color: 'Black', size: 'S', stock: 5, active: true },
            { sku: 'TSHIRT-GRAPHIC-BLK-M', name: 'T-Shirt Black M', color: 'Black', size: 'M', stock: 0, active: true },
            { sku: 'TSHIRT-GRAPHIC-WHT-M', name: 'T-Shirt White M', color: 'White', size: 'M', stock: 7, active: true }
          ]
        }
      },
      include: { variants: true }
    });

    // Product 3: Leather Jacket (Category: Jackets)
    const jacket = await prisma.product.create({
      data: {
        tenantId: tenant.id,
        accountId: account.id,
        sku: 'JACKET-LEATHER',
        name: 'Biker Leather Jacket',
        nameLocalized: {
          en: 'Biker Leather Jacket',
          fr: 'Veste de motard en cuir',
          ar: 'جاكيت جلد لراكبي الدراجات',
          darija: 'جاكيط جلد'
        },
        description: 'Premium biker leather jacket',
        price: 650,
        currency: 'MAD',
        stock: 6,
        active: true,
        category: 'Jackets',
        variants: {
          create: [
            { sku: 'JACKET-LTHR-BLK-L', name: 'Jacket Black L', color: 'Black', size: 'L', stock: 6, active: true }
          ]
        }
      },
      include: { variants: true }
    });

    return { tenant, account, hoodie, tshirt, jacket };
  }

  describe('Scenario 1-4: Contextual Price Verbs vs Explicit Product Overrides', () => {
    it('1. contextual Arabic price verb ("وشحال كيسوى؟") inherits active product', async () => {
      const parsed = EcommerceIntentParser.parse('وشحال كيسوى؟');
      expect(parsed.intent).toBe('PRICE');
      expect(parsed.productName).toBeUndefined();

      const resolved = TurnDecisionResolver.resolve({
        text: 'وشحال كيسوى؟',
        language: 'darija',
        productContext: {
          selectedProductId: 'prod-hoodie-1',
          selectedSku: 'HOOD-CLASSIC'
        }
      });
      expect(resolved.domain).toBe('ECOMMERCE');
      expect(resolved.intent).toBe('PRICE');
      expect(resolved.productId).toBe('prod-hoodie-1');
      expect(resolved.productName).toBeNull();
    });

    it('2. contextual English price phrase ("how much is it worth?") inherits active product', async () => {
      const parsed = EcommerceIntentParser.parse('how much is it worth?');
      expect(parsed.intent).toBe('PRICE');
      expect(parsed.productName).toBeUndefined();

      const resolved = TurnDecisionResolver.resolve({
        text: 'how much is it worth?',
        language: 'en',
        productContext: {
          selectedProductId: 'prod-hoodie-1',
          selectedSku: 'HOOD-CLASSIC'
        }
      });
      expect(resolved.domain).toBe('ECOMMERCE');
      expect(resolved.intent).toBe('PRICE');
      expect(resolved.productId).toBe('prod-hoodie-1');
    });

    it('3. contextual French price phrase ("combien ça vaut ?") inherits active product', async () => {
      const parsed = EcommerceIntentParser.parse('combien ça vaut ?');
      expect(parsed.intent).toBe('PRICE');
      expect(parsed.productName).toBeUndefined();

      const resolved = TurnDecisionResolver.resolve({
        text: 'combien ça vaut ?',
        language: 'fr',
        productContext: {
          selectedProductId: 'prod-hoodie-1',
          selectedSku: 'HOOD-CLASSIC'
        }
      });
      expect(resolved.domain).toBe('ECOMMERCE');
      expect(resolved.intent).toBe('PRICE');
      expect(resolved.productId).toBe('prod-hoodie-1');
    });

    it('4. explicit product + price overrides previous context', async () => {
      const parsed = EcommerceIntentParser.parse('Biker Leather Jacket شحال كيسوى؟');
      expect(parsed.intent).toBe('PRICE');
      expect(parsed.productName).toContain('Biker Leather Jacket');

      const resolved = TurnDecisionResolver.resolve({
        text: 'Biker Leather Jacket شحال كيسوى؟',
        language: 'darija',
        productContext: {
          selectedProductId: 'prod-hoodie-1',
          selectedSku: 'HOOD-CLASSIC'
        }
      });
      expect(resolved.domain).toBe('ECOMMERCE');
      expect(resolved.intent).toBe('PRICE');
      // Explicit product overrides stale context
      expect(resolved.productId).toBeNull();
      expect(resolved.productName).toContain('Biker Leather Jacket');
    });
  });

  describe('Scenario 5-7: Generic Category Entity Extraction & Search', () => {
    it('5. localized category resolves to canonical category', () => {
      expect(EcommerceIntentParser.extractCategory('بغيت تيشورت')).toBe('T-Shirts');
      expect(EcommerceIntentParser.extractCategory('وريني هوديات زوينين')).toBe('Hoodies');
      expect(EcommerceIntentParser.extractCategory('je cherche des vestes')).toBe('Jackets');
      expect(EcommerceIntentParser.extractCategory('عندكم سبابط؟')).toBe('Shoes');
      expect(EcommerceIntentParser.extractCategory('show me some pants')).toBe('Pants');
    });

    it('6. category + color search executes correctly against repository', async () => {
      const { tenant, account } = await seedStore();
      const parsed = EcommerceIntentParser.parse('بغيت تيشورت فالأسود');
      expect(parsed.category).toBe('T-Shirts');
      expect(parsed.color).toBe('Black');

      const res = await deps.conversationEngine.handleMessage(
        tenant.id,
        'cust-cat-1',
        'بغيت تيشورت فالأسود',
        account.id
      );

      expect(res).toContain('180');
    });

    it('7. category + size search executes correctly against repository', async () => {
      const { tenant, account } = await seedStore();
      const parsed = EcommerceIntentParser.parse('show me hoodies in size L');
      expect(parsed.category).toBe('Hoodies');
      expect(parsed.size).toBe('L');

      const res = await deps.conversationEngine.handleMessage(
        tenant.id,
        'cust-cat-2',
        'show me hoodies in size L',
        account.id
      );

      expect(res).toContain('350');
    });
  });

  describe('Scenario 8-10: Stale Context Invalidation & Product Switching', () => {
    it('8. category search with zero results clears stale product context', async () => {
      const { tenant, account, hoodie } = await seedStore();

      // Step 1: User asks about hoodie (establishes active product context)
      await deps.conversationEngine.handleMessage(
        tenant.id,
        'cust-stale-1',
        'tell me about Classic Urban Hoodie',
        account.id
      );

      const conv1 = await deps.conversationService.getOrCreateConversation(tenant.id, 'cust-stale-1', account.id);
      const updatedConv1 = await prisma.conversation.findUnique({ where: { id: conv1.id } });
      const ctx1 = (updatedConv1?.contextData as any)?.productContext;
      expect(ctx1?.selectedProductId).toBe(hoodie.id);

      // Step 2: User searches for non-existent category items (e.g. Shoes in Yellow)
      await deps.conversationEngine.handleMessage(
        tenant.id,
        'cust-stale-1',
        'عندكم سبابط بالصفر؟',
        account.id
      );

      const updatedConv2 = await prisma.conversation.findUnique({ where: { id: conv1.id } });
      const ctx2 = (updatedConv2?.contextData as any)?.productContext;
      // Stale context must be cleared to null
      expect(ctx2?.selectedProductId).toBeNull();
      expect(ctx2?.selectedSku).toBeNull();
    }, 15000);

    it('9. later variant follow-up cannot use stale context after failed search', async () => {
      const { tenant, account } = await seedStore();

      // Step 1: Select hoodie
      await deps.conversationEngine.handleMessage(
        tenant.id,
        'cust-stale-2',
        'tell me about Classic Urban Hoodie',
        account.id
      );

      // Step 2: Failed search
      await deps.conversationEngine.handleMessage(
        tenant.id,
        'cust-stale-2',
        'عندكم سبابط بالصفر؟',
        account.id
      );

      // Step 3: Follow-up asking for size M
      await deps.conversationEngine.handleMessage(
        tenant.id,
        'cust-stale-2',
        'واش كاين فـM؟',
        account.id
      );

      // Should not fall back to old hoodie; product is not selected
      const conv2 = await deps.conversationService.getOrCreateConversation(tenant.id, 'cust-stale-2', account.id);
      const updatedConv3 = await prisma.conversation.findUnique({ where: { id: conv2.id } });
      const ctx3 = (updatedConv3?.contextData as any)?.productContext;
      expect(ctx3?.selectedProductId).toBeNull();
    }, 15000);

    it('10. explicit product switch clears old variant state (color, size, sku)', () => {
      const resolved = TurnDecisionResolver.resolveProductContext(
        {
          intent: 'PRICE',
          productName: 'Biker Leather Jacket',
          size: undefined,
          color: undefined
        },
        {
          selectedProductId: 'prod-hoodie-1',
          selectedVariantId: 'var-hoodie-red-l',
          selectedSku: 'HOOD-CLASSIC-RED-L',
          selectedColor: 'Red',
          selectedSize: 'L'
        }
      );

      expect(resolved.isExplicit).toBe(true);
      expect(resolved.productId).toBeNull();
      expect(resolved.variantId).toBeNull();
      expect(resolved.sku).toBeNull();
      expect(resolved.color).toBeNull();
      expect(resolved.size).toBeNull();
    });
  });

  describe('Scenario 11-15: Contextual Follow-up & Entity Invariants', () => {
    it('11. contextual color inherits active product ("واش كاين فالأسود؟")', () => {
      const parsed = EcommerceIntentParser.parse('واش كاين فالأسود؟');
      expect(parsed.intent).toBe('AVAILABILITY');
      expect(parsed.color).toBe('Black');
      expect(parsed.productName).toBeUndefined();

      const resolved = TurnDecisionResolver.resolve({
        text: 'واش كاين فالأسود؟',
        language: 'darija',
        productContext: {
          selectedProductId: 'prod-hoodie-1',
          selectedSku: 'HOOD-CLASSIC'
        }
      });
      expect(resolved.domain).toBe('ECOMMERCE');
      expect(resolved.intent).toBe('AVAILABILITY');
      expect(resolved.productId).toBe('prod-hoodie-1');
      expect(resolved.color).toBe('Black');
    });

    it('12. contextual size inherits active product ("واش كاين فـM؟")', () => {
      const parsed = EcommerceIntentParser.parse('واش كاين فـM؟');
      expect(parsed.intent).toBe('AVAILABILITY');
      expect(parsed.size).toBe('M');
      expect(parsed.productName).toBeUndefined();

      const resolved = TurnDecisionResolver.resolve({
        text: 'واش كاين فـM؟',
        language: 'darija',
        productContext: {
          selectedProductId: 'prod-hoodie-1',
          selectedSku: 'HOOD-CLASSIC'
        }
      });
      expect(resolved.domain).toBe('ECOMMERCE');
      expect(resolved.intent).toBe('AVAILABILITY');
      expect(resolved.productId).toBe('prod-hoodie-1');
      expect(resolved.size).toBe('M');
    });

    it('13. generic noun is not mistaken for a product entity ("combien coûte ce produit ?")', () => {
      const parsed1 = EcommerceIntentParser.parse('combien coûte ce produit ?');
      expect(parsed1.intent).toBe('PRICE');
      expect(parsed1.productName).toBeUndefined();

      const parsed2 = EcommerceIntentParser.parse('شحال ثمن هاد السلعة؟');
      expect(parsed2.intent).toBe('PRICE');
      expect(parsed2.productName).toBeUndefined();
    });

    it('14. SKU/entity still overrides context ("HOOD-CLASSIC شحال؟")', () => {
      const parsed = EcommerceIntentParser.parse('HOOD-CLASSIC شحال؟');
      expect(parsed.intent).toBe('PRICE');
      expect(parsed.sku).toBe('HOOD-CLASSIC');

      const resolved = TurnDecisionResolver.resolve({
        text: 'HOOD-CLASSIC شحال؟',
        language: 'darija',
        productContext: {
          selectedProductId: 'prod-old-99',
          selectedSku: 'OLD-SKU-99'
        }
      });
      expect(resolved.domain).toBe('ECOMMERCE');
      expect(resolved.intent).toBe('PRICE');
      expect(resolved.sku).toBe('HOOD-CLASSIC');
      // Explicit SKU takes precedence over stale product id
      expect(resolved.productId).toBeNull();
    });

    it('15. existing Ecommerce behavior remains unchanged for end-to-end conversation', async () => {
      const { tenant, account } = await seedStore();

      // Step 1: Search T-shirts
      const r1 = await deps.conversationEngine.handleMessage(
        tenant.id,
        'cust-e2e-1',
        'بغيت تيشورت',
        account.id
      );
      expect(r1).toContain('180');

      // Step 2: Ask for price with contextual price verb
      const r2 = await deps.conversationEngine.handleMessage(
        tenant.id,
        'cust-e2e-1',
        'وشحال كيسوى؟',
        account.id
      );
      expect(r2).toContain('180');

      // Step 3: Check availability for white M
      const r3 = await deps.conversationEngine.handleMessage(
        tenant.id,
        'cust-e2e-1',
        'واش كاين فالأبيض M؟',
        account.id
      );
      expect(r3).toMatch(/(متوفر|in stock|disponible|7)/iu);
    }, 15000);
  });
});
