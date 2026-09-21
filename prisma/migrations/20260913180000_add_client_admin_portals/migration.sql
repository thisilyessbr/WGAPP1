-- Additive portal tables. Existing tenants/accounts and chatbot data are untouched.
CREATE TABLE "PortalUser" (
  id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'CLIENT' CHECK (role IN ('ADMIN','CLIENT')),
  "verifiedAt" TIMESTAMPTZ, disabled BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "PortalMembership" (
  "userId" TEXT NOT NULL REFERENCES "PortalUser"(id) ON DELETE CASCADE,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"(id) ON DELETE CASCADE,
  "accountId" TEXT NOT NULL REFERENCES "Account"(id) ON DELETE CASCADE,
  PRIMARY KEY ("userId", "accountId")
);
CREATE INDEX "PortalMembership_account_idx" ON "PortalMembership"("accountId");
CREATE TABLE "PortalSession" (
  id TEXT PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES "PortalUser"(id) ON DELETE CASCADE,
  "tokenHash" TEXT NOT NULL UNIQUE, "csrfToken" TEXT NOT NULL, "expiresAt" TIMESTAMPTZ NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "PortalSession_user_idx" ON "PortalSession"("userId");
CREATE INDEX "PortalSession_expiry_idx" ON "PortalSession"("expiresAt");
CREATE TABLE "PortalAuthToken" (
  "tokenHash" TEXT PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES "PortalUser"(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('VERIFY','RESET','ADMIN_LOGIN')), "expiresAt" TIMESTAMPTZ NOT NULL
);
CREATE TABLE "PortalPlan" (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', price NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'MAD', published BOOLEAN NOT NULL DEFAULT false, revision INTEGER NOT NULL DEFAULT 1,
  modules JSONB NOT NULL DEFAULT '[]', limits JSONB NOT NULL, template JSONB NOT NULL DEFAULT '{}',
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "PortalProfile" (
  "accountId" TEXT PRIMARY KEY REFERENCES "Account"(id) ON DELETE CASCADE,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SUBMITTED','NEEDS_CHANGES','APPROVED','ACTIVE','SUSPENDED')),
  draft JSONB NOT NULL, published JSONB, revision INTEGER NOT NULL DEFAULT 1, "publishedRevision" INTEGER NOT NULL DEFAULT 0,
  "planId" TEXT REFERENCES "PortalPlan"(id), "planSnapshot" JSONB, "requestedPlanId" TEXT REFERENCES "PortalPlan"(id),
  "autoPublish" BOOLEAN NOT NULL DEFAULT false, "reviewNote" TEXT NOT NULL DEFAULT '', "lockedFields" JSONB NOT NULL DEFAULT '[]',
  "adminConfig" JSONB NOT NULL DEFAULT '{}', "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "PortalProfile_tenant_idx" ON "PortalProfile"("tenantId");
CREATE TABLE "PortalPublication" (
  id TEXT PRIMARY KEY, "accountId" TEXT NOT NULL REFERENCES "Account"(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL, data JSONB NOT NULL, config JSONB NOT NULL, "actorId" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE("accountId", revision)
);
CREATE TABLE "PortalAudit" (
  id TEXT PRIMARY KEY, "actorId" TEXT NOT NULL, "accountId" TEXT, action TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}', "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "PortalAudit_account_time_idx" ON "PortalAudit"("accountId", "createdAt" DESC);
CREATE TABLE "PortalUsageBucket" (
  "accountId" TEXT NOT NULL REFERENCES "Account"(id) ON DELETE CASCADE, period TEXT NOT NULL,
  messages INTEGER NOT NULL DEFAULT 0, "llmCalls" INTEGER NOT NULL DEFAULT 0, images INTEGER NOT NULL DEFAULT 0,
  embeddings INTEGER NOT NULL DEFAULT 0, "spentMicros" BIGINT NOT NULL DEFAULT 0,
  "reservedMicros" BIGINT NOT NULL DEFAULT 0, PRIMARY KEY("accountId", period)
);
CREATE TABLE "PortalUsageEntry" (
  id TEXT PRIMARY KEY, "accountId" TEXT NOT NULL REFERENCES "Account"(id) ON DELETE CASCADE,
  period TEXT NOT NULL, kind TEXT NOT NULL, "dedupeKey" TEXT NOT NULL,
  "reservedMicros" BIGINT NOT NULL DEFAULT 0, "chargedMicros" BIGINT, status TEXT NOT NULL DEFAULT 'RESERVED',
  metadata JSONB NOT NULL DEFAULT '{}', "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("accountId", "dedupeKey")
);
CREATE INDEX "PortalUsageEntry_account_time_idx" ON "PortalUsageEntry"("accountId", "createdAt" DESC);
CREATE TABLE "PortalConnectionAttempt" (
  id TEXT PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES "PortalUser"(id) ON DELETE CASCADE,
  "accountId" TEXT NOT NULL REFERENCES "Account"(id) ON DELETE CASCADE,
  "stateToken" TEXT NOT NULL, "reconnectId" TEXT, status TEXT NOT NULL DEFAULT 'PENDING', "expiresAt" TIMESTAMPTZ NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "PortalDocument" (
  id TEXT PRIMARY KEY, "accountId" TEXT NOT NULL REFERENCES "Account"(id) ON DELETE CASCADE,
  filename TEXT NOT NULL, hash TEXT NOT NULL, bytes BYTEA NOT NULL, size INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING', "sourceId" TEXT, error TEXT,
  "leaseUntil" TIMESTAMPTZ, "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("accountId", hash)
);
CREATE INDEX "PortalDocument_jobs_idx" ON "PortalDocument"(status, "createdAt");
CREATE TABLE "PortalThrottle" (key TEXT PRIMARY KEY, count INTEGER NOT NULL, "resetsAt" TIMESTAMPTZ NOT NULL);
