import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { prisma, pool } from '../../src/tests/testDb';
import { bootstrapChatbot } from '../../src/bootstrap';
import { DEFAULT_BUSINESS_CONFIG } from '../../src/domain/tenant/BusinessConfig';
import { LLMMockProvider } from '../../src/core/llm/LLMProvider';
import { KnowledgeRepository } from '../../src/domain/rag/KnowledgeRepository';

import { MockEmbeddingProvider } from '../../src/core/rag/EmbeddingProvider';

describe('Phase 7: Account-Scoped RAG / Knowledge Architecture Integration Tests', () => {
  let deps: ReturnType<typeof bootstrapChatbot>;
  let mockLlm: LLMMockProvider;
  let knowledgeRepo: KnowledgeRepository;

  beforeAll(async () => {
    const client = await pool.connect();
    try {
      await client.query('SET search_path TO test, public, extensions;');
      await client.query(`
        ALTER TABLE "KnowledgeSource" ADD COLUMN IF NOT EXISTS "accountId" TEXT;
        ALTER TABLE "KnowledgeDocument" ADD COLUMN IF NOT EXISTS "accountId" TEXT;
        ALTER TABLE "KnowledgeChunk" ADD COLUMN IF NOT EXISTS "accountId" TEXT;
      `);
    } finally {
      client.release();
    }
  }, 30000);

  beforeEach(async () => {
    deps = bootstrapChatbot(prisma);
    (deps.ragService as any)['embeddingProvider'] = new MockEmbeddingProvider();
    mockLlm = new LLMMockProvider();
    deps.llmFactory.registerProvider('mock', 'mock-model', mockLlm);
    deps.tenantConfigService.clearCache();
    knowledgeRepo = new KnowledgeRepository(prisma);
  });

  it('1. Account A retrieves Global + Alpha knowledge; Account B retrieves Global + Beta knowledge; 0 cross leakage', async () => {
    const tenant = await prisma.tenant.create({
      data: {
        name: `Tenant-RAG-Iso-${Date.now()}`,
        config: {
          create: {
            config: {
              ...DEFAULT_BUSINESS_CONFIG,
              knowledge: {
                enabled: true,
                topK: 5,
                minSimilarityScore: 0.1,
                maxContextSize: 4000
              }
            }
          }
        }
      }
    });

    const accountA = await prisma.account.create({
      data: { tenantId: tenant.id, name: 'Account A', enabled: true }
    });
    const accountB = await prisma.account.create({
      data: { tenantId: tenant.id, name: 'Account B', enabled: true }
    });

    // 1. Create Global Knowledge (accountId = null)
    const srcGlobal = await prisma.knowledgeSource.create({
      data: { tenantId: tenant.id, name: 'Global Docs', type: 'PDF', status: 'COMPLETED' }
    });
    const docGlobal = await prisma.knowledgeDocument.create({
      data: { tenantId: tenant.id, sourceId: srcGlobal.id, title: 'Global Policy', content: 'GLOBAL FACT: Company founded in 2020.' }
    });
    // Create embedding for global doc
    const embGlobal = await (deps.ragService as any)['embeddingProvider'].embedText('Company founded in 2020');
    await knowledgeRepo.insertChunk(tenant.id, docGlobal.id, 'GLOBAL FACT: Company founded in 2020.', embGlobal, null);

    // 2. Create Account A Knowledge (accountId = accountA.id)
    const srcA = await prisma.knowledgeSource.create({
      data: { tenantId: tenant.id, accountId: accountA.id, name: 'Account A Docs', type: 'PDF', status: 'COMPLETED' }
    });
    const docA = await prisma.knowledgeDocument.create({
      data: { tenantId: tenant.id, accountId: accountA.id, sourceId: srcA.id, title: 'Alpha Plan', content: 'ALPHA PRIVATE FACT: Alpha VIP discount code is ALPHA100.' }
    });
    const embA = await (deps.ragService as any)['embeddingProvider'].embedText('Alpha VIP discount code is ALPHA100');
    await knowledgeRepo.insertChunk(tenant.id, docA.id, 'ALPHA PRIVATE FACT: Alpha VIP discount code is ALPHA100.', embA, accountA.id);

    // 3. Create Account B Knowledge (accountId = accountB.id)
    const srcB = await prisma.knowledgeSource.create({
      data: { tenantId: tenant.id, accountId: accountB.id, name: 'Account B Docs', type: 'PDF', status: 'COMPLETED' }
    });
    const docB = await prisma.knowledgeDocument.create({
      data: { tenantId: tenant.id, accountId: accountB.id, sourceId: srcB.id, title: 'Beta Plan', content: 'BETA PRIVATE FACT: Beta VIP discount code is BETA200.' }
    });
    const embB = await (deps.ragService as any)['embeddingProvider'].embedText('Beta VIP discount code is BETA200');
    await knowledgeRepo.insertChunk(tenant.id, docB.id, 'BETA PRIVATE FACT: Beta VIP discount code is BETA200.', embB, accountB.id);

    const config = await deps.tenantConfigService.getConfig(tenant.id);

    // Test Retrieval for Account A
    const resA_Alpha = await deps.ragService.retrieve(tenant.id, 'What is the discount code?', config, accountA.id);
    const resA_Global = await deps.ragService.retrieve(tenant.id, 'When was the company founded?', config, accountA.id);

    const textA_Alpha = resA_Alpha.chunks.map(c => c.content).join(' ');
    const textA_Global = resA_Global.chunks.map(c => c.content).join(' ');

    expect(textA_Alpha).toContain('ALPHA PRIVATE FACT');
    expect(textA_Alpha).not.toContain('BETA PRIVATE FACT');
    expect(textA_Global).toContain('GLOBAL FACT');

    // Test Retrieval for Account B
    const resB_Beta = await deps.ragService.retrieve(tenant.id, 'What is the discount code?', config, accountB.id);
    const resB_Global = await deps.ragService.retrieve(tenant.id, 'When was the company founded?', config, accountB.id);

    const textB_Beta = resB_Beta.chunks.map(c => c.content).join(' ');
    const textB_Global = resB_Global.chunks.map(c => c.content).join(' ');

    expect(textB_Beta).toContain('BETA PRIVATE FACT');
    expect(textB_Beta).not.toContain('ALPHA PRIVATE FACT');
    expect(textB_Global).toContain('GLOBAL FACT');
  }, 30000);

  it('2. Negative test: Account A query targeting Beta private fact NEVER returns Beta chunk', async () => {
    const tenant = await prisma.tenant.create({
      data: {
        name: `Tenant-RAG-Neg-${Date.now()}`,
        config: {
          create: {
            config: {
              ...DEFAULT_BUSINESS_CONFIG,
              knowledge: {
                enabled: true,
                topK: 5,
                minSimilarityScore: 0.1,
                maxContextSize: 4000
              }
            }
          }
        }
      }
    });

    const accountA = await prisma.account.create({
      data: { tenantId: tenant.id, name: 'Account A', enabled: true }
    });
    const accountB = await prisma.account.create({
      data: { tenantId: tenant.id, name: 'Account B', enabled: true }
    });

    // Create private Beta chunk
    const srcB = await prisma.knowledgeSource.create({
      data: { tenantId: tenant.id, accountId: accountB.id, name: 'Beta Secret', type: 'PDF', status: 'COMPLETED' }
    });
    const docB = await prisma.knowledgeDocument.create({
      data: { tenantId: tenant.id, accountId: accountB.id, sourceId: srcB.id, title: 'Beta Secret Doc', content: 'SECRET BETA REVENUE: 50 million dollars.' }
    });
    const embB = await (deps.ragService as any)['embeddingProvider'].embedText('SECRET BETA REVENUE: 50 million dollars');
    await knowledgeRepo.insertChunk(tenant.id, docB.id, 'SECRET BETA REVENUE: 50 million dollars.', embB, accountB.id);

    const config = await deps.tenantConfigService.getConfig(tenant.id);

    // Account A searches explicitly for Beta secret
    const resA = await deps.ragService.retrieve(tenant.id, 'SECRET BETA REVENUE: 50 million dollars', config, accountA.id);
    expect(resA.chunks).toHaveLength(0);
    expect(resA.context).toBe('');

    // Account B searches for its own secret
    const resB = await deps.ragService.retrieve(tenant.id, 'SECRET BETA REVENUE: 50 million dollars', config, accountB.id);
    expect(resB.chunks.length).toBeGreaterThan(0);
    expect(resB.chunks[0].content).toContain('SECRET BETA REVENUE');
  }, 30000);

  it('3. Legacy requests without accountId retrieve ONLY tenant-global knowledge', async () => {
    const tenant = await prisma.tenant.create({
      data: {
        name: `Tenant-RAG-Legacy-${Date.now()}`,
        config: {
          create: {
            config: {
              ...DEFAULT_BUSINESS_CONFIG,
              knowledge: {
                enabled: true,
                topK: 5,
                minSimilarityScore: 0.1,
                maxContextSize: 4000
              }
            }
          }
        }
      }
    });

    const accountA = await prisma.account.create({
      data: { tenantId: tenant.id, name: 'Account A', enabled: true }
    });

    // Global chunk
    const srcGlobal = await prisma.knowledgeSource.create({
      data: { tenantId: tenant.id, name: 'Global Docs', type: 'PDF', status: 'COMPLETED' }
    });
    const docGlobal = await prisma.knowledgeDocument.create({
      data: { tenantId: tenant.id, sourceId: srcGlobal.id, title: 'Global Doc', content: 'GLOBAL FACT: Standard warranty is 1 year.' }
    });
    const embGlobal = await (deps.ragService as any)['embeddingProvider'].embedText('Standard warranty is 1 year');
    await knowledgeRepo.insertChunk(tenant.id, docGlobal.id, 'GLOBAL FACT: Standard warranty is 1 year.', embGlobal, null);

    // Account A chunk
    const srcA = await prisma.knowledgeSource.create({
      data: { tenantId: tenant.id, accountId: accountA.id, name: 'Account A Docs', type: 'PDF', status: 'COMPLETED' }
    });
    const docA = await prisma.knowledgeDocument.create({
      data: { tenantId: tenant.id, accountId: accountA.id, sourceId: srcA.id, title: 'Account A Doc', content: 'ALPHA EXCLUSIVE: Extended warranty is 5 years.' }
    });
    const embA = await (deps.ragService as any)['embeddingProvider'].embedText('Extended warranty is 5 years');
    await knowledgeRepo.insertChunk(tenant.id, docA.id, 'ALPHA EXCLUSIVE: Extended warranty is 5 years.', embA, accountA.id);

    const config = await deps.tenantConfigService.getConfig(tenant.id);

    // Legacy retrieval (accountId = null/undefined)
    const resLegacy = await deps.ragService.retrieve(tenant.id, 'warranty terms and duration', config);
    const legacyText = resLegacy.chunks.map(c => c.content).join(' ');

    expect(legacyText).toContain('GLOBAL FACT');
    expect(legacyText).not.toContain('ALPHA EXCLUSIVE');
  }, 30000);
});
