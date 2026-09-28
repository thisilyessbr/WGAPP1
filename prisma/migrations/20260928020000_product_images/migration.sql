CREATE TABLE "PortalProductImage" (
  id TEXT PRIMARY KEY,
  "accountId" TEXT NOT NULL REFERENCES "Account"(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  hash TEXT NOT NULL,
  bytes BYTEA NOT NULL,
  size INTEGER NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  published BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE ("accountId", hash)
);
CREATE INDEX "PortalProductImage_account_idx" ON "PortalProductImage"("accountId");
