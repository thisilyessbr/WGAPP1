import { LanguageDetector, SupportedLanguage } from '../faq/FaqMatcher';
import { BusinessQuestionScope } from '../conversation/BusinessQuestionScope';

export type SupportedScript = 'latin' | 'arabic' | 'arabizi';

export interface DirectRagGuardResult {
  isSafe: boolean;
  reason: 'SAFE' | 'LANGUAGE_MISMATCH' | 'SCRIPT_MISMATCH' | 'UNSAFE_INTERNAL_CONTENT' | 'UNSUPPORTED_LANGUAGE' | 'EMPTY_CONTENT' | 'QUESTION_NOT_ANSWERED';
  queryLang: SupportedLanguage;
  chunkLang: SupportedLanguage;
  queryScript: SupportedScript;
  chunkScript: SupportedScript;
}

// Patterns representing internal prompt, training, sample QA, or metadata content
const INTERNAL_ARTIFACT_PATTERNS = [
  /^FAQ\s*\[[^\]]+\]\s*:/im,
  /^Multilingual Answers\s*:/im,
  /^Alternative Questions\s*:/im,
  /customer\s+(?:language\s+)?examples?/i,
  /training\s+examples?/i,
  /sample\s+(?:questions?|q\s*&\s*a|qa|prompts?)/i,
  /internal\s+notes?/i,
  /developer\s+(?:notes?|instructions?)/i,
  /prompt\s+instructions?/i,
  /system\s+prompt/i,
  /metadata\s*:/i,
  /instruction-like\s+sections?/i,
  /أمثلة\s+(?:لأسئلة\s+الزبناء|لغة\s+الزبون|للأسئلة|الأسئلة)/i,
  /تعليمات\s+(?:النظام|المطور)/i,
  /ملاحظات\s+داخلية/i
];

// Common English numeric patterns that are NOT Arabizi phonemes
const ENGLISH_NUMERIC_TIME_REGEX = /\b(\d+(?:am|pm|h|min|sec|nd|rd|th|st|k|m|g|gb|mb|tb|fps|v\d+)?)\b|\b(?:v\d+|sha\d+|utf\d+|b2b|b2c|p2p|mp\d+)\b/gi;

export class DirectRagGuard {
  /**
   * Checks if content contains un-sanitized internal labels, example blocks, or prompt instructions.
   */
  static hasInternalArtifacts(text: string): boolean {
    return INTERNAL_ARTIFACT_PATTERNS.some(pattern => pattern.test(text));
  }

  /**
   * Strips internal example/instruction labels from text if possible.
   */
  static sanitizeInternalArtifacts(text: string): string {
    let sanitized = text;
    for (const pattern of INTERNAL_ARTIFACT_PATTERNS) {
      sanitized = sanitized.replace(pattern, '').trim();
    }
    return sanitized;
  }
  /**
   * Cleans standard English numeric/time tokens before checking for Arabizi digits.
   */
  private static sanitizeEnglishNumerics(text: string): string {
    return text.replace(ENGLISH_NUMERIC_TIME_REGEX, ' ');
  }

  /**
   * Deterministically detects the language of a chunk or query, taking into account
   * English numeric/time patterns to avoid Arabizi false positives.
   */
  static detectLanguage(text: string): SupportedLanguage {
    if (!text || !text.trim()) return 'en';
    const trimmed = text.trim();

    // 1. Check for Arabic Script (Unicode Range U+0600 - U+06FF)
    const arabicCharCount = (trimmed.match(/[\u0600-\u06FF]/g) || []).length;
    if (arabicCharCount > 0 && arabicCharCount / trimmed.length > 0.15) {
      const darijaArabicMarkers = ['ديال', 'ديالكم', 'ديالي', 'بغيت', 'واش', 'شنو', 'كاين', 'عفاك', 'دابا', 'شحال', 'مزيان', 'خدام', 'راه', 'ماشي', 'باش', 'غادي'];
      const hasDarijaMarker = darijaArabicMarkers.some(marker => trimmed.includes(marker));
      return hasDarijaMarker ? 'darija' : 'ar';
    }

    // 2. Check for Latin-script Darija (Arabizi) vs English/French
    const sanitizedText = this.sanitizeEnglishNumerics(trimmed);
    return LanguageDetector.detect(sanitizedText);
  }

  /**
   * Deterministically detects script of a text.
   */
  static detectScript(text: string, lang?: SupportedLanguage): SupportedScript {
    if (!text || !text.trim()) return 'latin';
    const arabicCharCount = (text.match(/[\u0600-\u06FF]/g) || []).length;
    if (arabicCharCount > 0 && arabicCharCount / text.length > 0.15) {
      return 'arabic';
    }
    const detectedLang = lang || this.detectLanguage(text);
    if (detectedLang === 'darija') {
      return 'arabizi';
    }
    return 'latin';
  }

  /**
   * Evaluates whether a retrieved RAG chunk is safe for Direct-RAG response
   * based on strict language AND script compatibility between the customer's query and the chunk.
   */
  static evaluate(
    query: string,
    chunkContent: string,
    providedQueryLang?: SupportedLanguage,
    providedQueryScript?: SupportedScript,
    coverageMode: 'all' | 'any' = 'all'
  ): DirectRagGuardResult {
    if (!chunkContent || !chunkContent.trim()) {
      return {
        isSafe: false,
        reason: 'EMPTY_CONTENT',
        queryLang: providedQueryLang || 'en',
        chunkLang: 'en',
        queryScript: providedQueryScript || 'latin',
        chunkScript: 'latin'
      };
    }

    const queryLang = providedQueryLang || this.detectLanguage(query);
    const chunkLang = this.detectLanguage(chunkContent);
    const queryScript = providedQueryScript || this.detectScript(query, queryLang);
    const chunkScript = this.detectScript(chunkContent, chunkLang);

    // 1. Language compatibility check:
    // Allow query Darija in Arabic script to match an Arabic (MSA) chunk if both are in Arabic script
    const isLangCompatible = (queryLang === chunkLang) ||
      (queryLang === 'darija' && queryScript === 'arabic' && chunkLang === 'ar') ||
      (queryLang === 'ar' && chunkLang === 'darija' && chunkScript === 'arabic');

    if (!isLangCompatible) {
      return {
        isSafe: false,
        reason: 'LANGUAGE_MISMATCH',
        queryLang,
        chunkLang,
        queryScript,
        chunkScript
      };
    }

    // 2. Script compatibility check:
    // An English/French/Latin chunk cannot satisfy Arabic or Arabizi queries.
    // An Arabic chunk cannot satisfy Latin/Arabizi queries.
    if (queryScript === 'arabic' && chunkScript !== 'arabic') {
      return {
        isSafe: false,
        reason: 'SCRIPT_MISMATCH',
        queryLang,
        chunkLang,
        queryScript,
        chunkScript
      };
    }

    if (queryScript === 'arabizi' && chunkScript !== 'arabizi') {
      return {
        isSafe: false,
        reason: 'SCRIPT_MISMATCH',
        queryLang,
        chunkLang,
        queryScript,
        chunkScript
      };
    }

    if (queryScript === 'latin' && chunkScript !== 'latin') {
      return {
        isSafe: false,
        reason: 'SCRIPT_MISMATCH',
        queryLang,
        chunkLang,
        queryScript,
        chunkScript
      };
    }

    // 3. Content trust / internal artifact check:
    // Reject direct verbatim return if chunk contains internal labels, training headers, or example blocks
    if (this.hasInternalArtifacts(chunkContent)) {
      return {
        isSafe: false,
        reason: 'UNSAFE_INTERNAL_CONTENT',
        queryLang,
        chunkLang,
        queryScript,
        chunkScript
      };
    }

    // Semantic similarity can be high because a document names the same product,
    // even when it contains no answer to the customer's pricing question.
    const topicCount = BusinessQuestionScope.requestedTopicCount(query);
    const asksPrice = /\b(?:price|pricing|costs?|how much (?:is|does|for)|prix|tarifs?|combien (?:co[uû]te|est)|bch[7h]al|ch[7h]al|taman)\b|(?:ثمن|السعر|التكلفة|شحال)/iu.test(query);
    const hasPrice = /\b(?:mad|dh|dhs|eur|usd|gbp|dirhams?|euros?|dollars?|pounds?|free|gratuit\w*|costs?|price|prix|tarifs?)\b|[$€£]|(?:درهم|دراهم|مجاني|مجانا|ثمن|السعر)/iu.test(chunkContent);
    if (asksPrice && !hasPrice && topicCount <= 1) {
      return {
        isSafe: false,
        reason: 'QUESTION_NOT_ANSWERED',
        queryLang,
        chunkLang,
        queryScript,
        chunkScript
      };
    }

    // Contact questions often name both fields. A generic paragraph that
    // mentions "support" or "phone" is not the requested contact detail.
    if (/\b(?:email|e-mail|courriel)\b|إيميل|ايميل/iu.test(query) && !/@/u.test(chunkContent)
      || /\b(?:phone|telephone|téléphone|number)\b|هاتف|رقم/iu.test(query)
        && !/(?:\+?\d[\d\s().-]{6,}\d)/u.test(chunkContent)) {
      return { isSafe: false, reason: 'QUESTION_NOT_ANSWERED', queryLang, chunkLang, queryScript, chunkScript };
    }

    // Embedding similarity says the passage is related, not that it answers the
    // requested business fact. Be conservative here; rejected passages can still
    // be used as context for grounded generation.
    // A single direct-return passage must cover every requested fact. Partial
    // coverage is useful as LLM context, but unsafe as a complete customer answer.
    const coversRequestedTopic = coverageMode === 'any' && topicCount > 1
      ? BusinessQuestionScope.hasAnyCoveredTopic(query, chunkContent)
      : BusinessQuestionScope.isCovered(query, chunkContent);
    if (!coversRequestedTopic) {
      return { isSafe: false, reason: 'QUESTION_NOT_ANSWERED', queryLang, chunkLang, queryScript, chunkScript };
    }

    // A size table contains several valid but distinct answers. Do not return
    // the whole table as if it were the selected variant's recommendation.
    const asksExactSize = /\b(?:size|taille)\s*(?:xs|s|m|l|xl|xxl|\d{2})\b/iu.test(query);
    const listedSizes = new Set(Array.from(chunkContent.matchAll(/\b(?:size|taille)\s*(xs|s|m|l|xl|xxl|\d{2})\b/giu), m => m[1].toLowerCase()));
    if (asksExactSize && listedSizes.size > 1) {
      return { isSafe: false, reason: 'QUESTION_NOT_ANSWERED', queryLang, chunkLang, queryScript, chunkScript };
    }

    return {
      isSafe: true,
      reason: 'SAFE',
      queryLang,
      chunkLang,
      queryScript,
      chunkScript
    };
  }
}
