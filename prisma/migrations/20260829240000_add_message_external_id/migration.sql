-- AlterTable
ALTER TABLE "Message" ADD COLUMN "externalId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Message_tenantId_externalId_key" ON "Message"("tenantId", "externalId") WHERE "externalId" IS NOT NULL;
