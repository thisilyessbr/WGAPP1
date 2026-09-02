-- CreateTable
CREATE TABLE "WhatsAppIdempotencyKey" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppIdempotencyKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppIdempotencyKey_key_key" ON "WhatsAppIdempotencyKey"("key");

-- CreateIndex
CREATE INDEX "WhatsAppIdempotencyKey_expiresAt_idx" ON "WhatsAppIdempotencyKey"("expiresAt");
