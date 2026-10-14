-- Existing lead timestamps were written as UTC instants. Preserve those
-- instants while making future follow-up and stage timestamps timezone-aware.
ALTER TABLE "Lead"
  ALTER COLUMN "followUpAt" TYPE TIMESTAMPTZ(3) USING "followUpAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "contactedAt" TYPE TIMESTAMPTZ(3) USING "contactedAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "closedAt" TYPE TIMESTAMPTZ(3) USING "closedAt" AT TIME ZONE 'UTC';
