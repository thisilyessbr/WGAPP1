import { PortalStore } from './PortalStore';
import { PortalError } from './types';

export const LEAD_STAGES = ['NEW', 'CONTACTED', 'QUALIFIED', 'WON', 'LOST', 'DONE'] as const;
export type LeadStage = typeof LEAD_STAGES[number];
export const LEAD_VIEWS = ['ALL', 'ACTION', 'LATER', 'DONE'] as const;
export type LeadView = typeof LEAD_VIEWS[number];

/** Client-facing, tenant-scoped lead operations. One lead per customer/account. */
export class PortalLeads {
  constructor(private store: PortalStore) {}

  async list(tenantId: string, accountId: string, status: string, limit: number, offset: number, view: string = 'ALL') {
    if (status !== 'ALL' && !LEAD_STAGES.includes(status as LeadStage)) throw new PortalError(400, 'INVALID_LEAD_STAGE');
    if (!LEAD_VIEWS.includes(view as LeadView)) throw new PortalError(400, 'INVALID_LEAD_VIEW');
    const rows = await this.store.db.$queryRaw<any[]>`
      SELECT l.id,l.status,l.interest,l."signalReason",l.note,l.details,l."followUpAt",l."contactedAt",l."closedAt",l."createdAt",l."updatedAt",
        cu."externalId" AS "customerPhone",cu.metadata AS "customerMetadata",
        COALESCE(c.id,l."sourceConversationId") AS "conversationId",c."updatedAt" AS "conversationUpdatedAt",
        (SELECT m.content FROM "Message" m
          WHERE m."conversationId"=COALESCE(l."sourceConversationId",c.id) AND m."tenantId"=l."tenantId"
            AND m.role='USER' AND m."createdAt"<=l."createdAt"
          ORDER BY m."createdAt" DESC LIMIT 1) AS "sourceRequest",
        (SELECT m.content FROM "Message" m WHERE m."conversationId"=c.id AND m."tenantId"=l."tenantId" AND m.role='USER' ORDER BY m."createdAt" DESC LIMIT 1) AS "lastCustomerMessage"
      FROM "Lead" l
      JOIN "Customer" cu ON cu.id=l."customerId" AND cu."tenantId"=l."tenantId"
      LEFT JOIN LATERAL (
        SELECT id,"updatedAt" FROM "Conversation"
        WHERE "tenantId"=l."tenantId" AND "accountId"=l."accountId" AND "customerId"=l."customerId"
        ORDER BY "updatedAt" DESC LIMIT 1
      ) c ON TRUE
      WHERE l."tenantId"=${tenantId} AND l."accountId"=${accountId}
        AND (${status}='ALL' OR l.status=${status})
        AND (${view}='ALL'
          OR (${view}='ACTION' AND l.status IN ('NEW','CONTACTED','QUALIFIED') AND (l."followUpAt" IS NULL OR l."followUpAt"<=NOW()))
          OR (${view}='LATER' AND l.status IN ('NEW','CONTACTED','QUALIFIED') AND l."followUpAt">NOW())
          OR (${view}='DONE' AND l.status IN ('WON','LOST','DONE')))
        AND (cu."externalId" IS NULL OR cu."externalId" NOT LIKE 'portal-preview:%')
      ORDER BY CASE WHEN l."followUpAt"<=NOW() AND l.status IN ('NEW','CONTACTED','QUALIFIED') THEN 0 WHEN l.status IN ('NEW','QUALIFIED') THEN 1 WHEN l.status='CONTACTED' THEN 2 ELSE 3 END,
        l."followUpAt" ASC NULLS LAST,l."updatedAt" DESC
      LIMIT ${limit} OFFSET ${offset}`;
    const count = await this.store.db.$queryRaw<any[]>`
      SELECT COUNT(*)::int AS total FROM "Lead" l JOIN "Customer" cu ON cu.id=l."customerId" AND cu."tenantId"=l."tenantId"
      WHERE l."tenantId"=${tenantId} AND l."accountId"=${accountId}
        AND (${status}='ALL' OR l.status=${status})
        AND (${view}='ALL'
          OR (${view}='ACTION' AND l.status IN ('NEW','CONTACTED','QUALIFIED') AND (l."followUpAt" IS NULL OR l."followUpAt"<=NOW()))
          OR (${view}='LATER' AND l.status IN ('NEW','CONTACTED','QUALIFIED') AND l."followUpAt">NOW())
          OR (${view}='DONE' AND l.status IN ('WON','LOST','DONE')))
        AND (cu."externalId" IS NULL OR cu."externalId" NOT LIKE 'portal-preview:%')`;
    return { leads: rows, pagination: { total: count[0]?.total || 0, limit, offset, hasMore: offset + rows.length < (count[0]?.total || 0) } };
  }

  async get(tenantId: string, accountId: string, id: string) {
    const rows = await this.store.db.$queryRaw<any[]>`
      SELECT l.*,cu."externalId" AS "customerPhone",cu.metadata AS "customerMetadata",
        COALESCE(c.id,l."sourceConversationId") AS "conversationId",ws."collectedData" AS "workflowDetails",ws."workflowId",ws.status AS "workflowStatus",
        (SELECT m.content FROM "Message" m
          WHERE m."conversationId"=COALESCE(l."sourceConversationId",c.id) AND m."tenantId"=l."tenantId"
            AND m.role='USER' AND m."createdAt"<=l."createdAt"
          ORDER BY m."createdAt" DESC LIMIT 1) AS "sourceRequest"
      FROM "Lead" l
      JOIN "Customer" cu ON cu.id=l."customerId" AND cu."tenantId"=l."tenantId"
      LEFT JOIN LATERAL (
        SELECT id FROM "Conversation" WHERE "tenantId"=l."tenantId" AND "accountId"=l."accountId" AND "customerId"=l."customerId"
        ORDER BY "updatedAt" DESC LIMIT 1
      ) c ON TRUE
      LEFT JOIN LATERAL (
        SELECT "collectedData","workflowId",status FROM "WorkflowSession"
        WHERE "tenantId"=l."tenantId" AND "conversationId"=COALESCE(c.id,l."sourceConversationId")
        ORDER BY "updatedAt" DESC LIMIT 1
      ) ws ON TRUE
      WHERE l.id=${id} AND l."tenantId"=${tenantId} AND l."accountId"=${accountId}
        AND (cu."externalId" IS NULL OR cu."externalId" NOT LIKE 'portal-preview:%') LIMIT 1`;
    if (!rows[0]) throw new PortalError(404, 'LEAD_NOT_FOUND');
    return rows[0];
  }

  async update(tenantId: string, accountId: string, id: string, actorId: string, changes: { status?: LeadStage; note?: string | null; followUpAt?: Date | null; details?: Record<string, string> }) {
    return this.store.transaction(async tx => {
      const previous = await tx.db.$queryRaw<any[]>`
        SELECT l.status FROM "Lead" l JOIN "Customer" cu ON cu.id=l."customerId" AND cu."tenantId"=l."tenantId"
        WHERE l.id=${id} AND l."tenantId"=${tenantId} AND l."accountId"=${accountId}
          AND (cu."externalId" IS NULL OR cu."externalId" NOT LIKE 'portal-preview:%') FOR UPDATE OF l`;
      if (!previous[0]) throw new PortalError(404, 'LEAD_NOT_FOUND');
      const oldStatus = previous[0].status as LeadStage;
      const nextStatus = changes.status ?? oldStatus;
      const note = changes.note === undefined ? undefined : changes.note;
      const followUpAt = changes.followUpAt === undefined ? undefined : changes.followUpAt;
      const details = changes.details === undefined ? undefined : JSON.stringify(changes.details);
      await tx.db.$executeRaw`
        UPDATE "Lead" SET status=${nextStatus},
          note=CASE WHEN ${note === undefined} THEN note ELSE ${note ?? null} END,
          "followUpAt"=CASE WHEN ${followUpAt === undefined} THEN "followUpAt" ELSE ${followUpAt ?? null}::timestamptz END,
          details=CASE WHEN ${details === undefined} THEN details ELSE ${details ?? '{}'}::jsonb END,
          "contactedAt"=CASE WHEN ${nextStatus}='CONTACTED' THEN COALESCE("contactedAt",NOW()) ELSE "contactedAt" END,
          "closedAt"=CASE WHEN ${nextStatus} IN ('WON','LOST','DONE') THEN COALESCE("closedAt",NOW()) WHEN ${nextStatus}<>status THEN NULL ELSE "closedAt" END,
          "updatedAt"=NOW()
        WHERE id=${id} AND "tenantId"=${tenantId} AND "accountId"=${accountId}`;
      await tx.audit(actorId, accountId, 'LEAD_UPDATED', { leadId: id, from: oldStatus, to: nextStatus, noteChanged: note !== undefined, followUpChanged: followUpAt !== undefined, detailsChanged: details !== undefined });
      return new PortalLeads(tx).get(tenantId, accountId, id);
    });
  }

  async summary(tenantId: string, accountId: string) {
    const rows = await this.store.db.$queryRaw<any[]>`
      SELECT COUNT(*) FILTER (WHERE status='NEW')::int AS new,
        COUNT(*) FILTER (WHERE status='QUALIFIED')::int AS qualified,
        COUNT(*) FILTER (WHERE status='WON')::int AS won,
        COUNT(*) FILTER (WHERE status IN ('NEW','CONTACTED','QUALIFIED') AND ("followUpAt" IS NULL OR "followUpAt"<=NOW()))::int AS "needsAction",
        COUNT(*) FILTER (WHERE status IN ('NEW','CONTACTED','QUALIFIED') AND "followUpAt">NOW())::int AS "scheduled",
        COUNT(*) FILTER (WHERE status IN ('WON','LOST','DONE'))::int AS done,
        COUNT(*) FILTER (WHERE status IN ('NEW','CONTACTED','QUALIFIED') AND "followUpAt"<=NOW())::int AS "dueFollowUps"
      FROM "Lead" WHERE "tenantId"=${tenantId} AND "accountId"=${accountId}
        AND "customerId" NOT IN (SELECT id FROM "Customer" WHERE "externalId" LIKE 'portal-preview:%')`;
    return rows[0] || { new: 0, qualified: 0, won: 0, needsAction: 0, scheduled: 0, done: 0, dueFollowUps: 0 };
  }
}
