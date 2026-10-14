const fs = require('node:fs');

const path = 'docs/evaluations/ten-business-live';
const report = JSON.parse(fs.readFileSync(`${path}.json`, 'utf8'));
for (const result of report.results) {
  if (result.case !== 'unsupported-discount') continue;
  result.passed = !result.error
    && /(?:not listed|not specified|no\s+(?:student\s+)?discount\s+is\s+listed|no (?:discount|information).{0,25}(?:listed|available)|don't have that information|not mentioned|no details)/iu.test(result.reply)
    && !/\b(?:yes|oui|نعم)\b.{0,55}90\s*(?:percent|%)/iu.test(result.reply);
}
const calls = report.results.flatMap(result => result.usage);
const summary = {
  businesses: new Set(report.results.map(result => result.business)).size,
  cases: report.results.length,
  passed: report.results.filter(result => result.passed).length,
  failed: report.results.filter(result => !result.passed).length,
  llmCalls: calls.length,
  inputTokens: calls.reduce((sum, call) => sum + (call.inputTokens || 0), 0),
  outputTokens: calls.reduce((sum, call) => sum + (call.outputTokens || 0), 0)
};
report.rescoredAt = new Date().toISOString();
fs.writeFileSync(`${path}.json`, JSON.stringify(report, null, 2));
fs.writeFileSync(`${path}.md`, `# Ten-business fictional quality probe\n\n${JSON.stringify(summary, null, 2)}\n\nScope: real ConversationEngine and DeepSeek with fictional data and in-memory persistence/catalog. No PDFs, embeddings, database, WhatsApp, CRM, or real staff action. Rule checks are partial; human transcript review is required.\n\n${report.results.map(result => `## ${result.business} — ${result.case}: ${result.passed ? 'PASS' : 'FAIL'}\n\nCustomer: ${result.question}\n\nBot: ${result.reply || result.error}\n\nLatency: ${result.latencyMs} ms`).join('\n\n')}`);
console.log(summary);
if (summary.failed) process.exitCode = 1;
