import { LLMProvider, LLMRequestOptions } from '../llm/LLMProvider';
import { WorkflowFieldConfig } from '../../domain/tenant/BusinessConfig';
import { GreetingRouter } from '../../domain/conversation/GreetingRouter';

export type WorkflowTurnKind = 'FIELD_ANSWER' | 'CUSTOMER_QUESTION' | 'UNCLEAR';

// A question opener can have a one-character mobile typo. This is deliberately
// limited to the first word, so arbitrary field answers are not keyword-scanned.
const QUESTION_OPENERS = ['wach', 'wash', 'wesh', 'chhal', 'ch7al', 'kifach', 'what', 'where', 'when', 'which', 'comment', 'combien'];
const CLEAR_QUESTION_OPENERS = new Set([
  'what', 'where', 'when', 'which', 'who', 'why', 'how', 'can', 'could',
  'do', 'does', 'is', 'are', 'tell', 'explain', 'comment', 'combien',
  'quel', 'quelle', 'quels', 'quelles', 'wach', 'wash', 'wesh',
  'chhal', 'ch7al', 'kifach', 'kifash', 'chno', 'ashno', 'fin',
  'شنو', 'واش', 'كيفاش', 'شحال', 'هل', 'كيف', 'كم', 'متى', 'أين', 'اين'
]);

function isOneEditAway(value: string, candidate: string): boolean {
  if (Math.abs(value.length - candidate.length) > 1) return false;
  let edits = 0;
  let i = 0;
  let j = 0;
  while (i < value.length && j < candidate.length) {
    if (value[i] === candidate[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (value.length >= candidate.length) i++;
    if (value.length <= candidate.length) j++;
  }
  return edits + (value.length - i) + (candidate.length - j) <= 1;
}

/** Classify a turn before a collect step can persist the customer's answer. */
export class WorkflowTurnGate {
  static async classify(
    message: string,
    fieldName: string,
    field: string | WorkflowFieldConfig | undefined,
    prompt: string,
    llm?: LLMProvider,
    options?: LLMRequestOptions
  ): Promise<WorkflowTurnKind> {
    const normalized = GreetingRouter.normalize(message);
    const firstWord = normalized.split(/\s+/u)[0] || '';
    // Business topics such as "customer support" are answers to a need field,
    // not questions merely because they contain an FAQ keyword.
    if (message.includes('?') || message.includes('؟') || CLEAR_QUESTION_OPENERS.has(firstWord))
      return 'CUSTOMER_QUESTION';
    if (firstWord.length >= 4 && QUESTION_OPENERS.some(word => isOneEditAway(firstWord, word))) {
      return 'CUSTOMER_QUESTION';
    }

    const config = typeof field === 'object' ? field : undefined;
    const type = config?.type || 'string';
    const semanticType = type === 'string'
      ? (config?.semanticType || (/^(?:fullname|username|name|customername|contactname)$/i.test(fieldName)
        ? 'person_name' : 'free_text'))
      : type;
    const words = normalized.split(/\s+/u).filter(Boolean);
    const nameShape = words.length >= 1 && words.length <= 3
      && /^[\p{L}\p{M}'-]+$/u.test(words[0])
      && words.every(word => /^(?:[\p{L}\p{M}'-]+|\d{1,2})$/u.test(word));

    if (semanticType === 'person_name' && nameShape) return 'FIELD_ANSWER';

    if (llm && (type === 'string' || words.length > 1)) {
      try {
        const decision = await llm.classifyIntent(
          `Route one customer message during a business form. Pending question: ${prompt}. ` +
          `Requested field: ${semanticType === 'person_name' ? 'PERSON NAME' : semanticType} (${fieldName}). ` +
          'The customer may use Moroccan Darija, typo-heavy Arabizi, French, Arabic, or English. ' +
          'CUSTOMER_QUESTION means they ask about the provider business or product, even without punctuation. ' +
          'FIELD_ANSWER means they describe their own activity, products, need, or other requested field, ' +
          'even if product words match a FAQ. Judge against the pending question, not product keywords. ' +
          'UNCLEAR means uncertain. ' +
          'Return exactly one label.',
          message,
          ['FIELD_ANSWER', 'CUSTOMER_QUESTION', 'UNCLEAR'],
          { ...options, temperature: 0, maxTokens: 24, timeoutMs: Math.min(options?.timeoutMs || 4000, 4000) }
        );
        if (decision === 'CUSTOMER_QUESTION' || decision === 'UNCLEAR') return decision;
        if (decision === 'FIELD_ANSWER') {
          return semanticType === 'person_name' && !nameShape ? 'UNCLEAR' : decision;
        }
      } catch {
        // Failure must not persist an unrelated message as a person name.
      }
      // Configured classification failed or returned an invalid label: ask again
      // instead of guessing and corrupting a customer's record.
      return 'UNCLEAR';
    }

    if (type !== 'string') return 'FIELD_ANSWER';
    if (semanticType === 'person_name') {
      return nameShape && words.length <= 2 ? 'FIELD_ANSWER' : 'UNCLEAR';
    }
    return 'FIELD_ANSWER';
  }
}
