-- CreateTable
CREATE TABLE "WhatsAppBusinessNumber" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "phoneNumberId" TEXT NOT NULL,
    "wabaId" TEXT,
    "displayPhoneNumber" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppBusinessNumber_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppBusinessNumber_phoneNumberId_key" ON "WhatsAppBusinessNumber"("phoneNumberId");

-- CreateIndex
CREATE INDEX "WhatsAppBusinessNumber_tenantId_accountId_idx" ON "WhatsAppBusinessNumber"("tenantId", "accountId");

-- CreateIndex
CREATE INDEX "WhatsAppBusinessNumber_tenantId_wabaId_idx" ON "WhatsAppBusinessNumber"("tenantId", "wabaId");

-- AddForeignKey
ALTER TABLE "WhatsAppBusinessNumber" ADD CONSTRAINT "WhatsAppBusinessNumber_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppBusinessNumber" ADD CONSTRAINT "WhatsAppBusinessNumber_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
