-- Keep confirmed pre-delivery failures retryable across short service outages.
-- UNKNOWN delivery outcomes remain untouched: retrying them could duplicate a reply.
ALTER TABLE "WhatsAppMessageJob" ALTER COLUMN "maxAttempts" SET DEFAULT 32;

UPDATE "WhatsAppMessageJob"
SET "maxAttempts" = 32
WHERE "status" IN ('PENDING', 'PROCESSING')
  AND "maxAttempts" < 32;
