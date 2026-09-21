-- CreateTable WhatsAppDeliveryReceipt
CREATE TABLE IF NOT EXISTS "WhatsAppDeliveryReceipt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dedupeKey" TEXT NOT NULL UNIQUE,
    "tenantId" TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE,
    "accountId" TEXT NOT NULL REFERENCES "Account"("id") ON DELETE CASCADE,
    "phoneNumberId" TEXT NOT NULL,
    "providerMessageId" TEXT NOT NULL,
    "recipientWaId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "providerTimestamp" TIMESTAMP(3) NOT NULL,
    "errorCode" INTEGER,
    "errorMessage" TEXT,
    "correlated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "WhatsAppDeliveryReceipt_tenantId_accountId_idx" ON "WhatsAppDeliveryReceipt"("tenantId", "accountId");
CREATE INDEX IF NOT EXISTS "WhatsAppDeliveryReceipt_providerMessageId_correlated_idx" ON "WhatsAppDeliveryReceipt"("providerMessageId", "correlated");
CREATE INDEX IF NOT EXISTS "WhatsAppDeliveryReceipt_createdAt_idx" ON "WhatsAppDeliveryReceipt"("createdAt");
