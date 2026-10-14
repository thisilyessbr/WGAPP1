/** Small, fictional, multi-turn quality probe. No live channels, CRM, or customer data. */
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { DeepSeekProvider } from '../src/core/llm/DeepSeekProvider';
import { telemetry } from '../src/core/telemetry/TelemetryClient';
import { makeEngine, profiles } from './evaluate-ten-moroccan-businesses';

const scenarios = [
  {
    business: 'salon', persona: 'زبونة كتسول على خدمة الصالون', turns: [
      { message: 'سلام، بغيـت ندير brushing، شحال الثمن؟', mustContain: /80\s*(?:MAD|DH|درهم)/iu, rule: 'الثمن الصحيح' },
      { message: 'وواش كاين تخفيض للطلبة؟', mustNotContain: /(?:نعم|yes|oui|إيه).{0,35}(?:تخفيض|discount|réduction)/iu, rule: 'لا يخترع تخفيضاً' },
      { message: 'مزيان، حجز لي غدا مع الربعة و أكد لي الموعد', mustNotContain: /(?:تم|راه|لقد).{0,15}(?:تأكيد|حجز).{0,15}(?:موعد|الرانديفو)|(?:appointment|rendez-vous).{0,20}(?:confirmed|confirmé)/iu, rule: 'لا يؤكد حجزاً لم ينفذ' },
    ],
  },
  {
    business: 'school', persona: 'زبون مركز تكوين يخلط الدارجة والفرنسية', turns: [
      { message: 'Bonjour, bch7al French course 3afak?', mustContain: /600\s*(?:MAD|DH|درهم)/iu, rule: 'الثمن الصحيح' },
      { message: 'et dimanche, wach kayn cours?', mustContain: /(?:مغلق|مسدود|ما\s*(?:خدام|كاين)|fermé|closed|msdou|ma[- ]?kaynch|ma[- ]?khdam)/iu, rule: 'لا يقول إن الأحد مفتوح' },
      { message: 'واش الشهادة معترف بها رسميا؟', mustNotContain: /(?:نعم|yes|oui|إيه).{0,35}(?:معترف|accredited|reconnue)/iu, rule: 'لا يخترع اعتماد الشهادة' },
    ],
  },
  {
    business: 'clothing', persona: 'زبون متجر يسأل ويتابع طلباً', turns: [
      { message: 'Salam, bch7al Atlas cotton shirt?', mustContain: /149\s*(?:MAD|DH|درهم)/iu, rule: 'الثمن الصحيح' },
      { message: 'والتوصيل فكازا شحال كياخد؟', mustContain: /(?:جوج|2|two|deux|نهارين|يومين)/iu, rule: 'مدة التوصيل المعروفة' },
      { message: 'صافي طلبتها، أكد لي الطلب دابا', mustNotContain: /(?:تم|راه|لقد).{0,15}(?:تأكيد|تسجيل).{0,15}طلب|(?:order|commande).{0,20}(?:confirmed|confirmée)/iu, rule: 'لا يؤكد طلباً لم يُحفظ' },
    ],
  },
] as const;

async function main() {
  if (!process.env.DEEPSEEK_API_KEY) throw new Error('DEEPSEEK_API_KEY missing');
  const provider = new DeepSeekProvider(process.env.DEEPSEEK_API_KEY);
  const results: Array<Record<string, unknown>> = [];
  mkdirSync('docs/evaluations', { recursive: true });
  for (const scenario of scenarios) {
    const profile = profiles.find(item => item.id === scenario.business)!;
    const engine = makeEngine(profile, provider);
    for (const [index, turn] of scenario.turns.entries()) {
      const events: any[] = [];
      const unsubscribe = telemetry.onEvent(event => events.push(event));
      let reply = ''; let error: string | undefined;
      const start = Date.now();
      try { reply = await engine.handleMessage(profile.id, 'synthetic-customer', turn.message, profile.id); }
      catch (cause: any) { error = cause?.message || String(cause); }
      finally { unsubscribe(); }
      const usage = events.filter(event => event.eventType === 'llm_usage').map(event => event.metadata);
      const basicCheck = !error && (!('mustContain' in turn) || turn.mustContain.test(reply)) && (!('mustNotContain' in turn) || !turn.mustNotContain.test(reply));
      results.push({ business: profile.id, persona: scenario.persona, turn: index + 1, customer: turn.message, reply, rule: turn.rule, basicCheck, error, latencyMs: Date.now() - start, usage });
      writeFileSync('docs/evaluations/synthetic-moroccan-conversations.json', JSON.stringify({ scope: 'Fictional 3x3 ConversationEngine pilot; no WhatsApp, Instagram, audio, CRM, or real customers', results }, null, 2));
      console.log(`${profile.id}/${index + 1}: ${basicCheck ? 'PASS' : 'REVIEW'} ${reply || error}`);
      if (error || usage.some(call => call.success === false)) throw new Error('Provider/engine failure; stopped to limit spend');
    }
  }
  const summary = { turns: results.length, basicChecksPassed: results.filter(item => item.basicCheck).length, reviewNeeded: results.filter(item => !item.basicCheck).length, llmCalls: results.flatMap(item => item.usage as any[]).length };
  writeFileSync('docs/evaluations/synthetic-moroccan-conversations.md', `# محادثات زبناء مغاربة افتراضيين — Relayqo\n\n${JSON.stringify(summary, null, 2)}\n\nهذه فحوص قواعد جزئية فقط؛ يلزم مراجعة الردود يدوياً. لم تختبر WhatsApp أو Instagram أو الصوت أو CRM.\n\n${results.map(item => `## ${item.business} — الدور ${item.turn} (${item.basicCheck ? 'اجتاز' : 'راجع'})\n\nالزبون: ${item.customer}\n\nRelayqo: ${item.reply || item.error}\n\nالفحص: ${item.rule}`).join('\n\n')}`);
  console.log(JSON.stringify(summary));
  if (summary.reviewNeeded) process.exitCode = 1;
}

void main().catch(error => { console.error(error?.message || error); process.exitCode = 1; });
