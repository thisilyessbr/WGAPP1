import * as crypto from 'crypto';
import { EmbeddingProvider } from '../../core/rag/EmbeddingProvider';
import { KnowledgeRepository, RetrievedChunk } from './KnowledgeRepository';
import { BusinessConfig } from '../tenant/BusinessConfig';
import { DirectRagGuard } from './DirectRagGuard';
import { ChunkClassifier, ChunkQualityType } from './ChunkQuality';
import { PolicyEvidence, MultiPolicyEvidenceResult } from './PolicyEvidence';

export interface RAGChunk {
  id: string;
  documentId: string;
  content: string;
  score: number;
  similarity: number;
  documentTitle?: string;
  chunkType?: ChunkQualityType;
}

export interface RAGResult {
  context: string;
  chunks: RAGChunk[];
  evidence?: PolicyEvidence[];
}

export { PolicyEvidence, MultiPolicyEvidenceResult };

interface QueryEmbeddingCacheEntry {
  vector: number[];
  createdAt: number;
  expiresAt: number;
  lastAccess: number;
}

export class RAGService {
  public static readonly MAX_CACHE_ENTRIES = 500;
  public static readonly CACHE_TTL_MS = 3600 * 1000; // 1 hour sliding TTL
  private static readonly queryEmbeddingCache = new Map<string, QueryEmbeddingCacheEntry>();
  private static cacheStats = { hits: 0, misses: 0 };

  public static buildCacheKey(tenantId: string, provider: string, model: string, normalizedQuery: string): string {
    const queryHash = crypto.createHash('sha256').update(normalizedQuery.trim().toLowerCase()).digest('hex');
    return `query_embed:${tenantId}:${provider}:${model}:${queryHash}`;
  }

  public static clearEmbeddingCache(): void {
    RAGService.queryEmbeddingCache.clear();
    RAGService.cacheStats = { hits: 0, misses: 0 };
  }

  public static getEmbeddingCacheStats(): { hits: number; misses: number; size: number } {
    return {
      hits: RAGService.cacheStats.hits,
      misses: RAGService.cacheStats.misses,
      size: RAGService.queryEmbeddingCache.size
    };
  }

  public async getOrGenerateQueryEmbedding(
    tenantId: string,
    normalizedQuery: string,
    config?: BusinessConfig
  ): Promise<{ embedding: number[]; fromCache: boolean }> {
    if (!normalizedQuery || !normalizedQuery.trim()) {
      const vector = await this.embeddingProvider.embedText(normalizedQuery);
      return { embedding: vector, fromCache: false };
    }

    const provider = config?.knowledge?.embeddingProvider || 'gemini';
    const model = config?.knowledge?.embeddingModel || 'gemini-embedding-001';
    const cacheKey = RAGService.buildCacheKey(tenantId, provider, model, normalizedQuery);

    const now = Date.now();
    const cached = RAGService.queryEmbeddingCache.get(cacheKey);

    if (cached && now < cached.expiresAt) {
      cached.lastAccess = now;
      cached.expiresAt = now + RAGService.CACHE_TTL_MS;
      RAGService.cacheStats.hits++;
      // Re-insert to maintain LRU order (most recently accessed at end)
      RAGService.queryEmbeddingCache.delete(cacheKey);
      RAGService.queryEmbeddingCache.set(cacheKey, cached);
      return { embedding: cached.vector, fromCache: true };
    }

    if (cached) {
      RAGService.queryEmbeddingCache.delete(cacheKey);
    }

    RAGService.cacheStats.misses++;
    const vector = await this.embeddingProvider.embedText(normalizedQuery);

    // Evict oldest if full
    if (RAGService.queryEmbeddingCache.size >= RAGService.MAX_CACHE_ENTRIES) {
      const oldestKey = RAGService.queryEmbeddingCache.keys().next().value;
      if (oldestKey) {
        RAGService.queryEmbeddingCache.delete(oldestKey);
      }
    }

    RAGService.queryEmbeddingCache.set(cacheKey, {
      vector,
      createdAt: now,
      expiresAt: now + RAGService.CACHE_TTL_MS,
      lastAccess: now
    });

    return { embedding: vector, fromCache: false };
  }

  constructor(
    private embeddingProvider: EmbeddingProvider,
    private knowledgeRepository: KnowledgeRepository
  ) {}

  /**
   * Checks if a knowledge chunk contains internal instructions, developer notes, or sample Q&A.
   */
  public static isInternalOrExampleChunk(content: string): boolean {
    if (!content) return false;
    const classification = ChunkClassifier.classify(content);
    return classification.type === 'CUSTOMER_EXAMPLE' || 
           classification.type === 'FAQ_EXAMPLE' || 
           classification.type === 'INTERNAL_CONTENT' ||
           DirectRagGuard.hasInternalArtifacts(content);
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
            subqueries[intent] = `سياسة الإرجاع والاستبدال واسترجاع الأموال ومدة الإرجاع return exchange refund policy${entitySuffix}`;
          } else if (isFrench) {
            subqueries[intent] = `politique de retour échange remboursement et délai pour retourner return exchange refund policy${entitySuffix}`;
          } else {
            subqueries[intent] = `return exchange policy refund and return window time limit${entitySuffix}`;
          }
          break;
        case 'SHIPPING':
          if (isArabic) {
            subqueries[intent] = `مصاريف الشحن والتوصيل ومدة التوصيل والمدن shipping delivery fees${entitySuffix}`;
          } else if (isFrench) {
            subqueries[intent] = `frais de livraison délais de livraison expédition shipping delivery fees${entitySuffix}`;
          } else {
            subqueries[intent] = `shipping delivery fees delivery time and shipping zones${entitySuffix}`;
          }
          break;
        case 'CARE':
          if (isArabic) {
            subqueries[intent] = `طريقة الغسيل والعناية بالمنتج وتنظيف الملابس والتصبين washing care instructions${entitySuffix}`;
          } else if (isFrench) {
            subqueries[intent] = `conseils d'entretien lavage température comment laver washing care instructions${entitySuffix}`;
          } else {
            subqueries[intent] = `care instructions washing temperature how to wash and clean${entitySuffix}`;
          }
          break;
        case 'TRACKING':
          if (isArabic) {
            subqueries[intent] = `تتبع الطلب ومعرفة مكان الشحنة ورقم التتبع order tracking shipment status${entitySuffix}`;
          } else if (isFrench) {
            subqueries[intent] = `suivi de commande suivre mon colis numéro de suivi order tracking${entitySuffix}`;
          } else {
            subqueries[intent] = `order tracking track parcel shipment status tracking number${entitySuffix}`;
          }
          break;
        case 'WARRANTY':
          if (isArabic) {
            subqueries[intent] = `الضمان وشروط الضمان ومدة الضمان warranty guarantee policy${entitySuffix}`;
          } else if (isFrench) {
            subqueries[intent] = `garantie conditions de garantie durée et couverture warranty policy${entitySuffix}`;
          } else {
            subqueries[intent] = `warranty guarantee policy coverage and duration${entitySuffix}`;
          }
          break;
        case 'PAYMENT':
          if (isArabic) {
            subqueries[intent] = `طرق الدفع والدفع عند الاستلام كاش cash on delivery payment methods${entitySuffix}`;
          } else if (isFrench) {
            subqueries[intent] = `modes de paiement paiement à la livraison espèces cash on delivery payment${entitySuffix}`;
          } else {
            subqueries[intent] = `payment methods cash on delivery payment options${entitySuffix}`;
          }
          break;
        case 'STORE_INFO':
          if (isArabic) {
            subqueries[intent] = `مواقع المحلات والفروع وأوقات العمل والعنوان store locations opening business hours contact support email${entitySuffix}`;
          } else if (isFrench) {
            subqueries[intent] = `adresses des magasins boutiques horaires d'ouverture localisation store business hours contact email${entitySuffix}`;
          } else {
            subqueries[intent] = `store locations addresses opening business hours contact support email${entitySuffix}`;
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
   * Deterministically normalizes and expands query tokens (sizing, Arabizi, and Darija dialect concepts)
   * for cross-lingual vector embedding and semantic retrieval without extra LLM calls.
   */
  public static normalizeDialectQuery(text: string): string {
    if (!text) return '';
    let normalized = this.normalizeSizingQuery(text);
    const lower = normalized.toLowerCase();

    // 1. Arabizi & Darija Shipping / Delivery vocabulary
    if (/\b(?:twsil|tawsil|tawseel|tewsil|livraison|shipping|deliver|fin\s+kaywsal|fin\s+wslat|chhal\s+taman\s+twsil)\b/i.test(lower)) {
      normalized += ' livraison shipping delivery';
    }

    // 2. Arabizi & Darija Returns / Exchanges vocabulary
    if (/\b(?:rje3|rjou3|irja3|tbdel|tabdil|rje3ou|nrje3|nbdel|retour|exchange|refund|siyasat\s+rje3)\b/i.test(lower)) {
      normalized += ' retour return exchange';
    }

    // 3. Arabizi & Darija Care / Washing vocabulary
    if (/\b(?:nghsel|nghssal|ghsil|tassbine|tasbin|nsben|lavage|wash)\b/i.test(lower)) {
      normalized += ' lavage wash care instructions';
    }

    // 4. Arabizi & Darija Tracking / Order Status vocabulary
    if (/\b(?:ttalab|talab|fin\s+wsel|fin\s+wsl|suivi|tracking|colis)\b/i.test(lower)) {
      normalized += ' suivi tracking order status';
    }

    // 5. Arabizi & Darija Payment / COD vocabulary
    if (/\b(?:khlas|flous|kheles|daf3|paiement|payment|cod)\b/i.test(lower)) {
      normalized += ' paiement cash on delivery payment';
    }

    // 6. Store Info / Opening Hours / Support vocabulary
    if (/\b(?:hours?|opening|horaires|horaire|aw9at|khedma|ouvert|opening\s+hours|business\s+hours|contact|support\s+email)\b/i.test(lower)) {
      normalized += ' store opening business hours support email';
    }

    return normalized.replace(/\s+/g, ' ').trim();
  }

  /**
   * Retrieves matching chunks from repository and ranks them deterministically using
   * the Global Chunk Quality Model (Factual Policy > Mixed > Customer Examples > Document Headers).
   */
  async retrieveChunks(
    tenantId: string,
    query: string,
    config: BusinessConfig,
    accountId?: string | null
  ): Promise<RAGChunk[]> {
    if (!config.knowledge.enabled || !query || !query.trim()) {
      return [];
    }

    // 0. Normalize dialect notation and sizing if present
    const normalizedQuery = RAGService.normalizeDialectQuery(query);

    // 1. Generate or reuse cached query embedding
    const { embedding: queryEmbedding } = await this.getOrGenerateQueryEmbedding(tenantId, normalizedQuery, config);

    // 2. Search repository securely scoped to tenant and account
    // Request an expanded candidate pool to allow quality re-ranking
    const candidateLimit = Math.max(config.knowledge.topK || 4, 8);
    const minSim = typeof config.knowledge.minSimilarityScore === 'number' 
      ? config.knowledge.minSimilarityScore 
      : 0.45;

    const rawChunks = await this.knowledgeRepository.searchSimilar(
      tenantId,
      queryEmbedding,
      candidateLimit,
      minSim,
      accountId
    );

    // 3. Deduplicate, classify, and score candidates
    const classifiedChunks: RAGChunk[] = [];
    const seenContent = new Set<string>();

    for (const c of rawChunks) {
      const normContent = c.content.trim().toLowerCase();
      if (!normContent || seenContent.has(normContent)) continue;
      
      const isSubstringDuplicate = Array.from(seenContent).some(
        seen => normContent.length > 50 && (seen.includes(normContent) || normContent.includes(seen))
      );
      if (isSubstringDuplicate) continue;
      seenContent.add(normContent);

      const classification = ChunkClassifier.classify(c.content, c.metadata);

      // Discard hard noise (page numbers, developer internal notes, empty chunks)
      if (classification.type === 'PAGE_LABEL' || 
          classification.type === 'INTERNAL_CONTENT' || 
          classification.type === 'LOW_VALUE') {
        continue;
      }

      // Compute composite quality score: similarity * quality multiplier
      const effectiveScore = c.similarity * classification.qualityMultiplier;

      classifiedChunks.push({
        id: c.id,
        documentId: c.documentId,
        content: c.content,
        score: effectiveScore,
        similarity: c.similarity,
        documentTitle: c.documentTitle,
        chunkType: classification.type
      });
    }

    // 4. Deterministic Sort: Rank by composite score descending
    // (Factual Policy strictly outranks Customer Examples and Document Headers)
    classifiedChunks.sort((a, b) => b.score - a.score);

    return classifiedChunks.slice(0, config.knowledge.topK || 4);
  }

  /**
   * Performs targeted retrieval across multiple detected policy topics without wasting retrieval slots.
   * Maximum 4 intents, maximum 2 chunks per intent.
   * Returns structured PolicyEvidence objects for each selected piece of evidence.
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
        evidence: [],
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
    const coverage: Record<string, PolicyEvidence[]> = {};
    const availableIntents: string[] = [];
    const missingIntents: string[] = [];
    const allSelectedChunks: RAGChunk[] = [];
    const allSelectedEvidence: PolicyEvidence[] = [];

    let totalEmbeddingCalls = 0;
    let totalCandidates = 0;
    let totalFilteredInternal = 0;

    for (const intent of boundedIntents) {
      const subquery = subqueries[intent];
      if (!subquery) continue;

      // 1. Generate or reuse cached query embedding
      const { embedding: queryEmbedding, fromCache } = await this.getOrGenerateQueryEmbedding(tenantId, subquery, config);
      if (!fromCache) {
        totalEmbeddingCalls++;
      }

      // 2. Retrieve candidates (top 6 to allow quality classification)
      const rawCandidates = await this.knowledgeRepository.searchSimilar(
        tenantId,
        queryEmbedding,
        6,
        config.knowledge.minSimilarityScore || 0.45,
        accountId
      );
      totalCandidates += rawCandidates.length;

      // 3. Classify and rank candidates
      const intentCandidates: RAGChunk[] = [];

      for (const c of rawCandidates) {
        const classification = ChunkClassifier.classify(c.content, c.metadata);

        if (classification.type === 'PAGE_LABEL' || 
            classification.type === 'INTERNAL_CONTENT' || 
            classification.type === 'LOW_VALUE') {
          totalFilteredInternal++;
          continue;
        }

        const effectiveScore = c.similarity * classification.qualityMultiplier;

        intentCandidates.push({
          id: c.id,
          documentId: c.documentId,
          content: c.content,
          score: effectiveScore,
          similarity: c.similarity,
          documentTitle: c.documentTitle,
          chunkType: classification.type
        });
      }

      // Sort intent candidates by composite quality score descending
      intentCandidates.sort((a, b) => b.score - a.score);

      const topChunksForIntent = intentCandidates.slice(0, 2);

      if (topChunksForIntent.length > 0) {
        availableIntents.push(intent);
        const intentEvidenceList: PolicyEvidence[] = [];

        for (const ch of topChunksForIntent) {
          const evidenceObj: PolicyEvidence = {
            intent,
            sourceDocumentId: ch.documentId,
            sourceChunkId: ch.id,
            factualContent: ch.content,
            confidence: ch.similarity,
            chunkType: ch.chunkType || 'FACTUAL_POLICY',
            provenance: {
              documentTitle: ch.documentTitle,
              tenantId,
              accountId
            }
          };

          intentEvidenceList.push(evidenceObj);

          const alreadyInList = allSelectedChunks.some(
            s => s.id === ch.id || s.content.trim().toLowerCase() === ch.content.trim().toLowerCase()
          );
          if (!alreadyInList) {
            allSelectedChunks.push(ch);
            allSelectedEvidence.push(evidenceObj);
          }
        }

        coverage[intent] = intentEvidenceList;
      } else {
        missingIntents.push(intent);
      }
    }

    const context = this.formatContext(allSelectedChunks, config.knowledge.maxContextSize);

    return {
      context,
      chunks: allSelectedChunks,
      evidence: allSelectedEvidence,
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
