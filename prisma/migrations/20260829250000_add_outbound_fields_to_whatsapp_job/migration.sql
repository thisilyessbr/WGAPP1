-- AlterTable
ALTER TABLE "WhatsAppMessageJob" ADD COLUMN "outboundStatus" TEXT DEFAULT 'PENDING';
ALTER TABLE "WhatsAppMessageJob" ADD COLUMN "outboundMessageId" TEXT;
ALTER TABLE "WhatsAppMessageJob" ADD COLUMN "outboundError" TEXT;
