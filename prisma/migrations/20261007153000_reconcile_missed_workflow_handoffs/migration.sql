-- Reconcile workflow requests completed before durable handoff outcomes were deployed.
-- Only confirmed sessions whose currently published workflow explicitly requests a
-- human handoff are eligible. Future completions are handled atomically in code.
WITH candidates AS (
  SELECT DISTINCT ON (c.id)
    c.id AS "conversationId",
    c."tenantId",
    c."accountId",
    ws."updatedAt" AS "completedAt",
    CASE
      WHEN a.config->'workflows'->ws."workflowId"->'outcome'->>'pauseBotHours' ~ '^[0-9]+$'
        THEN (a.config->'workflows'->ws."workflowId"->'outcome'->>'pauseBotHours')::integer
      ELSE 24
    END AS "pauseBotHours"
  FROM "Conversation" c
  JOIN "WorkflowSession" ws
    ON ws."conversationId" = c.id
   AND ws."tenantId" = c."tenantId"
  JOIN "Account" a
    ON a.id = c."accountId"
   AND a."tenantId" = c."tenantId"
  WHERE c.status = 'ACTIVE'
    AND c."humanRequested" = false
    AND ws.status = 'COMPLETED'
    AND ws."collectedData"->>'_confirmed' = 'true'
    AND a.config->'workflows'->ws."workflowId"->'outcome'->>'requestHumanHandoff' = 'true'
  ORDER BY c.id, ws."updatedAt" DESC
), reconciled AS (
  UPDATE "Conversation" c
  SET status = 'HANDOFF_REQUESTED',
      "humanRequested" = true,
      "humanRequestedAt" = COALESCE(candidates."completedAt", CURRENT_TIMESTAMP),
      "updatedAt" = CURRENT_TIMESTAMP
  FROM candidates
  WHERE c.id = candidates."conversationId"
  RETURNING c.id AS "conversationId", c."tenantId", c."accountId"
)
INSERT INTO "ConversationAutomationState" (
  id,
  "tenantId",
  "accountId",
  "conversationId",
  "botEnabled",
  "humanTakeover",
  "pausedUntil",
  "pauseReason",
  "updatedBy",
  "createdAt",
  "updatedAt"
)
SELECT
  md5(reconciled."conversationId" || ':missed-workflow-handoff'),
  reconciled."tenantId",
  reconciled."accountId",
  reconciled."conversationId",
  false,
  false,
  CURRENT_TIMESTAMP + make_interval(hours => GREATEST(1, LEAST(720, candidates."pauseBotHours"))),
  'WORKFLOW_HANDOFF_RECONCILED',
  'migration:20261007153000',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM reconciled
JOIN candidates ON candidates."conversationId" = reconciled."conversationId"
ON CONFLICT ("conversationId") DO UPDATE SET
  "botEnabled" = false,
  "humanTakeover" = false,
  "pausedUntil" = EXCLUDED."pausedUntil",
  "pauseReason" = EXCLUDED."pauseReason",
  "updatedBy" = EXCLUDED."updatedBy",
  "updatedAt" = CURRENT_TIMESTAMP;
