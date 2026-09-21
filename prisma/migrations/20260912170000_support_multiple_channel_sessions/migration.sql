ALTER TABLE "ChannelConnection"
ADD COLUMN IF NOT EXISTS "connectionKey" TEXT NOT NULL DEFAULT 'default';

-- Preserve one Meta connection per WABA and one QR connection per session.
UPDATE "ChannelConnection"
SET "connectionKey" = CASE
  WHEN provider = 'QR_WEB' AND "sessionKey" IS NOT NULL AND "sessionKey" <> '' THEN "sessionKey"
  WHEN provider = 'META_CLOUD' AND "wabaId" IS NOT NULL AND "wabaId" <> '' THEN "wabaId"
  ELSE 'default'
END;

DROP INDEX IF EXISTS "ChannelConnection_tenantId_accountId_provider_key";

CREATE UNIQUE INDEX IF NOT EXISTS "ChannelConnection_tenantId_accountId_provider_connectionKey_key"
ON "ChannelConnection"("tenantId", "accountId", provider, "connectionKey");

CREATE TABLE IF NOT EXISTS "ChannelSessionSecret" (
  "id" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "secretKey" TEXT NOT NULL,
  "encryptedValue" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChannelSessionSecret_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ChannelSessionSecret_connectionId_category_secretKey_key"
ON "ChannelSessionSecret"("connectionId", "category", "secretKey");

CREATE INDEX IF NOT EXISTS "ChannelSessionSecret_connectionId_idx"
ON "ChannelSessionSecret"("connectionId");

DO $$ BEGIN
  ALTER TABLE "ChannelSessionSecret"
  ADD CONSTRAINT "ChannelSessionSecret_connectionId_fkey"
  FOREIGN KEY ("connectionId") REFERENCES "ChannelConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
