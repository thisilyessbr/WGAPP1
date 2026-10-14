ALTER TABLE "Lead"
  ADD COLUMN "interest" TEXT,
  ADD COLUMN "signalReason" TEXT,
  ADD COLUMN "sourceConversationId" TEXT,
  ADD COLUMN "note" TEXT,
  ADD COLUMN "followUpAt" TIMESTAMP(3),
  ADD COLUMN "contactedAt" TIMESTAMP(3),
  ADD COLUMN "closedAt" TIMESTAMP(3);

CREATE INDEX "Lead_tenantId_accountId_followUpAt_idx"
  ON "Lead"("tenantId", "accountId", "followUpAt");
