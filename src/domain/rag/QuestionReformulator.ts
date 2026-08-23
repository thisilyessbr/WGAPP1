import { ConversationMemory } from '../conversation/ConversationMemory';
import { LLMProvider } from '../../core/llm/LLMProvider';
import { logger } from '../../utils/logger';

export class QuestionReformulator {
  // Multilingual pronoun & anaphora signals
  private static readonly REFERENCE_PATTERNS = [
    // English
    /\b(it|that|this|they|them|those|these|its|their|theirs)\b/i,
    /\b(how much|how long|what about|and what|why that|which one|how do i get one|what about size|what about color)\b/i,
    // French
    /\b(il|elle|ils|elles|ça|cela|ceci|celui-ci|celle-ci|ceux-ci|celles-ci)\b/i,
    /\b(combien|et pour|qu'en est-il|et concernant|c'est combien|et pour la taille|et pour la couleur)\b/i,
    // Arabic
    /(هذا|هذه|ذلك|تلك|هؤلاء|كم|بكم|ماذا عن|وكيف|وهل|ماهو سعره|ماهي تكلفته|وماذا عن)/i,
    // Darija / Arabizi
    /\b(hada|hadi|hadik|hadou|hadok|bch7al|bchal|wchno|w chhal|ch7al|kifach|w bnesba)\b/i
  ];

  /**
   * Evaluates deterministically whether a query is ambiguous and context-dependent.
   */
  public static isAmbiguous(query: string, memory?: ConversationMemory | null): boolean {
    const trimmed = query.trim();
    if (!trimmed) return false;

    // If there is no previous conversational history, query cannot reference prior context
    if (!memory || !memory.recentTurns || memory.recentTurns.length === 0) {
      return false;
    }

    // 1. Check pronoun/anaphoric signals
    for (const pattern of this.REFERENCE_PATTERNS) {
      if (pattern.test(trimmed)) {
        return true;
      }
    }

    // 2. Short follow-up queries (<= 3 words and ends with '?')
    const wordCount = trimmed.split(/\s+/).length;
    if (wordCount <= 3 && trimmed.includes('?')) {
      return true;
    }

    return false;
  }

  /**
   * Reformulates an ambiguous query into a standalone search query using recent conversation turns.
   * If reformulation fails, times out, or produces empty text, returns the original query safely.
   */
  public static async reformulate(
    query: string,
    memory: ConversationMemory | null | undefined,
    llm?: LLMProvider | null,
    options?: { timeoutMs?: number; temperature?: number }
  ): Promise<{ retrievalQuery: string; reformulated: boolean; latencyMs: number }> {
    const startTime = Date.now();

    if (!memory || !llm || !this.isAmbiguous(query, memory)) {
      return { retrievalQuery: query, reformulated: false, latencyMs: 0 };
    }

    const turns = (memory.recentTurns || []).slice(-4);
    if (turns.length === 0) {
      return { retrievalQuery: query, reformulated: false, latencyMs: 0 };
    }

    const contextHistory = turns
      .map(t => `${t.role.toUpperCase()}: ${t.content}`)
      .join('\n');

    const systemPrompt = `You are a search query reformulator for a customer support retrieval system.
Given the recent conversation history and the user's latest follow-up question, rewrite the follow-up question into a single, standalone search query that resolves all pronouns and references.

Rules:
1. Output ONLY the standalone search query.
2. Do NOT answer the question.
3. Do NOT include explanations, prefixes, markdown, or punctuation formatting.
4. Keep the query concise and focused on the key search entities.
5. If the question is already standalone, return it unchanged.`;

    const userPrompt = `Conversation History:
${contextHistory}

Follow-up Question: ${query}

Standalone Search Query:`;

    const timeoutMs = options?.timeoutMs ?? 2000;

    try {
      const responsePromise = llm.generateResponse(
        systemPrompt,
        [{ role: 'user', content: userPrompt }],
        {
          temperature: options?.temperature ?? 0.0,
          maxTokens: 50,
          timeoutMs
        }
      );

      const timeoutPromise = new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error('REFORMULATION_TIMEOUT')), timeoutMs)
      );

      const rawResult = await Promise.race([responsePromise, timeoutPromise]);
      const latencyMs = Date.now() - startTime;
      const cleaned = (rawResult || '').trim().replace(/^["']|["']$/g, '');

      if (!cleaned || cleaned.toUpperCase() === 'UNANSWERABLE') {
        return { retrievalQuery: query, reformulated: false, latencyMs };
      }

      logger.info(`QuestionReformulator: Reformulated "${query}" -> "${cleaned}" in ${latencyMs}ms`);
      return { retrievalQuery: cleaned, reformulated: true, latencyMs };
    } catch (err: any) {
      const latencyMs = Date.now() - startTime;
      logger.warn(`QuestionReformulator: Fallback to original query due to: ${err.message || err}`);
      return { retrievalQuery: query, reformulated: false, latencyMs };
    }
  }
}
