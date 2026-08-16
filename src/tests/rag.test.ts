import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { KnowledgeRepository } from '../domain/rag/KnowledgeRepository';
import { RAGService } from '../domain/rag/RAGService';
import { MockEmbeddingProvider } from '../core/rag/EmbeddingProvider';
import { DEFAULT_BUSINESS_CONFIG } from '../domain/tenant/BusinessConfig';

import { prisma } from './testDb';

let ragService: RAGService;
let knowledgeRepo: KnowledgeRepository;
let embedProvider: MockEmbeddingProvider;
describe('Generic Multi-Tenant RAG Foundation', () => {
  beforeAll(async () => {
    await prisma.knowledgeChunk.deleteMany();
    await prisma.knowledgeDocument.deleteMany();
    await prisma.knowledgeSource.deleteMany();
    await prisma.workflowSession.deleteMany();
    await prisma.message.deleteMany();
    await prisma.conversation.deleteMany();
    await prisma.tenantConfig.deleteMany();
    await prisma.customer.deleteMany();
    await prisma.tenant.deleteMany();
    knowledgeRepo = new KnowledgeRepository(prisma);
    embedProvider = new MockEmbeddingProvider();
    ragService = new RAGService(embedProvider, knowledgeRepo);
  });
  it('1. Tenant A can retrieve its own knowledge', async () => {
    const tenantA = await prisma.tenant.create({ data: { name: 'A' } });
    // Create source and doc
    const source = await prisma.knowledgeSource.create({ data: { tenantId: tenantA.id, name: 'S1', type: 'TEXT' } });
    const doc = await prisma.knowledgeDocument.create({ data: { tenantId: tenantA.id, sourceId: source.id, title: 'D1', content: 'test content' } });
    // Insert chunk using repo
    // In our mock, 'test' generates vector [1, 0, 0...]
    const vector = await embedProvider.embedText('test');
    await knowledgeRepo.insertChunk(tenantA.id, doc.id, 'This is a test document about RAG.', vector);
    const config = JSON.parse(JSON.stringify(DEFAULT_BUSINESS_CONFIG));
    config.knowledge.enabled = true;
    config.knowledge.topK = 3;
    config.knowledge.minSimilarityScore = 0.5;
    const context = await ragService.retrieveContext(tenantA.id, 'test query', config);
    expect(context).toContain('This is a test document about RAG.');
  });
  it('2. Tenant A cannot retrieve Tenant B knowledge (Strict Isolation)', async () => {
    const tenantA = await prisma.tenant.create({ data: { name: 'Tenant A' } });
    const tenantB = await prisma.tenant.create({ data: { name: 'Tenant B' } });
    const sourceB = await prisma.knowledgeSource.create({ data: { tenantId: tenantB.id, name: 'S2', type: 'TEXT' } });
    const docB = await prisma.knowledgeDocument.create({ data: { tenantId: tenantB.id, sourceId: sourceB.id, title: 'D2', content: 'secret B' } });
    // Insert into B's space
    const vectorB = await embedProvider.embedText('test secret b');
    await knowledgeRepo.insertChunk(tenantB.id, docB.id, 'Tenant B secret password is 1234', vectorB);
    const config = JSON.parse(JSON.stringify(DEFAULT_BUSINESS_CONFIG));
    config.knowledge.enabled = true;
    // A searches with exactly matching query
    const contextA = await ragService.retrieveContext(tenantA.id, 'test secret', config);
    // Should be completely empty because tenantId prevents retrieval
    expect(contextA).toBe('');
    // B searches with matching query
    const contextB = await ragService.retrieveContext(tenantB.id, 'test secret', config);
    expect(contextB).toContain('Tenant B secret password is 1234');
  });
  it('3. Irrelevant documents are rejected by the similarity threshold', async () => {
    const tenant = await prisma.tenant.create({ data: { name: 'C' } });
    const source = await prisma.knowledgeSource.create({ data: { tenantId: tenant.id, name: 'S3', type: 'TEXT' } });
    const doc = await prisma.knowledgeDocument.create({ data: { tenantId: tenant.id, sourceId: source.id, title: 'D3', content: 'unrelated content' } });
    // 'unrelated' generates vector [0, 1, 0...]
    const vector = await embedProvider.embedText('unrelated stuff');
    await knowledgeRepo.insertChunk(tenant.id, doc.id, 'This is unrelated.', vector);
    const config = JSON.parse(JSON.stringify(DEFAULT_BUSINESS_CONFIG));
    config.knowledge.enabled = true;
    config.knowledge.minSimilarityScore = 0.8;
    // 'test query' generates vector [1, 0, 0...]
    // Similarity between [1,0] and [0,1] is 0 (cosine distance is 1)
    // 0 < 0.8, should be rejected
    const context = await ragService.retrieveContext(tenant.id, 'test query', config);
    expect(context).toBe('');
  });
  it('4. RAG can be disabled through configuration', async () => {
    const tenant = await prisma.tenant.create({ data: { name: 'D' } });
    const source = await prisma.knowledgeSource.create({ data: { tenantId: tenant.id, name: 'S4', type: 'TEXT' } });
    const doc = await prisma.knowledgeDocument.create({ data: { tenantId: tenant.id, sourceId: source.id, title: 'D4', content: 'test content' } });
    const vector = await embedProvider.embedText('test');
    await knowledgeRepo.insertChunk(tenant.id, doc.id, 'This is a test.', vector);
    const config = JSON.parse(JSON.stringify(DEFAULT_BUSINESS_CONFIG));
    config.knowledge.enabled = false; // Disabled
    const context = await ragService.retrieveContext(tenant.id, 'test query', config);
    expect(context).toBe('');
  });
  it('5. Context size is limited by configuration', async () => {
    const tenant = await prisma.tenant.create({ data: { name: 'E' } });
    const source = await prisma.knowledgeSource.create({ data: { tenantId: tenant.id, name: 'S5', type: 'TEXT' } });
    const doc = await prisma.knowledgeDocument.create({ data: { tenantId: tenant.id, sourceId: source.id, title: 'D5', content: 'test' } });
    const vector = await embedProvider.embedText('test');
    await knowledgeRepo.insertChunk(tenant.id, doc.id, 'Test paragraph 1.', vector);
    await knowledgeRepo.insertChunk(tenant.id, doc.id, 'Test paragraph 2.', vector);
    const config = JSON.parse(JSON.stringify(DEFAULT_BUSINESS_CONFIG));
    config.knowledge.enabled = true;
    config.knowledge.maxContextSize = 40; // Extremely small, enough for only one chunk
    const context = await ragService.retrieveContext(tenant.id, 'test query', config);
    expect(context).toContain('Test paragraph 1.');
    expect(context).not.toContain('Test paragraph 2.'); // Truncated
  });
});