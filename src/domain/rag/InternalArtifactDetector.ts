/**
 * InternalArtifactDetector.ts
 *
 * Structural, token-class-based internal artifact classifier and sanitizer.
 * Normalizes Unicode, case, punctuation, separators, and repeated whitespace
 * to detect generic structural combinations of internal instructions/artifacts.
 * 100% deterministic, 0 LLM, 0 embeddings.
 */

export class InternalArtifactDetector {
  private static readonly ROOT_A = [
    'developer', 'internal', 'system', 'training', 'sample', 'customer', 'prompt', 'metadata'
  ];
  private static readonly ROOT_B = [
    'internal', 'notes', 'note', 'instructions', 'instruction', 'guidance', 'examples', 'example',
    'prompt', 'prompts', 'qa', 'q&a', 'questions', 'metadata', 'secret', 'secret_key'
  ];

  // Arabic equivalents
  private static readonly ARABIC_PATTERNS = [
    /تعليمات\s*(?:النظام|المطور|داخلية)/i,
    /ملاحظات\s*(?:داخلية|المطور|النظام)/i,
    /أمثلة\s*(?:تدريبية|لأسئلة\s*الزبناء|للأسئلة|الأسئلة)/i,
    /برومبت\s*(?:النظام|سري|داخلي)/i
  ];

  /**
   * Checks if content contains structural internal developer or system artifact patterns.
   */
  public static hasInternalArtifacts(text: string): boolean {
    if (!text || typeof text !== 'string') return false;

    // Check Arabic patterns directly
    if (this.ARABIC_PATTERNS.some(pat => pat.test(text))) {
      return true;
    }

    // Check parenthetical blocks with internal concepts
    if (/\([^)]*(?:developer|internal|prompt|system|training|metadata)[^)]*\)/i.test(text)) {
      return true;
    }

    // Normalize text: lowercase, strip punctuation to space, collapse whitespace
    const normalized = text
      .toLowerCase()
      .replace(/[\p{P}\p{S}]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const tokens = normalized.split(' ');

    // Check for combinations of (ROOT_A + ROOT_B) within sliding window of 3 tokens
    for (let i = 0; i < tokens.length; i++) {
      const tA = tokens[i];
      if (this.ROOT_A.includes(tA)) {
        for (let j = i + 1; j <= Math.min(tokens.length - 1, i + 3); j++) {
          const tB = tokens[j];
          if (this.ROOT_B.includes(tB)) {
            return true;
          }
        }
      }
    }

    return false;
  }

  /**
   * Sanitizes text by stripping all internal artifact clauses and parenthetical annotations.
   */
  public static sanitize(text: string): string {
    if (!text || typeof text !== 'string') return '';

    let cleaned = text;

    // 1. Strip parenthetical internal notes e.g. (Developer internal: secret_key)
    cleaned = cleaned.replace(/\([^)]*(?:developer|internal|prompt|system|training|metadata)[^)]*\)/gi, ' ');

    // 2. Strip structural artifact patterns and following payload until punctuation or line break
    const patterns = [
      /customer\s+(?:language\s+)?examples?\s*[:=]?\s*[^.\n!?;()]*/gi,
      /training\s+examples?\s*[:=]?\s*[^.\n!?;()]*/gi,
      /sample\s+(?:questions?|q\s*&\s*a|qa|prompts?)\s*[:=]?\s*[^.\n!?;()]*/gi,
      /internal\s+notes?\s*[:=]?\s*[^.\n!?;()]*/gi,
      /developer\s+(?:notes?|instructions?|internal|guidance)\s*[:=]?\s*[^.\n!?;()]*/gi,
      /prompt\s+instructions?\s*[:=]?\s*[^.\n!?;()]*/gi,
      /system\s+prompt\s*[:=]?\s*[^.\n!?;()]*/gi,
      /metadata\s*[:=]\s*[^.\n!?;()]*/gi,
      /instruction-like\s+sections?\s*[:=]?\s*[^.\n!?;()]*/gi,
      /أمثلة\s*(?:تدريبية|لأسئلة\s*الزبناء|للأسئلة|الأسئلة)\s*[:=]?\s*[^.,\n!?;()]*/gi,
      /تعليمات\s*(?:النظام|المطور|داخلية)\s*[:=]?\s*[^.,\n!?;()]*/gi,
      /ملاحظات\s*(?:داخلية|المطور|النظام)\s*[:=]?\s*[^.,\n!?;()]*/gi,
      /برومبت\s*(?:النظام|سري|داخلي)\s*[:=]?\s*[^.,\n!?;()]*/gi
    ];

    for (const pat of patterns) {
      cleaned = cleaned.replace(pat, ' ');
    }

    // 3. Generic token combinations
    cleaned = cleaned.replace(/(?:developer|internal|system|training|sample|customer|metadata)\s*(?:language\s+)?[-_:=]?\s*(?:internal|notes?|instructions?|guidance|examples?|prompts?|q&?a|secret[a-z0-9_-]*)\s*[:=]?\s*[^.,\n!?;()]*/gi, ' ');

    return cleaned.replace(/\s{2,}/g, ' ').replace(/\s+\./g, '.').trim();
  }
}
