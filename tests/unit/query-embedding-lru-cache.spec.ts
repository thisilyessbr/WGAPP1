import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RAGService } from '../../src/domain/rag/RAGService';
import { MockEmbeddingProvider } from '../../src/core/rag/EmbeddingProvider';
import { KnowledgeRepository, RetrievedChunk } from '../../src/domain/rag/KnowledgeRepository';
import { DEFAULT_BUSINESS_CONFIG, BusinessConfig } from '../../src/domain/tenant/BusinessConfig';

describe('Phase COST-FIX-46G: Tenant-Safe Query Embedding LRU Cache', () => {
  let mockEmbeddingProvider: MockEmbeddingProvider;
  let mockKnowledgeRepo: KnowledgeRepository;
  let ragService: RAGService;
  let searchSimilarSpy: any;
  let embedTextSpy: any;

  const tenantA = 'tenant-alpha';
  const tenantB = 'tenant-beta';

  const baseConfig: BusinessConfig = {
    ...DEFAULT_BUSINESS_CONFIG,
    knowledge: {
      enabled: true,
      topK: 4,
      minSimilarityScore: 0.5,
      embeddingProvider: 'gemini',
      embeddingModel: 'gemini-embedding-001'
    }
  };

  const sampleChunks: RetrievedChunk[] = [
    {
      id: 'chunk-1',
      documentId: 'doc-1',
      content: 'The consultation price is 750 MAD.',
      similarity: 0.88,
      metadata: { section: 'pricing' },
      documentTitle: 'Pricing Guide'
    }
  ];

  beforeEach(() => {
    RAGService.clearEmbeddingCache();
    mockEmbeddingProvider = new MockEmbeddingProvider(768);
    embedTextSpy = vi.spyOn(mockEmbeddingProvider, 'embedText');

    mockKnowledgeRepo = {
      searchSimilar: vi.fn().mockResolvedValue(sampleChunks)
    } as any;
    searchSimilarSpy = vi.spyOn(mockKnowledgeRepo, 'searchSimilar');

    ragService = new RAGService(mockEmbeddingProvider, mockKnowledgeRepo);
  });

  it('A. First query -> generates embedding via provider (Cache Miss)', async () => {
    const query = 'What is the consultation price?';
    const result = await ragService.retrieve(tenantA, query, baseConfig);

    expect(embedTextSpy).toHaveBeenCalledTimes(1);
    expect(searchSimilarSpy).toHaveBeenCalledTimes(1);
    expect(result.chunks.length).toBe(1);

    const stats = RAGService.getEmbeddingCacheStats();
    expect(stats.hits).toBe(0);
    expect(stats.misses).toBe(1);
    expect(stats.size).toBe(1);
  });

  it('B. Same normalized query -> reuses cached embedding (0 extra embedding calls)', async () => {
    const query = 'What is the consultation price?';

    // Turn 1
    await ragService.retrieve(tenantA, query, baseConfig);
    expect(embedTextSpy).toHaveBeenCalledTimes(1);

    // Turn 2: Exact same query
    await ragService.retrieve(tenantA, query, baseConfig);
    expect(embedTextSpy).toHaveBeenCalledTimes(1); // No new call!

    const stats = RAGService.getEmbeddingCacheStats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
  });

  it('C. Equivalent normalized query -> cache hit via normalization', async () => {
    // Both phrases map to the same normalized tokens through normalizeDialectQuery
    const query1 = 'chhal taman twsil';
    const query2 = 'chhal taman twsil  ';

    await ragService.retrieve(tenantA, query1, baseConfig);
    expect(embedTextSpy).toHaveBeenCalledTimes(1);

    await ragService.retrieve(tenantA, query2, baseConfig);
    expect(embedTextSpy).toHaveBeenCalledTimes(1);

    const stats = RAGService.getEmbeddingCacheStats();
    expect(stats.hits).toBe(1);
  });

  it('D. Different tenant -> cache miss (Tenant Isolation)', async () => {
    const query = 'What is the consultation price?';

    await ragService.retrieve(tenantA, query, baseConfig);
    expect(embedTextSpy).toHaveBeenCalledTimes(1);

    // Same query but Tenant B
    await ragService.retrieve(tenantB, query, baseConfig);
    expect(embedTextSpy).toHaveBeenCalledTimes(2); // Fresh embedding call for Tenant B

    const stats = RAGService.getEmbeddingCacheStats();
    expect(stats.misses).toBe(2);
    expect(stats.size).toBe(2);
  });

  it('E. Different provider -> cache miss (Provider Isolation)', async () => {
    const query = 'What is the return policy?';

    const configGemini = { ...baseConfig };
    const configOpenAI: BusinessConfig = {
      ...baseConfig,
      knowledge: {
        ...baseConfig.knowledge,
        embeddingProvider: 'openai'
      }
    };

    await ragService.retrieve(tenantA, query, configGemini);
    expect(embedTextSpy).toHaveBeenCalledTimes(1);

    await ragService.retrieve(tenantA, query, configOpenAI);
    expect(embedTextSpy).toHaveBeenCalledTimes(2);

    const stats = RAGService.getEmbeddingCacheStats();
    expect(stats.misses).toBe(2);
  });

  it('F. Different model -> cache miss (Model Isolation)', async () => {
    const query = 'What is the return policy?';

    const configV1 = { ...baseConfig };
    const configV2: BusinessConfig = {
      ...baseConfig,
      knowledge: {
        ...baseConfig.knowledge,
        embeddingModel: 'text-embedding-004'
      }
    };

    await ragService.retrieve(tenantA, query, configV1);
    expect(embedTextSpy).toHaveBeenCalledTimes(1);

    await ragService.retrieve(tenantA, query, configV2);
    expect(embedTextSpy).toHaveBeenCalledTimes(2);

    const stats = RAGService.getEmbeddingCacheStats();
    expect(stats.misses).toBe(2);
  });

  it('G. TTL expiry -> cache miss after 3600 seconds', async () => {
    const query = 'What is the warranty period?';

    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);

    await ragService.retrieve(tenantA, query, baseConfig);
    expect(embedTextSpy).toHaveBeenCalledTimes(1);

    // Advance time by 3601 seconds (past 1-hour TTL)
    vi.spyOn(Date, 'now').mockReturnValue(now + 3601 * 1000);

    await ragService.retrieve(tenantA, query, baseConfig);
    expect(embedTextSpy).toHaveBeenCalledTimes(2);

    vi.restoreAllMocks();
  });

  it('H. LRU eviction -> evicts oldest entry when max capacity (500) exceeded', async () => {
    // Fill cache up to capacity (500 items)
    for (let i = 0; i < RAGService.MAX_CACHE_ENTRIES; i++) {
      await ragService.retrieve(tenantA, `Unique test query number ${i}`, baseConfig);
    }

    expect(embedTextSpy).toHaveBeenCalledTimes(500);
    expect(RAGService.getEmbeddingCacheStats().size).toBe(500);

    // Insert 501st query -> should evict the 0th query
    await ragService.retrieve(tenantA, 'Query number 501 overflow', baseConfig);
    expect(embedTextSpy).toHaveBeenCalledTimes(501);
    expect(RAGService.getEmbeddingCacheStats().size).toBe(500);

    // Query 0 was evicted, so querying it again should be a cache miss
    await ragService.retrieve(tenantA, 'Unique test query number 0', baseConfig);
    expect(embedTextSpy).toHaveBeenCalledTimes(502);
  });

  it('I. Cache hit still performs fresh pgvector search in database', async () => {
    const query = 'What are your opening hours?';

    // Turn 1 (Miss)
    await ragService.retrieve(tenantA, query, baseConfig);
    expect(searchSimilarSpy).toHaveBeenCalledTimes(1);

    // Turn 2 (Hit)
    await ragService.retrieve(tenantA, query, baseConfig);
    expect(embedTextSpy).toHaveBeenCalledTimes(1); // 0 extra embedding calls
    expect(searchSimilarSpy).toHaveBeenCalledTimes(2); // pgvector query executed again!
  });

  it('L. Empty query does not throw and does not poison cache', async () => {
    const result = await ragService.retrieve(tenantA, '', baseConfig);
    expect(result.chunks).toEqual([]);
    expect(RAGService.getEmbeddingCacheStats().size).toBe(0);
  });
});
