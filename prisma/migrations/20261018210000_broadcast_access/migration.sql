-- Broadcasts need the plan module and an administrator switch, like Instagram and QR.
ALTER TABLE "PortalProfile" ADD COLUMN IF NOT EXISTS "broadcastsAllowed" BOOLEAN NOT NULL DEFAULT false;
