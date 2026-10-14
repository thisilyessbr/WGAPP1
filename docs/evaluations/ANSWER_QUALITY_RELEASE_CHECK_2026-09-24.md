# Relayqo answer-quality release check — 24 September 2026

## Implemented in this workspace

- Direct PDF answers now require topic evidence, while multi-policy composition can validate each selected policy passage separately. Exact-size tables are sent through grounded answering instead of being pasted as one selected size. Document headings are removed from direct answers.
- Generated price claims are checked against current evidence and the configured service price; generated hours are checked against configured hours. Claims that a booking or order was already confirmed are rejected when no workflow performed the action. Unsupported blanket discount denials are rejected.
- Single-service price questions use published service data directly, with the configured currency and no model call. Commerce price intent takes precedence over material words in product names such as “cotton shirt.”
- Unknown answers suggest configured business topics in the customer's language/script.
- A ten-business fictional evaluation and a saved transcript were added. The real-model script uses isolated in-memory conversations and catalog data; the offline matrix also exercises synthetic policy-document chunks.

## Results

| Check | Result | Boundary |
|---|---:|---|
| Focused answer/language/policy tests | 299/299 pass | Nine suites, including 10-business offline matrix |
| Ten-business real DeepSeek probe | 30/30 pass after corrected discount rubric | 10 fictional businesses, 3 English cases each |
| Model calls in that probe | 22/30 turns | 8 turns answered without a model call |
| Provider-reported tokens | 12,014 input; 612 output | No monetary invoice or WhatsApp cost included |
| Latency | p50 698 ms; p95 979 ms | Isolated process and provider; not production transport |
| TypeScript build and typecheck | Pass | Local workspace |
| Repository-wide unit suite | Not green | 14 suites/63 tests failed in the run before the final multi-policy fix; several failures are database access or older CRM/workflow fixture mismatches. Do not treat the focused pass as a full-suite pass. |

The initial real-model probe had three observed defects: cotton-shirt price routed as material, and two service prices omitted MAD. Manual review found an unsupported negative discount claim that the first rubric missed. These were corrected, the rubric was strengthened, and the second probe was rescored to 30/30 from its saved transcript. This is a small quality probe, not a statistically reliable market accuracy estimate.

## Remaining production gate

The live ten-business probe did **not** use PDFs, embeddings, the production database, WhatsApp transport, customer data, CRM, or staff notification. The offline suite uses synthetic PDF chunks, not ingestion. It does not cover every mixed intent, conflict between a published field and an older PDF, actual variant inventory, or multi-turn purchase/booking completion for all ten industries. The full unit suite remains ungreen. A real account-scoped PDF ingestion/retrieval test, WhatsApp delivery and human handoff test, and merchant review of Darija replies are required before claiming an unattended production launch.

## Reproduce

- Offline focused suite: `npx vitest run tests/unit/grounded-answer-safety.spec.ts tests/unit/ten-business-answer-matrix.spec.ts tests/unit/morocco-salon-regressions.spec.ts tests/unit/knowledge-answer-presentation.spec.ts tests/unit/direct-rag-price-coverage.spec.ts tests/unit/deterministic-multi-policy.spec.ts tests/unit/darija-conversation.spec.ts tests/integration/final-boundary-quality-31b.spec.ts tests/integration/p1-routing-rag-30c.spec.ts --fileParallelism false`
- Fictional real-provider probe: `npx tsx scripts/evaluate-ten-moroccan-businesses.ts` (requires a configured DeepSeek key and makes billable API calls)
- Saved transcript and per-turn usage: `docs/evaluations/ten-business-live.json` and `docs/evaluations/ten-business-live.md`
