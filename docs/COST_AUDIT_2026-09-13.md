Chatbot cost audit — 13 September 2026

The chatbot has a useful low-cost foundation: deterministic commerce/workflows, FAQ answers, bounded retrieval context, query embedding caching, and duplicate-message handling. I found and fixed request-level waste. The main remaining business exposure is that client spending is not capped by an enforceable monthly allowance. The existing “budget” alerts measure activity after the fact; they do not stop a client from spending your shared provider balance.

Scope: local code and offline tests, plus official public API documentation. No account balances, customer traffic, private configuration, production database, or actual invoices were inspected. No paid AI requests or deployment were performed. These are code findings and illustrative costs, not measured production savings.

**Fixed in this change**

| Problem | Previous behavior and cost exposure | Result |
| --- | --- | --- |
| Requests continuing after the caller timed out | Greeting detection stopped waiting after 1.5 seconds, but its DeepSeek request used a 15-second timeout and up to three attempts. The inner operation could continue for roughly 48 seconds. Grounded answers and query reformulation also raced timers without cancelling the request. | Caller deadlines now cancel DeepSeek transport and retry backoff. Timers/listeners are removed after completion. All attempts share one deadline, capped at 30 seconds. Cancellation cannot guarantee a refund for work the provider already accepted. |
| Blind retries | Authentication aside, permanent errors, malformed output, timeouts, and network failures could repeat three times. | No automatic retry for permanent errors, malformed completed answers, timeouts, or network failures. Only 429/500/502/503/504 can receive one retry, within the remaining deadline and respecting Retry-After. |
| Oversized outputs | Intent classification inherited the tenant's general output budget, commonly 1,000 tokens. Final answers could also generate text that the application then discarded at its character limit. | Classification is capped at 64 tokens; field extraction at 256; ordinary generation at 2,048. New/default tenant reply settings use 500 instead of 1,000. Existing explicit tenant reply settings remain effective within the ceiling. The prompt now includes the application's response character limit. Multiple-policy answers retain their dedicated 800-token setting. |
| Excessive input | No complete-request size guard in DeepSeekProvider. | Inputs above 64 KiB of UTF-8 message text are rejected before calling DeepSeek. Arabic is not sliced to fit this guard. This is a byte safety ceiling, not a tokenizer or a monthly spending limit. |
| Incomplete cost metrics | Some classification and reformulation calls had no usage event; answer token counts used characters divided by four; retries were reported as zero. This is especially unreliable for Arabic/Darija. | Every AI operation routed through ConversationEngine is metered. DeepSeek-reported input, output, cache-hit/miss and reasoning token counts, model and attempts are captured when available. Missing usage is explicitly unknown. Legacy estimated events are not added again. Account attribution is preserved. |
| Obsolete model/default mode | Default configuration used deepseek-chat. Current DeepSeek models default to thinking, which is inappropriate as an implicit setting for short support requests. | Defaults and stored non-thinking chat/Flash aliases resolve to deepseek-flash. Requests explicitly disable thinking. Other explicit model names are retained. Existing deepseek-reasoner settings require an explicit migration; they are not silently converted. |

The old model-name retirement was announced for 24 July 2026 in [DeepSeek's official release notice](https://api-docs.deepseek.com/news/news260424/). The current mode toggle and default are documented in [Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode/). Usage fields come from the [Chat Completions API](https://api-docs.deepseek.com/api/create-chat-completion/). Token ceilings reduce maximum exposure; they are not claims of proportional savings on actual bills.

**Current DeepSeek cost examples**

Flash rates, USD per million tokens:

| Period | Cached input | Uncached input | Output |
| --- | ---: | ---: | ---: |
| Off-peak | $0.003 | $0.15 | $0.60 |
| Peak | $0.006 | $0.30 | $1.20 |

Peak periods are weekdays 01:00–04:00 and 06:00–10:00 UTC. These prices were checked on the [official pricing page](https://api-docs.deepseek.com/quick_start/pricing/); prices can change.

The following calculations assume non-thinking Flash, no retries, and the stated usage. They exclude embeddings, images, WhatsApp, infrastructure and taxes:

| Scenario per 10,000 customer messages | Off-peak | Peak |
| --- | ---: | ---: |
| One call per message: 1,500 uncached input + 250 output tokens | $3.75 | $7.50 |
| Same usage, but 60% of messages need no AI call | $1.50 | $3.00 |
| One call: 1,000 cached + 500 uncached input + 250 output tokens | $2.28 | $4.56 |
| Heavier pipeline: total 5,000 uncached input + 800 output tokens per message | $12.30 | $24.60 |

Formula: (uncached input × uncached rate + cached input × cached rate + output × output rate) / 1,000,000. Actual call frequency and token usage determine which scenario resembles your service. Do not delay live customer replies to chase off-peak prices.

**Remaining problems, ordered by business impact**

1. **High — no enforced monthly client budget.** CostAnalyticsService thresholds are alerts, not admission controls. HTTP chat limits are process-local (120 requests/minute/tenant); the WhatsApp guard has a recipient rate limit. These do not enforce spending across channels, workers, restarts or an entire month. Add a durable allowance per client, atomically reserve before paid work, reconcile recorded usage, and provide a deterministic fallback/handoff when the allowance is exhausted. Define allowances for text, images and document ingestion separately. This needs a persistent billing design and database work; it was not represented as solved by an in-memory counter.

2. **High — observability is not a billing ledger.** The new usage events correct DeepSeek call accounting, but local telemetry retains only 200 recent events and delivery to the optional monitoring service is best effort. The monitoring service can persist events to PostgreSQL when configured; that is still not an atomic spend reservation system. CostAnalyticsService intentionally returns a null dollar estimate. Unknown usage after transport failure must not be interpreted as free usage. Keep a durable usage ledger before selling usage-based plans, and reconcile against provider invoices.

3. **Medium — embeddings are a separate Google expense.** Retrieval and PDF ingestion use GeminiEmbeddingProvider, independently of DeepSeek chat. Current RAG event counters can describe retrieval attempts even when a cached query vector avoided the API; actual embedding token usage is not metered. Track provider calls at the embedding boundary. Google's published standard gemini-embedding-001 rate is $0.15/million input tokens; 10,000 queries averaging 60 tokens would cost $0.09 before caching. See [Google's pricing entry](https://ai.google.dev/gemini-api/docs/pricing?authuser=3). This is an example, not a measured query average.

4. **Medium — repeated ingestion can repay completed work.** PDF ingestion correctly limits files to 10 MB, extracted text to 100,000 characters and chunks to 500 by default. A successfully completed identical file is reused within its tenant/account scope. However, simultaneous identical uploads can both start, and retrying a partially failed ingestion can regenerate earlier paid embeddings. Introduce a durable ingestion claim and resumable chunks. Avoid changing embedding models casually: existing vectors generally need compatible regeneration.

5. **Medium — images and channel delivery have independent costs.** Images use a separate Gemini adapter; its usage and actual fallback model are not fully represented in text-chat cost totals. WhatsApp/Meta delivery, hosting, database, logs and storage also sit outside the DeepSeek example. Give image requests their own allowance and price your service against the total operating bill, not only text tokens. No live Meta or infrastructure bill was inspected.

6. **Medium — optional Gemini chat still has its own retry behavior.** The DeepSeek fixes do not retrofit GeminiLLMProvider's three-attempt policy or add Gemini usage accounting. Keep DeepSeek as the support default. If you enable Gemini chat for clients, apply equivalent cancellation and metering controls first.

7. **Lower — repeated retrieval and extra helper calls.** Query vectors already have a tenant/provider/model-scoped 500-entry cache with a one-hour sliding TTL. Concurrent identical cache misses are not combined, and caches are not shared across processes. Multi-policy retrieval can embed up to four subqueries. These are candidates for request coalescing/shared caching after provider-level measurement shows meaningful waste. Preserve the existing script/language checks and evidence requirements; forcing FAQ answers for ambiguous Darija would save calls at the expense of correctness.

**What to do next**

Before setting customer plan prices, implement the durable client allowance and collect representative usage by client, language, operation and provider. Compare actual paid AI calls per customer message, input/output tokens, cache-hit share, retries and unknown usage. Keep the 500-token reply default initially; increase only for demonstrated answer truncation. Keep factual FAQ and catalog answers deterministic, and add Arabic-script Darija and Arabizi FAQ variants where customer traffic shows repeated questions. A smaller model or shorter answer is only a useful saving if the answer remains correct.

**Verification and rollback**

- 727/727 selected offline tests passed: 714 database-independent unit tests, five provider/factory integration tests and eight provider tests. This includes 34 new cost-control tests and the existing 140 Darija regression cases.
- Type checking, application compilation and whitespace checks passed.
- Provider HTTP calls were mocked. This verifies budgets, retry/cancellation behavior, usage accounting, Arabic content preservation and existing routing; it does not establish live DeepSeek fluency, latency or measured savings.
- Evidence: [test results](C:/Users/IlyesSaber/Desktop/work/output/cost-verification/final-results.json).
- Before-change snapshots and a hash-checked rollback script preserve earlier uncommitted work: [rollback.ps1](C:/Users/IlyesSaber/Desktop/work/output/rollback/cost-fixes-20260913/rollback.ps1). Running without -Apply only verifies; -Apply restores this batch and rebuilds. It refuses to overwrite subsequent edits. Roll back this cost batch before using an older chatbot/Darija rollback.

Main changed files: [DeepSeekProvider.ts](C:/Users/IlyesSaber/Desktop/work/src/core/llm/DeepSeekProvider.ts), [ResponseDeadline.ts](C:/Users/IlyesSaber/Desktop/work/src/core/llm/ResponseDeadline.ts), [MeteredLLMProvider.ts](C:/Users/IlyesSaber/Desktop/work/src/core/llm/MeteredLLMProvider.ts), [ConversationEngine.ts](C:/Users/IlyesSaber/Desktop/work/src/domain/conversation/ConversationEngine.ts), and [CostSummaryReporter.ts](C:/Users/IlyesSaber/Desktop/work/src/core/telemetry/CostSummaryReporter.ts).
