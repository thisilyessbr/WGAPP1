# Relayqo — Web / Worker Runtime Architecture

**Document Status**: APPROVED / ARCHITECTURE SPECIFICATION  
**Author**: Lead Software Architect  
**Date**: September 2026  
**Scope**: Phase 2 — Web / Worker Runtime Separation  

---

## 1. Executive Summary

Relayqo is evolving from a monolithic single-process Node.js application into two independently deployable, independently scalable runtime processes:

1. **Web Process (`relayqo-web`)**: Exclusively handles HTTP ingress, REST APIs, authentication/authorization, portal assets/sessions, Meta WhatsApp webhook verification, deduplication, and fast durable job enqueueing to PostgreSQL. It **never** runs LLMs, RAG, AI agents, or background message processing loops.
2. **Worker Process (`relayqo-worker`)**: Exclusively consumes inbound WhatsApp message jobs from PostgreSQL (`WhatsAppMessageJob`) using `FOR UPDATE SKIP LOCKED` and transactional advisory locks. It orchestrates `ConversationEngine`, RAG pipelines, LLM generation, safety guards, outbound WhatsApp message delivery, retries, and document indexing. It **never** starts an Express server or opens listening HTTP ports.

PostgreSQL acts as the single durable boundary and source of truth between the two runtimes. No distributed broker (Redis, BullMQ, Kafka) is added, preserving operational simplicity and strict transactional integrity.

---

## 2. Investigation Findings (The 10 Architectural Questions)

### Question 1: How is the application currently started in development and production?
- **Current State**:
  - `package.json` defines:
    - `"dev": "npx tsx src/app.ts"`
    - `"start": "node dist/src/app.js"`
    - `"build": "prisma generate && tsc -p tsconfig.build.json"`
  - `src/app.ts` checks:
    ```typescript
    if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
      bootstrap();
    }
    ```
  - `bootstrap()` initializes the PostgreSQL connection via `pg.Pool` and `@prisma/adapter-pg`, calls `bootstrapChatbot(prisma)`, passes all returned dependencies to `createApp(deps)`, and binds Express to `config.port` on `0.0.0.0`.
  - Because `bootstrapChatbot(prisma)` is invoked unconditionally inside `src/app.ts`, importing or running `src/app.ts` instantiates both web routers AND message workers simultaneously.

---

### Question 2: Which code starts the Express server?
- **Current Call Site**:
  - Located in `src/app.ts`, line 134:
    ```typescript
    const host = process.env.HOST || '0.0.0.0';
    app.listen(Number(config.port), host, () => {
      logger.info(`Server started on port ${config.port} (host: ${host})`);
    });
    ```
  - **Condition**: Executed only within `async function bootstrap()` when `process.env.NODE_ENV !== 'test' && !process.env.VITEST`.
  - In unit and integration tests, `createApp(deps)` is called directly and passed to `supertest(app)` without binding a live TCP network port.

---

### Question 3: Which code starts the WhatsApp worker?
- **Current Call Site**:
  - In `src/bootstrap.ts` (lines 113–115 & 165–173):
    ```typescript
    const whatsAppMessageQueue = isTestEnv
      ? new PartitionedFifoQueue<InboundQueueJob>()
      : new PostgresMessageQueue(prisma, { autoStartWorker: true });

    const whatsAppWorker = new WhatsAppWorker(
      whatsAppMessageQueue,
      conversationEngine,
      whatsAppOutboundAdapter,
      whatsAppNumberService,
      whatsAppPolicyAdapter,
      channelRouter,
      clientSafetyGuard
    );
    ```
  - Inside `src/domain/channel/whatsapp/MessageQueue.ts` (lines 179–181):
    ```typescript
    if (options.autoStartWorker) {
      this.startWorker();
    }
    ```
    `startWorker()` sets `this.pollTimer = setInterval(() => this.pulseWorkers(), this.pollIntervalMs);`.
  - Inside `src/domain/channel/whatsapp/WhatsAppWorker.ts` (line 49):
    ```typescript
    this.registerHandler();
    ```
    This registers `this.processJob(job)` on the queue. As soon as a handler is registered and `pollTimer` ticks, `pulseWorkers()` fires `workerLoop()`, which claims jobs with `claimNextJob()`.

---

### Question 4: Does the worker currently start automatically when importing or initializing `bootstrap.ts`?
- **Yes.**
  1. `bootstrapChatbot(prisma)` unconditionally instantiates `PostgresMessageQueue` with `{ autoStartWorker: true }` in non-test environments.
  2. `bootstrapChatbot(prisma)` unconditionally instantiates `WhatsAppWorker`, which immediately binds its handler to the queue in its constructor.
  3. `PortalService.attach(deps)` in `bootstrapChatbot` checks:
     ```typescript
     if (process.env.PORTAL_DOCUMENT_WORKER === 'true' && process.env.NODE_ENV !== 'test') {
       this.documents.start();
     }
     ```
     This starts an unreferenced 5-second `setInterval` polling loop (`PortalDocuments.tick()`) that claims documents for PDF ingestion and embedding generation.
  4. Consequently, in the monolithic setup, web HTTP request handling and AI queue processing are intertwined in the same event loop.

---

### Question 5: What services/dependencies are needed ONLY by Web vs. Worker vs. BOTH?

| Component / Service | Needed by Web | Needed by Worker | Rationale |
| :--- | :---: | :---: | :--- |
| **`pg.Pool` & `PrismaClient`** | **YES** | **YES** | Both require database access (Web for routing, auth, queueing; Worker for job claims, conversation state, RAG). |
| **`config` & `validateProductionConfig`** | **YES** | **YES** | Both validate their respective environment configs at startup. |
| **`logger`** | **YES** | **YES** | Shared structured logging. |
| **`SecretBox`** | **YES** | **YES** | Web uses it for Embedded Signup / OAuth state; Worker uses it to decrypt Meta Graph API tokens. |
| **`WhatsAppNumberService`** | **YES** | **YES** | Web resolves `phoneNumberId` $\to$ `tenantId/accountId`; Worker retrieves channel credentials and settings. |
| **`AccountConfigService` / `TenantConfigService`** | **YES** | **YES** | Web configures portal/business settings; Worker reads prompts, workflows, and limits. |
| **`TelemetryClient`** | **YES** | **YES** | Both emit operational metrics and audit events. |
| **`PostgresMessageQueue` (Producer mode)** | **YES** | **NO** | Web enqueues jobs via `queue.enqueue(...)` with `autoStartWorker: false`. |
| **`WhatsAppWebhookRouter`** | **YES** | **NO** | Web processes GET challenge and POST HMAC ingestion. |
| **`WhatsAppOnboardingRouter` & Service** | **YES** | **NO** | Web serves Embedded Signup OAuth redirects and registration endpoints. |
| **`PortalRouter` & UI assets** | **YES** | **NO** | Web serves customer/admin portal UI and REST endpoints. |
| **`createApiRouter`** | **YES** | **NO** | Web serves REST APIs (`/api/v1/*`). |
| **`multer` & route rate limiters** | **YES** | **NO** | Web HTTP protection and file ingestion middleware. |
| **`PostgresMessageQueue` (Consumer mode)** | **NO** | **YES** | Worker polls, claims (`FOR UPDATE SKIP LOCKED`), locks, and completes jobs. |
| **`WhatsAppWorker`** | **NO** | **YES** | Worker coordinates safety guard, conversation processing, and outbound delivery. |
| **`ConversationEngine`** | **NO** | **YES** | Heavy AI agent loop, LLM dispatch, state transitions, customer history. |
| **`WorkflowEngine` & Evaluator** | **NO** | **YES** | Deterministic business workflow execution. |
| **`LLMFactory` & Providers** | **NO** | **YES** | DeepSeek, Google Gemini, Metered LLM calls. |
| **`RAGService` & `EmbeddingProvider`** | **NO** | **YES** | Semantic vector search and Gemini text embeddings. |
| **`PdfIngestionService`** | **NO** | **YES** | PDF chunking, hashing, and vector index updates. |
| **`PortalDocuments` worker loop** | **NO** | **YES** | Background document processing worker (`PORTAL_DOCUMENT_WORKER=true`). |
| **`ImageCapabilityGateway`** | **NO** | **YES** | Vision model processing. |
| **`WhatsAppOutboundAdapter` & `MetaCloudTransport`** | **NO** | **YES** | Meta Cloud API HTTP client for outbound message delivery. |
| **`ClientSafetyGuard`** | **NO** | **YES** | Circuit breaker, rate limiting, human handoff status check. |
| **`ChannelRouter`** | **NO** | **YES** | Routes outbound responses to Meta Cloud or QR transport. |

---

### Question 6: How should shared initialization logic be structured?
- Create a dedicated, clean runtime infrastructure module: `src/runtime/shared.ts`.
- **Responsibilities**:
  1. `initDatabase(options: DatabaseInitOptions)`: Safely extracts connection parameters (handling `prisma+postgres://` protocol parsing), constructs a dedicated `pg.Pool`, attaches `PrismaPg`, returns an initialized `PrismaClient` and `Pool`.
  2. `validateRuntimeConfig(runtime: 'web' | 'worker')`: Validates the environment fail-closed based on process requirements:
     - `web`: Enforces `DATABASE_URL`, `AUTH_SECRET` ($\ge 32$), `ENCRYPTION_KEY` ($\ge 32$), `WHATSAPP_APP_SECRET`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `META_APP_ID`, `META_APP_SECRET`, `SIGNUP_STATE_SECRET`.
     - `worker`: Enforces `DATABASE_URL`, `ENCRYPTION_KEY` ($\ge 32$), and at least one LLM key (`DEEPSEEK_API_KEY` or `GOOGLE_API_KEY`). Worker startup fails immediately if neither LLM key is present.
  3. Factory functions to instantiate shared repositories: `createSharedServices(prisma)`.
  4. Uniform process signal trapping helper (`setupSignalHandlers`).

---

### Question 7: How should the database connection pool be configured for web vs. worker?
- **Isolation Requirement**: Web and Worker must maintain independent connection pools so a spike in inbound webhooks or portal users cannot starve worker transaction claims, and worker transactions cannot starve health checks.
- **Web Pool Configuration**:
  - `WEB_DB_POOL_MAX`: Defaults to **15** (configurable up to 30 for high-burst webhook ingestion).
  - `idleTimeoutMillis`: 30,000 ms.
  - `connectionTimeoutMillis`: 5,000 ms (fast-fail if DB is overloaded).
- **Worker Pool Configuration**:
  - `WORKER_DB_POOL_MAX`: Defaults to **6** (concurrency $2 \times$ workers + 1 document worker + 1 telemetry + 2 headroom).
  - Note: `PostgresMessageQueue` does NOT hold DB connections or transactions open during LLM / external API calls. Transactions are held only for the duration of the `SELECT ... FOR UPDATE SKIP LOCKED` query (< 10 ms).
  - `idleTimeoutMillis`: 30,000 ms.
  - `connectionTimeoutMillis`: 10,000 ms.

---

### Question 8: What is the current graceful shutdown behavior, and how must it differ?
- **Current State**:
  `src/app.ts` only registers `SIGTERM` and `SIGINT` which log and immediately run `await prisma.$disconnect(); process.exit(0);`. In-flight HTTP requests are severed; running jobs lose their database connections abruptly.
- **Web Process Shutdown Requirements**:
  1. Stop accepting new incoming HTTP connections via `server.close()`.
  2. Allow in-flight HTTP requests to complete within a bounded grace window (`WEB_SHUTDOWN_TIMEOUT_MS`, default 10,000 ms).
  3. Close database connections: `await prisma.$disconnect(); await pool.end();`.
  4. Terminate with exit code 0.
- **Worker Process Shutdown Requirements**:
  1. Halt claiming new jobs: `queue.shutdown()` sets `isShuttingDown = true` and clears `pollTimer`.
  2. Stop document indexing worker: `portalDocuments.stop()`.
  3. Await completion of all active in-flight worker jobs (`while (queue.getActiveCount() > 0)` bounded by `WORKER_SHUTDOWN_TIMEOUT_MS`, default 25,000 ms).
  4. If an in-flight job cannot complete before timeout, the process exits; the database lease expires naturally after `leaseSeconds` (60s), and another worker automatically recovers the job.
  5. Close database connections: `await prisma.$disconnect(); await pool.end();`.
  6. Terminate with exit code 0.

---

### Question 9: Are there background tasks or polling loops in web that must be moved to worker?
- **Yes**:
  1. **WhatsApp Message Queue Poller**: Currently runs inside Web via `autoStartWorker: true`. **Must be removed from Web**. Web must only instantiate `PostgresMessageQueue` with `autoStartWorker: false` (producer mode).
  2. **Portal Document Ingestion Worker**: Currently triggered in `PortalService.attach()` via `portalDocuments.start()`. **Must be removed from Web**. In Web, `PORTAL_DOCUMENT_WORKER` must be disabled or ignored. In Worker, document processing is started when enabled.
- **Remaining in Web**:
  - In-memory rate limiter window purge timer (lightweight, unreferenced).
  - Telemetry batch buffer flush timer.

---

### Question 10: What NPM scripts and build changes are needed?
- **Build**:
  - `tsconfig.build.json` already includes `src/**/*.ts`.
  - Both `src/runtime/web.ts` and `src/runtime/worker.ts` will compile cleanly to `dist/src/runtime/web.js` and `dist/src/runtime/worker.js`.
- **Scripts in `package.json`**:
  - `"dev:web": "npx tsx src/runtime/web.ts"`
  - `"dev:worker": "npx tsx src/runtime/worker.ts"`
  - `"start:web": "node dist/src/runtime/web.js"`
  - `"start:worker": "node dist/src/runtime/worker.js"`
  - Legacy `"dev"` and `"start"` scripts will be preserved for backward compatibility, defaulting to `web` or checking `process.env.RELAYQO_RUNTIME`.

---

## 3. Architecture Diagrams

### 3.1 Process Separation and Queue Boundary

```
[ Meta Cloud API ]
       |
       | Inbound Webhook (HTTPS POST)
       v
+-------------------------------------------------------------+
|                     RELAYQO WEB PROCESS                     |
|                                                             |
|  1. Fast HMAC-SHA256 Signature Verification                 |
|  2. Extract message payload & deduplicate wamid             |
|  3. Resolve phoneNumberId -> tenantId / accountId           |
|  4. INSERT INTO "WhatsAppMessageJob" (status: 'PENDING')    |
|  5. Return HTTP 200 { status: 'ACK' } immediately (<50ms)   |
|                                                             |
|  * NO LLMs * NO RAG * NO OUTBOUND SENDS * NO QUEUE CONSUMER |
+-------------------------------------------------------------+
                               |
                               | PostgreSQL Write
                               v
+-------------------------------------------------------------+
|                     POSTGRESQL DATABASE                     |
|                                                             |
|  Table: "WhatsAppMessageJob"                                |
|  - Strict FIFO per partitionKey (tenant:account:wa_id)      |
|  - Concurrency across different partitions                  |
|  - Atomic claim: SELECT pg_advisory_xact_lock(728519043)    |
|    WITH candidate AS (SELECT ... FOR UPDATE SKIP LOCKED)    |
+-------------------------------------------------------------+
                               ^
                               | Atomic Claim & State Updates
                               |
+-------------------------------------------------------------+
|                   RELAYQO WORKER PROCESS                    |
|                                                             |
|  1. Background Poll Timer (every 500ms)                     |
|  2. Atomically claim next eligible job                      |
|  3. Spawn background heartbeat (renew lease)                |
|  4. Execute Safety Guard (circuit breaker, tenant limits)   |
|  5. Execute ConversationEngine:                             |
|     - Workflow engine / State machine                       |
|     - RAG semantic vector search & embeddings               |
|     - LLM generation (DeepSeek / Gemini)                    |
|  6. Dispatch outbound reply via Meta Cloud API              |
|  7. UPDATE "WhatsAppMessageJob" status: 'COMPLETED'/'FAILED'|
|  8. Background Document Ingestion Worker (when enabled)     |
|                                                             |
|  * NO HTTP SERVER * NO PORT LISTENING * NO WEB ROUTES       |
+-------------------------------------------------------------+
```

---

## 4. Execution Readiness

With this architecture established:
1. `src/bootstrap.ts` will be refactored into clean dependency factories:
   - `bootstrapWebDependencies(prisma)`
   - `bootstrapWorkerDependencies(prisma)`
2. Entrypoints `src/runtime/web.ts` and `src/runtime/worker.ts` will provide explicit, dedicated process lifecycles.
3. Tests will prove complete isolation, zero worker timers in Web, zero open ports in Worker, and reliable job processing across simulated crash and restart cycles.
