import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import { PdfIngestionService } from '../domain/rag/PdfIngestionService';
import { KnowledgeRepository } from '../domain/rag/KnowledgeRepository';
import { MockEmbeddingProvider } from '../core/rag/EmbeddingProvider';
import { RAGService } from '../domain/rag/RAGService';
import { DEFAULT_BUSINESS_CONFIG } from '../domain/tenant/BusinessConfig';

import { prisma } from './testDb';

// Mock pdf-parse
vi.mock('pdf-parse', () => {
  return {
    default: vi.fn().mockImplementation(async (buffer: Buffer) => {
      const content = buffer.toString('utf8');
      if (content === 'MALFORMED') {
        throw new Error('Invalid PDF structure');
      }
      if (content === 'EMPTY') {
        return { text: '   \n  ', numpages: 1 };
      }
      return { text: content, numpages: 1 };
    })
  };
});
let ingestionService: PdfIngestionService;
let knowledgeRepo: KnowledgeRepository;
let embedProvider: MockEmbeddingProvider;
let ragService: RAGService;
describe('Generic Multi-Tenant PDF Ingestion', () => {
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
    ingestionService = new PdfIngestionService(prisma, embedProvider, knowledgeRepo);
  });
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it('1. A valid PDF is successfully ingested, chunked, and embedded', async () => {
    const tenant = await prisma.tenant.create({ data: { name: 'Valid Tenant' } });
    const config = JSON.parse(JSON.stringify(DEFAULT_BUSINESS_CONFIG));
    config.knowledge.ingestion.chunkSize = 10;
    config.knowledge.ingestion.chunkOverlap = 2;
    const buffer = Buffer.from('This is a valid PDF document with some text to extract and chunk appropriately.');
    const sourceId = await ingestionService.ingestPdf(tenant.id, buffer, 'test.pdf', config);
    expect(sourceId).toBeDefined();
    const source = await prisma.knowledgeSource.findUnique({ where: { id: sourceId } });
    expect(source?.status).toBe('COMPLETED');
    expect(source?.type).toBe('PDF');
    expect(source?.tenantId).toBe(tenant.id);
    const doc = await prisma.knowledgeDocument.findFirst({ where: { sourceId } });
    expect(doc).toBeDefined();
    expect(doc?.title).toBe('test.pdf');
    expect(doc?.tenantId).toBe(tenant.id);
    // Verify chunks were created
    const chunks = await prisma.knowledgeChunk.findMany({ where: { documentId: doc!.id } });
    expect(chunks.length).toBeGreaterThan(5); // Due to chunk size 10
    expect(chunks[0].tenantId).toBe(tenant.id); // Strict isolation validation
  });
  it('2. Re-ingesting the same document is idempotent', async () => {
    const tenant = await prisma.tenant.create({ data: { name: 'Idempotency Tenant' } });
    const config = JSON.parse(JSON.stringify(DEFAULT_BUSINESS_CONFIG));
    const buffer = Buffer.from('Idempotency Test Document');
    const sourceId1 = await ingestionService.ingestPdf(tenant.id, buffer, 'doc.pdf', config);
    const sourceId2 = await ingestionService.ingestPdf(tenant.id, buffer, 'doc.pdf', config);
    // Should return the exact same source ID
    expect(sourceId1).toBe(sourceId2);
    // Ensure only one source exists for this tenant
    const sources = await prisma.knowledgeSource.findMany({ where: { tenantId: tenant.id } });
    expect(sources.length).toBe(1);
    // Ensure chunks were only generated once
    const docs = await prisma.knowledgeDocument.findMany({ where: { tenantId: tenant.id } });
    expect(docs.length).toBe(1);
  });
  it('3. An invalid PDF fails safely (Status FAILED)', async () => {
    const tenant = await prisma.tenant.create({ data: { name: 'Fail Tenant' } });
    const config = JSON.parse(JSON.stringify(DEFAULT_BUSINESS_CONFIG));
    const buffer = Buffer.from('MALFORMED');
    await expect(ingestionService.ingestPdf(tenant.id, buffer, 'bad.pdf', config)).rejects.toThrow();
    const sources = await prisma.knowledgeSource.findMany({ where: { tenantId: tenant.id } });
    expect(sources.length).toBe(1);
    expect(sources[0].status).toBe('FAILED');
    const metadata = sources[0].metadata as any;
    expect(metadata.error).toBe('Failed to parse PDF document.');
  });
  it('4. Empty extractable text fails safely', async () => {
    const tenant = await prisma.tenant.create({ data: { name: 'Empty Tenant' } });
    const config = JSON.parse(JSON.stringify(DEFAULT_BUSINESS_CONFIG));
    const buffer = Buffer.from('EMPTY'); // Mocks to empty whitespace
    await expect(ingestionService.ingestPdf(tenant.id, buffer, 'empty.pdf', config)).rejects.toThrow(/contains no extractable text/);
  });
  it('5. Tenant A cannot retrieve Tenant B PDF content via RAG', async () => {
    const tenantA = await prisma.tenant.create({ data: { name: 'RAG A' } });
    const tenantB = await prisma.tenant.create({ data: { name: 'RAG B' } });
    const config = JSON.parse(JSON.stringify(DEFAULT_BUSINESS_CONFIG));
    config.knowledge.enabled = true;
    const buffer = Buffer.from('Tenant B confidential quarterly report. Password is XYZ.');
    await ingestionService.ingestPdf(tenantB.id, buffer, 'secret.pdf', config);
    // A searches for the secret
    const contextA = await ragService.retrieveContext(tenantA.id, 'confidential', config);
    expect(contextA).toBe(''); // Isolated
    // B searches for it
    const contextB = await ragService.retrieveContext(tenantB.id, 'confidential', config);
    expect(contextB).toContain('quarterly report');
  });
  it('6. Embedding failure does not leave document marked COMPLETED', async () => {
    const tenant = await prisma.tenant.create({ data: { name: 'Embed Fail Tenant' } });
    const config = JSON.parse(JSON.stringify(DEFAULT_BUSINESS_CONFIG));
    const buffer = Buffer.from('Will fail on embed');
    // Inject a transient mock failure to the provider
    vi.spyOn(embedProvider, 'embedText').mockRejectedValueOnce(new Error('API Timeout'));
    await expect(ingestionService.ingestPdf(tenant.id, buffer, 'timeout.pdf', config)).rejects.toThrow('API Timeout');
    const sources = await prisma.knowledgeSource.findMany({ where: { tenantId: tenant.id } });
    expect(sources[0].status).toBe('FAILED');
  });
  it('7. Exceeding max chunks fails safely', async () => {
    const tenant = await prisma.tenant.create({ data: { name: 'Max Chunks Tenant' } });
    const config = JSON.parse(JSON.stringify(DEFAULT_BUSINESS_CONFIG));
    config.knowledge.ingestion.chunkSize = 5;
    config.knowledge.ingestion.maxChunks = 2; // Very strict limit
    const buffer = Buffer.from('This document is too long for the chunk limit.');
    await expect(ingestionService.ingestPdf(tenant.id, buffer, 'long.pdf', config)).rejects.toThrow(/exceeding the limit/);
  });
});