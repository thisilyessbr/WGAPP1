-- Customer wording learned per business for the understanding fast path.
CREATE TABLE IF NOT EXISTS "LearnedPhrase" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE,
    "accountId" TEXT NOT NULL REFERENCES "Account"("id") ON DELETE CASCADE,
    "kind" TEXT NOT NULL,
    "phrase" TEXT NOT NULL,
    "example" TEXT NOT NULL,
    "itemKey" TEXT NOT NULL,
    "itemLabel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'AUTO',
    "hits" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "LearnedPhrase_tenantId_accountId_kind_phrase_key" ON "LearnedPhrase"("tenantId", "accountId", "kind", "phrase");
CREATE INDEX IF NOT EXISTS "LearnedPhrase_tenantId_accountId_status_idx" ON "LearnedPhrase"("tenantId", "accountId", "status");
