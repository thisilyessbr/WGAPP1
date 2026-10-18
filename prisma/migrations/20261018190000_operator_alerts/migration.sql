-- One row per operator alert per hour; the unique key stops duplicate sends across workers.
CREATE TABLE IF NOT EXISTS "OperatorAlert" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "error" TEXT,
    "sentAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "OperatorAlert_key_bucket_key" ON "OperatorAlert"("key", "bucket");
CREATE INDEX IF NOT EXISTS "OperatorAlert_createdAt_idx" ON "OperatorAlert"("createdAt");
