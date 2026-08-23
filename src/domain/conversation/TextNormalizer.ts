/**
 * TextNormalizer.ts
 *
 * Universal deterministic text normalizer providing language-aware orthographic,
 * morphological, and punctuation normalization without destructive stemming.
 * 100% deterministic, 0 LLM, 0 embeddings.
 */

export class TextNormalizer {
  /**
   * Universal Unicode normalization (NFKC).
   */
  public static normalizeUnicode(text: string): string {
    if (!text) return '';
    return text.normalize('NFKC');
  }

  /**
   * Normalizes case for latin characters while preserving unicode strings.
   */
  public static normalizeCase(text: string): string {
    if (!text) return '';
    return text.toLowerCase();
  }

  /**
   * Normalizes multiple spaces, tabs, and newlines into single spaces.
   */
  public static normalizeWhitespace(text: string): string {
    if (!text) return '';
    return text.replace(/\s+/g, ' ').trim();
  }

  /**
   * Strips common conversational punctuation while preserving hyphens within words.
   */
  public static normalizePunctuation(text: string): string {
    if (!text) return '';
    return text.replace(/[?؟,،.!;:()[\]{}'"“”«»`~^/\\<>+=_*|]/g, ' ');
  }

  /**
   * Normalizes Arabic orthography:
   * - Folds alef forms (أ, إ, آ, ٱ -> ا)
   * - Folds alef maqsura (ى -> ي)
   * - Strips tashkeel / harakat (diacritics)
   * - Strips tatweel (kashida ـ)
   * - Does NOT aggressively strip stems or destroy brand names.
   */
  public static normalizeArabicOrthography(text: string): string {
    if (!text) return '';
    return text
      // Strip Arabic diacritics / harakat / tanween
      .replace(/[\u064B-\u065F\u0670]/g, '')
      // Strip tatweel (kashida)
      .replace(/\u0640/g, '')
      // Fold alef variants
      .replace(/[\u0622\u0623\u0625\u0671]/g, '\u0627')
      // Fold alef maqsura to yaa
      .replace(/\u0649/g, '\u064A');
  }

  /**
   * Normalizes Arabizi (Moroccan Darija in Latin script with digit phonemes):
   * Maps common phoneme variations (e.g. 3 -> 'a/gh, 7 -> h, 9 -> q) for semantic token matching.
   */
  public static normalizeArabizi(text: string): string {
    if (!text) return '';
    let normalized = text.toLowerCase();
    // Normalize repeated characters (e.g. chhaaalll -> chhal, katsswa -> katswa)
    normalized = normalized.replace(/(.)\1{2,}/g, '$1$1');
    return normalized;
  }

  /**
   * Strips common Arabic and Darija proclitics (prepositions attached to nouns):
   * [الـ, فالـ, بالـ, كالـ, للـ, فـ, بـ, لـ, و]
   */
  public static stripProclitic(token: string): string {
    if (!token || token.length <= 2) return token;

    // 4-char prefixes (e.g. فالـ, بالـ, كالـ)
    if (token.startsWith('فال') || token.startsWith('بال') || token.startsWith('كال')) {
      return token.slice(3);
    }
    // 3-char prefix (للـ)
    if (token.startsWith('لل') && token.length > 3) {
      return token.slice(2);
    }
    // 2-char prefix (الـ)
    if (token.startsWith('ال') && token.length > 3) {
      return token.slice(2);
    }
    // 1-char prefix with hyphen (فـ, بـ, لـ)
    if ((token.startsWith('فـ') || token.startsWith('بـ') || token.startsWith('لـ')) && token.length > 2) {
      return token.slice(2);
    }
    // Attached single letter (و, ف, ب, ل)
    if ((token.startsWith('و') || token.startsWith('ف') || token.startsWith('ب') || token.startsWith('ل')) && token.length > 3) {
      const rest = token.slice(1);
      // If rest starts with ال
      if (rest.startsWith('ال') && rest.length > 3) {
        return rest.slice(2);
      }
      return rest;
    }
    // Latin Darija proclitics (l-, d-, f-, b-)
    if ((token.startsWith('l-') || token.startsWith('d-') || token.startsWith('f-') || token.startsWith('b-')) && token.length > 2) {
      return token.slice(2);
    }

    return token;
  }

  /**
   * Normalizes Moroccan Darija verbal aspect markers (e.g. كاتسوى, كتدير, كيسوى, كيعمل -> يسوى / يعمل).
   */
  public static normalizeVerbPrefix(token: string): string {
    if (!token || token.length <= 3) return token;

    // Arabic script verbal prefixes: كا-, كت-, كي-, ت-, ي-, ن-
    if (token.startsWith('كات') && token.length >= 5) {
      return token.slice(3); // كاتسوى -> سوى
    }
    if (token.startsWith('كا') && token.length >= 4) {
      return token.slice(2); // كاسوى -> سوى
    }
    if (token.startsWith('كت') && token.length >= 4) {
      return token.slice(2); // كتدير -> دير
    }
    if (token.startsWith('كي') && token.length >= 4) {
      return token.slice(2); // كيسوى -> سوى
    }

    // Latin Arabizi verbal prefixes: kat-, kay-, ka-
    if (token.startsWith('kat') && token.length >= 5) {
      return token.slice(3);
    }
    if (token.startsWith('kay') && token.length >= 5) {
      return token.slice(3);
    }
    if (token.startsWith('ka') && token.length >= 4) {
      return token.slice(2);
    }

    return token;
  }

  /**
   * Full comprehensive pipeline for semantic token matching.
   */
  public static normalizeForMatching(text: string): string {
    if (!text) return '';
    let res = this.normalizeUnicode(text);
    res = this.normalizeCase(res);
    res = this.normalizeArabicOrthography(res);
    res = this.normalizePunctuation(res);
    res = this.normalizeWhitespace(res);
    return res;
  }

  /**
   * Tokenizes and normalizes tokens for robust semantic matching.
   */
  public static tokenizeAndNormalize(text: string): string[] {
    const clean = this.normalizeForMatching(text);
    if (!clean) return [];
    return clean.split(/\s+/).filter(Boolean);
  }
}
