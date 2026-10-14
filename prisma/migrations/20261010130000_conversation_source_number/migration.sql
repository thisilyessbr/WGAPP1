ALTER TABLE "Conversation" ADD COLUMN "sourcePhoneNumberId" TEXT;

-- Attribute a legacy thread only when all verified inbound messages agree.
-- Mixed or unattributed threads remain legacy and cannot be used to guess a send-from number.
UPDATE "Conversation" c SET "sourcePhoneNumberId"=source."phoneNumberId"
FROM (
  SELECT "conversationId", MIN("phoneNumberId") AS "phoneNumberId"
  FROM "Message" WHERE role='USER' AND "phoneNumberId" IS NOT NULL
  GROUP BY "conversationId" HAVING COUNT(DISTINCT "phoneNumberId")=1
) source
WHERE c.id=source."conversationId" AND NOT EXISTS (
  SELECT 1 FROM "Message" m WHERE m."conversationId"=c.id AND m.role='USER'
    AND m."phoneNumberId" IS NOT NULL AND m."phoneNumberId"<>source."phoneNumberId"
);

CREATE INDEX "Conversation_tenantId_accountId_customerId_sourcePhoneNumberId_idx"
  ON "Conversation"("tenantId", "accountId", "customerId", "sourcePhoneNumberId");
