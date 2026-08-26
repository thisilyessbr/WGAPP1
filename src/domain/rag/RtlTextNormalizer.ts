/**
 * Deterministic RTL and Arabic text normalization for PDF extraction.
 * Handles Unicode normalization, visual-order reversal detection,
 * punctuation/bracket realignment, and whitespace normalization.
 */

export class RtlTextNormalizer {
  // Common Arabic definite article prefixes
  private static readonly ARABIC_AL_PREFIX = /^ال/u;
  // Common Arabic reversed definite article suffix (ال -> لا at word end)
  private static readonly ARABIC_LA_SUFFIX = /لا$/u;

  // Interrogative / common word stems that frequently get visual-reversed in PDF text extraction
  // e.g. شحال -> لاحش, كيفاش -> شافيك, شنو -> ونش, واش -> شاو, ديالي -> يلايد, التوصيل -> ليصوتلا
  private static readonly REVERSED_ARABIC_SIGNALS = [
    /ليصوتلا/u, // التوصيل
    /عاجرلإا/u, // الإرجاع
    /تاجتنملا/u, // المنتجات
    /يدوهلا/u,   // الهودي
    /نحشلا/u,    // الشحن
    /برغملا/u,   // المغرب
    /بلطلا/u,    // الطلب
    /عبتتلا/u,   // التتبع
    /ساقملا/u,   // المقاس
    /سفلاملا/u,  // الملابس
    /مسرلا/u,    // الرسم
    /ردصلا/u,    // الصدر
    /لاحش/u,     // شحال
    /شافيك/u,    // كيفاش
    /يلايد/u,    // ديالي
    /ونش/u,      // شنو
    /شاو/u       // واش
  ];

  /**
   * Complete deterministic normalization pipeline:
   * Unicode Normalization (NFKC) -> RTL/Reversal Correction -> Punctuation Realignment -> Whitespace Normalization
   */
  public static normalize(text: string): string {
    if (!text || typeof text !== 'string') return '';

    // 1. Unicode Normalization (NFKC standardizes presentation forms, ligatures, digits)
    let normalized = text.normalize('NFKC');

    // 2. Process line by line to preserve logical document structure
    const lines = normalized.split('\n');
    const processedLines = lines.map(line => this.normalizeLine(line));

    // 3. Rejoin and normalize paragraph breaks
    return processedLines
      .join('\n')
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /**
   * Normalizes a single line of text with RTL-awareness.
   */
  public static normalizeLine(line: string): string {
    const trimmed = line.trim();
    if (!trimmed) return '';

    // Check if the line contains Arabic characters
    const hasArabic = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/u.test(trimmed);
    if (!hasArabic) {
      return trimmed;
    }

    // Detect if this line exhibits reversed visual-order extraction
    if (this.isReversedArabicLine(trimmed)) {
      return this.reverseArabicVisualOrder(trimmed);
    }

    // Line is logically ordered Arabic; realign punctuation / brackets if needed
    return this.realignPunctuation(trimmed);
  }

  /**
   * Detects whether an Arabic line was extracted in reversed character/word order.
   */
  public static isReversedArabicLine(text: string): boolean {
    // Signal 1: Contains explicit reversed root tokens
    const hasReversedSignal = this.REVERSED_ARABIC_SIGNALS.some(pattern => pattern.test(text));
    if (hasReversedSignal) {
      return true;
    }

    // Signal 2: Arabic question mark at the START of the text, e.g. "؟... " or "»؟..."
    if (/^[\s»"'(]*؟/u.test(text)) {
      return true;
    }

    // Signal 3: Token analysis - count tokens ending with 'لا' (reversed 'ال') vs starting with 'ال'
    const words = text.split(/\s+/).filter(w => /[\u0600-\u06FF]/u.test(w));
    if (words.length >= 2) {
      let reversedAlCount = 0;
      let normalAlCount = 0;

      for (const w of words) {
        // Strip leading/trailing punctuation
        const cleanWord = w.replace(/^[^\u0600-\u06FF]+|[^\u0600-\u06FF]+$/gu, '');
        if (cleanWord.length >= 3) {
          if (this.ARABIC_LA_SUFFIX.test(cleanWord) && !cleanWord.startsWith('لا')) {
            reversedAlCount++;
          }
          if (this.ARABIC_AL_PREFIX.test(cleanWord)) {
            normalAlCount++;
          }
        }
      }

      if (reversedAlCount > 0 && reversedAlCount > normalAlCount) {
        return true;
      }
    }

    return false;
  }

  /**
   * Reverses Arabic visual ordering back to logical reading order
   * while preserving Latin text, numbers, and brackets correctly.
   */
  public static reverseArabicVisualOrder(text: string): string {
    // 1. Swap inverted quotes/brackets e.g. » -> «, « -> »
    let cleaned = text
      .replace(/»/g, '__LQUOTE__')
      .replace(/«/g, '»')
      .replace(/__LQUOTE__/g, '«');

    // 2. Tokenize by whitespace and punctuation boundaries while preserving order
    // In visual reversal, the words themselves are reversed right-to-left AND their internal characters are reversed.
    // For pure Arabic sentences: split into tokens, reverse each Arabic word's characters, then reverse the token array.
    const tokens = cleaned.split(/(\s+|[،,;:.!؟?"'«»()\[\]{}]+)/u).filter(t => t.length > 0);

    const reversedTokens: string[] = [];

    for (const token of tokens) {
      if (/[\u0600-\u06FF]/u.test(token)) {
        // Arabic token: reverse its characters
        const reversedCharToken = Array.from(token).reverse().join('');
        reversedTokens.push(reversedCharToken);
      } else {
        // Non-Arabic token (numbers, Latin words, punctuation)
        reversedTokens.push(token);
      }
    }

    // Reverse the entire sequence of tokens to restore logical reading order
    let restored = reversedTokens.reverse().join('');

    // Fix punctuation positioning: trailing question mark and quotes
    restored = this.realignPunctuation(restored);

    return restored.trim();
  }

  /**
   * Fixes common punctuation positioning issues in extracted RTL text.
   */
  public static realignPunctuation(text: string): string {
    let result = text;

    // Normalize misplaced leading question mark to trailing question mark
    if (/^؟\s*(.+)$/u.test(result)) {
      result = result.replace(/^؟\s*(.+)$/u, '$1؟');
    }

    // Fix mismatched quotes e.g. «...»
    if (result.startsWith('»') && result.endsWith('«')) {
      result = `«${result.slice(1, -1)}»`;
    }

    // Normalize spacing around Arabic comma and question mark
    result = result
      .replace(/\s+([،؟])/gu, '$1')
      .replace(/([،؟])(?=[^\s»"'\)\]\}])/gu, '$1 ')
      .replace(/\s+»/gu, '»')
      .replace(/«\s+/gu, '«');

    return result.trim();
  }
}
