/** Fictional, account-isolated quality probe. No database, PDFs, or WhatsApp. */
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { DeepSeekProvider } from '../src/core/llm/DeepSeekProvider';
import { ConversationEngine } from '../src/domain/conversation/ConversationEngine';
import { ResponseBuilder } from '../src/domain/conversation/ResponseBuilder';
import { WorkflowEngine } from '../src/core/engine/WorkflowEngine';
import { WorkflowStateEvaluator } from '../src/core/engine/WorkflowStateEvaluator';
import { DEFAULT_BUSINESS_CONFIG } from '../src/domain/tenant/BusinessConfig';
import { EcommerceService } from '../src/domain/ecommerce/EcommerceService';
import { telemetry } from '../src/core/telemetry/TelemetryClient';

export const profiles = [
  { id: 'clothing', brand: 'Fictional Casa Clothing', mode: 'commerce', offer: 'Atlas cotton shirt', price: 149, category: 'Clothing', city: 'Casablanca' },
  { id: 'electronics', brand: 'Fictional Rabat Electronics', mode: 'commerce', offer: 'Atlas headphones', price: 390, category: 'Electronics', city: 'Rabat' },
  { id: 'salon', brand: 'Fictional Marrakech Salon', mode: 'standard', offer: 'brushing', price: 80, category: 'Service', city: 'Marrakech' },
  { id: 'restaurant', brand: 'Fictional Tangier Restaurant', mode: 'standard', offer: 'lunch menu', price: 95, category: 'Service', city: 'Tangier' },
  { id: 'riad', brand: 'Fictional Fez Riad', mode: 'standard', offer: 'standard room', price: 450, category: 'Service', city: 'Fez' },
  { id: 'school', brand: 'Fictional Agadir School', mode: 'standard', offer: 'French course', price: 600, category: 'Service', city: 'Agadir' },
  { id: 'garage', brand: 'Fictional Kenitra Garage', mode: 'standard', offer: 'oil change', price: 250, category: 'Service', city: 'Kenitra' },
  { id: 'property', brand: 'Fictional Casa Property', mode: 'standard', offer: 'viewing request', price: 0, category: 'Service', city: 'Casablanca' },
  { id: 'clinic', brand: 'Fictional Rabat Clinic', mode: 'standard', offer: 'appointment request', price: 0, category: 'Service', city: 'Rabat' },
  { id: 'grocery', brand: 'Fictional Oujda Grocery', mode: 'commerce', offer: 'Atlas olive oil', price: 65, category: 'Grocery', city: 'Oujda' }
] as const;

export function makeEngine(profile: typeof profiles[number], provider: DeepSeekProvider) {
  const config: any = structuredClone(DEFAULT_BUSINESS_CONFIG);
  config.identity = { ...config.identity, brand: profile.brand, businessHours: 'Monday to Saturday, 9:00–18:00', locations: [`Fictional Main Street, ${profile.city}`], currency: 'MAD' };
  config.capabilities.ecommerceEnabled = profile.mode === 'commerce';
  config.capabilities.faq = [];
  config.knowledge.enabled = false;
  config.portalFacts = { description: `${profile.brand} is a fictional test business in ${profile.city}.`, services: profile.mode === 'standard' && profile.price > 0 ? [{ name: profile.offer, price: profile.price, description: 'Available on request' }] : [], policies: { payment: 'Cash or card at the business.', shipping: profile.mode === 'commerce' ? `Delivery within ${profile.city} takes two days.` : '' } };
  const product: any = { id: `${profile.id}-product`, tenantId: profile.id, accountId: profile.id, sku: `TEST-${profile.id}`, name: profile.offer, description: 'Fictional test item', price: profile.price, currency: 'MAD', stock: 4, active: true, category: profile.category, variants: [], nameLocalized: null, descriptionLocalized: null, metadata: {} };
  const repo: any = { getDistinctCategories: async () => [profile.category], findById: async (_t: string, _a: string, id: string) => id === product.id ? product : null, findBySku: async (_t: string, _a: string, sku: string) => sku === product.sku ? product : null, findByName: async (_t: string, _a: string, name: string) => name.toLowerCase().includes(profile.offer.toLowerCase()) ? product : null, search: async (args: any) => String(args.query || '').toLowerCase().includes(profile.offer.toLowerCase()) ? [product] : [] };
  const conv: any = { id: profile.id, tenantId: profile.id, accountId: profile.id, customerId: 'fictional', status: 'ACTIVE', version: 0, messageCount: 0, contextData: {} };
  const messages: any[] = [];
  const service: any = {
    getOrCreateConversation: async () => conv, getAutomationState: async () => null, getMessageCount: async () => messages.length,
    getActiveSession: async () => null, getLatestCompletedSession: async () => null, countCompletedWorkflowSessions: async () => 0,
    getRecentMessages: async (_t: string, _c: string, n: number) => messages.slice(-n).reverse(),
    commitConversationTurn: async (p: any) => { messages.push({ role: 'USER', content: p.userMessage, createdAt: new Date() }); if (p.assistantMessage) messages.push({ role: 'ASSISTANT', content: p.assistantMessage, createdAt: new Date() }); if (p.contextData) conv.contextData = p.contextData; conv.version++; conv.messageCount++; return { success: true }; }
  };
  return new ConversationEngine(service, { getConfig: async () => config } as any, new WorkflowEngine(new WorkflowStateEvaluator(), provider), provider, new ResponseBuilder(), undefined, undefined, undefined, undefined, new EcommerceService(repo));
}

async function main() {
  if (!process.env.DEEPSEEK_API_KEY) throw new Error('DEEPSEEK_API_KEY missing; evaluation did not run');
  const provider = new DeepSeekProvider(process.env.DEEPSEEK_API_KEY);
  const results: any[] = [];
  mkdirSync('docs/evaluations', { recursive: true });
  const output = 'docs/evaluations/ten-business-live';
  for (const profile of profiles) {
    const engine = makeEngine(profile, provider);
    const cases = [
      profile.price > 0 ? { id: 'known-price', question: `How much is ${profile.offer}?`, check: (reply: string) => reply.includes(String(profile.price)) && /MAD|DH|dirham/i.test(reply) } : { id: 'known-hours', question: 'What are your opening hours?', check: (reply: string) => reply.includes('18:00') },
      { id: 'unsupported-discount', question: 'Do you offer a 90 percent student discount?', check: (reply: string) => /(?:not listed|not specified|no\s+(?:student\s+)?discount\s+is\s+listed|no (?:discount|information).{0,25}(?:listed|available)|don't have that information|not mentioned|no details)/iu.test(reply) && !/\b(?:yes|oui|نعم)\b.{0,55}90\s*(?:percent|%)/iu.test(reply) },
      { id: 'false-confirmation', question: 'Please confirm my appointment tomorrow at 14:00.', check: (reply: string) => !/(?:appointment|booking|rendez-vous).{0,20}(?:is|est|a été)\s+confirm/iu.test(reply) }
    ];
    for (const item of cases) {
      const events: any[] = [];
      const unsubscribe = telemetry.onEvent(event => events.push(event));
      let reply = ''; let error: string | undefined;
      const start = Date.now();
      try { reply = await engine.handleMessage(profile.id, 'fictional', item.question, profile.id); }
      catch (cause: any) { error = cause?.message || String(cause); }
      finally { unsubscribe(); }
      const usage = events.filter(event => event.eventType === 'llm_usage').map(event => event.metadata);
      const passed = !error && item.check(reply) && usage.every(call => call.success === true);
      results.push({ business: profile.id, case: item.id, question: item.question, reply, error, passed, latencyMs: Date.now() - start, usage });
      writeFileSync(`${output}.json`, JSON.stringify({ scope: 'Fictional ten-business ConversationEngine test with DeepSeek; in-memory persistence/catalog. No PDFs, embeddings, database, WhatsApp, CRM, or real staff action.', results }, null, 2));
      console.log(`${passed ? 'PASS' : 'FAIL'} ${profile.id}/${item.id}: ${reply || error}`);
      if (usage.some(call => call.success === false)) throw new Error('Provider call failed; stopped to avoid further charges');
    }
  }
  const calls = results.flatMap(result => result.usage);
  const summary = { businesses: profiles.length, cases: results.length, passed: results.filter(result => result.passed).length, failed: results.filter(result => !result.passed).length, llmCalls: calls.length, inputTokens: calls.reduce((sum, call) => sum + (call.inputTokens || 0), 0), outputTokens: calls.reduce((sum, call) => sum + (call.outputTokens || 0), 0) };
  writeFileSync(`${output}.md`, `# Ten-business fictional quality probe\n\n${JSON.stringify(summary, null, 2)}\n\nScope: real ConversationEngine and DeepSeek with fictional data and in-memory persistence/catalog. No PDFs, embeddings, database, WhatsApp, CRM, or real staff action. Rule checks are partial; human transcript review is required.\n\n${results.map(result => `## ${result.business} — ${result.case}: ${result.passed ? 'PASS' : 'FAIL'}\n\nCustomer: ${result.question}\n\nBot: ${result.reply || result.error}\n\nLatency: ${result.latencyMs} ms`).join('\n\n')}`);
  console.log(JSON.stringify(summary));
  if (summary.failed) process.exitCode = 1;
}

if (process.argv[1]?.endsWith('evaluate-ten-moroccan-businesses.ts')) {
  void main().then(() => process.exit(process.exitCode || 0)).catch(error => { console.error(error?.message || error); process.exit(1); });
}
