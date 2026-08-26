/**
 * Policy Evidence Contract.
 * Defines structured evidence objects returned by the RAG retrieval pipeline
 * to guarantee provenance, intent mapping, quality metadata, and factual grounding.
 */

import { ChunkQualityType } from './ChunkQuality';
import { RAGChunk } from './RAGService';

export interface PolicyEvidence {
  intent: string;
  sourceDocumentId: string;
  sourceChunkId: string;
  factualContent: string;
  confidence: number;
  chunkType: ChunkQualityType;
  provenance: {
    documentTitle?: string;
    page?: number;
    tenantId: string;
    accountId?: string | null;
  };
}

export interface MultiPolicyEvidenceResult {
  context: string;
  chunks: RAGChunk[];
  evidence: PolicyEvidence[];
  coverage: Record<string, PolicyEvidence[]>;
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
