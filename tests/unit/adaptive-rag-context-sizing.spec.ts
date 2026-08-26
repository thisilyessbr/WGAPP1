import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChunkClassifier } from '../../src/domain/rag/ChunkQuality';
import { ConversationEngine } from '../../src/domain/conversation/ConversationEngine';
import { RAGChunk } from '../../src/domain/rag/RAGService';

describe('Phase COST-FIX-46I: Adaptive RAG Context Sizing', () => {
  // Helper to evaluate the exact boolean logic implemented in ConversationEngine
  function evaluateAdaptiveChunkCount(
    chunks: RAGChunk[],
    turnDecision: { isMultiPolicy?: boolean; isComparative?: boolean; source?: string } = {}
  ): number {
    const topChunk = chunks?.[0];
    const secondChunk = chunks?.[1];

    const isSingleDominantChunk = Boolean(
      topChunk &&
      !turnDecision?.isMultiPolicy &&
      !turnDecision?.isComparative &&
      turnDecision?.source !== 'HYBRID' &&
      (topChunk.similarity ?? 0) >= 0.78 &&
      (
        !secondChunk ||
        ((topChunk.similarity ?? 0) - (secondChunk.similarity ?? 0)) >= 0.10
      ) &&
      ChunkClassifier.classify(topChunk.content).type === 'FACTUAL_POLICY'
    );

    const maxChunks = turnDecision?.isMultiPolicy ? 6 : (isSingleDominantChunk ? 1 : 3);
    return (chunks || []).slice(0, maxChunks).length;
  }

  const factualChunk1: RAGChunk = {
    id: 'ch-1',
    documentId: 'doc-1',
    content: 'The consultation price is 750 MAD for a 45-minute session with our specialist.',
    similarity: 0.88,
    score: 0.88
  };

  const factualChunk2: RAGChunk = {
    id: 'ch-2',
    documentId: 'doc-1',
    content: 'Cancellation requires 24 hours notice. Late cancellations incur a 50% fee.',
    similarity: 0.52,
    score: 0.52
  };

  const factualChunk3: RAGChunk = {
    id: 'ch-3',
    documentId: 'doc-1',
    content: 'Opening hours are from 10:00 to 20:00 Monday through Saturday.',
    similarity: 0.45,
    score: 0.45
  };

  it('A. top=0.88, second=0.52, factual_policy -> sends 1 chunk (dominant top chunk)', () => {
    const chunks = [factualChunk1, factualChunk2, factualChunk3];
    const count = evaluateAdaptiveChunkCount(chunks);
    expect(count).toBe(1);
  });

  it('B. top=0.85, second=0.49, factual_policy -> sends 1 chunk', () => {
    const ch1 = { ...factualChunk1, similarity: 0.85 };
    const ch2 = { ...factualChunk2, similarity: 0.49 };
    const chunks = [ch1, ch2, factualChunk3];
    const count = evaluateAdaptiveChunkCount(chunks);
    expect(count).toBe(1);
  });

  it('C. top=0.78, second=0.76 (delta=0.02 < 0.10) -> sends 3 chunks (narrow margin)', () => {
    const ch1 = { ...factualChunk1, similarity: 0.78 };
    const ch2 = { ...factualChunk2, similarity: 0.76 };
    const chunks = [ch1, ch2, factualChunk3];
    const count = evaluateAdaptiveChunkCount(chunks);
    expect(count).toBe(3);
  });

  it('D. top=0.77 (< 0.78 threshold) -> sends 3 chunks', () => {
    const ch1 = { ...factualChunk1, similarity: 0.77 };
    const ch2 = { ...factualChunk2, similarity: 0.50 };
    const chunks = [ch1, ch2, factualChunk3];
    const count = evaluateAdaptiveChunkCount(chunks);
    expect(count).toBe(3);
  });

  it('E. multi-policy (isMultiPolicy: true) -> sends 6 chunks', () => {
    const chunks = [
      factualChunk1,
      factualChunk2,
      factualChunk3,
      { ...factualChunk1, id: 'ch-4' },
      { ...factualChunk2, id: 'ch-5' },
      { ...factualChunk3, id: 'ch-6' }
    ];
    const count = evaluateAdaptiveChunkCount(chunks, { isMultiPolicy: true });
    expect(count).toBe(6);
  });

  it('F. comparative (isComparative: true) -> sends 3 chunks', () => {
    const chunks = [factualChunk1, factualChunk2, factualChunk3];
    const count = evaluateAdaptiveChunkCount(chunks, { isComparative: true });
    expect(count).toBe(3);
  });

  it('G. HYBRID source (source: "HYBRID") -> sends 3 chunks', () => {
    const chunks = [factualChunk1, factualChunk2, factualChunk3];
    const count = evaluateAdaptiveChunkCount(chunks, { source: 'HYBRID' });
    expect(count).toBe(3);
  });

  it('H. top chunk classified non-factual (CUSTOMER_EXAMPLE) -> sends 3 chunks', () => {
    const nonFactualChunk: RAGChunk = {
      id: 'ch-example',
      documentId: 'doc-1',
      content: 'Customer language examples: "How much does it cost?", "Can I get a discount?"',
      similarity: 0.90,
      score: 0.90
    };
    const chunks = [nonFactualChunk, factualChunk2, factualChunk3];
    const count = evaluateAdaptiveChunkCount(chunks);
    expect(count).toBe(3);
  });

  it('I. single chunk returned with similarity >= 0.78 -> sends 1 chunk', () => {
    const chunks = [factualChunk1];
    const count = evaluateAdaptiveChunkCount(chunks);
    expect(count).toBe(1);
  });
});
