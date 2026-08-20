import { SupportedLanguage, LanguageDetector } from '../faq/FaqMatcher';

export type SafetyViolationCategory = 'PROFANITY' | 'ABUSE' | 'SEXUAL' | 'THREAT';

export interface ContentSafetyResult {
  allowed: boolean;
  category?: SafetyViolationCategory;
  reason?: string;
  matchedLang?: SupportedLanguage;
}

export class ContentSafetyGuard {
  // --------------------------------------------------------------------------
  // 1. ENGLISH LEXICONS
  // --------------------------------------------------------------------------
  private static EN_PROFANITY = new Set([
    'fuck', 'fucking', 'fucked', 'fucker', 'shit', 'bullshit', 'bitch', 'asshole',
    'dick', 'pussy', 'cunt', 'bastard', 'whore', 'slut', 'cock', 'motherfucker', 'stfu'
  ]);

  private static EN_ABUSE = new Set([
    'idiot', 'stupid', 'moron', 'retard', 'dumbass', 'shut up', 'useless bot',
    'you are useless', 'you are trash', 'you are stupid', 'scam', 'scammer',
    'piece of shit', 'eat shit', 'fuck off', 'fuck you', 'go to hell'
  ]);

  private static EN_THREAT = new Set([
    'kill you', 'i will kill', 'bomb', 'murder', 'destroy you', 'shoot you', 'burn down',
    'slit your throat', 'i will find you and kill'
  ]);

  private static EN_SEXUAL = new Set([
    'suck my dick', 'send nudes', 'blowjob', 'handjob', 'porn', 'sex video', 'send naked'
  ]);

  // --------------------------------------------------------------------------
  // 2. FRENCH LEXICONS
  // --------------------------------------------------------------------------
  private static FR_PROFANITY = new Set([
    'merde', 'putain', 'salope', 'connard', 'connasse', 'batard', 'encule', 'foutre',
    'chier', 'bite', 'chatte', 'couille', 'gueule', 'bordel', 'pouffiasse'
  ]);

  private static FR_ABUSE = new Set([
    'ferme ta gueule', 'ta gueule', 'idiot', 'imbecile', 'abruti', 'con', 'conne',
    'debil', 'debile', 'inutile', 'bot nul', 'escroc', 'voleur', 'vous etes nuls',
    'tu es nul', 'va te faire foutre', 'nique ta mere', 'casse toi', 'degage'
  ]);

  private static FR_THREAT = new Set([
    'tuer', 'je vais te tuer', 'bruler', 'exploser', 'detruire', 'egorger', 'je vais te frapper'
  ]);

  private static FR_SEXUAL = new Set([
    'suce ma bite', 'nique', 'baise', 'sexe', 'envoie des nudes'
  ]);

  // --------------------------------------------------------------------------
  // 3. ARABIC SCRIPT LEXICONS (MSA & MOROCCAN DARIJA)
  // --------------------------------------------------------------------------
  private static AR_PROFANITY = new Set([
    'قحب', 'قحبة', 'قحاب', 'زب', 'زبي', 'طيز', 'كس', 'كسك', 'منيوك', 'شرموط', 'شرموطة',
    'عرص', 'قلاوي', 'القلاوي', 'طبون', 'طبونمك', 'حوا', 'حوايا', 'نيك'
  ]);

  private static AR_ABUSE = new Set([
    'حمار', 'حمير', 'كلب', 'كلاب', 'مكلخ', 'مكلخين', 'تفو', 'سير تقود', 'تقود', 'خرا',
    'خاري', 'زبل', 'حيوان', 'حيوانات', 'غبي', 'اغبياء', 'معاق', 'نصاب', 'نصابين', 'نصابة',
    'لصوص', 'شفار', 'شفارة', 'سير فحالك', 'ما كتفهم والو', 'ما كيفهم والو', 'الله ينعل',
    'ينعل بوك', 'ينعل طبون', 'ولد القحبة', 'ولد الحرام', 'يا حمار', 'يا كلب', 'يا مكلخ',
    'نتا ما كتفهم والو', 'هاد البوت زوين غير فالهدرة وما كيفهم والو'
  ]);

  private static AR_THREAT = new Set([
    'نقتلك', 'غادي نقتلك', 'غادي نقتل', 'نفركع', 'ندمرك', 'نذبحك', 'غادي نذبحك',
    'نضربك', 'غادي نجي عندك ونضربك', 'نحرقك', 'غادي ندمرك'
  ]);

  private static AR_SEXUAL = new Set([
    'نحويك', 'نحوي', 'ننيكك', 'ننيك', 'حواني', 'مص لي', 'مص زبي', 'لحس الكس'
  ]);

  // --------------------------------------------------------------------------
  // 4. MOROCCAN DARIJA IN LATIN SCRIPT (ARABIZI)
  // --------------------------------------------------------------------------
  private static DARIJA_ARABIZI_PROFANITY = new Set([
    'l9lawi', 'lqlawi', '9lawi', 'qlawi', 'zbi', 'zabb', 'zebi', 'kess', 'kss',
    'tabon', 'tabonmok', 'tabon_mok', 'qahba', '9ahba', 'kahba', '9hab', 'qhab',
    'mniyok', 'mniok', 'mnayek', 'nik', 'n3al', 'tiz', 'tiyz', '3ars', 'ars'
  ]);

  private static DARIJA_ARABIZI_ABUSE = new Set([
    'sir t9owad', 'sir tqowad', 't9owad', 'tqowad', 'tfou', 'tfu', 'mkelakh',
    'mkellekh', 'mkelkh', 'hmaar', 'hmar', '7mar', 'kelb', 'klb', 'zbel', 'khra',
    '5ra', 'weld l9ahba', 'weld lqahba', 'weld lkahba', 'weld lhram', 'weld l7ram',
    'n3al din', 'n3al bouk', 'nta ma katfham walo', 'ma katfham walo', 'ma kayfham walo',
    'lah yn3al', 'ya hmar', 'ya 7mar', 'ya kelb', 'ya mkelakh', 'sir fhalek', 'sir f7alek',
    'chffar', 'chaffar', 'nessab'
  ]);

  private static DARIJA_ARABIZI_THREAT = new Set([
    'ghadi n9atlak', 'ghadi nqatlak', 'n9atlak', 'nqatlak', 'ghadi n9otlek',
    'n9otlek', 'ne9tlek', 'ghadi ndab7ak', 'ndab7ak', 'ghadi n7ar9ak', 'ghadi nferqa3',
    'ghadi ndamrak', 'ghadi nji 3ndek w ndorbok', 'ghadi nji 3ndek'
  ]);

  private static DARIJA_ARABIZI_SEXUAL = new Set([
    'n7wik', 'nhwik', 'nhwek', 'nnikk', 'nnik', 'moss zbi', 'mes zbi', 'lhass'
  ]);

  // Non-Arabizi numeric patterns that must remain untouched (business times, hardware units)
  private static SAFE_BUSINESS_PATTERN = /^\d+(?:am|pm|h|min|sec|nd|rd|th|st|k|m|g|gb|mb|tb|fps|w|v|mo|yr|ans|d|s)?$/i;

  /**
   * Normalizes Arabic script text.
   */
  private static normalizeArabic(text: string): string {
    return text
      .normalize('NFD')
      .replace(/[\u064B-\u065F\u0670\u0640]/g, '') // remove tashkeel & tatweel
      .replace(/[إأآا]/g, 'ا')
      .replace(/ة/g, 'ه')
      .replace(/ى/g, 'ي');
  }

  /**
   * Collapses 3 or more repeated characters to at most 2.
   */
  private static collapseRepeated(text: string): string {
    return text.replace(/(.)\1{2,}/g, '$1$1');
  }

  /**
   * Fully deduplicates repeated adjacent characters.
   */
  private static collapseFully(text: string): string {
    return text.replace(/(.)\1+/g, '$1');
  }

  /**
   * Normalizes Arabizi numeric substitutions on token level.
   */
  private static normalizeArabiziToken(token: string): string {
    if (this.SAFE_BUSINESS_PATTERN.test(token)) {
      return token;
    }
    return token
      .replace(/7/g, 'h')
      .replace(/9/g, 'q')
      .replace(/5/g, 'kh')
      .replace(/3/g, 'e')
      .replace(/2/g, 'a');
  }

  /**
   * Adds token variations (prefix-stripped, collapsed, arabizi normalized).
   */
  private static addTokenVariants(t: string, tokenSet: Set<string>): void {
    if (!t) return;
    tokenSet.add(t);

    const collapsed = this.collapseFully(t);
    tokenSet.add(collapsed);

    const arabizi = this.normalizeArabiziToken(t);
    tokenSet.add(arabizi);
    tokenSet.add(this.collapseFully(arabizi));

    // Strip common prefixes for Arabic & Darija: 'ال', 'و', 'ب', 'ف', 'ك', 'ل', 'يا'
    if (t.startsWith('ال') && t.length > 3) this.addTokenVariants(t.substring(2), tokenSet);
    if (t.startsWith('وال') && t.length > 4) this.addTokenVariants(t.substring(3), tokenSet);
    if (t.startsWith('بال') && t.length > 4) this.addTokenVariants(t.substring(3), tokenSet);
    if (t.startsWith('فال') && t.length > 4) this.addTokenVariants(t.substring(3), tokenSet);
    if (t.startsWith('كال') && t.length > 4) this.addTokenVariants(t.substring(3), tokenSet);
    if (t.startsWith('يا') && t.length > 3) this.addTokenVariants(t.substring(2), tokenSet);
    if ((t.startsWith('و') || t.startsWith('ب') || t.startsWith('ف') || t.startsWith('ك') || t.startsWith('ل')) && t.length > 3) {
      this.addTokenVariants(t.substring(1), tokenSet);
    }

    // Strip Latin/Arabizi prefixes: 'l-', 'w-', 'ya'
    if (t.startsWith('l') && t.length > 3 && !t.startsWith('la') && !t.startsWith('le') && !t.startsWith('li')) {
      this.addTokenVariants(t.substring(1), tokenSet);
    }
    if (t.startsWith('w') && t.length > 3 && !t.startsWith('wa')) {
      this.addTokenVariants(t.substring(1), tokenSet);
    }
  }

  /**
   * Generates token variants and normalized padded strings.
   */
  private static extractTokenVariants(text: string): {
    tokens: Set<string>;
    rawPadded: string;
    normPadded: string;
    fullyCollapsedPadded: string;
  } {
    const rawLower = text.toLowerCase().trim();
    const arabicNormalized = this.normalizeArabic(rawLower);
    const collapsed = this.collapseRepeated(arabicNormalized);
    const fullyCollapsed = this.collapseFully(collapsed);

    const cleanRaw = rawLower.replace(/[^\p{L}\p{N}\s]/gu, ' ');
    const cleanNorm = collapsed.replace(/[^\p{L}\p{N}\s]/gu, ' ');

    const tokens = new Set<string>();

    for (const t of cleanRaw.split(/\s+/).filter(Boolean)) {
      this.addTokenVariants(t, tokens);
    }

    for (const t of cleanNorm.split(/\s+/).filter(Boolean)) {
      this.addTokenVariants(t, tokens);
    }

    const rawPadded = ` ${cleanRaw.replace(/\s+/g, ' ')} `;
    const normPadded = ` ${cleanNorm.replace(/\s+/g, ' ')} `;
    const fullyCollapsedPadded = ` ${fullyCollapsed.replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ')} `;

    return { tokens, rawPadded, normPadded, fullyCollapsedPadded };
  }

  /**
   * Evaluates if message contains high-confidence profanity, abuse, sexual, or threatening content.
   */
  static evaluate(text: string, detectedLang?: SupportedLanguage): ContentSafetyResult {
    if (!text || !text.trim()) {
      return { allowed: true };
    }

    const { tokens, rawPadded, normPadded, fullyCollapsedPadded } = this.extractTokenVariants(text);

    const checkSet = (
      items: Set<string>,
      category: SafetyViolationCategory,
      reason: string,
      matchedLang: SupportedLanguage
    ): ContentSafetyResult | null => {
      for (const item of items) {
        if (item.includes(' ')) {
          // Multi-word phrase matching with boundary spaces
          const normItem = this.collapseRepeated(this.normalizeArabic(item.toLowerCase()));
          const fullyCollapsedItem = this.collapseFully(normItem);
          const arabiziItem = this.normalizeArabiziToken(normItem);

          if (
            rawPadded.includes(` ${item} `) ||
            normPadded.includes(` ${item} `) ||
            normPadded.includes(` ${normItem} `) ||
            normPadded.includes(` ${arabiziItem} `) ||
            fullyCollapsedPadded.includes(` ${fullyCollapsedItem} `)
          ) {
            return { allowed: false, category, reason: `${reason}: "${item}"`, matchedLang };
          }
        } else {
          // Single-token matching: whole-token set membership
          const normItem = this.collapseRepeated(this.normalizeArabic(item.toLowerCase()));
          const arabiziItem = this.normalizeArabiziToken(normItem);

          if (
            tokens.has(item) ||
            tokens.has(normItem) ||
            tokens.has(arabiziItem)
          ) {
            return { allowed: false, category, reason: `${reason}: "${item}"`, matchedLang };
          }
        }
      }
      return null;
    };

    // 1. THREAT EVALUATION (Highest severity)
    const threatMatch =
      checkSet(this.AR_THREAT, 'THREAT', 'Detected threatening language (AR)', 'ar') ||
      checkSet(this.DARIJA_ARABIZI_THREAT, 'THREAT', 'Detected threatening language (Darija)', 'darija') ||
      checkSet(this.FR_THREAT, 'THREAT', 'Detected threatening language (FR)', 'fr') ||
      checkSet(this.EN_THREAT, 'THREAT', 'Detected threatening language (EN)', 'en');
    if (threatMatch) return threatMatch;

    // 2. SEXUAL ABUSE EVALUATION
    const sexualMatch =
      checkSet(this.AR_SEXUAL, 'SEXUAL', 'Detected sexualized content (AR)', 'ar') ||
      checkSet(this.DARIJA_ARABIZI_SEXUAL, 'SEXUAL', 'Detected sexualized content (Darija)', 'darija') ||
      checkSet(this.FR_SEXUAL, 'SEXUAL', 'Detected sexualized content (FR)', 'fr') ||
      checkSet(this.EN_SEXUAL, 'SEXUAL', 'Detected sexualized content (EN)', 'en');
    if (sexualMatch) return sexualMatch;

    // 3. ABUSE & INSULTS EVALUATION
    const abuseMatch =
      checkSet(this.AR_ABUSE, 'ABUSE', 'Detected abusive or insulting language (AR)', 'ar') ||
      checkSet(this.DARIJA_ARABIZI_ABUSE, 'ABUSE', 'Detected abusive or insulting language (Darija)', 'darija') ||
      checkSet(this.FR_ABUSE, 'ABUSE', 'Detected abusive or insulting language (FR)', 'fr') ||
      checkSet(this.EN_ABUSE, 'ABUSE', 'Detected abusive or insulting language (EN)', 'en');
    if (abuseMatch) return abuseMatch;

    // 4. PROFANITY & VULGARITY EVALUATION
    const profanityMatch =
      checkSet(this.AR_PROFANITY, 'PROFANITY', 'Detected profanity (AR)', 'ar') ||
      checkSet(this.DARIJA_ARABIZI_PROFANITY, 'PROFANITY', 'Detected profanity (Darija)', 'darija') ||
      checkSet(this.FR_PROFANITY, 'PROFANITY', 'Detected profanity (FR)', 'fr') ||
      checkSet(this.EN_PROFANITY, 'PROFANITY', 'Detected profanity (EN)', 'en');
    if (profanityMatch) return profanityMatch;

    return { allowed: true };
  }

  /**
   * Returns a polite, localized refusal response when safety is violated.
   */
  static getSafetyRefusal(lang?: SupportedLanguage): string {
    switch (lang) {
      case 'fr':
        return 'Merci de maintenir un échange respectueux. Comment puis-je vous aider avec votre demande ?';
      case 'ar':
        return 'يرجى الحفاظ على حوار محترم. كيف يمكنني مساعدتك في استفسارك؟';
      case 'darija':
        return 'عفاك خلي الحوار محترم. كيفاش نقدر نعاونك فالطلب ديالك؟';
      case 'en':
      default:
        return 'Please keep our conversation respectful. How can I help you with your inquiry?';
    }
  }
}
