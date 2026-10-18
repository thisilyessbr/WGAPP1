import { PortalDb } from './types';

export type PilotAccountMetrics = {
  accountId: string; name: string; conversations: number; inbound: number;
  repliesSent: number; repliesFailed: number; deliveryRate: number | null;
  handoffs: number; handoffRate: number | null; leads: number; orders: number; bookings: number;
  missedQuestions: number; flaggedAnswers: number; openFlags: number;
};

/**
 * The pilot scorecard: one row per active client with the numbers that decide
 * whether the pilot worked - replies delivered, wrong answers flagged by the
 * merchant, handoffs, leads, orders and bookings. Portal previews are excluded.
 */
export async function pilotMetrics(db: PortalDb, days: number): Promise<PilotAccountMetrics[]> {
  const safeDays = Math.max(1, Math.min(180, Math.floor(days) || 30));
  const since = new Date(Date.now() - safeDays * 86400000);
  const rows = await db.$queryRaw<any[]>`WITH accounts AS (
      SELECT p."accountId",p."tenantId",a.name FROM "PortalProfile" p
      JOIN "Account" a ON a.id=p."accountId" AND a."tenantId"=p."tenantId" WHERE p.status='ACTIVE'
    ), convs AS (
      SELECT c."accountId",COUNT(*)::int AS conversations FROM "Conversation" c
      JOIN accounts x ON x."accountId"=c."accountId" AND x."tenantId"=c."tenantId"
      WHERE c."createdAt">=${since} AND NOT EXISTS (SELECT 1 FROM "Customer" cu WHERE cu.id=c."customerId"
        AND cu."tenantId"=c."tenantId" AND cu."externalId" LIKE 'portal-preview:%')
      GROUP BY c."accountId"
    ), jobs AS (
      SELECT j."accountId",COUNT(*)::int AS inbound,
        COUNT(*) FILTER (WHERE j."outboundStatus"='SENT')::int AS sent,
        COUNT(*) FILTER (WHERE j."outboundStatus" IN ('FAILED','UNKNOWN'))::int AS failed
      FROM "WhatsAppMessageJob" j JOIN accounts x ON x."accountId"=j."accountId" AND x."tenantId"=j."tenantId"
      WHERE j."createdAt">=${since} GROUP BY j."accountId"
    ), outcomes AS (
      SELECT o."accountId",
        COUNT(*) FILTER (WHERE o.type='HANDOFF_REQUESTED')::int AS handoffs,
        COUNT(*) FILTER (WHERE o.type='LEAD_CREATED')::int AS leads,
        COUNT(*) FILTER (WHERE o.type='ORDER_CONFIRMED')::int AS orders,
        COUNT(*) FILTER (WHERE o.type='BOOKING_CONFIRMED')::int AS bookings,
        COUNT(*) FILTER (WHERE o.type='QUESTION_MISSED')::int AS missed
      FROM "OutcomeEvent" o JOIN accounts x ON x."accountId"=o."accountId" AND x."tenantId"=o."tenantId"
      WHERE o."occurredAt">=${since} GROUP BY o."accountId"
    ), flags AS (
      SELECT f."accountId",COUNT(*)::int AS flagged,COUNT(*) FILTER (WHERE f.status='OPEN')::int AS open
      FROM "PortalAnswerFeedback" f JOIN accounts x ON x."accountId"=f."accountId" AND x."tenantId"=f."tenantId"
      WHERE f."createdAt">=${since} GROUP BY f."accountId"
    )
    SELECT x."accountId",x.name,COALESCE(c.conversations,0) AS conversations,COALESCE(j.inbound,0) AS inbound,
      COALESCE(j.sent,0) AS sent,COALESCE(j.failed,0) AS failed,COALESCE(o.handoffs,0) AS handoffs,
      COALESCE(o.leads,0) AS leads,COALESCE(o.orders,0) AS orders,COALESCE(o.bookings,0) AS bookings,
      COALESCE(o.missed,0) AS missed,COALESCE(f.flagged,0) AS flagged,COALESCE(f.open,0) AS open
    FROM accounts x LEFT JOIN convs c ON c."accountId"=x."accountId" LEFT JOIN jobs j ON j."accountId"=x."accountId"
    LEFT JOIN outcomes o ON o."accountId"=x."accountId" LEFT JOIN flags f ON f."accountId"=x."accountId"
    ORDER BY COALESCE(j.inbound,0) DESC,x.name LIMIT 200`;
  return rows.map(row => {
    const sent = Number(row.sent), failed = Number(row.failed), conversations = Number(row.conversations), handoffs = Number(row.handoffs);
    return {
      accountId: row.accountId, name: row.name, conversations, inbound: Number(row.inbound),
      repliesSent: sent, repliesFailed: failed, deliveryRate: sent + failed ? sent / (sent + failed) : null,
      handoffs, handoffRate: conversations ? Math.min(1, handoffs / conversations) : null,
      leads: Number(row.leads), orders: Number(row.orders), bookings: Number(row.bookings),
      missedQuestions: Number(row.missed), flaggedAnswers: Number(row.flagged), openFlags: Number(row.open)
    };
  });
}
