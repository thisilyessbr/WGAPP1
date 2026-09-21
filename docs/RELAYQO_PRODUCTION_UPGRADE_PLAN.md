# Relayqo — Production Upgrade Plan & System Architecture Audit

**Document Version:** 1.0.0  
**Date:** September 20, 2026  
**Auditor:** Lead Software Architect  
**Classification:** Proprietary / Engineering Strategy  

---

## Executive Summary

Relayqo is a specialized multi-tenant conversational AI platform designed for Moroccan e-commerce and retail merchants. It enables merchants to automate customer communication on WhatsApp in Moroccan Darija (both Arabic script and Arabizi), French, English, and Modern Standard Arabic.

The platform has achieved significant engineering maturity in core domains:
1. Deterministic conversational intent resolution (greetings, workflows, FAQs, catalog lookup, human handoff).
2. Resilient Darija prompt composition with strict tone calibration.
3. Durable PostgreSQL-backed FIFO queueing for WhatsApp webhooks with lease recovery.
4. AES-256-GCM encrypted credential isolation (`SecretBox`) for client Meta tokens.
5. Multi-tenant administrative and merchant portals with audit logs and usage budgets.

However, to transition from an advanced pre-production state into an enterprise-grade commercial SaaS, Relayqo requires addressing critical architectural risks:
- Plaintext secrets present on disk in local `.env` and `.env.production` files.
- Dual router surface exposing legacy/development endpoints in production.
- Monolithic process bottleneck where Express webhooks, LLM token waits, and heavy PDF document ingestion compete for the same Node.js event loop and database connections.
- The lack of a merchant-facing live chat inbox for human handoff triage.
- In-memory rate limiting and loose customer-to-account scoping.

This document presents a comprehensive 20-subsystem audit, a prioritized security and reliability review, and an actionable, phased upgrade roadmap.

---

## 1. System-Wide Subsystem Audit (20 Subsystems)

### 1.1 Frontend Architecture
* **Relevant Files:** `src/portal/ui/index.html`, `src/portal/ui/portal.js`, `src/portal/ui/portal.css`, `src/portal/ui/theme.js`, `src/portal/ui/i18n.js`, `src/portal/ui/design.js`, `src/portal/ui/workflows.js`, `src/dev/ui/index.html`.
* **Current Implementation:** Modern vanilla JavaScript Single-Page Application (SPA) with zero external runtime build dependencies. Features client-side state routing (`/signup`, `/login`, `/verify-email`, `/reset-password`, `/app`, `/admin`), multi-language switching (EN, FR, AR, Darija), CSS custom properties for theming, and an embedded workflow visualizer.
* **Known Weaknesses:** 
  - Monolithic `portal.js` (~66 KB) manages all view rendering and API calls procedurally via DOM manipulation.
  - Lacks optimistic UI updates and real-time push (Server-Sent Events or WebSockets) for inbound WhatsApp messages and handoff alerts; relies on periodic polling.
* **Dependencies:** None (pure browser DOM APIs, Meta JavaScript SDK for Embedded Signup).
* **APIs / Endpoints:** `/api/auth/*`, `/api/client/*`, `/api/admin/*`, `/api/portal/*`.
* **Existing Tests:** `tests/integration/portal-browser.spec.ts`, `tests/integration/portal.spec.ts`.

### 1.2 Backend Architecture
* **Relevant Files:** `src/app.ts`, `src/bootstrap.ts`, `src/config/env.ts`.
* **Current Implementation:** Express 5.x application structured as an onion architecture. Configures reverse proxy trust (`trust proxy: 1`), security headers (`nosniff`, `DENY`, HSTS in production, strict CSP), raw body buffer preservation for webhook HMAC verification, and centralized dependency injection in `bootstrapChatbot()`.
* **Known Weaknesses:**
  - Single Node.js process orchestrates API handling, webhook processing, queue polling, and PDF parsing.
  - Hardcoded `trust proxy: 1` can misidentify client IPs if deployed behind multi-hop proxies (e.g. Cloudflare + Caddy).
* **Dependencies:** `express`, `cors`, `dotenv`, `pg`, `@prisma/client`, `@prisma/adapter-pg`.
* **APIs / Endpoints:** Mounts `/health`, `/api/v1/webhook/whatsapp`, `/api/v1/whatsapp`, `/api/v1/channels`, `/api/portal`, `/api/client`, `/api/admin`, `/api/v1`, `/api`.
* **Existing Tests:** `tests/integration/portal.spec.ts`, `tests/smoke/live-smoke-43c.spec.ts`.

### 1.3 Database & Schema
* **Relevant Files:** `prisma/schema.prisma`, `prisma.config.ts`, `prisma/migrations/*`.
* **Current Implementation:** PostgreSQL database utilizing the `pgvector` extension for semantic vector search. Prisma Client 7.x connected via `pg` connection pooling (`PrismaPg`). Employs row-level locking (`FOR UPDATE SKIP LOCKED`) and advisory locks for queue arbitration.
* **Known Weaknesses:**
  - `DATABASE_POOL_MAX` defaults to 5 to avoid overwhelming free/small Supabase tiers, creating connection contention between queue pollers and incoming webhooks.
  - Binary PDF files are stored directly in `PortalDocument.bytes` (`Bytes`), causing table and WAL bloat.
* **Database Models:** 28 models including `Tenant`, `Account`, `Customer`, `Conversation`, `Message`, `WorkflowSession`, `KnowledgeChunk`, `Product`, `Lead`, `WhatsAppMessageJob`, `PortalUser`, `PortalPlan`, `PortalProfile`, `PortalUsageBucket`.
* **Existing Tests:** `src/tests/db.test.ts`, `tests/integration/account-foundation.spec.ts`.

### 1.4 Authentication & Authorization
* **Relevant Files:** `src/portal/PortalAuth.ts`, `src/middleware/authMiddleware.ts`, `src/dev/chatApi.ts`.
* **Current Implementation:** 
  - Portal: HttpOnly, Secure, SameSite=Lax session cookies (`relayqo_portal`), 64-byte scrypt password hashing with unique salts, cryptographically random CSRF tokens (`x-csrf-token`), timing-safe comparisons, email verification tokens, and two-step email confirmation for admin logins.
  - API: HMAC-SHA256 signed bearer tokens with tenant/customer claims and `x-api-key` validation.
* **Known Weaknesses:**
  - `getAuthSecret()` in `chatApi.ts` has fallback default secret keys in test and development modes.
  - Legacy test bypass in `authMiddleware.ts` allows `x-tenant-id` spoofing when test flags are present.
* **APIs / Endpoints:** `/api/auth/signup`, `/api/auth/login`, `/api/auth/logout`, `/api/auth/session`, `/api/auth/admin-confirm`.
* **Existing Tests:** `tests/unit/portal-config.spec.ts`, `tests/integration/portal.spec.ts`, `tests/unit/production-security-boundaries.spec.ts`.

### 1.5 Multi-Tenant Model
* **Relevant Files:** `src/domain/tenant/TenantConfigService.ts`, `src/domain/tenant/AccountConfigService.ts`, `src/domain/tenant/BusinessConfig.ts`.
* **Current Implementation:** Two-tier tenant hierarchy: `Tenant` (organization/business) contains multiple `Account` records (individual stores, brands, or WhatsApp channel configurations). Configuration inheritance merges global tenant defaults with account-level overrides (`AccountConfigService`).
* **Known Weaknesses:**
  - `Customer` table has `@@unique([tenantId, externalId])` rather than being scoped to `accountId`, risking cross-account customer collision within the same parent tenant.
* **Database Models:** `Tenant`, `Account`, `TenantConfig`, `PortalMembership`, `PortalProfile`.
* **Existing Tests:** `tests/integration/client-tenant-isolation.spec.ts`, `tests/integration/account-foundation.spec.ts`.

### 1.6 WhatsApp & Meta Integration
* **Relevant Files:** `src/domain/channel/whatsapp/WhatsAppOnboardingService.ts`, `src/domain/channel/whatsapp/WhatsAppOutboundAdapter.ts`, `src/domain/channel/whatsapp/WhatsAppNumberService.ts`, `src/domain/channel/routing/ChannelRouter.ts`, `src/domain/channel/routing/MetaCloudTransport.ts`.
* **Current Implementation:** Meta Cloud API (`v26.0`). Implements Meta Embedded Signup with OAuth code exchange for granular System User Access Tokens. Phone numbers are stored in `WhatsAppBusinessNumber` and linked to `ChannelConnection`. Outbound adapter enforces exponential backoff on retryable Meta error codes (e.g. rate limits, transient 500s).
* **Known Weaknesses:**
  - Token refresh/expiry detection does not alert merchants proactively before token expiration.
* **Database Models:** `WhatsAppBusinessNumber`, `ChannelConnection`, `ChannelSessionSecret`.
* **Existing Tests:** `tests/integration/whatsapp-embedded-signup.spec.ts`, `tests/integration/whatsapp-outbound-adapter.spec.ts`.

### 1.7 Webhook Processing
* **Relevant Files:** `src/domain/channel/whatsapp/WhatsAppWebhookRouter.ts`, `src/domain/channel/whatsapp/WhatsAppWebhookExtractor.ts`, `src/domain/channel/whatsapp/WhatsAppSignatureValidator.ts`.
* **Current Implementation:** Fail-closed HMAC-SHA256 signature verification using `crypto.createHmac` against the raw request buffer (`rawBody`). Extracts incoming messages, resolves destination account from `phoneNumberId`, and immediately enqueues the job into `PostgresMessageQueue` with HTTP 200 acknowledgment.
* **Known Weaknesses:**
  - Status updates (`delivered`, `read`, `failed`) are acknowledged with `status: 'ACK'` but are not currently stored in `WhatsAppMessageJob` or processed into delivery analytics.
* **Database Models:** `WhatsAppMessageJob`, `WhatsAppIdempotencyKey`.
* **Existing Tests:** `tests/unit/whatsapp-webhook-idempotency.spec.ts`, `tests/integration/whatsapp-durable-postgres-queue.spec.ts`.

### 1.8 AI Provider Integration
* **Relevant Files:** `src/core/llm/LLMFactory.ts`, `src/core/llm/DeepSeekProvider.ts`, `src/core/llm/GeminiLLMProvider.ts`, `src/core/llm/MeteredLLMProvider.ts`, `src/core/llm/ResponseDeadline.ts`.
* **Current Implementation:** Multi-provider architecture supporting DeepSeek (`deepseek-chat`, `deepseek-reasoner` / V3 / V4) and Google Gemini (`gemini-2.0-flash`). Dynamic provider resolution per tenant. `ResponseDeadline` enforces an 8.5-second hard timeout on LLM calls. `MeteredLLMProvider` records token usage and latencies.
* **Known Weaknesses:**
  - Streaming responses are not supported over WhatsApp; all completions must buffer completely before outbound dispatch.
* **Existing Tests:** `tests/integration/llm-factory.spec.ts`, `tests/unit/deepseek-cost-controls.spec.ts`.

### 1.9 Embedding & Vector Storage
* **Relevant Files:** `src/core/rag/EmbeddingProvider.ts`, `src/core/rag/GeminiEmbeddingProvider.ts`, `src/domain/rag/KnowledgeRepository.ts`.
* **Current Implementation:** Google `text-embedding-004` (768 dimensions) with PostgreSQL `pgvector` extension. Cosine similarity operator (`<=>`) is queried with strict tenant and account SQL predicates.
* **Known Weaknesses:**
  - When `GOOGLE_API_KEY` is missing or fails, falls back to `UnavailableEmbeddingProvider`, completely disabling knowledge search rather than utilizing a cached or secondary provider.
* **Database Models:** `KnowledgeChunk`.
* **Existing Tests:** `tests/integration/account-scoped-rag.spec.ts`, `tests/unit/query-embedding-lru-cache.spec.ts`.

### 1.10 Knowledge-Base System
* **Relevant Files:** `src/domain/rag/PdfIngestionService.ts`, `src/domain/rag/RAGService.ts`, `src/domain/rag/RtlTextNormalizer.ts`, `src/domain/rag/PolicyEvidenceReuse.ts`, `src/domain/faq/FaqMatcher.ts`.
* **Current Implementation:** Two-tiered retrieval:
  1. Fast-Path FAQ: In-memory exact/fuzzy regex matching in Darija, Arabic, French, and English without LLM overhead.
  2. RAG Pipeline: PDF ingestion, sliding window chunking, RTL Arabic text normalization, pgvector cosine search, policy evidence caching, and chunk quality classification.
* **Known Weaknesses:**
  - PDF text extraction runs synchronously inside the Node.js event loop using `pdf-parse`, risking CPU starvation on complex or multi-page documents.
* **Database Models:** `KnowledgeSource`, `KnowledgeDocument`, `KnowledgeChunk`, `PortalDocument`.
* **Existing Tests:** `tests/integration/pdf-quality-35e.spec.ts`, `tests/integration/faq-fast-path-38b.spec.ts`.

### 1.11 Conversation & Message Model
* **Relevant Files:** `src/domain/conversation/ConversationEngine.ts`, `src/domain/conversation/ConversationContext.ts`, `src/domain/conversation/TurnDecision.ts`, `src/domain/conversation/AnswerComposer.ts`, `src/core/engine/WorkflowEngine.ts`, `src/domain/ecommerce/EcommerceService.ts`.
* **Current Implementation:** Deterministic turn-decision state machine (`TurnDecisionResolver`). Evaluates signals in strict precedence:
  1. Human handoff / takeover
  2. Active workflow state (e.g. order confirmation, appointment booking)
  3. Safe FAQ match
  4. E-commerce intent (product lookup, variant inquiry, price, stock)
  5. RAG knowledge search
  6. Conversational fallback
* **Known Weaknesses:**
  - `ConversationEngine.ts` is 2,897 lines long, concentrating too much orchestration logic in a single file.
* **Database Models:** `Conversation`, `Message`, `WorkflowSession`, `Customer`.
* **Existing Tests:** `tests/integration/turn-decision.spec.ts`, `tests/integration/workflow-conversation.spec.ts`.

### 1.12 Admin Dashboard
* **Relevant Files:** `src/portal/PortalRouter.ts:128-303`, `src/portal/ui/portal.js`.
* **Current Implementation:** Web interface at `/admin`. Provides platform-wide KPIs: active merchants, total message volume, aggregate LLM token costs, connection health, and failed deliveries. Supports account review, draft-to-published diff inspection, field locking, commercial plan creation, and global human handoff triage.
* **Known Weaknesses:**
  - Lacks real-time push alerts when new handoff requests arrive; administrators must refresh or wait for polling.
* **Database Models:** `PortalProfile`, `PortalPlan`, `PortalPublication`, `PortalAudit`.
* **Existing Tests:** `tests/integration/portal.spec.ts`.

### 1.13 Client / Merchant Dashboard
* **Relevant Files:** `src/portal/PortalRouter.ts:66-126`, `src/portal/ui/portal.js`.
* **Current Implementation:** Merchant workspace at `/app`. Allows business data configuration (hours, policies, tone, FAQs), catalog PDF upload, WhatsApp number connection status, and basic conversation volume metrics.
* **Known Weaknesses:**
  - **No live conversation inbox:** Merchants can see masked customer identifiers (`Customer ••••1234`) but cannot view full chat histories or manually send WhatsApp replies from their dashboard.
* **Database Models:** `PortalProfile`, `PortalDocument`, `PortalConnectionAttempt`.
* **Existing Tests:** `tests/integration/portal-browser.spec.ts`.

### 1.14 Usage Tracking
* **Relevant Files:** `src/portal/PortalBudget.ts`, `src/core/telemetry/TelemetryClient.ts`, `src/core/telemetry/CostAnalyticsService.ts`.
* **Current Implementation:** Dual tracking:
  1. High-level billing: `PortalUsageBucket` aggregates monthly `messages`, `llmCalls`, `images`, `embeddings`, and `spentMicros`.
  2. Granular telemetry: `PortalUsageEntry` records every AI operation with deduplication keys and millisecond latency.
* **Known Weaknesses:**
  - Micro-dollar calculation relies on hardcoded DeepSeek USD pricing formulas without supporting dynamic provider price updates.
* **Database Models:** `PortalUsageBucket`, `PortalUsageEntry`.
* **Existing Tests:** `tests/unit/deepseek-cost-controls.spec.ts`, `tests/integration/cost-observability.spec.ts`.

### 1.15 Billing & Subscription Logic
* **Relevant Files:** `src/portal/PortalPlan.ts`, `src/portal/PortalBudget.ts`, `src/portal/PortalStore.ts`.
* **Current Implementation:** Admin-defined `PortalPlan` tiers with monthly quotas (`messages`, `llmCalls`, `images`, `embeddings`, `monthlyUsd`). `PortalBudget.reserve()` acquires a pre-flight row lock and throws HTTP 402 `ALLOWANCE_EXHAUSTED` if a tenant exceeds limits.
* **Known Weaknesses:**
  - Plans specify price in Moroccan Dirhams (`currency: 'MAD'`), while limits and usage tracking calculate in micro-USD (`spentMicros`), creating an impedance mismatch without automated currency conversion.
  - No automated payment gateway integration (e.g. CMI, Stripe) for merchant self-service subscription renewals.
* **Database Models:** `PortalPlan`, `PortalProfile`.
* **Existing Tests:** `tests/unit/portal-config.spec.ts`.

### 1.16 Background Jobs & Queues
* **Relevant Files:** `src/domain/channel/whatsapp/MessageQueue.ts`, `src/domain/channel/whatsapp/WhatsAppWorker.ts`, `src/portal/PortalDocuments.ts`.
* **Current Implementation:** Distributed PostgreSQL queue (`PostgresMessageQueue`). Uses `WhatsAppMessageJob` table with transactional advisory locks (`pg_advisory_xact_lock`) and `FOR UPDATE SKIP LOCKED`. Guarantees strict FIFO per partition (`tenantId:accountId:waId`). Automatically reclaims expired leases after 60 seconds.
* **Known Weaknesses:**
  - `PORTAL_DOCUMENT_WORKER` defaults to `false` in development and requires separate activation in production.
  - In-process queue worker competes with Express HTTP server threads.
* **Database Models:** `WhatsAppMessageJob`, `PortalDocument`.
* **Existing Tests:** `tests/integration/whatsapp-durable-postgres-queue.spec.ts`, `tests/unit/whatsapp-queue-concurrency.spec.ts`.

### 1.17 Logging & Error Handling
* **Relevant Files:** `src/utils/logger.ts`, `src/core/security/SecretBox.ts`.
* **Current Implementation:** Structured logging with Winston. Outbound adapter and secret box strictly suppress and sanitize Meta access tokens, database passwords, and client keys from log lines.
* **Known Weaknesses:**
  - Logs are output to stdout without structured OpenTelemetry export to an external log aggregator (e.g. Datadog, Grafana Loki, or Axiom).
* **Existing Tests:** `tests/unit/whatsapp-security-remediation.spec.ts`.

### 1.18 Environment & Secrets Management
* **Relevant Files:** `src/config/env.ts`, `src/core/security/SecretBox.ts`, `.env`, `.env.production`.
* **Current Implementation:** Boot-time environment validation in `src/config/env.ts`. Symmetrical AES-256-GCM encryption (`SecretBox`) for all persisted database credentials.
* **Known Weaknesses:**
  - Live production Supabase connection strings, Meta app secrets, and AI API keys are stored on disk in `.env` and `.env.production`.
* **Existing Tests:** `tests/unit/secret-box.spec.ts`.

### 1.19 Tests
* **Relevant Files:** `tests/integration/*`, `tests/unit/*`, `tests/smoke/*`.
* **Current Implementation:** Comprehensive Vitest suite with over 80 test specs covering multi-tenant isolation, Darija dialect semantics, prompt compaction, durable queue concurrency, and browser workflows with Playwright.
* **Known Weaknesses:**
  - Several older integration tests depend on live database connections or local pglite instances that can experience timeout flakiness if run concurrently.
* **Existing Tests:** Full test suite verified passing (`test:portal` passed 26/26).

### 1.20 Deployment Infrastructure
* **Relevant Files:** `Dockerfile`, `render.yaml`, `scripts/portal-admin.cjs`.
* **Current Implementation:** Production Dockerfile based on `node:24-bookworm-slim` with built-in healthcheck (`/health`). `render.yaml` blueprint declares Starter web service, PostgreSQL connection pool tuning, and automatic database migration execution (`npx prisma migrate deploy`).
* **Known Weaknesses:**
  - Web and worker run in a single container. High CPU load from PDF processing can starve webhook ingestion.
* **Existing Tests:** Docker build and container healthcheck verified.

---

## 2. Critical Security Audit Findings

| ID | Finding | Location | Severity | Description & Impact | Remediation Recommendation |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **SEC-01** | **Live Production Credentials on Filesystem** | `.env`, `.env.production` | **CRITICAL** | Raw production credentials (Supabase DB password, Meta App Secret, DeepSeek API Key, Google API Key, Encryption Keys) are stored in plaintext configuration files on disk and have appeared in past conversation context. | 1. Immediately rotate Supabase DB password, Meta App Secret, DeepSeek API key, and Google API key.<br>2. Generate fresh 256-bit `ENCRYPTION_KEY` and `SIGNUP_STATE_SECRET`.<br>3. Remove `.env.production` from disk. Rely exclusively on host environment variables. |
| **SEC-02** | **Hardcoded Auth Secret Fallbacks** | `src/dev/chatApi.ts:65-75` | **HIGH** | `getAuthSecret()` falls back to hardcoded string constants (`test-hmac-auth-secret-key-32chars!`, `dev-local-control-center-secret-key-32chars!`) when `AUTH_SECRET` is unset. | Remove all hardcoded string fallbacks. In all environments, fail-closed and throw an exception if `AUTH_SECRET` is not explicitly set with $\ge 32$ bytes of entropy. |
| **SEC-03** | **Unrestricted Route Exposure on Public API** | `src/app.ts:137-138`, `src/dev/chatApi.ts` | **HIGH** | `apiRouter` (from `chatApi.ts`) is mounted at `/api/v1` and `/api`. While `/api/dev` is disabled in production, routes such as `/api/v1/bootstrap`, `/api/v1/upload`, `/api/v1/products`, and `/api/v1/pilot-harness/chat` remain reachable. | Separate development/test endpoints from production APIs. Mount only strictly needed business routes on `/api/v1` and decommission `/bootstrap` and `/pilot-harness` in production. |
| **SEC-04** | **In-Memory Rate Limiter in Chat API** | `src/dev/chatApi.ts:213-247`, `src/utils/rateLimiter.ts` | **MEDIUM** | Route protection in `chatApi.ts` uses an in-memory sliding window. Under horizontal scaling or container restarts, limits reset, allowing rate-limit bypass. | Replace in-memory rate limiting in `chatApi.ts` with the distributed PostgreSQL `PortalThrottle` mechanism already implemented in `PortalStore.ts`. |
| **SEC-05** | **Tenant-Level Customer Uniqueness Collision** | `prisma/schema.prisma:88`, `src/domain/conversation/ConversationService.ts` | **MEDIUM** | `Customer` has constraint `@@unique([tenantId, externalId])`. In multi-account setups where an organization runs separate brands, a customer interacting with Brand A and Brand B shares the same `Customer` entity. | Scope customers to accounts: update constraint to `@@unique([tenantId, accountId, externalId])` to guarantee strict brand isolation. |
| **SEC-06** | **Database-Stored Binary PDF Uploads** | `src/portal/PortalDocuments.ts:40-70`, `prisma/schema.prisma:482` | **MEDIUM** | Uploaded merchant PDFs are stored as raw binary blobs in PostgreSQL (`PortalDocument.bytes`). Processing 10MB PDFs in-database risks buffer exhaustion and massive database backup bloat. | Move PDF storage to an external S3-compatible object store (e.g. Cloudflare R2 or AWS S3) and store only the secure object URI and SHA-256 hash in Postgres. |
| **SEC-07** | **Webhook HMAC Bypass in Non-Production** | `src/domain/channel/whatsapp/WhatsAppWebhookRouter.ts:42-52` | **LOW** | When `appSecret` is unset in non-production environments, webhooks are processed without signature verification, risking spoofing during staging tests. | Enforce fail-closed signature verification in staging environments. Only allow bypass in automated unit tests utilizing explicit mock signatures. |
| **SEC-08** | **Fixed Proxy Trust Configuration** | `src/app.ts:21` | **LOW** | `app.set('trust proxy', 1)` assumes exactly one proxy hop. If traffic passes through Cloudflare and an edge reverse proxy (e.g. Caddy), `req.ip` will reflect the internal proxy rather than the client. | Parameterize proxy trust via `TRUST_PROXY_HOPS` environment variable. |

---

## 3. Reliability & Operational Findings

| ID | Finding | Location | Severity | Description & Impact | Remediation Recommendation |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **REL-01** | **Single-Process Monolith Bottleneck** | `src/app.ts:186-193`, `src/bootstrap.ts` | **HIGH** | Webhook intake, LLM generation, PostgreSQL queue polling, and PDF parsing run inside a single Node.js process. CPU-heavy tasks block the event loop, risking webhook timeouts from Meta (> 15s). | Decouple into two execution profiles: (1) HTTP Web API & Webhook Service, (2) Background Queue & Document Worker. |
| **REL-02** | **Supabase Connection Pool Starvation** | `src/app.ts:173-182`, `MessageQueue.ts:244` | **HIGH** | `DATABASE_POOL_MAX` is set to 5 to protect small Supabase instances. Transaction advisory locks (`pg_advisory_xact_lock`) and continuous queue polling can exhaust available connections. | Route long-lived queue workers to direct PostgreSQL (`DIRECT_URL`) with dedicated connection pools, reserving PgBouncer pool for short HTTP API requests. |
| **REL-03** | **Missing Merchant Live Handoff UI** | `src/portal/PortalRouter.ts:169`, `src/portal/ui/portal.js` | **HIGH** | While `/admin/handoffs` exists for platform admins, the Merchant Portal (`/app`) has no live chat inbox to view ongoing conversations, inspect customer context, or manually reply to WhatsApp users. | Develop a dedicated "Live Inbox" in the Client Portal with real-time SSE updates and two-way WhatsApp message dispatch. |
| **REL-04** | **Unprocessed Delivery Status Receipts** | `src/domain/channel/whatsapp/WhatsAppWebhookExtractor.ts` | **MEDIUM** | Inbound Meta delivery receipts (`sent`, `delivered`, `read`, `failed`) are acknowledged with HTTP 200 but not persisted to update `WhatsAppMessageJob.outboundStatus`. | Store incoming delivery receipts in `WhatsAppMessageJob` and update analytics so merchants see message delivery confirmations. |
| **REL-05** | **Currency Calculation Discrepancy** | `src/portal/PortalBudget.ts:109`, `PortalPlan` | **MEDIUM** | Commercial plans are defined in MAD (`currency: 'MAD'`), but budget limits and usage buckets calculate in micro-USD (`spentMicros`) based on DeepSeek USD rates. | Normalize usage metrics to display both MAD and USD with configurable exchange rates in the admin and merchant dashboards. |
| **REL-06** | **Unmanaged Document Ingestion Lifecycle** | `src/portal/PortalDocuments.ts:100-150` | **MEDIUM** | `PORTAL_DOCUMENT_WORKER` defaults to `false` in development. If omitted in production, merchant document uploads stay in `PENDING` status indefinitely. | Guarantee document ingestion workers run automatically or trigger via lightweight asynchronous jobs upon upload completion. |

---

## 4. Current Request, Message & AI Lifecycles

### 4.1 Inbound WhatsApp Webhook Request Lifecycle

```
[Customer on WhatsApp]
          │  (Sends message)
          ▼
[Meta Cloud API Platform]
          │  (POST HTTPS webhook with X-Hub-Signature-256)
          ▼
[Express Webhook Router]  (src/domain/channel/whatsapp/WhatsAppWebhookRouter.ts)
   ├── 1. Verify HMAC-SHA256 signature using rawBody buffer
   ├── 2. Extract message payload (wamid, waId, text/media, phoneNumberId)
   ├── 3. Resolve account: WhatsAppNumberService.resolveAccountByPhoneNumberId()
   ├── 4. Enqueue job into PostgresMessageQueue (table: WhatsAppMessageJob)
   └── 5. Return HTTP 200 { status: 'ACK' } to Meta in < 150ms
```

### 4.2 Background Queue & AI Turn Lifecycle

```
[PostgresMessageQueue Worker]  (src/domain/channel/whatsapp/WhatsAppWorker.ts)
   ├── 1. Atomically claims job via SELECT FOR UPDATE SKIP LOCKED
   │      (Sets status = 'PROCESSING', lease timeout = 60s)
   │
   ├── 2. ClientSafetyGuard evaluation (botEnabled, pause state, human takeover)
   │
   ├── 3. ConversationEngine.handleMessage() execution:
   │      ├── Language Detection: Darija Arabic, Arabizi, French, or English
   │      ├── Intent & Turn Decision (GreetingRouter, WorkflowEngine, FaqMatcher)
   │      ├── E-commerce search (ProductRepository) if commercial intent detected
   │      ├── RAG Semantic Search (pgvector cosine <=> on KnowledgeChunk)
   │      ├── PortalBudget.wrapLLM: Verifies balance & pre-reserves budget tokens
   │      ├── LLM Execution: DeepSeekProvider or GeminiLLMProvider (ResponseDeadline 8.5s)
   │      └── Persist message in PostgreSQL Conversation & Message tables
   │
   ├── 4. WhatsAppPolicyAdapter: Checks Meta 24-hour customer service window
   │
   ├── 5. ChannelRouter -> WhatsAppOutboundAdapter:
   │      ├── Decrypts tenant Meta access token via SecretBox (AES-256-GCM)
   │      └── POST https://graph.facebook.com/v26.0/{phoneNumberId}/messages
   │
   └── 6. Settlement:
          ├── Mark WhatsAppMessageJob status = 'COMPLETED'
          └── Settle PortalUsageBucket spentMicros with actual token usage
```

---

## 5. Recommended Architecture & Target Layout

To ensure long-term stability without future migrations, Relayqo will be deployed on a dedicated Ubuntu 24.04 LTS VPS managed via Docker Compose and Caddy.

```
                                relayqo.online (Vercel)
                                   [Marketing Site]
                                          │
WhatsApp User ────► Meta Cloud API ───────┼──► DNS: app.relayqo.online (A Record)
                                          │                   │
                                          ▼                   ▼
                     ┌─────────────────────────────────────────────────────────┐
                     │              UBUNTU 24.04 VPS (e.g. 4GB RAM)            │
                     │                                                         │
                     │   Caddy Reverse Proxy (Auto Let's Encrypt HTTPS / SSL)  │
                     │      │                                                  │
                     │      ├──► :3000 Web Service (app-web)                   │
                     │      │       - Express API                              │
                     │      │       - Webhook Ingestion Receiver               │
                     │      │       - Client & Admin Portals                   │
                     │      │                                                  │
                     │      └──► (Internal) Queue Worker (app-worker)          │
                     │              - PostgreSQL Queue Poller                  │
                     │              - Conversation & AI Engine                 │
                     │              - Outbound WhatsApp Dispatch               │
                     │              - Document Ingestion Worker                │
                     └────────────────────────────┬────────────────────────────┘
                                                  │
                                                  ▼
                                      Supabase PostgreSQL + pgvector
```

### Architectural Principles:
1. **Process Separation:** The web service (`app-web`) handles HTTP requests and webhook intake, guaranteeing sub-second response times to Meta. The background worker (`app-worker`) handles LLM token streaming, RAG vector searches, and outbound delivery.
2. **Automated Zero-Touch SSL:** Caddy handles Let's Encrypt certificates automatically with zero cron jobs or certbot maintenance.
3. **Container Isolation & Portability:** Docker Compose orchestrates application containers with memory boundaries, log rotation (`json-file`, max 10MB), and health checks.

---

## 6. Required Database Changes

```prisma
// 1. Scope Customer strictly to Account
model Customer {
  id            String         @id @default(uuid())
  tenantId      String
  accountId     String         // Added: Strict account isolation
  externalId    String?        // Customer's WhatsApp phone number
  metadata      Json?
  createdAt     DateTime       @default(now())
  updatedAt     DateTime       @updatedAt
  conversations Conversation[]
  leads         Lead[]
  tenant        Tenant         @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  account       Account        @relation(fields: [accountId], references: [id], onDelete: Cascade)

  @@unique([tenantId, accountId, externalId]) // Replaces @@unique([tenantId, externalId])
  @@index([tenantId, accountId])
}

// 2. Track WhatsApp Message Delivery Receipts
// Update WhatsAppMessageJob model:
model WhatsAppMessageJob {
  // Existing fields...
  deliveryStatus      String?   @default("PENDING") // SENT, DELIVERED, READ, FAILED
  deliveredAt         DateTime?
  readAt              DateTime?
  errorCode           String?
  errorDescription    String?
}

// 3. Move PDF Storage out of Postgres to Object Storage
model PortalDocument {
  id         String    @id
  accountId  String
  filename   String
  hash       String
  storageUrl String?   // Added: S3/R2 object storage URL
  // Remove bytes field in future migration after S3 migration
  bytes      Bytes?    // Made optional during transition
  size       Int
  status     String    @default("PENDING")
  // Existing fields...
}
```

---

## 7. Required API & Route Changes

1. **Decommission Dev Endpoints on Public Router:**
   - Remove `/bootstrap`, `/pilot-harness/*`, and `/tenants` from `/api/v1`.
   - Restrict tenant creation and account provisioning strictly to authenticated Platform Admins via `/api/admin/accounts`.
2. **Client Portal Live Chat Endpoints (`/api/client/inbox`):**
   - `GET /api/client/conversations`: List active customer conversations with unread flags and handoff indicators.
   - `GET /api/client/conversations/:id/messages`: Full message history with delivery receipts.
   - `POST /api/client/conversations/:id/messages`: Send an outbound merchant message via WhatsApp.
   - `POST /api/client/conversations/:id/handoff`: Toggle bot automation vs. manual takeover.
3. **Webhook Delivery Receipt Ingestion:**
   - Extend `WhatsAppWebhookExtractor` and `WhatsAppWebhookRouter` to parse Meta `statuses` payloads and update `deliveryStatus`, `deliveredAt`, and `readAt`.

---

## 8. Required Frontend Changes (Merchant Portal)

1. **Merchant Live Inbox (`/app#inbox`):**
   - Left pane: Active conversations sorted by last activity, showing customer name, phone number, and badge (`Bot Active`, `Human Handoff`, `Paused`).
   - Center pane: Two-way message transcript showing inbound customer messages, AI responses, and merchant replies with status checks (Sent, Delivered, Read).
   - Bottom input: Textarea for manual human replies with quick-canned responses in Moroccan Darija and French.
   - Action bar: One-click "Pause Bot / Take Over" and "Resume Bot" switches.
2. **Delivery & Health Analytics:**
   - Visual indicators showing connected phone number health and delivery success rates.
   - Account usage progress bars showing remaining message and AI token balances.

---

## 9. Background Job & Queue Enhancements

1. **Process Separation:**
   - Implement two start modes in `src/app.ts`:
     - `WEB_MODE=true`: Runs Express HTTP server, webhook receiver, portal APIs.
     - `WORKER_MODE=true`: Runs `PostgresMessageQueue` workers and `PortalDocuments` ingestion worker.
2. **Worker Lease Fencing:**
   - Maintain heartbeats on active `WhatsAppMessageJob` rows during long-running LLM completions, preventing lease expiration and double processing.
3. **Document Ingestion Sandboxing:**
   - Wrap PDF extraction and vector embedding generation in try/catch blocks with resource caps to prevent heap exhaustion.

---

## 10. Testing Strategy

1. **Multi-Tenant Isolation Verification:**
   - Automated regression verifying that Merchant A cannot access Merchant B's products, leads, documents, or conversations via IDOR attacks.
2. **High-Concurrency Queue Simulation:**
   - Inject 200 concurrent webhooks across 20 distinct phone numbers; verify strict FIFO per partition and zero lost or duplicate messages.
3. **WhatsApp Error Handling & Policy Compliance:**
   - Simulate expired Meta 24-hour service windows; verify that the bot safely halts or triggers approved templates rather than crashing.
4. **Live Playwright End-to-End Test:**
   - Complete end-to-end browser test: Merchant signup $\to$ email verification $\to$ business configuration $\to$ Meta embedded signup $\to$ inbound WhatsApp message $\to$ live chat response.

---

## 11. Deployment Strategy (Caddy + Docker Compose on VPS)

### Production Directory Layout:
```
/opt/relayqo/
├── docker-compose.yml
├── Caddyfile
├── .env
└── deploy.sh
```

### Docker Compose Architecture (`docker-compose.yml`):
- `caddy`: Handles port 80/443, automatic TLS for `app.relayqo.online`.
- `app-web`: Express server handling HTTP API and Meta webhooks (internal port 3000).
- `app-worker`: Dedicated Node.js background container processing message queues and documents.
- Logging configured with `max-size: "10m"`, `max-file: "3"` to prevent VPS disk saturation.

---

## 12. Ordered Implementation Roadmap

```
┌──────────────────────────────────────────────────────────────────────────┐
│ PHASE 1: Security Remediation & Credential Rotation (Complexity: LOW)    │
│  - Rotate all exposed credentials (Supabase, Meta, DeepSeek, Google).    │
│  - Eliminate fallback auth secrets in src/dev/chatApi.ts.                │
│  - Strip legacy /dev and /bootstrap routes from public router.           │
├──────────────────────────────────────────────────────────────────────────┤
│ PHASE 2: VPS Production Setup & Caddy Deployment (Complexity: MEDIUM)    │
│  - Provision Ubuntu 24.04 LTS VPS (Hetzner / OVH / Contabo).             │
│  - Configure docker-compose.yml, Caddyfile, and deploy.sh.               │
│  - Point DNS A record for app.relayqo.online to VPS IP.                  │
├──────────────────────────────────────────────────────────────────────────┤
│ PHASE 3: Web & Worker Process Separation (Complexity: MEDIUM)            │
│  - Decouple Express webhooks from background queue workers.              │
│  - Allocate dedicated database connection pools for worker processes.    │
├──────────────────────────────────────────────────────────────────────────┤
│ PHASE 4: Merchant Live Chat & Handoff Inbox (Complexity: HIGH)           │
│  - Implement /api/client/inbox endpoints.                                │
│  - Build live conversation UI in Client Portal (/app).                   │
│  - Enable merchants to reply to WhatsApp customers directly.             │
├──────────────────────────────────────────────────────────────────────────┤
│ PHASE 5: Meta Delivery Receipts & Outcome Analytics (Complexity: MEDIUM) │
│  - Ingest WhatsApp message delivery status callbacks (delivered/read).   │
│  - Display delivery status ticks and conversion metrics in portal.       │
├──────────────────────────────────────────────────────────────────────────┤
│ PHASE 6: Self-Hosted Object Storage for PDFs (Complexity: LOW)           │
│  - Migrate PDF storage from PostgreSQL Bytes to S3 / Cloudflare R2.      │
│  - Prevent database WAL bloat and improve backup performance.            │
└──────────────────────────────────────────────────────────────────────────┘
```

| Phase | Milestone Name | Estimated Complexity | Core Focus |
| :--- | :--- | :--- | :--- |
| **Phase 1** | Security Remediation & Secret Rotation | **Low** (1 day) | Credential rotation, fail-closed auth, stripping dev endpoints from production router. |
| **Phase 2** | VPS Deployment & Auto-SSL Infrastructure | **Medium** (1–2 days) | Provisioning Ubuntu VPS, Caddy reverse proxy, Docker Compose, domain DNS mapping. |
| **Phase 3** | Process Decoupling (Web vs. Queue Worker) | **Medium** (2 days) | Isolating webhook ingestion from background LLM message processing. |
| **Phase 4** | Merchant Live Chat & Handoff Inbox | **High** (3–4 days) | Developing client-facing live conversation viewer and manual WhatsApp reply dispatch. |
| **Phase 5** | Delivery Receipts & Conversion Analytics | **Medium** (2 days) | Processing WhatsApp delivery receipts and building merchant conversion metrics. |
| **Phase 6** | Cloud Object Storage Migration for Documents | **Low** (1–2 days) | Migrating catalog PDFs from Postgres `Bytes` to Cloudflare R2 / AWS S3. |

---

## Conclusion & Next Immediate Actions

The Relayqo codebase possesses an exceptionally solid architectural core: its deterministic turn handling, Darija linguistic adaptations, encrypted Meta token storage, and PostgreSQL FIFO queueing are already implemented to a high standard.

By executing **Phase 1** (Security Remediation) and **Phase 2** (VPS Caddy Deployment), Relayqo can be launched into commercial operation with zero migration overhead, providing Moroccan merchants with an always-on, cost-controlled, multilingual AI WhatsApp assistant.
