/**
 * Generic FAQ Knowledge Adapter.
 * Converts configured FAQ entries into structured knowledge documents and chunks
 * for unified RAG retrieval, removing the separate FAQ execution path.
 */

import { PrismaClient } from '@prisma/client';
import { FaqEntry } from '../tenant/BusinessConfig';
import { KnowledgeRepository } from './KnowledgeRepository';
import { EmbeddingProvider } from '../../core/rag/EmbeddingProvider';

export interface FaqKnowledgeItem {
  faqId: string;
  category: string;
  title: string;
  content: string;
  metadata: {
    source: 'FAQ';
    faqId: string;
    category: string;
    isFaq: true;
    keywords?: string[];
  };
}

export class FaqKnowledgeAdapter {
  /**
   * Adapts an array of FaqEntry objects into structured knowledge representations.
   */
  public static adaptFaqs(faqs: FaqEntry[]): FaqKnowledgeItem[] {
    if (!faqs || faqs.length === 0) return [];

    return faqs.map(entry => {
      const parts: string[] = [];
      const categoryUpper = (entry.category || 'GENERAL').toUpperCase();

      // Resolve primary question & answer
      const qAny = entry.questions as any;
      const primaryQ = entry.question || qAny?.en || qAny?.fr || qAny?.ar || qAny?.darija || '';
      
      const aAny = entry.answers as any;
      const primaryA = entry.answer || aAny?.en || aAny?.fr || aAny?.ar || aAny?.darija || '';

      parts.push(`FAQ [${categoryUpper}]: ${primaryQ}`);
      if (primaryA) {
        parts.push(`Answer: ${primaryA}`);
      }

      // Multilingual answers
      if (entry.answers) {
        const langAnswers: string[] = [];
        for (const [lang, ans] of Object.entries(entry.answers)) {
          if (typeof ans === 'string' && ans.trim() && ans !== primaryA) {
            langAnswers.push(`- [${lang}] ${ans.trim()}`);
          }
        }
        if (langAnswers.length > 0) {
          parts.push(`Multilingual Answers:\n${langAnswers.join('\n')}`);
        }
      }

      // Alternative customer questions
      if (entry.questions) {
        const allQuestions: string[] = [];
        for (const [lang, qVal] of Object.entries(entry.questions)) {
          if (Array.isArray(qVal)) {
            for (const q of qVal) {
              if (typeof q === 'string' && q.trim() && q !== primaryQ && !allQuestions.includes(q)) {
                allQuestions.push(`- [${lang}] ${q.trim()}`);
              }
            }
          } else if (typeof qVal === 'string' && qVal.trim() && qVal !== primaryQ && !allQuestions.includes(qVal)) {
            allQuestions.push(`- [${lang}] ${qVal.trim()}`);
          }
        }
        if (allQuestions.length > 0) {
          parts.push(`Alternative Questions:\n${allQuestions.join('\n')}`);
        }
      }

      // Keywords (handle both array and object-by-language)
      const allKeywords: string[] = [];
      if (Array.isArray(entry.keywords)) {
        allKeywords.push(...entry.keywords.filter(k => typeof k === 'string'));
      } else if (entry.keywords && typeof entry.keywords === 'object') {
        for (const kwList of Object.values(entry.keywords as Record<string, any>)) {
          if (Array.isArray(kwList)) {
            allKeywords.push(...kwList.filter(k => typeof k === 'string'));
          }
        }
      }

      if (allKeywords.length > 0) {
        parts.push(`Keywords: ${Array.from(new Set(allKeywords)).join(', ')}`);
      }

      const content = parts.join('\n\n');
      const title = `FAQ — ${categoryUpper}`;

      return {
        faqId: entry.id,
        category: entry.category,
        title,
        content,
        metadata: {
          source: 'FAQ',
          faqId: entry.id,
          category: entry.category,
          isFaq: true,
          keywords: allKeywords.length > 0 ? allKeywords : undefined
        }
      };
    });
  }

  /**
   * Synchronizes FAQ knowledge items into the database as KnowledgeSource, KnowledgeDocument,
   * and KnowledgeChunk records with pgvector embeddings.
   * Deterministic, idempotent, and preserves strict tenant & account boundaries.
   */
  public static async syncTenantFaqs(
    tenantId: string,
    accountId: string | null | undefined,
    faqs: FaqEntry[],
    knowledgeRepo: KnowledgeRepository,
    embeddingProvider: EmbeddingProvider,
    prisma: PrismaClient
  ): Promise<number> {
    if (!faqs || faqs.length === 0) return 0;

    const trimmedAccountId = accountId && typeof accountId === 'string' && accountId.trim() ? accountId.trim() : null;
    const items = this.adaptFaqs(faqs);

    // 1. Find or create KnowledgeSource for FAQs
    let source = await prisma.knowledgeSource.findFirst({
      where: {
        tenantId,
        accountId: trimmedAccountId,
        name: 'Configured Store FAQs',
        type: 'FAQ'
      }
    });

    if (!source) {
      source = await prisma.knowledgeSource.create({
        data: {
          tenantId,
          accountId: trimmedAccountId,
          name: 'Configured Store FAQs',
          type: 'FAQ',
          status: 'COMPLETED'
        }
      });
    } else if (source.status !== 'COMPLETED') {
      await prisma.knowledgeSource.update({
        where: { id: source.id },
        data: { status: 'COMPLETED' }
      });
    }

    let syncedCount = 0;

    for (const item of items) {
      // 2. Find or create KnowledgeDocument for this FAQ entry
      let doc = await prisma.knowledgeDocument.findFirst({
        where: {
          tenantId,
          accountId: trimmedAccountId,
          sourceId: source.id,
          title: item.title
        }
      });

      if (!doc) {
        doc = await prisma.knowledgeDocument.create({
          data: {
            tenantId,
            accountId: trimmedAccountId,
            sourceId: source.id,
            title: item.title,
            content: item.content
          }
        });
      } else {
        await prisma.knowledgeDocument.update({
          where: { id: doc.id },
          data: { content: item.content }
        });
      }

      // 3. Upsert chunk: delete existing chunk for this document to ensure clean content update
      await prisma.$executeRaw`
        DELETE FROM "KnowledgeChunk"
        WHERE "tenantId" = ${tenantId}
          AND "documentId" = ${doc.id}
      `;

      const embedding = await embeddingProvider.embedText(item.content);
      const embeddingString = `[${embedding.join(',')}]`;
      const metadataJson = JSON.stringify(item.metadata);

      await prisma.$executeRaw`
        INSERT INTO "KnowledgeChunk" (id, "tenantId", "accountId", "documentId", content, embedding, metadata, "updatedAt")
        VALUES (gen_random_uuid(), ${tenantId}, ${trimmedAccountId}, ${doc.id}, ${item.content}, ${embeddingString}::vector, ${metadataJson}::jsonb, NOW())
      `;
      syncedCount++;
    }

    console.log(`Synced ${syncedCount} FAQ knowledge chunks for tenant [${tenantId}] account [${trimmedAccountId || 'global'}]`);
    return syncedCount;
  }
}
