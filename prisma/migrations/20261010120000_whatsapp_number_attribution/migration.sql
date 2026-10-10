ALTER TABLE "Message" ADD COLUMN "phoneNumberId" TEXT;
ALTER TABLE "Lead" ADD COLUMN "sourcePhoneNumberId" TEXT;

CREATE INDEX "Message_tenantId_phoneNumberId_createdAt_idx"
  ON "Message"("tenantId", "phoneNumberId", "createdAt" DESC);
CREATE INDEX "Lead_tenantId_accountId_sourcePhoneNumberId_createdAt_idx"
  ON "Lead"("tenantId", "accountId", "sourcePhoneNumberId", "createdAt" DESC);

-- Only exact inbound WhatsApp message IDs can be backfilled safely. Older
-- assistant messages and leads remain unattributed rather than guessed.
UPDATE "Message" m SET "phoneNumberId"=j."phoneNumberId"
  FROM "WhatsAppMessageJob" j
  WHERE m."tenantId"=j."tenantId" AND m."externalId"=j.wamid
    AND m.role='USER' AND m."phoneNumberId" IS NULL;
