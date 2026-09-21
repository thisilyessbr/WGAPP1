-- AlterTable Conversation: add lastMerchantViewedAt and indexes
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "lastMerchantViewedAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "Conversation_tenantId_accountId_updatedAt_idx" ON "Conversation"("tenantId", "accountId", "updatedAt" DESC);
CREATE INDEX IF NOT EXISTS "Conversation_tenantId_accountId_status_updatedAt_idx" ON "Conversation"("tenantId", "accountId", "status", "updatedAt" DESC);

-- AlterTable Message: add index
CREATE INDEX IF NOT EXISTS "Message_tenantId_conversationId_createdAt_idx" ON "Message"("tenantId", "conversationId", "createdAt" ASC);

-- CreateTable WhatsAppOutboundJob
CREATE TABLE IF NOT EXISTS "WhatsAppOutboundJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dedupeKey" TEXT NOT NULL UNIQUE,
    "tenantId" TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE,
    "accountId" TEXT NOT NULL REFERENCES "Account"("id") ON DELETE CASCADE,
    "conversationId" TEXT NOT NULL REFERENCES "Conversation"("id") ON DELETE CASCADE,
    "messageId" TEXT NOT NULL UNIQUE,
    "phoneNumberId" TEXT NOT NULL,
    "recipientWaId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "lastError" TEXT,
    "providerMessageId" TEXT,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "WhatsAppOutboundJob_status_createdAt_idx" ON "WhatsAppOutboundJob"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "WhatsAppOutboundJob_tenantId_accountId_idx" ON "WhatsAppOutboundJob"("tenantId", "accountId");
