/**
 * 1000 fictional Moroccan WhatsApp commerce conversations through the real
 * bootstrap (ConversationEngine, product repository, workflows, live DeepSeek)
 * against the isolated TEST_DATABASE_URL. Product photos use the published
 * image URL shape. No real customer data, WhatsApp, or production database.
 *
 *   npx tsx scripts/evaluate-moroccan-commerce-1000.ts
 *   EVAL_ONLY=photo,fee EVAL_LIMIT=50 EVAL_CONCURRENCY=6 npx tsx scripts/evaluate-moroccan-commerce-1000.ts
 *   EVAL_RERUN=failed   (re-run only the cases that failed in the last report)
 */
import 'dotenv/config';
process.env.PORTAL_ENABLED = 'false';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/tests/testDb';
import { bootstrapChatbot } from '../src/bootstrap';
import { outboundMediaContext } from '../src/domain/conversation/AnswerComposer';
import { compileBusiness } from '../src/portal/validation';
import { telemetry } from '../src/core/telemetry/TelemetryClient';
import { buildCorpus, EvalCase, STORE, imageUrlFor, LANGS } from './eval/moroccanCommerceCorpus';
import { judge, TurnResult } from './eval/moroccanCommerceChecks';

const TENANT_ID = 'eval-moroccan-commerce';
const ACCOUNT_ID = 'eval-moroccan-commerce-store';
const OUT = process.env.EVAL_OUT || 'docs/evaluations/moroccan-commerce-1000';

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

async function setupStore() {
  await prisma.tenant.upsert({ where: { id: TENANT_ID }, update: { name: 'Eval Moroccan Commerce' }, create: { id: TENANT_ID, name: 'Eval Moroccan Commerce' } });
  const data: any = {
    name: STORE.name, email: 'contact@atlasmode.example', phone: '+212600000000', website: '', description: STORE.description,
    address: STORE.address, hours: STORE.hours, currency: 'MAD', policies: STORE.policies,
    faqs: STORE.faqs.map((f, i) => ({ id: `faq-${i}`, ...f })), products: [], services: []
  };
  const config: any = compileBusiness(data, {}, { workflows: { cod_order: orderWorkflow } });
  config.capabilities.ecommerceEnabled = true;
  config.capabilities.imageEnabled = true;
  config.productMode = 'COMMERCE';
  // Same compiled config as a published portal store, minus the portal spend
  // gate (budgets are covered by their own tests, not answer quality).
  config.portalManaged = false;
  config.identity.language = 'fr';
  config.knowledge.enabled = false;
  await prisma.tenantConfig.upsert({ where: { tenantId: TENANT_ID }, update: { config, updatedAt: new Date() }, create: { tenantId: TENANT_ID, config, updatedAt: new Date() } });
  await prisma.account.upsert({
    where: { id: ACCOUNT_ID },
    update: { tenantId: TENANT_ID, name: STORE.name, enabled: true, config },
    create: { id: ACCOUNT_ID, tenantId: TENANT_ID, name: STORE.name, enabled: true, config }
  });
  await prisma.productVariant.deleteMany({ where: { product: { tenantId: TENANT_ID, accountId: ACCOUNT_ID } } });
  await prisma.product.deleteMany({ where: { tenantId: TENANT_ID, accountId: ACCOUNT_ID } });
  for (const p of STORE.products) {
    const images = p.image ? [imageUrlFor(p.key)] : [];
    await prisma.product.create({ data: {
      tenantId: TENANT_ID, accountId: ACCOUNT_ID, sku: p.sku, name: p.name, description: p.description, price: p.price,
      currency: 'MAD', stock: p.stock, active: true, category: p.category, metadata: { images },
      variants: { create: p.variants.map((v, i) => ({ sku: `${p.sku}-${i}`, size: v.size, color: v.color, stock: v.stock, active: true, metadata: { images } })) }
    } });
  }
}

async function runCase(deps: ReturnType<typeof bootstrapChatbot>, c: EvalCase) {
  const customer = `eval-${c.id}-${randomUUID().slice(0, 8)}`;
  const turns: TurnResult[] = [];
  const llm: any[] = [];
  const started = Date.now();
  let error: string | undefined;
  const off = telemetry.onEvent((event: any) => { if (event.eventType === 'llm_usage' && event.metadata?.tenantId !== 'x') llm.push(event.metadata); });
  try {
    for (const text of c.turns) {
      const store = { media: [] as any[] };
      const reply = await outboundMediaContext.run(store, () => deps.conversationEngine.handleMessage(TENANT_ID, customer, text, ACCOUNT_ID));
      const active = await prisma.$queryRaw<any[]>`SELECT ws.id FROM "WorkflowSession" ws JOIN "Conversation" c ON c.id = ws."conversationId"
        JOIN "Customer" cu ON cu.id = c."customerId" WHERE cu."externalId" = ${customer} AND cu."tenantId" = ${TENANT_ID} AND ws.status = 'ACTIVE' LIMIT 1`;
      turns.push({ reply: String(reply ?? ''), media: store.media.map((m: any) => ({ type: m.type, url: m.url })), workflowActive: active.length > 0 });
    }
  } catch (cause: any) { error = cause?.message || String(cause); }
  finally { off(); }
  const verdict = error ? { passed: false, failures: [`error: ${error}`] } : judge(c, turns);
  return { ...c, customer, replies: turns.map(t => t.reply), media: turns.map(t => t.media), workflowActive: turns.at(-1)?.workflowActive ?? false,
    ...verdict, latencyMs: Date.now() - started, llmCalls: llm.length, llmFailures: llm.filter(x => x.success === false).length };
}

async function main() {
  if (!process.env.DEEPSEEK_API_KEY) throw new Error('DEEPSEEK_API_KEY missing; evaluation did not run');
  mkdirSync('docs/evaluations', { recursive: true });
  let corpus = buildCorpus();
  const only = new Set((process.env.EVAL_ONLY || '').split(',').filter(Boolean));
  if (only.size) corpus = corpus.filter(c => only.has(c.intent) || only.has(c.id));
  if (process.env.EVAL_RERUN === 'failed' && existsSync(`${OUT}.json`)) {
    const failed = new Set((JSON.parse(readFileSync(`${OUT}.json`, 'utf8')).results as any[]).filter(r => !r.passed).map(r => r.id));
    corpus = corpus.filter(c => failed.has(c.id));
  }
  corpus = corpus.slice(0, Number(process.env.EVAL_LIMIT || corpus.length));
  await setupStore();
  const deps = bootstrapChatbot(prisma);
  const concurrency = Number(process.env.EVAL_CONCURRENCY || 6);
  const results: any[] = new Array(corpus.length);
  let next = 0, done = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < corpus.length) {
      const index = next++;
      results[index] = await runCase(deps, corpus[index]);
      done++;
      const r = results[index];
      console.log(`${done}/${corpus.length} ${r.passed ? 'PASS' : 'FAIL'} ${r.id} | ${r.turns.at(-1)} => ${(r.replies.at(-1) || '').replace(/\s+/g, ' ').slice(0, 140)}${r.passed ? '' : ' | ' + r.failures.join('; ')}`);
    }
  }));
  const byIntent: Record<string, { total: number; passed: number }> = {};
  const byLang: Record<string, { total: number; passed: number }> = {};
  const byFailure: Record<string, number> = {};
  for (const r of results) {
    (byIntent[r.intent] ??= { total: 0, passed: 0 }).total++; if (r.passed) byIntent[r.intent].passed++;
    (byLang[r.lang] ??= { total: 0, passed: 0 }).total++; if (r.passed) byLang[r.lang].passed++;
    for (const f of r.failures) { const k = f.replace(/\(.*?\)|\d+/g, '#').replace(/: .*/, ''); byFailure[k] = (byFailure[k] || 0) + 1; }
  }
  const latency = results.map(r => r.latencyMs).sort((a, b) => a - b);
  const summary = {
    cases: results.length, passed: results.filter(r => r.passed).length, failed: results.filter(r => !r.passed).length,
    passRate: +(100 * results.filter(r => r.passed).length / Math.max(1, results.length)).toFixed(1),
    llmCalls: results.reduce((s, r) => s + r.llmCalls, 0), p50LatencyMs: latency[Math.floor(latency.length * .5)], p95LatencyMs: latency[Math.floor(latency.length * .95)],
    byLang, byIntent, byFailure
  };
  writeFileSync(`${OUT}.json`, JSON.stringify({ scope: 'Fictional Moroccan commerce store; real bootstrap + DeepSeek; isolated test DB.', summary, results }, null, 2));
  const langName: Record<string, string> = { en: 'English', fr: 'French', ar: 'Arabic (MSA)', da: 'Darija (Arabic script)', dz: 'Darija (Arabizi)' };
  const pct = (x: { total: number; passed: number }) => `${x.passed}/${x.total} (${(100 * x.passed / x.total).toFixed(0)}%)`;
  writeFileSync(`${OUT}.md`, [
    `# Moroccan commerce chatbot evaluation — ${results.length} conversations`, '',
    `Pass rate: **${summary.passRate}%** (${summary.passed}/${summary.cases}). p50 ${summary.p50LatencyMs} ms, p95 ${summary.p95LatencyMs} ms, ${summary.llmCalls} LLM calls.`, '',
    'Automatic rule checks (price, stock, image, delivery fee/time, policy facts, reply language/script, invented amounts). Fictional store; isolated test database; no WhatsApp.', '',
    '## By language', '', ...LANGS.filter(l => byLang[l]).map(l => `- ${langName[l]}: ${pct(byLang[l])}`), '',
    '## By question type', '', ...Object.entries(byIntent).map(([k, x]) => `- ${k}: ${pct(x)}`), '',
    '## Failure reasons', '', ...Object.entries(byFailure).sort((a, b) => b[1] - a[1]).map(([k, n]) => `- ${k}: ${n}`), '',
    '## Failed conversations', '',
    ...results.filter(r => !r.passed).map(r => `### ${r.id}\n\n${r.turns.map((t: string, i: number) => `- Customer: ${t}\n- Bot: ${(r.replies[i] || '').replace(/\n+/g, ' ')}${r.media[i]?.length ? `\n- Media: ${r.media[i].map((m: any) => m.url).join(', ')}` : ''}`).join('\n')}\n- Problems: ${r.failures.join('; ')}`)
  ].join('\n'));
  console.log(JSON.stringify({ ...summary, byIntent: undefined, byFailure: summary.byFailure }, null, 2));
}

void main().then(() => process.exit(0)).catch(error => { console.error(error?.stack || error); process.exit(1); });
