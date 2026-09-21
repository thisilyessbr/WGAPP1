-- 1. Safely reconcile preexisting duplicate ChannelConnection rows:
-- Select surviving connection prioritizing:
--   a) non-null/non-empty encryptedCredentials
--   b) latest lastConnectedAt
--   c) latest createdAt
WITH ranked AS (
  SELECT id, "tenantId", "accountId", provider, "encryptedCredentials",
         ROW_NUMBER() OVER (
           PARTITION BY "tenantId", "accountId", provider
           ORDER BY 
             CASE WHEN "encryptedCredentials" IS NOT NULL AND "encryptedCredentials" != '' THEN 1 ELSE 2 END ASC,
             "lastConnectedAt" DESC NULLS LAST,
             "createdAt" DESC
         ) as rn
  FROM "ChannelConnection"
),
survivors AS (
  SELECT id as survivor_id, "tenantId", "accountId", provider
  FROM ranked
  WHERE rn = 1
),
duplicates AS (
  SELECT r.id as duplicate_id, s.survivor_id
  FROM ranked r
  JOIN survivors s 
    ON r."tenantId" = s."tenantId" 
   AND r."accountId" = s."accountId" 
   AND r.provider = s.provider
  WHERE r.rn > 1
)
-- Repoint any WhatsAppBusinessNumber references from duplicate connections to the survivor
UPDATE "WhatsAppBusinessNumber" wbn
SET "connectionId" = d.survivor_id
FROM duplicates d
WHERE wbn."connectionId" = d.duplicate_id;

-- Repoint any ChannelAuditEvent connectionId references to the survivor
WITH ranked AS (
  SELECT id, "tenantId", "accountId", provider, "encryptedCredentials",
         ROW_NUMBER() OVER (
           PARTITION BY "tenantId", "accountId", provider
           ORDER BY 
             CASE WHEN "encryptedCredentials" IS NOT NULL AND "encryptedCredentials" != '' THEN 1 ELSE 2 END ASC,
             "lastConnectedAt" DESC NULLS LAST,
             "createdAt" DESC
         ) as rn
  FROM "ChannelConnection"
),
survivors AS (
  SELECT id as survivor_id, "tenantId", "accountId", provider
  FROM ranked
  WHERE rn = 1
),
duplicates AS (
  SELECT r.id as duplicate_id, s.survivor_id
  FROM ranked r
  JOIN survivors s 
    ON r."tenantId" = s."tenantId" 
   AND r."accountId" = s."accountId" 
   AND r.provider = s.provider
  WHERE r.rn > 1
)
UPDATE "ChannelAuditEvent" cae
SET "connectionId" = d.survivor_id
FROM duplicates d
WHERE cae."connectionId" = d.duplicate_id;

-- Delete only the duplicate connection rows after all references have been safely migrated
WITH ranked AS (
  SELECT id, "tenantId", "accountId", provider, "encryptedCredentials",
         ROW_NUMBER() OVER (
           PARTITION BY "tenantId", "accountId", provider
           ORDER BY 
             CASE WHEN "encryptedCredentials" IS NOT NULL AND "encryptedCredentials" != '' THEN 1 ELSE 2 END ASC,
             "lastConnectedAt" DESC NULLS LAST,
             "createdAt" DESC
         ) as rn
  FROM "ChannelConnection"
),
duplicates AS (
  SELECT id as duplicate_id
  FROM ranked
  WHERE rn > 1
)
DELETE FROM "ChannelConnection"
WHERE id IN (SELECT duplicate_id FROM duplicates);

-- 2. Create Unique Index
CREATE UNIQUE INDEX IF NOT EXISTS "ChannelConnection_tenantId_accountId_provider_key" ON "ChannelConnection"("tenantId", "accountId", "provider");

