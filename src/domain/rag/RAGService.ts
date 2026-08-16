import { EmbeddingProvider } from '../../core/rag/EmbeddingProvider';
import { KnowledgeRepository, RetrievedChunk } from './KnowledgeRepository';
import { BusinessConfig } from '../tenant/BusinessConfig';

export interface RAGChunk {
  id: string;
  documentId: string;
  content: string;
  score: number;
  similarity: number;
}

export interface RAGResult {
  context: string;
  chunks: RAGChunk[];
}

export class RAGService {
  constructor(
    private embeddingProvider: EmbeddingProvider,
    private knowledgeRepository: KnowledgeRepository
  ) {}

  /**
   * Retrieves raw matching chunks from the knowledge repository scoped to tenant.
   */
  async retrieveChunks(tenantId: string, query: string, config: BusinessConfig): Promise<RAGChunk[]> {
    if (!config.knowledge.enabled) {
      return [];
    }

    // 1. Generate query embedding
    const queryEmbedding = await this.embeddingProvider.embedText(query);

    // 2. Search repository securely scoped to tenant
    const rawChunks = await this.knowledgeRepository.searchSimilar(
      tenantId,
      queryEmbedding,
      config.knowledge.topK,
      config.knowledge.minSimilarityScore
    );

    return rawChunks.map(c => ({
      id: c.id,
      documentId: c.documentId,
      content: c.content,
      score: c.similarity,
      similarity: c.similarity
    }));
  }

  /**
   * Formats an array of chunk objects into a bounded prompt context string.
   */
  formatContext(chunks: RAGChunk[], maxContextSize: number): string {
    if (!chunks || chunks.length === 0) {
      return '';
    }

    let assembledContext = '';
    for (const chunk of chunks) {
      const addition = `\n---\n${chunk.content}`;
      if ((assembledContext.length + addition.length) > maxContextSize) {
        break;
      }
      assembledContext += addition;
    }

    return assembledContext.trim();
  }

  /**
   * Retrieves relevant knowledge context formatted as a string for LLM prompts.
   */
  async retrieveContext(tenantId: string, query: string, config: BusinessConfig): Promise<string> {
    const chunks = await this.retrieveChunks(tenantId, query, config);
    return this.formatContext(chunks, config.knowledge.maxContextSize);
  }

  /**
   * Retrieves both structured chunk array and formatted context string.
   */
  async retrieve(tenantId: string, query: string, config: BusinessConfig): Promise<RAGResult> {
    const chunks = await this.retrieveChunks(tenantId, query, config);
    const context = this.formatContext(chunks, config.knowledge.maxContextSize);
    return { context, chunks };
  }
}
