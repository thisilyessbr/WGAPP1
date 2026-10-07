-- One-time repair for the confirmed demo request completed immediately before
-- durable workflow outcomes were deployed. The application-level fix is already
-- in place for every future workflow completion.
WITH target_session AS (
  SELECT ws.id, ws."tenantId", ws."conversationId", ws."collectedData", ws."updatedAt"
  FROM "WorkflowSession" ws
  WHERE ws."conversationId" = 'e227a0a2-7184-4cff-a048-bcddc5f4cc8c'
    AND ws.status = 'COMPLETED'
  ORDER BY ws."updatedAt" DESC
  LIMIT 1
), target_conversation AS (
  SELECT c.id, c."tenantId", c."accountId", c."customerId"
  FROM "Conversation" c
  JOIN target_session ws
    ON ws."conversationId" = c.id
   AND ws."tenantId" = c."tenantId"
  WHERE c.id = 'e227a0a2-7184-4cff-a048-bcddc5f4cc8c'
)
INSERT INTO "Lead" (
  id,
  "tenantId",
  "accountId",
  "customerId",
  status,
  interest,
  "signalReason",
  "sourceConversationId",
  "sourceWorkflowSessionId",
  note,
  details,
  "createdAt",
  "updatedAt"
)
SELECT
  md5(target_conversation.id || target_session.id || ':reconciled-demo-request'),
  target_conversation."tenantId",
  target_conversation."accountId",
  target_conversation."customerId",
  'NEW',
  LEFT(COALESCE(
    NULLIF(target_session."collectedData"->>'businessNeed', ''),
    NULLIF(target_session."collectedData"->>'need', ''),
    'Demo request'
  ), 280),
  'COMPLETED_CONFIGURED_WORKFLOW_RECONCILED',
  target_conversation.id,
  target_session.id,
  'Recovered from a workflow completed before durable handoff outcomes were deployed.',
  target_session."collectedData",
  target_session."updatedAt",
  CURRENT_TIMESTAMP
FROM target_conversation
JOIN target_session ON target_session."conversationId" = target_conversation.id
WHERE NOT EXISTS (
  SELECT 1
  FROM "Lead" existing
  WHERE existing."tenantId" = target_conversation."tenantId"
    AND existing."accountId" = target_conversation."accountId"
    AND existing."sourceWorkflowSessionId" = target_session.id
);

WITH target_session AS (
  SELECT ws."conversationId", ws."tenantId", ws."updatedAt"
  FROM "WorkflowSession" ws
  WHERE ws."conversationId" = 'e227a0a2-7184-4cff-a048-bcddc5f4cc8c'
    AND ws.status = 'COMPLETED'
  ORDER BY ws."updatedAt" DESC
  LIMIT 1
)
UPDATE "Conversation" c
SET status = 'HANDOFF_REQUESTED',
    "humanRequested" = true,
    "humanRequestedAt" = target_session."updatedAt",
    "updatedAt" = CURRENT_TIMESTAMP
FROM target_session
WHERE c.id = target_session."conversationId"
  AND c."tenantId" = target_session."tenantId"
  AND c.status = 'ACTIVE'
  AND c."humanRequested" = false;

WITH target_conversation AS (
  SELECT c.id, c."tenantId", c."accountId"
  FROM "Conversation" c
  WHERE c.id = 'e227a0a2-7184-4cff-a048-bcddc5f4cc8c'
    AND c.status = 'HANDOFF_REQUESTED'
    AND c."humanRequested" = true
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
  md5(target_conversation.id || ':legacy-demo-request'),
  target_conversation."tenantId",
  target_conversation."accountId",
  target_conversation.id,
  false,
  false,
  CURRENT_TIMESTAMP + INTERVAL '24 hours',
  'LEGACY_DEMO_REQUEST_RECONCILED',
  'migration:20261007155500',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM target_conversation
ON CONFLICT ("conversationId") DO UPDATE SET
  "botEnabled" = false,
  "humanTakeover" = false,
  "pausedUntil" = EXCLUDED."pausedUntil",
  "pauseReason" = EXCLUDED."pauseReason",
  "updatedBy" = EXCLUDED."updatedBy",
  "updatedAt" = CURRENT_TIMESTAMP;
