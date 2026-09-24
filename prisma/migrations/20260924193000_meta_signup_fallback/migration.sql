ALTER TABLE "PortalConnectionAttempt"
  ADD COLUMN "encryptedMetaToken" TEXT,
  ADD COLUMN "metaCandidates" JSONB;
