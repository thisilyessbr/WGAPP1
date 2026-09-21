# Relayqo audit after the Antigravity changes

**Date:** 21 September 2026  
**Scope:** current workspace code, portal, merchant inbox, WhatsApp outbound delivery, cost controls, tests, and public competitor positioning.

## Decision

Relayqo is materially better than the previous version. It now has a real merchant inbox, human takeover, manual WhatsApp replies, resolve/reopen controls, a durable outbound queue, delivery receipts, worker separation, multilingual portal support, admin/client isolation, and internal cost limits.

It is suitable for a controlled pilot after the blockers below are fixed and a live Meta number completes an end-to-end acceptance test. It is not ready for broad self-service marketing yet.

## Verification evidence

- TypeScript type check: **passed**.
- Production build: **passed**.
- Targeted portal, backend inbox, WhatsApp delivery, and worker tests: **93 passed**.
- Merchant inbox browser suite: **20 passed, 11 failed**.
- Total targeted result: **93 passed, 11 failed** across 104 checks.
- Focused security, multi-client credentials, Darija and AI cost-control suites: **224 passed, 1 failed**. The failing assertion expected the phrase “Human takeover active” while the safety guard returned “Human agent handoff requested”; bot suppression itself worked.
- Combined audit runs: **317 passed, 12 failed** across 329 checks. Eleven are in the stateful browser suite and one is an internal wording mismatch.

Several browser failures are defects in the test sequence: it waits for the wrong overview heading, waits for a status badge that already exists elsewhere in the list, and expects a conversation reopened in an earlier test to remain resolved. The suite is stateful, so one timing failure causes later composer, filtering, pagination, and mobile checks to fail. The published claim in `docs/MERCHANT_INBOX_UI.md` that all 31 browser tests pass is not reproducible from the current workspace.

## Launch blockers

### 1. Repeated send requests can create duplicate local messages

The manual message endpoint inserts a new `Message` before it asks the outbound queue to deduplicate the idempotency key. A repeated request with the same key creates another local message and increments the conversation counter, even though the queue prevents a second Meta send. The existing test checks only that the transport was called once, so it misses the duplicate transcript entry.

**Fix:** make message creation and queue insertion one database transaction keyed by a stored idempotency key. A duplicate request must return the original message and status without creating or incrementing anything.

### 2. Long transcripts load the wrong page

The conversation detail query orders messages oldest-first and then applies `LIMIT`. A conversation with more than 50 messages initially shows its oldest messages. It also calculates the 24-hour WhatsApp customer-service window from that limited page, which can incorrectly report an expired window despite a recent customer message.

**Fix:** fetch the newest page in descending order, reverse it for display, and calculate the customer-service window with a separate latest-customer-message query. Use a stable `createdAt + id` cursor for older pages.

### 3. Manual-send persistence is not atomic

The local message insert, durable outbound enqueue, and conversation counter update are separate operations. A queue error can leave a permanent “Pending” message that was never queued.

**Fix:** enqueue through the same database transaction or add an outbox record atomically with the message. Expose an explicit local failure state and retry using the original idempotency key.

### 4. Browser acceptance tests are unreliable

The inbox UI may work during ordinary use, but its release suite currently reports 11 failures. A marketing release should not rely on a document containing historical pass claims.

**Fix:** make each browser test independent or reset fixture state before every scenario; wait on the exact header element and API response; test mobile from a known list state. Add a real assertion that duplicate requests create exactly one local message and one outbound job.

### 5. A live WhatsApp acceptance test is still required

Mock transports prove internal behavior, not Meta credentials, webhook subscriptions, template approval, delivery callbacks, number quality, or deployment restart recovery.

**Proof required:** customer message reaches the production webhook; chatbot replies; merchant takes over; AI remains silent; merchant reply becomes SENT, DELIVERED and READ when Meta emits those receipts; restart does not lose a job; expired-window reply is blocked or uses an approved template.

## What is now strong

| Area | Current assessment |
| --- | --- |
| Moroccan positioning | Strong differentiation through Darija, French and Arabic support. |
| Client onboarding | Good managed workflow for business data, plans, review, publication and WhatsApp connection. |
| Admin control | Strong for a managed service: per-client configuration, preview, usage, plans and activation. |
| Human handoff | Major improvement. Merchant inbox, takeover, reply, resolve and reopen now exist. |
| Delivery reliability | Good architecture: durable queue, worker separation, receipts, monotonic delivery status and tenant checks. |
| Cost controls | Message/AI/embedding/spend controls exist, including unlimited message-count plans with an internal spend ceiling. |
| Monetization | Weak. Plans exist, but collection, invoices, renewals, revenue, gross margin and dunning do not. |
| Team operations | Early. No proper team seats, round-robin assignment, SLA timers, notifications or agent performance. |
| Integrations | Weak. No production calendar, CRM, Shopify/WooCommerce or payment workflow. |
| Marketing | Weak. No approved-template manager, consent records, segmentation, campaign scheduling or attribution. |

## Competitor comparison

| Capability | Relayqo now | Manychat | respond.io | Wati | Commercial implication |
| --- | --- | --- | --- | --- | --- |
| WhatsApp AI and automation | Yes | Yes | Yes | Yes | “AI chatbot” is not enough differentiation. |
| Darija/local managed setup | Strong potential | Generic global product | Generic global product | Generic global product | This should be the initial sales wedge. |
| Shared inbox and human takeover | New, single-account workflow | Mature inbox and assignments | Mature team/custom inboxes | Shared team inbox | Fix the blockers, then sell this as assisted automation. |
| Multichannel | WhatsApp-focused | WhatsApp plus social, SMS and email | Broad messaging channels | WhatsApp-focused with extensions | Stay focused until WhatsApp retention is proven. |
| Broadcasts/campaigns | No | Yes | Yes | Yes | Revenue opportunity, but consent and template compliance come first. |
| Integrations | Limited | API and business tools | Zapier, Make, developer API, CRM/calendar | Commerce, ads and integrations by tier | One vertical integration can create more value than ten generic features. |
| Billing model | Manual plan assignment | Monthly active contacts and overages | Seats/MACs/AI credits | Subscription, messages and add-ons | Relayqo cannot scale self-service without subscription and margin records. |
| Analytics | Operational metrics | Campaign/contact analytics | Advanced reports | Campaign/operator analytics | Add business outcomes, not more message counters. |

Current public reference points: Manychat prices by monthly active contacts and applies overages; respond.io lists Starter at $79/month, Growth at $159/month and Advanced at $279/month, with mature inbox, workflows and integrations; Wati combines subscription, WhatsApp messaging charges and add-ons. Intercom demonstrates another useful model: charging from $0.99 per AI outcome plus seats. These models show that buyers pay for contacts, seats, workflows or outcomes—not raw LLM tokens.

## Features most likely to increase revenue

### Priority 1: sell measurable outcomes

Add conversion events that merchants can configure: qualified lead, appointment requested, appointment booked, order started, order confirmed and human resolution. Show a weekly report with leads captured, after-hours leads, response time, handoff resolution and missed questions.

This turns the pitch from “chatbot messages” into “leads and staff time saved.” It also supports a higher tier and reduces churn.

### Priority 2: one vertical integration

Choose one initial customer segment.

- Appointment businesses: Google Calendar or a booking-system integration, confirmation and reminder templates.
- Ecommerce: Shopify/WooCommerce catalog, order status and abandoned-cart recovery.
- Property/automotive: lead qualification, budget, location, inventory matching and CRM export.

Do not build all three. Interview five paying prospects and build the workflow with the clearest repeated pain.

### Priority 3: reliable team operations

Add notification for new handoffs, unread badge, named agent assignment, response timer, internal notes, and agent performance. Multi-seat access can become a paid add-on. Round-robin routing matters only after customers have actual teams.

### Priority 4: billing and margin controls

Record subscription status, amount collected, billing period, setup fee, Meta charges, AI costs, hosting allocation, payment fees and support time. Calculate gross margin by client. Add automated payment and renewal only after the offer and preferred Moroccan payment method are validated.

### Priority 5: compliant campaigns

Add template management, explicit opt-in evidence, audience segmentation, scheduling, frequency limits, delivery analytics and campaign attribution. This can generate campaign revenue, but mistakes can damage the WhatsApp number and create Meta charges.

### Priority 6: agency package

After the product works for direct clients, offer agencies a multi-brand overview, white-label reports, reusable templates and volume pricing. This can raise contract value without acquiring every merchant individually.

## Recommended offer to test

Treat these as sales hypotheses, not fixed market facts.

| Offer | Suggested test price | Included value |
| --- | ---: | --- |
| Setup | 1,500–3,000 MAD once | Number connection, business data, FAQs, Darija/French QA and launch test. |
| Essential | 499–799 MAD/month | One WhatsApp number, automated FAQs, business data and monthly report. |
| Sales/Booking | 999–1,499 MAD/month | Workflows, lead capture, one business integration and managed optimization. |
| Team | 1,999+ MAD/month | Multiple agents, assignment, response targets, advanced reporting and priority support. |

Keep Meta/template charges separate or include a clearly capped allowance. Describe “unlimited messages” as no fixed platform message-count cap subject to fair use, Meta policy, provider availability and internal abuse controls.

## Recommended order

1. Fix idempotent send, transcript pagination/window calculation, atomic outbox behavior and browser acceptance tests.
2. Complete one live Meta acceptance run and deployment restart drill.
3. Rotate every credential previously shared during setup.
4. Sell 3–5 paid managed pilots in one segment.
5. Measure setup time, support time, gross margin, leads and retention.
6. Build the winning vertical integration and outcome report.
7. Add payments, team seats and campaigns only when paid demand is visible.

## CEO conclusion

You do need additional capabilities to earn more, but you do not need feature parity with Manychat, respond.io or Wati. Relayqo can earn first revenue with the current focused product after the five launch blockers are closed. The next money-making work is outcome tracking and one vertical integration. Generic multichannel expansion, a mobile app, advanced campaign tooling and enterprise security can wait until clients pay for the core WhatsApp service.
