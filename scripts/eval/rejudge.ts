/** Re-score a saved evaluation report with the current checks (no LLM calls). */
import { readFileSync } from 'node:fs';
import { judge } from './moroccanCommerceChecks';

const file = process.argv[2] || 'docs/evaluations/moroccan-commerce-1000.json';
const results: any[] = JSON.parse(readFileSync(file, 'utf8')).results.filter(Boolean);
const byFailure: Record<string, number> = {}, byIntent: Record<string, [number, number]> = {}, byLang: Record<string, [number, number]> = {};
let passed = 0;
for (const r of results) {
  const errored = r.failures?.some((f: string) => f.startsWith('error:'));
  const v = errored ? { passed: false, failures: r.failures } : judge(r, r.replies.map((reply: string, i: number) => ({ reply, media: r.media[i] || [], workflowActive: i === r.replies.length - 1 ? r.workflowActive : false })));
  if (v.passed) passed++;
  (byIntent[r.intent] ??= [0, 0])[1]++; if (v.passed) byIntent[r.intent][0]++;
  (byLang[r.lang] ??= [0, 0])[1]++; if (v.passed) byLang[r.lang][0]++;
  for (const f of v.failures) { const k = f.replace(/\(.*?\)|\d+/g, '#').replace(/: .*/, ''); byFailure[k] = (byFailure[k] || 0) + 1; }
  if (process.env.SHOW && !v.passed && (process.env.SHOW === 'all' || v.failures.some((f: string) => f.includes(process.env.SHOW!)) || r.intent === process.env.SHOW)) {
    console.log(`${r.id} | ${r.turns.at(-1)} => ${(r.replies.at(-1) || '').replace(/\s+/g, ' ').slice(0, 220)} | ${v.failures.join('; ')}`);
  }
}
console.log(`passed ${passed}/${results.length} (${(100 * passed / results.length).toFixed(1)}%)`);
console.log('lang', Object.entries(byLang).map(([k, [p, t]]) => `${k} ${p}/${t}`).join(' | '));
console.log('intent', Object.entries(byIntent).map(([k, [p, t]]) => `${k} ${p}/${t}`).join(' | '));
console.log(Object.entries(byFailure).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n}  ${k}`).join('\n'));
