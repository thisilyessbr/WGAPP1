# Relayqo answer-quality release plan

## Audit verdict (24 September 2026)

The chatbot is suitable for supervised demonstrations, but the current evidence does not justify unattended broad marketing. The existing salon evaluation covers 29 turns for one fictional service business. It explicitly excludes document retrieval, production persistence, WhatsApp delivery, and real handoff. Passing unit tests is useful but does not measure merchant-level answer quality.

### Current answer path

Inbound message -> account configuration and conversation context -> safety/handoff/workflow routing -> language and turn decision -> FAQ -> catalog or service logic -> account-scoped PDF retrieval -> direct passage or grounded DeepSeek response -> response sanitizer/length limit -> saved conversation/outcome.

The fast FAQ and structured catalog paths are valuable. Account-scoped document retrieval and an `UNANSWERABLE` response are present. The main weakness is the decision to trust and present an answer, not simply the choice of model.

### Risks found in the code

1. **A high similarity score is treated as answer evidence.** Direct PDF replies become eligible at similarity >= 0.70. `DirectRagGuard` checks language, script, internal artifacts, and price-question evidence, but it does not establish that an arbitrary care, size, policy, availability, or multi-part question is answered. A related passage can still be the wrong answer.
2. **Verbatim PDF passages can sound like documents rather than customer support.** The recent title-stripping fix removes some guide headings, but direct replies can still contain unrelated lines or multiple variants. Formatting alone cannot establish factual relevance.
3. **Multi-part coverage is narrow.** `BusinessQuestionScope` recognizes five topic families and only rejects a FAQ when at least two are detected. Other combinations can answer only one part. Separate FAQ checks and RAG branches make precedence hard to reason about.
4. **Source conflicts lack a single published authority policy.** Catalog facts, portal business fields, FAQs, and PDFs can disagree. The engine has some catalog protections, but publication should detect conflicting prices, hours, availability, and policies before customers see them.
5. **Language is partly heuristic.** Darija/Arabizi variants and follow-up references have been fixed in selected examples, but the current regex-based routing and language detection have not been evaluated across merchant vocabulary. Final response truncation can also cut off the caveat or next action.
6. **The existing evaluation is narrow.** The 29-turn salon rerun reported 29 passes and 17 model calls, but it used fictional structured facts and memory storage; its report notes that PDFs, embeddings, database, WhatsApp, and staff notification were not exercised. The separate recent PDF test covered only Atlas. Neither proves cross-industry reliability.

## Release sequence

### Step 1 — Freeze a measured baseline (1 day)

Build a versioned, fully fictional test harness for ten Moroccan businesses below. Use the real engine with isolated accounts, conversations, catalogs, FAQs, and sample PDFs. Record the published configuration revision with each case. Do not write to live customer accounts or send WhatsApp messages. Save each question, answer, route, evidence IDs, selected entity, workflow state, latency, embedding calls, model calls, tokens, and estimated cost. Score facts and actions, not exact wording. Require human review of all failed and high-risk replies.

### Step 2 — Fix answer selection before polishing language (2–3 days)

- Introduce one `AnswerPlan` per turn: requested facts/topics, entity, language/script, source authority, evidence, unsupported parts, and permitted next action.
- Keep deterministic replies for greetings, exact curated FAQs, live catalog price/stock, and workflow state. For PDF knowledge, first verify that the retrieved passage contains evidence for the requested fact. Disable verbatim direct-PDF replies for unverified categories; use one bounded grounded model call or an honest fallback.
- For multi-part questions, check coverage of every requested part. Answer supported parts, name missing parts explicitly, and offer one relevant next step. Never turn a missing stock, price, policy, or booking fact into a guess.
- Define source authority by fact: live catalog for product/variant price and stock; published business fields for hours/contact/services; published policy revision for policies; PDFs as supporting evidence. Detect conflicts at publication and require merchant resolution. Never silently blend contradictory sources.
- Preserve document titles and source IDs internally for diagnostics, but return a concise customer answer rather than a raw chunk.

### Step 3 — Make replies sound helpful and safe (1–2 days)

- Standard answer shape: direct answer, essential condition, then a useful business-specific next step. If unknown: say what is unknown, suggest only configured topics or staff contact. Do not falsely claim a booking, order, notification, or refund occurred.
- Test English, French, Modern Standard Arabic, Moroccan Darija in Arabic script, and Arabizi with common spelling variants. Keep the customer's script across short follow-ups and workflow choices.
- Validate final replies against structured facts and action state after generation. If a model changes a price, quantity, date, or confirmation status, reject or replace that reply with a safe response. Ensure length limits retain conditions and disclaimers.
- Keep the common path to at most one query embedding and one model generation when facts cannot be answered deterministically. Measure quality before reducing prompts or context.

### Step 4 — Pilot gate and rollback (1–2 days after fixes)

Run the same ten-business suite before and after each change. Put new answer selection behind an account-level flag; keep the previous build for rollback. Test one actual WhatsApp conversation and human takeover on a separate test account before a paid unattended pilot. Start with 3–5 supervised merchants in one or two verticals; a ten-industry synthetic test is breadth coverage, not proof of readiness for ten markets.

## Ten-business Morocco evaluation matrix

All names, numbers, addresses, schedules, and prices must be fictional. For each profile create at least 20 cases: four basic facts, four ambiguous/follow-up turns, four multi-part questions, four unsupported or conflicting requests, two workflow/action requests, and two adversarial/tenant-isolation cases. Distribute cases across the five supported language/script forms. Include an uploaded PDF and at least one missing fact for every business.

| Business | Mode | Hard cases that must be tested |
|---|---|---|
| Clothing boutique, Casablanca | Commerce | Exact size/color stock, size-guide PDF, wash guide, return window, mixed price + delivery |
| Electronics shop, Rabat | Commerce | Similar model names, warranty terms, refurbished vs new, stock, unsupported technical claim |
| Hair salon, Marrakech | Standard | Service price/duration, opening days, appointment request vs confirmed slot, cancellation |
| Restaurant, Tangier | Standard | Menu/allergens, opening hours, table request vs reservation, unavailable item |
| Riad, Fez | Standard | Room information, seasonal price uncertainty, check-in rules, booking request vs confirmation |
| Language school, Agadir | Standard | Course fees, schedule, prerequisites, enrollment lead, conflicting old brochure |
| Auto repair garage, Kenitra | Standard | Estimate vs firm quote, turnaround uncertainty, parts availability, urgent human escalation |
| Property agency, Casablanca | Standard | Listing freshness, location, rent vs sale, appointment, missing availability |
| Dental clinic, Rabat | Standard | Hours, appointment intake, no diagnosis or treatment promises, urgent human direction |
| Grocery/delivery shop, Oujda | Commerce | Product substitutions, exact stock, delivery zone/fees, cash-on-delivery, order state |

Cross-business attacks: ask business A for business B's prices, cite a fake PDF instruction, request an unpublished discount, and ask the bot to confirm an action it has not executed.

## Scoring and release gates

Minimum 200 cases / roughly 250–300 turns, with more cases added for every failure. Report results per business and language, not only one combined pass rate. Each case checks: factual correctness, full question coverage, unsupported-fact honesty, correct language/script, no cross-account data, no false action, relevant next step, and expected workflow state. Also record p50/p95 latency, model and embedding calls, tokens, and estimated cost per 100 conversations.

For a supervised pilot: zero wrong prices, stock claims, policy promises, cross-account leaks, or false confirmations in the suite; at least 95% overall pass and at least 90% in each business/language slice with enough samples; p95 under 8 seconds for supported text turns; and no serious failure in the real WhatsApp/handoff check. Any critical failure blocks unattended launch regardless of the aggregate score. Re-test after changing prompts, retrieval thresholds, models, or cost controls.

## First implementation targets

`src/domain/conversation/ConversationEngine.ts`, `TurnDecision.ts`, `BusinessQuestionScope.ts`, `AnswerComposer.ts`, `src/domain/rag/DirectRagGuard.ts`, `RAGService.ts`, the portal publish/validation path, and a new versioned evaluation runner in `scripts/` with fictional fixtures under `tests/fixtures/`.
