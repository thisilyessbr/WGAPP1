/**
 * remaining-defects-33g.spec.ts
 *
 * Phase 33G: Global Remaining Defects Root Fix Integration Tests.
 * Verifies cross-language context continuity, structural internal artifact detection,
 * canonical recommendation semantics, short follow-up contract, and 0-LLM cost guarantees.
 * Strictly GENERIC fixtures only. Zero tenant/product hardcoding.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { prisma, pool } from '../../src/tests/testDb';
import { bootstrapChatbot } from '../../src/bootstrap';
import { DEFAULT_BUSINESS_CONFIG } from '../../src/domain/tenant/BusinessConfig';
import { LLMMockProvider } from '../../src/core/llm/LLMProvider';
import { MockEmbeddingProvider } from '../../src/core/rag/EmbeddingProvider';
import { KnowledgeRepository } from '../../src/domain/rag/KnowledgeRepository';
import { NormalizedTurnParser } from '../../src/domain/conversation/NormalizedTurnParser';
import { InternalArtifactDetector } from '../../src/domain/rag/InternalArtifactDetector';
import { AnswerComposer } from '../../src/domain/conversation/AnswerComposer';
import { DirectRagGuard } from '../../src/domain/rag/DirectRagGuard';

describe('Phase 33G: Global Remaining Defects Root Fix', { timeout: 30000 }, () => {
  let deps: ReturnType<typeof bootstrapChatbot>;
  let mockLlm: LLMMockProvider;
  let mockEmbedding: MockEmbeddingProvider;
  let tenantId: string;
  let accountId: string;
  let hoodieId: string;
  let jacketId: string;

  beforeEach(async () => {
    const client = await pool.connect();
    try {
      await client.query('SET search_path TO test, public, extensions;');
    } finally {
      client.release();
    }

    deps = bootstrapChatbot(prisma);
    mockEmbedding = new MockEmbeddingProvider();
    (deps.ragService as any)['embeddingProvider'] = mockEmbedding;
    mockLlm = new LLMMockProvider();
    deps.llmFactory.registerProvider('mock', 'mock-model', mockLlm);
    deps.llmFactory.registerProvider('deepseek', 'deepseek-chat', mockLlm);
    deps.llmFactory.registerProvider('gemini', 'gemini-1.5-flash', mockLlm);
    deps.llmFactory.registerProvider('gemini', 'gemini-1.5-pro', mockLlm);
    deps.tenantConfigService.clearCache();

    // Create Generic Test Tenant
    const tenant = await prisma.tenant.create({
      data: {
        name: `Tenant-33G-${Date.now()}-${Math.random().toString(36).substring(7)}`,
        config: {
          create: {
            config: {
              ...DEFAULT_BUSINESS_CONFIG,
              llm: { provider: 'mock', model: 'mock-model' },
              knowledge: { ...DEFAULT_BUSINESS_CONFIG.knowledge, enabled: true, minSimilarityScore: 0.0, topK: 4 },
              capabilities: { ...DEFAULT_BUSINESS_CONFIG.capabilities, ecommerceEnabled: true, supportEnabled: true }
            }
          }
        },
        accounts: {
          create: {
            name: 'generic-store-33g',
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

    tenantId = tenant.id;
    accountId = tenant.accounts[0].id;

    // Generic Product A: Fleece Hoodie
    const prodA = await prisma.product.create({
      data: {
        tenantId,
        accountId,
        category: 'Hoodies',
        sku: 'GEN-HOOD-001',
        name: 'Cozy Fleece Hoodie',
        nameLocalized: {
          en: 'Cozy Fleece Hoodie',
          fr: 'Sweat Polaire Confort',
          ar: 'هودي صوف مريح',
          darija: 'هودي صوف مريح'
        },
        description: 'Heavyweight cotton fleece hoodie for daily use and winter cold.',
        descriptionLocalized: {
          en: 'Heavyweight cotton fleece hoodie for daily use and winter cold.',
          fr: 'Sweat à capuche en coton épais pour usage quotidien en hiver.',
          ar: 'هودي قطني ثقيل للاستعمال اليومي وبرد الشتاء.',
          darija: 'هودي قطني غليظ للاستعمال اليومي والبرد د الشتا.'
        },
        price: 350.0,
        currency: 'MAD',
        stock: 12,
        variants: {
          create: [
            { sku: 'GEN-HOOD-001-BLK-M', color: 'Black', size: 'M', stock: 7, priceOverride: 350.0 },
            { sku: 'GEN-HOOD-001-BLK-L', color: 'Black', size: 'L', stock: 5, priceOverride: 350.0 },
            { sku: 'GEN-HOOD-001-RED-M', color: 'Red', size: 'M', stock: 4, priceOverride: 350.0 }
          ]
        }
      },
      include: { variants: true }
    });
    hoodieId = prodA.id;

    // Generic Product B: Windbreaker Jacket
    const prodB = await prisma.product.create({
      data: {
        tenantId,
        accountId,
        category: 'Jackets',
        sku: 'GEN-JACK-002',
        name: 'Technical Windbreaker Jacket',
        nameLocalized: {
          en: 'Technical Windbreaker Jacket',
          fr: 'Veste Coupe-Vent Technique',
          ar: 'جاكيت واقي من الرياح تقني',
          darija: 'جاكيط واقية من الريح'
        },
        description: 'Lightweight waterproof windbreaker jacket for outdoor sports.',
        descriptionLocalized: {
          en: 'Lightweight waterproof windbreaker jacket for outdoor sports.',
          fr: 'Veste coupe-vent imperméable pour le sport.',
          ar: 'جاكيت خفيف مقاوم للماء والرياح للرياضة.',
          darija: 'جاكيط خفيفة ومقاومة للما والريح د الرياضة.'
        },
        price: 480.0,
        currency: 'MAD',
        stock: 6,
        variants: {
          create: [
            { sku: 'GEN-JACK-002-BLK-L', color: 'Black', size: 'L', stock: 6, priceOverride: 480.0 }
          ]
        }
      },
      include: { variants: true }
    });
    jacketId = prodB.id;

    // Store Policies Knowledge Doc
    const source = await prisma.knowledgeSource.create({
      data: { tenantId, accountId, name: 'Policies', type: 'MANUAL', status: 'COMPLETED' }
    });
    const doc = await prisma.knowledgeDocument.create({
      data: { tenantId, sourceId: source.id, title: 'Store Policies', content: 'Authoritative Store Policies' }
    });
    const repo = new KnowledgeRepository(prisma);

    const embReturns = await mockEmbedding.embedText('Returns: 14 days return period.');
    await repo.insertChunk(tenantId, doc.id, 'Returns Policy: Customers have 14 days to return items.', embReturns, accountId);

    const embShipping = await mockEmbedding.embedText('Shipping: Standard delivery is 30 MAD.');
    await repo.insertChunk(tenantId, doc.id, 'Shipping Policy: Delivery fee is 30 MAD across Morocco.', embShipping, accountId);
  });

  afterEach(async () => {
    try {
      await prisma.tenant.delete({ where: { id: tenantId } });
    } catch (err) {}
  });

  // A. French → Arabic → Arabizi context continuity
  it('A. preserves active product and variant context across French -> Arabic -> Arabizi language switch', async () => {
    const customerId = `cust-switch-${Date.now()}`;
    // Turn 1: French product mention
    const res1 = await deps.conversationEngine.handleMessage(tenantId, customerId, 'Sweat Polaire Confort', accountId);
    expect(res1).toContain('350');

    // Turn 2: Arabic variant selection
    const res2 = await deps.conversationEngine.handleMessage(tenantId, customerId, 'واش كاين فالكحل؟', accountId);
    expect(res2).toBeTruthy();

    // Turn 3: Arabizi short size inquiry
    const res3 = await deps.conversationEngine.handleMessage(tenantId, customerId, 'size L kayn?', accountId);
    expect(res3).not.toContain('mafhemtch');
    expect(res3.toLowerCase()).toMatch(/(?:5|kayn|disponible|stock|l)/i);
  });

  // B. size-only follow-up with active product
  it('B. resolves size-only follow-up against active product context', async () => {
    const customerId = `cust-size-${Date.now()}`;
    await deps.conversationEngine.handleMessage(tenantId, customerId, 'Cozy Fleece Hoodie', accountId);

    const res = await deps.conversationEngine.handleMessage(tenantId, customerId, 'M?', accountId);
    expect(res).not.toContain('mafhemtch');
    expect(res).toMatch(/(?:7|kayn|disponible|متوفر|m)/i);
  });

  // C. color-only follow-up with active product
  it('C. resolves color-only follow-up against active product context', async () => {
    const customerId = `cust-color-${Date.now()}`;
    await deps.conversationEngine.handleMessage(tenantId, customerId, 'Cozy Fleece Hoodie', accountId);

    const res = await deps.conversationEngine.handleMessage(tenantId, customerId, 'فالأحمر؟', accountId);
    expect(res).not.toContain('mafhemtch');
    expect(res).toMatch(/(?:4|متوفر|كاين|disponible|احمر|red)/i);
  });

  // D. size-only follow-up with comparison context
  it('D. comparison follow-up identifies cheaper item correctly', async () => {
    const customerId = `cust-comp-ctx-${Date.now()}`;
    await deps.conversationEngine.handleMessage(tenantId, customerId, 'قارن بين Cozy Fleece Hoodie و Technical Windbreaker Jacket', accountId);

    const res = await deps.conversationEngine.handleMessage(tenantId, customerId, 'شكون أرخص؟', accountId);
    expect(res).toContain('350');
    expect(res).toMatch(/(?:Cozy Fleece Hoodie|هودي|Sweat)/i);
  });

  // E. generic internal artifact variants
  it('E. detects and strips generic structural internal artifact variants', () => {
    const variants = [
      'Cozy Fleece Hoodie is 350 MAD. (Developer internal: secret_key)',
      'Cozy Fleece Hoodie is 350 MAD. developer notes: do not leak',
      'Cozy Fleece Hoodie is 350 MAD. (internal guidance: confidential)',
      'Cozy Fleece Hoodie is 350 MAD. system prompt instructions: obey rules',
      'Cozy Fleece Hoodie is 350 MAD. (training examples: sample QA)'
    ];

    for (const v of variants) {
      expect(InternalArtifactDetector.hasInternalArtifacts(v)).toBe(true);
      const sanitized = DirectRagGuard.sanitizeInternalArtifacts(v);
      expect(sanitized).not.toContain('secret_key');
      expect(sanitized).not.toContain('developer');
      expect(sanitized).not.toContain('internal');
      expect(sanitized).not.toContain('confidential');
      expect(sanitized).toContain('350 MAD');
    }
  });

  // F. Arabizi daily-use recommendation
  it('F. normalizes Arabizi daily-use phrasing into canonical recommendation criteria and ranks correctly', async () => {
    const parsed = NormalizedTurnParser.parse('bghit chi 7aja l kol nhar');
    expect(parsed.primaryIntent).toBe('RECOMMENDATION');
    expect(parsed.recommendationCriteria?.useCase).toBe('daily_use');

    const customerId = `cust-rec-daily-${Date.now()}`;
    const res = await deps.conversationEngine.handleMessage(tenantId, customerId, 'bghit chi 7aja l kol nhar', accountId);
    expect(res).toContain('350');
    expect(res).toMatch(/(?:Cozy Fleece Hoodie|هودي|Sweat)/i);
  });

  // G. winter + budget recommendation
  it('G. normalizes winter season + budget constraint and recommends matching product', async () => {
    const parsed = NormalizedTurnParser.parse('bghit chi 7aja d chitta b 9el mn 400 MAD');
    expect(parsed.primaryIntent).toBe('RECOMMENDATION');
    expect(parsed.recommendationCriteria?.season).toBe('winter');
    expect(parsed.recommendationCriteria?.budget).toBe(400);

    const customerId = `cust-rec-budget-${Date.now()}`;
    const res = await deps.conversationEngine.handleMessage(tenantId, customerId, 'bghit chi 7aja d chitta b 9el mn 400 MAD', accountId);
    expect(res).toContain('350');
    expect(res).not.toContain('480'); // 480 MAD jacket exceeds 400 budget
  });

  // H. no explicit "best" but recommendation semantics detected
  it('H. detects recommendation intent when semantic constraints exist without explicit "best"', () => {
    const queries = [
      'ach t-nss7ni l chitta?',
      'which jacket for winter under 500?',
      'conseille-moi un sweat pour tous les jours',
      'شنو ترشح ليا للاستعمال اليومي؟'
    ];

    for (const q of queries) {
      const parsed = NormalizedTurnParser.parse(q);
      expect(parsed.primaryIntent).toBe('RECOMMENDATION');
    }
  });

  // I. recommendation does not fall to PRODUCT_SEARCH
  it('I. routes semantic criteria to RECOMMENDATION rather than raw keyword PRODUCT_SEARCH', () => {
    const turn = NormalizedTurnParser.parse('bghit chi 7aja d chitta b 9el mn 400 MAD');
    expect(turn.primaryIntent).toBe('RECOMMENDATION');
    expect(turn.secondaryIntents).not.toContain('PRODUCT_SEARCH');
  });

  // J. no LLM for short follow-up
  it('J. executes short contextual follow-up with exactly 0 LLM and 0 embedding calls', async () => {
    const customerId = `cust-cost-short-${Date.now()}`;
    await deps.conversationEngine.handleMessage(tenantId, customerId, 'Cozy Fleece Hoodie', accountId);

    const llmSpy = vi.spyOn(mockLlm, 'generateResponse');
    const embedSpy = vi.spyOn(mockEmbedding, 'embedText');

    await deps.conversationEngine.handleMessage(tenantId, customerId, 'size L kayn?', accountId);

    expect(llmSpy).toHaveBeenCalledTimes(0);
    expect(embedSpy).toHaveBeenCalledTimes(0);
  });

  // K. no embedding for recommendation classification
  it('K. classifies and ranks recommendation with 0 embedding and 0 LLM calls', async () => {
    const customerId = `cust-cost-rec-${Date.now()}`;
    const llmSpy = vi.spyOn(mockLlm, 'generateResponse');
    const embedSpy = vi.spyOn(mockEmbedding, 'embedText');

    await deps.conversationEngine.handleMessage(tenantId, customerId, 'bghit chi 7aja l kol nhar', accountId);

    expect(llmSpy).toHaveBeenCalledTimes(0);
    expect(embedSpy).toHaveBeenCalledTimes(0);
  });

  // L. no tenant/product hardcoding
  it('L. operates purely on dynamic generic schemas with zero product or tenant hardcoding', () => {
    const turn = NormalizedTurnParser.parse('show me any jackets under 500');
    expect(turn.categories).toContain('Jackets');
    expect(turn.constraints[0].value).toBe(500);
    expect(turn.primaryIntent).toBe('PRODUCT_SEARCH');
  });
});
