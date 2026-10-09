import { BusinessConfig } from '../tenant/BusinessConfig';
import { FaqAnswerPolicy } from '../faq/FaqAnswerPolicy';
import { SupportedLanguage } from '../faq/FaqMatcher';
import { SupportedScript } from '../rag/DirectRagGuard';

/** Answer a separate, explicit question in the same turn that starts a workflow. */
export function workflowOpeningAnswer(
  message: string, config: BusinessConfig, language: SupportedLanguage, script: SupportedScript
): string | null {
  // Customers often put the conversion request and a separate question in
  // two sentences ("I want a demo. Does it work on Instagram?"). Keep each
  // sentence available for the same approved-FAQ lookup as comma clauses.
  const clauses = message.split(/[,،;؛\n]+|(?<=[.!؟?])\s+/u).map(part => part.trim()).filter(Boolean);
  if (clauses.length < 2) return null;
  const question = clauses.slice(1).find(part =>
    /[?؟]/u.test(part) || /^(?:ch7al|sh7al|bch7al|wach|wash|شنو|واش|شحال|بشحال|كم|ما|combien|quel(?:le)?|est-ce|how|what|can|does)\b/iu.test(part)
  );
  if (!question) return null;

  const faq = FaqAnswerPolicy.match(question, config, language, {
    responseLanguage: language, responseScript: script
  });
  if (faq?.answer) return faq.answer.trim();

  // Some businesses publish a price policy instead of a localized FAQ. Use
  // only the price-bearing clause from that approved fact, never invent a quote.
  const asksPrice = /(?:\b(?:ch7al|sh7al|bch7al|taman|prix|tarif|price|pricing|cost|combien)\b|ثمن|السعر|سعر|بشحال|شحال)/iu.test(question);
  const payment = (config.portalFacts?.policies as Record<string, unknown> | undefined)?.payment;
  if (!asksPrice || typeof payment !== 'string') return null;
  const priceClause = payment.split(/[.!؟;؛]+/u).map(part => part.trim())
    .find(part => /(?:\b(?:prix|tarif|price|pricing|cost|taman)\b|ثمن|السعر|سعر)/iu.test(part));
  if (!priceClause || priceClause.length > 240) return null;
  const arabic = /[\u0621-\u064A]/u.test(priceClause);
  if (language === 'darija' && arabic !== (script === 'arabic')) return null;
  if ((language === 'en' || language === 'fr') && arabic) return null;
  return priceClause;
}
