CREATE TABLE "InstagramConnection" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "instagramUserId" TEXT NOT NULL,
  "username" TEXT,
  "encryptedToken" TEXT NOT NULL,
  "tokenExpiresAt" TIMESTAMP(3) NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "status" TEXT NOT NULL DEFAULT 'CONNECTED',
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "InstagramConnection_accountId_key" ON "InstagramConnection"("accountId");
CREATE UNIQUE INDEX "InstagramConnection_instagramUserId_key" ON "InstagramConnection"("instagramUserId");
CREATE INDEX "InstagramConnection_tenantId_accountId_idx" ON "InstagramConnection"("tenantId", "accountId");

CREATE TABLE "InstagramInboundJob" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "instagramUserId" TEXT NOT NULL,
  "senderId" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "responseText" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseUntil" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "InstagramInboundJob_instagramUserId_messageId_key" ON "InstagramInboundJob"("instagramUserId", "messageId");
CREATE INDEX "InstagramInboundJob_status_nextAttemptAt_idx" ON "InstagramInboundJob"("status", "nextAttemptAt");
CREATE INDEX "InstagramInboundJob_tenantId_accountId_idx" ON "InstagramInboundJob"("tenantId", "accountId");
