-- AlterTable
ALTER TABLE "WhatsAppBusinessNumber" ADD COLUMN IF NOT EXISTS "transport" TEXT NOT NULL DEFAULT 'META_CLOUD';
ALTER TABLE "WhatsAppBusinessNumber" ADD COLUMN IF NOT EXISTS "connectionId" TEXT;

-- CreateTable ChannelConnection
CREATE TABLE IF NOT EXISTS "ChannelConnection" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'META_CLOUD',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "encryptedCredentials" TEXT,
    "appId" TEXT,
    "wabaId" TEXT,
    "sessionKey" TEXT,
    "lastConnectedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChannelConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable ConversationAutomationState
CREATE TABLE IF NOT EXISTS "ConversationAutomationState" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "accountId" TEXT,
    "conversationId" TEXT NOT NULL,
    "botEnabled" BOOLEAN NOT NULL DEFAULT true,
    "humanTakeover" BOOLEAN NOT NULL DEFAULT false,
    "pausedUntil" TIMESTAMP(3),
    "pauseReason" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationAutomationState_pkey" PRIMARY KEY ("id")
);

-- CreateTable ChannelAuditEvent
CREATE TABLE IF NOT EXISTS "ChannelAuditEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "accountId" TEXT,
    "connectionId" TEXT,
    "phoneNumberId" TEXT,
    "conversationId" TEXT,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChannelAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ChannelConnection_tenantId_accountId_idx" ON "ChannelConnection"("tenantId", "accountId");
CREATE INDEX IF NOT EXISTS "ChannelConnection_tenantId_provider_idx" ON "ChannelConnection"("tenantId", "provider");
CREATE UNIQUE INDEX IF NOT EXISTS "ConversationAutomationState_conversationId_key" ON "ConversationAutomationState"("conversationId");
CREATE INDEX IF NOT EXISTS "ConversationAutomationState_tenantId_accountId_idx" ON "ConversationAutomationState"("tenantId", "accountId");
CREATE INDEX IF NOT EXISTS "ChannelAuditEvent_tenantId_createdAt_idx" ON "ChannelAuditEvent"("tenantId", "createdAt");
CREATE INDEX IF NOT EXISTS "ChannelAuditEvent_tenantId_action_idx" ON "ChannelAuditEvent"("tenantId", "action");
CREATE INDEX IF NOT EXISTS "WhatsAppBusinessNumber_connectionId_idx" ON "WhatsAppBusinessNumber"("connectionId");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "WhatsAppBusinessNumber" ADD CONSTRAINT "WhatsAppBusinessNumber_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "ChannelConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ChannelConnection" ADD CONSTRAINT "ChannelConnection_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ChannelConnection" ADD CONSTRAINT "ChannelConnection_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ConversationAutomationState" ADD CONSTRAINT "ConversationAutomationState_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ConversationAutomationState" ADD CONSTRAINT "ConversationAutomationState_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ConversationAutomationState" ADD CONSTRAINT "ConversationAutomationState_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ChannelAuditEvent" ADD CONSTRAINT "ChannelAuditEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ChannelAuditEvent" ADD CONSTRAINT "ChannelAuditEvent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
