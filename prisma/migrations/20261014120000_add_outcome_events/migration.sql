-- CreateTable OutcomeEvent
CREATE TABLE IF NOT EXISTS "OutcomeEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE,
    "accountId" TEXT NOT NULL REFERENCES "Account"("id") ON DELETE CASCADE,
    "conversationId" TEXT REFERENCES "Conversation"("id") ON DELETE SET NULL,
    "customerId" TEXT REFERENCES "Customer"("id") ON DELETE SET NULL,
    "type" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "value" DECIMAL(12, 2),
    "currency" TEXT,
    "relatedOutcomeId" TEXT REFERENCES "OutcomeEvent"("id") ON DELETE SET NULL,
    "idempotencyKey" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "OutcomeEvent_accountId_idempotencyKey_key" ON "OutcomeEvent"("accountId", "idempotencyKey");
CREATE INDEX IF NOT EXISTS "OutcomeEvent_tenantId_accountId_type_occurredAt_idx" ON "OutcomeEvent"("tenantId", "accountId", "type", "occurredAt");
CREATE INDEX IF NOT EXISTS "OutcomeEvent_conversationId_occurredAt_idx" ON "OutcomeEvent"("conversationId", "occurredAt");
CREATE INDEX IF NOT EXISTS "OutcomeEvent_customerId_occurredAt_idx" ON "OutcomeEvent"("customerId", "occurredAt");
CREATE INDEX IF NOT EXISTS "OutcomeEvent_tenantId_accountId_type_relatedOutcomeId_idx" ON "OutcomeEvent"("tenantId", "accountId", "type", "relatedOutcomeId");
