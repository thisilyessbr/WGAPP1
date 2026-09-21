-- Reconcile fields used by the runtime with databases created only from migrations.
-- IF NOT EXISTS keeps this safe for environments where an earlier manual db push
-- may already have created one or more columns.
ALTER TABLE "Conversation"
  ADD COLUMN IF NOT EXISTS "automationCapped" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "humanRequested" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "humanRequestedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "messageCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "postCompletionCapped" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "postCompletionQuestionCount" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Customer"
  ADD COLUMN IF NOT EXISTS "metadata" JSONB;

ALTER TABLE "WorkflowSession"
  ADD COLUMN IF NOT EXISTS "collectedData" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "humanRequested" BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS "humanRequestedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "stateHistory" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Prisma-managed @updatedAt fields should not have database-side defaults.
ALTER TABLE "Account" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "ChannelConnection" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "ChannelSessionSecret" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "ConversationAutomationState" ALTER COLUMN "updatedAt" DROP DEFAULT;
