-- Marketing consent per customer and account: broadcasts only reach OPTED_IN rows.
CREATE TABLE IF NOT EXISTS "MarketingConsent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE,
    "accountId" TEXT NOT NULL REFERENCES "Account"("id") ON DELETE CASCADE,
    "customerId" TEXT NOT NULL REFERENCES "Customer"("id") ON DELETE CASCADE,
    "status" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "evidence" TEXT NOT NULL DEFAULT '',
    "recordedById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "MarketingConsent_accountId_customerId_key" ON "MarketingConsent"("accountId", "customerId");
CREATE INDEX IF NOT EXISTS "MarketingConsent_tenantId_accountId_status_idx" ON "MarketingConsent"("tenantId", "accountId", "status");

-- Approved message templates, synced from Meta per WhatsApp Business Account.
CREATE TABLE IF NOT EXISTS "WhatsAppTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE,
    "accountId" TEXT NOT NULL REFERENCES "Account"("id") ON DELETE CASCADE,
    "wabaId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "variableCount" INTEGER NOT NULL DEFAULT 0,
    "syncedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "WhatsAppTemplate_accountId_wabaId_name_language_key" ON "WhatsAppTemplate"("accountId", "wabaId", "name", "language");

CREATE TABLE IF NOT EXISTS "Broadcast" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE,
    "accountId" TEXT NOT NULL REFERENCES "Account"("id") ON DELETE CASCADE,
    "phoneNumberId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL REFERENCES "WhatsAppTemplate"("id") ON DELETE RESTRICT,
    "variables" JSONB NOT NULL DEFAULT '[]',
    "segment" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
    "recipientCount" INTEGER NOT NULL DEFAULT 0,
    "estimatedCostUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "reviewedById" TEXT,
    "reviewNote" TEXT NOT NULL DEFAULT '',
    "startedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "Broadcast_tenantId_accountId_createdAt_idx" ON "Broadcast"("tenantId", "accountId", "createdAt");
CREATE INDEX IF NOT EXISTS "Broadcast_status_idx" ON "Broadcast"("status");

CREATE TABLE IF NOT EXISTS "BroadcastRecipient" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "broadcastId" TEXT NOT NULL REFERENCES "Broadcast"("id") ON DELETE CASCADE,
    "customerId" TEXT NOT NULL REFERENCES "Customer"("id") ON DELETE CASCADE,
    "waId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "messageId" TEXT,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "leaseUntil" TIMESTAMPTZ(3),
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "BroadcastRecipient_broadcastId_customerId_key" ON "BroadcastRecipient"("broadcastId", "customerId");
CREATE INDEX IF NOT EXISTS "BroadcastRecipient_broadcastId_status_idx" ON "BroadcastRecipient"("broadcastId", "status");
