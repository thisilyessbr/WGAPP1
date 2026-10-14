/**
 * 10,000 fictional Moroccan WhatsApp conversations through the real bootstrap
 * (ConversationEngine, workflows, product repository, live DeepSeek) against
 * the isolated TEST_DATABASE_URL, across four chatbot profiles:
 *   ecom_wf   e-commerce store with a cash-on-delivery order workflow
 *   ecom_nowf the same store without workflows
 *   svc_wf    spa / beauty centre with an appointment-request workflow
 *   svc_nowf  the same centre without workflows
 * Every reply gets fact checks (prices, durations, policies, stock, images,
 * language/script) and writing-quality checks. No real customer data,
 * WhatsApp, or production database.
 *
 *   npx tsx scripts/evaluate-moroccan-10k.ts
 *   EVAL_PROFILE=svc_wf EVAL_LIMIT=50 EVAL_CONCURRENCY=8 npx tsx scripts/evaluate-moroccan-10k.ts
 *   Results stream to <EVAL_OUT>.jsonl; a rerun resumes unless EVAL_FRESH=1.
 */
import 'dotenv/config';
process.env.PORTAL_ENABLED = 'false';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/tests/testDb';
import { bootstrapChatbot } from '../src/bootstrap';
import { outboundMediaContext } from '../src/domain/conversation/AnswerComposer';
import { compileBusiness } from '../src/portal/validation';
import { telemetry } from '../src/core/telemetry/TelemetryClient';
import { logger } from '../src/utils/logger';
import { STORE, imageUrlFor, LANGS } from './eval/moroccanCommerceCorpus';
import { judge, languageOk, TurnResult } from './eval/moroccanCommerceChecks';
import { SERVICE_STORE } from './eval/moroccanServiceCorpus';
import { judgeService, SERVICE_CATALOG_TEXT } from './eval/moroccanServiceChecks';
import { build10kCorpus, Case10k, Profile, PROFILES } from './eval/moroccan10kCorpus';
import { replyQualityIssues } from './eval/conversationQuality';
import { answerFor, askedField, Field } from './eval/customerSimulator';

logger.silent = process.env.EVAL_VERBOSE !== '1';
const OUT = process.env.EVAL_OUT || 'docs/evaluations/moroccan-10k';
const tenantOf = (p: Profile) => `eval-10k-${p.replace('_', '-')}`;
const accountOf = (p: Profile) => `${tenantOf(p)}-account`;
const isCommerce = (p: Profile) => p.startsWith('ecom');
const hasWorkflow = (p: Profile) => p.endsWith('_wf');

const COMMERCE_CATALOG = [...STORE.products.flatMap(p => [p.description, p.name, ...p.variants.map(v => v.color)]), STORE.address, STORE.name].sort((a, b) => b.length - a.length);

const orderWorkflow = {
  id: 'cod_order', name: 'Commande paiement à la livraison', description: 'Collect a cash-on-delivery order',
  initialState: 'collect_product', allowInterruption: true,
  activation: { mode: 'explicit_intent', keywords: ['bghit ncommandi', 'bghit nakhod', 'bghit nchri', 'je veux commander', 'commander', "j'aimerais acheter", 'I want to order', 'I would like to buy', 'بغيت نطلب', 'بغيت نشري', 'أريد أن أطلب'] },
  outcome: { type: 'ORDER_CONFIRMED' },
  states: {
    collect_product: { type: 'collect', field: 'product', next: 'collect_size', prompt: { en: 'Which product would you like?', fr: 'Quel article souhaitez-vous ?', ar: 'ما هو المنتج الذي تريده؟', darija: 'شنو هو المنتوج اللي بغيتي؟' } },
    collect_size: { type: 'collect', field: 'size', next: 'collect_name', prompt: { en: 'Which size and colour?', fr: 'Quelle taille et quelle couleur ?', ar: 'ما المقاس واللون؟', darija: 'شنو المقاس واللون؟' } },
    collect_name: { type: 'collect', field: { name: 'name', type: 'string', semanticType: 'person_name', required: true }, next: 'collect_city', prompt: { en: 'Your full name?', fr: 'Votre nom complet ?', ar: 'ما اسمك الكامل؟', darija: 'سميتك الكاملة عافاك؟' } },
    collect_city: { type: 'collect', field: 'city', next: 'collect_phone', prompt: { en: 'Which city and address?', fr: 'Quelle ville et adresse ?', ar: 'ما المدينة والعنوان؟', darija: 'المدينة والعنوان عافاك؟' } },
    collect_phone: { type: 'collect', field: { name: 'phone', type: 'phone', required: true }, next: 'done', prompt: { en: 'Your phone number?', fr: 'Votre numéro de téléphone ?', ar: 'رقم هاتفك؟', darija: 'نمرة التيليفون ديالك؟' } },
    done: { type: 'end', prompt: { en: 'Thank you, our team will call you to confirm the order.', fr: 'Merci, notre équipe vous appellera pour confirmer la commande.', ar: 'شكرا، سيتصل بك فريقنا لتأكيد الطلب.', darija: 'شكرا، غادي يعيط ليك الفريق ديالنا باش يأكد الطلب.' } }
  }
};

const bookingWorkflow = {
  id: 'booking', name: 'Demande de rendez-vous', description: 'Collect an appointment request; the team confirms the time slot.',
  initialState: 'collect_service', allowInterruption: true,
  activation: { mode: 'explicit_intent', keywords: ['réserver', 'prendre rendez-vous', 'book a', 'make an appointment', 'حجز موعد', 'نحجز', 'ناخد موعد', 'n7jez', 'bghit rdv'] },
  outcome: { type: 'BOOKING_CONFIRMED' },
  states: {
    collect_service: { type: 'collect', field: 'service', next: 'collect_slot', prompt: { en: 'Which service would you like to book?', fr: 'Quelle prestation souhaitez-vous réserver ?', ar: 'ما الخدمة التي تريد حجزها؟', darija: 'شنو الخدمة اللي بغيتي تحجزي؟' } },
    collect_slot: { type: 'collect', field: 'preferred_time', next: 'collect_name', prompt: { en: 'Which day and time suit you?', fr: 'Quel jour et quelle heure vous conviennent ?', ar: 'ما اليوم والوقت المناسبان لك؟', darija: 'أشمن نهار ووقت كيناسبك؟' } },
    collect_name: { type: 'collect', field: { name: 'name', type: 'string', semanticType: 'person_name', required: true }, next: 'collect_phone', prompt: { en: 'Your full name?', fr: 'Votre nom complet ?', ar: 'ما اسمك الكامل؟', darija: 'سميتك الكاملة عافاك؟' } },
    collect_phone: { type: 'collect', field: { name: 'phone', type: 'phone', required: true }, next: 'confirm', prompt: { en: 'Your phone number?', fr: 'Votre numéro de téléphone ?', ar: 'رقم هاتفك؟', darija: 'نمرة التيليفون ديالك؟' } },
    confirm: { type: 'confirm', prompt: { en: 'Do you confirm this appointment request? Our team will confirm the time by WhatsApp.', fr: 'Vous confirmez cette demande de rendez-vous ? Notre équipe vous confirmera le créneau par WhatsApp.', ar: 'هل تؤكد طلب الموعد؟ سيؤكد فريقنا الوقت عبر واتساب.', darija: 'واش كتأكدي طلب الموعد؟ الفريق ديالنا غادي يأكد معاك الوقت فواتساب.' },
      confirmKeywords: ['oui', 'yes', 'نعم', 'واخا', 'wakha', 'ok', 'iyeh', 'eh'], cancelKeywords: ['non', 'no', 'لا', 'la'], transitions: [{ target: 'done' }] },
    done: { type: 'end', prompt: { en: 'Thank you! Your request is recorded; our team will confirm the time by WhatsApp.', fr: 'Merci ! Votre demande est enregistrée ; notre équipe vous confirmera le créneau par WhatsApp.', ar: 'شكرا! تم تسجيل طلبك وسيؤكد فريقنا الوقت عبر واتساب.', darija: 'شكرا! تسجل الطلب ديالك والفريق غادي يأكد معاك الوقت فواتساب.' } }
  }
};

async function setupProfile(profile: Profile) {
  const tenantId = tenantOf(profile), accountId = accountOf(profile);
  const commerce = isCommerce(profile);
  await prisma.tenant.upsert({ where: { id: tenantId }, update: { name: `Eval 10k ${profile}` }, create: { id: tenantId, name: `Eval 10k ${profile}` } });
  const data: any = commerce ? {
    name: STORE.name, email: 'contact@atlasmode.example', phone: '+212600000000', website: '', description: STORE.description,
    address: STORE.address, hours: STORE.hours, currency: 'MAD', policies: STORE.policies,
    faqs: STORE.faqs.map((f, i) => ({ id: `faq-${i}`, ...f })), products: [], services: []
  } : {
    name: SERVICE_STORE.name, email: 'contact@spanakhil.example', phone: '+212600000001', website: '', description: SERVICE_STORE.description,
    address: SERVICE_STORE.address, hours: SERVICE_STORE.hours, currency: 'MAD', policies: SERVICE_STORE.policies, faqs: [], products: [],
    services: SERVICE_STORE.services.map(s => ({ name: s.name, description: s.description, price: `${s.price} MAD`, availability: '' }))
  };
  const workflows = hasWorkflow(profile) ? (commerce ? { cod_order: orderWorkflow } : { booking: bookingWorkflow }) : {};
  const config: any = compileBusiness(data, {}, { workflows });
  config.capabilities.ecommerceEnabled = commerce;
  config.capabilities.imageEnabled = commerce;
  config.productMode = commerce ? 'COMMERCE' : 'STANDARD';
  config.portalManaged = false; // spend gate covered by its own tests
  config.identity.language = 'fr';
  config.knowledge.enabled = false;
  config.behavior.allowHumanHandoff = true;
  await prisma.tenantConfig.upsert({ where: { tenantId }, update: { config, updatedAt: new Date() }, create: { tenantId, config, updatedAt: new Date() } });
  await prisma.account.upsert({ where: { id: accountId }, update: { tenantId, name: data.name, enabled: true, config }, create: { id: accountId, tenantId, name: data.name, enabled: true, config } });
  await prisma.productVariant.deleteMany({ where: { product: { tenantId, accountId } } });
  await prisma.product.deleteMany({ where: { tenantId, accountId } });
  if (!commerce) return;
  for (const p of STORE.products) {
    const images = p.image ? [imageUrlFor(p.key)] : [];
    await prisma.product.create({ data: {
      tenantId, accountId, sku: p.sku, name: p.name, description: p.description, price: p.price, currency: 'MAD', stock: p.stock, active: true, category: p.category, metadata: { images },
      variants: { create: p.variants.map((v, i) => ({ sku: `${p.sku}-${i}`, size: v.size, color: v.color, stock: v.stock, active: true, metadata: { images } })) }
    } });
  }
}

type Turn = TurnResult & { customer: string; status: string | null; quality: string[] };
const NOT_ANSWERABLE = new Set(['unknown', 'svcUnknown', 'greeting', 'human', 'svcSlot', 'discount', 'svcDiscount']);

async function runCase(deps: ReturnType<typeof bootstrapChatbot>, c: Case10k) {
  const tenantId = tenantOf(c.profile), accountId = accountOf(c.profile);
  const customer = `eval10k-${c.id}-${randomUUID().slice(0, 8)}`;
  const turns: Turn[] = [];
  const failures: string[] = [];
  const llm: any[] = [];
  const started = Date.now();
  const catalog = isCommerce(c.profile) ? COMMERCE_CATALOG : SERVICE_CATALOG_TEXT;
  const off = telemetry.onEvent((event: any) => { if (event.eventType === 'llm_usage') llm.push(event.metadata); });
  const send = async (text: string) => {
    const store = { media: [] as any[] };
    const reply = String(await outboundMediaContext.run(store, () => deps.conversationEngine.handleMessage(tenantId, customer, text, accountId)) ?? '');
    const rows = await prisma.$queryRaw<any[]>`SELECT ws.status FROM "WorkflowSession" ws JOIN "Conversation" c ON c.id = ws."conversationId"
      JOIN "Customer" cu ON cu.id = c."customerId" WHERE cu."externalId" = ${customer} AND cu."tenantId" = ${tenantId} ORDER BY ws."createdAt" DESC LIMIT 1`;
    const status = rows[0]?.status ?? null;
    const multiTopic = /\b(?:and|et|w)\b|و(?:شحال|كم)/iu.test(text) && c.intent.toLowerCase().includes('multi');
    const turn: Turn = { customer: text, reply, media: store.media.map((m: any) => ({ type: m.type, url: m.url })), workflowActive: status === 'ACTIVE', status,
      quality: replyQualityIssues(reply, { lang: c.lang, turnIndex: turns.length, catalogText: catalog, answerable: !NOT_ANSWERABLE.has(c.intent) && !c.flow, multiTopic }) };
    turns.push(turn);
    return turn;
  };
  try {
    if (!c.flow) {
      for (const text of c.turns) await send(text);
      failures.push(...singleTurnFailures(c, turns));
    } else {
      await runFlow(c, send, failures);
    }
    if (!hasWorkflow(c.profile) && turns.some(t => t.status)) failures.push('a workflow started on a bot without workflows');
  } catch (cause: any) { failures.push(`error: ${cause?.message || cause}`); }
  finally { off(); }
  const quality = [...new Set(turns.flatMap((t, i) => t.quality.map(q => (turns.length > 1 ? `turn ${i + 1}: ` : '') + q)))];
  return {
    id: c.id, profile: c.profile, intent: c.intent, lang: c.lang, flow: c.flow ? { ...c.flow } : undefined,
    transcript: turns.map(t => ({ customer: t.customer, bot: t.reply, media: t.media.map(m => m.url), status: t.status })),
    failures, quality, passed: failures.length === 0 && quality.length === 0, factsOk: failures.length === 0,
    latencyMs: Date.now() - started, llmCalls: llm.length, llmFailures: llm.filter(x => x?.success === false).length
  };
}

function singleTurnFailures(c: Case10k, turns: TurnResult[]): string[] {
  const last = turns.at(-1)!;
  const failures = isCommerce(c.profile)
    ? judge({ id: c.id, intent: c.intent, lang: c.lang, turns: c.turns, expect: c.expect }, turns).failures
    : judgeService(c.expect, c.lang, last.reply, c.turns.at(-1)!, last.workflowActive);
  if (['orderNoWf', 'orderDetailsNoWf', 'svcBookNoWf'].includes(c.expect.kind) && /I don't have that information|je n[’']ai pas cette information|لا تتوفر لدي|ما عنديش هاد المعلومة|ma3ndich had lme3louma/iu.test(last.reply)) failures.push('dead-end reply to a purchase/booking request');
  return failures;
}

function qualityOf(c: Case10k, replies: string[], customers: string[]): string[] {
  const catalog = isCommerce(c.profile) ? COMMERCE_CATALOG : SERVICE_CATALOG_TEXT;
  const issues = replies.flatMap((reply, i) => {
    const multiTopic = /\b(?:and|et|w)\b|و(?:شحال|كم)/iu.test(customers[i] || '') && c.intent.toLowerCase().includes('multi');
    return replyQualityIssues(reply, { lang: c.lang, turnIndex: i, catalogText: catalog, answerable: !NOT_ANSWERABLE.has(c.intent) && !c.flow, multiTopic })
      .map(q => (replies.length > 1 ? `turn ${i + 1}: ` : '') + q);
  });
  return [...new Set(issues)];
}

/** Re-apply the current checks to a stored conversation (no bot calls). */
function rejudgeStored(r: any, c: Case10k) {
  const replies = r.transcript.map((t: any) => t.bot || '');
  const customers = r.transcript.map((t: any) => t.customer);
  let failures: string[] = r.failures;
  if (!c.flow && !r.failures.some((f: string) => f.startsWith('error:'))) {
    const turns: TurnResult[] = r.transcript.map((t: any) => ({ reply: t.bot || '', media: (t.media || []).map((url: string) => ({ type: 'image', url })), workflowActive: t.status === 'ACTIVE' }));
    failures = singleTurnFailures(c, turns);
    if (!hasWorkflow(c.profile) && r.transcript.some((t: any) => t.status)) failures.push('a workflow started on a bot without workflows');
  }
  const quality = qualityOf(c, replies, customers);
  return { ...r, failures, quality, factsOk: failures.length === 0, passed: failures.length === 0 && quality.length === 0 };
}

async function runFlow(c: Case10k, send: (text: string) => Promise<Turn>, failures: string[]) {
  const flow = c.flow!;
  const catalog = isCommerce(c.profile) ? COMMERCE_CATALOG : SERVICE_CATALOG_TEXT;
  let last = await send(c.turns[0]);
  if (last.status !== 'ACTIVE') { failures.push(`${flow.kind} workflow did not start`); return; }
  let lastQuestion: Field | null = askedField(last.reply);
  let interrupt = flow.interrupt, cancel = flow.cancelText, repeats = 0, previous: Field | null = null;
  const langIssue = (t: Turn, label: string) => { const l = languageOk(c.lang, t.reply, catalog); if (l) failures.push(`${label}: ${l}`); };
  langIssue(last, 'turn 1');
  for (let step = 0; step < 9; step++) {
    if (last.status !== 'ACTIVE') break;
    if (cancel) {
      const t = await send(cancel); cancel = undefined;
      if (t.status === 'ACTIVE') failures.push('cancel request did not stop the workflow');
      if (!t.reply.trim()) failures.push('no reply to the cancel request');
      else langIssue(t, 'cancel reply');
      return;
    }
    if (interrupt) {
      const t = await send(interrupt.text);
      const facts = isCommerce(c.profile)
        ? judge({ id: c.id, intent: 'fee', lang: c.lang, turns: [interrupt.text], expect: interrupt.expect }, [t]).failures
        : judgeService(interrupt.expect, c.lang, t.reply, interrupt.text, t.workflowActive);
      failures.push(...facts.map(f => `mid-flow question: ${f}`));
      if (t.status !== 'ACTIVE') failures.push('mid-flow question ended the workflow');
      interrupt = undefined; last = t;
      lastQuestion = askedField(t.reply) || lastQuestion;
      continue;
    }
    const field = askedField(last.reply) || lastQuestion;
    if (!field) { failures.push(`unclear workflow question: "${last.reply.slice(0, 80)}"`); return; }
    repeats = field === previous ? repeats + 1 : 0; previous = field;
    if (repeats >= 2) { failures.push(`bot asked for ${field} three times`); return; }
    last = await send(answerFor(field, c.lang, flow));
    lastQuestion = askedField(last.reply) || field;
    langIssue(last, `turn ${step + 2}`);
  }
  if (last.status !== 'COMPLETED') failures.push(`${flow.kind} did not complete (status ${last.status}, last bot message "${last.reply.slice(0, 70)}")`);
  else if (!last.reply.trim()) failures.push('no closing message after the last answer');
}

function tally<T>(rows: T[], key: (r: T) => string, ok: (r: T) => boolean) {
  const out: Record<string, { total: number; passed: number }> = {};
  for (const r of rows) { const k = key(r); (out[k] ??= { total: 0, passed: 0 }).total++; if (ok(r)) out[k].passed++; }
  return out;
}
const pct = (x: { total: number; passed: number }) => `${x.passed}/${x.total} (${(100 * x.passed / Math.max(1, x.total)).toFixed(1)}%)`;
const reason = (f: string) => f.replace(/^turn \d+: /, '').replace(/\(.*?\)|"[^"]*"|\d+(?:\.\d+)?/g, '#').replace(/: .*/, '').trim();

async function main() {
  if (!process.env.DEEPSEEK_API_KEY) throw new Error('DEEPSEEK_API_KEY missing; evaluation did not run');
  mkdirSync('docs/evaluations', { recursive: true });
  let corpus = build10kCorpus();
  const profiles = (process.env.EVAL_PROFILE || '').split(',').filter(Boolean);
  if (profiles.length) corpus = corpus.filter(c => profiles.includes(c.profile));
  const only = new Set((process.env.EVAL_ONLY || '').split(',').filter(Boolean));
  if (only.size) corpus = corpus.filter(c => only.has(c.intent) || only.has(c.id));
  if (process.env.EVAL_LIMIT) {
    const limit = Number(process.env.EVAL_LIMIT);
    corpus = PROFILES.flatMap(p => corpus.filter(c => c.profile === p).filter((_, i, all) => i % Math.max(1, Math.floor(all.length / limit)) === 0).slice(0, limit));
  }
  const jsonl = `${OUT}.jsonl`;
  if (process.env.EVAL_FRESH === '1' && existsSync(jsonl)) writeFileSync(jsonl, '');
  const done = new Map<string, any>();
  if (existsSync(jsonl)) for (const line of readFileSync(jsonl, 'utf8').split('\n')) if (line.trim()) { const r = JSON.parse(line); done.set(r.id, r); }
  if (process.env.EVAL_RERUN === 'failed') for (const [id, r] of done) if (!r.passed) done.delete(id);
  const todo = corpus.filter(c => !done.has(c.id));
  for (const p of PROFILES) if (corpus.some(c => c.profile === p)) await setupProfile(p);
  const deps = bootstrapChatbot(prisma);
  const concurrency = Number(process.env.EVAL_CONCURRENCY || 16);
  let next = 0, finished = 0;
  const t0 = Date.now();
  console.log(`running ${todo.length} of ${corpus.length} conversations (${corpus.length - todo.length} already done)`);
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < todo.length) {
      const c = todo[next++];
      const r = await runCase(deps, c);
      done.set(r.id, r);
      appendFileSync(jsonl, JSON.stringify(r) + '\n');
      finished++;
      if (!r.passed || finished % 50 === 0) {
        const eta = Math.round((Date.now() - t0) / finished * (todo.length - finished) / 60000);
        console.log(`${finished}/${todo.length} ~${eta}min ${r.passed ? 'PASS' : 'FAIL'} ${r.id} | ${r.transcript.at(-1)?.customer} => ${(r.transcript.at(-1)?.bot || '').replace(/\s+/g, ' ').slice(0, 120)}${r.passed ? '' : ' | ' + [...r.failures, ...r.quality].join('; ')}`);
      }
    }
  }));
  const results = corpus.map(c => done.get(c.id)).filter(Boolean);
  writeReport(results);
}

function writeReport(results: any[]) {
  const langName: Record<string, string> = { en: 'English', fr: 'French', ar: 'Arabic (MSA)', da: 'Darija (Arabic script)', dz: 'Darija (Arabizi)' };
  const profileName: Record<string, string> = { ecom_wf: 'E-commerce + order workflow', ecom_nowf: 'E-commerce, no workflow', svc_wf: 'Service + booking workflow', svc_nowf: 'Service, no workflow' };
  const sections: string[] = [];
  const summary: any = { cases: results.length, passed: results.filter(r => r.passed).length, factsOk: results.filter(r => r.factsOk).length, cleanWriting: results.filter(r => !r.quality.length).length, profiles: {} };
  for (const p of PROFILES) {
    const rows = results.filter(r => r.profile === p);
    if (!rows.length) continue;
    const failures: Record<string, number> = {}, quality: Record<string, number> = {};
    for (const r of rows) { for (const f of r.failures) failures[reason(f)] = (failures[reason(f)] || 0) + 1; for (const q of r.quality) quality[reason(q)] = (quality[reason(q)] || 0) + 1; }
    const flows = rows.filter(r => r.flow);
    summary.profiles[p] = { cases: rows.length, passed: rows.filter(r => r.passed).length, factsOk: rows.filter(r => r.factsOk).length, cleanWriting: rows.filter(r => !r.quality.length).length,
      flows: flows.length, flowsOk: flows.filter(r => r.factsOk).length, byLang: tally(rows, r => r.lang, r => r.passed), failures, quality };
    const lat = rows.map(r => r.latencyMs / Math.max(1, r.transcript.length)).sort((a, b) => a - b);
    sections.push(`## ${profileName[p]} — ${pct({ total: rows.length, passed: summary.profiles[p].passed })}`, '',
      `- Correct facts and flow: ${pct({ total: rows.length, passed: summary.profiles[p].factsOk })}`,
      `- Clean writing (no quality issue on any turn): ${pct({ total: rows.length, passed: summary.profiles[p].cleanWriting })}`,
      ...(flows.length ? [`- Complete ${p.startsWith('ecom') ? 'order' : 'booking'} flows: ${pct({ total: flows.length, passed: summary.profiles[p].flowsOk })}`] : []),
      `- Reply time per turn: p50 ${Math.round(lat[Math.floor(lat.length * .5)])} ms, p95 ${Math.round(lat[Math.floor(lat.length * .95)])} ms`, '',
      '| Language | Passed |', '|---|---|', ...LANGS.map(l => `| ${langName[l]} | ${pct(summary.profiles[p].byLang[l] || { total: 0, passed: 0 })} |`), '',
      '| Question type | Passed |', '|---|---|', ...Object.entries(tally(rows, r => r.intent, r => r.passed)).map(([k, x]) => `| ${k} | ${pct(x)} |`), '',
      '**Fact / flow problems:** ' + (Object.entries(failures).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} (${n})`).join('; ') || 'none'), '',
      '**Writing problems:** ' + (Object.entries(quality).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} (${n})`).join('; ') || 'none'), '');
  }
  const show = (r: any) => `### ${r.id}\n\n${r.transcript.map((t: any) => `- Customer: ${t.customer}\n- Bot: ${(t.bot || '(no reply)').replace(/\n+/g, ' ')}${t.media?.length ? `\n- Media: ${t.media.join(', ')}` : ''}`).join('\n')}${r.passed ? '' : `\n- Problems: ${[...r.failures, ...r.quality].join('; ')}`}`;
  writeFileSync(`${OUT}.json`, JSON.stringify({ scope: 'Fictional Moroccan store and spa; real bootstrap + DeepSeek; isolated test DB.', summary, results }, null, 1));
  writeFileSync(`${OUT}.md`, [
    `# Moroccan chatbot evaluation — ${results.length} conversations, 4 bot types`, '',
    `Overall: **${pct({ total: results.length, passed: summary.passed })}** passed every check. Correct facts/flows: ${pct({ total: results.length, passed: summary.factsOk })}. Clean writing: ${pct({ total: results.length, passed: summary.cleanWriting })}.`, '',
    'Fictional businesses, isolated test database, live DeepSeek, no WhatsApp. Facts checked automatically against the business data; writing checked for leaked internals, formatting, repetition, language/script mixing and re-greeting.', '',
    ...sections, '## Failed conversations (up to 60 per bot type)', '',
    ...PROFILES.flatMap(p => results.filter(r => r.profile === p && !r.passed).slice(0, 60).map(show))
  ].join('\n'));
  // A readable sample of full conversations for human review.
  const sample = PROFILES.flatMap(p => { const rows = results.filter(r => r.profile === p); return rows.filter((_, i) => i % Math.max(1, Math.floor(rows.length / 25)) === 0).slice(0, 25); });
  writeFileSync(`${OUT}-sample-transcripts.md`, ['# Sample conversations (25 per bot type, evenly spread)', '', ...sample.map(show)].join('\n'));
  console.log(JSON.stringify({ ...summary, profiles: Object.fromEntries(Object.entries(summary.profiles).map(([k, v]: any) => [k, { cases: v.cases, passed: v.passed, factsOk: v.factsOk, cleanWriting: v.cleanWriting, flows: v.flows, flowsOk: v.flowsOk, failures: v.failures, quality: v.quality }])) }, null, 2));
}

if (process.env.EVAL_REPORT_ONLY === '1') {
  const rows = readFileSync(`${OUT}.jsonl`, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const latest = new Map(rows.map(r => [r.id, r]));
  writeReport(build10kCorpus().filter(c => latest.has(c.id)).map(c => rejudgeStored(latest.get(c.id), c)));
  process.exit(0);
} else {
  void main().then(() => process.exit(0)).catch(error => { console.error(error?.stack || error); process.exit(1); });
}
