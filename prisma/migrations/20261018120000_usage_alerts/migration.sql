-- Monthly usage alerts shown to the merchant: one row per account, month and threshold (80 or 100 percent).
CREATE TABLE "PortalUsageAlert" (
 id TEXT NOT NULL PRIMARY KEY, "accountId" TEXT NOT NULL, "tenantId" TEXT NOT NULL,
 period TEXT NOT NULL, threshold INTEGER NOT NULL, metric TEXT NOT NULL,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(), "dismissedAt" TIMESTAMPTZ(3),
 CONSTRAINT "PortalUsageAlert_account_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX "PortalUsageAlert_period_threshold_idx" ON "PortalUsageAlert"("accountId",period,threshold);
