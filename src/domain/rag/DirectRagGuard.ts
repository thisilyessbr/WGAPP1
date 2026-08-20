import { LanguageDetector, SupportedLanguage } from '../faq/FaqMatcher';

export interface DirectRagGuardResult {
  isSafe: boolean;
  reason: 'SAFE' | 'LANGUAGE_MISMATCH' | 'UNSUPPORTED_LANGUAGE' | 'EMPTY_CONTENT';
  queryLang: SupportedLanguage;
  chunkLang: SupportedLanguage;
}

// Common English numeric patterns that are NOT Arabizi phonemes
const ENGLISH_NUMERIC_TIME_REGEX = /\b(\d+(?:am|pm|h|min|sec|nd|rd|th|st|k|m|g|gb|mb|tb|fps|v\d+)?)\b|\b(?:v\d+|sha\d+|utf\d+|b2b|b2c|p2p|mp\d+)\b/gi;

export class DirectRagGuard {
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
   * Evaluates whether a retrieved RAG chunk is safe for Direct-RAG response
   * based on strict language compatibility between the customer's query and the chunk.
   */
  static evaluate(
    query: string,
    chunkContent: string,
    providedQueryLang?: SupportedLanguage
  ): DirectRagGuardResult {
    if (!chunkContent || !chunkContent.trim()) {
      return {
        isSafe: false,
        reason: 'EMPTY_CONTENT',
        queryLang: providedQueryLang || 'en',
        chunkLang: 'en'
      };
    }

    const queryLang = providedQueryLang || this.detectLanguage(query);
    const chunkLang = this.detectLanguage(chunkContent);

    // Direct-RAG is allowed ONLY when query language and chunk language match identically
    if (queryLang !== chunkLang) {
      return {
        isSafe: false,
        reason: 'LANGUAGE_MISMATCH',
        queryLang,
        chunkLang
      };
    }

    return {
      isSafe: true,
      reason: 'SAFE',
      queryLang,
      chunkLang
    };
  }
}
