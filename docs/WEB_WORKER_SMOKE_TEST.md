# Relayqo — Web / Worker Smoke Test Runbook

**Document Status**: APPROVED / TEST RUNBOOK  
**Author**: Lead Software Architect  
**Scope**: 16-Step Verification Procedure for Web / Worker Runtime Separation  

---

## Prerequisites

Ensure local or staging environment has PostgreSQL running and the `.env` file configured:
```env
PORT=3000
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/chatbot?schema=public
AUTH_SECRET=test-hmac-auth-secret-key-32chars!
ENCRYPTION_KEY=test-encryption-key-32-bytes-long!
WHATSAPP_APP_SECRET=test-meta-app-secret-32-chars-long!
WHATSAPP_WEBHOOK_VERIFY_TOKEN=relayqo-test-verify-token-2026
META_APP_ID=123456789012345
META_APP_SECRET=test-meta-app-secret-32-chars-long!
SIGNUP_STATE_SECRET=test-signup-state-secret-32chars!
DEEPSEEK_API_KEY=test-deepseek-api-key
```

---

## 16-Step Verification Procedure

### Step 1: Start Web Process Independently
Run:
```bash
npm run dev:web
```
**Expected Output**:
```
[WEB] Database connected (pool max: 15)
[WEB] Relayqo Web service running on http://0.0.0.0:3000
```
Verify that no `[WORKER]` logs appear and no worker polling loop is started.

---

### Step 2: Verify Port Binding on Web Process Only
Run:
```bash
curl -i http://localhost:3000/health
```
**Expected Response**:
```http
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

{
  "status": "healthy",
  "timestamp": "2026-09-20T...",
  "database": "connected"
}
```

---

### Step 3: Start Worker Process Independently in a Separate Terminal
Run:
```bash
npm run dev:worker
```
**Expected Output**:
```
[WORKER] Database connected (pool max: 6)
[WORKER] Relayqo WhatsApp Worker started (concurrency: 2)
```

---

### Step 4: Confirm Worker Does NOT Bind Any HTTP Port
In a third terminal, verify that the worker process did not open an HTTP listener:
```bash
# On Linux/macOS
lsof -i :3001
# On Windows PowerShell
Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -ne 3000 }
```
Worker process has zero open listening network ports.

---

### Step 5: Test Meta Webhook GET Handshake Verification (Web Process)
Send verification challenge:
```bash
curl -i "http://localhost:3000/api/v1/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=relayqo-test-verify-token-2026&hub.challenge=test_challenge_12345"
```
**Expected Response**:
```http
HTTP/1.1 200 OK
Content-Type: text/html; charset=utf-8

test_challenge_12345
```

---

### Step 6: Test Webhook Rejection on Missing or Invalid Signature
Send unsigned POST webhook:
```bash
curl -i -X POST http://localhost:3000/api/v1/webhook/whatsapp \
  -H "Content-Type: application/json" \
  -d '{"object":"whatsapp_business_account","entry":[]}'
```
**Expected Response**:
```http
HTTP/1.1 401 Unauthorized
{"error":"MISSING_SIGNATURE"}
```

---

### Step 7: Send Authenticated Webhook Payload with Valid HMAC-SHA256
Generate valid HMAC signature and send an inbound message from customer `+212611111111`:
```bash
# Payload:
PAYLOAD='{"object":"whatsapp_business_account","entry":[{"id":"WABA_1","changes":[{"value":{"messaging_product":"whatsapp","metadata":{"display_phone_number":"+212600000000","phone_number_id":"PHONE_ID_1"},"contacts":[{"profile":{"name":"Karim"},"wa_id":"212611111111"}],"messages":[{"from":"212611111111","id":"wamid.smoke.1","timestamp":"1789939000","text":{"body":"Salam, bghit nswlkom"},"type":"text"}]},"field":"messages"}]}]}'

# Compute HMAC using WHATSAPP_APP_SECRET
SIG=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "test-meta-app-secret-32-chars-long!" | sed 's/^.* //')

curl -i -X POST http://localhost:3000/api/v1/webhook/whatsapp \
  -H "Content-Type: application/json" \
  -H "X-Hub-Signature-256: sha256=$SIG" \
  -d "$PAYLOAD"
```
**Expected Response**:
```http
HTTP/1.1 200 OK
{"status":"ACK","processed":1}
```
**Latency**: < 50ms (acknowledged immediately before worker executes AI).

---

### Step 8: Verify Durable Queue State in PostgreSQL
Inspect the database table:
```sql
SELECT id, wamid, "partitionKey", status, "lockedBy", attempts, "createdAt"
FROM "WhatsAppMessageJob"
WHERE wamid = 'wamid.smoke.1';
```
**Expected Output**:
- Initially `status = 'PENDING'`
- Once Worker picks it up, `status = 'PROCESSING'`, `lockedBy = 'worker-...'`, `attempts = 1`.

---

### Step 9: Observe Worker Processing & ConversationEngine Logs
In the Worker terminal, verify:
```
[WORKER] Claimed job [wamid.smoke.1] for partition [tenant-1:account-1:212611111111]
[WORKER] Executing ConversationEngine pipeline...
[WORKER] Completed job [wamid.smoke.1] (status: COMPLETED)
```

---

### Step 10: Verify Database Completion State
Query the job in PostgreSQL:
```sql
SELECT id, wamid, status, "outboundStatus", response, "completedAt"
FROM "WhatsAppMessageJob"
WHERE wamid = 'wamid.smoke.1';
```
**Expected Output**:
- `status`: `'COMPLETED'`
- `outboundStatus`: `'SENT'`
- `response`: Non-empty Darija/Arabic customer response.

---

### Step 11: Verify Duplicate Webhook Idempotency (Replay Attack / Meta Retry)
Re-send the exact same payload from Step 7 with `wamid.smoke.1`:
```bash
curl -i -X POST http://localhost:3000/api/v1/webhook/whatsapp \
  -H "Content-Type: application/json" \
  -H "X-Hub-Signature-256: sha256=$SIG" \
  -d "$PAYLOAD"
```
**Expected Response**:
```http
HTTP/1.1 200 OK
{"status":"ACK","processed":1}
```
Query database:
```sql
SELECT COUNT(*) FROM "WhatsAppMessageJob" WHERE wamid = 'wamid.smoke.1';
```
**Expected Count**: Exactly `1` (atomic unique constraint prevented duplicate processing).

---

### Step 12: Test Direct Synchronous Chat Guard on Web Process
Attempt to invoke `/api/v1/chat` directly against the Web process:
```bash
curl -i -X POST http://localhost:3000/api/v1/chat \
  -H "Content-Type: application/json" \
  -H "x-tenant-id: dev-tenant" \
  -d '{"customerId":"cust-1","message":"Hello"}'
```
**Expected Response**:
```http
HTTP/1.1 503 Service Unavailable
{"error":"WORKER_RUNTIME_REQUIRED","message":"Direct synchronous AI chat is handled by the worker process. Inbound WhatsApp messages are processed asynchronously via the queue."}
```

---

### Step 13: Test Worker Crash & Lease Recovery
1. Simulate a worker crash by claiming a job and not completing it:
```sql
UPDATE "WhatsAppMessageJob"
SET status = 'PROCESSING', "lockedAt" = NOW() - INTERVAL '120 seconds'
WHERE wamid = 'wamid.smoke.1';
```
2. In the Worker terminal, notice that the worker automatically re-claims the abandoned job after lease expiration, increments `attempts` to 2, and recovers.

---

### Step 14: Test Portal Document Asynchronous Ingestion
1. In the Web process, upload a document via the portal UI or API.
2. Verify row created in `"PortalDocument"` with `status = 'PENDING'`.
3. Approve document: `status` becomes `'QUEUED'`.
4. In Worker terminal with `PORTAL_DOCUMENT_WORKER=true`, observe:
```
Portal document ingestion worker started
Processing document [doc-uuid]
Indexed into KnowledgeSource
```

---

### Step 15: Graceful Shutdown of Web Process
In the Web terminal, press `Ctrl+C` (or send `kill -TERM <pid>`):
**Expected Output**:
```
[WEB] Received SIGTERM. Starting graceful shutdown...
[WEB] Closing HTTP server and draining connections...
[WEB] Disconnecting database pool...
[WEB] Web runtime shutdown complete.
```
Process exits with code 0.

---

### Step 16: Graceful Shutdown of Worker Process
In the Worker terminal, press `Ctrl+C` (or send `kill -TERM <pid>`):
**Expected Output**:
```
[WORKER] Received SIGTERM. Starting graceful shutdown...
[WORKER] Stopping queue worker and awaiting in-flight jobs...
[WORKER] Disconnecting database pool...
[WORKER] Worker runtime shutdown complete.
```
Process drains in-flight jobs, releases leases, and exits with code 0.
