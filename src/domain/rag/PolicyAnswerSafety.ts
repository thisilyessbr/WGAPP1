import { BusinessConfig } from '../tenant/BusinessConfig';
import { TurnDecisionResolver } from '../conversation/TurnDecision';
import { DirectRagGuard, SupportedScript } from './DirectRagGuard';
import { PolicyEvidenceReuse } from './PolicyEvidenceReuse';
import { SupportedLanguage } from '../faq/FaqMatcher';
import { matchesPolicyPhrase } from '../conversation/IntentLanguage';

/** One evidence contract for direct answers in chat, workflows, and completed sessions. */
export class PolicyAnswerSafety {
  private static readonly PAYMENT_EVIDENCE_TERMS = /(?:payments?|paid|deposit|fees?|acompte|avance|frais|عربون|تسبيق)/iu;

  static requestedIntents(query: string, explicitIntents: string[] = []): string[] {
    return [...new Set([...explicitIntents, ...TurnDecisionResolver.detectPolicySignals(query).matchedCategories])];
  }

  static supportsIntent(
    intent: string,
    query: string,
    content: string,
    documentTitle: string | undefined,
    config: BusinessConfig
  ): boolean {
    if (!content.trim()) return false;
    // Similarity alone is not evidence of the requested topic. A returns-only
    // document must never be counted as shipping evidence, even when it is the
    // nearest vector result for a shipping subquery.
    const evidenceTopics = TurnDecisionResolver.detectPolicySignals(`${documentTitle || ''} ${content}`).matchedCategories;
    // Payment documents often state terms ("a deposit is paid on arrival")
    // without the generic word "payment" that query routing keys on.
    const paymentTerms = intent === 'PAYMENT'
      && matchesPolicyPhrase(`${documentTitle || ''} ${content}`, PolicyAnswerSafety.PAYMENT_EVIDENCE_TERMS);
    if (!evidenceTopics.includes(intent as any) && !paymentTerms) return false;
    if (!PolicyEvidenceReuse.isCanonicalPolicy(intent)) return true;
    return PolicyEvidenceReuse.isSufficient(intent, query, [{ factualContent: content }], config).isSufficient;
  }

  static directAnswerIsSafe(
    query: string,
    content: string,
    documentTitle: string | undefined,
    config: BusinessConfig,
    language?: SupportedLanguage,
    script?: SupportedScript,
    explicitIntents: string[] = []
  ): boolean {
    if (!DirectRagGuard.evaluate(query, content, language, script).isSafe) return false;
    const requiredIntents = explicitIntents.length > 0 ? [...explicitIntents] : this.requestedIntents(query);
    // Short follow-ups such as "And France?" may omit the word "shipping".
    // A foreign location cannot make a domestic shipping chunk safe merely
    // because the current text has no explicit policy keyword.
    if (PolicyEvidenceReuse.extractGeographicTarget(query) &&
        TurnDecisionResolver.detectPolicySignals(`${documentTitle || ''} ${content}`).matchedCategories.includes('SHIPPING') &&
        !requiredIntents.includes('SHIPPING')) requiredIntents.push('SHIPPING');
    return requiredIntents.every(intent =>
      this.supportsIntent(intent, query, content, documentTitle, config));
  }

  static hasShippingScopeEvidence(
    query: string,
    chunks: Array<{ content: string; documentTitle?: string }>,
    config: BusinessConfig
  ): boolean {
    return chunks.some(chunk => this.supportsIntent('SHIPPING', query, chunk.content, chunk.documentTitle, config));
  }

  static unknownShippingScope(language: SupportedLanguage, script?: SupportedScript): string {
    if (language === 'fr') return 'Je n’ai pas d’information confirmée sur la livraison internationale vers cette destination. Notre équipe peut vérifier pour vous.';
    if (language === 'ar') return 'ليست لدي معلومات مؤكدة عن الشحن الدولي إلى هذه الوجهة. يمكن لفريقنا التحقق من ذلك لك.';
    if (language === 'darija') return script === 'arabizi'
      ? 'Ma 3ndich ma3loumat m2akkda 3la livraison lbarra. L-fariq y9der yt2akked lik mn had l-wijha.'
      : 'ما عنديش معلومات مؤكدة على التوصيل لبرّا. الفريق يقدر يتأكد ليك من هاد الوجهة.';
    return 'I don’t have confirmed information about international shipping to that destination. Our team can check it for you.';
  }
}
