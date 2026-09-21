# Relayqo product and commercial review

20 September 2026. Public prices and features can vary by country, billing term, and account age; verify the checkout shown to a Moroccan buyer before using a price in a sales pitch.

## Executive assessment

Relayqo has a credible foundation for a managed WhatsApp assistant: tenant accounts, admin approval and publication, a client data workspace, Meta connection flow, configurable business knowledge and workflows, multilingual replies including Darija, admin previews, and per-account usage tracking. Its strongest initial sales angle is **a Moroccan business assistant that understands local customer language and is set up for the merchant**. It is not yet a complete shared-inbox, campaign, CRM, or self-service billing product.

The biggest commercial risk is promising “unlimited messages” while AI-call, embedding, monthly estimated AI-spend, provider rate, and WhatsApp platform constraints can still stop a reply. The new setting removes the *message-count* cap only. Sell it as “no fixed message-count limit, subject to fair use and platform availability” until operational controls support a stronger promise. Show customers the plan and service status; keep granular quota and provider-cost numbers in admin.

## Competitor comparison

| Product | Public starting point and pricing model | What the buyer gets | Relayqo implication |
| --- | --- | --- | --- |
| [Manychat](https://manychat.com/pricing) | Pro: $39 monthly or $29/month billed annually, 2,500 monthly active contacts and overages; Business: $99 monthly or $69/month billed annually, 7,500 active contacts. Regional/legacy accounts can differ. | AI conversation, automations, several channels; Business adds a shared team inbox and assignment. | Competing on “AI chatbot” alone will be difficult. Win on Darija quality, local onboarding, and WhatsApp-specific business workflows. A real team inbox is a priority if merchants need agents. |
| [respond.io](https://respond.io/pricing) | Starter $79/month, Growth $159/month, Advanced $279/month on the public monthly view; Growth/Advanced scale by monthly active contacts and AI credits. WhatsApp charges are extra. | Mature team inbox, AI agents, workflows, broadcasts, reporting, and integrations at higher tiers. | The benchmark for reliability, handoff, analytics and integrations. Avoid claiming feature parity. Their overage model keeps service running but changes the bill; Relayqo needs a clear policy for spikes. |
| [Wati](https://support.wati.io/en/articles/11462993-understanding-wati-s-pricing-structure) | Subscription plus WhatsApp messaging fees plus optional add-ons. [Its plan guide](https://support.wati.io/en/articles/11462997-understanding-wati-s-pricing-plans) also describes included chatbot sessions and extra-session charges. Public prices depend on region/plan. | WhatsApp-first automation, team operations, campaigns and add-ons. | Buyers already expect WhatsApp-specific packaging. Quote the complete monthly cost, including Meta messages and service work, rather than only a platform subscription. |

The comparison uses vendor-published pages checked on 20 September 2026; it is not a claim that each competitor serves Morocco identically. Relayqo features above reflect the current repository, not a production acceptance test with a verified live Meta number.

## CEO view: the risks that can consume margin or trust

1. **Unit economics are incomplete in the dashboard.** Relayqo estimates AI spend but its admin usage screen explicitly excludes WhatsApp, hosting, tax, and payment fees. Add per-account gross margin: subscription collected minus DeepSeek, embeddings, Meta fees, hosting allocation, payment processing, and human support. Do not price from token cost alone. [DeepSeek's published rates](https://api-docs.deepseek.com/quick_start/pricing/) show peak Flash rates of $0.30/M uncached input tokens and $1.20/M output tokens, with rates subject to change. As an illustration, one call with 1,000 input and 200 output tokens is about $0.00054 at those rates; 10,000 such calls would be about $5.40 before retries, extra calls, embeddings, Meta fees, and support.
2. **“Unlimited” can be misleading.** The new admin option removes the message counter but AI calls and estimated AI-spend remain capped. Provider outages and rate limits also exist. Add an admin alert at 50/80/100% internal spend, a safe fallback when AI cannot answer, and a published fair-use policy. Do not silently let the bot go dark.
3. **WhatsApp costs and rules can change.** [Meta's current pricing page](https://whatsappbusiness.com/products/platform-pricing/) prices delivered messages by recipient market and category; it currently states service replies and utility replies in the customer service window are free. Marketing and other templates can incur charges. Check current rate cards and account billing before every campaign or pricing revision. Obtain opt-in for marketing; [Meta's guidance](https://whatsappbusiness.com/wp-content/uploads/2026/04/Best-Practices-for-Marketing-Messages-on-WhatsApp-.pdf) requires it.
4. **Onboarding is service-heavy.** Business verification, number connection, content collection, and QA have already slowed a live setup. Track time from signup to first successful customer message, number of admin touches, and failed connection causes. Offer a paid setup package if this work cannot be automated profitably.
5. **Customer trust requires human recovery.** The current dashboard counts handoff requests, but the portal does not show a staffed shared inbox with ownership, assignment, SLA, and reply controls. Implement that before promising “we handle every conversation.” Also add delivery-failure and webhook-lag alerts, exports, retention rules, and restore drills.
6. **Churn may be hidden by usage.** Count meaningful outcomes: qualified leads, appointments, orders, human handoffs resolved, repeat customers and unanswered questions. A client seeing only message volume may not renew. Let merchants see outcomes and conversation quality, not internal quotas.
7. **Credential exposure deserves immediate cleanup.** Production database, Meta, AI and webhook credentials were shared during setup. Rotate them before marketing, keep replacements in the deployment secret store, and check logs and repository history for copies. A public or reused secret can become a direct cost and customer-data incident.

## Seller view: what to package and say

Start with one segment where WhatsApp enquiries are frequent and repetitive, such as local retail or appointment-based services. The offer should be concrete: “respond to common enquiries in Darija, French and Arabic, capture leads, and pass difficult cases to your team.” Use a 14-day pilot with a baseline: response time, after-hours conversations, captured leads, and staff time saved. Do not promise revenue uplift without measured evidence.

Package by value rather than by raw AI tokens. Suggested structure to validate with pilots: a one-time setup fee; a core monthly package for one number and FAQs; a higher tier for catalog/workflows/knowledge and faster support; optional extras for extra numbers, team seats, integrations, campaigns, and managed optimization. Keep Meta/template fees separate or explicitly include a capped allowance. The public plan page should explain the fair-use policy even if it does not reveal technical quotas. An annual discount should come only after a retention and cost model is measured.

Sales objections to prepare for: “Will this work with my existing number?”, “Can a person take over?”, “What happens when it answers incorrectly?”, “Who pays Meta?”, “What happens if the bot is down?”, and “Can I export my data?” Each needs a demonstrated workflow and a short written answer, not a vague feature claim.

## Prioritized product work

| Priority | Work | Why it matters | Proof of completion |
| --- | --- | --- | --- |
| Before marketing | End-to-end test on a verified Meta number, webhook receipt, reply delivery, restart recovery, and multi-client isolation. | A preview chat is not a live WhatsApp acceptance test. | Test messages sent and received after a fresh deployment, with logs and failure alert. |
| Before marketing | Human inbox or at least reliable handoff notification, owner, and resolution state. | Unanswered escalations create customer harm and refunds. | An agent can claim, respond, close, and audit an escalated conversation. |
| Before marketing | Cost and reliability guardrails: provider bills reconciliation, Meta fee tracking, spend alerts, fallback text, backup/restore drill. | Internal AI estimates are not total cost or an uptime guarantee. | Per-tenant margin report; test of budget exhaustion and provider outage. |
| Before marketing | Rotate shared production credentials and verify tenant authorization paths. | A leaked key or cross-tenant read can create immediate financial and trust damage. | Old keys rejected; access checks and audit logs reviewed. |
| Next | Outcome dashboard and weekly merchant report. | Sell leads and time saved, not message volume. | Qualified leads and missed questions can be checked against actual conversations. |
| Next | Faster onboarding: guided data import, connection troubleshooting, review checklist, demo account. | Reduces support hours per sale. | Median signup-to-first-live-reply and admin touches trend down. |
| Later | CRM/calendar/commerce integrations and agency multi-account support. | Raises switching cost and contract value. | Pilot customers use an integration weekly and pay for it. |

## Metrics to inspect weekly

Commercial: activated accounts, paid conversion, setup hours/account, MRR, gross margin/account, churn, support minutes/account. Product: first-live-reply time, delivered reply rate, median/p95 response latency, escalations resolved, factual correction rate, qualified leads, and % conversations requiring admin intervention. Run each metric by tenant and language, especially Darija, because a strong average can hide a poor local experience.
