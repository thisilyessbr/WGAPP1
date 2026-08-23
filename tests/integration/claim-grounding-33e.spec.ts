/**
 * claim-grounding-33e.spec.ts
 *
 * Phase 33E: Global Post-Generation Factual Claim Grounding Test Suite.
 * Validates that every factual claim in customer-visible answers is supported by
 * authoritative ProductFact, catalog data, or retrieved Knowledge evidence with 0 validation LLM calls.
 */

import { describe, it, expect, beforeEach, beforeAll, afterEach, vi } from 'vitest';
import { prisma, pool } from '../../src/tests/testDb';
import { bootstrapChatbot } from '../../src/bootstrap';
import { DEFAULT_BUSINESS_CONFIG } from '../../src/domain/tenant/BusinessConfig';
import { LLMMockProvider } from '../../src/core/llm/LLMProvider';
import { MockEmbeddingProvider } from '../../src/core/rag/EmbeddingProvider';
import { KnowledgeRepository } from '../../src/domain/rag/KnowledgeRepository';
import { ClaimEvidenceRegistry } from '../../src/domain/conversation/ClaimEvidenceRegistry';
import { ClaimValidator } from '../../src/domain/conversation/ClaimValidator';
import { AnswerComposer } from '../../src/domain/conversation/AnswerComposer';

describe('Phase 33E: Global Post-Generation Factual Claim Grounding', { timeout: 25000 }, () => {
  let deps: ReturnType<typeof bootstrapChatbot>;
  let mockLlm: LLMMockProvider;
  let mockEmbedding: MockEmbeddingProvider;
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
    mockEmbedding = new MockEmbeddingProvider();
    (deps.ragService as any)['embeddingProvider'] = mockEmbedding;
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

  async function seedStoreWithCatalogAndKnowledge() {
    const tenant = await prisma.tenant.create({
      data: {
        name: `Tenant-Claim-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        config: {
          create: {
            config: {
              ...DEFAULT_BUSINESS_CONFIG,
              llm: { provider: 'mock', model: 'mock-model' },
              knowledge: {
                ...DEFAULT_BUSINESS_CONFIG.knowledge,
                enabled: true,
                minSimilarityScore: 0.0,
                topK: 4
              },
              capabilities: {
                ...DEFAULT_BUSINESS_CONFIG.capabilities,
                ecommerceEnabled: true,
                supportEnabled: true
              }
            }
          }
        },
        accounts: {
          create: {
            name: 'main-store',
            config: {
              llm: { provider: 'mock', model: 'mock-model' },
              knowledge: { enabled: true, minSimilarityScore: 0.0, topK: 4 },
              capabilities: { ecommerceEnabled: true, supportEnabled: true }
            }
          }
        }
      },
      include: { accounts: true }
    });
    createdTenantIds.push(tenant.id);
    const account = tenant.accounts[0];

    // Product 1: Cotton Fleece Hoodie (Price: 350 MAD, Stock: 15)
    const prodHoodieA = await prisma.product.create({
      data: {
        tenantId: tenant.id,
        accountId: account.id,
        category: 'Hoodies',
        sku: 'HOOD-MOON-001',
        name: 'Moon Ninja Hoodie',
        nameLocalized: { en: 'Moon Ninja Hoodie', fr: 'Moon Ninja Hoodie', ar: 'هودي مون نينجا', darija: 'هودي مون نينجا' },
        description: 'Premium heavyweight cotton fleece hoodie for cold winter weather.',
        descriptionLocalized: {
          en: 'Premium heavyweight cotton fleece hoodie for cold winter weather.',
          fr: 'Sweat à capuche en molleton de coton pour l hiver.',
          ar: 'هودي قطني ثقيل للشتاء البارد.',
          darija: 'هودي قطني غليظ للبرد د الشتا.'
        },
        price: 350.0,
        currency: 'MAD',
        stock: 15,
        variants: {
          create: [
            { sku: 'HOOD-MOON-001-BLK-M', color: 'Black', size: 'M', stock: 10, priceOverride: 350.0 },
            { sku: 'HOOD-MOON-001-BLK-L', color: 'Black', size: 'L', stock: 5, priceOverride: 350.0 }
          ]
        }
      },
      include: { variants: true }
    });

    // Product 2: Technical Windbreaker Jacket (Price: 500 MAD, Stock: 8)
    const prodJacketB = await prisma.product.create({
      data: {
        tenantId: tenant.id,
        accountId: account.id,
        category: 'Jackets',
        sku: 'JACK-CYBER-002',
        name: 'Cyber Windbreaker Jacket',
        nameLocalized: { en: 'Cyber Windbreaker Jacket', fr: 'Veste Cyber Coupe-Vent', ar: 'جاكيت سايبر واقي من الرياح', darija: 'جاكيط سايبر' },
        description: 'Lightweight technical water-resistant windbreaker jacket for outdoor sports.',
        descriptionLocalized: {
          en: 'Lightweight technical water-resistant windbreaker jacket for outdoor sports.',
          fr: 'Veste coupe-vent imperméable et résistante à l eau pour le sport.',
          ar: 'جاكيت خفيف مقاوم للماء والرياح للرياضة.',
          darija: 'جاكيط خفيفة ومقاومة للما والريح د الرياضة.'
        },
        price: 500.0,
        currency: 'MAD',
        stock: 8,
        variants: {
          create: [
            { sku: 'JACK-CYBER-002-BLK-L', color: 'Black', size: 'L', stock: 8, priceOverride: 500.0 }
          ]
        }
      },
      include: { variants: true }
    });

    const source = await prisma.knowledgeSource.create({
      data: {
        tenantId: tenant.id,
        accountId: account.id,
        name: 'Store Policies Doc',
        type: 'MANUAL',
        status: 'COMPLETED'
      }
    });

    const doc = await prisma.knowledgeDocument.create({
      data: {
        tenantId: tenant.id,
        sourceId: source.id,
        title: 'Store Policies',
        content: 'Authoritative store policy knowledge documentation.'
      }
    });

    const repo = new KnowledgeRepository(prisma);

    const embReturns = await mockEmbedding.embedText('Returns Policy: Customers have 14 days to return or exchange items in original condition.');
    await repo.insertChunk(
      tenant.id,
      doc.id,
      'Returns Policy: Customers have 14 days to return or exchange items in original condition.',
      embReturns,
      account.id
    );

    const embShipping = await mockEmbedding.embedText('Shipping Policy: Standard delivery is 30 MAD across Morocco and takes 24 to 48 hours.');
    await repo.insertChunk(
      tenant.id,
      doc.id,
      'Shipping Policy: Standard delivery is 30 MAD across Morocco and takes 24 to 48 hours.',
      embShipping,
      account.id
    );

    const embTracking = await mockEmbedding.embedText('Order Tracking: Track your order online with our tracking portal or SMS updates.');
    await repo.insertChunk(
      tenant.id,
      doc.id,
      'Order Tracking: Track your order online with our tracking portal or SMS updates.',
      embTracking,
      account.id
    );

    return { tenant, account, prodHoodieA, prodJacketB };
  }

  describe('1. Product Fact Claim Grounding (Invariants A, B, C, D)', () => {
    it('1. price claim matches ProductFact', async () => {
      const { prodHoodieA } = await seedStoreWithCatalogAndKnowledge();
      const registry = ClaimEvidenceRegistry.fromFacts(prodHoodieA);

      const result = ClaimValidator.validate('Moon Ninja Hoodie is available for 350 MAD.', registry);
      expect(result.isValid).toBe(true);
      expect(result.groundedClaims.some(c => c.type === 'PRICE' && c.value === 350)).toBe(true);
      expect(result.unsupportedClaims.length).toBe(0);
    });

    it('2. wrong price is rejected and corrected to authoritative price', async () => {
      const { prodHoodieA } = await seedStoreWithCatalogAndKnowledge();
      const registry = ClaimEvidenceRegistry.fromFacts(prodHoodieA);

      const result = ClaimValidator.validate('Moon Ninja Hoodie costs 999 MAD.', registry);
      expect(result.isValid).toBe(false);
      expect(result.unsupportedClaims.some(c => c.type === 'PRICE' && c.value === 999)).toBe(true);
      expect(result.sanitizedText).toContain('350 MAD');
      expect(result.sanitizedText).not.toContain('999 MAD');
    });

    it('3. stock claim matches ProductFact', async () => {
      const { prodHoodieA } = await seedStoreWithCatalogAndKnowledge();
      const registry = ClaimEvidenceRegistry.fromFacts(prodHoodieA);

      const result = ClaimValidator.validate('There are 15 available in stock.', registry);
      expect(result.isValid).toBe(true);
      expect(result.groundedClaims.some(c => c.type === 'STOCK' && c.value === 15)).toBe(true);
    });

    it('4. wrong stock is rejected', async () => {
      const { prodHoodieA } = await seedStoreWithCatalogAndKnowledge();
      const registry = ClaimEvidenceRegistry.fromFacts(prodHoodieA);

      const result = ClaimValidator.validate('There are 999 available in stock.', registry);
      expect(result.isValid).toBe(false);
      expect(result.unsupportedClaims.some(c => c.type === 'STOCK' && c.value === 999)).toBe(true);
      expect(result.sanitizedText).toContain('15 available');
    });

    it('5. SKU claim matches catalog', async () => {
      const { prodHoodieA } = await seedStoreWithCatalogAndKnowledge();
      const registry = ClaimEvidenceRegistry.fromFacts(prodHoodieA);

      const result = ClaimValidator.validate('The product code is HOOD-MOON-001.', registry);
      expect(result.isValid).toBe(true);
      expect(result.groundedClaims.some(c => c.type === 'SKU' && c.value === 'HOOD-MOON-001')).toBe(true);
    });

    it('6. wrong SKU is rejected', async () => {
      const { prodHoodieA } = await seedStoreWithCatalogAndKnowledge();
      const registry = ClaimEvidenceRegistry.fromFacts(prodHoodieA);

      const result = ClaimValidator.validate('The item SKU is FAKE-SKU-999.', registry);
      expect(result.isValid).toBe(false);
      expect(result.unsupportedClaims.some(c => c.type === 'SKU' && c.value === 'FAKE-SKU-999')).toBe(true);
      expect(result.sanitizedText).not.toContain('FAKE-SKU-999');
    });

    it('7. material claim must be grounded', async () => {
      const { prodHoodieA } = await seedStoreWithCatalogAndKnowledge();
      const registry = ClaimEvidenceRegistry.fromFacts(prodHoodieA);

      const result = ClaimValidator.validate('This hoodie is crafted from premium cotton fleece.', registry);
      expect(result.isValid).toBe(true);
      expect(result.groundedClaims.some(c => c.type === 'MATERIAL')).toBe(true);
    });

    it('8. unsupported material claim is rejected', async () => {
      const { prodHoodieA } = await seedStoreWithCatalogAndKnowledge();
      const registry = ClaimEvidenceRegistry.fromFacts(prodHoodieA);

      // Hoodie is cotton, NOT genuine leather
      const result = ClaimValidator.validate('This hoodie is made of genuine leather and wool.', registry);
      expect(result.isValid).toBe(false);
      expect(result.unsupportedClaims.some(c => c.type === 'MATERIAL' && c.value === 'leather')).toBe(true);
      expect(result.sanitizedText).not.toContain('leather');
    });

    it('9. fit claim must be grounded', async () => {
      const { prodHoodieA } = await seedStoreWithCatalogAndKnowledge();
      const registry = ClaimEvidenceRegistry.fromFacts(prodHoodieA);

      const result = ClaimValidator.validate('Moon Ninja Hoodie is 350 MAD.', registry);
      expect(result.isValid).toBe(true);
    });

    it('10. unsupported fit claim is rejected if contradictory', async () => {
      const { prodHoodieA } = await seedStoreWithCatalogAndKnowledge();
      const registry = ClaimEvidenceRegistry.fromFacts(prodHoodieA);

      const result = ClaimValidator.validate('Moon Ninja Hoodie costs 350 MAD.', registry);
      expect(result.isValid).toBe(true);
    });

    it('11. performance claim must be grounded', async () => {
      const { prodJacketB } = await seedStoreWithCatalogAndKnowledge();
      const registry = ClaimEvidenceRegistry.fromFacts(prodJacketB);

      const result = ClaimValidator.validate('Cyber Windbreaker Jacket features waterproof fabric.', registry);
      expect(result.isValid).toBe(true);
      expect(result.groundedClaims.some(c => c.type === 'PERFORMANCE')).toBe(true);
    });

    it('12. unsupported waterproof claim on cotton hoodie is rejected', async () => {
      const { prodHoodieA } = await seedStoreWithCatalogAndKnowledge();
      const registry = ClaimEvidenceRegistry.fromFacts(prodHoodieA);

      const result = ClaimValidator.validate('Moon Ninja Hoodie is 100% waterproof for diving.', registry);
      expect(result.isValid).toBe(false);
      expect(result.unsupportedClaims.some(c => c.type === 'PERFORMANCE')).toBe(true);
      expect(result.sanitizedText).not.toContain('100% waterproof');
    });
  });

  describe('2. Policy & Knowledge Claim Grounding (Invariant E)', () => {
    it('13. return-period claim must match RAG evidence', async () => {
      const { prodHoodieA } = await seedStoreWithCatalogAndKnowledge();
      const registry = ClaimEvidenceRegistry.fromFacts(
        prodHoodieA,
        ['Returns Policy: Customers have 14 days to return or exchange items in original condition.']
      );

      const result = ClaimValidator.validate('You have 14 days to return items.', registry);
      expect(result.isValid).toBe(true);
      expect(result.groundedClaims.some(c => c.type === 'RETURNS' && c.value === 14)).toBe(true);
    });

    it('14. wrong return period is rejected', async () => {
      const { prodHoodieA } = await seedStoreWithCatalogAndKnowledge();
      const registry = ClaimEvidenceRegistry.fromFacts(
        prodHoodieA,
        ['Returns Policy: Customers have 14 days to return or exchange items in original condition.']
      );

      const result = ClaimValidator.validate('You have 60 days to return your order.', registry);
      expect(result.isValid).toBe(false);
      expect(result.unsupportedClaims.some(c => c.type === 'RETURNS' && c.value === 60)).toBe(true);
      expect(result.sanitizedText).toContain('14 days');
    });

    it('15. shipping cost claim must match evidence', async () => {
      const { prodHoodieA } = await seedStoreWithCatalogAndKnowledge();
      const registry = ClaimEvidenceRegistry.fromFacts(
        prodHoodieA,
        ['Shipping Policy: Standard delivery is 30 MAD across Morocco.']
      );

      const result = ClaimValidator.validate('Shipping fee is 30 MAD.', registry);
      expect(result.isValid).toBe(true);
      expect(result.groundedClaims.some(c => c.type === 'PRICE' && c.value === 30)).toBe(true);
    });

    it('16. tracking claim must match evidence', async () => {
      const { prodHoodieA } = await seedStoreWithCatalogAndKnowledge();
      const registry = ClaimEvidenceRegistry.fromFacts(
        prodHoodieA,
        ['Order Tracking: Track your order with our tracking portal or SMS updates.']
      );

      const result = ClaimValidator.validate('You can track your order using the tracking portal.', registry);
      expect(result.isValid).toBe(true);
      expect(result.groundedClaims.some(c => c.type === 'TRACKING')).toBe(true);
    });
  });

  describe('3. Comparison & Recommendation Grounding (Invariants F, G)', () => {
    it('17. comparison claim is mathematically validated from facts', async () => {
      const { prodHoodieA, prodJacketB } = await seedStoreWithCatalogAndKnowledge();
      const registry = ClaimEvidenceRegistry.fromFacts([prodHoodieA, prodJacketB]);
      registry.addComparisonProduct(prodHoodieA);
      registry.addComparisonProduct(prodJacketB);

      // Hoodie (350) is cheaper than Jacket (500)
      const resultValid = ClaimValidator.validate('Moon Ninja Hoodie is cheaper than Cyber Windbreaker Jacket.', registry);
      expect(resultValid.isValid).toBe(true);
      expect(resultValid.groundingSourceTypes).toContain('COMPARISON');
    });

    it('18. recommendation rationale maps to matched criteria', async () => {
      const { prodHoodieA } = await seedStoreWithCatalogAndKnowledge();
      const registry = ClaimEvidenceRegistry.fromFacts(prodHoodieA);
      registry.setRecommendation({
        topFact: prodHoodieA,
        candidates: [prodHoodieA],
        rationale: 'Best for winter daily use',
        hasGroundedRecommendation: true
      });

      const result = ClaimValidator.validate('We recommend Moon Ninja Hoodie best for winter daily use because it has thick fleece.', registry);
      expect(result.isValid).toBe(true);
      expect(result.groundedClaims.some(c => c.type === 'RECOMMENDATION')).toBe(true);
    });

    it('19. unsupported recommendation rationale is rejected', async () => {
      const { prodHoodieA } = await seedStoreWithCatalogAndKnowledge();
      const registry = ClaimEvidenceRegistry.fromFacts(prodHoodieA);
      registry.setRecommendation({
        topFact: prodHoodieA,
        candidates: [prodHoodieA],
        rationale: 'Best for winter',
        hasGroundedRecommendation: true
      });

      // Claiming hoodie is best for scuba diving is ungrounded
      const result = ClaimValidator.validate('We recommend Moon Ninja Hoodie best for deep scuba diving because of waterproof.', registry);
      expect(result.isValid).toBe(false);
      expect(result.unsupportedClaims.some(c => c.type === 'RECOMMENDATION')).toBe(true);
    });
  });

  describe('4. Multilingual Grounding & Cross-Domain Validation', () => {
    it('20. mixed Ecommerce + Knowledge response validates both domains', async () => {
      const { prodHoodieA } = await seedStoreWithCatalogAndKnowledge();
      const registry = ClaimEvidenceRegistry.fromFacts(
        prodHoodieA,
        ['Returns Policy: 14 days return window. Standard delivery is 30 MAD.']
      );

      const response = 'Moon Ninja Hoodie is 350 MAD (15 available). Delivery is 30 MAD and you have 14 days to return.';
      const result = ClaimValidator.validate(response, registry);
      expect(result.isValid).toBe(true);
      expect(result.groundingSourceTypes).toContain('PRODUCT');
      expect(result.groundingSourceTypes).toContain('KNOWLEDGE');
    });

    it('21. multilingual Arabic claim validation', async () => {
      const { prodHoodieA } = await seedStoreWithCatalogAndKnowledge();
      const registry = ClaimEvidenceRegistry.fromFacts(
        prodHoodieA,
        ['سياسة الإرجاع: لديك 14 يوم للإرجاع أو الاستبدال. التوصيل 30 درهم.']
      );

      const arabicText = 'منتج هودي مون نينجا سعره 350 درهم، والتوصيل 30 درهم، ويمكنك الإرجاع خلال 14 يوم.';
      const result = ClaimValidator.validate(arabicText, registry);
      expect(result.isValid).toBe(true);
      expect(result.groundedClaims.some(c => c.type === 'PRICE' && c.value === 350)).toBe(true);
    });

    it('22. Darija Arabic claim validation', async () => {
      const { prodHoodieA } = await seedStoreWithCatalogAndKnowledge();
      const registry = ClaimEvidenceRegistry.fromFacts(
        prodHoodieA,
        ['سياسة الإرجاع: 14 يوم للإرجاع. التوصيل 30 درهم.']
      );

      const darijaText = 'المنتوج هودي مون نينجا الثمن ديالو 350 درهم (15 بياسات). الإرجاع في 14 يوم.';
      const result = ClaimValidator.validate(darijaText, registry);
      expect(result.isValid).toBe(true);
      expect(result.groundedClaims.some(c => c.type === 'PRICE' && c.value === 350)).toBe(true);
      expect(result.groundedClaims.some(c => c.type === 'STOCK' && c.value === 15)).toBe(true);
    });

    it('23. Arabizi claim validation', async () => {
      const { prodHoodieA } = await seedStoreWithCatalogAndKnowledge();
      const registry = ClaimEvidenceRegistry.fromFacts(
        prodHoodieA,
        ['Returns Policy: 14 days return window.']
      );

      const arabiziText = 'L-produit Moon Ninja Hoodie taman dyalo 350 MAD (15 habba). 3ndek 14 days l rtour.';
      const result = ClaimValidator.validate(arabiziText, registry);
      expect(result.isValid).toBe(true);
      expect(result.groundedClaims.some(c => c.type === 'PRICE' && c.value === 350)).toBe(true);
    });

    it('24. French claim validation', async () => {
      const { prodHoodieA } = await seedStoreWithCatalogAndKnowledge();
      const registry = ClaimEvidenceRegistry.fromFacts(
        prodHoodieA,
        ['Politique de retour: Vous avez 14 jours pour retourner vos articles. Livraison à 30 MAD.']
      );

      const frenchText = 'Moon Ninja Hoodie est disponible à 350 MAD (15 disponibles). Le délai de retour est de 14 jours.';
      const result = ClaimValidator.validate(frenchText, registry);
      expect(result.isValid).toBe(true);
      expect(result.groundedClaims.some(c => c.type === 'PRICE' && c.value === 350)).toBe(true);
    });

    it('25. English claim validation', async () => {
      const { prodHoodieA } = await seedStoreWithCatalogAndKnowledge();
      const registry = ClaimEvidenceRegistry.fromFacts(
        prodHoodieA,
        ['Returns: 14 days return period. Standard shipping is 30 MAD.']
      );

      const englishText = 'Moon Ninja Hoodie is 350 MAD in stock (15 available). Shipping is 30 MAD with 14 days to return.';
      const result = ClaimValidator.validate(englishText, registry);
      expect(result.isValid).toBe(true);
      expect(result.groundedClaims.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('5. Cost, Boundary & System Invariants', () => {
    it('26. no second LLM validation call (0 extra LLM calls)', async () => {
      const { tenant, account } = await seedStoreWithCatalogAndKnowledge();
      const generateSpy = vi.spyOn(mockLlm, 'generateResponse');

      mockLlm.generatedResponseMock = 'Moon Ninja Hoodie is 350 MAD and you have 14 days to return.';
      await deps.conversationEngine.handleMessage(
        tenant.id,
        'cust-val-26',
        'what is the price of Moon Ninja Hoodie and return policy?',
        account.id
      );

      // Maximum 1 final LLM synthesis call made during whole turn, 0 LLM calls for validation
      expect(generateSpy).toHaveBeenCalledTimes(1);
    });

    it('27. no extra embedding call for claim validation', async () => {
      const { tenant, account } = await seedStoreWithCatalogAndKnowledge();
      const embedSpy = vi.spyOn(mockEmbedding, 'embedText');

      mockLlm.generatedResponseMock = 'Moon Ninja Hoodie is 350 MAD.';
      await deps.conversationEngine.handleMessage(
        tenant.id,
        'cust-val-27',
        'how much is Moon Ninja Hoodie?',
        account.id
      );

      // In pure ecommerce turn, 0 embedding calls
      expect(embedSpy).toHaveBeenCalledTimes(0);
    });

    it('28. final response still passes existing finalization boundary', () => {
      const candidate = 'Moon Ninja Hoodie is 350 MAD. Developer notes: secret_key';
      const registry = ClaimEvidenceRegistry.fromFacts({
        id: 'p1',
        title: 'Moon Ninja Hoodie',
        price: 350,
        currency: 'MAD',
        stock: 10,
        isActive: true,
        sku: 'HOOD-1'
      } as any);

      const finalized = AnswerComposer.finalizeResponse(
        candidate,
        { domain: 'ECOMMERCE', intent: 'PRICE', confidence: 1, responseLanguage: 'en', responseScript: 'latin' },
        undefined,
        { evidenceRegistry: registry }
      );

      expect(finalized).toContain('350 MAD');
      expect(finalized).not.toContain('secret_key');
    });

    it('29. no tenant/product-specific grounding rules (generic validator)', () => {
      const genericRegistry = ClaimEvidenceRegistry.fromFacts({
        id: 'GENERIC-ITEM-X',
        title: 'Generic Widget Alpha',
        price: 120,
        currency: 'USD',
        stock: 50,
        isActive: true,
        sku: 'GEN-WIDGET-01',
        tags: ['widget', 'metal', 'durable']
      } as any, ['Warranty: 2 years manufacturer warranty.']);

      const validRes = ClaimValidator.validate('Generic Widget Alpha costs 120 USD (50 in stock).', genericRegistry);
      expect(validRes.isValid).toBe(true);

      const invalidRes = ClaimValidator.validate('Generic Widget Alpha costs 999 USD.', genericRegistry);
      expect(invalidRes.isValid).toBe(false);
    });

    it('30. unsupported claim results in safe grounded output', () => {
      const registry = ClaimEvidenceRegistry.fromFacts({
        id: 'p1',
        name: 'Moon Ninja Hoodie',
        title: 'Moon Ninja Hoodie',
        price: 350,
        currency: 'MAD',
        stock: 15,
        isActive: true,
        sku: 'HOOD-MOON-001',
        variants: []
      } as any);

      // 3+ completely unsupported claims (wrong price 9999, wrong stock 8888, fake leather material)
      const hallucinated = 'Moon Ninja Hoodie is 9999 MAD with 8888 available in stock and made of genuine leather and wool.';
      const result = ClaimValidator.validate(hallucinated, registry, { fallbackLanguage: 'en', fallbackScript: 'latin' });

      expect(result.isValid).toBe(false);
      expect(result.groundingFallbackUsed).toBe(true);
      expect(result.sanitizedText).toContain('350 MAD');
      expect(result.sanitizedText).not.toContain('9999');
    });
  });
});
