/** Fictional Moroccan WhatsApp-style ConversationEngine probe. No customer data. */
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { DeepSeekProvider } from '../src/core/llm/DeepSeekProvider';
import { telemetry } from '../src/core/telemetry/TelemetryClient';
import { makeEngine, profiles } from './evaluate-ten-moroccan-businesses';

type Profile = typeof profiles[number];
type Case = { id: string; question: string; check: (reply: string, profile: Profile) => boolean; note: string };
const currency = /(?:MAD|DHS?|dirhams?|درهم|دراهم)/iu;
const uncertain = /(?:not (?:listed|specified|mentioned|confirmed|available)|no (?:information|details)|don'?t (?:have|know)|cannot (?:confirm|guarantee)|check with|contact|pas (?:d'information|indiqu)|non (?:précisé|indiqué)|je ne (?:peux|sais)|ma\s+kayna\s+ta\s+(?:chi\s+)?(?:ma3luma|reduction.{0,30}mktouba)|ma[- ]?kaynach|ma[- ]?kaynch|ma\s*3(?:e|a)nd(?:na|ich)|ما (?:عندنا|كايناش|مذكور|نقدرش|نقدر)|غير مذكور|تواصل)/iu;
const closedSunday = /(?:closed|not open|not available|fermé|pas ouvert|ma\s*(?:khdamin|khedamin)|msdou(?:d|din)|msdudin|msdodin|ما.{0,12}(?:خدام|مفتوح)|مغلق|مسدود|من الاثنين إلى السبت|monday to saturday|lundi au samedi)/iu;
const confirmed = /(?:\b(?:your|the)\s+(?:appointment|booking|reservation|order)\s+(?:is|has been)\s+confirmed\b|\b(?:i|we)\s+(?:have|already)\s+booked\b|(?:تم|لقد)\s+(?:تأكيد|حجز)\s+(?:موعدك|الحجز|طلبك)|(?:rendez-vous|réservation)\s+(?:est|a été)\s+confirm)/iu;
const hasHours = (reply: string) => /18[:h]00|6[:h]00\s*(?:d\s*l3chiya|pm)?|6\s*(?:pm|مساء)|السادسة|six heures/iu.test(reply);
const hasCity = (reply: string, profile: Profile) => reply.toLowerCase().includes(profile.city.toLowerCase()) || ({ Casablanca: /الدار البيضاء|كازا/iu, Rabat: /الرباط/iu, Marrakech: /مراكش/iu, Tangier: /طنجة/iu, Fez: /فاس/iu, Agadir: /أكادير/iu, Kenitra: /القنيطرة/iu, Oujda: /وجدة/iu } as Record<string, RegExp>)[profile.city]?.test(reply);
const knownPrice = (reply: string, profile: Profile) => reply.includes(String(profile.price)) && currency.test(reply);
const casesFor = (profile: Profile, next: Profile): Case[] => [
  { id: 'darija-price', question: profile.price ? `salam 3afak bch7al ${profile.offer}?` : 'salam 3afak fach kat7ello?', check: profile.price ? knownPrice : hasHours, note: 'Known price or opening hours in Arabizi' },
  { id: 'arabic-price', question: profile.price ? `عفاك شحال ثمن ${profile.offer}؟` : 'عفاك فين كاينين؟', check: profile.price ? knownPrice : hasCity, note: 'Known fact in Moroccan Arabic' },
  { id: 'sunday', question: 'واش خدامين نهار الحد؟', check: reply => closedSunday.test(reply), note: 'Sunday must not be presented as open' },
  { id: 'location', question: 'fin kaynin 3afak?', check: hasCity, note: 'Correct location' },
  { id: 'card', question: 'wach n9der nkhelles b carte?', check: reply => /(?:card|carte|كارت|بطاقة)/iu.test(reply) && !/\b(?:no|non)\b.{0,20}(?:card|carte)/iu.test(reply), note: 'Supported card payment' },
  { id: 'discount', question: 'wach kayna chi reduction dyal tolba?', check: reply => uncertain.test(reply) && !/\b(?:yes|oui|نعم|إيه)\b.{0,45}(?:discount|reduction|تخفيض)/iu.test(reply), note: 'Unsupported discount requires uncertainty' },
  { id: 'delivery', question: profile.mode === 'commerce' ? `twsil l ${profile.city} ch7al kayakhod?` : 'واش كتوصّلو حتى لدار؟', check: (reply, p) => p.mode === 'commerce' ? /(?:two|2|deux|جوج|juj|يومين|نهارين)/iu.test(reply) && /(?:day|jour|yum|nhar|نهار|يوم)/iu.test(reply) : !/\b(?:yes|oui)\b.{0,30}(?:deliver|livr)/iu.test(reply) && !/نعم.{0,30}(?:توصيل|كنوصل)/iu.test(reply), note: 'Delivery policy is account-specific' },
  { id: 'booking', question: '3afak confirmi lia rendez-vous ghdda m3a 4', check: reply => !confirmed.test(reply), note: 'No false booking confirmation' },
  { id: 'mixed', question: profile.price ? `bch7al ${profile.offer} w fach katseddo?` : 'fin kaynin w fach katseddo?', check: (reply, p) => (p.price ? knownPrice(reply, p) : hasCity(reply, p)) && hasHours(reply), note: 'Both parts of a mixed question answered' },
  { id: 'cross-business', question: `3andkom ${next.offer} bch7al?`, check: (reply, p) => (next.price === 0 || !new RegExp(`\\b${next.price}\\s*(?:MAD|DHS?|dirhams?)\\b`, 'iu').test(reply)) && !reply.toLowerCase().includes(next.brand.toLowerCase()) && !reply.toLowerCase().includes(`yes, we have ${next.offer}`.toLowerCase()) && p.id !== next.id, note: 'No cross-account product leakage' },
  { id: 'followup-location', question: 'salam, fin kaynin?', check: hasCity, note: 'First conversation turn' },
  { id: 'followup-hours', question: 'w nhar l7ed, khdamin?', check: reply => closedSunday.test(reply), note: 'Follow-up in same conversation' }
];

async function main() {
  if (!process.env.DEEPSEEK_API_KEY) throw new Error('DEEPSEEK_API_KEY missing; no live evaluation run');
  const provider = new DeepSeekProvider(process.env.DEEPSEEK_API_KEY);
  const all: any[] = [];
  const only = new Set((process.env.EVAL_ONLY || '').split(',').filter(Boolean));
  const out = process.env.EVAL_OUT || (only.size ? 'docs/evaluations/moroccan-regressions' : 'docs/evaluations/moroccan-120');
  mkdirSync('docs/evaluations', { recursive: true });
  const limit = Number(process.env.EVAL_LIMIT || 120);
  for (let index = 0; index < profiles.length; index++) {
    const profile = profiles[index];
    const next = profiles[(index + 1) % profiles.length];
    const cases = casesFor(profile, next);
    for (const item of cases) {
      if (only.size && !only.has(`${profile.id}/${item.id}`)) continue;
      if (all.length >= limit) break;
      // Isolate every question; the two follow-up turns intentionally share state.
      const engine = item.id === 'followup-hours' ? (main as any).followupEngine : makeEngine(profile, provider);
      if (item.id === 'followup-location') (main as any).followupEngine = engine;
      const events: any[] = [];
      const unsubscribe = telemetry.onEvent(event => events.push(event));
      let reply = ''; let error: string | undefined;
      const start = Date.now();
      try { reply = await engine.handleMessage(profile.id, 'fictional', item.question, profile.id); }
      catch (cause: any) { error = cause?.message || String(cause); }
      finally { unsubscribe(); }
      const usage = events.filter(event => event.eventType === 'llm_usage').map(event => event.metadata);
      const passed = !error && item.check(reply, profile) && usage.every(call => call.success === true);
      all.push({ business: profile.id, case: item.id, question: item.question, reply, error, passed, note: item.note, latencyMs: Date.now() - start, usage });
      writeFileSync(`${out}.json`, JSON.stringify({ scope: '120 fictional Moroccan WhatsApp-style questions through the real ConversationEngine and DeepSeek; in-memory account data. No PDF ingestion, database, WhatsApp, or external customer action.', results: all }, null, 2));
      console.log(`${all.length}/${limit} ${passed ? 'PASS' : 'FAIL'} ${profile.id}/${item.id}: ${reply || error}`);
      if (usage.some(call => call.success === false) || error) throw new Error('Provider/engine failure; stopped to limit spend');
    }
    if (all.length >= limit) break;
  }
  const calls = all.flatMap(result => result.usage);
  const latency = all.map(result => result.latencyMs).sort((a, b) => a - b);
  const summary = { cases: all.length, passed: all.filter(result => result.passed).length, failed: all.filter(result => !result.passed).length, llmCalls: calls.length, inputTokens: calls.reduce((sum, call) => sum + (call.inputTokens || 0), 0), outputTokens: calls.reduce((sum, call) => sum + (call.outputTokens || 0), 0), p95LatencyMs: latency[Math.floor(latency.length * .95)] };
  writeFileSync(`${out}.md`, `# 120 fictional Moroccan-style chatbot questions\n\n${JSON.stringify(summary, null, 2)}\n\nRule checks are triage only. Manual transcript review is required, especially for language and unsupported claims. No customer accounts, live WhatsApp, PDFs, database or booking system were exercised.\n\n${all.map(result => `## ${result.business}/${result.case} — ${result.passed ? 'PASS' : 'FAIL'}\n\nCustomer: ${result.question}\n\nBot: ${result.reply || result.error}\n\nLatency: ${result.latencyMs} ms`).join('\n\n')}`);
  console.log(JSON.stringify(summary));
  if (summary.failed) process.exitCode = 1;
}

void main().then(() => process.exit(process.exitCode || 0)).catch(error => { console.error(error?.message || error); process.exit(1); });
