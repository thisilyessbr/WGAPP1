-- Older workflow completions created their CRM request before conversation handoff
-- was made atomic. Reconcile those requests using their durable lead/session links.
WITH candidates AS (
  SELECT DISTINCT ON (c.id)
    c.id AS "conversationId",
    c."tenantId",
    c."accountId",
    ws."updatedAt" AS "completedAt",
    CASE
      WHEN a.config->'workflows'->ws."workflowId"->'outcome'->>'pauseBotHours' ~ '^[0-9]+$'
        THEN (a.config->'workflows'->ws."workflowId"->'outcome'->>'pauseBotHours')::integer
      WHEN a.config->'workflows'->ws."workflowId"->'states'->ws."stateId"->>'pauseBotHours' ~ '^[0-9]+$'
        THEN (a.config->'workflows'->ws."workflowId"->'states'->ws."stateId"->>'pauseBotHours')::integer
      ELSE 24
    END AS "pauseBotHours"
  FROM "Conversation" c
  JOIN "Lead" l
    ON l."sourceConversationId" = c.id
   AND l."tenantId" = c."tenantId"
   AND l."accountId" = c."accountId"
  JOIN "WorkflowSession" ws
    ON ws.id = l."sourceWorkflowSessionId"
   AND ws."conversationId" = c.id
   AND ws."tenantId" = c."tenantId"
  JOIN "Account" a
    ON a.id = c."accountId"
   AND a."tenantId" = c."tenantId"
  WHERE c.status = 'ACTIVE'
    AND c."humanRequested" = false
    AND ws.status = 'COMPLETED'
    AND l.status IN ('NEW', 'CONTACTED', 'QUALIFIED')
    AND l."signalReason" IN ('COMPLETED_SALES_WORKFLOW', 'COMPLETED_CONFIGURED_WORKFLOW')
    AND (
      ws."humanRequested" = true
      OR a.config->'workflows'->ws."workflowId"->'outcome'->>'requestHumanHandoff' = 'true'
      OR a.config->'workflows'->ws."workflowId"->'states'->ws."stateId"->>'type' = 'handoff'
    )
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
  md5(reconciled."conversationId" || ':legacy-crm-handoff'),
  reconciled."tenantId",
  reconciled."accountId",
  reconciled."conversationId",
  false,
  false,
  CURRENT_TIMESTAMP + make_interval(hours => GREATEST(1, LEAST(720, candidates."pauseBotHours"))),
  'LEGACY_CRM_HANDOFF_RECONCILED',
  'migration:20261007154000',
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
