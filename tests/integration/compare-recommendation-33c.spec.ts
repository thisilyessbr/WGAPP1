import { describe, it, expect, beforeEach, beforeAll, afterEach } from 'vitest';
import { prisma, pool } from '../../src/tests/testDb';
import { bootstrapChatbot } from '../../src/bootstrap';
import { DEFAULT_BUSINESS_CONFIG } from '../../src/domain/tenant/BusinessConfig';
import { LLMMockProvider } from '../../src/core/llm/LLMProvider';
import { MockEmbeddingProvider } from '../../src/core/rag/EmbeddingProvider';
import { ProductRecommendationService } from '../../src/domain/ecommerce/ProductRecommendationService';

describe('Phase 33C: Global Multi-Entity Compare + Catalog-Constrained Recommendation', { timeout: 25000 }, () => {
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
    (deps.ragService as any)['embeddingProvider'] = new MockEmbeddingProvider();
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

  async function seedStoreWithCatalog() {
    const tenant = await prisma.tenant.create({
      data: {
        name: `Tenant-CompRec-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        config: {
          create: {
            config: {
              ...DEFAULT_BUSINESS_CONFIG,
              llm: { provider: 'mock', model: 'mock-model' },
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

    // Product 1: Moon Hoodie (Heavy winter daily hoodie)
    const prodHoodieA = await prisma.product.create({
      data: {
        tenantId: tenant.id,
        accountId: account.id,
        category: 'Hoodies',
        sku: 'HOODIE-MOON',
        name: 'Moon Ninja Hoodie',
        nameLocalized: { en: 'Moon Ninja Hoodie', fr: 'Sweat à Capuche Moon Ninja', ar: 'هودي مون نينجا' },
        description: 'Heavyweight fleece hoodie perfect for cold winter days and everyday casual wear.',
        descriptionLocalized: { en: 'Heavyweight fleece hoodie perfect for cold winter days and everyday casual wear.' },
        price: 350.0,
        currency: 'MAD',
        stock: 15,
        variants: {
          create: [
            { sku: 'HOODIE-MOON-BLK-M', color: 'Black', size: 'M', stock: 10, priceOverride: 350.0 },
            { sku: 'HOODIE-MOON-BLK-L', color: 'Black', size: 'L', stock: 5, priceOverride: 350.0 }
          ]
        }
      },
      include: { variants: true }
    });

    // Product 2: Cyber Jacket (Waterproof lightweight jacket)
    const prodJacketB = await prisma.product.create({
      data: {
        tenantId: tenant.id,
        accountId: account.id,
        category: 'Jackets',
        sku: 'JACKET-CYBER',
        name: 'Cyber Windbreaker Jacket',
        nameLocalized: { en: 'Cyber Windbreaker Jacket', fr: 'Veste Coupe-vent Cyber', ar: 'جاكيت سايبر' },
        description: 'Lightweight waterproof jacket designed for summer and spring.',
        descriptionLocalized: { en: 'Lightweight waterproof jacket designed for summer and spring.' },
        price: 500.0,
        currency: 'MAD',
        stock: 8,
        variants: {
          create: [
            { sku: 'JACKET-CYBER-BLK-M', color: 'Black', size: 'M', stock: 8, priceOverride: 500.0 }
          ]
        }
      },
      include: { variants: true }
    });

    // Product 3: Basic Daily Tee (Budget casual daily t-shirt)
    const prodTeeC = await prisma.product.create({
      data: {
        tenantId: tenant.id,
        accountId: account.id,
        category: 'T-Shirts',
        sku: 'TEE-BASIC',
        name: 'Anime Graphic T-Shirt',
        nameLocalized: { en: 'Anime Graphic T-Shirt', fr: 'T-Shirt Graphique Anime', ar: 'تيشورت أنمي' },
        description: 'Comfortable 100% cotton tee designed for daily casual use in summer.',
        descriptionLocalized: { en: 'Comfortable 100% cotton tee designed for daily casual use in summer.' },
        price: 150.0,
        currency: 'MAD',
        stock: 20,
        variants: {
          create: [
            { sku: 'TEE-BASIC-WHT-L', color: 'White', size: 'L', stock: 20, priceOverride: 150.0 }
          ]
        }
      },
      include: { variants: true }
    });

    return { tenant, account, prodHoodieA, prodJacketB, prodTeeC };
  }

  describe('Multi-Entity Comparison', () => {
    it('1. current product + explicit product resolves both and compares', async () => {
      const { tenant, account, prodHoodieA, prodJacketB } = await seedStoreWithCatalog();

      // Turn 1: Select Hoodie
      await deps.conversationEngine.handleMessage(tenant.id, 'cust-comp-1', 'Moon Ninja Hoodie', account.id);

      // Turn 2: Compare with Cyber Jacket
      const res = await deps.conversationEngine.handleMessage(
        tenant.id,
        'cust-comp-1',
        'قارنها مع Cyber Windbreaker Jacket',
        account.id
      );

      expect(res).toBeTruthy();
      expect(res).toMatch(/(?:Moon Ninja Hoodie|هودي مون نينجا)/);
      expect(res).toMatch(/(?:Cyber Windbreaker Jacket|جاكيت سايبر)/);
      expect(res).toContain('350');
      expect(res).toContain('500');
    });

    it('2. current product + category resolves candidate product from category', async () => {
      const { tenant, account, prodHoodieA } = await seedStoreWithCatalog();

      // Turn 1: Select Hoodie
      await deps.conversationEngine.handleMessage(tenant.id, 'cust-comp-2', 'Moon Ninja Hoodie', account.id);

      // Turn 2: Compare with Jacket category
      const res = await deps.conversationEngine.handleMessage(
        tenant.id,
        'cust-comp-2',
        'قارنها ليا مع شي جاكيط',
        account.id
      );

      expect(res).toBeTruthy();
      expect(res).toMatch(/(?:Moon Ninja Hoodie|هودي مون نينجا)/);
      expect(res).toMatch(/(?:Cyber Windbreaker Jacket|جاكيت سايبر)/);
    });

    it('3. two explicit products in single query compares both', async () => {
      const { tenant, account } = await seedStoreWithCatalog();

      const res = await deps.conversationEngine.handleMessage(
        tenant.id,
        'cust-comp-3',
        'قارن بين Moon Ninja Hoodie و Cyber Windbreaker Jacket',
        account.id
      );

      expect(res).toBeTruthy();
      expect(res).toMatch(/(?:Moon Ninja Hoodie|هودي مون نينجا)/);
      expect(res).toMatch(/(?:Cyber Windbreaker Jacket|جاكيت سايبر)/);
    });

    it('4. ordinal reference + explicit target resolves accurately', async () => {
      const { tenant, account } = await seedStoreWithCatalog();

      // Turn 1: Search products
      await deps.conversationEngine.handleMessage(tenant.id, 'cust-comp-4', 'show me hoodies and jackets', account.id);

      // Turn 2: Compare ordinal 1 with Cyber Jacket
      const res = await deps.conversationEngine.handleMessage(
        tenant.id,
        'cust-comp-4',
        'قارن الأولى مع Cyber Windbreaker Jacket',
        account.id
      );

      expect(res).toBeTruthy();
      expect(res).toMatch(/(?:Cyber Windbreaker Jacket|جاكيت سايبر)/);
    });

    it('5. missing second target returns safe clarification', async () => {
      const { tenant, account } = await seedStoreWithCatalog();

      const res = await deps.conversationEngine.handleMessage(
        tenant.id,
        'cust-comp-5',
        'قارن',
        account.id
      );

      expect(res).toBeTruthy();
      expect(res).toMatch(/(?:mal9inach|سمح ليا|Désolé|Sorry|عذراً)/i);
    });

    it('6. duplicate targets are cleanly deduplicated', async () => {
      const { tenant, account, prodHoodieA } = await seedStoreWithCatalog();

      const comp = await deps.ecommerceService.compareProducts(
        tenant.id,
        account.id,
        [{ id: prodHoodieA.id }, { id: prodHoodieA.id }],
        'en'
      );

      expect(comp.targets.length).toBe(1);
    });

    it('7. variant-aware comparison reflects variant price override', async () => {
      const { tenant, account, prodHoodieA, prodJacketB } = await seedStoreWithCatalog();

      const comp = await deps.ecommerceService.compareProducts(
        tenant.id,
        account.id,
        [{ id: prodHoodieA.id, size: 'M' }, { id: prodJacketB.id, size: 'M' }],
        'en'
      );

      expect(comp.targets.length).toBe(2);
      expect(comp.targets[0].selectedVariant?.size).toBe('M');
      expect(comp.targets[1].selectedVariant?.size).toBe('M');
    });

    it('8. comparison follow-up resolves comparisonTargets ("شكون أرخص؟")', async () => {
      const { tenant, account } = await seedStoreWithCatalog();

      // Turn 1: Compare two items
      await deps.conversationEngine.handleMessage(
        tenant.id,
        'cust-comp-8',
        'قارن بين Moon Ninja Hoodie و Cyber Windbreaker Jacket',
        account.id
      );

      // Turn 2: Follow-up question about cheapest
      const resFollowUp = await deps.conversationEngine.handleMessage(
        tenant.id,
        'cust-comp-8',
        'شكون أرخص؟',
        account.id
      );

      expect(resFollowUp).toBeTruthy();
      expect(resFollowUp).toMatch(/(?:Moon Ninja Hoodie|هودي مون نينجا)/);
      expect(resFollowUp).toContain('350');
    });

    it('9. no hallucinated comparison facts - uses exact catalog attributes', async () => {
      const { tenant, account, prodHoodieA, prodJacketB } = await seedStoreWithCatalog();

      const comp = await deps.ecommerceService.compareProducts(
        tenant.id,
        account.id,
        [{ id: prodHoodieA.id }, { id: prodJacketB.id }],
        'en'
      );

      expect(comp.targets[0].effectivePrice).toBe(350);
      expect(comp.targets[1].effectivePrice).toBe(500);
      expect(comp.comparedAttributes).toContain('price');
      expect(comp.comparedAttributes).toContain('stock');
    });

    it('10. Arabic compare works', async () => {
      const { tenant, account } = await seedStoreWithCatalog();
      const res = await deps.conversationEngine.handleMessage(
        tenant.id,
        'cust-comp-10',
        'قارن بين هودي وجاكيت',
        account.id
      );
      expect(res).toMatch(/(?:مقارنة|Product Comparison)/);
    });

    it('11. Darija compare works', async () => {
      const { tenant, account } = await seedStoreWithCatalog();
      const res = await deps.conversationEngine.handleMessage(
        tenant.id,
        'cust-comp-11',
        'قارن هاد Moon Ninja Hoodie مع Cyber Windbreaker Jacket عافاك',
        account.id
      );
      expect(res).toContain('350');
      expect(res).toContain('500');
    });

    it('12. Arabizi compare works', async () => {
      const { tenant, account } = await seedStoreWithCatalog();
      const res = await deps.conversationEngine.handleMessage(
        tenant.id,
        'cust-comp-12',
        '9aren bin Moon Ninja Hoodie w Cyber Windbreaker Jacket',
        account.id
      );
      expect(res).toContain('350');
      expect(res).toContain('500');
    });

    it('13. French compare works', async () => {
      const { tenant, account } = await seedStoreWithCatalog();
      const res = await deps.conversationEngine.handleMessage(
        tenant.id,
        'cust-comp-13',
        'Compare Moon Ninja Hoodie et Cyber Windbreaker Jacket',
        account.id
      );
      expect(res).toContain('Comparaison');
    });

    it('14. English compare works', async () => {
      const { tenant, account } = await seedStoreWithCatalog();
      const res = await deps.conversationEngine.handleMessage(
        tenant.id,
        'cust-comp-14',
        'Compare Moon Ninja Hoodie vs Cyber Windbreaker Jacket',
        account.id
      );
      expect(res).toContain('Product Comparison');
    });
  });

  describe('Catalog-Constrained Recommendation', () => {
    it('15. daily-use recommendation ranks daily-wear product highest', async () => {
      const { tenant, account } = await seedStoreWithCatalog();

      const rec = await deps.ecommerceService.getRecommendations(
        tenant.id,
        account.id,
        { useCase: 'daily_use' },
        'en'
      );

      expect(rec.hasGroundedRecommendation).toBe(true);
      expect(rec.topFact).toBeDefined();
      expect(rec.topFact?.displayName).toContain('T-Shirt'); // 150 MAD daily tee or hoodie
    });

    it('16. winter recommendation ranks heavy fleece hoodie highest', async () => {
      const { tenant, account } = await seedStoreWithCatalog();

      const rec = await deps.ecommerceService.getRecommendations(
        tenant.id,
        account.id,
        { season: 'winter' },
        'en'
      );

      expect(rec.hasGroundedRecommendation).toBe(true);
      expect(rec.topFact?.displayName).toContain('Hoodie');
    });

    it('17. budget-constrained recommendation respects maximum price', async () => {
      const { tenant, account } = await seedStoreWithCatalog();

      const rec = await deps.ecommerceService.getRecommendations(
        tenant.id,
        account.id,
        { budget: 200 },
        'en'
      );

      expect(rec.hasGroundedRecommendation).toBe(true);
      expect(rec.topFact?.effectivePrice).toBeLessThanOrEqual(200);
      expect(rec.topFact?.displayName).toContain('T-Shirt');
    });

    it('18. category-constrained recommendation ranks products inside category', async () => {
      const { tenant, account } = await seedStoreWithCatalog();

      const rec = await deps.ecommerceService.getRecommendations(
        tenant.id,
        account.id,
        { category: 'Jackets' },
        'en'
      );

      expect(rec.hasGroundedRecommendation).toBe(true);
      expect(rec.topFact?.displayName).toContain('Jacket');
    });

    it('19. size constraint matches in-stock variant size', async () => {
      const { tenant, account } = await seedStoreWithCatalog();

      const rec = await deps.ecommerceService.getRecommendations(
        tenant.id,
        account.id,
        { size: 'L' },
        'en'
      );

      expect(rec.hasGroundedRecommendation).toBe(true);
      expect(rec.topFact?.selectedVariant?.size).toBe('L');
    });

    it('20. color constraint matches in-stock variant color', async () => {
      const { tenant, account } = await seedStoreWithCatalog();

      const rec = await deps.ecommerceService.getRecommendations(
        tenant.id,
        account.id,
        { color: 'Black' },
        'en'
      );

      expect(rec.hasGroundedRecommendation).toBe(true);
      expect(rec.topFact?.selectedVariant?.color).toBe('Black');
    });

    it('21. multiple criteria (winter + hoodies + budget 400) matches Moon Hoodie', async () => {
      const { tenant, account } = await seedStoreWithCatalog();

      const rec = await deps.ecommerceService.getRecommendations(
        tenant.id,
        account.id,
        { season: 'winter', category: 'Hoodies', budget: 400 },
        'en'
      );

      expect(rec.hasGroundedRecommendation).toBe(true);
      expect(rec.topFact?.displayName).toContain('Hoodie');
      expect(rec.topFact?.effectivePrice).toBe(350);
    });

    it('22. no-evidence safe fallback when no catalog matches', async () => {
      const { tenant, account } = await seedStoreWithCatalog();

      const rec = await deps.ecommerceService.getRecommendations(
        tenant.id,
        account.id,
        { category: 'Accessories', budget: 50 }, // No accessories in catalog
        'en'
      );

      expect(rec.hasGroundedRecommendation).toBe(false);
      expect(rec.topFact).toBeNull();
    });

    it('23. recommendation uses only catalog facts and authoritative stock', async () => {
      const { tenant, account } = await seedStoreWithCatalog();

      const rec = await deps.ecommerceService.getRecommendations(
        tenant.id,
        account.id,
        { useCase: 'daily_use' },
        'en'
      );

      expect(rec.topFact?.inStock).toBe(true);
      expect(rec.topFact?.availableStock).toBeGreaterThan(0);
    });

    it('24. deterministic ranking produces identical score ordering across repeated runs', async () => {
      const { tenant, account } = await seedStoreWithCatalog();

      const rec1 = await deps.ecommerceService.getRecommendations(tenant.id, account.id, { season: 'winter' }, 'en');
      const rec2 = await deps.ecommerceService.getRecommendations(tenant.id, account.id, { season: 'winter' }, 'en');

      expect(rec1.topFact?.product.id).toBe(rec2.topFact?.product.id);
      expect(rec1.recommendations[0].score).toBe(rec2.recommendations[0].score);
    });

    it('25. 0 LLM calls during recommendation ranking', async () => {
      const { tenant, account } = await seedStoreWithCatalog();
      let llmCalls = 0;
      const origGenerate = mockLlm.generateResponse.bind(mockLlm);
      mockLlm.generateResponse = async (...args) => {
        llmCalls++;
        return origGenerate(...args);
      };

      await deps.conversationEngine.handleMessage(
        tenant.id,
        'cust-rec-25',
        'Which one is best for winter?',
        account.id
      );

      expect(llmCalls).toBe(0); // Pure catalog-grounded composition
    });

    it('26. 0 embedding calls during recommendation ranking', async () => {
      const { tenant, account } = await seedStoreWithCatalog();

      let embCalls = 0;
      const embProvider = (deps.ragService as any)['embeddingProvider'];
      const origEmbed = embProvider.embedText.bind(embProvider);
      embProvider.embedText = async (...args: any[]) => {
        embCalls++;
        return origEmbed(...args);
      };

      await deps.ecommerceService.getRecommendations(
        tenant.id,
        account.id,
        { season: 'winter', category: 'Hoodies' },
        'en'
      );

      expect(embCalls).toBe(0);
    });
  });
});
