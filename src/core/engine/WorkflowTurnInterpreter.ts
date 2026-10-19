import { LLMProvider, LLMRequestOptions } from '../llm/LLMProvider';
import { WorkflowFieldConfig, WorkflowStateConfig } from '../../domain/tenant/BusinessConfig';
import { GreetingRouter } from '../../domain/conversation/GreetingRouter';

export type WorkflowTurnKind =
  | 'FIELD_ANSWER'
  | 'SIDE_QUESTION'
  | 'ANSWER_AND_QUESTION'
  | 'CORRECTION'
  | 'CANCEL'
  | 'NEW_INTENT'
  | 'UNCLEAR';

export interface SourceSpan {
  text: string;
  start: number;
  end: number;
}

export interface WorkflowTurnInterpretation {
  kind: WorkflowTurnKind;
  fieldSourceSpan: SourceSpan | null;
  questionSourceSpan: SourceSpan | null;
  targetField: string | null;
  newValueSourceSpan: SourceSpan | null;
  intent: string | null;
}

export interface WorkflowFieldDescriptor {
  name: string;
  label?: string;
  type: WorkflowFieldConfig['type'];
  collected?: boolean;
  semanticType?: WorkflowFieldConfig['semanticType'];
}

const EMPTY: WorkflowTurnInterpretation = {
  kind: 'UNCLEAR', fieldSourceSpan: null, questionSourceSpan: null,
  targetField: null, newValueSourceSpan: null, intent: null
};

const QUESTION_START = /^(?:what|where|when|which|who|why|how|can|could|do|does|is|are|tell|explain|comment|combien|quel(?:le|s|les)?|wach|wash|wesh|wqch|ch7al|chhal|sh7al|kifach|kifash|chno|chnu|chnou|ashno|fin|t9der|t9dr|tqder|tqdr|momkin|mumkin|tchr7|chrah|chr7|3lach|imta|شنو|واش|كيفاش|شحال|هل|كيف|كم|متى|أين|اين|تقدر|ممكن|علاش|فوقاش|امتى|إمتى|اشرح|شرح)(?=\s|$)/iu;
const CORRECTION = /^(?:la\b|non\b|no\b|actually\b|correction\b|je veux changer\b|bghit nbdl\b|بغيت نبدل\b|لا[،,\s])/iu;
const CANCEL = /^(?:cancel|stop|annul(?:er|e)?|nlghi|bghit nlghi|بغيت نلغي|لا بغيت نلغي|حبس)/iu;

function empty(kind: WorkflowTurnKind): WorkflowTurnInterpretation {
  return { ...EMPTY, kind };
}

/** Harmless comparison only. Transliteration and semantic rewriting are deliberately absent. */
export function normalizeSpanText(value: string): string {
  return value.normalize('NFC').toLocaleLowerCase()
    .replace(/[\u064B-\u065F\u0670]/gu, '')
    .replace(/\s+/gu, ' ').trim();
}

function exactSpan(message: string, candidate: unknown): SourceSpan | null {
  const supplied = candidate && typeof candidate === 'object' && !Array.isArray(candidate)
    ? candidate as Record<string, unknown> : null;
  const text = typeof candidate === 'string' ? candidate : supplied?.text;
  if (typeof text !== 'string' || !text.trim()) return null;
  if (supplied && Number.isInteger(supplied.start) && Number.isInteger(supplied.end)) {
    const start = Number(supplied.start), end = Number(supplied.end);
    if (start >= 0 && end > start && end <= message.length && message.slice(start, end) === text) {
      return { text, start, end };
    }
    return null;
  }
  const raw = text.trim();
  const direct = message.indexOf(raw);
  if (direct >= 0) return { text: message.slice(direct, direct + raw.length), start: direct, end: direct + raw.length };

  // Normalization may change character counts. Search source slices rather than
  // accepting the model's normalized/transliterated spelling as evidence.
  const wanted = normalizeSpanText(raw);
  for (let start = 0; start < message.length; start++) {
    for (let end = start + 1; end <= message.length; end++) {
      if (normalizeSpanText(message.slice(start, end)) === wanted) {
        return { text: message.slice(start, end), start, end };
      }
    }
  }
  return null;
}

function deterministicSplit(message: string): { answer: SourceSpan; question: SourceSpan } | null {
  for (const match of [...message.matchAll(/[,،;؛.!؟?\n]+\s*/gu)]) {
    const left = message.slice(0, match.index).trim();
    const rightStart = (match.index || 0) + match[0].length;
    const right = message.slice(rightStart).trim();
    if (!left || !right || !QUESTION_START.test(GreetingRouter.normalize(right))) continue;
    const answer = exactSpan(message, left);
    const question = exactSpan(message, right);
    if (answer && question) return { answer, question };
  }
  return null;
}

// Words that make a short Arabic-script reply a sentence rather than a name.
const ARABIC_SENTENCE_WORDS = new Set([
  'بغيت', 'بغينا', 'عندي', 'عندك', 'عندكم', 'كاين', 'كاينة', 'ماكاين', 'ماشي', 'مازال', 'دابا', 'غدا', 'اليوم',
  'لا', 'اه', 'آه', 'ايه', 'إيه', 'نعم', 'واخا', 'صافي', 'مزيان', 'شكرا', 'سلام', 'السلام', 'عليكم', 'مرحبا', 'اهلا', 'أهلا',
  'انا', 'أنا', 'نتا', 'نتي', 'هو', 'هي', 'حنا', 'في', 'من', 'على', 'مع', 'ديال', 'هاد', 'هادي', 'هذا', 'هذه',
  'الثمن', 'التمن', 'الطلب', 'التوصيل', 'المنتج', 'موعد', 'نلغي', 'لغيت', 'وقف', 'حبس', 'عافاك', 'فضلك', 'الاسم', 'اسم', 'اسمي', 'سميتي', 'السمية', 'سمية'
]);

export function isBareArabicName(message: string): boolean {
  const words = message.trim().split(/\s+/u);
  if (words.length < 1 || words.length > 3) return false;
  if (!words.every(word => /^[ء-ي٠-٩ٮ-ۓً-ٰٟ]{2,20}$/u.test(word))) return false;
  if (/[٠-٩]/u.test(message)) return false;
  const normalized = GreetingRouter.normalize(message);
  if (GreetingRouter.isKnownGreeting(normalized) || GreetingRouter.isAcknowledgement(normalized)) return false;
  return !words.some(word => ARABIC_SENTENCE_WORDS.has(normalizeSpanText(word)));
}

// Lower-case words that are a reply, a channel or a Darija/French phrase rather than a first name.
const LATIN_NOT_NAMES = new Set([
  'salam', 'slm', 'salut', 'bonjour', 'bonsoir', 'hello', 'hi', 'hey', 'ok', 'okay', 'oui', 'non', 'no', 'yes', 'la', 'lla', 'iyeh', 'ah', 'wakha', 'safi',
  'merci', 'chokran', 'choukran', 'shukran', 'whatsapp', 'instagram', 'insta', 'facebook', 'tiktok', 'bjouj', 'bjoj', 'demo', 'test', 'info', 'prix', 'price',
  'taman', 'stop', 'cancel', 'bghit', 'baghi', 'baghya', 'wach', 'wash', 'chno', 'chnou', 'achno', 'ana', 'nta', 'nti', 'daba', 'ghda', 'lyoum', 'bzaf',
  'mzyan', 'zwin', 'kifach', 'fin', 'imta', 'chhal', 'ch7al', 'magasin', 'boutique', 'salon', 'shop', 'store', 'help', 'aide', 'hola', 'mrhba', 'mar7ba'
]);

/** Degraded mode only: "youssef" or "karim alami" typed in lower case, as many Darija speakers do. */
export function isBareLatinName(message: string): boolean {
  const words = message.trim().toLocaleLowerCase().split(/\s+/u);
  if (!words.length || words.length > 2) return false;
  if (!words.every(word => /^[a-zà-ÿ][a-zà-ÿ'-]{1,19}$/u.test(word))) return false;
  if (words.some(word => LATIN_NOT_NAMES.has(word))) return false;
  const normalized = GreetingRouter.normalize(message);
  return !GreetingRouter.isKnownGreeting(normalized) && !GreetingRouter.isAcknowledgement(normalized) && !QUESTION_START.test(normalized);
}

function safeFieldName(value: unknown, fields: WorkflowFieldDescriptor[]): string | null {
  if (typeof value !== 'string') return null;
  const normalized = normalizeSpanText(value);
  const field = fields.find(item => normalizeSpanText(item.name) === normalized ||
    (item.label && normalizeSpanText(item.label) === normalized));
  return field?.name || null;
}

/** Strict, fail-closed interpreter. It identifies source evidence; it never creates stored values. */
export class WorkflowTurnInterpreter {
  static async interpret(params: {
    message: string;
    pendingField: WorkflowFieldDescriptor;
    pendingPrompt: string;
    fields: WorkflowFieldDescriptor[];
    intents?: Array<{ id: string; keywords?: string[] }>;
    llm?: LLMProvider;
    options?: LLMRequestOptions;
  }): Promise<WorkflowTurnInterpretation> {
    const message = params.message.trim();
    if (!message) return empty('UNCLEAR');
    if (CANCEL.test(GreetingRouter.normalize(message))) return empty('CANCEL');

    const knownIntent = (params.intents || []).find(intent => (intent.keywords || []).some(keyword =>
      normalizeSpanText(keyword) === normalizeSpanText(message)));
    if (knownIntent) return { ...empty('NEW_INTENT'), intent: knownIntent.id };

    const split = deterministicSplit(message);
    if (split) return {
      ...empty('ANSWER_AND_QUESTION'), fieldSourceSpan: split.answer, questionSourceSpan: split.question
    };

    if (QUESTION_START.test(GreetingRouter.normalize(message)) || /[?؟]\s*$/u.test(message)) {
      return { ...empty('SIDE_QUESTION'), questionSourceSpan: exactSpan(message, message) };
    }

    if (params.pendingField.type === 'string') {
      // "اسمي يوسف", "أنا اسمي يوسف بنعلي", "سميتي ياسين، عندي حانوت": the name is the words after the
      // introduction, up to the first comma.
      const introduced = /^(?:(?:أنا|انا|ana|moi)\s+)?(?:my name is|je m['’]appelle|smiti|smiyti|esmi|ismi|اسمي|إسمي|سميتي)(?:\s+(?:هو|هي|huwa|hiya))?\s+(.{1,80})$/iu.exec(message);
      const introducedText = introduced?.[1].split(/[،,؛;\n]/u)[0].replace(/[.!]+$/u, '').trim();
      const introducedSpan = introducedText ? exactSpan(message, introducedText) : null;
      if (introducedSpan) return { ...empty('FIELD_ANSWER'), fieldSourceSpan: introducedSpan };
      if (params.pendingField.semanticType === 'person_name') {
        // "انا كريم" / "ana karim": "I am" followed by a bare name; "يوسف، عندي محل…": a name, then more.
        const iAm = /^(?:أنا|انا|ana|moi c['’]est|c['’]est|i['’]?m|i am)\s+(.{2,60})$/iu.exec(message)?.[1].trim();
        const firstPart = message.split(/[،,؛;\n]/u)[0].trim();
        for (const candidate of [iAm, firstPart !== message.trim() ? firstPart : undefined]) {
          if (candidate && (isBareArabicName(candidate) || isBareLatinName(candidate) || /^[\p{Lu}][\p{L}\p{M}'-]+(?:\s+[\p{Lu}][\p{L}\p{M}'-]+)?$/u.test(candidate))) {
            const span = exactSpan(message, candidate);
            if (span) return { ...empty('FIELD_ANSWER'), fieldSourceSpan: span };
          }
        }
      }
      // A bare, title-cased Latin name (a trailing initial such as "Karim B."
      // included) is deterministic enough for degraded mode. Sentence-like
      // lower-case text is never treated as a name.
      if (/^[\p{Lu}][\p{L}\p{M}'-]+(?:\s+[\p{Lu}][\p{L}\p{M}'-]*\.?){0,2}$/u.test(message)) {
        return { ...empty('FIELD_ANSWER'), fieldSourceSpan: exactSpan(message, message) };
      }
    }

    if (params.llm) {
      try {
        const fieldList = params.fields.map(field => ({
          name: field.name, label: field.label || field.name, type: field.type, collected: Boolean(field.collected)
        }));
        const raw = await params.llm.generateResponse(
          'Interpret one customer turn during a workflow. Return only strict JSON with keys: ' +
          'kind, fieldSourceSpan, questionSourceSpan, targetField, newValueSourceSpan, intent. ' +
          'kind is FIELD_ANSWER, SIDE_QUESTION, ANSWER_AND_QUESTION, CORRECTION, CANCEL, NEW_INTENT, or UNCLEAR. ' +
          'Every source span is either null or {"text":string,"start":number,"end":number}; offsets are zero-based, end-exclusive, and text must exactly equal that customer-message slice. ' +
          'Example: for "smiti Ilyes", fieldSourceSpan is "Ilyes". Never transliterate, normalize, infer, or rewrite a value. ' +
          'For a correction without a replacement value, set targetField and newValueSourceSpan=null. ' +
          'Use only a targetField from the provided field list and only a configured intent id. If unsure use UNCLEAR. ' +
          `Pending prompt: ${params.pendingPrompt}\nPending field: ${JSON.stringify(params.pendingField)}\n` +
          `Workflow fields: ${JSON.stringify(fieldList)}\nConfigured intents: ${JSON.stringify((params.intents || []).map(i => i.id))}`,
          [{ role: 'user', content: message }],
          { ...params.options, temperature: 0, maxTokens: 180,
            timeoutMs: Math.min(params.options?.timeoutMs || 4000, 4000),
            responseFormat: 'json_object', purpose: 'structured_turn_interpretation' }
        );
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const allowed = new Set<WorkflowTurnKind>(['FIELD_ANSWER', 'SIDE_QUESTION', 'ANSWER_AND_QUESTION', 'CORRECTION', 'CANCEL', 'NEW_INTENT', 'UNCLEAR']);
        if (!parsed || typeof parsed !== 'object' || !allowed.has(parsed.kind as WorkflowTurnKind)) return empty('UNCLEAR');
        const kind = parsed.kind as WorkflowTurnKind;
        const fieldSourceSpan = exactSpan(message, parsed.fieldSourceSpan);
        const questionSourceSpan = exactSpan(message, parsed.questionSourceSpan);
        const newValueSourceSpan = exactSpan(message, parsed.newValueSourceSpan);
        const targetField = safeFieldName(parsed.targetField, params.fields);
        const intent = typeof parsed.intent === 'string' && (params.intents || []).some(i => i.id === parsed.intent) ? parsed.intent : null;

        if (kind === 'FIELD_ANSWER' && !fieldSourceSpan) {
          // Backward-compatible degraded output: the model may classify the
          // whole turn without returning a span. Only non-name, non-question
          // fields may recover, using the original customer text as evidence.
          if (params.pendingField.semanticType !== 'person_name' && !QUESTION_START.test(GreetingRouter.normalize(message)) && !/[?؟]/u.test(message)) {
            return { ...empty('FIELD_ANSWER'), fieldSourceSpan: exactSpan(message, message) };
          }
          return empty('UNCLEAR');
        }
        if (kind === 'SIDE_QUESTION' && !questionSourceSpan) return empty('UNCLEAR');
        if (kind === 'ANSWER_AND_QUESTION' && (!fieldSourceSpan || !questionSourceSpan)) return empty('UNCLEAR');
        if (kind === 'CORRECTION' && !targetField) return empty('UNCLEAR');
        if (kind === 'CORRECTION' && parsed.newValueSourceSpan != null && !newValueSourceSpan) return empty('UNCLEAR');
        if (kind === 'NEW_INTENT' && !intent) return empty('UNCLEAR');
        return { kind, fieldSourceSpan, questionSourceSpan, targetField, newValueSourceSpan, intent };
      } catch {
        // Bad JSON and model downtime are deliberately non-mutating.
      }
    }

    // Typed fields can be verified deterministically without the model. Free
    // text is confirmed or clarified instead of being silently captured.
    if (params.pendingField.type !== 'string') {
      return { ...empty('FIELD_ANSWER'), fieldSourceSpan: exactSpan(message, message) };
    }
    if (params.pendingField.semanticType !== 'person_name') {
      return { ...empty('FIELD_ANSWER'), fieldSourceSpan: exactSpan(message, message) };
    }
    if (CORRECTION.test(GreetingRouter.normalize(message))) return empty('UNCLEAR');
    // Arabic script has no letter case, so the title-case rule above never
    // matches "ياسين" or "كريم العلمي". When the model is missing or failed,
    // accept 1-3 bare Arabic words unless they are a greeting, an
    // acknowledgement or contain a common sentence word.
    if (isBareArabicName(message) || isBareLatinName(message)) return { ...empty('FIELD_ANSWER'), fieldSourceSpan: exactSpan(message, message) };
    return empty('UNCLEAR');
  }

  static fieldsFromWorkflow(states: Record<string, WorkflowStateConfig>, collected: Record<string, unknown>): WorkflowFieldDescriptor[] {
    return Object.values(states).flatMap(state => {
      if (state.type !== 'collect' || !state.field) return [];
      const config = typeof state.field === 'string'
        ? { name: state.field, type: 'string' as const }
        : state.field;
      return [{ name: config.name, label: state.label || state.name, type: config.type,
        semanticType: ('semanticType' in config && config.semanticType) ||
          (/^(?:fullname|username|name|customername|contactname)$/i.test(config.name) ? 'person_name' : 'free_text'),
        collected: collected[config.name] !== undefined }];
    });
  }
}
