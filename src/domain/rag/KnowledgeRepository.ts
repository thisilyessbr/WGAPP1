import { PrismaClient } from '@prisma/client';

export interface RetrievedChunk {
  id: string;
  documentId: string;
  content: string;
  similarity: number;
}

export class KnowledgeRepository {
  constructor(private prisma: PrismaClient) {}

  async insertChunk(tenantId: string, documentId: string, content: string, embedding: number[]): Promise<void> {
    // We must format the embedding as a pgvector string '[v1, v2, ...]'
    const embeddingString = `[${embedding.join(',')}]`;
    
    // Strict tenant boundary is enforced by inserting with the required tenantId
    await this.prisma.$executeRaw`
      INSERT INTO "KnowledgeChunk" (id, "tenantId", "documentId", content, embedding, "updatedAt")
      VALUES (gen_random_uuid(), ${tenantId}, ${documentId}, ${content}, ${embeddingString}::vector, NOW())
    `;
  }

  async searchSimilar(tenantId: string, queryEmbedding: number[], topK: number, minSimilarity: number): Promise<RetrievedChunk[]> {
    const embeddingString = `[${queryEmbedding.join(',')}]`;
    
    // We use inner product (<#>) or cosine distance (<=>). Cosine distance is standard for text embeddings.
    // distance = embedding <=> query
    // similarity = 1 - distance
    // STRICT TENANT ISOLATION: "tenantId" = ${tenantId} is hardcoded into the WHERE clause
    const results: any[] = await this.prisma.$queryRaw`
      SELECT 
        id,
        "documentId",
        content,
        1 - (embedding <=> ${embeddingString}::vector) as similarity
      FROM "KnowledgeChunk"
      WHERE "tenantId" = ${tenantId}
        AND 1 - (embedding <=> ${embeddingString}::vector) >= ${minSimilarity}
      ORDER BY embedding <=> ${embeddingString}::vector
      LIMIT ${topK}
    `;

    return results.map(r => ({
      id: r.id,
      documentId: r.documentId,
      content: r.content,
      similarity: r.similarity
    }));
  }
}
