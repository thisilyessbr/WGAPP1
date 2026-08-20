import { FaqEntry } from '../tenant/BusinessConfig';

export type SupportedLanguage = 'en' | 'fr' | 'ar' | 'darija';

export class LanguageDetector {
  private static DARIJA_LATIN_WORDS = new Set([
    'bghit', 'bghiti', 'bghina', 'dakchi', 'katbi3o', 'dyal', 'dyalk', 'dyalna', 'dyalkom',
    'dial', 'diyalna', 'wach', 'wash', 'chno', 'chnou', 'ashno', 'chhal', 'kifach', 'kifash',
    'fayn', 'fin', 'kayn', 'kayna', 'daba', 'hadi', 'hada', 'homa', 'chokran', 'shukran',
    'salam', 'ahlan', 'mzyan', 'mezyan', 'khass', 'khesni', 'khasni', '3ndkom', '3ndek', '3ndi',
    'shhar', 'chhar', 'nsowl', 'nswl', 'nswlo', 'swal', 'soual', 'fhad', 'hadchi', '3afak',
    'afak', 'ila', 'walakin', 'chof', 'sbah', 'nour', 'enour', 'ennour', 'labas', 'lkhir',
    'kidayr', 'kidayra', 'rje3', 'arja3', 'wakha', 'iyih', 'wah', 'flous', 'flousi', 'zwin',
    'zwina', 'bzzaf', 'bzaf', 'n3ref', 'n3raf', 't9dro', 't3awnoni', 'katkhedmo', 'taman',
    'khedma', 'ndir', 'bach', 'mouchkil'
  ]);

  private static FRENCH_WORDS = new Set([
    'bonjour', 'salut', 'merci', 'svp', 'vous', 'votre', 'vos', 'nous', 'notre', 'nos',
    'est', 'sont', 'les', 'des', 'une', 'un', 'pour', 'avec', 'dans', 'sur', 'qui', 'que', 'quoi',
    'quels', 'quelles', 'quel', 'quelle', 'combien', 'comment', 'pourquoi', 'quand', 'aide',
    'prix', 'tarifs', 'abonnements', 'horaires', 'ouverture', 'service', 'client', 'parlez',
    'francais', 'plans', 'forfaits', 'remboursement', 'heures', 'assistance', 'repondre',
    'de', 'du', 'la', 'le', 'en', 'a', 'sans', 'texte', 'phrase', 'tout', 'tous', 'ce', 'cet',
    'cette', 'ces', 'mon', 'ton', 'son', 'mais', 'ou', 'et', 'donc', 'or', 'ni', 'car',
    'pas', 'plus', 'aucun', 'aucune', 'jamais',
    'oui', 'non', 'garantie', 'garanties', 'compte', 'comptes', 'facture', 'factures',
    'commande', 'commandes', 'livraison', 'livraisons', 'paiement', 'paiements',
    'remboursements', 'bonsoir', 'reclamation', 'reclamations', 'bureaux', 'ouverts',
    'ouvert', 'ouverte', 'ouvertes', 'partir', 'fermeture', 'fermetures', 'reunion', 'reunions'
  ]);

  private static ENGLISH_WORDS = new Set([
    'hello', 'hi', 'hey', 'what', 'where', 'when', 'who', 'why', 'how', 'is', 'are',
    'the', 'a', 'an', 'can', 'you', 'tell', 'me', 'about', 'plans', 'pricing', 'starter',
    'professional', 'enterprise', 'hours', 'refund', 'support', 'please', 'thanks', 'thank',
    'do', 'does', 'have', 'we', 'our', 'your', 'service', 'business', 'policy', 'open',
    'random', 'query', 'message', 'this', 'that', 'with', 'from', 'without', 'answer',
    'wireless', 'technology', 'authentication', 'file', 'company', 'charging', 'available',
    'weight', 'length', 'robot', 'protocol', 'codec', 'release', 'endpoint', 'port'
  ]);

  // Exclude technical acronyms, time units, storage, and specs from Arabizi digit matching
  private static TECHNICAL_OR_UNIT_TOKEN = /^(?:[0-9]+(?:am|pm|h|min|sec|ms|w|v|a|k|g|kg|mg|l|ml|m|cm|mm|km|gb|mb|tb|kb|mhz|ghz|khz|hz|fps|kwh|x|d|year|yr|month|mo|day|ssd)|[0-9]+h[0-9]+|(?:b2b|b2c|c2c|p2p|oauth[0-9]*|mp[0-9]|sha[0-9]+|h[0-9]+|x[0-9]+|s[0-9]+|ec[0-9]+|[0-9]+g|[0-9]+d|[0-9]+k|win[0-9]+|ssd|usb[0-9]*|http[0-9]*|r[0-9]+[a-z0-9]*|v[0-9]+|api[a-z]*v[0-9]+|tier[0-9]+|rtx[0-9]+|gtx[0-9]+|iphone[0-9]+|pcie[0-9]+|tls[0-9.]+))$/i;

  private static DARIJA_ARABIC_MARKERS = [
    'ديال', 'ديالكم', 'ديالي', 'بغيت', 'واش', 'شنو', 'كاين', 'عفاك', 'دابا', 'شحال',
    'مزيان', 'خدام', 'راه', 'ماشي', 'باش', 'غادي', 'واخا', 'بزاف', 'بزااف', 'هاد',
    'زوين', 'زوينة', 'فلوس', 'فلوسي', 'فلوسنا', 'فلوسكم', 'كتبيعو', 'دبا', 'ديل',
    'هادي', 'هادو', 'فين', 'عاود', 'بلاتي', 'شكون', 'وقتاش', 'فوقاش', 'كيفاش'
  ];

  /**
   * Fast heuristic language detector (zero network calls, zero external deps).
   */
  static detect(text: string): SupportedLanguage {
    if (!text || !text.trim()) return 'en';
    const trimmed = text.trim();

    // 1. Check for Arabic Script (Unicode Range U+0600 - U+06FF)
    const arabicCharCount = (trimmed.match(/[\u0600-\u06FF]/g) || []).length;
    if (arabicCharCount > 0 && arabicCharCount / trimmed.length > 0.2) {
      // Check for Moroccan Darija dialect markers in Arabic script using token-aware matching
      const normalizedArabic = trimmed
        .replace(/[\u064B-\u065F\u0670]/g, '') // remove tashkeel
        .replace(/[\u060C\u061B\u061F\u0640\u066A-\u066D.!?,;:()[\]{}'"]/g, ' ') // strip Arabic punctuation & symbols
        .replace(/[إأآا]/g, 'ا')
        .replace(/ة/g, 'ه')
        .replace(/ى/g, 'ي');

      const words = normalizedArabic.split(/\s+/).map(w => w.replace(/[^\u0600-\u06FF]/g, '')).filter(w => w.length > 0);
      const hasDarijaMarker = this.DARIJA_ARABIC_MARKERS.some(marker => {
        const normMarker = marker.replace(/[إأآا]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');
        const dedupMarker = normMarker.replace(/(.)\1+/g, '$1');
        return words.includes(normMarker) || words.some(w => {
          if (w === normMarker) return true;
          const dedupW = w.replace(/(.)\1+/g, '$1');
          if (dedupW === dedupMarker) return true;
          // Check common single-letter prefixes: و (and), ف (in/at), ب (with), ل (to/for), ك (like/as), د (of)
          if (w.length === normMarker.length + 1 && (w.startsWith('و') || w.startsWith('ف') || w.startsWith('ب') || w.startsWith('ل') || w.startsWith('ك') || w.startsWith('د')) && w.endsWith(normMarker)) {
            return true;
          }
          if (dedupW.length === dedupMarker.length + 1 && (dedupW.startsWith('و') || dedupW.startsWith('ف') || dedupW.startsWith('ب') || dedupW.startsWith('ل') || dedupW.startsWith('ك') || dedupW.startsWith('د')) && dedupW.endsWith(dedupMarker)) {
            return true;
          }
          return false;
        });
      });

      return hasDarijaMarker ? 'darija' : 'ar';
    }

    // 2. Check for Latin-script Darija (Arabizi / 3rbizi) vs French vs English
    const words = trimmed.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 0);

    // Handle spaced Arabizi tokens (e.g. 'w a c h ?')
    const singleLetterWords = words.filter(w => w.length === 1);
    if (singleLetterWords.length >= 3 && singleLetterWords.length / words.length >= 0.75) {
      const collapsed = words.join('');
      if (this.DARIJA_LATIN_WORDS.has(collapsed)) {
        return 'darija';
      }
    }

    let arabiziDigitCount = 0;
    let darijaWordCount = 0;
    let frenchWordCount = 0;
    let englishWordCount = 0;

    for (const word of words) {
      const dedupWord = word.replace(/(.)\1{2,}/g, '$1'); // reduce 3+ repeated chars

      if (this.DARIJA_LATIN_WORDS.has(word) || this.DARIJA_LATIN_WORDS.has(dedupWord)) {
        darijaWordCount++;
      } else if (!this.TECHNICAL_OR_UNIT_TOKEN.test(word) && (/[a-z]+[23579]+|[23579]+[a-z]+/i.test(word))) {
        arabiziDigitCount++;
      }

      if (this.FRENCH_WORDS.has(word) || this.FRENCH_WORDS.has(dedupWord)) {
        frenchWordCount++;
      }
      if (this.ENGLISH_WORDS.has(word) || this.ENGLISH_WORDS.has(dedupWord)) {
        englishWordCount++;
      }
    }

    // Valid Arabizi: either recognized Darija Latin words or Arabizi digit words with lexical support or distinct Arabizi word
    if (darijaWordCount >= 1 || (arabiziDigitCount >= 1 && (darijaWordCount >= 1 || (frenchWordCount === 0 && englishWordCount === 0)))) {
      return 'darija';
    }

    // 3. Compare French vs English
    if (frenchWordCount > englishWordCount) {
      return 'fr';
    }

    if (frenchWordCount > 0 && englishWordCount === 0) {
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

interface FaqCandidate {
  entry: FaqEntry;
  answer: string;
  matchedLang: SupportedLanguage;
  confidence: number;
  matchType: 'exact' | 'substring' | 'fuzzy' | 'token_overlap' | 'keywords';
  priorityScore: number;
  matchedTokenCount: number;
  tokenCoverage: number;
  questionLength: number;
  entryId: string;
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
   * Resolves language-safe answer for a given candidate language.
   * If detected language is non-English, strictly requires a localized answer
   * and never silently falls back to an unlocalized English answer.
   */
  private static resolveLanguageAnswer(entry: FaqEntry, lang: SupportedLanguage): string | null {
    if (lang === 'en') {
      const enAns = entry.answers?.en || entry.answer;
      return enAns && typeof enAns === 'string' && enAns.trim() ? enAns.trim() : null;
    }
    if (lang === 'fr') {
      const frAns = entry.answers?.fr;
      return frAns && typeof frAns === 'string' && frAns.trim() ? frAns.trim() : null;
    }
    if (lang === 'ar') {
      const arAns = entry.answers?.ar || entry.answers?.darija;
      return arAns && typeof arAns === 'string' && arAns.trim() ? arAns.trim() : null;
    }
    if (lang === 'darija') {
      const darAns = entry.answers?.darija || entry.answers?.ar;
      return darAns && typeof darAns === 'string' && darAns.trim() ? darAns.trim() : null;
    }
    return null;
  }

  /**
   * Evaluates all FAQ entries against the query and returns the globally best candidate.
   * Zero early returns inside loops: all candidates are evaluated and ranked deterministically.
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

    const queryTokensList = normQuery.split(' ').filter(t => t.length > 1);
    const queryTokens = new Set(queryTokensList);
    const totalQueryTokens = queryTokensList.length;

    // Priority languages to check: detected language first, plus script fallbacks
    const candidateLangs: SupportedLanguage[] = [lang];
    if (lang === 'ar' && !candidateLangs.includes('darija')) candidateLangs.push('darija');
    if (lang === 'darija' && !candidateLangs.includes('ar')) candidateLangs.push('ar');

    const candidates: FaqCandidate[] = [];

    for (const l of candidateLangs) {
      for (const entry of faqEntries) {
        const rawAnswer = this.resolveLanguageAnswer(entry, l);
        if (!rawAnswer) continue; // Language safety: cannot match if valid localized answer is missing

        const rawQuestion = entry.questions?.[l] || (l === 'en' ? entry.question : undefined);
        const rawKeywords: string[] = Array.isArray(entry.keywords)
          ? (l === 'en' ? entry.keywords : [])
          : (entry.keywords?.[l] || []);

        const entryId = entry.id || 'unknown-faq';

        // 1. Evaluate Question Matches
        if (rawQuestion) {
          const normQuestion = this.normalize(rawQuestion);
          if (normQuestion) {
            const qTokensList = normQuestion.split(' ').filter(t => t.length > 1);
            const qTokens = new Set(qTokensList);
            const questionLength = normQuestion.length;

            // 1.1 Exact Question Match
            if (normQuery === normQuestion) {
              candidates.push({
                entry,
                answer: rawAnswer,
                matchedLang: l,
                confidence: 1.0,
                matchType: 'exact',
                priorityScore: 1000,
                matchedTokenCount: totalQueryTokens,
                tokenCoverage: 1.0,
                questionLength,
                entryId
              });
              continue; // Perfect exact match, move to next entry
            }

            // 1.2 Full Subset Token Containment
            const isAllQueryTokensInQuestion = queryTokensList.length > 0 && queryTokensList.every(t => qTokens.has(t));
            const isAllQuestionTokensInQuery = qTokensList.length > 0 && qTokensList.every(t => queryTokens.has(t));

            if (isAllQueryTokensInQuestion || isAllQuestionTokensInQuery) {
              const matchedTokens = queryTokensList.filter(t => qTokens.has(t));
              const tokenCoverage = matchedTokens.length / Math.max(totalQueryTokens, qTokensList.length);
              candidates.push({
                entry,
                answer: rawAnswer,
                matchedLang: l,
                confidence: 0.95,
                matchType: 'exact',
                priorityScore: 900,
                matchedTokenCount: matchedTokens.length,
                tokenCoverage,
                questionLength,
                entryId
              });
              continue;
            }

            // 1.3 Partial Token Overlap
            const commonTokens = queryTokensList.filter(t => qTokens.has(t));
            const overlapRatio = commonTokens.length / Math.max(1, totalQueryTokens);

            if (overlapRatio >= 0.6) {
              candidates.push({
                entry,
                answer: rawAnswer,
                matchedLang: l,
                confidence: Math.min(0.9, 0.7 + overlapRatio * 0.2),
                matchType: 'token_overlap',
                priorityScore: 700 + Math.round(overlapRatio * 100),
                matchedTokenCount: commonTokens.length,
                tokenCoverage: overlapRatio,
                questionLength,
                entryId
              });
              continue;
            }

            // 1.4 Fuzzy Levenshtein Match on Question
            if (normQuestion.length >= 8 && normQuery.length >= 8) {
              const sim = this.similarity(normQuery, normQuestion);
              if (sim >= 0.85) {
                candidates.push({
                  entry,
                  answer: rawAnswer,
                  matchedLang: l,
                  confidence: sim,
                  matchType: 'fuzzy',
                  priorityScore: 700,
                  matchedTokenCount: Math.round(queryTokens.size * sim),
                  tokenCoverage: sim,
                  questionLength,
                  entryId
                });
              }
            }

            // 1.4 Meaningful Substring Containment
            // Fix: Prohibit single generic tokens from triggering 0.95 matches
            if (normQuestion.length >= 8 && normQuery.length >= 8) {
              if (normQuery.includes(normQuestion)) {
                // User query contains the full FAQ question
                const ratio = normQuestion.length / normQuery.length;
                if (ratio >= 0.35 && totalQueryTokens >= 2) {
                  const conf = Math.min(0.95, 0.80 + ratio * 0.15);
                  candidates.push({
                    entry,
                    answer: rawAnswer,
                    matchedLang: l,
                    confidence: conf,
                    matchType: 'substring',
                    priorityScore: 750,
                    matchedTokenCount: qTokens.size,
                    tokenCoverage: ratio,
                    questionLength,
                    entryId
                  });
                }
              } else if (normQuestion.includes(normQuery)) {
                // FAQ question contains user query
                const ratio = normQuery.length / normQuestion.length;
                // Only allow multi-token queries or high-ratio phrase queries
                if (ratio >= 0.40 && totalQueryTokens >= 2) {
                  candidates.push({
                    entry,
                    answer: rawAnswer,
                    matchedLang: l,
                    confidence: 0.90,
                    matchType: 'substring',
                    priorityScore: 650,
                    matchedTokenCount: queryTokens.size,
                    tokenCoverage: ratio,
                    questionLength,
                    entryId
                  });
                }
              }
            }
          }
        }

        // 2. Evaluate Keyword & Phrase Presence
        if (rawKeywords && rawKeywords.length > 0) {
          const normKeywords = rawKeywords.map(k => this.normalize(k)).filter(Boolean);
          if (normKeywords.length > 0) {
            const multiWordKeywords = normKeywords.filter(k => k.includes(' '));
            const singleWordKeywords = normKeywords.filter(k => !k.includes(' '));

            // Check multi-word phrase keyword match (e.g. "brake pad", "mass air flow")
            const matchedPhrases = multiWordKeywords.filter(phrase => normQuery.includes(phrase));
            if (matchedPhrases.length > 0) {
              const longestPhrase = matchedPhrases.reduce((a, b) => a.length >= b.length ? a : b);
              candidates.push({
                entry,
                answer: rawAnswer,
                matchedLang: l,
                confidence: 0.92,
                matchType: 'keywords',
                priorityScore: 600,
                matchedTokenCount: longestPhrase.split(' ').length,
                tokenCoverage: longestPhrase.length / normQuery.length,
                questionLength: rawQuestion ? rawQuestion.length : 0,
                entryId
              });
              continue;
            }

            // Check single-word keywords with intent/coverage safeguards
            const matchedSingleKeywords = singleWordKeywords.filter(k => queryTokens.has(k));
            const matchCount = matchedSingleKeywords.length;

            if (matchCount > 0) {
              const queryCoverage = matchCount / Math.max(1, totalQueryTokens);
              const keywordCoverage = matchCount / singleWordKeywords.length;

              // Safeguards against false positives:
              // - Single-token queries (e.g. "sensor", "diagnostic", "pricing", "warranty") are ambiguous and must fall through to RAG/LLM.
              // - Multi-token queries require high keyword density (>= 45%) with at least 2 keywords
              // - Or complete keyword coverage (100%) for 2+ keyword FAQ with query coverage >= 30%
              const isMultiKeywordDense = totalQueryTokens >= 2 && matchCount >= 2 && queryCoverage >= 0.45;
              const isCompleteKeywordMatch = totalQueryTokens >= 2 && singleWordKeywords.length >= 2 && keywordCoverage === 1.0 && queryCoverage >= 0.30;

              if (isMultiKeywordDense || isCompleteKeywordMatch) {
                candidates.push({
                  entry,
                  answer: rawAnswer,
                  matchedLang: l,
                  confidence: 0.90,
                  matchType: 'keywords',
                  priorityScore: 500,
                  matchedTokenCount: matchCount,
                  tokenCoverage: queryCoverage,
                  questionLength: rawQuestion ? rawQuestion.length : 0,
                  entryId
                });
              }
            }
          }
        }
      }
    }

    if (candidates.length === 0) {
      return null;
    }

    // Deterministic Candidate Sorting:
    // 1. Priority score (exact > token_overlap > substring-phrase > fuzzy > phrase_keywords > keywords)
    // 2. Confidence score
    // 3. Token coverage ratio
    // 4. Matched token count
    // 5. Question length / specificity
    // 6. Stable alphabetical entryId
    candidates.sort((a, b) => {
      if (b.priorityScore !== a.priorityScore) {
        return b.priorityScore - a.priorityScore;
      }
      if (Math.abs(b.confidence - a.confidence) > 0.001) {
        return b.confidence - a.confidence;
      }
      if (Math.abs(b.tokenCoverage - a.tokenCoverage) > 0.001) {
        return b.tokenCoverage - a.tokenCoverage;
      }
      if (b.matchedTokenCount !== a.matchedTokenCount) {
        return b.matchedTokenCount - a.matchedTokenCount;
      }
      if (b.questionLength !== a.questionLength) {
        return b.questionLength - a.questionLength;
      }
      return a.entryId.localeCompare(b.entryId);
    });

    const bestCandidate = candidates[0];
    if (bestCandidate && bestCandidate.confidence >= 0.75) {
      return {
        entry: bestCandidate.entry,
        answer: bestCandidate.answer,
        matchedLang: bestCandidate.matchedLang,
        confidence: bestCandidate.confidence,
        matchType: bestCandidate.matchType
      };
    }

    return null;
  }
}
