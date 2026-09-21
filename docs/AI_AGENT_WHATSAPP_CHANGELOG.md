# Relayqo WhatsApp Multi-Tenant System — Comprehensive AI Agent Changelog & Architecture Reference

> **Target Audience:** Autonomous AI Agents, Senior Backend/Security Engineers.  
> **Repository:** `Relayqo` (Multi-Client WhatsApp Channel Implementation).  
> **Last Updated:** 2026-09-12.  
> **Status:** `🟡 CONDITIONALLY READY — specific runtime checks required` (120/120 tests passing).

---

## Completion update — 12 September 2026

The implementation now includes the previously missing production boundaries:

- Every WhatsApp number must resolve to an enabled, connected, tenant-scoped `ChannelConnection` before outbound delivery. There is no platform-token fallback for a mapped client number.
- `ChannelConnection.connectionKey` permits multiple Meta WABAs and multiple QR sessions under the same client account without credential sharing.
- Baileys QR authentication is encrypted in `ChannelSessionSecret`; QR codes expire after 60 seconds and are exposed only through authenticated admin routes.
- QR support is disabled unless `ENABLE_QR_CHANNELS=true`. It requires one long-running backend worker with persistent PostgreSQL storage; it must not run inside a short-lived Vercel serverless function or on multiple QR workers simultaneously.
- Manual Meta token entry creates a disabled `PENDING` connection. Only the verified Embedded Signup flow can mark it `CONNECTED`.
- Channel management requires an authenticated tenant admin. The global QR emergency stop additionally requires a platform administrator.
- UI query tokens are exchanged once for an HttpOnly cookie and removed from the URL.
- The worker consumes the rate limit once per reply, does not trip the provider circuit breaker for local policy blocks, and leaves retryable outbound jobs retryable.
- Disconnecting a connection disables its numbers and clears its stored credentials. Clearing the global QR stop does not silently reconnect logged-out numbers.

Database rollout file: `prisma/migrations/20260912170000_support_multiple_channel_sessions/migration.sql`. Apply it only after reviewing the target database and taking a backup.

Required production secrets are `ENCRYPTION_KEY` (at least 32 bytes), `WHATSAPP_APP_SECRET` or `META_APP_SECRET`, `META_APP_ID`, and `SIGNUP_STATE_SECRET`.

---

## 1. Executive Summary & Purpose

This document provides a complete, authoritative reference of all architectural modifications, security remediations (P0/P1/P2), schema updates, and runtime controls implemented in the Relayqo WhatsApp multi-tenant channel.

The Relayqo WhatsApp system enables multiple e-commerce clients (tenants) to connect distinct WhatsApp Business numbers, process incoming customer inquiries via a conversational AI engine, and guarantee that chatbot replies are strictly routed from the identical WhatsApp phone number that received the message, with zero cross-tenant data leakage or credential cross-talk.

---

## 2. Architecture & Data Flow

```
                                  [Meta Cloud API Webhook]
                                             │
                                             ▼ (POST /api/v1/webhook/whatsapp)
                         ┌────────────────────────────────────────┐
                         │      WhatsAppWebhookRouter             │
                         │  1. Fail-closed HMAC (SHA256) check    │
                         │  2. Extract messages (raw payload)     │
                         │  3. PostgresIdempotencyStore (wamid)   │
                         │  4. Resolve (tenantId, accountId)      │
                         └───────────────────┬────────────────────┘
                                             │ Enqueue
                                             ▼
                         ┌────────────────────────────────────────┐
                         │      PostgresMessageQueue              │
                         │  - PartitionKey: tenant:account:waId   │
                         │  - FIFO per partition                  │
                         │  - SELECT FOR UPDATE SKIP LOCKED       │
                         └───────────────────┬────────────────────┘
                                             │ Claim next job
                                             ▼
                         ┌────────────────────────────────────────┐
                         │      WhatsAppWorker                    │
                         │  1. Pre-LLM ClientSafetyGuard Check    │
                         │     (Tenant pause, Human takeover,     │
                         │      Rate limit, Circuit breaker)      │
                         │  2. ConversationEngine.handleMessage   │
                         │     (RAG + LLM inference)             │
                         │  3. Post-LLM ClientSafetyGuard Re-check│
                         │     (Prevents TOCTOU takeover race)    │
                         │  4. WhatsAppPolicyAdapter (24h window) │
                         │  5. ChannelRouter.routeOutbound        │
                         └───────────────────┬────────────────────┘
                                             │
                         ┌───────────────────┴────────────────────┐
                         │                                        │
                         ▼                                        ▼
             [MetaCloudTransport]                        [QRWebTransport]
         (WhatsAppOutboundAdapter)                    (Emergency Stop Checked)
                     │                                            │
                     ▼                                            ▼
           Meta Graph API v22.0                           Local Baileys / QR
         (Encrypted Token from DB)                        (Blocked if stopped)
```

---

## 3. Database Schema & Migration Changes

### 3.1 Schema Additions (`prisma/schema.prisma`)

1. **`ChannelConnection` Model:**
   Stores encrypted credentials and integration status per tenant/account.
   ```prisma
   model ChannelConnection {
     id                   String   @id @default(uuid())
     tenantId             String
     accountId            String
     provider             String   @default("META_CLOUD") // META_CLOUD | QR_WEB
     status               String   @default("PENDING")    // PENDING | CONNECTED | FAILED | DISCONNECTED
     enabled              Boolean  @default(true)
     encryptedCredentials String?  // AES-256-GCM encrypted access token
     appId                String?
     wabaId               String?
     sessionKey           String?
     lastConnectedAt      DateTime?
     lastError            String?
     createdAt            DateTime @default(now())
     updatedAt            DateTime @updatedAt

     tenant   Tenant                   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
     account  Account                  @relation(fields: [accountId], references: [id], onDelete: Cascade)
     numbers  WhatsAppBusinessNumber[]

     @@unique([tenantId, accountId, provider])
     @@index([tenantId, accountId])
     @@index([tenantId, provider])
   }
   ```

2. **`ConversationAutomationState` Model:**
   Tracks per-conversation bot status and human agent handoff.
   ```prisma
   model ConversationAutomationState {
     id             String    @id @default(uuid())
     tenantId       String
     accountId      String?
     conversationId String    @unique
     botEnabled     Boolean   @default(true)
     humanTakeover  Boolean   @default(false)
     pausedUntil    DateTime?
     pauseReason    String?
     updatedBy      String?
     createdAt      DateTime  @default(now())
     updatedAt      DateTime  @updatedAt

     tenant       Tenant       @relation(fields: [tenantId], references: [id], onDelete: Cascade)
     account      Account?     @relation(fields: [accountId], references: [id], onDelete: Cascade)
     conversation Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)

     @@index([tenantId, conversationId])
   }
   ```

3. **`ChannelAuditEvent` Model:**
   Tamper-evident audit logging for administrative actions and safety violations.
   ```prisma
   model ChannelAuditEvent {
     id             String   @id @default(uuid())
     tenantId       String
     accountId      String?
     connectionId   String?
     phoneNumberId  String?
     conversationId String?
     actorId        String?
     action         String
     metadata       Json?
     createdAt      DateTime @default(now())

     tenant  Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
     account Account? @relation(fields: [accountId], references: [id], onDelete: Cascade)

     @@index([tenantId, createdAt])
     @@index([tenantId, action])
   }
   ```

4. **`WhatsAppBusinessNumber` Updates:**
   - Linked to `ChannelConnection` via `connectionId` (nullable, `onDelete: SetNull`).
   - Added `transport` field (`META_CLOUD` | `QR_WEB`).
   - Added `status` field (`CONNECTED` | `PAUSED` | `BLOCKED` | `DISCONNECTED`).

### 3.2 Safe Deduplication Migration (`20260911130000_add_channel_connection_unique_constraint`)

* **File:** `prisma/migrations/20260911130000_add_channel_connection_unique_constraint/migration.sql`
* **Problem Solved:** A blind `DELETE ... WHERE c1."createdAt" < c2."createdAt"` would delete valid credentials if an older connection had credentials and a newer one did not, while also setting `WhatsAppBusinessNumber.connectionId` to `NULL` due to `onDelete: SetNull`.
* **Remediation:** Uses PostgreSQL window functions to identify a survivor prioritizing:
  1. Non-null, non-empty `encryptedCredentials`
  2. Latest `lastConnectedAt`
  3. Latest `createdAt`
* Automatically repoints `WhatsAppBusinessNumber.connectionId` and `ChannelAuditEvent.connectionId` to the surviving connection ID *before* deleting duplicate records, then applies `CREATE UNIQUE INDEX IF NOT EXISTS`.

### 3.3 Multiple isolated sessions (`20260912170000_support_multiple_channel_sessions`)

- Replaces the old `(tenantId, accountId, provider)` uniqueness rule with `(tenantId, accountId, provider, connectionKey)`.
- Uses the Meta WABA ID or QR session ID as `connectionKey`, allowing several isolated connections for one account.
- Adds `ChannelSessionSecret` for encrypted, database-backed QR authentication state.

---

## 4. Security Findings & Remediations Matrix

| ID | Category | Vulnerability Description | Remediation Applied | Files Modified |
| :--- | :--- | :--- | :--- | :--- |
| **P0-01** | Auth | Unauthenticated Channel Management APIs & Tenant Impersonation | Added `requireAuth` middleware guarding all admin routes. Non-admin callers cannot override `principal.tenantId` via headers, body, or query strings (returns HTTP 403). | `src/middleware/authMiddleware.ts`<br>`src/app.ts`<br>`src/domain/channel/guard/ChannelManagementRouter.ts` |
| **P0-02** | Isolation | Human Takeover Bypass in Inbound Worker | Scoped human takeover state by `(tenantId, customerId, accountId)` and `conversationId`. Engine suppresses responses (returns empty string) and worker halts outbound delivery. | `src/domain/channel/guard/ClientSafetyGuard.ts`<br>`src/domain/conversation/ConversationEngine.ts`<br>`src/domain/channel/whatsapp/WhatsAppWorker.ts` |
| **P0-03** | CSRF | Embedded Signup State Parameter & Nonce Bypass | Implemented HMAC-SHA256 signed state tokens containing `tenantId`, `accountId`, timestamp (15m expiration), and cryptographic random nonces. Rejects forged, expired, or unauthenticated callbacks. | `src/domain/channel/whatsapp/WhatsAppOnboardingService.ts`<br>`src/domain/channel/whatsapp/WhatsAppOnboardingRouter.ts` |
| **P1-01** | Concurrency | Post-LLM Takeover & Tenant-Pause Race (TOCTOU) | Re-evaluates `safetyGuard.evaluateOutbound()` immediately post-LLM before `ChannelRouter.routeOutbound()`. If operator pauses tenant or triggers takeover during inference, delivery is aborted. | `src/domain/channel/whatsapp/WhatsAppWorker.ts` |
| **P1-02** | State | Distributed In-Memory Safety State | Replaced volatile in-memory sets with persistent PostgreSQL storage: Emergency QR stop stored in `WhatsAppIdempotencyKey` (`system:emergency_qr_stopped`); Tenant pause stored in `TenantConfig.config.automationPaused`. | `src/domain/channel/guard/ClientSafetyGuard.ts`<br>`src/domain/channel/routing/ChannelRouter.ts` |
| **P1-03** | Crypto | Hardcoded Fallback Encryption Key | Removed hardcoded production fallback key. Production startup halts (`process.exit(1)`) if `ENCRYPTION_KEY` is missing or shorter than 32 bytes. Audit logs strip secrets via `sanitizeMetadata`. | `src/config/env.ts`<br>`src/core/security/SecretBox.ts`<br>`src/bootstrap.ts` |
| **P1-04** | XSS | Reflected and Stored XSS in `/channels/ui` | Serializes dynamic tenant data inside `<script id="tenant-config-data" type="application/json">` with `<` escaped to `\u003c`. Replaced `innerHTML` with safe DOM construction (`document.createElement`, `.textContent`, `.addEventListener`). | `src/domain/channel/guard/ChannelManagementRouter.ts` |
| **P1-05** | Auth | Production-Reachable `mock_code` Backdoor | Restricted `mock_code` exclusively to `process.env.NODE_ENV === 'test' \|\| process.env.VITEST === 'true'`. In production, submitting `mock_code` makes a live Meta Graph API call, fails authentication, and returns HTTP 400. | `src/domain/channel/whatsapp/WhatsAppOnboardingService.ts` |
| **NEW-01** | Routing | Direct Meta API Routing Bypass in Worker | Worker now strictly routes all outbound messages through `ChannelRouter.routeOutbound()`. Fails closed if router is not configured. Direct unvalidated Meta API calls eliminated. | `src/domain/channel/whatsapp/WhatsAppWorker.ts`<br>`src/domain/channel/routing/ChannelRouter.ts` |
| **NEW-02** | Credentials| Master Platform Token Fallback Leak | Removed fallback to system-wide access token during tenant onboarding. Failure to obtain an isolated access token marks the connection `FAILED` and halts onboarding. | `src/domain/channel/whatsapp/WhatsAppOnboardingService.ts` |
| **P0/P1-1** | Webhook | Fail-Closed Meta Webhook Authentication | Webhook POST fails closed with HTTP 500 if app secret is not configured in production, returns HTTP 401 on missing or invalid `X-Hub-Signature-256`, uses raw byte buffer for verification, and returns HTTP 500 on queue error so Meta retries. | `src/domain/channel/whatsapp/WhatsAppWebhookRouter.ts`<br>`src/app.ts` |
| **P1-5** | DB | ChannelConnection Concurrent Duplicate Creation | Added `@@unique([tenantId, accountId, provider, connectionKey])` and atomic Prisma `upsert`, preserving isolation while allowing multiple WABAs or QR sessions. | `prisma/schema.prisma`<br>`src/domain/channel/whatsapp/WhatsAppNumberService.ts` |
| **P2** | SQL Injection | MessageQueue Raw SQL Interpolation | Parameterized SQL query in `PostgresMessageQueue.claimNextJob()` using `$1` (lease seconds) and `$2` (workerId). | `src/domain/channel/whatsapp/MessageQueue.ts` |

---

## 5. File-by-File Technical Details

### 5.1 Security & Infrastructure
* [`src/core/security/SecretBox.ts`](file:///c:/Users/IlyesSaber/Desktop/work/src/core/security/SecretBox.ts):
  - Encrypts tokens using `aes-256-gcm`.
  - Format: `iv:tag:ciphertext` (hex encoded).
  - Verifies authentication tag in constant time.
* [`src/config/env.ts`](file:///c:/Users/IlyesSaber/Desktop/work/src/config/env.ts):
  - Validates `DATABASE_URL`.
  - Enforces `ENCRYPTION_KEY` length $\ge 32$ in production (`NODE_ENV === 'production'`).
  - Enforces `WHATSAPP_APP_SECRET` / `META_APP_SECRET` in production.
* [`src/middleware/authMiddleware.ts`](file:///c:/Users/IlyesSaber/Desktop/work/src/middleware/authMiddleware.ts):
  - Resolves Bearer tokens or `x-api-key`.
  - Attaches `req.principal`.
  - Cross-checks requested tenant ID against authenticated tenant ID (`403 Forbidden` on mismatch, unless `principal.role === 'admin'`).
  - Supports query parameter token for HTML views: `requireAuth({ allowUiQueryToken: true })`.

### 5.2 Channel Management & Safety
* [`src/domain/channel/guard/ClientSafetyGuard.ts`](file:///c:/Users/IlyesSaber/Desktop/work/src/domain/channel/guard/ClientSafetyGuard.ts):
  - Evaluates pre- and post-LLM safety:
    1. Tenant/Account ownership of phone number.
    2. Number status (`CONNECTED`, not `PAUSED`/`BLOCKED`).
    3. Emergency QR stop (queries PostgreSQL).
    4. Tenant automation pause (queries PostgreSQL `TenantConfig`).
    5. Human takeover (queries `ConversationAutomationState` & `Conversation`).
    6. Process-local rate limiting (30 msgs/min per recipient).
    7. Process-local circuit breaker (5 consecutive provider failures $\to$ 5m open).
  - Sanitizes metadata before logging to `ChannelAuditEvent`.
* [`src/domain/channel/guard/ChannelManagementRouter.ts`](file:///c:/Users/IlyesSaber/Desktop/work/src/domain/channel/guard/ChannelManagementRouter.ts):
  - REST endpoints for connection registration, number status, and tenant pause.
  - Safe `/channels/ui` dashboard using DOM `.textContent` and `<script type="application/json">` with `\u003c` escaping.

### 5.3 Routing & Outbound Transport
* [`src/domain/channel/routing/ChannelRouter.ts`](file:///c:/Users/IlyesSaber/Desktop/work/src/domain/channel/routing/ChannelRouter.ts):
  - Resolves originating phone number and `ChannelConnection`.
  - Validates strict tenant and account boundaries.
  - Checks Emergency QR kill-switch if transport is `QR_WEB`.
  - Dispatches to registered `ChannelTransport` (`MetaCloudTransport` or `QRWebTransport`).
* [`src/domain/channel/whatsapp/WhatsAppOutboundAdapter.ts`](file:///c:/Users/IlyesSaber/Desktop/work/src/domain/channel/whatsapp/WhatsAppOutboundAdapter.ts):
  - Decrypts connection token via `SecretBox`.
  - Calls Meta Graph API `POST /{phone_number_id}/messages`.
  - Classifies errors into retryable vs non-retryable.

### 5.4 Onboarding & Webhooks
* [`src/domain/channel/whatsapp/WhatsAppOnboardingService.ts`](file:///c:/Users/IlyesSaber/Desktop/work/src/domain/channel/whatsapp/WhatsAppOnboardingService.ts):
  - Generates and verifies HMAC-SHA256 signed CSRF state tokens.
  - Exchanges Meta authorization code for permanent system/business token.
  - Subscribes WABA webhooks and registers phone number.
  - Encrypts access token and stores in `ChannelConnection`.
* [`src/domain/channel/whatsapp/WhatsAppWebhookRouter.ts`](file:///c:/Users/IlyesSaber/Desktop/work/src/domain/channel/whatsapp/WhatsAppWebhookRouter.ts):
  - Validates `hub.mode === 'subscribe'` and `hub.verify_token` on GET.
  - Enforces `X-Hub-Signature-256` HMAC-SHA256 validation on POST.
  - Deduplicates via `PostgresIdempotencyStore`.
  - Resolves server-side phone number to `(tenantId, accountId)`.
  - Enqueues to `PostgresMessageQueue`. Rollback on queue failure.

### 5.5 Worker & Queue
* [`src/domain/channel/whatsapp/MessageQueue.ts`](file:///c:/Users/IlyesSaber/Desktop/work/src/domain/channel/whatsapp/MessageQueue.ts):
  - `PostgresMessageQueue`: Implements distributed FIFO queue backed by `WhatsAppMessageJob`.
  - Uses `SELECT ... FOR UPDATE SKIP LOCKED` with parameterized lease interval (`$1`) and worker ID (`$2`).
  - Automatic recovery of stale jobs whose lease expired.
* [`src/domain/channel/whatsapp/WhatsAppWorker.ts`](file:///c:/Users/IlyesSaber/Desktop/work/src/domain/channel/whatsapp/WhatsAppWorker.ts):
  - Processes durable queue jobs.
  - Runs pre-LLM and post-LLM safety checks.
  - Invokes `ConversationEngine.handleMessage()`.
  - Evaluates WhatsApp 24-hour customer service window policy.
  - Routes response via `ChannelRouter`.

---

## 6. Distributed State & Concurrency Model

Understanding the scope of in-memory vs database state is critical when operating in a clustered (multi-pod / multi-instance) environment:

| State Variable | Location | Backing Store | Clustered Behavior | Impact & Operational Guidance |
| :--- | :--- | :--- | :--- | :--- |
| **Emergency QR Stop** | `ClientSafetyGuard.ts` | PostgreSQL (`WhatsAppIdempotencyKey`) | Shared / Cluster-wide | Instant. All pods query DB on every outbound message. |
| **Tenant Automation Pause** | `ClientSafetyGuard.ts` | PostgreSQL (`TenantConfig`) | Shared / Cluster-wide | Instant. Changes made on any pod immediately affect all pods. |
| **Message Queue FIFO** | `MessageQueue.ts` | PostgreSQL (`WhatsAppMessageJob`) | Shared / Cluster-wide | Strict FIFO per `tenant:account:waId` partition via row-level locks. |
| **Webhook Idempotency** | `IdempotencyStore.ts` | PostgreSQL (`WhatsAppIdempotencyKey`) | Shared / Cluster-wide | Unique key constraint ensures global deduplication. |
| **Rate Limiter** (`rateLimitMap`) | `ClientSafetyGuard.ts:33` | Process-local `Map` | Per-pod | Effective throughput cap is $N \times 30$ msgs/min across $N$ pods. |
| **Circuit Breaker** (`circuitMap`) | `ClientSafetyGuard.ts:36` | Process-local `Map` | Per-pod | Provider outages trip per-pod after 5 consecutive failures. |
| **OAuth Nonce Cache** (`usedNonces`) | `WhatsAppOnboardingService.ts:77` | Process-local `Set` | Per-pod | Replay across pods is prevented by Meta Graph API single-use code guarantee. |

---

## 7. Verification & Testing Evidence

### 7.1 Test Suites Passing
* **Security Remediation Suite:**
  ```powershell
  npx vitest run tests/integration/whatsapp-security-remediation.spec.ts
  ```
  *Result:* **1 passed (1 file), 23 passed (23 tests)**.
* **Full WhatsApp Integration Suite:**
  ```powershell
  npx vitest run whatsapp --fileParallelism false --testTimeout 60000
  ```
  *Result:* **17 passed (17 files), 120 passed (120 tests)**.

### 7.2 Two-Instance Runtime Verifications Completed
1. **Emergency QR Kill-Switch (Two-Instance):**
   - Instance A activated emergency QR stop.
   - Instance B attempted `QR_WEB` send $\to$ Rejected with `EMERGENCY_QR_STOPPED`.
   - Instance B attempted `META_CLOUD` send $\to$ Allowed and delivered.
   - Instance A deactivated emergency QR stop.
   - The global stop was cleared, but disconnected QR sessions stayed paused until their owners reconnected them.
2. **Tenant Automation Pause (Two-Instance):**
   - Instance A paused Tenant T1.
   - Instance B attempted outbound for T1 $\to$ Rejected with `TENANT_PAUSED`.
   - Instance B attempted outbound for Tenant T2 $\to$ Allowed.
   - Instance A resumed Tenant T1.
   - Instance B attempted outbound for T1 $\to$ Allowed.
3. **Webhook HMAC Authentication:**
   - Missing signature header $\to$ HTTP 401 (`MISSING_SIGNATURE`).
   - Tampered/invalid signature header $\to$ HTTP 401 (`INVALID_SIGNATURE`).
   - Valid HMAC signature using `rawBody` $\to$ HTTP 200 (`ACK`), job enqueued in DB.
4. **Cross-Tenant Outbound Injection:**
   - Attempted sending using Tenant T1's registered phone number from Tenant T2's authenticated context.
   - Rejected with `SECURITY VIOLATION`, zero Meta API requests dispatched, and security audit log written.
5. **Post-LLM Takeover Race Condition:**
   - Simulated 5-second LLM generation. Human takeover activated mid-generation.
   - Post-LLM safety guard intercepted the turn, blocked outbound dispatch, and suppressed WhatsApp transmission.
6. **Production `mock_code` Rejection:**
   - Under `NODE_ENV=production`, submitted `mock_code` onboarding callback.
   - Rejected without bypass; returned HTTP 400 error.
7. **XSS Escaping:**
   - Payloads `</script><script>alert(1)</script>` and `"><img src=x onerror=...>` escaped safely to `\u003c/script>` and `&quot;&gt;&lt;img...>`; zero script execution possible.

---

## 8. Deployment Prerequisites & Runbook

Before deploying to production, the operations engineer or deploying agent must confirm:

1. **Environment Variables:**
   Ensure the following environment variables are configured in the container/host:
   ```env
   NODE_ENV=production
   DATABASE_URL=postgresql://user:password@host:5432/dbname?schema=public
   ENCRYPTION_KEY=<32-byte-or-longer cryptographically random secret>
   WHATSAPP_APP_SECRET=<Meta App Secret from Meta Developer Console>
   AUTH_SECRET=<Secret used to sign and verify administrative JWTs>
   PORT=3000
   ```
2. **Apply Database Migration:**
   Execute Prisma migrations against the production database:
   ```bash
   npx prisma migrate deploy
   ```
   *(Note: Migration `20260911130000_add_channel_connection_unique_constraint` is safe to run on existing dirty databases; duplicate references are safely reconciled before index creation).*
3. **Verify Health Endpoint:**
   ```bash
   curl -i http://localhost:3000/health
   ```
   *Expected:* HTTP 200 `{ "status": "healthy", "database": "connected" }`.

---

## 9. Deferred Technical Debt & Future Work

* **Domain Message Delivery Status:**  
  Currently, `ConversationEngine` persists the AI turn in `Message` history during response generation, prior to outbound transport execution. If outbound transport subsequently fails (e.g. Meta 500 error), `WhatsAppMessageJob.outboundStatus` is marked `FAILED`, but the `Message` table does not reflect this failure. Future turns load the undelivered message into the LLM context.  
  *Recommendation:* Add a `deliveryStatus` column (`PENDING`, `SENT`, `FAILED`) to the `Message` Prisma model and update it upon worker completion.
* **Distributed Sliding-Window Rate Limiter:**  
  Move `rateLimitMap` and `circuitMap` from process-local `Map` instances to Redis (e.g. `INCR` + `EXPIRE` or sliding window scripts) when scaling worker nodes beyond 5 pods.
