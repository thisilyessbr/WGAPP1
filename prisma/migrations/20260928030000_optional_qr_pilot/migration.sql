ALTER TABLE "PortalProfile" ADD COLUMN "qrAllowed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PortalProfile" ADD COLUMN "qrConsentAt" TIMESTAMPTZ;
CREATE TABLE "QrSessionLease" (
  "connectionId" TEXT PRIMARY KEY REFERENCES "ChannelConnection"(id) ON DELETE CASCADE,
  owner TEXT NOT NULL, "expiresAt" TIMESTAMPTZ NOT NULL,
  "encryptedQr" TEXT, "qrExpiresAt" TIMESTAMPTZ
);
CREATE TABLE "QrPhoneClaim" (
  phone TEXT PRIMARY KEY,
  "connectionId" TEXT NOT NULL UNIQUE REFERENCES "ChannelConnection"(id) ON DELETE CASCADE
);
CREATE TABLE "QrContactWindow" (
  "connectionId" TEXT NOT NULL REFERENCES "ChannelConnection"(id) ON DELETE CASCADE,
  recipient TEXT NOT NULL, "lastInboundAt" TIMESTAMPTZ NOT NULL,
  PRIMARY KEY ("connectionId",recipient)
);
-- Existing QR sessions require explicit administrator approval after rollout.
UPDATE "WhatsAppBusinessNumber" SET enabled=false,status='PAUSED' WHERE transport='QR_WEB';
UPDATE "ChannelConnection" SET enabled=false,status='PAUSED' WHERE provider='QR_WEB';
