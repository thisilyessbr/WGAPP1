import { PrismaClient } from '@prisma/client';

export interface RetrievedChunk {
  id: string;
  documentId: string;
  content: string;
  similarity: number;
}

export class KnowledgeRepository {
  constructor(private prisma: PrismaClient) {}

  async insertChunk(tenantId: string, documentId: string, content: string, embedding: number[], accountId?: string | null): Promise<void> {
    // We must format the embedding as a pgvector string '[v1, v2, ...]'
    const embeddingString = `[${embedding.join(',')}]`;
    const trimmedAccountId = accountId && typeof accountId === 'string' && accountId.trim() ? accountId.trim() : null;
    
    // Strict tenant & account boundary is enforced by inserting with the required tenantId and optional accountId
    await this.prisma.$executeRaw`
      INSERT INTO "KnowledgeChunk" (id, "tenantId", "accountId", "documentId", content, embedding, "updatedAt")
      VALUES (gen_random_uuid(), ${tenantId}, ${trimmedAccountId}, ${documentId}, ${content}, ${embeddingString}::vector, NOW())
    `;
  }

  async searchSimilar(
    tenantId: string,
    queryEmbedding: number[],
    topK: number,
    minSimilarity: number,
    accountId?: string | null
  ): Promise<RetrievedChunk[]> {
    const embeddingString = `[${queryEmbedding.join(',')}]`;
    const trimmedAccountId = accountId && typeof accountId === 'string' && accountId.trim() ? accountId.trim() : null;
    
    // STRICT TENANT & ACCOUNT ISOLATION:
    // If accountId is provided: retrieves tenant-global (accountId IS NULL) + account-specific (accountId = target)
    // If accountId is NOT provided (legacy): retrieves tenant-global ONLY (accountId IS NULL)
    // Chunks whose parent KnowledgeSource is 'COMPLETED' are returned
    const results: any[] = trimmedAccountId
      ? await this.prisma.$queryRaw`
          SELECT 
            kc.id,
            kc."documentId",
            kc.content,
            1 - (kc.embedding <=> ${embeddingString}::vector) as similarity
          FROM "KnowledgeChunk" kc
          JOIN "KnowledgeDocument" kd ON kc."documentId" = kd.id
          JOIN "KnowledgeSource" ks ON kd."sourceId" = ks.id
          WHERE kc."tenantId" = ${tenantId}
            AND ks."tenantId" = ${tenantId}
            AND ks.status = 'COMPLETED'
            AND (ks."accountId" IS NULL OR ks."accountId" = ${trimmedAccountId})
            AND (kc."accountId" IS NULL OR kc."accountId" = ${trimmedAccountId})
            AND 1 - (kc.embedding <=> ${embeddingString}::vector) >= ${minSimilarity}
          ORDER BY kc.embedding <=> ${embeddingString}::vector
          LIMIT ${topK}
        `
      : await this.prisma.$queryRaw`
          SELECT 
            kc.id,
            kc."documentId",
            kc.content,
            1 - (kc.embedding <=> ${embeddingString}::vector) as similarity
          FROM "KnowledgeChunk" kc
          JOIN "KnowledgeDocument" kd ON kc."documentId" = kd.id
          JOIN "KnowledgeSource" ks ON kd."sourceId" = ks.id
          WHERE kc."tenantId" = ${tenantId}
            AND ks."tenantId" = ${tenantId}
            AND ks.status = 'COMPLETED'
            AND ks."accountId" IS NULL
            AND kc."accountId" IS NULL
            AND 1 - (kc.embedding <=> ${embeddingString}::vector) >= ${minSimilarity}
          ORDER BY kc.embedding <=> ${embeddingString}::vector
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
