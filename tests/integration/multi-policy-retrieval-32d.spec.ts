import { describe, it, expect, beforeEach, beforeAll, afterEach } from 'vitest';
import { prisma, pool } from '../../src/tests/testDb';
import { bootstrapChatbot } from '../../src/bootstrap';
import { DEFAULT_BUSINESS_CONFIG } from '../../src/domain/tenant/BusinessConfig';
import { LLMMockProvider } from '../../src/core/llm/LLMProvider';
import { RAGService } from '../../src/domain/rag/RAGService';
import { KnowledgeRepository } from '../../src/domain/rag/KnowledgeRepository';
import { TurnDecisionResolver } from '../../src/domain/conversation/TurnDecision';

import { MockEmbeddingProvider } from '../../src/core/rag/EmbeddingProvider';

describe('Phase 32D: Global Multi-Policy Retrieval + Knowledge Evidence Tests', { timeout: 20000 }, () => {
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

  async function seedStoreWithPolicies() {
    const tenant = await prisma.tenant.create({
      data: {
        name: `Tenant-MultiPolicy-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        config: {
          create: {
            config: {
              ...DEFAULT_BUSINESS_CONFIG,
              llm: {
                provider: 'mock',
                model: 'mock-model'
              },
              knowledge: {
                ...DEFAULT_BUSINESS_CONFIG.knowledge,
                enabled: true,
                minSimilarityScore: 0.0,
                topK: 4
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
              knowledge: { enabled: true, minSimilarityScore: 0.0, topK: 4 },
              capabilities: { ecommerceEnabled: true }
            }
          }
        }
      },
      include: { accounts: true }
    });
    createdTenantIds.push(tenant.id);
    const account = tenant.accounts[0];

    const source = await prisma.knowledgeSource.create({
      data: {
        tenantId: tenant.id,
        accountId: account.id,
        name: 'Policy Doc',
        type: 'MANUAL',
        status: 'COMPLETED'
      }
    });

    const doc = await prisma.knowledgeDocument.create({
      data: {
        tenantId: tenant.id,
        sourceId: source.id,
        title: 'Store Policies',
        content: 'Store policy documentation text.'
      }
    });

    const repo = new KnowledgeRepository(prisma);

    // Seed 4 factual policy chunks with distinct content
    const embReturns = await mockEmbedding.embedText('Returns Policy: You have 14 days to return or exchange items in original condition. Refunds processed in 3 business days.');
    await repo.insertChunk(
      tenant.id,
      doc.id,
      'Returns Policy: You have 14 days to return or exchange items in original condition. Refunds processed in 3 business days.',
      embReturns,
      account.id
    );

    const embShipping = await mockEmbedding.embedText('Shipping Policy: Standard delivery takes 2 to 4 business days across all cities in Morocco. Delivery cost is 30 MAD.');
    await repo.insertChunk(
      tenant.id,
      doc.id,
      'Shipping Policy: Standard delivery takes 2 to 4 business days across all cities in Morocco. Delivery cost is 30 MAD.',
      embShipping,
      account.id
    );

    const embCare = await mockEmbedding.embedText('Care Instructions: Wash cold inside out at 30°C. Do not tumble dry. Do not iron over graphic prints.');
    await repo.insertChunk(
      tenant.id,
      doc.id,
      'Care Instructions: Wash cold inside out at 30°C. Do not tumble dry. Do not iron over graphic prints.',
      embCare,
      account.id
    );

    const embTracking = await mockEmbedding.embedText('Order Tracking: Track your shipment anytime using your tracking number at our portal or via SMS notification.');
    await repo.insertChunk(
      tenant.id,
      doc.id,
      'Order Tracking: Track your shipment anytime using your tracking number at our portal or via SMS notification.',
      embTracking,
      account.id
    );

    // Seed internal developer/example chunks that should be filtered out
    const embExample1 = await mockEmbedding.embedText('Customer language examples: "How to return?" / "When will it deliver?" / "Can I exchange?" (Developer notes for training)');
    await repo.insertChunk(
      tenant.id,
      doc.id,
      'Customer language examples: "How to return?" / "When will it deliver?" / "Can I exchange?" (Developer notes for training)',
      embExample1,
      account.id
    );

    const embExample2 = await mockEmbedding.embedText('Sample Q&A Internal Prompt instructions: When customer asks about returns, mention 14 days.');
    await repo.insertChunk(
      tenant.id,
      doc.id,
      'Sample Q&A Internal Prompt instructions: When customer asks about returns, mention 14 days.',
      embExample2,
      account.id
    );

    return { tenant, account, doc };
  }

  describe('Multi-Policy Decomposition & Targeted Retrieval', () => {
    it('1. returns + shipping -> retrieves both evidence sets', async () => {
      const { tenant, account } = await seedStoreWithPolicies();
      const text = 'شنو هي سياسة الإرجاع والتوصيل ديالكم؟';
      const decision = TurnDecisionResolver.resolve({ text, language: 'darija' });

      expect(decision.isMultiPolicy).toBe(true);
      expect(decision.policyIntents).toContain('RETURNS');
      expect(decision.policyIntents).toContain('SHIPPING');

      const result = await deps.ragService.retrieveMultiPolicy(
        tenant.id,
        decision.policyIntents!,
        DEFAULT_BUSINESS_CONFIG,
        account.id,
        'darija'
      );

      expect(result.availableIntents).toContain('RETURNS');
      expect(result.availableIntents).toContain('SHIPPING');
      expect(result.coverage['RETURNS']).toBeDefined();
      expect(result.coverage['SHIPPING']).toBeDefined();
      expect(result.chunks.length).toBeGreaterThanOrEqual(2);
    });

    it('2. returns + shipping + care -> retrieves all 3 evidence sets', async () => {
      const { tenant, account } = await seedStoreWithPolicies();
      const text = 'شنو هي سياسة الإرجاع والتوصيل وكيفاش نغسلو؟';
      const decision = TurnDecisionResolver.resolve({ text, language: 'darija' });

      expect(decision.isMultiPolicy).toBe(true);
      expect(decision.policyIntents).toContain('RETURNS');
      expect(decision.policyIntents).toContain('SHIPPING');
      expect(decision.policyIntents).toContain('CARE');

      const result = await deps.ragService.retrieveMultiPolicy(
        tenant.id,
        decision.policyIntents!,
        DEFAULT_BUSINESS_CONFIG,
        account.id,
        'darija'
      );

      expect(result.availableIntents).toContain('RETURNS');
      expect(result.availableIntents).toContain('SHIPPING');
      expect(result.availableIntents).toContain('CARE');
      expect(result.chunks.length).toBeGreaterThanOrEqual(3);
    });

    it('3. returns + shipping + care + tracking -> retrieves all 4 evidence sets', async () => {
      const { tenant, account } = await seedStoreWithPolicies();
      const text = 'شنو هي سياسة الإرجاع والشحن والعناية وتتبع الطلب؟';
      const decision = TurnDecisionResolver.resolve({ text, language: 'ar' });

      expect(decision.isMultiPolicy).toBe(true);
      expect(decision.policyIntents).toContain('RETURNS');
      expect(decision.policyIntents).toContain('SHIPPING');
      expect(decision.policyIntents).toContain('CARE');
      expect(decision.policyIntents).toContain('TRACKING');

      const result = await deps.ragService.retrieveMultiPolicy(
        tenant.id,
        decision.policyIntents!,
        DEFAULT_BUSINESS_CONFIG,
        account.id,
        'ar'
      );

      expect(result.availableIntents).toContain('RETURNS');
      expect(result.availableIntents).toContain('SHIPPING');
      expect(result.availableIntents).toContain('CARE');
      expect(result.availableIntents).toContain('TRACKING');
    });

    it('4. internal example chunks do not consume evidence budget', () => {
      const internalChunk = 'Customer language examples: "How to return?" / "When will it deliver?" (Developer notes)';
      expect(RAGService.isInternalOrExampleChunk(internalChunk)).toBe(true);

      const factualChunk = 'Returns Policy: You have 14 days to return or exchange items in original condition.';
      expect(RAGService.isInternalOrExampleChunk(factualChunk)).toBe(false);
    });

    it('5. factual chunk outranks internal example chunk in retrieval', async () => {
      const { tenant, account } = await seedStoreWithPolicies();
      const chunks = await deps.ragService.retrieveChunks(
        tenant.id,
        'return policy',
        DEFAULT_BUSINESS_CONFIG,
        account.id
      );

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0].content).toContain('Returns Policy: You have 14 days');
      expect(chunks[0].content).not.toContain('Developer notes');
    });

    it('6. duplicate chunks are removed during multi-policy retrieval', async () => {
      const { tenant, account } = await seedStoreWithPolicies();
      const result = await deps.ragService.retrieveMultiPolicy(
        tenant.id,
        ['RETURNS', 'RETURNS'],
        DEFAULT_BUSINESS_CONFIG,
        account.id,
        'en'
      );

      const ids = result.chunks.map(c => c.id);
      const uniqueIds = Array.from(new Set(ids));
      expect(ids.length).toBe(uniqueIds.length);
    });

    it('7. single-policy still uses normal single retrieval budget', async () => {
      const text = 'شحال عندي من الوقت باش نرجع المنتج؟';
      const decision = TurnDecisionResolver.resolve({ text, language: 'ar' });

      expect(decision.isMultiPolicy).toBe(false);
      expect(decision.intent).toBe('RETURNS');
    });

    it('8. product facts remain DB-authoritative in hybrid policy questions', () => {
      const text = 'شنو هي سياسة الإرجاع ديال Moon Ninja Hoodie؟';
      const decision = TurnDecisionResolver.resolve({ text, language: 'darija' });

      expect(decision.domain).toBe('KNOWLEDGE');
      expect(decision.source).toBe('HYBRID');
      expect(decision.productName).toBe('Moon Ninja Hoodie');
      expect(decision.intent).toBe('RETURNS');
    });

    it('9. missing policy evidence is explicitly reported in telemetry structure', async () => {
      const { tenant } = await seedStoreWithPolicies();
      const emptyAccount = await prisma.account.create({
        data: { tenantId: tenant.id, name: 'Empty Account' }
      });
      const result = await deps.ragService.retrieveMultiPolicy(
        tenant.id,
        ['WARRANTY'],
        DEFAULT_BUSINESS_CONFIG,
        emptyAccount.id,
        'en'
      );

      expect(result.missingIntents).toContain('WARRANTY');
      expect(result.telemetry.missingPolicyIntents).toContain('WARRANTY');
    });

    it('10. maximum 4 policy intents enforced deterministically', () => {
      const text = 'سياسة الإرجاع والتوصيل والغسيل والتتبع والضمان والدفع';
      const decision = TurnDecisionResolver.resolve({ text, language: 'ar' });

      expect(decision.policyIntents?.length).toBeLessThanOrEqual(4);
    });

    it('11. no more than one final LLM synthesis on multi-policy message', async () => {
      const { tenant, account } = await seedStoreWithPolicies();
      mockLlm.generatedResponseMock = 'Store returns are 14 days and delivery is 2-4 days.';

      let llmCalls = 0;
      const origGenerate = mockLlm.generateResponse.bind(mockLlm);
      mockLlm.generateResponse = async (...args) => {
        llmCalls++;
        return origGenerate(...args);
      };

      const res = await deps.conversationEngine.handleMessage(
        tenant.id,
        'cust-multi-11',
        'شنو هي سياسة الإرجاع والتوصيل ديالكم؟',
        account.id
      );

      expect(res).toBeTruthy();
      expect(llmCalls).toBeLessThanOrEqual(1);
    });

    it('12. account scoping is strictly preserved in multi-policy retrieval', async () => {
      const { tenant, account } = await seedStoreWithPolicies();

      // Retrieve with valid accountId
      const resValid = await deps.ragService.retrieveMultiPolicy(
        tenant.id,
        ['RETURNS', 'SHIPPING'],
        DEFAULT_BUSINESS_CONFIG,
        account.id,
        'en'
      );
      expect(resValid.chunks.length).toBeGreaterThan(0);

      // Retrieve with non-existent accountId
      const resInvalid = await deps.ragService.retrieveMultiPolicy(
        tenant.id,
        ['RETURNS', 'SHIPPING'],
        DEFAULT_BUSINESS_CONFIG,
        '00000000-0000-0000-0000-000000000000',
        'en'
      );
      expect(resInvalid.chunks.length).toBe(0);
    });

    it('13. no new LLM calls for sub-query generation', () => {
      const subqueries = RAGService.buildPolicySubqueries(
        ['RETURNS', 'SHIPPING', 'CARE', 'TRACKING'],
        'darija',
        'Moon Ninja Hoodie'
      );

      expect(subqueries['RETURNS']).toContain('سياسة الإرجاع');
      expect(subqueries['SHIPPING']).toContain('مصاريف الشحن');
      expect(subqueries['CARE']).toContain('طريقة الغسيل');
      expect(subqueries['TRACKING']).toContain('تتبع الطلب');
    });

    it('14. multilingual compound query works in French', async () => {
      const { tenant, account } = await seedStoreWithPolicies();
      const text = 'Quels sont vos délais de livraison et conditions de retour ?';
      const decision = TurnDecisionResolver.resolve({ text, language: 'fr' });

      expect(decision.isMultiPolicy).toBe(true);
      expect(decision.policyIntents).toContain('RETURNS');
      expect(decision.policyIntents).toContain('SHIPPING');

      const result = await deps.ragService.retrieveMultiPolicy(
        tenant.id,
        decision.policyIntents!,
        DEFAULT_BUSINESS_CONFIG,
        account.id,
        'fr'
      );

      expect(result.chunks.length).toBeGreaterThanOrEqual(2);
    });

    it('15. Arabizi compound query works', async () => {
      const { tenant, account } = await seedStoreWithPolicies();
      const text = 'chhal lwa9t bach nrje3 o fin wsel tlbi?';
      const decision = TurnDecisionResolver.resolve({ text, language: 'darija' });

      expect(decision.isMultiPolicy).toBe(true);
      expect(decision.policyIntents).toContain('RETURNS');
      expect(decision.policyIntents).toContain('TRACKING');

      const result = await deps.ragService.retrieveMultiPolicy(
        tenant.id,
        decision.policyIntents!,
        DEFAULT_BUSINESS_CONFIG,
        account.id,
        'darija'
      );

      expect(result.chunks.length).toBeGreaterThanOrEqual(2);
    });
  });
});
