import { FaqEntry } from '../tenant/BusinessConfig';

export type SupportedLanguage = 'en' | 'fr' | 'ar' | 'darija';

export class LanguageDetector {
  private static DARIJA_LATIN_WORDS = new Set([
    'bghit', 'bghiti', 'dakchi', 'katbi3o', 'dyal', 'dyalk', 'dyalna', 'dyalkom',
    'wach', 'wesh', 'chno', 'ashno', 'chhal', 'kifach', 'fayn', 'fin', 'kayn', 'kayna',
    'daba', 'hadi', 'hada', 'homa', 'chokran', 'shukran', 'salam', 'ahlan', 'mzyan',
    'mezyan', 'khass', 'khesni', '3ndkom', '3ndek', '3ndi', 'shhar', 'chhar', 'nsowl',
    'nswl', 'swal', 'soual', 'fhad', 'hadchi', '3afak', 'afak', 'ila', 'walakin', 'chof',
    'sbah', 'nour', 'enour', 'ennour', 'labas', 'lkhir', 'kidayr', 'kidayra'
  ]);

  private static FRENCH_WORDS = new Set([
    'bonjour', 'salut', 'merci', 'svp', 'vous', 'votre', 'vos', 'nous', 'notre', 'nos',
    'est', 'sont', 'les', 'des', 'une', 'un', 'pour', 'avec', 'dans', 'sur', 'qui', 'que', 'quoi',
    'quels', 'quelles', 'quel', 'quelle', 'combien', 'comment', 'pourquoi', 'quand', 'aide',
    'prix', 'tarifs', 'abonnements', 'horaires', 'ouverture', 'service', 'client', 'parlez',
    'francais', 'plans', 'forfaits', 'remboursement', 'heures', 'assistance', 'repondre',
    'de', 'du', 'la', 'le', 'en', 'sans', 'texte', 'phrase', 'tout', 'tous', 'ce', 'cet',
    'cette', 'ces', 'mon', 'ton', 'son', 'mais', 'ou', 'et', 'donc', 'or', 'ni', 'car',
    'pas', 'plus', 'aucun', 'aucune', 'jamais'
  ]);

  private static ENGLISH_WORDS = new Set([
    'hello', 'hi', 'hey', 'what', 'where', 'when', 'who', 'why', 'how', 'is', 'are',
    'the', 'a', 'an', 'can', 'you', 'tell', 'me', 'about', 'plans', 'pricing', 'starter',
    'professional', 'enterprise', 'hours', 'refund', 'support', 'please', 'thanks', 'thank',
    'do', 'does', 'have', 'we', 'our', 'your', 'service', 'business', 'policy', 'open',
    'random', 'query', 'message', 'this', 'that', 'with', 'from', 'without', 'answer'
  ]);

  /**
   * Fast heuristic language detector (zero network calls, zero external deps).
   */
  static detect(text: string): SupportedLanguage {
    if (!text || !text.trim()) return 'en';
    const trimmed = text.trim();

    // 1. Check for Arabic Script (Unicode Range U+0600 - U+06FF)
    const arabicCharCount = (trimmed.match(/[\u0600-\u06FF]/g) || []).length;
    if (arabicCharCount > 0 && arabicCharCount / trimmed.length > 0.2) {
      // Distinctive Moroccan Arabic dialect keywords in Arabic script
      const darijaArabicMarkers = ['ديال', 'ديالكم', 'ديالي', 'بغيت', 'واش', 'شنو', 'كاين', 'عفاك', 'دابا', 'شحال', 'مزيان', 'خدام', 'راه', 'ماشي', 'باش', 'غادي'];
      const hasDarijaMarker = darijaArabicMarkers.some(marker => trimmed.includes(marker));
      return hasDarijaMarker ? 'darija' : 'ar';
    }

    // 2. Check for Latin-script Darija (Arabizi / 3rbizi)
    // Matches words containing digits 2, 3, 5, 7, 9 used as letters (e.g., 'bghit n3rf', '3afak', 'lkatbi3o')
    const words = trimmed.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 0);

    let arabiziDigitCount = 0;
    let darijaWordCount = 0;
    let frenchWordCount = 0;
    let englishWordCount = 0;

    for (const word of words) {
      if (/[a-zA-Z]+[23579]+|[23579]+[a-zA-Z]+/.test(word)) {
        arabiziDigitCount++;
      }
      if (this.DARIJA_LATIN_WORDS.has(word)) {
        darijaWordCount++;
      }
      if (this.FRENCH_WORDS.has(word)) {
        frenchWordCount++;
      }
      if (this.ENGLISH_WORDS.has(word)) {
        englishWordCount++;
      }
    }

    if (arabiziDigitCount > 0 || darijaWordCount >= 1) {
      return 'darija';
    }

    // 3. Compare French vs English
    if (frenchWordCount > englishWordCount) {
      return 'fr';
    }

    return 'en';
  }
}

export interface FaqMatchResult {
  entry: FaqEntry;
  answer: string;
  matchedLang: SupportedLanguage;
  confidence: number;
  matchType: 'exact' | 'substring' | 'fuzzy' | 'token_overlap' | 'keywords';
}

export class FaqMatcher {
  /**
   * Normalizes text for robust exact and fuzzy keyword matching.
   */
  static normalize(text: string): string {
    if (!text) return '';
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // remove latin diacritics
      .replace(/[\u064B-\u065F\u0670]/g, '') // remove arabic tashkeel
      .replace(/[إأآا]/g, 'ا') // normalize arabic alef
      .replace(/ة/g, 'ه') // normalize teh marbuta
      .replace(/ى/g, 'ي') // normalize alef maksura
      .replace(/7/g, 'h') // normalize arabizi 7 to h (ch7al <-> chhal)
      .replace(/[^\p{L}\p{N}\s]/gu, ' ') // remove punctuation across all scripts
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Calculates Levenshtein distance similarity ratio (0.0 to 1.0).
   */
  static similarity(s1: string, s2: string): number {
    if (s1 === s2) return 1.0;
    if (!s1 || !s2) return 0.0;
    
    const longer = s1.length > s2.length ? s1 : s2;
    const shorter = s1.length > s2.length ? s2 : s1;
    if (longer.length === 0) return 1.0;

    const costs = new Array();
    for (let i = 0; i <= longer.length; i++) {
      let lastValue = i;
      for (let j = 0; j <= shorter.length; j++) {
        if (i === 0) {
          costs[j] = j;
        } else if (j > 0) {
          let newValue = costs[j - 1];
          if (longer.charAt(i - 1) !== shorter.charAt(j - 1)) {
            newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
          }
          costs[j - 1] = lastValue;
          lastValue = newValue;
        }
      }
      if (i > 0) costs[shorter.length] = lastValue;
    }
    return (longer.length - costs[shorter.length]) / longer.length;
  }

  /**
   * Evaluates if query matches an FAQ question or keywords in the detected language.
   */
  static match(
    query: string,
    faqEntries: FaqEntry[] | undefined,
    detectedLang?: SupportedLanguage
  ): FaqMatchResult | null {
    if (!faqEntries || faqEntries.length === 0 || !query || !query.trim()) {
      return null;
    }

    const lang = detectedLang || LanguageDetector.detect(query);
    const normQuery = this.normalize(query);
    if (!normQuery) return null;

    const queryTokens = new Set(normQuery.split(' ').filter(t => t.length > 1));

    // Priority languages to check: detected language first, plus script fallbacks
    const candidateLangs: SupportedLanguage[] = [lang];
    if (lang === 'ar' && !candidateLangs.includes('darija')) candidateLangs.push('darija');
    if (lang === 'darija' && !candidateLangs.includes('ar')) candidateLangs.push('ar');

    for (const l of candidateLangs) {
      for (const entry of faqEntries) {
        const rawQuestion = entry.questions?.[l] || entry.question;
        const rawAnswer = entry.answers?.[l] || entry.answer;
        const rawKeywords = entry.keywords?.[l] || (Array.isArray(entry.keywords) ? entry.keywords : []);

        if (!rawAnswer) continue; // Can only match if answer exists

        // 1. Check exact question match
        if (rawQuestion) {
          const normQuestion = this.normalize(rawQuestion);
          if (normQuestion && normQuery === normQuestion) {
            return { entry, answer: rawAnswer, matchedLang: l, confidence: 1.0, matchType: 'exact' };
          }

          // 2. Substring containment for queries with substance
          if (normQuestion && normQuestion.length >= 6 && normQuery.length >= 6) {
            if (normQuery.includes(normQuestion) || normQuestion.includes(normQuery)) {
              return { entry, answer: rawAnswer, matchedLang: l, confidence: 0.95, matchType: 'substring' };
            }
          }

          // 3. Fuzzy Levenshtein match on question
          if (normQuestion && normQuestion.length >= 8) {
            const sim = this.similarity(normQuery, normQuestion);
            if (sim >= 0.85) {
              return { entry, answer: rawAnswer, matchedLang: l, confidence: sim, matchType: 'fuzzy' };
            }
          }

          // 4. Significant Question Token Overlap
          const qTokens = normQuestion.split(' ').filter(t => t.length > 2);
          if (qTokens.length >= 3) {
            const matchCount = qTokens.filter(t => queryTokens.has(t)).length;
            const overlap = matchCount / qTokens.length;
            if (overlap >= 0.75) {
              return { entry, answer: rawAnswer, matchedLang: l, confidence: overlap, matchType: 'token_overlap' };
            }
          }
        }

        // 5. Keyword Presence matching
        if (rawKeywords && rawKeywords.length > 0) {
          const normKeywords = rawKeywords.map(k => this.normalize(k)).filter(Boolean);
          if (normKeywords.length > 0) {
            const matchedKeywords = normKeywords.filter(k => {
              if (k.includes(' ')) {
                return normQuery.includes(k);
              }
              return queryTokens.has(k) || normQuery.includes(k);
            });

            // Match if at least 2 keywords match, 100% match, or exact single keyword query match
            if (
              (normKeywords.length === 1 && matchedKeywords.length === 1) ||
              (normKeywords.length >= 2 && matchedKeywords.length >= Math.min(2, normKeywords.length)) ||
              (queryTokens.size === 1 && matchedKeywords.length >= 1 && matchedKeywords.some(k => k === normQuery))
            ) {
              const kwConfidence = normKeywords.length === 1 || queryTokens.size === 1 ? 0.90 : 0.90;
              return { entry, answer: rawAnswer, matchedLang: l, confidence: kwConfidence, matchType: 'keywords' };
            }
          }
        }
      }
    }

    return null;
  }
}
