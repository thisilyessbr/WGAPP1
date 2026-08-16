-- AlterTable
ALTER TABLE "KnowledgeSource" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE "KnowledgeSource" ADD COLUMN "hash" TEXT;
