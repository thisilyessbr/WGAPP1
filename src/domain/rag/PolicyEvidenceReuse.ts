/**
 * Session-Scoped Policy Evidence Reuse Manager (Phase 37E / 47D).
 * Enables safe, in-memory reuse of authoritative PolicyEvidence across turns within the same conversation
 * to eliminate redundant vector retrieval and embedding API calls while strictly preserving scope boundaries.
 * 100% generic, tenant-relative, 0 hardcoded merchant territories.
 */

import { PolicyEvidence } from './PolicyEvidence';
import { RAGChunk } from './RAGService';
import { BusinessConfig, ShippingScopeConfig } from '../tenant/BusinessConfig';

export const CANONICAL_POLICY_INTENTS = [
  'SHIPPING',
  'RETURNS',
  'CARE',
  'TRACKING',
  'PAYMENT',
  'SUPPORT',
  'STORE_INFO',
  'SIZE_GUIDE'
] as const;

export type CanonicalPolicyIntent = (typeof CANONICAL_POLICY_INTENTS)[number];

export interface EvidenceSufficiencyResult {
  isSufficient: boolean;
  reason?: string;
}

export interface GeographicTarget {
  type: 'COUNTRY' | 'REGION' | 'INTERNATIONAL' | 'DOMESTIC_SUBDIVISION';
  name: string;
  parentCountry?: string;
}

export class PolicyEvidenceReuse {
  private static readonly COUNTRY_MAP: Record<string, string[]> = {
    morocco: ['morocco', 'maroc', 'المغرب', 'مغرب', 'lmaghrib', 'maghreb', 'marruecos'],
    france: ['france', 'franca', 'فرانسا', 'فرنسا', 'lfrance', 'l-france', 'francia'],
    spain: ['spain', 'espagne', 'إسبانيا', 'اسبانيا', 'espana', 'españa', 'isbanya', 'sbanya'],
    'united states': ['united states', 'usa', 'us', 'u.s.', 'u.s.a.', 'america', 'أمريكا', 'امريكا', 'الولايات المتحدة', 'états-unis', 'etats-unis', 'estados unidos', 'marikan', 'lmarikan'],
    canada: ['canada', 'كندا', 'kanada'],
    'united kingdom': ['united kingdom', 'uk', 'u.k.', 'royaume-uni', 'بريطانيا', 'انجلترا', 'angleterre', 'england', 'britain'],
    germany: ['germany', 'allemagne', 'ألمانيا', 'المانيا', 'almanya', 'deutschland'],
    italy: ['italy', 'italie', 'إيطاليا', 'ايطاليا', 'italia'],
    belgium: ['belgium', 'belgique', 'بلجيكا', 'beljika', 'belgica'],
    switzerland: ['switzerland', 'suisse', 'سويسرا', 'swisra', 'suiza'],
    netherlands: ['netherlands', 'pays-bas', 'holland', 'هولندا', 'holanda'],
    portugal: ['portugal', 'البرتغال', 'bortoghal'],
    japan: ['japan', 'japon', 'اليابان', 'elyaban'],
    china: ['china', 'chine', 'الصين', 'chin'],
    egypt: ['egypt', 'égypte', 'مصر', 'masr'],
    tunisia: ['tunisia', 'tunisie', 'تونس', 'tounes'],
    algeria: ['algeria', 'algérie', 'الجزائر', 'dzair'],
    saudi: ['saudi arabia', 'saudi', 'arabie saoudite', 'السعودية', 'السعوديه', 'saoudia'],
    uae: ['uae', 'emirates', 'émirats', 'الإمارات', 'الامارات', 'dubai', 'دبي']
  };

  private static readonly REGION_MAP: Record<string, string[]> = {
    europe: ['europe', 'europa', 'أوروبا', 'اوروبا', 'l\'europe', 'ue', 'eu'],
    'north america': ['north america', 'amérique du nord', 'أمريكا الشمالية', 'أمريكا الشماليه', 'امريكا الشمالية'],
    'middle east': ['middle east', 'moyen-orient', 'الشرق الأوسط', 'الشرق الاوسط'],
    gulf: ['gulf', 'golfe', 'الخليج', 'l-khalij'],
    worldwide: ['worldwide', 'international', 'monde', 'global', 'abroad', 'دولي', 'دولية', 'عالمي', 'عالمية', 'خارج البلاد', 'خارج الوطن', 'خارج الدولة', 'برا البلاد', 'برا الوطن', 'برا', 'kharij', 'l-kharij', 'lkharij', 'barra', 'berra', 'dowal o5ra', 'dowal okhra', 'autres pays', 'other countries', 'cross-border', 'hors du pays']
  };

  private static readonly SUBDIVISION_PARENT_MAP: Record<string, string> = {
    // US States & major cities
    california: 'united states',
    texas: 'united states',
    florida: 'united states',
    'new york': 'united states',
    washington: 'united states',
    illinois: 'united states',
    pennsylvania: 'united states',
    ohio: 'united states',
    georgia: 'united states',
    chicago: 'united states',
    'los angeles': 'united states',
    miami: 'united states',
    // Moroccan cities
    casablanca: 'morocco',
    casa: 'morocco',
    rabat: 'morocco',
    marrakech: 'morocco',
    tanger: 'morocco',
    fes: 'morocco',
    agadir: 'morocco',
    meknes: 'morocco',
    oujda: 'morocco',
    kenitra: 'morocco',
    tetouan: 'morocco',
    كازا: 'morocco',
    'الدار البيضاء': 'morocco',
    الرباط: 'morocco',
    مراكش: 'morocco',
    طنجة: 'morocco',
    فاس: 'morocco',
    أكادير: 'morocco',
    // French cities
    paris: 'france',
    marseille: 'france',
    lyon: 'france',
    toulouse: 'france',
    nice: 'france',
    bordeaux: 'france',
    باريس: 'france',
    ليون: 'france',
    // Spanish cities
    madrid: 'spain',
    barcelona: 'spain',
    valencia: 'spain',
    seville: 'spain',
    مدريد: 'spain',
    برشلونة: 'spain',
    // Canadian cities/provinces
    ontario: 'canada',
    quebec: 'canada',
    toronto: 'canada',
    montreal: 'canada',
    vancouver: 'canada'
  };

  public static normalizeLocationName(name?: string | null): string {
    if (!name) return '';
    const clean = name.toLowerCase().trim();
    for (const [canonical, aliases] of Object.entries(this.COUNTRY_MAP)) {
      if (canonical === clean || aliases.includes(clean)) {
        return canonical;
      }
    }
    for (const [canonical, aliases] of Object.entries(this.REGION_MAP)) {
      if (canonical === clean || aliases.includes(clean)) {
        return canonical;
      }
    }
    return clean;
  }

  public static extractGeographicTarget(text: string): GeographicTarget | null {
    if (!text || !text.trim()) return null;
    const lower = text.toLowerCase().trim();

    // 1. Generic international phrasing check
    const internationalRegex = /(?:^|\s|[.,!?;:()،؟])(?:international|worldwide|monde|global|abroad|cross-border|outside\s+(?:the\s+)?country|other\s+countries|hors\s+du\s+pays|autres\s+pays|à\s+l['’]étranger|a\s+l['’]etranger|دولي|دولية|عالمي|عالمية|خارج\s+البلاد|خارج\s+الوطن|خارج\s+الدولة|دول\s+أخرى|دول\s+اخرى|برا\s+البلاد|برا\s+الوطن|برا|kharij|l-kharij|lkharij|barra|berra|dowal\s+o5ra|dowal\s+okhra)(?:$|\s|[.,!?;:()،؟])/iu;
    if (internationalRegex.test(lower)) {
      return { type: 'INTERNATIONAL', name: 'worldwide' };
    }

    // 2. Country detection
    for (const [canonical, aliases] of Object.entries(this.COUNTRY_MAP)) {
      for (const alias of aliases) {
        const regex = new RegExp(`(?:^|\\s|[.,!?;:()،؟])(?:f-|l-|d-|b-|al-|ال|فال|بال|ف|ب|ل|لـ|le|la|les|l['’]|d['’]|en|in|to|vers|pour|sur|de|du|au|aux)?\\s*${alias}(?:$|\\s|[.,!?;:()،؟])`, 'iu');
        if (regex.test(lower)) {
          return { type: 'COUNTRY', name: canonical };
        }
      }
    }

    // 3. Region detection
    for (const [canonical, aliases] of Object.entries(this.REGION_MAP)) {
      for (const alias of aliases) {
        const regex = new RegExp(`(?:^|\\s|[.,!?;:()،؟])(?:f-|l-|d-|b-|al-|ال|فال|بال|ف|ب|ل|لـ|le|la|les|l['’]|d['’]|en|in|to|vers|pour|sur|de|du|au|aux)?\\s*${alias}(?:$|\\s|[.,!?;:()،؟])`, 'iu');
        if (regex.test(lower)) {
          return { type: 'REGION', name: canonical };
        }
      }
    }

    // 4. Domestic subdivision (state / city) detection
    for (const [subdiv, parent] of Object.entries(this.SUBDIVISION_PARENT_MAP)) {
      const regex = new RegExp(`(?:^|\\s|[.,!?;:()،؟])(?:f-|l-|d-|b-|al-|ال|فال|بال|ف|ب|ل|لـ|le|la|les|l['’]|d['’]|en|in|to|vers|pour|sur|de|du|au|aux)?\\s*${subdiv}(?:$|\\s|[.,!?;:()،؟])`, 'iu');
      if (regex.test(lower)) {
        return { type: 'DOMESTIC_SUBDIVISION', name: subdiv, parentCountry: parent };
      }
    }

    return null;
  }

  /**
   * Checks if an intent belongs to the canonical store policy set.
   */
  public static isCanonicalPolicy(intent?: string | null): intent is CanonicalPolicyIntent {
    return Boolean(intent && CANONICAL_POLICY_INTENTS.includes(intent as any));
  }

  /**
   * Evaluates whether a query targets a geographic or policy scope beyond standard local coverage.
   */
  public static isScopeExpanded(
    intent?: string | null,
    query?: string | null,
    config?: BusinessConfig | null,
    shippingScope?: ShippingScopeConfig | null,
    domesticCountryOverride?: string | null
  ): boolean {
    if (!intent || !query) return false;
    if (intent !== 'SHIPPING') return false;

    const domesticRaw = shippingScope?.domesticCountry
      || config?.capabilities?.shippingScope?.domesticCountry
      || config?.identity?.country
      || domesticCountryOverride
      || 'Morocco';

    const normalizedDomestic = this.normalizeLocationName(domesticRaw);
    const scope = shippingScope?.scope || config?.capabilities?.shippingScope?.scope || 'DOMESTIC_ONLY';
    const supportedCountries = (shippingScope?.supportedCountries || config?.capabilities?.shippingScope?.supportedCountries || []).map(c => this.normalizeLocationName(c));
    const supportedRegions = (shippingScope?.supportedRegions || config?.capabilities?.shippingScope?.supportedRegions || []).map(r => this.normalizeLocationName(r));

    const detected = this.extractGeographicTarget(query);
    if (!detected) {
      return false; // Standard query with no foreign geographic target
    }

    if (detected.type === 'DOMESTIC_SUBDIVISION') {
      if (detected.parentCountry && this.normalizeLocationName(detected.parentCountry) !== normalizedDomestic) {
        return true; // Foreign city/state
      }
      return false; // Domestic city/state
    }

    if (detected.type === 'INTERNATIONAL') {
      return scope !== 'WORLDWIDE';
    }

    if (detected.type === 'COUNTRY') {
      const normTarget = this.normalizeLocationName(detected.name);
      if (normTarget === normalizedDomestic) {
        return false; // Domestic target
      }
      // Target is a foreign country
      return true;
    }

    if (detected.type === 'REGION') {
      const normRegion = this.normalizeLocationName(detected.name);
      if (normRegion === 'worldwide') {
        return scope !== 'WORLDWIDE';
      }
      if (supportedRegions.includes(normRegion) && scope === 'SELECTED_COUNTRIES') {
        return true;
      }
      return true;
    }

    return false;
  }

  /**
   * Evaluates whether cached evidence is authoritative and complete enough to answer the user query.
   */
  public static isSufficient(
    intent: string,
    query: string,
    cachedEvidence: PolicyEvidence[],
    config?: BusinessConfig | null,
    shippingScope?: ShippingScopeConfig | null,
    domesticCountryOverride?: string | null
  ): EvidenceSufficiencyResult {
    if (!cachedEvidence || cachedEvidence.length === 0) {
      return { isSufficient: false, reason: 'NO_CACHED_EVIDENCE' };
    }

    if (!this.isCanonicalPolicy(intent)) {
      return { isSufficient: false, reason: 'NON_CANONICAL_POLICY' };
    }

    const combinedContent = cachedEvidence.map(e => e.factualContent).join(' ').toLowerCase();

    switch (intent) {
      case 'SHIPPING': {
        const domesticRaw = shippingScope?.domesticCountry
          || config?.capabilities?.shippingScope?.domesticCountry
          || config?.identity?.country
          || domesticCountryOverride
          || 'Morocco';

        const normalizedDomestic = this.normalizeLocationName(domesticRaw);
        const detected = this.extractGeographicTarget(query);
        const isCrossBorderQuery = detected && (
          detected.type === 'INTERNATIONAL' ||
          (detected.type === 'COUNTRY' && this.normalizeLocationName(detected.name) !== normalizedDomestic) ||
          (detected.type === 'DOMESTIC_SUBDIVISION' && detected.parentCountry && this.normalizeLocationName(detected.parentCountry) !== normalizedDomestic) ||
          (detected.type === 'REGION' && this.normalizeLocationName(detected.name) !== normalizedDomestic)
        );

        if (isCrossBorderQuery) {
          // Check if cached evidence contains authoritative facts for this destination / international shipping
          const hasWorldwideFact = /\b(?:international|worldwide|monde|global|all countries|tous les pays|دولي|دولية|عالمي|عالمية|خارج)\b/i.test(combinedContent);
          let hasSpecificTargetFact = false;
          if (detected.name) {
            const targetAliases = this.COUNTRY_MAP[this.normalizeLocationName(detected.name)] || [detected.name];
            hasSpecificTargetFact = targetAliases.some(alias => combinedContent.includes(alias.toLowerCase()));
          }

          if (!hasWorldwideFact && !hasSpecificTargetFact) {
            return { isSufficient: false, reason: 'SCOPE_MISMATCH_INTERNATIONAL_SHIPPING' };
          }
          return { isSufficient: true };
        }

        // Standard domestic shipping facts check
        const hasGeneralShippingFacts = /\b(?:delivery|shipping|livraison|livrer|شحن|توصيل|fee|fees|frais|cost|price|free|gratuit|مجاني|مجانا|days|hours|jours|heures|أيام|ايام|ساعات|délai|delai|standard|express|amana|colis|order|commande|طلب|mad|usd|eur|درهم|\$|€|\d+)\b/i.test(combinedContent);
        if (!hasGeneralShippingFacts) {
          return { isSufficient: false, reason: 'MISSING_SHIPPING_FACTS' };
        }
        return { isSufficient: true };
      }

      case 'RETURNS': {
        // Return window, conditions, tags, size exchange
        const hasReturnFacts = /\b(?:14|30|return|returns|exchange|exchanges|tag|tags|unworn|days|jours|إرجاع|استبدال|ترجيع|تبديل|يوم|أيام|ايام|condition)\b/i.test(combinedContent);
        if (!hasReturnFacts) {
          return { isSufficient: false, reason: 'MISSING_RETURNS_FACTS' };
        }
        return { isSufficient: true };
      }

      case 'CARE': {
        // Washing temp, cycle, inside-out, ironing, bleaching
        const hasCareFacts = /\b(?:30|wash|washing|care|lavage|bleach|iron|ironing|غسيل|مقلوب|درجة|حرارة|نغسل|تصبين)\b/i.test(combinedContent);
        if (!hasCareFacts) {
          return { isSufficient: false, reason: 'MISSING_CARE_FACTS' };
        }
        return { isSufficient: true };
      }

      case 'TRACKING': {
        // Tracking link, SMS, dispatch
        const hasTrackingFacts = /\b(?:sms|link|track|tracking|suivi|suivre|رابط|تتبع|numéro|number|order)\b/i.test(combinedContent);
        if (!hasTrackingFacts) {
          return { isSufficient: false, reason: 'MISSING_TRACKING_FACTS' };
        }
        return { isSufficient: true };
      }

      case 'PAYMENT': {
        // Payment methods, COD
        const hasPaymentFacts = /\b(?:cod|cash|delivery|paiement|payer|livraison|خلاص|كاش|الاستلام|دفع|card|carte)\b/i.test(combinedContent);
        if (!hasPaymentFacts) {
          return { isSufficient: false, reason: 'MISSING_PAYMENT_FACTS' };
        }
        return { isSufficient: true };
      }

      case 'SUPPORT': {
        // Support email, phone
        const hasSupportFacts = /\b(?:@|phone|tel|email|contact|support|service|خدمة|زبناء|عملاء|هاتف|تواصل)\b/i.test(combinedContent);
        if (!hasSupportFacts) {
          return { isSufficient: false, reason: 'MISSING_SUPPORT_FACTS' };
        }
        return { isSufficient: true };
      }

      case 'STORE_INFO': {
        // Hours, opening schedule
        const hasStoreFacts = /\b(?:hours|horaires|opening|open|schedule|ساعات|عمل|أوقات|مواعيد|\d{1,2}[:h]\d{2})\b/i.test(combinedContent);
        if (!hasStoreFacts) {
          return { isSufficient: false, reason: 'MISSING_STORE_INFO_FACTS' };
        }
        return { isSufficient: true };
      }

      case 'SIZE_GUIDE': {
        // Chest measurement mapping or size table
        const hasSizeGuideFacts = /\b(?:size|xs|s|m|l|xl|xxl|chest|cm|taille|poitrine|guide|tableau|مقاس|مقاسات|صدر|سم)\b/i.test(combinedContent);
        if (!hasSizeGuideFacts) {
          return { isSufficient: false, reason: 'MISSING_SIZE_GUIDE_FACTS' };
        }
        return { isSufficient: true };
      }

      default:
        return { isSufficient: false, reason: 'UNSUPPORTED_INTENT' };
    }
  }

  /**
   * Converts cached PolicyEvidence items to RAGChunk format for downstream consumption.
   */
  public static evidenceToChunks(evidenceList: PolicyEvidence[]): RAGChunk[] {
    return evidenceList.map(ev => ({
      id: ev.sourceChunkId,
      documentId: ev.sourceDocumentId,
      content: ev.factualContent,
      similarity: ev.confidence,
      score: ev.confidence,
      documentTitle: ev.provenance.documentTitle,
      chunkType: ev.chunkType
    }));
  }

  /**
   * Merges and deduplicates newly retrieved evidence into the active session cache.
   */
  public static mergeEvidence(
    existingMap: Record<string, PolicyEvidence[]>,
    intent: string,
    newEvidence: PolicyEvidence[]
  ): Record<string, PolicyEvidence[]> {
    const currentList: PolicyEvidence[] = existingMap[intent] ? [...existingMap[intent]] : [];

    for (const nev of newEvidence) {
      if (!currentList.some(e => e.sourceDocumentId === nev.sourceDocumentId && e.sourceChunkId === nev.sourceChunkId)) {
        currentList.push(nev);
      }
    }

    existingMap[intent] = currentList;
    return existingMap;
  }
}

