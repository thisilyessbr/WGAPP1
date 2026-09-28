CREATE TABLE "PortalActionAlert" (
 id TEXT NOT NULL PRIMARY KEY, "accountId" TEXT NOT NULL, "tenantId" TEXT NOT NULL,
 "recipientId" TEXT NOT NULL, kind TEXT NOT NULL, "sourceId" TEXT NOT NULL,
 occurrence TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING',
 attempts INTEGER NOT NULL DEFAULT 0, "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
 "leaseUntil" TIMESTAMPTZ(3), "sentAt" TIMESTAMPTZ(3),
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
 CONSTRAINT "PortalActionAlert_recipient_fkey" FOREIGN KEY ("recipientId") REFERENCES "PortalUser"(id) ON DELETE CASCADE,
 CONSTRAINT "PortalActionAlert_account_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX "PortalActionAlert_dedupe_idx" ON "PortalActionAlert"("recipientId",kind,"sourceId",occurrence);
CREATE INDEX "PortalActionAlert_delivery_idx" ON "PortalActionAlert"(status,"nextAttemptAt");
CREATE INDEX "PortalActionAlert_account_idx" ON "PortalActionAlert"("tenantId","accountId");
CREATE TABLE "PortalAnswerFeedback" (
 id TEXT NOT NULL PRIMARY KEY, "tenantId" TEXT NOT NULL, "accountId" TEXT NOT NULL,
 "conversationId" TEXT NOT NULL, "messageId" TEXT NOT NULL, "reportedById" TEXT NOT NULL,
 question TEXT NOT NULL, answer TEXT NOT NULL, note TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'OPEN', "resolutionNote" TEXT, "resolvedById" TEXT,
 "retestAt" TIMESTAMPTZ(3), "retestAnswer" TEXT, "retestMode" TEXT,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(), "resolvedAt" TIMESTAMPTZ(3),
 CONSTRAINT "PortalAnswerFeedback_account_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"(id) ON DELETE CASCADE,
 CONSTRAINT "PortalAnswerFeedback_conversation_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"(id) ON DELETE CASCADE,
 CONSTRAINT "PortalAnswerFeedback_message_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"(id) ON DELETE CASCADE,
 CONSTRAINT "PortalAnswerFeedback_reporter_fkey" FOREIGN KEY ("reportedById") REFERENCES "PortalUser"(id) ON DELETE CASCADE,
 CONSTRAINT "PortalAnswerFeedback_resolver_fkey" FOREIGN KEY ("resolvedById") REFERENCES "PortalUser"(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX "PortalAnswerFeedback_message_idx" ON "PortalAnswerFeedback"("accountId","messageId");
CREATE INDEX "PortalAnswerFeedback_account_status_idx" ON "PortalAnswerFeedback"("tenantId","accountId",status,"createdAt" DESC);
ALTER TABLE "Lead" ADD COLUMN "assignedToUserId" TEXT;
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_assignee_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "PortalUser"(id) ON DELETE SET NULL;
CREATE INDEX "Lead_assignee_idx" ON "Lead"("accountId","assignedToUserId","followUpAt");
CREATE INDEX "Conversation_handoff_alert_idx" ON "Conversation"("humanRequestedAt") WHERE status='HANDOFF_REQUESTED';
CREATE INDEX "Lead_recent_alert_idx" ON "Lead"("createdAt") WHERE status IN ('NEW','QUALIFIED');
CREATE INDEX "Lead_due_alert_idx" ON "Lead"("followUpAt") WHERE status IN ('NEW','CONTACTED','QUALIFIED');
