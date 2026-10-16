import { WorkflowConfig } from '../tenant/BusinessConfig';

/**
 * Conversation-level rules applied to every reply just before it is finalized, whatever produced it (FAQ, AI,
 * knowledge, fallback). Keeping them in one place means a new answer source cannot bring the problems back:
 *  1. Once a flow is completed in this conversation (a demo booked, an order sent), no reply invites the customer
 *     to start that flow again ("Write «bghit demo»…", "Want a demo?").
 *  2. A reply that would nearly repeat the previous reply becomes a short clarifying question instead.
 * Flow messages are left alone: a flow legitimately repeats its question until it gets an answer.
 */
export interface ReplyGuardContext {
  source: string;
  language: string;
  script?: string;
  previousReply?: string;
  completedWorkflow?: WorkflowConfig;
}

const EXEMPT_SOURCES = new Set(['WORKFLOW', 'GREETING', 'SAFETY_GUARD', 'HANDOFF', 'HUMAN_AGENT', 'CAP']);
const CATALOG_SOURCES = new Set(['ECOMMERCE', 'SERVICE', 'IMAGE']);

const CLARIFY: Record<string, string> = {
  en: 'What would you like to know exactly? Tell me a little more and I will answer.',
  fr: 'Que voulez-vous savoir exactement ? Dites-m’en un peu plus et je vous réponds.',
  ar: 'ما الذي تريد معرفته بالضبط؟ وضّح سؤالك قليلاً وسأجيبك.',
  darija_arabic: 'شنو بغيتي تعرف بالضبط؟ وضّح ليا السؤال ديالك شوية ونجاوبك.',
  darija_arabizi: 'Chno bghiti t3ref b dabt? Wdda7 lia so2al dyalek chwiya w njawbek.'
};

const variant = (language: string, script?: string) => language === 'darija' ? (script === 'arabizi' ? 'darija_arabizi' : 'darija_arabic') : language;

/**
 * Words of a text for comparing replies, as spelling-independent skeletons: lower case, no accents or punctuation,
 * no leading article (l-/el-/al-) and no Latin vowels, so Arabizi variants ("lma3loumat" / "ma3lomat") compare equal.
 */
function words(text: string): string[] {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ًͯ-ٟ]/g, '').replace(/(?<=\p{L})[-'’](?=\p{L})/gu, '')
    .split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 2)
    .map(w => w.replace(/^(?:al|el|l)(?=\p{L}{4})/u, '').replace(/[aeiouy]/g, '') || w);
}

/** Numbers and names (capitalised words inside a sentence) carry the actual information of an answer. */
function facts(text: string): Set<string> {
  const found = new Set<string>();
  // Standalone numbers only: in Arabizi, digits inside words are letters ("3arabiya", "mfe33el").
  for (const n of text.match(/(?<![\p{L}\d])\d+(?:[.,]\d+)?(?![\p{L}\d])/gu) || []) found.add(n);
  for (const m of text.matchAll(/(?<=[\p{L},;:)]\s+)(\p{Lu}[\p{L}'’-]{2,})/gu)) found.add(m[1].toLowerCase());
  return found;
}

/** A near-repeat: mostly the same words, and no number or name the previous reply did not already give. */
export function isRepeat(reply: string, previous: string): boolean {
  if (words(reply).length < 8 || replyOverlap(reply, previous) < 0.6) return false;
  const before = facts(previous);
  return [...facts(reply)].every(f => before.has(f));
}

/** Share of the shorter reply's distinct words that also appear in the other reply. */
export function replyOverlap(a: string, b: string): number {
  const A = new Set(words(a)), B = new Set(words(b));
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  return shared / Math.min(A.size, B.size);
}

const normalize = (text: string) => text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const INVITE_VERB = /(?:^|[^\p{L}])(?:kteb|ktb|kteb\s+lia|write|type|send|écrivez|ecrivez|écris|ecris|tapez|envoyez|اكتب|كتب|أرسل|ارسل|صيفط)(?=$|[^\p{L}])/iu;

/** True when the sentence invites the customer to start the given (already completed) flow. */
export function invitesToFlow(sentence: string, workflow: WorkflowConfig): boolean {
  const triggers = (workflow.activation?.keywords || []).map(normalize).filter(k => k.length >= 3);
  if (!triggers.length) return false;
  const text = normalize(sentence);
  const mentions = triggers.some(k => (' ' + text + ' ').includes(' ' + k + ' '));
  if (!mentions) return false;
  // "Write «bghit demo» …" / "Kteb "bghit demo"…" or an offer question such as "Bghiti demo?" / "Want a demo?"
  const quoted = /["“”«»„]/u.test(sentence);
  const question = /[?؟]\s*$/u.test(sentence.trim());
  return quoted || question || INVITE_VERB.test(sentence);
}

function withoutFlowInvitations(reply: string, workflow: WorkflowConfig): string {
  // Sentences end with . ! ? ؟ or a line break; keep everything else as written.
  const parts = reply.split(/(?<=[.!?؟])\s+|\n+/u);
  const triggers = (workflow.activation?.keywords || []).map(normalize).filter(k => k.length >= 3);
  const mentionsFlow = (part: string) => triggers.some(k => (' ' + normalize(part) + ' ').includes(' ' + k + ' '));
  // An invitation often runs on ("Want to see it? The demo is free and takes 15 minutes."): drop what follows it too
  // while it keeps talking about that flow.
  // A question directly followed by a sentence about the flow ("Want to see how it works? Free demo, 15 minutes.") is
  // the same invitation split in two.
  const isQuestion = (part: string) => /[?؟]\s*$/u.test(part.trim());
  const drop = parts.map((part, i) => invitesToFlow(part, workflow) || (isQuestion(part) && i + 1 < parts.length && mentionsFlow(parts[i + 1])));
  for (let i = 1; i < parts.length; i++) if (drop[i - 1] && mentionsFlow(parts[i])) drop[i] = true;
  const kept = parts.filter((_part, i) => !drop[i]);
  return kept.length === parts.length ? reply : kept.join(' ').replace(/\s{2,}/g, ' ').trim();
}

export class ConversationReplyGuard {
  static clarifyingQuestion(language: string, script?: string): string {
    return CLARIFY[variant(language, script)] || CLARIFY.en;
  }

  static apply(reply: string, ctx: ReplyGuardContext): string {
    if (!reply || EXEMPT_SOURCES.has(ctx.source)) return reply;
    let out = reply;
    if (ctx.completedWorkflow) out = withoutFlowInvitations(out, ctx.completedWorkflow) || ConversationReplyGuard.clarifyingQuestion(ctx.language, ctx.script);
    // Only substantial replies count as repeats; a short "Bla jmil" may legitimately come back, and catalog answers
    // (products, services) can look alike for different items.
    if (!CATALOG_SOURCES.has(ctx.source) && ctx.previousReply && isRepeat(out, ctx.previousReply)) {
      return ConversationReplyGuard.clarifyingQuestion(ctx.language, ctx.script);
    }
    return out;
  }
}
