CREATE TABLE "PortalPushSubscription" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "endpoint" TEXT NOT NULL,
  "p256dh" TEXT NOT NULL,
  "auth" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PortalPushSubscription_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PortalPushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "PortalUser"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PortalPushSubscription_endpoint_key" ON "PortalPushSubscription"("endpoint");
CREATE INDEX "PortalPushSubscription_tenantId_accountId_enabled_idx" ON "PortalPushSubscription"("tenantId", "accountId", "enabled");
CREATE INDEX "PortalPushSubscription_userId_accountId_idx" ON "PortalPushSubscription"("userId", "accountId");

CREATE TABLE "PortalPushDelivery" (
  "subscriptionId" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "sentAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PortalPushDelivery_pkey" PRIMARY KEY ("subscriptionId", "messageId"),
  CONSTRAINT "PortalPushDelivery_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "PortalPushSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "PortalPushDelivery_sentAt_idx" ON "PortalPushDelivery"("sentAt");
