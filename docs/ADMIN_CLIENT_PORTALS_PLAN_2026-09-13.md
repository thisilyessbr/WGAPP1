Relayqo admin and client portals — implementation plan

Prepared 13 September 2026. Planning only: no application code, permissions, database, or live services changed for this request.

Build one service with two protected portals connected to the public website. The client supplies and maintains their business data. The platform administrator controls how the chatbot runs, which features the client receives, activation, spending and operational oversight. Both portals use the existing chatbot backend.

Working assumptions: clients represent businesses purchasing Relayqo; their WhatsApp customers are a separate type of person. Actual commercial plan names, prices and included features are not yet specified. The inspected workspace contains a development control-center interface, not an identified public marketing website or a production client signup flow. Integrate with the existing public site once its location is confirmed. Do not invent commercial tiers or replace the site's branding.

**Ownership and permissions**

| Capability | Client portal | Platform admin portal |
| --- | --- | --- |
| Register, log in, recover account, edit own login profile | Yes | Manage access and suspend users; never view passwords |
| Browse available plans | Read published offers; request a plan | Create/version plans, set prices and approve assignments |
| Enter business details | Own permitted business fields | View, correct, approve, lock fields and restore versions |
| Products, services, FAQs, policies, documents | Own data, limited to enabled plan modules | Full management, validation rules and publication policy |
| WhatsApp | Authorize/connect/reconnect own permitted numbers; see connection status | Choose allowed connection method and number allowance; configure routing and activate/pause automation |
| AI provider/model, prompts, temperature, token limits | No access | Configure defaults and overrides for each business/store |
| Intent rules, workflows, routing, handoff behavior | No access | Full control per account |
| Usage quotas, spending budgets and feature switches | No modification | Set, monitor and enforce limits |
| Cross-client statistics, technical logs, AI costs | No access | Platform overview and detailed account views |
| Conversations and lead oversight | Outside the initial client data-only scope | Authorized account-scoped viewing, search and handoff tools |
| Provider credentials and connection secrets | Never exposed in client responses | Configure, replace and revoke; display masked values |
| Activation, suspension and operational overrides | Read status; request support | Full control with an audit trail |

These rules must be enforced by server-side permissions and explicit field allowlists. Hiding controls in the client interface is insufficient. Client-supplied tenant IDs, account IDs, plan IDs or uploaded text must never confer privileges or alter trusted chatbot configuration.

**Client experience**

Public website → choose an offer → create account → verify email → complete business setup → connect WhatsApp → submit for activation → maintain business data.

Proposed pages: /signup, /login, /app/setup, /app/business, /app/data and /app/whatsapp. A small account page handles login details and plan-request status. Keep technical settings and technical statistics out of this portal.

The setup wizard should autosave, show completion progress, explain missing fields in ordinary language and resume where the client stopped. Fields should be driven by the selected plan's admin-defined data template:

- Business identity: display name, contact details, locations, opening hours and factual company information.
- Commerce data when included: products, variants, prices, currency, stock, shipping regions and promotions.
- Service data when included: service descriptions, pricing, service areas, opening/availability information and required customer details. Existing workflows consume these values; the client does not edit workflow logic.
- Knowledge: FAQs, delivery/payment/return policies and documents, subject to file and ingestion allowances.
- WhatsApp: account-scoped connection authorization and a clear connected/action-needed status.

This is a modular form system, not a promise that every example module exists in the user's current commercial plans. Only enabled modules appear, and disabled modules are rejected by the API even if requested manually.

Avoid making the admin re-enter information. Validate client submissions automatically, prepare the knowledge index in the background, and present a concise review containing missing or conflicting information. Recommend admin approval for the first activation. After that, the admin selects per-account publication rules: validated routine changes may publish automatically, while selected fields or policy changes require review. A last-known-good published version remains active while an update is being validated or indexed.

Separate setup state from WhatsApp connection state and bot state. A connected number does not automatically activate the bot. Suggested business states are Draft, Submitted, Needs changes, Approved, Active and Suspended, with independent connection and ingestion statuses.

**Admin experience**

Proposed pages: /admin, /admin/clients, /admin/clients/:id, /admin/plans, /admin/usage and /admin/activity.

The overview shows client count, active/paused accounts, onboarding submissions, connection failures, usage and budget alerts. Selecting a client opens a dedicated workspace with a persistent business name and account selector so actions clearly identify their target.

Each workspace contains business data and publication history; chatbot configuration; intents and workflows; knowledge and catalog status; WhatsApp numbers; conversations and leads; plan and limits; statistics; and an audit history. Admins can pause automation, change per-account configuration, test a draft setup and restore an earlier version. Changing a template must not silently overwrite customized live clients.

Use three configuration layers: platform defaults, versioned plan/template settings, and per-account admin overrides. Client-entered facts remain a separate data layer. Publish an effective configuration only after validation. The administrator owns the technical layers; editing business facts cannot overwrite model settings or remove cost controls.

**Plan and spending management**

Represent commercial plans as versioned records with enabled modules, allowed WhatsApp numbers, upload/storage allowances, message or AI-call allowances, image allowance and a monthly spending ceiling. Their actual names, prices and limits will come from the user. A client's selection creates a plan request; the server assigns entitlements after admin approval or a verified payment event if payments are later integrated.

Use durable, atomic allowance reservations before paid AI/image/embedding work. Reconcile completed usage, retain unknown provider outcomes for review, and enforce limits across workers and channels. Add signup and preview limits so unfinished or unverified accounts cannot consume unrestricted paid services. A plan downgrade must define what happens to extra numbers/documents and in-flight jobs; it must not delete client data implicitly.

Payment processing is not required to prove the first onboarding flow. The first release can support admin-approved subscriptions and recorded payment status. Add a payment-provider integration once the desired payment method is confirmed. Do not treat a client-edited field or browser redirect as evidence of payment.

**Account statistics**

All operational and commercial statistics belong in the admin portal initially. Filter by client, store, WhatsApp number and date range. Collect durable events and build daily summaries so dashboards do not scan every message or call an AI model on each page load.

| Area | Initial measurements |
| --- | --- |
| Activity | Conversations, unique contacts, inbound/outbound messages, daily trends |
| Chatbot behavior | FAQ, catalog, workflow, RAG and AI answers; fallbacks; human handoffs; workflow completions |
| Leads | Captured leads and recorded CRM status changes |
| Language | English, French, Arabic and Darija usage; Arabic script versus Arabizi; fallback frequency by language |
| Reliability | Reply latency, failed jobs, retries, delivery outcomes, disconnected numbers |
| Usage and costs | Actual provider tokens/calls, cache hits, embeddings, images, remaining allowances and unknown usage |
| Onboarding/data | Completion progress, missing fields, indexing failures, last publication and account changes |
| Commercial | Assigned plan, recorded payment status and attributable operating cost where data exists |

Define metric counting rules and deduplicate delivery/job events. Distinguish recorded provider usage, estimated costs and reconciled invoices. Revenue requires billing records; satisfaction requires feedback; a lead is not a completed sale. Do not label a conversation “resolved” solely because no human handoff occurred. WhatsApp and infrastructure costs need their own inputs and must not be silently omitted from totals.

**Reuse and required backend changes**

Reuse the existing conversation engine, Darija routing, Tenant/Account boundaries, account configuration resolver, product/FAQ/document services, channel connection services, queue, safety guard and monitoring service. Preserve the cost and chatbot fixes already validated.

The current schema has Tenant and Account, but no portal User, Membership, commercial Plan/Subscription or spending ledger. Customer represents the end customer chatting on WhatsApp; do not repurpose it as the portal login.

Recommended ownership: one client business owns a Tenant; its stores/chatbot instances are Accounts. A User gains access through an explicit Membership, optionally limited to particular Accounts. Existing data must be mapped before migration, especially if unrelated clients currently share a tenant. Preserve their conversations, knowledge, numbers and credentials during that mapping.

Add identities and revocable sessions, scoped memberships, business-data drafts/publications, versioned plan assignments, durable usage reservations/ledger, onboarding state and platform-wide audit events. Reuse suitable existing records rather than duplicating them. Enforce ownership on reads, writes, uploads, downloads, statistics, connection callbacks and background jobs.

Separate /api/auth, /api/client and /api/admin routes. The current general configuration endpoints and channel-management routes are administrative; do not simply grant clients access to them. Client endpoints return only allowed business fields and connection status. Keep authenticated user identity distinct from the admin's selected client context and record the actual actor on every administrative change.

Use verified registration, secure browser sessions, password recovery, logout/revocation and stronger authentication for platform admins. Never distribute the platform API key to client browsers. Include request validation, browser request protections and account enumeration/abuse controls as part of the permission implementation.

**WhatsApp integration boundary**

Reuse the existing Embedded Signup implementation through new narrowly scoped client onboarding endpoints. Bind each connection attempt to the authenticated user, authorized tenant/account and a single-use expiring server-side record. Verify the callback and claimed number ownership before storing the connection; keep credentials server-side. Enforce the plan's number limit atomically and reject callbacks targeting another client's account.

Retain administrative connection-management endpoints separately. If QR connections remain part of the offering, the administrator decides which accounts may use them; the client can only complete the authorized connection step for their own account. Neither connection method grants the client control of provider settings, routing or bot activation.

Live Meta setup remains an external integration gate. Confirm app configuration, permissions and account-specific prerequisites against current official documentation before implementation and test with a designated business account. The Meta documentation request was rate-limited during planning, so this plan makes no new claim about current verification requirements or fixed numbers of allowed WhatsApp accounts. Do not copy those assumptions from older local runbooks without verification.

**Delivery milestones**

| Milestone | Deliverable | Completion check |
| --- | --- | --- |
| 1. Define boundaries and migration | Confirm website integration and actual plans; approve field/permission matrix, ownership mapping and migration/rollback approach | Every client-editable field and admin-only operation has an explicit rule; existing clients have a mapping |
| 2. Identity and protected portal shells | Registration/login/recovery, memberships, /app and /admin, separate APIs | Client A cannot read or change client B's data or reach admin operations; existing bot traffic remains functional |
| 3. Client data and admin workspace | Autosaving setup forms, data validation/imports, draft publication, account selector and admin configuration | A client supplies a complete usable dataset without admin re-entry; admin can review, customize and restore it |
| 4. Plans, spending and WhatsApp | Versioned entitlements, enforced allowances, scoped connection flow, activation gate | Forged plan/connection requests fail; concurrent paid work cannot overspend the allowance; linking alone does not activate automation |
| 5. Statistics and operational controls | Durable usage/event summaries, per-account dashboards, alerts, pause controls and audit history | Seeded activity reconciles with dashboard counts; unknown costs remain labeled; admins can manage one client without affecting another |
| 6. Pilot and rollout | Browser tests, isolated database tests, real designated WhatsApp pilot and staged migration | One client completes signup → data → connection → admin activation → incoming WhatsApp reply; English/French/Arabic/Darija and rollback checks pass |

Implementation should begin with a single end-to-end pilot, not every possible dashboard chart. The first usable release still needs identity isolation, client data entry, admin controls, enforced allowances and a verified connection/activation flow. Additional charts, self-service payment upgrades and larger client-team roles can follow that complete flow.

**Required verification before release**

- Prove permissions by calling APIs directly, including guessed account/document/conversation IDs and client attempts to change technical fields.
- Prove auth recovery, session revocation and administrator access controls in the browser.
- Test duplicate signup callbacks, expired authorization, repeated uploads, plan downgrades and concurrent usage reservations.
- Test atomic publication, cache invalidation and rollback while live conversations continue using a valid configuration.
- Preserve the existing chatbot/Darija tests; use a dedicated test database for migrations and isolation tests, not customer data.
- Validate statistics against known fixtures and run a real WhatsApp pilot before claiming live onboarding works.
- Migrate existing accounts in stages with snapshots, backfills and compatibility checks; keep current clients on their working path until the new one is verified.

Outstanding inputs: the existing public site's location and design, the actual plan names/features/limits, and the desired payment method if automated checkout is required. These refine the forms and commercial flow without changing the two-portal permission model.

Local references: [current UI](C:/Users/IlyesSaber/Desktop/work/src/dev/ui/index.html), [account configuration](C:/Users/IlyesSaber/Desktop/work/src/domain/tenant/AccountConfigService.ts), [WhatsApp onboarding routes](C:/Users/IlyesSaber/Desktop/work/src/domain/channel/whatsapp/WhatsAppOnboardingRouter.ts), [database schema](C:/Users/IlyesSaber/Desktop/work/prisma/schema.prisma), and [cost audit](C:/Users/IlyesSaber/Desktop/work/docs/COST_AUDIT_2026-09-13.md).
