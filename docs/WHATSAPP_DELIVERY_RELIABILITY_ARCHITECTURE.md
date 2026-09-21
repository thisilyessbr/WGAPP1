# WhatsApp Delivery Reliability & Receipt Architecture (Phase 4A Audit)

## 1. Executive Summary

Phase 3 established an end-to-end merchant conversation workspace with authoritative takeover controls, conversational state management, and manual outbound messaging. However, outbound delivery states currently stop at initial provider acceptance (`SENT`). Meta WhatsApp Cloud API asynchronously delivers status webhooks (`sent`, `delivered`, `read`, `failed`), but Relayqo currently drops them at webhook ingress without persistence or state transitions. Furthermore, automated AI assistant replies do not record provider message IDs (`externalId`), leaving automated messages entirely outside delivery tracking.

This audit establishes the architecture to make WhatsApp outbound message delivery **provider-authoritative, durable, idempotent, race-safe, and monotonically consistent**, strictly preserving Phase 2 Web/Worker runtime separation, PostgreSQL-backed durability, and server-authoritative tenant boundaries without introducing external infrastructure like Redis.

---

## 2. Current Outbound Architecture

Relayqo currently features two distinct outbound paths:

```
                                      OUTBOUND LIFECYCLE PATHWAYS
                                      
  A. Manual Merchant Path (Phase 3B/3C):
  [Merchant UI] 
       │ POST /conversations/:id/messages
       ▼
  [PortalRouter] ──(1. Insert Message PENDING)──► "Message" (externalId = NULL)
       │
       ├──(2. Enqueue)──► "WhatsAppOutboundJob" (status: PENDING)
       │
  [WhatsAppOutboundWorker] (Worker Runtime)
       │ Claim (SELECT FOR UPDATE SKIP LOCKED)
       ▼
  [WhatsAppOutboundAdapter] ──(POST /messages)──► [Meta Graph API]
       │                                                │ Synchronous HTTP 200
       ▼                                                ▼
  [completeJob()] ◄─────────────────────────── Returns wamid (providerMessageId)
       │
       ├── Updates "WhatsAppOutboundJob" (status: COMPLETED, providerMessageId: wamid)
       └── Updates "Message" (externalId: wamid, metadata.deliveryStatus: 'SENT')


  B. Automated AI Assistant Path (Phase 2):
  [Meta Webhook] ──► [WhatsAppWebhookRouter] ──► [WhatsAppMessageJob] (Inbound Queue)
                                                         │
  [WhatsAppWorker] (Worker Runtime) ◄────────────────────┘
       │
       ├── 1. Pre-LLM Safety Guard Check
       ├── 2. ConversationEngine.handleMessage()
       │        └── ConversationService.commitConversationTurn()
       │              ├── Inserts "Message" (role: USER, externalId: customer_wamid)
       │              └── Inserts "Message" (role: ASSISTANT, externalId: NULL)  <-- GAP!
       ├── 3. Post-LLM Safety Guard Check (Race A suppression)
       ├── 4. ChannelRouter.routeOutbound() ──► [Meta Graph API]
       │                                              │ Synchronous HTTP 200
       ▼                                              ▼
  [outboundResult] ◄───────────────────────── Returns wamid (providerMessageId)
       │
       └── Updates "WhatsAppMessageJob" (outboundStatus: 'SENT', outboundMessageId: wamid)
           * NOTE: Never updates "Message" table for the ASSISTANT message! <-- GAP!
```

---

## 3. Existing Capabilities That Can Be Reused

1. **`WhatsAppSignatureValidator`**: Production-grade, fail-closed HMAC SHA-256 signature verification over authoritative raw request bodies.
2. **`WhatsAppNumberService`**: Authoritative mapping of Meta's `phoneNumberId` to internal `(tenantId, accountId, connectionId)` with strict cross-tenant protection.
3. **`SecretBox` & Encrypted Credentials**: Secure AES-256-GCM token storage and retrieval per channel connection.
4. **`PostgresOutboundQueue`**: Durable PostgreSQL queue utilizing atomic row-level locking (`FOR UPDATE SKIP LOCKED`) and lease-expiration recovery.
5. **`WhatsAppOutboundAdapter` Error Handling**: Proven classification of retryable vs. non-retryable Meta error codes, exponential backoff, and unknown delivery safeguards (`DELIVERY_UNKNOWN`).
6. **`Message.externalId` Indexed Column**: Unique constraint `@@unique([tenantId, externalId])` already exists in `prisma/schema.prisma`.
7. **Merchant Polling Architecture**: 4-second active conversation polling in `inbox.js` automatically pulls updated `metadata` without WebSockets.

---

## 4. Existing Reliability Gaps

1. **Status Webhooks Completely Dropped**: `WhatsAppWebhookExtractor.extractMessages()` only reads `value.messages`. When Meta sends `value.statuses`, the extractor returns `[]` and `WhatsAppWebhookRouter` responds with `HTTP 200 { status: 'ACK', processed: 0 }`, permanently discarding the delivery receipt.
2. **AI Messages Missing `externalId`**: In `ConversationService.commitConversationTurn()`, the `ASSISTANT` row is created with `externalId: null`. When Meta accepts the message, `WhatsAppWorker` receives the `wamid` but never writes it back to `Message.externalId`.
3. **No Provider Delivery State Machine**: No server-side tracking exists for `DELIVERED` or `READ`. The system treats initial provider acceptance as the final state.
4. **Correlation Race**: If Meta emits a `sent` or `delivered` webhook faster than Relayqo commits `completeJob()` to PostgreSQL, an incoming webhook looking for `Message` by `externalId` would fail to match.
5. **Ambiguous Send Vulnerability**: If a worker crashes or encounters a network socket reset after sending bytes to Meta but before receiving the HTTP response, the job outcome is ambiguous. Blindly retrying can double-send messages to the customer.

---

## 5. Provider Delivery-State Semantics

Meta WhatsApp Business Cloud API emits asynchronous status updates with the following exact meanings:

| Meta Status | Provider Event Trigger | Real-World State | Billable / Diagnostic Data |
| :--- | :--- | :--- | :--- |
| `sent` | Message accepted by Meta servers and queued for delivery across carrier network. | Server-acknowledged transmission. Not yet on device. | Includes `conversation.id`, `conversation.origin.type`, `pricing` (CBP model). |
| `delivered` | Message successfully transferred to the recipient's phone/client. | Delivered to customer device (two gray checkmarks). | Confirms customer connectivity and device reachability. |
| `read` | Recipient opened the WhatsApp conversation containing the message. | Customer viewed the reply (two blue checkmarks). | Available unless recipient disabled read receipts in WhatsApp privacy settings. |
| `failed` | Message could not be delivered. | Terminal failure. | Includes `errors[].code`, `errors[].title`, `errors[].message`, `errors[].error_data`. |

---

## 6. Authoritative Relayqo State Machine

Relayqo defines five authoritative delivery states:

```
                      AUTHORITATIVE DELIVERY STATE MACHINE
                      
                                  ┌──────────┐
                                  │ PENDING  │ (Rank 0)
                                  └────┬─────┘
                                       │
                      ┌────────────────┴────────────────┐
                      │ Synchronous Meta HTTP 200       │ Terminal Error / 
                      │ OR Webhook "sent"               │ Retries Exhausted
                      ▼                                 ▼
                 ┌──────────┐                     ┌──────────┐
                 │   SENT   │ (Rank 1)            │  FAILED  │ (Terminal)
                 └────┬─────┘                     └──────────┘
                      │                                 ▲
                      │ Webhook "delivered"             │
                      ▼                                 │ Webhook "failed"
                 ┌───────────┐                          │ (from PENDING/SENT)
                 │ DELIVERED │ (Rank 2)                 │
                 └────┬──────┘                          │
                      │                                 │
                      │ Webhook "read"                  │
                      ▼                                 │
                 ┌───────────┐                          │
                 │   READ    │ (Rank 3) ────────────────┘
                 └───────────┘
```

### State Definitions
1. **`PENDING` (Rank 0)**: Outbound message recorded locally and enqueued. Transmission outcome not yet confirmed.
2. **`SENT` (Rank 1)**: Provider acceptance confirmed via synchronous HTTP 200 `wamid` receipt or webhook `sent` event.
3. **`DELIVERED` (Rank 2)**: Confirmed delivery to the recipient's device via Meta `delivered` webhook event.
4. **`READ` (Rank 3)**: Confirmed read by recipient via Meta `read` webhook event.
5. **`FAILED` (Terminal)**: Dispatch failure locally or terminal failure reported by Meta via webhook `failed` event.

---

## 7. Monotonic Transition Rules

Webhooks from Meta may arrive out of order, be duplicated, or be delayed. State updates must be strictly monotonic based on rank:

$$\text{Rank}(\text{PENDING}) = 0 < \text{Rank}(\text{SENT}) = 1 < \text{Rank}(\text{DELIVERED}) = 2 < \text{Rank}(\text{READ}) = 3$$

### Monotonic Transition Matrix

| Current State \ Incoming Event | `sent` | `delivered` | `read` | `failed` |
| :--- | :--- | :--- | :--- | :--- |
| **`PENDING`** | ✅ Advance to `SENT` | ✅ Fast-forward to `DELIVERED` | ✅ Fast-forward to `READ` | ❌ Transition to `FAILED` |
| **`SENT`** | ⏸️ Ignore (no-op, ACK 200) | ✅ Advance to `DELIVERED` | ✅ Fast-forward to `READ` | ❌ Transition to `FAILED` |
| **`DELIVERED`** | ⏸️ Ignore (no-op, ACK 200) | ⏸️ Ignore (no-op, ACK 200) | ✅ Advance to `READ` | ⚠️ Log anomaly, do NOT regress |
| **`READ`** | ⏸️ Ignore (no-op, ACK 200) | ⏸️ Ignore (no-op, ACK 200) | ⏸️ Ignore (no-op, ACK 200) | ⚠️ Log anomaly, do NOT regress |
| **`FAILED`** | ⏸️ Ignore (no-op, ACK 200) | ⏸️ Ignore (no-op, ACK 200) | ⏸️ Ignore (no-op, ACK 200) | ⏸️ Ignore (no-op, ACK 200) |

*Rule: An incoming event is applied to `Message` if and only if its rank is strictly greater than the current rank, with `FAILED` applying only to `PENDING` and `SENT` states.*

---

## 8. Idempotency Strategy

Meta guarantees at-least-once webhook delivery. Duplicate status events must be handled cleanly.

### Deduplication Key
Meta does not provide an event UUID, but the combination of channel identity, provider message ID, status, and provider timestamp is unique:

$$\text{DedupeKey} = \text{sha256}(\text{phoneNumberId} + ":" + \text{wamid} + ":" + \text{status} + ":" + \text{providerTimestamp})$$

### Ingestion Flow
1. Compute `dedupeKey`.
2. Insert into a new `WhatsAppDeliveryReceipt` table with a unique constraint on `dedupeKey`.
3. If duplicate (`P2002` constraint error):
   - Immediately acknowledge with `HTTP 200 { status: 'ACK', duplicate: true }`.
   - Discard from queue to avoid redundant processing.

---

## 9. Out-of-Order Webhook Handling

Because cellular networks and Meta webhooks are distributed:
1. `delivered` can arrive before `sent`.
2. `read` can arrive before `delivered`.
3. `sent` can arrive minutes after `read`.

### Algorithm
```typescript
function shouldApplyStatusTransition(currentStatus: string, incomingStatus: string): boolean {
  const RANK: Record<string, number> = {
    PENDING: 0,
    SENT: 1,
    DELIVERED: 2,
    READ: 3
  };

  if (currentStatus === incomingStatus) return false;
  if (currentStatus === 'READ') return false; // Terminal success
  if (currentStatus === 'FAILED') return false; // Terminal failure

  if (incomingStatus === 'FAILED') {
    return currentStatus === 'PENDING' || currentStatus === 'SENT';
  }

  const curRank = RANK[currentStatus] ?? -1;
  const newRank = RANK[incomingStatus] ?? -1;

  return newRank > curRank;
}
```

---

## 10. Correlation Race Strategy

### The Race
1. Worker sends outbound request to Meta Graph API.
2. Meta accepts and immediately dispatches a webhook to Relayqo Web server (`/webhooks/whatsapp`).
3. Web server receives the webhook before the worker has committed `providerMessageId` (`externalId`) to the `Message` table.
4. If the Web server looks up `Message` by `externalId`, it finds zero rows.

### The Solution: Two-Way Reconciliation
```
                       TWO-WAY RECONCILIATION PATTERN
                       
  Case A: Normal Flow
  Worker commits externalId ──► Message created ──► Webhook arrives ──► Updates Message

  Case B: Correlation Race
  Meta Webhook arrives first
       │
       ▼
  Persist to "WhatsAppDeliveryReceipt" (status: PENDING_CORRELATION)
       │
       ├── Try correlate with "Message" ──► Not found! (Do NOT drop)
       │
  Worker finishes Meta API call
       │
       ▼
  Worker commits externalId to "Message"
       │
       ▼
  Worker immediately queries "WhatsAppDeliveryReceipt" WHERE providerMessageId = wamid
       │
       └── Found pending receipts! Applies highest monotonic state immediately!
```

---

## 11. Crash & Ambiguous Send Analysis

### The Problem
If a worker sends an HTTP request to Meta, Meta receives and transmits the message to the customer, but the worker process dies or the connection drops before receiving the response:
- Relayqo does not have the `providerMessageId`.
- Blindly retrying will send the message to the customer a second time.

### Mitigation Architecture
1. **No Blind Retries on Network Resets**: `WhatsAppOutboundAdapter` already catches socket exceptions and returns `errorCode: 'DELIVERY_UNKNOWN', isRetryable: false`.
2. **Lease Protection**: When a worker claims an outbound job, it marks `outboundStatus = 'SENDING'`. If the lease expires without completion, the queue marks it `status: 'FAILED', outboundStatus: 'UNKNOWN'`.
3. **Reconciliation Window**: A job in `UNKNOWN` state cannot be retried until a reconciliation sweep checks whether Meta has emitted a webhook for that recipient with matching timestamp/content window.

---

## 12. Retry Classification

### Retryable Errors (Transient)
- **HTTP 429 / Meta Code 130429**: Rate limit throughput hit.
- **Meta Code 131056**: Rate limit hit.
- **Meta Code 131030**: Pairing rate limit.
- **Meta Code 80007**: Rate limit exceeded.
- **HTTP 500, 502, 503, 504**: Meta server downtime or gateway error.
- **Socket Reset before HTTP headers sent**.

### Non-Retryable Errors (Permanent)
- **HTTP 400**: Malformed request payload.
- **HTTP 401 / Meta Code 190**: Access token expired or invalid.
- **Meta Code 131026**: Message undeliverable (phone number not on WhatsApp).
- **Meta Code 131047**: Re-engagement window expired (outside 24h CSW).
- **Meta Code 131051**: Unsupported message type.
- **Meta Code 131053**: Spam / policy violation.

### Backoff Strategy
- Initial backoff: $300\text{ ms}$
- Exponential factor: $2^{\text{attempt} - 1}$
- Maximum attempts: 3
- Jitter: $\pm 10\%$ to avoid thundering herds.

---

## 13. Terminal Failure & Dead-Letter Strategy

When retries are exhausted or a non-retryable error occurs:
1. `WhatsAppOutboundJob`: Set `status = 'FAILED'`, `completedAt = now()`, `lastError = sanitizedError`.
2. `Message`: Set `metadata.deliveryStatus = 'FAILED'`, `metadata.error = sanitizedError`.
3. `ChannelAuditEvent`: Record `action = 'HUMAN_MESSAGE_FAILED'` (or `'AI_MESSAGE_FAILED'`).
4. In Merchant Inbox UI: Renders `Failed to send` in red with an inline `Retry` button.
5. No separate dead-letter table is required because `WhatsAppOutboundJob` preserves all failed jobs with full diagnostic fields and indexes.

---

## 14. Schema Recommendations

### Recommendation: Add `WhatsAppDeliveryReceipt` Table
To resolve the correlation race, provide durable receipt ingestion, and preserve an audit log of provider events:

```prisma
model WhatsAppDeliveryReceipt {
  id                String   @id @default(uuid())
  dedupeKey         String   @unique
  tenantId          String
  accountId         String
  phoneNumberId     String
  providerMessageId String   // wamid
  recipientWaId     String
  status            String   // sent, delivered, read, failed
  providerTimestamp DateTime
  errorCode         Int?
  errorMessage      String?
  correlated        Boolean  @default(false)
  createdAt         DateTime @default(now())

  tenant  Tenant  @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  account Account @relation(fields: [accountId], references: [id], onDelete: Cascade)

  @@index([tenantId, accountId])
  @@index([providerMessageId, correlated])
  @@index([createdAt])
}
```

### Analysis: `providerMessageId` on `Message`
- `Message.externalId` is ALREADY a typed, unique-indexed column (`@@unique([tenantId, externalId])`).
- **Recommendation**: Keep `Message.externalId` as the provider message ID column. Do NOT create a duplicate column.
- For AI messages, fix the gap by setting `Message.externalId = providerMessageId` upon successful outbound send.
- Add typed delivery tracking fields into `Message.metadata`:
  - `metadata.deliveryStatus`: `'PENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED'`
  - `metadata.sentAt`: timestamp ms
  - `metadata.deliveredAt`: timestamp ms
  - `metadata.readAt`: timestamp ms
  - `metadata.failedAt`: timestamp ms
  - `metadata.providerErrorCode`: number
  - `metadata.providerErrorMessage`: string

---

## 15. Required Indexes

1. `WhatsAppDeliveryReceipt`:
   - `@@unique([dedupeKey])` (Idempotent webhook insertion)
   - `@@index([providerMessageId, correlated])` (Fast correlation lookup)
   - `@@index([tenantId, accountId, createdAt])` (Tenant audit trail)
2. `Message`:
   - `@@unique([tenantId, externalId])` (Already exists; used for tenant-safe `wamid` lookup)
   - `@@index([conversationId, createdAt(sort: Asc)])` (Already exists; chronological transcript)

---

## 16. Tenant-Isolation Proof

Status processing must never execute an untrusted query like `UPDATE Message SET status = ... WHERE externalId = ...` without tenant verification.

### Trusted Resolution Chain
```
  1. Webhook Ingress (Meta payload)
     └── value.metadata.phone_number_id
          │
          ▼
  2. WhatsAppNumberService.resolveAccountByPhoneNumberId(phoneNumberId)
     └── Matches WhatsAppBusinessNumber WHERE phoneNumberId = $1 AND enabled = true
          │
          ├── Validates number exists and is active.
          └── Retrieves authoritative { tenantId, accountId }
               │
               ▼
  3. Message Correlation Query
     └── SELECT * FROM "Message" 
         WHERE "tenantId" = resolvedTenantId 
           AND "externalId" = status.providerMessageId
```

*Proof*: Even if two distinct tenants somehow had colliding `wamid` strings, Tenant A's webhook verified via Tenant A's `phone_number_id` will query strictly with `"tenantId" = TenantA`, completely preventing cross-tenant mutation.

---

## 17. Webhook Security Boundary

1. **Signature Verification**: Validates Meta's HMAC SHA-256 signature using `WHATSAPP_APP_SECRET`. Unsigned or mismatched signatures are rejected with HTTP 401.
2. **Fail-Closed in Production**: If `WHATSAPP_APP_SECRET` is missing in production, ingress rejects all webhooks with HTTP 500.
3. **Number Ownership**: Unregistered or disabled `phoneNumberId` values are rejected with HTTP 200 ACK (to prevent Meta retries) and dropped without processing.
4. **Credential Redaction**: Raw headers, access tokens, and decrypted credentials are never logged.

---

## 18. Web / Worker Responsibility Split

Preserves Phase 2 Web/Worker runtime boundaries:

```
  ┌─────────────────────────────────────────────────────────────┐
  │                        WEB RUNTIME                          │
  │  1. Authenticate Meta HMAC signature (X-Hub-Signature-256)   │
  │  2. Parse webhook envelope (extract value.statuses)          │
  │  3. Resolve phoneNumberId -> { tenantId, accountId }        │
  │  4. Insert into WhatsAppDeliveryReceipt (durable dedupe)     │
  │  5. Fast HTTP 200 ACK to Meta (<50ms)                        │
  │  * ZERO LLM calls, ZERO heavy DB operations                 │
  └──────────────────────────────┬──────────────────────────────┘
                                 │
                                 │ PostgreSQL (WhatsAppDeliveryReceipt)
                                 ▼
  ┌─────────────────────────────────────────────────────────────┐
  │                       WORKER RUNTIME                        │
  │  1. Claim pending status receipts                           │
  │  2. Query Message WHERE tenantId = $1 AND externalId = $2   │
  │  3. Evaluate monotonic state rank                           │
  │  4. Update Message metadata atomically                      │
  │  5. Reconcile unmatched receipts or ambiguous send jobs     │
  │  * ZERO HTTP listeners or public endpoints                  │
  └─────────────────────────────────────────────────────────────┘
```

---

## 19. Merchant Inbox Integration

The Phase 3C inbox already polls `GET /api/client/conversations/:id` every 4 seconds.
- In `src/portal/PortalRouter.ts`: `GET /conversations/:id` sends `messages: [{ id, role, content, metadata: { deliveryStatus, sentAt, deliveredAt, readAt, ... } }]`.
- In `src/portal/ui/inbox.js`: Expand the delivery badge renderer:
  - `PENDING` $\rightarrow$ `⏳ Sending…` (`.delivery-pending`)
  - `SENT` $\rightarrow$ `✓ Sent` (`.delivery-sent`)
  - `DELIVERED` $\rightarrow$ `✓✓ Delivered` (`.delivery-delivered`)
  - `READ` $\rightarrow$ `✓✓ Read` (`.delivery-read`)
  - `FAILED` $\rightarrow$ `✕ Failed to send` (`.delivery-failed`) with `Retry` button.
- Zero WebSockets required; updates render automatically on the existing 4-second polling cycle.

---

## 20. Observability Plan

Structured JSON logging events for all lifecycle checkpoints:
1. `whatsapp.delivery.receipt_ingested`: `wamid`, `phoneNumberId`, `status`, `tenantId`.
2. `whatsapp.delivery.duplicate_dropped`: `wamid`, `status`, `dedupeKey`.
3. `whatsapp.delivery.transition_applied`: `messageId`, `oldStatus`, `newStatus`, `wamid`.
4. `whatsapp.delivery.transition_suppressed`: `messageId`, `currentStatus`, `staleStatus` (monotonic guard).
5. `whatsapp.delivery.unmatched_retained`: `wamid`, `status`, `reason`.
6. `whatsapp.delivery.reconciled`: `messageId`, `wamid`, `receiptId`.
7. `whatsapp.delivery.terminal_failure`: `messageId`, `wamid`, `errorCode`, `sanitizedError`.

*Constraint: Never log message content or auth tokens.*

---

## 21. Reconciliation Strategy

A lightweight worker background sweep running every 60 seconds:
1. **Unmatched Receipts Sweep**: Finds `WhatsAppDeliveryReceipt` with `correlated = false` created within the last 2 hours. Attempts lookup against `Message WHERE tenantId = $1 AND externalId = $2`. If matched, updates `Message` and marks `correlated = true`.
2. **Ambiguous Sends Sweep**: Inspects `WhatsAppOutboundJob` in `PROCESSING` with expired lease and `outboundStatus = 'SENDING'`. Queries whether a delivery receipt for the expected recipient exists in `WhatsAppDeliveryReceipt`. If found, marks `COMPLETED`; otherwise transitions to `FAILED`.

---

## 22. Race-Condition Analysis

| Race Condition | Trigger Scenario | Defense Mechanism |
| :--- | :--- | :--- |
| **Race 1: Webhook before DB Commit** | Webhook `delivered` arrives before worker commits `externalId`. | Two-way reconciliation: Unmatched receipts stored in `WhatsAppDeliveryReceipt`. Worker checks for pending receipts upon commit; background sweep reconciles stragglers. |
| **Race 2: Out-of-Order Webhooks** | `sent` webhook arrives 10 seconds after `read` webhook. | Monotonic ranking check (`Rank(SENT) < Rank(READ)`). State regression is strictly rejected. |
| **Race 3: Duplicate Webhooks** | Meta delivers same webhook 3 times. | Deduplication key unique constraint in `WhatsAppDeliveryReceipt`. Duplicates ACK'd with HTTP 200 and dropped. |
| **Race 4: Worker Crash during Send** | Network drops after Meta received request. | `DELIVERY_UNKNOWN` safety rule prevents blind retry; requires receipt reconciliation. |
| **Race 5: Cross-Tenant Collision** | Attacker crafts spoofed `wamid`. | Tenant boundary enforced via `WhatsAppBusinessNumber.phoneNumberId`; query includes `WHERE tenantId = $1`. |

---

## 23. Critical Questions & Explicit Answers

1. **What does Relayqo currently mean by `SENT`?**
   - It means Meta accepted the transmission request via synchronous HTTP 200 and returned a `wamid`. It does *not* indicate delivery to device or reading by the customer.
2. **Does Relayqo currently process Meta `sent`, `delivered`, `read`, and `failed` webhook statuses?**
   - No. All `statuses` events are dropped with an immediate HTTP 200 in `WhatsAppWebhookRouter.ts`.
3. **What should be the authoritative delivery state machine?**
   - `PENDING` $\rightarrow$ `SENT` $\rightarrow$ `DELIVERED` $\rightarrow$ `READ`, with `FAILED` as the terminal error state.
4. **How do we prevent stale events from regressing message state?**
   - Monotonic rank comparison: $\text{Rank}(new) > \text{Rank}(current)$.
5. **How do we deduplicate status webhooks?**
   - Deterministic SHA-256 deduplication key stored with unique constraint in `WhatsAppDeliveryReceipt`.
6. **How do we handle a status webhook arriving before `providerMessageId` is committed?**
   - Store in `WhatsAppDeliveryReceipt` as pending correlation; reconcile when worker commits `externalId` and via 60-second background worker sweep.
7. **Can Relayqo guarantee exactly-once outbound WhatsApp delivery?**
   - No. True exactly-once delivery over external distributed HTTP networks without two-phase commit is impossible.
8. **If not, what duplicate-send mitigation should be used?**
   - Pre-flight `SENDING` state, `DELIVERY_UNKNOWN` on socket errors, deduplication keys on manual sends, and reconciliation before retrying.
9. **Which Meta failures are retryable?**
   - HTTP 429, Meta rate codes (130429, 131056, 131030, 80007), HTTP 5xx, and pre-request connection errors.
10. **What happens when retries are exhausted?**
    - The job and message transition to `FAILED`, audit event is recorded, and merchant sees `Failed to send` with a `Retry` button.
11. **Should `providerMessageId` become an indexed typed column?**
    - `Message.externalId` is already a typed, unique-indexed column (`@@unique([tenantId, externalId])`). We should reuse it and ensure AI assistant messages also populate it.
12. **Do we need a new provider-event/status table?**
    - Yes: `WhatsAppDeliveryReceipt` is essential for correlation-race buffering, deduplication, and provider event auditing.
13. **How is tenant ownership proven before a delivery update?**
    - Verified `phone_number_id` from Meta's envelope maps to a registered `WhatsAppBusinessNumber`, which supplies the trusted `tenantId`.
14. **Which logic belongs in web versus worker?**
    - Web: signature validation, phone-number resolution, fast receipt ingestion, immediate HTTP 200.
    - Worker: receipt processing, monotonic state updates, retries, and reconciliation.
15. **How will the Phase 3C inbox learn about `DELIVERED` and `READ`?**
    - Via its existing 4-second polling of `GET /api/client/conversations/:id`, which returns `message.metadata.deliveryStatus`.
16. **What reconciliation mechanism is required?**
    - A periodic 60-second worker sweep checking unmatched receipts and expired ambiguous send jobs.
17. **What is the smallest safe Phase 4B implementation?**
    - 1 Prisma migration for `WhatsAppDeliveryReceipt`.
    - Update `WhatsAppWebhookExtractor` and `WhatsAppWebhookRouter` to persist status events.
    - Add worker delivery receipt processor with monotonic rank check.
    - Set `Message.externalId` on AI replies in `WhatsAppWorker`.
    - Update `inbox.js` and `portal.css` to render `DELIVERED` and `READ`.
    - Add 33 integration tests.

---

## 24. Phase 4B Implementation Sequence

```
  Step 1: Prisma Schema Migration
  └── Add WhatsAppDeliveryReceipt model with unique index on dedupeKey.

  Step 2: Webhook Status Ingestion (Web Runtime)
  └── Update WhatsAppWebhookExtractor to parse value.statuses.
  └── Update WhatsAppWebhookRouter to resolve tenant from phoneNumberId and persist receipt.

  Step 3: AI Message ID Persistence (Worker Runtime)
  └── Update WhatsAppWorker to set Message.externalId = providerMessageId upon send.

  Step 4: Delivery Receipt Processor & Monotonic State Transitions (Worker Runtime)
  └── Implement receipt processing logic with monotonic rank enforcement and two-way reconciliation.

  Step 5: Merchant Inbox UI Updates (Portal Assets)
  └── Update portal.css and inbox.js to render 'Delivered' and 'Read' badges.

  Step 6: Automated Test Suite Implementation
  └── Implement all 33 required tests in tests/integration/whatsapp-delivery-reliability.spec.ts.
```

---

## 25. Phase 4B Automated Test Matrix

The Phase 4B test suite (`tests/integration/whatsapp-delivery-reliability.spec.ts`) will implement:

1. Outbound message starts in `PENDING` state.
2. Meta acceptance transitions message to `SENT`.
3. `delivered` status webhook transitions message to `DELIVERED`.
4. `read` status webhook transitions message to `READ`.
5. `failed` status webhook transitions message to `FAILED`.
6. Duplicate `sent` event is idempotent and does not alter state.
7. Duplicate `delivered` event is idempotent and does not alter state.
8. Duplicate `read` event is idempotent and does not alter state.
9. `READ` followed by stale `SENT` remains `READ` (monotonic rule).
10. `DELIVERED` followed by stale `SENT` remains `DELIVERED` (monotonic rule).
11. `read` arriving before `delivered` results in `READ` without regression.
12. Malformed status webhook envelope is safely ignored with HTTP 200.
13. Forged webhook HMAC signature is rejected with HTTP 401.
14. Unknown provider message ID does not corrupt another message.
15. Unmatched valid status is preserved in `WhatsAppDeliveryReceipt` for reconciliation.
16. Cross-tenant provider lookup cannot update another tenant's message.
17. HTTP 429 causes retry with backoff.
18. Meta 5xx causes retry with backoff.
19. Network timeout causes retry or marks `DELIVERY_UNKNOWN`.
20. Permanent Meta error (e.g. Code 190) does not retry.
21. Retry exhaustion produces terminal `FAILED` status.
22. Worker restart preserves pending retry jobs.
23. Duplicate worker claim does not double-process outbound jobs.
24. Merchant inbox displays `DELIVERED` badge.
25. Merchant inbox displays `READ` badge.
26. Merchant inbox displays sanitized failure information.
27. Status polling updates UI without page reload.
28. Webhook ingress remains fast and never calls LLMs.
29. Web runtime remains strictly producer-only.
30. Worker runtime remains free of HTTP listeners.
31. AI assistant replies receive provider message ID and delivery updates.
32. Correlation race: webhook arriving before DB commit successfully reconciles.
33. Ambiguous send: lease expiration on `SENDING` avoids duplicate dispatch.

---

## 26. Deferred Improvements

1. **WhatsApp Read Receipt Opt-Out Handling**: When customers disable read receipts in WhatsApp settings, Meta only delivers up to `delivered`. The UI should recognize that some messages may permanently remain `DELIVERED`.
2. **Template Re-engagement from Inbox**: Allowing merchants to select pre-approved Meta templates directly from the composer when the 24-hour Customer Service Window has expired.
3. **Billing & Category Analytics**: Parsing `pricing.category` (`marketing`, `utility`, `service`, `authentication`) from `sent` status webhooks to display real-time Meta conversation cost analytics.
