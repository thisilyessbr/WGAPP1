import { LLMProvider, LLMRequestOptions } from '../llm/LLMProvider';
import { WorkflowFieldConfig } from '../../domain/tenant/BusinessConfig';
import { GreetingRouter } from '../../domain/conversation/GreetingRouter';

export type WorkflowTurnKind = 'FIELD_ANSWER' | 'CUSTOMER_QUESTION' | 'UNCLEAR';

/** Hard ceiling for the gate's classifier call; a form turn must not stall. */
export const WORKFLOW_TURN_GATE_TIMEOUT_MS = 4000;

/**
 * Words that mark a question only when they open the message. Inside a reply
 * they are ordinary words: "my name IS Ali", "MIN الدار البيضاء" (from Casablanca).
 * "من" is deliberately absent: in Darija it almost always means "from".
 */
const LEADING_QUESTION_WORDS = new Set([
  // English
  'what', 'when', 'where', 'which', 'who', 'whom', 'whose', 'why', 'how',
  'is', 'are', 'do', 'does', 'did', 'can', 'could', 'should', 'would', 'will',
  // French
  'quoi', 'quand', 'qui', 'pourquoi', 'comment', 'combien', 'quel', 'quelle', 'quels', 'quelles', 'est-ce',
  // Arabic (normalized)
  'ماذا', 'متى', 'اين', 'لماذا', 'كيف', 'كم', 'هل',
  // Darija (Arabic script, normalized)
  'شنو', 'اشنو', 'شحال', 'بشحال', 'فين', 'كيفاش', 'علاش', 'واش', 'امتى', 'فوقاش', 'شكون', 'وقتاش',
  // Darija / Arabizi
  'chhal', 'ch7al', 'shhal', 'sh7al', 'bch7al', 'bchhal', 'chno', 'ashno', 'achno', 'chnou', 'fayn', 'fin',
  'kifach', 'kifash', '3lach', '3lash', 'wach', 'wesh', 'imta', 'emta', 'fo9ach', 'chkoun', 'chkon'
]);
const LEADING_QUESTION_PHRASES = ['est ce que', 'how much', 'tell me', 'pouvez vous', 'peux tu', 'wach kayn'];
/** Unambiguous interrogatives that mark a question wherever they appear. */
const QUESTION_WORDS_ANYWHERE = new Set([
  'chhal', 'ch7al', 'shhal', 'sh7al', 'bch7al', 'bchhal', 'شحال', 'بشحال', 'combien', 'pourquoi', 'why',
  '3lach', '3lash', 'علاش', 'لماذا', 'kifach', 'kifash', 'كيفاش', 'wach', 'واش', 'هل'
]);

/**
 * Classify a reply before a collect state mutates its persisted session. A
 * syntactically valid string is not necessarily an answer to the asked field.
 * When the classifier answers but cannot decide, uncertain replies fail
 * closed (UNCLEAR, which the engine counts toward its unmatched limit). When
 * the classifier is unavailable (error or timeout), the turn falls back to the
 * deterministic field-answer path instead of blocking the form.
 */
export class WorkflowTurnGate {
  /** Cheap pre-LLM check: a question mark, a question word that opens the
   * message, or an unambiguous interrogative anywhere. */
  static looksLikeQuestion(message: string, normalized = GreetingRouter.normalize(message)): boolean {
    if (/[?؟]/u.test(message)) return true;
    const words = normalized.split(/\s+/u).filter(Boolean);
    if (words.length === 0) return false;
    if (LEADING_QUESTION_WORDS.has(words[0]) || words.some(word => QUESTION_WORDS_ANYWHERE.has(word))) return true;
    const opening = words.slice(0, 3).join(' ');
    return LEADING_QUESTION_PHRASES.some(phrase => opening === phrase || opening.startsWith(`${phrase} `));
  }

  private static async classifyWithDeadline(
    llm: LLMProvider,
    systemPrompt: string,
    message: string,
    options: LLMRequestOptions
  ): Promise<string | null> {
    const timeoutMs = Math.min(options.timeoutMs || WORKFLOW_TURN_GATE_TIMEOUT_MS, WORKFLOW_TURN_GATE_TIMEOUT_MS);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        llm.classifyIntent(systemPrompt, message, ['FIELD_ANSWER', 'CUSTOMER_QUESTION', 'UNCLEAR'], { ...options, timeoutMs }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('TIMEOUT')), timeoutMs); })
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  static async classify(
    message: string,
    fieldName: string,
    field: string | WorkflowFieldConfig | undefined,
    prompt: string,
    llm?: LLMProvider,
    options?: LLMRequestOptions
  ): Promise<WorkflowTurnKind> {
    const normalized = GreetingRouter.normalize(message);
    if (this.looksLikeQuestion(message, normalized)) return 'CUSTOMER_QUESTION';

    const config = typeof field === 'object' ? field : undefined;
    const type = config?.type || 'string';
    const semanticType = type === 'string'
      ? (config?.semanticType || (/^(?:(?:full|user|customer|contact|first|last)name|name)$/i.test(fieldName)
        ? 'person_name' : 'free_text'))
      : type;
    const words = normalized.split(/\s+/u).filter(Boolean);
    const nameShape = words.length >= 1 && words.length <= 3
      && words.every(word => /^[\p{L}\p{M}'-]+$/u.test(word));

    // Classify nontrivial replies with the tenant's existing LLM. The model
    // returns only one allowed label, never a customer-facing answer or data.
    if (llm && words.length > 1) {
      let decision: string | null = null;
      let classifierAvailable = true;
      try {
        decision = await this.classifyWithDeadline(llm,
          `You are routing one customer message during a business form. The pending question is: ${prompt}. ` +
          `The field is ${semanticType === 'person_name' ? 'a PERSON NAME' : semanticType} (${fieldName}). ` +
          'The message may be Moroccan Darija in Arabic script or typo-heavy Arabizi, French, Arabic, or English. ' +
          'Choose CUSTOMER_QUESTION if the customer asks about the provider business or product, even without punctuation. ' +
          'Choose FIELD_ANSWER when the customer describes their own activity, products, need, or other requested field, ' +
          'even if the message contains product words that could match a FAQ. ' +
          'Judge the message against the pending question, not against product keywords. ' +
          'Choose UNCLEAR when uncertain. Return exactly one allowed label, with no explanation.',
          message,
          { ...options, temperature: 0, maxTokens: 24 }
        );
      } catch {
        // Error or timeout: use the deterministic path below rather than
        // blocking the form on classifier availability.
        classifierAvailable = false;
      }
      if (decision === 'CUSTOMER_QUESTION' || decision === 'UNCLEAR') return decision;
      if (decision === 'FIELD_ANSWER') {
        return semanticType === 'person_name' && !nameShape ? 'UNCLEAR' : decision;
      }
      // The classifier answered without a recognized label. Free text and
      // names have no deterministic validator downstream, so they fail closed
      // rather than risk corrupting data. Structured fields (date/number/
      // phone/...) are validated below, so let them through.
      if (classifierAvailable && type === 'string' && !(semanticType === 'person_name' && nameShape && words.length <= 2)) {
        return 'UNCLEAR';
      }
    }

    if (type !== 'string') return 'FIELD_ANSWER';
    if (semanticType === 'person_name') {
      // Without a trustworthy classification, accept only short name-shaped
      // replies. Longer replies require clarification rather than corrupting CRM.
      return nameShape && words.length <= 2 ? 'FIELD_ANSWER' : 'UNCLEAR';
    }
    return 'FIELD_ANSWER';
  }
}
