/**
 * Second-layer review of the 10k Moroccan evaluation: an LLM reviewer reads a
 * stratified sample of complete conversations (per bot type and language) and
 * scores the bot's writing the way a native Moroccan customer would: right
 * language/script, natural phrasing, tone, clarity. Facts are checked by the
 * rule-based judge; this pass is only about how the replies read.
 *
 *   npx tsx scripts/eval/llmWritingReview.ts            (40 per bot type x language = 800)
 *   REVIEW_PER_CELL=10 npx tsx scripts/eval/llmWritingReview.ts
 */
import 'dotenv/config';
import { readFileSync, writeFileSync } from 'node:fs';
import { DeepSeekProvider } from '../../src/core/llm/DeepSeekProvider';
import { LANGS } from './moroccanCommerceCorpus';
import { PROFILES } from './moroccan10kCorpus';

const IN = process.env.EVAL_OUT || 'docs/evaluations/moroccan-10k';
const PER_CELL = Number(process.env.REVIEW_PER_CELL || 40);
const BATCH = 5;
const LANG_NAME: Record<string, string> = { en: 'English', fr: 'French', ar: 'Modern Standard Arabic', da: 'Moroccan Darija in Arabic script', dz: 'Moroccan Darija in Latin letters (Arabizi)' };

const SYSTEM = `You are a native Moroccan reviewer, fluent in Moroccan Darija (Arabic script and Arabizi), Modern Standard Arabic, French and English. You review WhatsApp conversations between customers and a business chatbot.
Judge ONLY how the bot's messages read to the customer, not whether business facts are correct (that is checked separately).
For each conversation return:
- language_ok: true if every bot message is in the customer's language and script. Arabizi customers must get Arabizi (Latin letters); Darija customers in Arabic script must get Arabic script. Common French loanwords inside Darija (livraison, taille, carte) are normal in Morocco and acceptable; whole French sentences are not.
- fluency: 1-5, natural and grammatical for a native speaker of that language/dialect.
- tone: 1-5, polite, warm and professional for a business chat.
- clarity: 1-5, answers the question directly and concisely, easy to understand.
- issues: short list of concrete writing problems (empty if none). Quote the problematic words briefly.
Return JSON: {"reviews":[{"id":"...","language_ok":true,"fluency":5,"tone":5,"clarity":5,"issues":[]}]} with one entry per conversation, same ids.`;

async function main() {
  const rows = readFileSync(`${IN}.jsonl`, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const latest = [...new Map(rows.map(r => [r.id, r])).values()];
  const sample: any[] = [];
  for (const p of PROFILES) for (const l of LANGS) {
    const cell = latest.filter(r => r.profile === p && r.lang === l && r.transcript?.some((t: any) => t.bot));
    const step = Math.max(1, Math.floor(cell.length / PER_CELL));
    sample.push(...cell.filter((_, i) => i % step === 0).slice(0, PER_CELL));
  }
  const llm = new DeepSeekProvider(process.env.DEEPSEEK_API_KEY!, process.env.DEEPSEEK_JUDGE_MODEL || process.env.DEEPSEEK_MODEL);
  const reviews = new Map<string, any>();
  const batches: any[][] = [];
  for (let i = 0; i < sample.length; i += BATCH) batches.push(sample.slice(i, i + BATCH));
  let next = 0, done = 0;
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (next < batches.length) {
      const batch = batches[next++];
      const payload = batch.map(r => ({ id: r.id, customer_language: LANG_NAME[r.lang],
        conversation: r.transcript.map((t: any) => ({ customer: t.customer,
          bot: `${t.bot || '(no reply)'}${t.media?.length ? ` [${t.media.length} product photo(s) attached]` : ''}` })) }));
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const raw = await llm.generateResponse(SYSTEM, [{ role: 'user', content: JSON.stringify(payload) }], { temperature: 0, maxTokens: 1500, timeoutMs: 60000, responseFormat: 'json_object' } as any);
          const parsed = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ''));
          for (const review of parsed.reviews || []) if (batch.some(r => r.id === review.id)) reviews.set(review.id, review);
          break;
        } catch (error: any) { if (attempt === 2) console.error(`review batch failed: ${error?.message || error}`); }
      }
      done++;
      if (done % 20 === 0) console.log(`${done}/${batches.length} batches`);
    }
  }));

  const reviewed = sample.filter(r => reviews.has(r.id)).map(r => ({ ...reviews.get(r.id), profile: r.profile, lang: r.lang, transcript: r.transcript }));
  const avg = (xs: any[], k: string) => +(xs.reduce((s, x) => s + (Number(x[k]) || 0), 0) / Math.max(1, xs.length)).toFixed(2);
  const cell = (xs: any[]) => ({ n: xs.length, languageOk: +(100 * xs.filter(x => x.language_ok).length / Math.max(1, xs.length)).toFixed(1),
    fluency: avg(xs, 'fluency'), tone: avg(xs, 'tone'), clarity: avg(xs, 'clarity'), weak: xs.filter(x => Math.min(x.fluency, x.tone, x.clarity) <= 2 || !x.language_ok).length });
  const byProfile = Object.fromEntries(PROFILES.map(p => [p, cell(reviewed.filter(x => x.profile === p))]));
  const byLang = Object.fromEntries(LANGS.map(l => [l, cell(reviewed.filter(x => x.lang === l))]));
  const overall = cell(reviewed);
  const weak = reviewed.filter(x => Math.min(x.fluency, x.tone, x.clarity) <= 3 || !x.language_ok);
  writeFileSync(`${IN}-writing-review.json`, JSON.stringify({ overall, byProfile, byLang, reviews: reviewed }, null, 1));
  const profileName: Record<string, string> = { ecom_wf: 'E-commerce + order workflow', ecom_nowf: 'E-commerce, no workflow', svc_wf: 'Service + booking workflow', svc_nowf: 'Service, no workflow' };
  const row = (name: string, c: any) => `| ${name} | ${c.n} | ${c.languageOk}% | ${c.fluency} | ${c.tone} | ${c.clarity} | ${c.weak} |`;
  writeFileSync(`${IN}-writing-review.md`, [
    `# Writing-quality review — ${reviewed.length} sampled conversations`, '',
    'An LLM reviewer acting as a native Moroccan reader scored every bot message in a stratified sample (same number per bot type and language). Scores are 1–5. "Weak" = any score ≤ 2 or wrong language/script.', '',
    '| Bot type | Reviewed | Right language/script | Fluency | Tone | Clarity | Weak |', '|---|---|---|---|---|---|---|',
    row('**All**', overall), ...PROFILES.map(p => row(profileName[p], byProfile[p])), '',
    '| Language | Reviewed | Right language/script | Fluency | Tone | Clarity | Weak |', '|---|---|---|---|---|---|---|',
    ...LANGS.map(l => row(LANG_NAME[l], byLang[l])), '',
    `## Conversations scored 3 or lower on any axis (${weak.length})`, '',
    ...weak.map(x => `### ${x.id} — fluency ${x.fluency}, tone ${x.tone}, clarity ${x.clarity}${x.language_ok ? '' : ', wrong language/script'}\n\n${x.transcript.map((t: any) => `- Customer: ${t.customer}\n- Bot: ${(t.bot || '(no reply)').replace(/\n+/g, ' ')}`).join('\n')}\n- Reviewer: ${(x.issues || []).join('; ') || '—'}`)
  ].join('\n'));
  console.log(JSON.stringify({ overall, byProfile, byLang }, null, 2));
}

void main().then(() => process.exit(0)).catch(error => { console.error(error?.stack || error); process.exit(1); });
