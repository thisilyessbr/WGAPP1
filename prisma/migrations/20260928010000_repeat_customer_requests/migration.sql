DROP INDEX IF EXISTS "Lead_tenantId_accountId_customerId_key";
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "sourceWorkflowSessionId" TEXT;
-- Recover unambiguous historical tickets; leave multiple-session histories for review.
UPDATE "Lead" l SET "sourceWorkflowSessionId"=one_session.id,
  "sourceConversationId"=COALESCE(l."sourceConversationId",one_session."conversationId")
FROM (
  SELECT old.id AS "leadId", MIN(ws.id) AS id, MIN(c.id) AS "conversationId"
  FROM "Lead" old
  JOIN "Conversation" c ON c."tenantId"=old."tenantId" AND c."accountId"=old."accountId" AND c."customerId"=old."customerId"
    AND (old."sourceConversationId" IS NULL OR c.id=old."sourceConversationId")
  JOIN "WorkflowSession" ws ON ws."tenantId"=old."tenantId"
    AND ws."conversationId"=c.id AND ws.status='COMPLETED'
    AND (ws."workflowId" !~* '(checkout|cash_on_delivery|cod_order)'
      OR ws."collectedData"->>'_confirmed'='true'
      OR (ws."collectedData"->>'_confirmed' IS NULL AND ws."stateId"='done'))
  WHERE old."signalReason"='COMPLETED_SALES_WORKFLOW'
  GROUP BY old.id HAVING COUNT(*)=1
) one_session WHERE one_session."leadId"=l.id AND l."sourceWorkflowSessionId" IS NULL;
CREATE INDEX IF NOT EXISTS "Lead_customer_history_idx"
  ON "Lead"("tenantId", "accountId", "customerId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "Lead_open_requests_idx"
  ON "Lead"("tenantId", "accountId", "customerId", "createdAt" DESC)
  WHERE status IN ('NEW', 'CONTACTED', 'QUALIFIED');
