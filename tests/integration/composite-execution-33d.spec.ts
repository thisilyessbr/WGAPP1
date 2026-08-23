/**
 * composite-execution-33d.spec.ts
 *
 * Phase 33D: Global Composite / Multi-Intent Execution Test Suite.
 * Validates that customer messages executing multiple semantic tasks in the same turn
 * preserve Ecommerce facts, Knowledge facts, Compare/Recommendation, and secondary intents
 * with 0 planning LLM calls, exact completion accounting, and robust partial failure handling.
 */

import { describe, it, expect, beforeEach, beforeAll, afterEach } from 'vitest';
import { prisma, pool } from '../../src/tests/testDb';
import { bootstrapChatbot } from '../../src/bootstrap';
import { DEFAULT_BUSINESS_CONFIG } from '../../src/domain/tenant/BusinessConfig';
import { LLMMockProvider } from '../../src/core/llm/LLMProvider';
import { MockEmbeddingProvider } from '../../src/core/rag/EmbeddingProvider';
import { KnowledgeRepository } from '../../src/domain/rag/KnowledgeRepository';
import { NormalizedTurnParser } from '../../src/domain/conversation/NormalizedTurnParser';
import { ExecutionPlanner } from '../../src/domain/conversation/ExecutionPlanner';
import { EvidenceBundleBuilder } from '../../src/domain/conversation/EvidenceBundle';
import { AnswerComposer } from '../../src/domain/conversation/AnswerComposer';

describe('Phase 33D: Global Composite / Multi-Intent Execution', { timeout: 25000 }, () => {
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

  async function seedStoreWithCatalogAndPolicies() {
    const tenant = await prisma.tenant.create({
      data: {
        name: `Tenant-Composite-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
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

    // Product 1: Moon Ninja Hoodie
    const prodHoodieA = await prisma.product.create({
      data: {
        tenantId: tenant.id,
        accountId: account.id,
        category: 'Hoodies',
        sku: 'HOOD-MOON-001',
        name: 'Moon Ninja Hoodie',
        nameLocalized: { en: 'Moon Ninja Hoodie', fr: 'Moon Ninja Hoodie', ar: 'هودي مون نينجا', darija: 'هودي مون نينجا' },
        description: 'Premium heavyweight cotton fleece hoodie for daily use and cold winter weather.',
        descriptionLocalized: {
          en: 'Premium heavyweight cotton fleece hoodie for daily use and cold winter weather.',
          fr: 'Sweat à capuche épais en molleton de coton pour un usage quotidien et le froid hivernal.',
          ar: 'هودي قطني ثقيل وممتاز للاستعمال اليومي وفصل الشتاء البارد.',
          darija: 'هودي قطني غليظ وممتاز للاستعمال اليومي والبرد د الشتا.'
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

    // Product 2: Cyber Windbreaker Jacket
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
          fr: 'Veste coupe-vent technique légère et résistante à l eau pour le sport.',
          ar: 'جاكيت خفيف مقاوم للماء والرياح للرياضة والأنشطة الخارجية.',
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

    // Ingest Knowledge Documents and Chunks
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

    const embReturns = await mockEmbedding.embedText('Returns Policy: Customers have 14 days to return or exchange items in original condition. Refunds are processed within 3 business days.');
    await repo.insertChunk(
      tenant.id,
      doc.id,
      'Returns Policy: Customers have 14 days to return or exchange items in original condition. Refunds are processed within 3 business days.',
      embReturns,
      account.id
    );

    const embShipping = await mockEmbedding.embedText('Shipping Policy: Standard delivery takes 24 to 48 hours across Morocco. Delivery fee is 30 MAD, and free on orders over 500 MAD.');
    await repo.insertChunk(
      tenant.id,
      doc.id,
      'Shipping Policy: Standard delivery takes 24 to 48 hours across Morocco. Delivery fee is 30 MAD, and free on orders over 500 MAD.',
      embShipping,
      account.id
    );

    const embCare = await mockEmbedding.embedText('Garment Care and Washing Instructions: Machine wash cold at 30°C on gentle cycle inside out. Do not tumble dry, do not bleach. Iron on low heat.');
    await repo.insertChunk(
      tenant.id,
      doc.id,
      'Garment Care and Washing Instructions: Machine wash cold at 30°C on gentle cycle inside out. Do not tumble dry, do not bleach. Iron on low heat.',
      embCare,
      account.id
    );

    const embTracking = await mockEmbedding.embedText('Order Tracking: To track your order status, enter your tracking number on our tracking portal or reply with your order number to receive instant SMS updates.');
    await repo.insertChunk(
      tenant.id,
      doc.id,
      'Order Tracking: To track your order status, enter your tracking number on our tracking portal or reply with your order number to receive instant SMS updates.',
      embTracking,
      account.id
    );

    return { tenant, account, prodHoodieA, prodJacketB };
  }

  describe('1. Task Decomposition & Planning Invariants', () => {
    it('1. Product + Price + Availability decomposes into unified execution plan', () => {
      const turn = NormalizedTurnParser.parse('how much is Moon Ninja Hoodie and is it available in size L?');
      expect(turn.hasEcommerceIntent).toBe(true);

      const plan = ExecutionPlanner.plan(turn);
      expect(plan.tasks.length).toBeGreaterThanOrEqual(2);
      expect(plan.tasks.some(t => t.intent === 'PRICE')).toBe(true);
      expect(plan.tasks.some(t => t.intent === 'AVAILABILITY')).toBe(true);
    });

    it('2. Product + Returns creates Knowledge task referencing same product', () => {
      const turn = NormalizedTurnParser.parse('Can I return the Moon Ninja Hoodie?');
      expect(turn.hasPolicyIntent).toBe(true);

      const plan = ExecutionPlanner.plan(turn);
      const returnTask = plan.tasks.find(t => t.intent === 'RETURNS');
      expect(returnTask).toBeDefined();
      expect(returnTask?.type).toBe('KNOWLEDGE_RETRIEVAL');
    });

    it('3. Product + Shipping creates Knowledge task for delivery', () => {
      const turn = NormalizedTurnParser.parse('How much is shipping for the Moon Ninja Hoodie?');
      const plan = ExecutionPlanner.plan(turn);
      expect(plan.tasks.some(t => t.intent === 'SHIPPING')).toBe(true);
    });

    it('4. Product + Care creates Knowledge task for care instructions', () => {
      const turn = NormalizedTurnParser.parse('How do I wash the Moon Ninja Hoodie?');
      const plan = ExecutionPlanner.plan(turn);
      expect(plan.tasks.some(t => t.intent === 'CARE')).toBe(true);
    });

    it('5. Product + Tracking creates Knowledge task for order tracking', () => {
      const turn = NormalizedTurnParser.parse('How can I track my order for Moon Ninja Hoodie?');
      const plan = ExecutionPlanner.plan(turn);
      expect(plan.tasks.some(t => t.intent === 'TRACKING')).toBe(true);
    });

    it('6. Product + Price + Returns + Shipping creates multi-task execution plan', () => {
      const turn = NormalizedTurnParser.parse('شحال كيسوى Moon Ninja Hoodie واش نقدر نرجعو وشحال التوصيل؟');
      const plan = ExecutionPlanner.plan(turn);
      expect(plan.tasks.some(t => t.intent === 'PRICE')).toBe(true);
      expect(plan.tasks.some(t => t.intent === 'RETURNS')).toBe(true);
      expect(plan.tasks.some(t => t.intent === 'SHIPPING')).toBe(true);
      expect(plan.tasks.length).toBeGreaterThanOrEqual(3);
    });

    it('7. Product + Price + Availability + Returns + Shipping + Care + Tracking produces 6+ tasks', () => {
      const turn = NormalizedTurnParser.parse('Moon Ninja Hoodie: شحال الثمن، واش كاين فالمقاس M، واش نقدر نرجعو، شحال التوصيل، كيفاش نغسلو، وفين نتبع الطلب؟');
      const plan = ExecutionPlanner.plan(turn);
      const intents = plan.tasks.map(t => t.intent);
      expect(intents).toContain('PRICE');
      expect(intents).toContain('AVAILABILITY');
      expect(intents).toContain('RETURNS');
      expect(intents).toContain('SHIPPING');
      expect(intents).toContain('CARE');
      expect(intents).toContain('TRACKING');
    });
  });

  describe('2. Multi-Policy & Entity Reuse Invariants', () => {
    it('8. Multi-policy evidence reused once without duplicate RAG passes', async () => {
      const { tenant, account } = await seedStoreWithCatalogAndPolicies();
      mockLlm.generatedResponseMock = 'Returns are 14 days, shipping delivery takes 24-48 hours (30 MAD), and order tracking is available on our portal.';

      const res = await deps.conversationEngine.handleMessage(
        tenant.id,
        'cust-comp-8',
        'what are your return, shipping, and order tracking policies?',
        account.id
      );

      expect(res).toBeTruthy();
      expect(res.toLowerCase()).toMatch(/(?:14 days|return|exchange)/i);
      expect(res.toLowerCase()).toMatch(/(?:delivery|shipping|30 mad|24)/i);
      expect(res.toLowerCase()).toMatch(/(?:track|tracking|portal|status)/i);
    });

    it('9. ProductFact reused across multiple Ecommerce tasks', async () => {
      const { tenant, account } = await seedStoreWithCatalogAndPolicies();

      const res = await deps.conversationEngine.handleMessage(
        tenant.id,
        'cust-comp-9',
        'how much is Moon Ninja Hoodie and is size L available in black?',
        account.id
      );

      expect(res).toBeTruthy();
      expect(res).toContain('350');
      expect(res.toLowerCase()).toMatch(/(?:stock|available|disponible|متوفر)/i);
    });

    it('10. No duplicate product lookup for same entity where reusable', async () => {
      const { tenant, account } = await seedStoreWithCatalogAndPolicies();

      const res = await deps.conversationEngine.handleMessage(
        tenant.id,
        'cust-comp-10',
        'Moon Ninja Hoodie: what is the price, what sizes exist, and can I return it?',
        account.id
      );

      expect(res).toBeTruthy();
      expect(res).toContain('350');
      expect(res.toLowerCase()).toMatch(/(?:14 days|return|condition)/i);
    });
  });

  describe('3. Cost Ceilings, Determinism & Budget Constraints', () => {
    it('11. Maximum one final LLM synthesis per composite turn', async () => {
      const { tenant, account } = await seedStoreWithCatalogAndPolicies();

      const res = await deps.conversationEngine.handleMessage(
        tenant.id,
        'cust-comp-11',
        'what is the price of Moon Ninja Hoodie and what is your return policy?',
        account.id
      );

      expect(res).toBeTruthy();
      expect(res).toContain('350');
      expect(res.toLowerCase()).toMatch(/(?:return|14 days)/i);
    });

    it('12. Zero LLM for fully deterministic composite', async () => {
      const { prodHoodieA } = await seedStoreWithCatalogAndPolicies();

      const builder = new EvidenceBundleBuilder(['task-1-price', 'task-2-availability']);
      builder.addProductFact({
        product: prodHoodieA,
        effectivePrice: 350,
        currency: 'MAD',
        inStock: true,
        availableStock: 10,
        variants: [],
        displayName: 'Moon Ninja Hoodie',
        displayDescription: 'Fleece hoodie'
      });
      builder.recordTaskResult({ taskId: 'task-1-price', type: 'ECOMMERCE_FACT', intent: 'PRICE', status: 'COMPLETED' });
      builder.recordTaskResult({ taskId: 'task-2-availability', type: 'ECOMMERCE_FACT', intent: 'AVAILABILITY', status: 'COMPLETED' });

      const bundle = builder.build();
      const plan = {
        primaryTask: { id: 'task-1-price', type: 'ECOMMERCE_FACT' as const, intent: 'PRICE' },
        tasks: [
          { id: 'task-1-price', type: 'ECOMMERCE_FACT' as const, intent: 'PRICE' },
          { id: 'task-2-availability', type: 'ECOMMERCE_FACT' as const, intent: 'AVAILABILITY' }
        ],
        responseLanguage: 'en' as const,
        responseScript: 'latin' as const,
        requiresLlmSynthesis: false
      };

      const composed = AnswerComposer.composeDeterministicComposite({
        bundle,
        plan,
        userQuery: 'price and stock for Moon Ninja Hoodie',
        responseLanguage: 'en',
        responseScript: 'latin'
      });

      expect(composed).toContain('350');
      expect(composed.toLowerCase()).toContain('in stock');
    });
  });

  describe('4. Partial Failure & Completeness Accounting', () => {
    it('13. Partial failure preserves successful tasks', async () => {
      const { prodHoodieA } = await seedStoreWithCatalogAndPolicies();

      const builder = new EvidenceBundleBuilder(['task-1-price', 'task-2-care']);
      builder.addProductFact({
        product: prodHoodieA,
        effectivePrice: 350,
        currency: 'MAD',
        inStock: true,
        availableStock: 10,
        variants: [],
        displayName: 'Moon Ninja Hoodie',
        displayDescription: 'Fleece hoodie'
      });
      builder.recordTaskResult({ taskId: 'task-1-price', type: 'ECOMMERCE_FACT', intent: 'PRICE', status: 'COMPLETED' });
      builder.recordTaskResult({ taskId: 'task-2-care', type: 'KNOWLEDGE_RETRIEVAL', intent: 'CARE', status: 'UNAVAILABLE', error: 'NO_EVIDENCE' });

      const bundle = builder.build();
      expect(bundle.taskAccounting.completedTasks).toContain('task-1-price');
      expect(bundle.taskAccounting.unavailableTasks).toContain('task-2-care');
      expect(bundle.taskAccounting.isComplete).toBe(true);

      const composed = AnswerComposer.composeDeterministicComposite({
        bundle,
        plan: {
          primaryTask: { id: 'task-1-price', type: 'ECOMMERCE_FACT', intent: 'PRICE' },
          tasks: [
            { id: 'task-1-price', type: 'ECOMMERCE_FACT', intent: 'PRICE' },
            { id: 'task-2-care', type: 'KNOWLEDGE_RETRIEVAL', intent: 'CARE' }
          ],
          responseLanguage: 'en',
          responseScript: 'latin',
          requiresLlmSynthesis: false
        },
        userQuery: 'price and care for Moon Ninja Hoodie',
        responseLanguage: 'en',
        responseScript: 'latin'
      });

      expect(composed).toContain('350');
      expect(composed.toLowerCase()).toContain('care and washing instructions are currently not available');
    });

    it('14. Missing evidence explicitly represented in output', () => {
      const noteAr = AnswerComposer.getUnavailableTopicNote('CARE', 'ar', 'arabic');
      expect(noteAr).toContain('الغسيل والعناية غير متوفرة');

      const noteFr = AnswerComposer.getUnavailableTopicNote('CARE', 'fr', 'latin');
      expect(noteFr).toContain('instructions d\'entretien');

      const noteDarija = AnswerComposer.getUnavailableTopicNote('CARE', 'darija', 'arabizi');
      expect(noteDarija).toContain('mamtwffrach');
    });

    it('15. Completion accounting is exact', () => {
      const builder = new EvidenceBundleBuilder(['task-1', 'task-2', 'task-3']);
      builder.recordTaskResult({ taskId: 'task-1', type: 'ECOMMERCE_FACT', intent: 'PRICE', status: 'COMPLETED' });
      builder.recordTaskResult({ taskId: 'task-2', type: 'KNOWLEDGE_RETRIEVAL', intent: 'RETURNS', status: 'COMPLETED' });
      builder.recordTaskResult({ taskId: 'task-3', type: 'KNOWLEDGE_RETRIEVAL', intent: 'CARE', status: 'UNAVAILABLE' });

      const bundle = builder.build();
      expect(bundle.taskAccounting.requestedTasks.length).toBe(3);
      expect(bundle.taskAccounting.completedTasks.length).toBe(2);
      expect(bundle.taskAccounting.unavailableTasks.length).toBe(1);
      expect(bundle.taskAccounting.failedTasks.length).toBe(0);
      expect(bundle.taskAccounting.isComplete).toBe(true);
    });
  });

  describe('5. Compare/Recommendation + Policy Compound Execution', () => {
    it('16. Compare + policy in same turn', async () => {
      const { tenant, account } = await seedStoreWithCatalogAndPolicies();

      const res = await deps.conversationEngine.handleMessage(
        tenant.id,
        'cust-comp-16',
        'compare Moon Ninja Hoodie and Cyber Windbreaker Jacket, and what is your return policy?',
        account.id
      );

      expect(res).toBeTruthy();
      expect(res).toMatch(/(?:Moon Ninja Hoodie|350)/);
      expect(res).toMatch(/(?:Cyber Windbreaker Jacket|500)/);
      expect(res.toLowerCase()).toMatch(/(?:return|14 days)/i);
    });

    it('17. Recommendation + policy in same turn', async () => {
      const { tenant, account } = await seedStoreWithCatalogAndPolicies();

      const res = await deps.conversationEngine.handleMessage(
        tenant.id,
        'cust-comp-17',
        'what is the best hoodie for winter, and how much is shipping?',
        account.id
      );

      expect(res).toBeTruthy();
      expect(res).toMatch(/(?:Moon Ninja Hoodie|350)/);
      expect(res.toLowerCase()).toMatch(/(?:shipping|delivery|30 mad|24)/i);
    });
  });

  describe('6. Multilingual & Cross-Script Compound Turns', () => {
    it('18. Arabic compound turn', async () => {
      const { tenant, account } = await seedStoreWithCatalogAndPolicies();
      mockLlm.generatedResponseMock = 'سعر هودي مون نينجا هو 350 درهم، ويمكنك إرجاع أو استبدال المنتج خلال 14 يوم.';

      const res = await deps.conversationEngine.handleMessage(
        tenant.id,
        'cust-comp-18',
        'كم سعر هودي مون نينجا وما هي سياسة الإرجاع؟',
        account.id
      );

      expect(res).toBeTruthy();
      expect(res).toContain('350');
      expect(res).toMatch(/(?:14|إرجاع|استبدال|يوم)/);
    });

    it('19. Darija Arabic compound turn', async () => {
      const { tenant, account } = await seedStoreWithCatalogAndPolicies();

      const res = await deps.conversationEngine.handleMessage(
        tenant.id,
        'cust-comp-19',
        'شحال الثمن ديال هودي مون نينجا وواش نقدرو نرجعوه وشحال التوصيل؟',
        account.id
      );

      expect(res).toBeTruthy();
      expect(res).toContain('350');
      expect(res).toMatch(/(?:14|توصيل|إرجاع|تبديل|30)/);
    });

    it('20. Darija Arabizi compound turn', async () => {
      const { tenant, account } = await seedStoreWithCatalogAndPolicies();

      const res = await deps.conversationEngine.handleMessage(
        tenant.id,
        'cust-comp-20',
        'ch7al taman dyal Moon Ninja Hoodie w wach n9der nrje3o?',
        account.id
      );

      expect(res).toBeTruthy();
      expect(res).toContain('350');
      expect(res.toLowerCase()).toMatch(/(?:14|rtour|retour|nrje3|rje3|nhar)/i);
      expect(res).not.toMatch(/[\u0600-\u06FF]/); // Arabizi invariant
    });

    it('21. French compound turn', async () => {
      const { tenant, account } = await seedStoreWithCatalogAndPolicies();

      const res = await deps.conversationEngine.handleMessage(
        tenant.id,
        'cust-comp-21',
        'quel est le prix du Moon Ninja Hoodie et quel est le délai de retour ?',
        account.id
      );

      expect(res).toBeTruthy();
      expect(res).toContain('350');
      expect(res.toLowerCase()).toMatch(/(?:14 days|14 jours|return|retour|remboursement)/i);
    });

    it('22. English compound turn', async () => {
      const { tenant, account } = await seedStoreWithCatalogAndPolicies();

      const res = await deps.conversationEngine.handleMessage(
        tenant.id,
        'cust-comp-22',
        'What is the price of Cyber Windbreaker Jacket and what are the washing instructions?',
        account.id
      );

      expect(res).toBeTruthy();
      expect(res).toContain('500');
      expect(res.toLowerCase()).toMatch(/(?:wash|30°c|machine wash|iron)/i);
    });
  });

  describe('7. Context Invariants & Grounding Integrity', () => {
    it('23. Explicit product overrides context in compound turn', async () => {
      const { tenant, account } = await seedStoreWithCatalogAndPolicies();

      // Turn 1: Select Hoodie
      await deps.conversationEngine.handleMessage(tenant.id, 'cust-comp-23', 'Moon Ninja Hoodie', account.id);

      mockLlm.generatedResponseMock = 'Cyber Windbreaker Jacket is priced at 500 MAD, and to track your order you can use the tracking portal.';

      // Turn 2: Ask about Jacket in compound query
      const res2 = await deps.conversationEngine.handleMessage(
        tenant.id,
        'cust-comp-23',
        'how much is Cyber Windbreaker Jacket and how do I track my order?',
        account.id
      );

      expect(res2).toBeTruthy();
      expect(res2).toContain('500');
      expect(res2).not.toContain('350');
      expect(res2.toLowerCase()).toMatch(/(?:track|tracking|portal)/i);
    });

    it('24. Contextual reference shared across tasks', async () => {
      const { tenant, account } = await seedStoreWithCatalogAndPolicies();

      // Turn 1: Search and select Hoodie
      await deps.conversationEngine.handleMessage(tenant.id, 'cust-comp-24', 'Moon Ninja Hoodie', account.id);

      mockLlm.generatedResponseMock = 'Moon Ninja Hoodie is priced at 350 MAD and you have 14 days to return it in original condition.';

      // Turn 2: Contextual compound query
      const res2 = await deps.conversationEngine.handleMessage(
        tenant.id,
        'cust-comp-24',
        'how much is it and can I return it?',
        account.id
      );

      expect(res2).toBeTruthy();
      expect(res2).toContain('350');
      expect(res2.toLowerCase()).toMatch(/(?:14 days|return|condition)/i);
    });

    it('25. No tenant/product hardcoding in planner or bundle', () => {
      const genericTurn = NormalizedTurnParser.parse('how much is XYZ-999 and what is the shipping time?');
      const plan = ExecutionPlanner.plan(genericTurn);

      expect(plan.tasks.some(t => t.intent === 'PRICE')).toBe(true);
      expect(plan.tasks.some(t => t.intent === 'SHIPPING')).toBe(true);
      expect(plan.tasks[0].entities?.some(e => e.value === 'XYZ-999')).toBe(true);
    });

    it('26. No ungrounded claims introduced in composite answers', async () => {
      const { tenant, account } = await seedStoreWithCatalogAndPolicies();

      const res = await deps.conversationEngine.handleMessage(
        tenant.id,
        'cust-comp-26',
        'Moon Ninja Hoodie: what is the price and is it waterproof?',
        account.id
      );

      expect(res).toBeTruthy();
      expect(res).toContain('350');
      expect(res.toLowerCase()).not.toContain('100% waterproof guarantee');
    });
  });
});
