import { EmbeddingProvider } from '../../core/rag/EmbeddingProvider';
import { KnowledgeRepository, RetrievedChunk } from './KnowledgeRepository';
import { BusinessConfig } from '../tenant/BusinessConfig';
import { DirectRagGuard } from './DirectRagGuard';

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

export interface MultiPolicyEvidenceResult {
  context: string;
  chunks: RAGChunk[];
  coverage: Record<string, RAGChunk[]>;
  availableIntents: string[];
  missingIntents: string[];
  telemetry: {
    policySubqueries: Record<string, string>;
    embeddingCalls: number;
    retrievedCandidates: number;
    filteredInternalChunks: number;
    finalEvidenceChunks: number;
    missingPolicyIntents: string[];
  };
}

export class RAGService {
  constructor(
    private embeddingProvider: EmbeddingProvider,
    private knowledgeRepository: KnowledgeRepository
  ) {}

  /**
   * Checks if a knowledge chunk contains internal instructions, developer notes, or sample Q&A.
   */
  public static isInternalOrExampleChunk(content: string): boolean {
    if (!content) return false;
    return DirectRagGuard.hasInternalArtifacts(content);
  }

  /**
   * Deterministically builds targeted search subqueries for each detected policy intent.
   * Zero LLM calls are used.
   */
  public static buildPolicySubqueries(
    intents: string[],
    language: string = 'en',
    productName?: string | null
  ): Record<string, string> {
    const subqueries: Record<string, string> = {};
    const isArabic = language === 'ar' || language === 'darija';
    const isFrench = language === 'fr';
    const entitySuffix = productName ? ` ${productName}` : '';

    for (const intent of intents.slice(0, 4)) {
      switch (intent) {
        case 'RETURNS':
          if (isArabic) {
            subqueries[intent] = `سياسة الإرجاع والاستبدال واسترجاع الأموال ومدة الإرجاع${entitySuffix}`;
          } else if (isFrench) {
            subqueries[intent] = `politique de retour échange remboursement et délai pour retourner${entitySuffix}`;
          } else {
            subqueries[intent] = `return exchange policy refund and return window time limit${entitySuffix}`;
          }
          break;
        case 'SHIPPING':
          if (isArabic) {
            subqueries[intent] = `مصاريف الشحن والتوصيل ومدة التوصيل والمدن${entitySuffix}`;
          } else if (isFrench) {
            subqueries[intent] = `frais de livraison délais de livraison expédition et villes${entitySuffix}`;
          } else {
            subqueries[intent] = `shipping delivery fees delivery time and shipping zones${entitySuffix}`;
          }
          break;
        case 'CARE':
          if (isArabic) {
            subqueries[intent] = `طريقة الغسيل والعناية بالمنتج وتنظيف الملابس والتصبين${entitySuffix}`;
          } else if (isFrench) {
            subqueries[intent] = `conseils d'entretien lavage température comment laver et sécher${entitySuffix}`;
          } else {
            subqueries[intent] = `care instructions washing temperature how to wash and clean${entitySuffix}`;
          }
          break;
        case 'TRACKING':
          if (isArabic) {
            subqueries[intent] = `تتبع الطلب ومعرفة مكان الشحنة ورقم التتبع${entitySuffix}`;
          } else if (isFrench) {
            subqueries[intent] = `suivi de commande suivre mon colis numéro de suivi${entitySuffix}`;
          } else {
            subqueries[intent] = `order tracking track parcel shipment status tracking number${entitySuffix}`;
          }
          break;
        case 'WARRANTY':
          if (isArabic) {
            subqueries[intent] = `الضمان وشروط الضمان ومدة الضمان${entitySuffix}`;
          } else if (isFrench) {
            subqueries[intent] = `garantie conditions de garantie durée et couverture${entitySuffix}`;
          } else {
            subqueries[intent] = `warranty guarantee policy coverage and duration${entitySuffix}`;
          }
          break;
        case 'PAYMENT':
          if (isArabic) {
            subqueries[intent] = `طرق الدفع والدفع عند الاستلام كاش${entitySuffix}`;
          } else if (isFrench) {
            subqueries[intent] = `modes de paiement paiement à la livraison espèces${entitySuffix}`;
          } else {
            subqueries[intent] = `payment methods cash on delivery payment options${entitySuffix}`;
          }
          break;
        case 'STORE_INFO':
          if (isArabic) {
            subqueries[intent] = `مواقع المحلات والفروع وأوقات العمل والعنوان${entitySuffix}`;
          } else if (isFrench) {
            subqueries[intent] = `adresses des magasins boutiques horaires d'ouverture localisation${entitySuffix}`;
          } else {
            subqueries[intent] = `store locations addresses opening business hours contact${entitySuffix}`;
          }
          break;
        default:
          subqueries[intent] = `${intent} store policy information${entitySuffix}`;
          break;
      }
    }
    return subqueries;
  }

  /**
   * Normalizes sizing queries (e.g. "98 cm", "98 سم", "98cm", "98 centimeters")
   * to ensure reliable size-guide embedding and retrieval without extra LLM calls.
   */
  public static normalizeSizingQuery(text: string): string {
    if (!text) return '';
    return text
      .replace(/(\d+)\s*(?:centimeters|centimeter|centimètres|centimètre)\b/gi, '$1 cm')
      .replace(/(\d+)\s*(?:سنتيمتر|سنتمتر|سم)(?:$|\s|[.,!?;:()،؟])/gui, '$1 cm ')
      .replace(/(\d+)cm\b/gi, '$1 cm')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Retrieves raw matching chunks from the knowledge repository scoped to tenant and optional account.
   * Prioritizes factual policy chunks over internal/example chunks.
   */
  async retrieveChunks(
    tenantId: string,
    query: string,
    config: BusinessConfig,
    accountId?: string | null
  ): Promise<RAGChunk[]> {
    if (!config.knowledge.enabled) {
      return [];
    }

    // 0. Normalize sizing notation if present
    const normalizedQuery = RAGService.normalizeSizingQuery(query);

    // 1. Generate query embedding
    const queryEmbedding = await this.embeddingProvider.embedText(normalizedQuery);

    // 2. Search repository securely scoped to tenant and account
    const rawChunks = await this.knowledgeRepository.searchSimilar(
      tenantId,
      queryEmbedding,
      Math.max(config.knowledge.topK || 4, 6),
      config.knowledge.minSimilarityScore,
      accountId
    );

    // 3. Deduplicate and separate factual chunks from internal/example chunks
    const validChunks: RAGChunk[] = [];
    const exampleChunks: RAGChunk[] = [];

    for (const c of rawChunks) {
      const normContent = c.content.trim().toLowerCase();
      const isDuplicate = [...validChunks, ...exampleChunks].some(u => {
        const uNorm = u.content.trim().toLowerCase();
        return uNorm === normContent || (normContent.length > 50 && (uNorm.includes(normContent) || normContent.includes(uNorm)));
      });

      if (!isDuplicate) {
        const chunkObj: RAGChunk = {
          id: c.id,
          documentId: c.documentId,
          content: c.content,
          score: c.similarity,
          similarity: c.similarity
        };

        if (RAGService.isInternalOrExampleChunk(c.content)) {
          exampleChunks.push(chunkObj);
        } else {
          validChunks.push(chunkObj);
        }
      }
    }

    // Factual chunks outrank internal example chunks
    return [...validChunks, ...exampleChunks].slice(0, config.knowledge.topK || 4);
  }

  /**
   * Performs targeted retrieval across multiple detected policy topics without wasting retrieval slots.
   * Maximum 4 intents, maximum 2 chunks per intent.
   */
  async retrieveMultiPolicy(
    tenantId: string,
    intents: string[],
    config: BusinessConfig,
    accountId?: string | null,
    language: string = 'en',
    productName?: string | null
  ): Promise<MultiPolicyEvidenceResult> {
    if (!config.knowledge.enabled || !intents.length) {
      return {
        context: '',
        chunks: [],
        coverage: {},
        availableIntents: [],
        missingIntents: [...intents],
        telemetry: {
          policySubqueries: {},
          embeddingCalls: 0,
          retrievedCandidates: 0,
          filteredInternalChunks: 0,
          finalEvidenceChunks: 0,
          missingPolicyIntents: [...intents]
        }
      };
    }

    const boundedIntents = intents.slice(0, 4);
    const subqueries = RAGService.buildPolicySubqueries(boundedIntents, language, productName);
    const coverage: Record<string, RAGChunk[]> = {};
    const availableIntents: string[] = [];
    const missingIntents: string[] = [];
    const allSelectedChunks: RAGChunk[] = [];

    let totalEmbeddingCalls = 0;
    let totalCandidates = 0;
    let totalFilteredInternal = 0;

    for (const intent of boundedIntents) {
      const subquery = subqueries[intent];
      if (!subquery) continue;

      // 1. Generate query embedding
      const queryEmbedding = await this.embeddingProvider.embedText(subquery);
      totalEmbeddingCalls++;

      // 2. Retrieve candidates (top 4 to allow filtering internal/example chunks)
      const rawCandidates = await this.knowledgeRepository.searchSimilar(
        tenantId,
        queryEmbedding,
        4,
        config.knowledge.minSimilarityScore || 0.45,
        accountId
      );
      totalCandidates += rawCandidates.length;

      // 3. Filter / classify internal & example chunks
      const validCandidates: RAGChunk[] = [];
      const exampleCandidates: RAGChunk[] = [];

      for (const c of rawCandidates) {
        const chunk: RAGChunk = {
          id: c.id,
          documentId: c.documentId,
          content: c.content,
          score: c.similarity,
          similarity: c.similarity
        };

        if (RAGService.isInternalOrExampleChunk(c.content)) {
          totalFilteredInternal++;
          exampleCandidates.push(chunk);
        } else {
          validCandidates.push(chunk);
        }
      }

      // Factual chunks outrank internal example chunks. Only use example chunk if 0 factual chunks found.
      const candidatesToUse = validCandidates.length > 0 ? validCandidates : exampleCandidates;
      const topChunksForIntent = candidatesToUse.slice(0, 2);

      if (topChunksForIntent.length > 0) {
        coverage[intent] = topChunksForIntent;
        availableIntents.push(intent);
        for (const ch of topChunksForIntent) {
          const alreadyInList = allSelectedChunks.some(
            s => s.id === ch.id || s.content.trim().toLowerCase() === ch.content.trim().toLowerCase()
          );
          if (!alreadyInList) {
            allSelectedChunks.push(ch);
          }
        }
      } else {
        missingIntents.push(intent);
      }
    }

    const context = this.formatContext(allSelectedChunks, config.knowledge.maxContextSize);

    return {
      context,
      chunks: allSelectedChunks,
      coverage,
      availableIntents,
      missingIntents,
      telemetry: {
        policySubqueries: subqueries,
        embeddingCalls: totalEmbeddingCalls,
        retrievedCandidates: totalCandidates,
        filteredInternalChunks: totalFilteredInternal,
        finalEvidenceChunks: allSelectedChunks.length,
        missingPolicyIntents: missingIntents
      }
    };
  }

  /**
   * Formats an array of chunk objects into a bounded prompt context string.
   * Enforces maxContextSize as a strict upper bound while safely truncating
   * oversized chunks and preventing premature context dropping.
   */
  formatContext(chunks: RAGChunk[], maxContextSize: number): string {
    if (
      !chunks ||
      chunks.length === 0 ||
      typeof maxContextSize !== 'number' ||
      maxContextSize <= 0 ||
      isNaN(maxContextSize)
    ) {
      return '';
    }

    let assembledContext = '';
    for (const chunk of chunks) {
      if (!chunk || !chunk.content || typeof chunk.content !== 'string') {
        continue;
      }

      const content = chunk.content.trim();
      if (!content) {
        continue;
      }

      const separator = '\n---\n';
      const remainingBudget = maxContextSize - assembledContext.length;
      if (remainingBudget <= 0) {
        break;
      }

      const addition = `${separator}${content}`;
      if (assembledContext.length + addition.length <= maxContextSize) {
        assembledContext += addition;
      } else {
        // Truncate chunk content to fit remaining budget (accounting for separator)
        const availableForContent = remainingBudget - separator.length;
        if (availableForContent > 0) {
          const truncated = content.slice(0, availableForContent).trimEnd();
          if (truncated.length > 0) {
            assembledContext += `${separator}${truncated}`;
          }
        } else if (assembledContext.length === 0) {
          // If assembledContext is empty and remainingBudget < separator.length,
          // slice content directly to fill available budget
          const directTruncated = content.slice(0, remainingBudget).trimEnd();
          if (directTruncated.length > 0) {
            assembledContext += directTruncated;
          }
        }
        break;
      }
    }

    const trimmed = assembledContext.trim();
    return trimmed.length > maxContextSize ? trimmed.slice(0, maxContextSize).trimEnd() : trimmed;
  }

  /**
   * Retrieves relevant knowledge context formatted as a string for LLM prompts.
   */
  async retrieveContext(
    tenantId: string,
    query: string,
    config: BusinessConfig,
    accountId?: string | null
  ): Promise<string> {
    const chunks = await this.retrieveChunks(tenantId, query, config, accountId);
    return this.formatContext(chunks, config.knowledge.maxContextSize);
  }

  /**
   * Retrieves both structured chunk array and formatted context string.
   */
  async retrieve(
    tenantId: string,
    query: string,
    config: BusinessConfig,
    accountId?: string | null
  ): Promise<RAGResult> {
    const chunks = await this.retrieveChunks(tenantId, query, config, accountId);
    const context = this.formatContext(chunks, config.knowledge.maxContextSize);
    return { context, chunks };
  }
}
