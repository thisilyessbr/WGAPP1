# Relayqo: Pilot-to-Marketing Delivery Plan

**Date:** 2026-09-23  
**Objective:** Make Relayqo reliable enough for 3–5 supervised paying pilots, then satisfy measurable gates before broad marketing.  
**Current position:** The WhatsApp pipeline works end to end and operating cost is low. The main release blockers are conversation correctness, the order and human-handoff loops, and production observability.

## Delivery rules

- Implement each phase on an isolated `codex/...` branch or worktree based on the intended integration branch.
- The current workspace contains unrelated, uncommitted work. Do not reset, overwrite, stage, or commit those changes.
- Protect new behavior with tenant-level feature flags where practical.
- Deploy one phase at a time. Keep the previous production image available for immediate rollback.
- Every bug found in production must receive a regression test before it is considered fixed.
- Do not optimize prompts or token limits without running the same quality test set before and after.

## Release priorities

| Priority | Meaning | Examples |
|---|---|---|
| P0 | Blocks a customer pilot or can produce a materially wrong answer | Wrong stock, wrong price, policy question misclassified, duplicate order |
| P1 | Required before broad marketing | Human takeover, monitoring, delivery recovery, clear merchant metrics |
| P2 | Revenue expansion after pilots | CRM connectors, broadcasts, payment links, extra channels |

## Product-mode decision — commerce or standard chatbot

Relayqo should support both products without maintaining two separate engines:

- **Standard chatbot:** business information, services, FAQs, policies, knowledge documents, lead capture, bookings, and human handoff.
- **Commerce chatbot:** everything in standard mode plus products, variants, stock, prices, product recommendations, carts/orders, shipping calculations, and commerce outcomes.

Do not permanently delete the ecommerce implementation merely to launch a standard chatbot. Make commerce an account-level entitlement and capability. This keeps the simpler product clean for clients while preserving a higher-priced commerce plan. Physical removal should happen only if Relayqo decides after pilots that it will never sell ecommerce.

### One source of truth

Use the approved plan module `commerce` as the entitlement source. At publish/runtime, calculate:

```text
commerceActive = plan includes "commerce" AND account capability ecommerceEnabled is true
```

The client must not be able to enable a module that is absent from the approved plan. The current publish path already calculates this in `src/portal/PortalStore.ts`; all other layers must consume the same effective result instead of creating different defaults. In particular, remove any fail-open behavior that treats a missing ecommerce flag as enabled.

### Safe deactivation sequence

1. Add or verify two admin-selectable product modes: `STANDARD` and `COMMERCE`. Map these modes to plan modules rather than scattering mode checks throughout the code.
2. When changing an account from commerce to standard:
   - stop new carts and order workflows;
   - allow staff to resolve already-confirmed orders;
   - invalidate active unconfirmed commerce sessions with a neutral customer message;
   - publish a configuration with `ecommerceEnabled=false`;
   - retain products, variants, orders, and outcome history as archived account data.
3. Do not delete product/order records during deactivation. Provide a separate, explicit retention/deletion operation for legal or customer-requested deletion.
4. Re-enabling commerce should restore the archived catalog after admin review without requiring manual database work.

### Backend behavior in standard mode

- `ConversationEngine` must never call product search, recommendation, comparison, variant stock, cart, or order logic when `commerceActive=false`.
- Commerce-looking customer questions should fall through to approved FAQ/knowledge/general response behavior. The bot may explain the business's services, but must not invent a catalog, stock, price, or order.
- Product and variant mutation APIs must reject standard-mode accounts with a stable `COMMERCE_NOT_INCLUDED` response. Read APIs used only by commerce screens should behave the same.
- Order workflow templates and ecommerce intents must not be compiled or activated for standard accounts.
- Commerce outcome events must not be emitted for new standard-mode conversations. Historical metrics remain readable to admins.
- Lead capture, booking, FAQs, documents, policies, WhatsApp, inbox, handoff, language handling, and normal workflows remain available according to their own plan modules.

### Client frontend in standard mode

Remove commerce from the client experience by conditional rendering based on the public effective modules returned by the server:

- Hide the Products collection, variants, SKU, stock, product category, and commerce import controls from `/app/business`.
- Hide order setup, commerce workflow templates, catalog synchronization, product recommendations, and commerce-specific settings.
- Hide confirmed-orders and revenue cards when commerce is not included. Reflow the dashboard so there are no empty cards or disabled commerce placeholders.
- Replace commerce wording such as “Products, services, policies and FAQs” with mode-aware wording such as “Services, policies and FAQs.”
- Keep leads, bookings, missed questions, handoffs, conversations, documents, WhatsApp, and chatbot preview where included.
- Do not merely hide elements with CSS. Do not render them, do not call their APIs, and keep backend authorization as the final guard.

### Admin frontend

- Show the account mode, effective modules, and whether archived commerce data exists.
- Allow only admins to change mode or the underlying approved plan.
- Before turning commerce off, show counts for active carts, unconfirmed orders, confirmed orders awaiting action, and stored products.
- Require the admin to resolve or explicitly cancel active transactional sessions, then publish the mode change.
- Admin chatbot preview must execute with the selected account's effective mode so a standard account cannot accidentally test commerce behavior.

### Current implementation touchpoints

- `src/portal/PortalStore.ts` — calculate and publish effective commerce capability.
- `src/portal/validation.ts` — validate capability input without allowing entitlement escalation.
- `src/portal/ui/portal.js` and `src/portal/ui/i18n.js` — hide commerce collections, wording, and outcome cards in standard mode.
- `src/dev/ui/index.html` — keep ecommerce controls admin-only and make their visibility account-aware.
- `src/domain/conversation/ConversationEngine.ts` — guard all ecommerce branches, including follow-up/context paths.
- `src/domain/tenant/TenantConfigService.ts` and `src/domain/tenant/AccountConfigService.ts` — preserve the effective false value across merges.
- `src/dev/chatApi.ts` or its production route replacements — reject product/variant operations for standard accounts.
- `src/bootstrap.ts` — ecommerce services may remain registered; runtime authorization decides whether an account can use them.

### Required tests

1. A standard account cannot use product or variant APIs even by calling them directly.
2. A standard account asking for price, stock, or a product does not trigger ecommerce or fabricate an answer.
3. Standard client pages contain no product, stock, order, or ecommerce controls and make no commerce requests.
4. Commerce accounts retain all current product behavior.
5. Downgrading preserves catalog and order history, terminates active unconfirmed sessions safely, and prevents new commerce events.
6. Re-enabling commerce restores access to retained catalog data after publish.
7. Changing an account mode never affects another tenant.

### Exit criteria

- The same deployed engine serves standard and commerce accounts with tested tenant isolation.
- Commerce code and APIs are unreachable for standard accounts, including direct API requests.
- No commerce element appears in the standard client frontend.
- Downgrade and restoration are reversible and do not destroy business records.
- Standard mode passes its own multilingual test subset covering FAQs, policies, services, bookings, leads, knowledge, and handoffs.

### If Relayqo later removes ecommerce permanently

Treat permanent removal as a separate migration after all accounts are confirmed standard. Export retained commerce records, remove commerce routes and dependency injection, delete frontend and translation assets, remove ecommerce configuration fields, then use an expand-and-contract database migration to drop commerce tables in a later release. Never combine application removal and destructive database deletion in one deployment.

## Phase 0 — Reproducible quality baseline

**Priority:** P0  
**Duration:** 1–2 working days  
**Dependency:** None

### Work

1. Capture the current production chatbot configuration and published shoe-store revision as sanitized fixtures.
2. Build a minimum 60-scenario evaluation set covering:
   - Darija in Latin characters and Arabic script;
   - French and English;
   - exact product, category discovery, price, exact variant stock, delivery, returns, exchange, mixed questions, unsupported requests, and follow-up context;
   - adversarial cases that attempt to invent products, policies, prices, or discounts.
3. Add expected structured outcomes as well as expected answer facts. Avoid asserting exact prose.
4. Run tests with isolated customer identities and conversations. Tests must never write to production tenants or send live WhatsApp messages.
5. Record baseline accuracy, incorrect facts, p50/p95 response time, LLM calls per turn, input/output tokens, embedding calls, and estimated cost.

### Required artifacts

- Versioned multilingual evaluation fixture.
- One command that runs the quality suite locally and in CI.
- Baseline report checked into `docs/`.

### Exit criteria

- The same run is reproducible and does not depend on production data.
- Every known live failure has a failing regression scenario.
- Metrics can be compared automatically between commits.

### Rollback

This phase changes tests and observability only. It must not change production answer behavior.

## Phase 1 — Conversation correctness

**Priority:** P0  
**Duration:** 3–5 working days  
**Dependency:** Phase 0

### Work

1. **Fix policy precedence.** A returns, exchange, warranty, or delivery-policy question must override stale product and price context. The known exchange question must return the published exchange policy rather than “product unavailable.”
2. **Support mixed intents.** Compose one answer for product, exact size/variant availability, price, and delivery when the customer asks them together.
3. **Use variant-level inventory.** If the user asks for black size 42, report that variant’s stock status or quantity. Never report the product-wide total as variant stock.
4. **Improve catalog discovery.** Generic requests such as “what sneakers do you have?” should return 3–5 relevant products with names and prices, respecting stock and configured catalog limits.
5. **Control context carryover.** Preserve useful entities across turns, but clear or de-prioritize them when the new turn changes intent.
6. **Enforce grounded answers.** The bot must not invent products, prices, availability, policies, discounts, or order confirmations.
7. Add regression coverage in every supported language, with extra weight on Moroccan Darija.

### Likely implementation areas

- `src/domain/conversation/TurnDecision.ts`
- `src/domain/conversation/ConversationEngine.ts`
- `src/domain/conversation/AnswerComposer.ts`
- `src/domain/ecommerce/EcommerceIntent.ts`
- `src/domain/ecommerce/EcommerceService.ts`
- `src/domain/ecommerce/ProductRecommendationService.ts`
- Existing chatbot audit, turn-decision, ecommerce, multilingual, and live-provider tests

The implementing agent must inspect the current tree before editing because filenames and ownership may have changed in the pending work.

### Exit criteria

- 100% correct prices and stock facts in the approved evaluation set.
- At least 95% overall scenario pass rate.
- No hallucinated product or policy facts.
- All four known live scenarios pass, including the exchange follow-up and exact variant stock.
- No regression in WhatsApp message delivery.

### Rollback

- Put the revised turn-decision and mixed-intent behavior behind tenant flags.
- Keep the previous decision path available until the new path passes production shadow evaluation.

## Phase 2 — Complete the sales and support loop

**Priority:** P0 for order correctness; P1 for merchant workflow  
**Duration:** 4–6 working days  
**Dependency:** Phase 1

### Work

For commerce accounts, complete the order path below. For standard accounts, implement the equivalent booking or lead-confirmation path required by the selected pilot vertical.

1. Build a deterministic order workflow that captures product, variant, quantity, customer name, phone, city/address, delivery fee, and total.
2. Show a final order summary and require explicit customer confirmation.
3. Persist the order and its outcome exactly once. Retries and duplicate webhooks must not create duplicate orders.
4. Validate price and availability again immediately before confirmation.
5. Enable human handoff with:
   - customer request and automatic escalation triggers;
   - a visible unresolved queue;
   - merchant/admin takeover;
   - clear indication that automation is paused;
   - a controlled “resume bot” action.
6. Notify the merchant about confirmed orders, failed automation, and unresolved conversations.

### Required artifacts

- Order state diagram and persisted state contract.
- End-to-end order and handoff tests through the same entry point used by WhatsApp.
- Idempotency and webhook-retry tests.

### Exit criteria

- A customer can complete one real test order over WhatsApp without staff editing database records.
- Duplicate incoming events create one order and one confirmation.
- A merchant can take over and return the conversation to automation.
- Failed and abandoned order flows are visible to staff.

### Rollback

- Gate order creation and automated handoff separately by tenant.
- Keep “lead capture only” as the safe fallback if order confirmation is disabled.

## Phase 3 — Cost and latency optimization

**Priority:** P1  
**Duration:** 2–4 working days  
**Dependency:** Phase 1 baseline; may run alongside late Phase 2 work

### Work

1. Resolve exact FAQs, policies, catalog facts, and order-state transitions deterministically before invoking embeddings or an LLM.
2. Skip embedding calls when a tenant has no relevant documents or the turn is already resolved from structured data.
3. Remove duplicate classification and generation calls where one structured model call or deterministic classifier is sufficient.
4. Evaluate these starting limits against the quality suite:
   - conversation history: 20 to 8–10 recent turns;
   - output limit: 500 to 250–300 tokens;
   - retrieved context: 4,000 to about 2,000 tokens;
   - retain `topK=3` unless retrieval evaluation supports a change.
5. Summarize old history only for longer conversations and cache the summary.
6. Record cost by tenant and by outcome, not only by raw message count.

### Exit criteria

- At least 30% fewer average input tokens or model cost per resolved turn.
- No material drop from the Phase 1 quality score and still 100% price/stock correctness.
- No more than one LLM generation for ordinary catalog, policy, or FAQ turns.
- p95 response time below 8 seconds under the agreed pilot load.

### Rollback

- Store prompt/config versions and allow tenant-level reversion.
- Revert individual limits when the evaluation report shows a quality regression.

## Phase 4 — Production reliability and operations

**Priority:** P1  
**Duration:** 3–5 working days  
**Dependency:** Stable behavior from Phases 1–3

### Work

1. Run the web process and background worker as independently observable services before meaningful traffic. During the pilot, the combined process may remain only if it is always on and has verified recovery behavior.
2. Remove free-tier sleeping from the production WhatsApp path.
3. Add queue depth, oldest-job age, webhook failure, dead-letter, delivery failure, worker liveness, token-expiry, and provider-error alerts.
4. Provide safe replay for failed inbound and outbound jobs with idempotency protection.
5. Test database backup and restore, not only backup creation.
6. Rotate every credential previously exposed in messages or local files. Remove fallback secrets and production-only development routes.
7. Replace process-local rate limiting where horizontal scaling can bypass it.
8. Document incident response for webhook outage, expired Meta token, model outage, database outage, and bad deployment.

### Exit criteria

- A 500-message soak test completes with more than 99% successful processing and no duplicate business action.
- Restarting web or worker processes does not lose accepted messages.
- Alerts reach the operator for each tested failure class.
- Restore and rollback procedures are executed successfully in a non-production environment.

### Rollback

- Keep the last known-good deployment image and database migration rollback notes.
- Use expand-and-contract schema migrations; never require an immediate destructive migration.

## Phase 5 — Merchant experience and outcome reporting

**Priority:** P1  
**Duration:** 3–5 working days  
**Dependency:** Phase 2 outcomes and handoff model

### Work

1. Audit the current inbox and dashboard before adding duplicate UI. Complete only missing behavior.
2. Give merchants a clear view of:
   - new and unresolved conversations;
   - qualified leads;
   - confirmed orders and bookings;
   - human handoffs and resolution time;
   - missed or unanswered questions;
   - chatbot success and delivery failure trends.
3. Add a simple setup checklist for business data, catalog, policies, WhatsApp, test conversation, and activation.
4. Add an admin preview that tests the exact published tenant configuration without affecting customer analytics.
5. Keep quotas and infrastructure controls in the admin product. Show clients only actionable business usage where required by their plan.

### Exit criteria

- A nontechnical merchant can configure data, run a preview, understand unresolved work, and process a handoff without developer help.
- Dashboard totals reconcile with stored outcomes for the same period.
- Admin tests are clearly marked and excluded from customer KPIs.

### Rollback

- New dashboard cards and workflow controls should be independently switchable.
- Preserve direct admin access to underlying records while the merchant UI is piloted.

## Phase 6 — Integrations and revenue expansion

**Priority:** P2  
**Start:** Only after pilot demand proves the connector  
**Dependency:** Stable outcome and order contracts

### Sequence

1. Publish a signed outbound webhook and a small, versioned API for contacts, leads, orders, bookings, handoffs, and conversation outcomes.
2. Add Shopify or WooCommerce based on the first paying segment.
3. Add HubSpot or Zoho based on signed customer demand.
4. Add Google Calendar for appointment-led businesses.
5. Add payment links through the provider used by target customers.
6. Add compliant WhatsApp templates, opt-in records, suppression rules, and campaign reporting before broadcasts.

### Exit criteria

- Every connector has tenant isolation, scoped credentials, replay protection, audit logs, and disconnect/revoke behavior.
- At least two customers have a real need before a dedicated connector is built.

## Phase 7 — Pilot and marketing gate

**Priority:** P0 business gate  
**Duration:** Two supervised weeks after Phases 0–5

### Pilot

- Recruit 3–5 Moroccan businesses from one or two related verticals.
- Use the positioning: **“A managed Darija-first WhatsApp sales and support assistant for Moroccan small businesses.”**
- Review a weekly scorecard: answer correctness, wrong business facts, processing success, response latency, handoff resolution, confirmed outcomes, model cost, and merchant feedback.
- Review every failed or low-confidence conversation during the pilot.

### Broad-marketing gate

Marketing starts only when all are true:

- At least 95% overall pass rate on the approved multilingual suite.
- 100% price and stock correctness in the suite.
- More than 99% successful message processing during the pilot.
- p95 response time below 8 seconds.
- Human takeover and resume work reliably.
- The chosen vertical has a complete order or booking workflow.
- No hallucinated products, prices, stock, or policies in the pilot review window.
- Alerts, backups, restore, and rollback have been tested.
- At least three pilots have reached agreed business outcomes.

## Work that should not start yet

- Native mobile applications.
- A full omnichannel suite.
- Many dedicated CRM integrations at once.
- Voice calling or voice-agent infrastructure.
- A complex visual automation builder.
- Advanced campaign automation before consent, templates, and suppression controls are complete.

These items consume substantial engineering time without removing the current sales risk: a WhatsApp answer or transaction being wrong.

## Recommended first sprint

Start with the **product-mode separation, Phase 0, and Phase 1 only**. Product-mode separation should land first if the initial pilots will use the standard chatbot. It prevents unnecessary ecommerce UI and behavior while preserving the commercial upgrade path. Phase 0 and Phase 1 then address the largest answer-quality risk and create the measurement system needed for every later decision.

### Suggested agent split

| Agent | Ownership | Deliverable |
|---|---|---|
| Quality agent | Phase 0 fixtures, runner, baseline report | Reproducible 60-scenario suite and metrics |
| Conversation agent | Intent precedence, context rules, mixed intents | Policy and mixed-question fixes with tests |
| Commerce agent | Variant stock and product discovery | Correct variant lookup and 3–5 product discovery |
| Reviewer | Cross-check tenant isolation and regressions | Review report; no feature implementation |

The implementation agents should work in separate worktrees. Merge the quality harness first, then rebase the behavior branches onto it so every fix is measured against the same suite.

### Sprint completion definition

- The four known production failures have regression tests and fixes.
- The multilingual suite reaches the Phase 1 quality gate.
- A before/after report states accuracy, latency, token use, and cost.
- The deployed change can be disabled per tenant or rolled back to the previous image.

## Product and revenue direction

Relayqo should win through reliable Moroccan commerce conversations, fast managed setup, and measurable sales/support outcomes. Mature competitors already have broad inboxes, automation, campaigns, and integrations. Trying to match every feature before pilots will delay proof of value. First make Darija conversations, stock, policies, orders, and handoffs demonstrably dependable; then add the integrations requested by paying customers.
