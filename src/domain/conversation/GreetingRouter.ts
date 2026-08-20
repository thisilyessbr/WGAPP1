import { LLMProvider } from '../../core/llm/LLMProvider';
import { logger } from '../../utils/logger';

export class GreetingRouter {
  // 1. Known Greetings & Polite Acknowledgments (Normalized)
  private static KNOWN_GREETINGS = new Set([
    // English
    'hello', 'hi', 'hey', 'good morning', 'good afternoon', 'good evening', 'howdy',
    'greetings', 'hi there', 'hey there', 'welcome', 'morning', 'evening', 'yo',
    'thanks', 'thank you', 'ok', 'okay', 'great', 'that works', 'good',

    // French
    'bonjour', 'salut', 'bonsoir', 'coucou', 'allo', 'bon matin', 'bienvenue', 'bjr', 'bsr',
    'merci', 'merci beaucoup', 'daccord', 'd accord', "d'accord", 'parfait',

    // Standard Arabic (MSA)
    'مرحبا', 'اهلا', 'اهلا وسهلا', 'صباح الخير', 'مساء الخير', 'السلام عليكم', 'تحياتي', 'سلام', 'اهلين', 'مرحبتين',
    'شكرا', 'شكرا جزيلا', 'حسنا', 'ممتاز',

    // Darija / Arabizi
    'salam', 'ssalam', 'ahlan', 'sbah lkhir', 'sbah nour', 'sbah ennour', 'sbah el khir', 'sbah lkheir',
    'msa lkhir', 'msa nour', 'labas', 'la bas', 'cv',
    'kidayr', 'kidayra', 'kif dayr', 'kif dayra', 'salamo 3alaykom', 'salamo3alaykom',
    'wesh', 'wach rak', 'ach khbark', 'ca va', 'chokran', 'shukran', 'chokran bzaf', 'wakha', 'mzyan'
  ]);

  // 2. Question Indicators (Words & Phrases)
  private static QUESTION_WORDS = new Set([
    // English
    'what', 'when', 'where', 'which', 'who', 'whom', 'whose', 'why', 'how',
    'is', 'are', 'am', 'was', 'were', 'do', 'does', 'did', 'can', 'could',
    'should', 'would', 'will', 'may', 'might', 'must', 'price', 'pricing',
    'cost', 'how much', 'plans', 'hours', 'refund', 'support', 'tell me', 'explain', 'info',

    // French
    'quoi', 'quand', 'ou', 'qui', 'pourquoi', 'comment', 'combien', 'quel', 'quelle',
    'quels', 'quelles', 'est-ce que', 'est ce que', 'prix', 'cout', 'tarif', 'tarifs',
    'horaires', 'remboursement', 'aide', 'assistance', 'pouvez vous', 'peux tu',

    // Standard Arabic (MSA)
    'ما', 'ماذا', 'متى', 'اين', 'من', 'لماذا', 'كيف', 'كم', 'هل', 'اي',
    'سعر', 'اسعار', 'تكلفة', 'اوقات', 'استرجاع', 'مساعدة', 'معلومات',

    // Darija / Arabizi
    'chhal', 'ch7al', 'shhal', 'sh7al', 'chno', 'ashno', 'achno', 'fayn', 'fin',
    'kifach', 'kifash', '3lach', '3lash', 'wach', 'wesh', 'imta', 'emta',
    'chkoun', 'chkon', 'taman', 'prix', 'taman dyal', 'chhal taman', 'ch7al taman',
    'kayn', 'kayna', 'wach kayn'
  ]);

  /**
   * Normalizes incoming text for robust rule evaluation.
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
      .replace(/[^\p{L}\p{N}\s']/gu, ' ') // remove punctuation except apostrophes
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Evaluates if text contains explicit question indicators (?, ؟, or question terms).
   */
  static hasQuestionIndicator(rawText: string, normalizedText: string): boolean {
    if (rawText.includes('?') || rawText.includes('؟')) {
      return true;
    }

    const words = normalizedText.split(' ').filter(Boolean);
    for (const w of words) {
      if (this.QUESTION_WORDS.has(w)) {
        return true;
      }
    }

    // Check multi-word question phrases (e.g. "chhal taman", "how much", "est ce que")
    for (const qWord of this.QUESTION_WORDS) {
      if (qWord.includes(' ') && normalizedText.includes(qWord)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Checks if normalized text matches a known greeting alias.
   */
  static isKnownGreeting(normalizedText: string): boolean {
    return this.KNOWN_GREETINGS.has(normalizedText);
  }

  /**
   * Evaluates if text is an UNKNOWN candidate for the rare LLM classifier:
   * UNKNOWN = short (<= 4 words AND <= 30 chars) AND not junk (>= 2 chars) AND not question AND not known greeting.
   */
  static isUnknownCandidate(rawText: string, normalizedText: string): boolean {
    const charCount = normalizedText.replace(/\s/g, '').length;
    if (charCount < 2) return false; // Junk / single character

    const words = normalizedText.split(' ').filter(Boolean);
    const isShort = words.length <= 4 && normalizedText.length <= 30;
    if (!isShort) return false;

    if (this.hasQuestionIndicator(rawText, normalizedText)) return false;
    if (this.isKnownGreeting(normalizedText)) return false;

    return true;
  }

  /**
   * Invokes LLM binary classifier with strict timeout and fallback guard.
   */
  static async classifyGreetingWithLlm(
    llm: LLMProvider,
    tenantId: string,
    rawContent: string,
    timeoutMs: number = 1500
  ): Promise<'GREETING' | 'NOT_GREETING'> {
    const startTime = Date.now();
    const prompt = `You are an ultra-fast binary intent classifier.
Determine if the following user message is solely a conversational greeting/opening (e.g. hello, hi, greetings in any language, slang, or dialect).

User Message: "${rawContent}"

Respond with ONLY one word:
"GREETING" if the message is a greeting/salutation.
"NOT_GREETING" if the message contains a question, request, command, or topic inquiry.`;

    try {
      // Enforce strict timeout
      const responsePromise = llm.generateResponse(prompt, [], { maxTokens: 10, temperature: 0.0 });
      const timeoutPromise = new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error('TIMEOUT')), timeoutMs)
      );

      const rawResult = await Promise.race([responsePromise, timeoutPromise]);
      const latencyMs = Date.now() - startTime;
      const normalizedResult = (rawResult || '').trim().toUpperCase();
      const result: 'GREETING' | 'NOT_GREETING' = normalizedResult.includes('GREETING') && !normalizedResult.includes('NOT_GREETING')
        ? 'GREETING'
        : 'NOT_GREETING';

      logger.info(`GreetingRouter: LLM classifier invoked`, {
        event: 'greeting_classifier_invoked',
        tenantId,
        result,
        latencyMs,
        failureReason: null,
        inputLength: rawContent.length
      });

      return result;
    } catch (err: any) {
      const latencyMs = Date.now() - startTime;
      const failureReason = err.message === 'TIMEOUT' ? 'timeout' : (err.status === 429 ? 'rate_limit' : 'error');

      logger.warn(`GreetingRouter: LLM classifier failed (${failureReason}) -> falling back to FAQ/RAG`, {
        event: 'greeting_classifier_invoked',
        tenantId,
        result: 'NOT_GREETING',
        latencyMs,
        failureReason,
        inputLength: rawContent.length
      });

      return 'NOT_GREETING';
    }
  }
}
