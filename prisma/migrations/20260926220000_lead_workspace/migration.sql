ALTER TABLE "Lead"
  ADD COLUMN IF NOT EXISTS "interest" TEXT,
  ADD COLUMN IF NOT EXISTS "signalReason" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceConversationId" TEXT,
  ADD COLUMN IF NOT EXISTS "note" TEXT,
  ADD COLUMN IF NOT EXISTS "details" JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS "followUpAt" TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "contactedAt" TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "closedAt" TIMESTAMPTZ(3);

CREATE INDEX IF NOT EXISTS "Lead_tenantId_accountId_followUpAt_idx"
  ON "Lead"("tenantId", "accountId", "followUpAt");

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='Lead' AND column_name='followUpAt' AND data_type='timestamp without time zone') THEN
    ALTER TABLE "Lead" ALTER COLUMN "followUpAt" TYPE TIMESTAMPTZ(3) USING "followUpAt" AT TIME ZONE 'UTC';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='Lead' AND column_name='contactedAt' AND data_type='timestamp without time zone') THEN
    ALTER TABLE "Lead" ALTER COLUMN "contactedAt" TYPE TIMESTAMPTZ(3) USING "contactedAt" AT TIME ZONE 'UTC';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='Lead' AND column_name='closedAt' AND data_type='timestamp without time zone') THEN
    ALTER TABLE "Lead" ALTER COLUMN "closedAt" TYPE TIMESTAMPTZ(3) USING "closedAt" AT TIME ZONE 'UTC';
  END IF;
END $$;
