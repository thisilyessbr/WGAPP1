import { BusinessConfig } from '../tenant/BusinessConfig';
import { TurnDecision, TurnDecisionResolver } from '../conversation/TurnDecision';
import { PolicyEvidenceReuse } from '../rag/PolicyEvidenceReuse';
import { FaqMatcher, SupportedLanguage } from './FaqMatcher';

/** Apply the same FAQ safety rules in normal conversation and inside workflows. */
export class FaqAnswerPolicy {
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
      TRACKING: ['TRACKING', 'ORDER_STATUS', 'SHIPPING'],
      PAYMENT: ['PAYMENT', 'COD', 'BILLING', 'PAYMENT_POLICY'],
      SUPPORT: ['SUPPORT', 'CONTACT', 'CUSTOMER_SERVICE'],
      CARE: ['CARE', 'MAINTENANCE', 'WASHING'],
      WARRANTY: ['WARRANTY', 'GUARANTEE'],
      SIZE_GUIDE: ['SIZE_GUIDE', 'SIZING', 'SIZE']
    };
    return Boolean(compatible[normalizedIntent]?.includes(normalizedCategory)
      || compatible[normalizedCategory]?.includes(normalizedIntent));
  }

  static match(
    question: string,
    config: BusinessConfig,
    language: SupportedLanguage,
    decision?: Partial<Pick<TurnDecision, 'domain' | 'source' | 'isMultiPolicy' | 'responseScript' | 'responseLanguage' | 'intent'>>
  ) {
    const match = FaqMatcher.match(question, config.capabilities?.faq, language);
    if (!match?.answer || (match.confidence !== undefined && match.confidence < 0.75)) return null;
    const policies = TurnDecisionResolver.detectPolicySignals(question);
    if (policies.isMultiPolicy || decision?.isMultiPolicy || decision?.source === 'HYBRID') return null;
    if (decision?.domain === 'ECOMMERCE') return null;
    if (policies.isPolicy && match.entry.category
      && !this.isCategoryCompatible(policies.intent, match.entry.category)) return null;
    if (decision?.responseScript === 'arabizi' && /[\u0600-\u06FF]/u.test(match.answer)) return null;
    if (decision?.responseLanguage === 'darija' && decision.responseScript === 'arabic'
      && !/[\u0621-\u064A]/u.test(match.answer) && /[a-z]{3}/iu.test(match.answer)) return null;
    if (policies.intent === 'SHIPPING'
      && !PolicyEvidenceReuse.isSufficient('SHIPPING', question, [{ factualContent: match.answer } as any], config).isSufficient) return null;
    return match;
  }
}
