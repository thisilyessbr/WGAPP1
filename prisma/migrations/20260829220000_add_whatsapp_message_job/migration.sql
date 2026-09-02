-- CreateTable
CREATE TABLE "WhatsAppMessageJob" (
    "id" TEXT NOT NULL,
    "wamid" TEXT NOT NULL,
    "partitionKey" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "phoneNumberId" TEXT NOT NULL,
    "waId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "timestamp" BIGINT NOT NULL,
    "contactName" TEXT,
    "rawType" TEXT NOT NULL DEFAULT 'text',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "lastError" TEXT,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppMessageJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppMessageJob_wamid_key" ON "WhatsAppMessageJob"("wamid");

-- CreateIndex
CREATE INDEX "WhatsAppMessageJob_status_availableAt_createdAt_idx" ON "WhatsAppMessageJob"("status", "availableAt", "createdAt");

-- CreateIndex
CREATE INDEX "WhatsAppMessageJob_status_partitionKey_createdAt_idx" ON "WhatsAppMessageJob"("status", "partitionKey", "createdAt");

-- CreateIndex
CREATE INDEX "WhatsAppMessageJob_tenantId_accountId_idx" ON "WhatsAppMessageJob"("tenantId", "accountId");

-- AddForeignKey
ALTER TABLE "WhatsAppMessageJob" ADD CONSTRAINT "WhatsAppMessageJob_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppMessageJob" ADD CONSTRAINT "WhatsAppMessageJob_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
