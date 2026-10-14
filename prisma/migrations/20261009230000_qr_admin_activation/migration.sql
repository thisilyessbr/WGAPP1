-- Preserve existing Meta behavior while requiring explicit administrator
-- activation for every QR-linked chatbot, including older pilot connections.
ALTER TABLE "ChannelConnection" ADD COLUMN "botEnabled" BOOLEAN NOT NULL DEFAULT true;
UPDATE "ChannelConnection" SET "botEnabled" = false WHERE provider = 'QR_WEB';
UPDATE "WhatsAppBusinessNumber" SET enabled = false
  WHERE transport = 'QR_WEB';
