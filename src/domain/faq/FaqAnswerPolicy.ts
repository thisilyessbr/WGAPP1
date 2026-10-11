import { BusinessConfig } from '../tenant/BusinessConfig';
import { TurnDecision, TurnDecisionResolver } from '../conversation/TurnDecision';
import { PolicyEvidenceReuse } from '../rag/PolicyEvidenceReuse';
import { FaqMatcher, SupportedLanguage } from './FaqMatcher';

/** Apply the same FAQ safety rules in normal conversation and inside workflows. */
export class FaqAnswerPolicy {
  private static coversQuestion(intent: string, question: string, answer: string, config: BusinessConfig): boolean {
    if (intent === 'SHIPPING') {
      if (PolicyEvidenceReuse.isScopeExpanded(intent, question, config)) return false;
      const destination = PolicyEvidenceReuse.extractGeographicTarget(question);
      if (destination?.type === 'DOMESTIC_SUBDIVISION' &&
          !answer.toLowerCase().includes(destination.name.toLowerCase())) return false;
      if (/\b(?:express|same.day|next.day|overnight)\b|سريع|مستعجل/iu.test(question) &&
          !/\b(?:express|same.day|next.day|overnight)\b|سريع|مستعجل/iu.test(answer)) return false;
      if (/\b(?:free|gratuit|offert)\b|ببلاش|مجاني/iu.test(question) &&
          !/\b(?:free|gratuit|offert)\b|ببلاش|مجاني/iu.test(answer)) return false;
      if (/\b(?:how long|when|time|delay|délai|delai|combien de temps)\b|فوقاش|وقتاش|مدة|شحال كيدوز/iu.test(question) &&
          !/\b(?:hour|hours|day|days|heure|heures|jour|jours|h)\b|ساعة|ساعات|يوم|أيام|\d+\s*[–-]\s*\d+/iu.test(answer)) return false;
      if (/\b(?:how much|cost|price|fee|frais|prix|combien|chhal|ch7al|bch7al)\b|شحال|ثمن|سعر/iu.test(question) &&
          !/(?:\d|mad|درهم|free|gratuit|مجاني)/iu.test(answer)) return false;
    }
    if (intent === 'RETURNS' && /\b(?:without|sans)\s+(?:the\s+)?(?:tag|tags|étiquette|etiquette)\b|بلا\s+(?:تيكيت|البطاقة)/iu.test(question) &&
        !/\b(?:without|sans)\s+(?:the\s+)?(?:tag|tags|étiquette|etiquette)\b|بلا\s+(?:تيكيت|البطاقة)/iu.test(answer)) return false;
    return PolicyEvidenceReuse.isSufficient(intent, question, [{ factualContent: answer } as any], config).isSufficient;
  }

  static matchPolicySet(question: string, config: BusinessConfig, language: SupportedLanguage, intents: string[], script?: string) {
    if (intents.length < 2 || intents.length > 4 || PolicyEvidenceReuse.isScopeExpanded('SHIPPING', question, config)) return null;
    const items: Array<{ intent: string; faqId: string; content: string }> = [];
    for (const intent of intents) {
      if (!PolicyEvidenceReuse.isCanonicalPolicy(intent)) return null;
      const entries = (config.capabilities?.faq || []).filter(entry =>
        Boolean(entry.category) && !['POLICY', 'GENERAL', 'FAQ', 'ALL'].includes(entry.category!.toUpperCase())
        && this.isCategoryCompatible(intent, entry.category!));
      if (entries.length !== 1) return null;
      const answer = FaqMatcher.resolveLanguageAnswer(entries[0], language, script);
      if (!answer || (script === 'arabizi' && /[\u0600-\u06FF]/u.test(answer))
        || !this.coversQuestion(intent, question, answer, config)) return null;
      items.push({ intent, faqId: entries[0].id, content: answer });
    }
    return items;
  }
  static isCategoryCompatible(intent: string, category: string): boolean {
    if (!intent || !category) return true;
    const normalizedIntent = intent.toUpperCase();
    const normalizedCategory = category.toUpperCase();
    if (['POLICY', 'GENERAL', 'FAQ', 'ALL'].includes(normalizedCategory)) return true;
    if (normalizedIntent === normalizedCategory) return true;
    const compatible: Record<string, string[]> = {
      STORE_INFO: ['HOURS', 'STORE_INFO', 'LOCATION', 'BUSINESS_HOURS'],
      SHIPPING: ['SHIPPING', 'DELIVERY', 'LOGISTICS', 'SHIPPING_POLICY'],
      RETURNS: ['RETURNS', 'EXCHANGE', 'REFUND', 'RETURN', 'POLICY', 'RETURN_POLICY'],
      TRACKING: ['TRACKING', 'ORDER_STATUS'],
      PAYMENT: ['PAYMENT', 'COD', 'BILLING', 'PAYMENT_POLICY'],
      SUPPORT: ['SUPPORT', 'CONTACT', 'CUSTOMER_SERVICE'],
      CARE: ['CARE', 'MAINTENANCE', 'WASHING'],
      WARRANTY: ['WARRANTY', 'GUARANTEE'],
      SIZE_GUIDE: ['SIZE_GUIDE', 'SIZING', 'SIZE']
    };
    return Boolean(compatible[normalizedIntent]?.includes(normalizedCategory));
  }

  static match(
    question: string,
    config: BusinessConfig,
    language: SupportedLanguage,
    decision?: Partial<Pick<TurnDecision, 'domain' | 'source' | 'isMultiPolicy' | 'responseScript' | 'responseLanguage' | 'intent'>>
  ) {
    let match = FaqMatcher.match(question, config.capabilities?.faq, language);
    const policies = TurnDecisionResolver.detectPolicySignals(question);
    if (match && match.confidence < 0.75) match = null;
    // A lexical hit on a different FAQ category is not an answer. Discard it
    // before trying the single approved category for the detected policy.
    if (match?.entry.category && policies.isPolicy &&
        !this.isCategoryCompatible(policies.intent, match.entry.category)) match = null;
    // A short, unqualified return request in Moroccan Arabic is equivalent to
    // asking for the returns policy. Use the approved FAQ only when exactly one
    // returns policy exists; ambiguous or qualified requests still need RAG.
    if (!match && language === 'darija'
      && /^(?:واش\s+)?(?:نقدر\s+)?(?:نرجع|نبدل)\s+[\p{Script=Arabic}]+(?:\s+[\p{Script=Arabic}]+)?[؟?\s]*$/u.test(question.trim())) {
      const entries = (config.capabilities?.faq || []).filter(entry =>
        entry.category && this.isCategoryCompatible('RETURNS', entry.category)
        && !['POLICY', 'GENERAL', 'FAQ', 'ALL'].includes(entry.category.toUpperCase()));
      if (entries.length === 1) {
        const answer = FaqMatcher.resolveLanguageAnswer(entries[0], language, decision?.responseScript);
        if (answer) match = { entry: entries[0], answer, matchedLang: language, confidence: 0.85, matchType: 'keywords' };
      }
    }
    // A configured category is authoritative even when a customer paraphrases
    // its question. Require a single specific FAQ and enough facts for the
    // requested dimension; never guess between multiple policies or locations.
    if (!match && decision?.domain === 'KNOWLEDGE' && !decision.isMultiPolicy &&
        (decision.source !== 'HYBRID' || decision.intent === 'RETURNS') &&
        decision.intent && PolicyEvidenceReuse.isCanonicalPolicy(decision.intent)) {
      const entries = (config.capabilities?.faq || []).filter(entry =>
        entry.category && !['POLICY', 'GENERAL', 'FAQ', 'ALL'].includes(entry.category.toUpperCase()) &&
        this.isCategoryCompatible(decision.intent!, entry.category));
      if (entries.length === 1) {
        const answer = FaqMatcher.resolveLanguageAnswer(entries[0], language, decision?.responseScript);
        if (answer && this.coversQuestion(decision.intent, question, answer, config)) {
          match = { entry: entries[0], answer, matchedLang: language, confidence: 0.8, matchType: 'keywords' };
        }
      }
    }
    if (!match?.answer || (match.confidence !== undefined && match.confidence < 0.75)) return null;
    if (decision?.responseScript === 'arabizi') {
      const scriptAnswer = FaqMatcher.resolveLanguageAnswer(match.entry, language, 'arabizi');
      if (!scriptAnswer) return null;
      match = { ...match, answer: scriptAnswer };
    }
    if (policies.isMultiPolicy || decision?.isMultiPolicy) return null;
    if (decision?.source === 'HYBRID') {
      // A general policy is useful in a product conversation, but it cannot
      // establish whether that exact product has an exception. Only answer
      // explicit general-policy requests and state the qualification.
      if (decision.intent !== 'RETURNS' ||
          !/\b(?:return\s+policy|same\s+policy|exchange\s+policy|politique\s+de\s+retour|même\s+politique)\b|سياسة\s+(?:الإرجاع|الترجيع|التبديل)|نفس\s+السياسة/iu.test(question)) return null;
      const entries = (config.capabilities?.faq || []).filter(entry =>
        entry.category && this.isCategoryCompatible('RETURNS', entry.category));
      if (entries.length !== 1 || entries[0].id !== match.entry.id) return null;
      const caveat = language === 'fr' ? 'Vérifiez avec notre équipe si cet article a une exception.'
        : language === 'ar' ? 'يُرجى التأكد مع فريقنا إن كان لهذا المنتج استثناء.'
        : language === 'darija' ? (decision.responseScript === 'arabizi'
          ? 'T2kked m3a l-fariq ila had lmontoj 3ndo chi istithna2.'
          : 'تأكد مع الفريق إلا كان لهاد المنتوج شي استثناء.')
          : 'Our team can confirm whether this item has an exception.';
      match = { ...match, answer: `${match.answer} ${caveat}` };
    }
    if (decision?.domain === 'ECOMMERCE') return null;
    if (policies.isPolicy && match.entry.category
      && !this.isCategoryCompatible(policies.intent, match.entry.category)) return null;
    if (decision?.responseScript === 'arabizi' && /[\u0600-\u06FF]/u.test(match.answer)) return null;
    if (decision?.responseLanguage === 'darija' && decision.responseScript === 'arabic'
      && !/[\u0621-\u064A]/u.test(match.answer) && /[a-z]{3}/iu.test(match.answer)) return null;
    if (PolicyEvidenceReuse.isCanonicalPolicy(policies.intent)
      && !this.coversQuestion(policies.intent, question, match.answer, config)) return null;
    return match;
  }
}
