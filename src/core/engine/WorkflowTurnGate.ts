import { LLMProvider, LLMRequestOptions } from '../llm/LLMProvider';
import { WorkflowFieldConfig } from '../../domain/tenant/BusinessConfig';
import { GreetingRouter } from '../../domain/conversation/GreetingRouter';

export type WorkflowTurnKind = 'FIELD_ANSWER' | 'CUSTOMER_QUESTION' | 'UNCLEAR';
export type WorkflowTurnInterpretation = { kind: WorkflowTurnKind; fieldValue?: string; question?: string };

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
  private static isQuestion(text: string): boolean {
    const firstWord = GreetingRouter.normalize(text).split(/\s+/u)[0] || '';
    return text.includes('?') || text.includes('؟') || CLEAR_QUESTION_OPENERS.has(firstWord) ||
      (firstWord.length >= 4 && QUESTION_OPENERS.some(word => isOneEditAway(firstWord, word)));
  }

  private static personNameValue(text: string): string | null {
    const value = text.trim().replace(/^(?:my name is|i am|je m['’]appelle|je suis|سميتي|اسمي|أنا|انا|smiti)\s+/iu, '').trim();
    if (value === text.trim()) return null;
    const words = value.split(/\s+/u);
    return words.length >= 1 && words.length <= 3 && words.every(word => /^[\p{L}\p{M}'-]+$/u.test(word))
      ? value : null;
  }

  /** Split only an explicit answer followed by a separate, clearly marked question. */
  static splitAnswerAndQuestion(
    message: string, fieldName: string, field: string | WorkflowFieldConfig | undefined
  ): { fieldValue: string; question: string } | null {
    const config = typeof field === 'object' ? field : undefined;
    const isName = (config?.type || 'string') === 'string' &&
      (config?.semanticType === 'person_name' || (!config?.semanticType && /^(?:fullname|username|name|customername|contactname)$/i.test(fieldName)));
    const separators = /[,،;؛.!?؟\n]+\s*/gu;
    for (const match of [...message.matchAll(separators)].reverse()) {
      const fieldText = message.slice(0, match.index).trim();
      const question = message.slice(match.index + match[0].length).trim();
      if (!fieldText || !question || this.isQuestion(fieldText) || !this.isQuestion(question)) continue;
      const fieldValue = isName ? (this.personNameValue(fieldText) || fieldText) : fieldText;
      if (isName) {
        const words = fieldValue.split(/\s+/u);
        if (words.length > 3 || !words.every(word => /^[\p{L}\p{M}'-]+$/u.test(word))) continue;
      }
      return { fieldValue, question };
    }
    return null;
  }

  /** Only split an unambiguous name followed by a separate question. Never guess a name from a free-text need. */
  static splitPersonNameAndQuestion(
    message: string, fieldName: string, field: string | WorkflowFieldConfig | undefined
  ): { fieldValue: string; question: string } | null {
    const config = typeof field === 'object' ? field : undefined;
    const isName = (config?.type || 'string') === 'string' &&
      (config?.semanticType === 'person_name' || (!config?.semanticType && /^(?:fullname|username|name|customername|contactname)$/i.test(fieldName)));
    if (!isName) return null;
    const parts = message.trim().split(/[,،\n]|\s+[—–]\s+/u);
    if (parts.length !== 2) return null;
    const [fieldValue, question] = parts.map(part => part.trim());
    const words = fieldValue.split(/\s+/u);
    const validName = words.length >= 1 && words.length <= 3 &&
      words.every(word => /^[\p{L}\p{M}'-]+$/u.test(word));
    const firstWord = GreetingRouter.normalize(question).split(/\s+/u)[0] || '';
    const clearQuestion = question.includes('?') || question.includes('؟') || CLEAR_QUESTION_OPENERS.has(firstWord) ||
      (firstWord.length >= 4 && QUESTION_OPENERS.some(word => isOneEditAway(firstWord, word)));
    return validName && clearQuestion ? { fieldValue, question } : null;
  }

  static async classify(
    message: string,
    fieldName: string,
    field: string | WorkflowFieldConfig | undefined,
    prompt: string,
    llm?: LLMProvider,
    options?: LLMRequestOptions
  ): Promise<WorkflowTurnKind> {
    return (await this.interpret(message, fieldName, field, prompt, llm, options)).kind;
  }

  /** One bounded structured call only when deterministic routing cannot safely separate the turn. */
  static async interpret(
    message: string,
    fieldName: string,
    field: string | WorkflowFieldConfig | undefined,
    prompt: string,
    llm?: LLMProvider,
    options?: LLMRequestOptions
  ): Promise<WorkflowTurnInterpretation> {
    const normalized = GreetingRouter.normalize(message);
    // A question at the start is not a form value. A later question may be
    // attached to a field answer, so let the structured interpreter split it.
    if (this.isQuestion(message.trim().split(/\s+/u)[0] || '')) return { kind: 'CUSTOMER_QUESTION' };

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

    const explicitName = semanticType === 'person_name' ? this.personNameValue(message) : null;
    if (explicitName) return { kind: 'FIELD_ANSWER', fieldValue: explicitName };
    if (semanticType === 'person_name' && nameShape) return { kind: 'FIELD_ANSWER' };

    const embeddedQuestion = /[\s,،;؛—–](?:wach|wash|wesh|wqch|chhal|ch7al|kifach|what|where|when|which|does|do|can|could|is|are|est-ce|vous|comment|combien|واش|شنو|كيفاش|شحال|هل|كيف|كم)(?=\s|$)/iu.test(message);
    const questionOnly = this.isQuestion(message);
    if (questionOnly && !embeddedQuestion) return { kind: 'CUSTOMER_QUESTION' };

    if (llm && (type === 'string' || words.length > 1)) {
      try {
        const raw = await llm.generateResponse(
          `Classify ONE customer turn during a form. Pending question: ${prompt}. ` +
          `Requested field: ${semanticType === 'person_name' ? 'PERSON NAME' : semanticType} (${fieldName}). ` +
          'The customer may use Darija, Arabizi, Arabic, French, or English. ' +
          'Return ONLY a JSON object with kind (FIELD_ANSWER, CUSTOMER_QUESTION, MIXED, or UNCLEAR), ' +
          'fieldValue and question. For MIXED, copy the field answer and separate business question ' +
          'verbatim from the customer message; never invent or paraphrase either span. ' +
          'A statement about the customer business is FIELD_ANSWER, not a product FAQ. ' +
          'If unsure, use UNCLEAR. Do not answer the question or take any action.',
          [{ role: 'user', content: message }],
          { ...options, temperature: 0, maxTokens: 128, timeoutMs: Math.min(options?.timeoutMs || 4000, 4000), responseFormat: 'json_object', purpose: 'structured_turn_interpretation' }
        );
        const decision: unknown = JSON.parse(raw);
        if (!decision || typeof decision !== 'object' || Array.isArray(decision)) return { kind: 'UNCLEAR' };
        const result = decision as Record<string, unknown>;
        if (result.kind === 'MIXED' && typeof result.fieldValue === 'string' && typeof result.question === 'string') {
          const fieldValue = result.fieldValue.trim();
          const question = result.question.trim();
          const fieldIndex = message.indexOf(fieldValue);
          const questionIndex = message.indexOf(question);
          const beforeField = message.slice(0, fieldIndex).trim();
          const between = message.slice(fieldIndex + fieldValue.length, questionIndex);
          const afterQuestion = message.slice(questionIndex + question.length).trim();
          if (fieldValue && question && fieldIndex >= 0 && questionIndex > fieldIndex + fieldValue.length - 1 &&
              !beforeField && /^[\s,،;؛.!?؟—–]+$/u.test(between) && !afterQuestion && this.isQuestion(question) &&
              (semanticType !== 'person_name' ||
                fieldValue.split(/\s+/u).length <= 3 && fieldValue.split(/\s+/u).every(word => /^[\p{L}\p{M}'-]+$/u.test(word)))) {
            return { kind: 'CUSTOMER_QUESTION', fieldValue, question };
          }
        }
        if (result.kind === 'CUSTOMER_QUESTION') return { kind: 'CUSTOMER_QUESTION' };
        if (result.kind === 'FIELD_ANSWER' && !questionOnly && !embeddedQuestion) {
          return semanticType === 'person_name' && !nameShape ? { kind: 'UNCLEAR' } : { kind: 'FIELD_ANSWER' };
        }
      } catch {
        // Invalid or unavailable interpretation must not corrupt customer data.
      }
      return { kind: 'UNCLEAR' };
    }

    if (questionOnly) return { kind: 'CUSTOMER_QUESTION' };
    if (type !== 'string') return { kind: 'FIELD_ANSWER' };
    if (semanticType === 'person_name') {
      return { kind: nameShape && words.length <= 2 ? 'FIELD_ANSWER' : 'UNCLEAR' };
    }
    return { kind: embeddedQuestion ? 'UNCLEAR' : 'FIELD_ANSWER' };
  }
}
