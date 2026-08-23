-- AlterTable KnowledgeSource
ALTER TABLE "KnowledgeSource" ADD COLUMN IF NOT EXISTS "accountId" TEXT;
CREATE INDEX IF NOT EXISTS "KnowledgeSource_tenantId_accountId_idx" ON "KnowledgeSource"("tenantId", "accountId");

-- AlterTable KnowledgeDocument
ALTER TABLE "KnowledgeDocument" ADD COLUMN IF NOT EXISTS "accountId" TEXT;
CREATE INDEX IF NOT EXISTS "KnowledgeDocument_tenantId_accountId_idx" ON "KnowledgeDocument"("tenantId", "accountId");

-- AlterTable KnowledgeChunk
ALTER TABLE "KnowledgeChunk" ADD COLUMN IF NOT EXISTS "accountId" TEXT;
CREATE INDEX IF NOT EXISTS "KnowledgeChunk_tenantId_accountId_idx" ON "KnowledgeChunk"("tenantId", "accountId");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'KnowledgeSource_accountId_fkey') THEN
        ALTER TABLE "KnowledgeSource" ADD CONSTRAINT "KnowledgeSource_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'KnowledgeDocument_accountId_fkey') THEN
        ALTER TABLE "KnowledgeDocument" ADD CONSTRAINT "KnowledgeDocument_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'KnowledgeChunk_accountId_fkey') THEN
        ALTER TABLE "KnowledgeChunk" ADD CONSTRAINT "KnowledgeChunk_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
