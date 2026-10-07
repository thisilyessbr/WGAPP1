-- One-time cleanup for the duplicate demo form that started immediately before
-- the global open-request guard shipped. No other account or conversation is touched.
UPDATE "WorkflowSession" active
SET status = 'CANCELLED',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE active."conversationId" = 'e227a0a2-7184-4cff-a048-bcddc5f4cc8c'
  AND active.status = 'ACTIVE'
  AND EXISTS (
    SELECT 1
    FROM "WorkflowSession" completed
    JOIN "Lead" l
      ON l."sourceWorkflowSessionId" = completed.id
     AND l."sourceConversationId" = completed."conversationId"
    WHERE completed."conversationId" = active."conversationId"
      AND completed."workflowId" = active."workflowId"
      AND completed.status = 'COMPLETED'
      AND l.status IN ('NEW', 'CONTACTED', 'QUALIFIED')
  );
