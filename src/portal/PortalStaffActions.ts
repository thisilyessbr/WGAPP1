import { randomUUID } from 'crypto';
import { PortalStore } from './PortalStore';
import { PortalError } from './types';
import { logger } from '../utils/logger';

type Alert = { id: string; accountId: string; tenantId: string; recipientId: string; email: string; kind: string; sourceId: string; occurrence: string; attempts: number };

/** Account-scoped staff queue and retryable, deduplicated email delivery. */
export class PortalStaffActions {
  private timer?: NodeJS.Timeout;
  private busy = false;
  constructor(private store: PortalStore, private deliver: (alert: Alert, url: string) => Promise<void> = PortalStaffActions.sendEmail) {}

  async queue(tenantId: string, accountId: string) {
    const [handoffs, requests, feedback] = await Promise.all([
      this.store.db.$queryRaw<any[]>`SELECT c.id,c."updatedAt" AS at,cu."externalId" AS customer,
        c."contextData"->'_portalHandoff'->>'ownerId' AS "ownerId"
        FROM "Conversation" c JOIN "Customer" cu ON cu.id=c."customerId" AND cu."tenantId"=c."tenantId"
        WHERE c."tenantId"=${tenantId} AND c."accountId"=${accountId}
          AND (c.status='HANDOFF_REQUESTED' OR (c."humanRequested"=true AND c.status<>'HUMAN_ACTIVE'))
          AND (cu."externalId" IS NULL OR cu."externalId" NOT LIKE 'portal-preview:%')
        ORDER BY c."updatedAt" DESC LIMIT 25`,
      this.store.db.$queryRaw<any[]>`SELECT l.id,l."followUpAt" AS at,l.status,cu."externalId" AS customer,
        assignee.name AS "assigneeName"
        FROM "Lead" l JOIN "Customer" cu ON cu.id=l."customerId" AND cu."tenantId"=l."tenantId"
        LEFT JOIN "PortalUser" assignee ON assignee.id=l."assignedToUserId"
        WHERE l."tenantId"=${tenantId} AND l."accountId"=${accountId}
          AND l.status IN ('NEW','CONTACTED','QUALIFIED') AND (l."followUpAt" IS NULL OR l."followUpAt"<=NOW())
          AND (cu."externalId" IS NULL OR cu."externalId" NOT LIKE 'portal-preview:%')
        ORDER BY l."followUpAt" ASC NULLS LAST,l."updatedAt" DESC LIMIT 25`,
      this.store.db.$queryRaw<any[]>`SELECT id,"createdAt" AS at FROM "PortalAnswerFeedback"
        WHERE "tenantId"=${tenantId} AND "accountId"=${accountId} AND status='OPEN'
        ORDER BY "createdAt" DESC LIMIT 25`
    ]);
    return {
      handoffs: handoffs.map(row => ({ ...row, url: `/app/inbox/${encodeURIComponent(row.id)}` })),
      requests: requests.map(row => ({ ...row, url: `/app/leads/${encodeURIComponent(row.id)}` })),
      feedback: feedback.map(row => ({ ...row, url: '/app/answer-reviews' }))
    };
  }

  async report(tenantId: string, accountId: string, conversationId: string, messageId: string, actorId: string, note: string) {
    if (!note.trim() || note.length > 1000) throw new PortalError(400, 'FEEDBACK_NOTE_REQUIRED');
    return this.store.transaction(async tx => {
      const rows = await tx.db.$queryRaw<any[]>`SELECT m.id,m.content,c.id AS "conversationId",
        (SELECT q.content FROM "Message" q WHERE q."conversationId"=c.id AND q."tenantId"=c."tenantId"
          AND q.role='USER' AND q."createdAt"<=m."createdAt" ORDER BY q."createdAt" DESC LIMIT 1) AS question
        FROM "Message" m JOIN "Conversation" c ON c.id=m."conversationId" AND c."tenantId"=m."tenantId"
        JOIN "Customer" cu ON cu.id=c."customerId" AND cu."tenantId"=c."tenantId"
        WHERE c.id=${conversationId} AND c."tenantId"=${tenantId} AND c."accountId"=${accountId}
          AND m.id=${messageId} AND m.role='ASSISTANT' AND COALESCE(m.metadata->>'manual','false')<>'true'
          AND (cu."externalId" IS NULL OR cu."externalId" NOT LIKE 'portal-preview:%')`;
      const row = rows[0];
      if (!row) throw new PortalError(404, 'AI_MESSAGE_NOT_FOUND');
      const id = randomUUID();
      await tx.db.$executeRaw`INSERT INTO "PortalAnswerFeedback"
        (id,"tenantId","accountId","conversationId","messageId","reportedById",question,answer,note)
        VALUES (${id},${tenantId},${accountId},${conversationId},${messageId},${actorId},${String(row.question || '').slice(0,4000)},${String(row.content).slice(0,4000)},${note.trim()})
        ON CONFLICT ("accountId","messageId") DO NOTHING`;
      const saved = (await tx.db.$queryRaw<any[]>`SELECT id FROM "PortalAnswerFeedback" WHERE "accountId"=${accountId} AND "messageId"=${messageId}`)[0];
      if (saved.id === id) await tx.audit(actorId, accountId, 'AI_ANSWER_FLAGGED', { feedbackId: id, messageId });
      return saved;
    });
  }

  async feedback(tenantId: string, accountId: string) {
    return this.store.db.$queryRaw<any[]>`SELECT id,"conversationId","messageId",question,answer,note,status,"resolutionNote","createdAt","resolvedAt","retestAt","retestAnswer","retestMode"
      FROM "PortalAnswerFeedback" WHERE "tenantId"=${tenantId} AND "accountId"=${accountId}
      ORDER BY status='OPEN' DESC,"createdAt" DESC LIMIT 100`;
  }

  async resolve(tenantId: string, accountId: string, id: string, actorId: string, resolutionNote: string) {
    if (resolutionNote.trim().length < 10 || resolutionNote.length > 1000) throw new PortalError(400, 'EXPLAIN_CORRECTION_AND_RETEST');
    const changed = await this.store.db.$executeRaw`UPDATE "PortalAnswerFeedback" SET status='RESOLVED',
      "resolutionNote"=${resolutionNote.trim()},"resolvedById"=${actorId},"resolvedAt"=NOW()
      WHERE id=${id} AND "tenantId"=${tenantId} AND "accountId"=${accountId} AND status='OPEN' AND "retestAt" IS NOT NULL AND "retestMode"='published'`;
    if (!changed) throw new PortalError(409, 'PUBLISHED_RETEST_REQUIRED', 'Publish the correction and retest the published answer before closing the review.');
    await this.store.audit(actorId, accountId, 'AI_ANSWER_REVIEWED', { feedbackId: id });
  }

  async retest(tenantId: string, accountId: string, id: string, actorId: string, mode: string, answer: string) {
    const changed = await this.store.db.$executeRaw`UPDATE "PortalAnswerFeedback"
      SET "retestAt"=NOW(),"retestAnswer"=${answer.slice(0,4000)},"retestMode"=${mode}
      WHERE id=${id} AND "tenantId"=${tenantId} AND "accountId"=${accountId} AND status='OPEN'`;
    if (!changed) throw new PortalError(404, 'FEEDBACK_NOT_FOUND');
    await this.store.audit(actorId, accountId, 'AI_ANSWER_RETESTED', { feedbackId: id, mode });
  }

  start() {
    if (this.timer) return;
    void this.tick().catch(error => logger.error('Staff alert worker failed', error));
    this.timer = setInterval(() => void this.tick().catch(error => logger.error('Staff alert worker failed', error)), 60000);
    this.timer.unref();
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = undefined; }

  async tick() {
    if (this.busy || !process.env.RESEND_API_KEY || !process.env.PORTAL_MAIL_FROM) return;
    this.busy = true;
    try {
      // Start with recent events at rollout, then retain a durable checkpoint across worker outages.
      await this.store.db.$executeRaw`INSERT INTO "PortalStaffAlertCursor"(id,"scannedThrough")
        VALUES ('staff-alerts',NOW()-INTERVAL '1 hour') ON CONFLICT DO NOTHING`;
      const checkpoint = (await this.store.db.$queryRaw<any[]>`SELECT "scannedThrough",NOW() AS through
        FROM "PortalStaffAlertCursor" WHERE id='staff-alerts'`)[0];
      // Brief overlap covers transactions committed just after the preceding scan.
      const since = new Date(new Date(checkpoint.scannedThrough).getTime() - 120000), through = new Date(checkpoint.through);
      await this.store.db.$executeRaw`INSERT INTO "PortalActionAlert"(id,"tenantId","accountId","recipientId",kind,"sourceId",occurrence)
        SELECT gen_random_uuid()::text,c."tenantId",c."accountId",u.id,'HANDOFF',c.id,
          COALESCE(c."humanRequestedAt",c."updatedAt")::text
        FROM "Conversation" c JOIN "Customer" cu ON cu.id=c."customerId" AND cu."tenantId"=c."tenantId"
        JOIN "PortalProfile" p ON p."accountId"=c."accountId" AND p."tenantId"=c."tenantId"
        JOIN "PortalMembership" pm ON pm."accountId"=c."accountId" AND pm."tenantId"=c."tenantId"
        JOIN "PortalUser" u ON u.id=pm."userId"
        WHERE c.status='HANDOFF_REQUESTED' AND p.status='ACTIVE' AND u.disabled=false AND u."verifiedAt" IS NOT NULL AND u.email NOT ILIKE '%.test'
          AND c."humanRequestedAt">${since}::timestamptz AND c."humanRequestedAt"<=${through}::timestamptz
          AND (cu."externalId" IS NULL OR cu."externalId" NOT LIKE 'portal-preview:%')
        ON CONFLICT DO NOTHING`;
      await this.store.db.$executeRaw`INSERT INTO "PortalActionAlert"(id,"tenantId","accountId","recipientId",kind,"sourceId",occurrence)
        SELECT gen_random_uuid()::text,l."tenantId",l."accountId",u.id,'REQUEST',l.id,l."createdAt"::text
        FROM "Lead" l JOIN "Customer" cu ON cu.id=l."customerId" AND cu."tenantId"=l."tenantId"
        JOIN "PortalProfile" p ON p."accountId"=l."accountId" AND p."tenantId"=l."tenantId"
        JOIN "PortalMembership" pm ON pm."accountId"=l."accountId" AND pm."tenantId"=l."tenantId"
        JOIN "PortalUser" u ON u.id=pm."userId"
        WHERE l.status IN ('NEW','QUALIFIED') AND l."createdAt">${since}::timestamptz AND l."createdAt"<=${through}::timestamptz
          AND p.status='ACTIVE' AND u.disabled=false AND u."verifiedAt" IS NOT NULL AND u.email NOT ILIKE '%.test'
          AND (l."assignedToUserId" IS NULL OR l."assignedToUserId"=u.id)
          AND (cu."externalId" IS NULL OR cu."externalId" NOT LIKE 'portal-preview:%')
        ON CONFLICT DO NOTHING`;
      await this.store.db.$executeRaw`INSERT INTO "PortalActionAlert"(id,"tenantId","accountId","recipientId",kind,"sourceId",occurrence)
        SELECT gen_random_uuid()::text,l."tenantId",l."accountId",u.id,'FOLLOW_UP',l.id,l."followUpAt"::text
        FROM "Lead" l JOIN "Customer" cu ON cu.id=l."customerId" AND cu."tenantId"=l."tenantId"
        JOIN "PortalProfile" p ON p."accountId"=l."accountId" AND p."tenantId"=l."tenantId"
        JOIN "PortalMembership" pm ON pm."accountId"=l."accountId" AND pm."tenantId"=l."tenantId"
        JOIN "PortalUser" u ON u.id=pm."userId"
        WHERE l.status IN ('NEW','CONTACTED','QUALIFIED') AND l."followUpAt"<=${through}
          AND (l."followUpAt">${since} OR (l."updatedAt">${since} AND l."updatedAt"<=${through})) AND p.status='ACTIVE'
          AND u.disabled=false AND u."verifiedAt" IS NOT NULL AND u.email NOT ILIKE '%.test'
          AND (l."assignedToUserId" IS NULL OR l."assignedToUserId"=u.id)
          AND (cu."externalId" IS NULL OR cu."externalId" NOT LIKE 'portal-preview:%')
        ON CONFLICT DO NOTHING`;
      await this.store.db.$executeRaw`UPDATE "PortalStaffAlertCursor" SET "scannedThrough"=GREATEST("scannedThrough",${through}) WHERE id='staff-alerts'`;
      await this.store.db.$executeRaw`UPDATE "PortalActionAlert" SET status='PENDING',"leaseUntil"=NULL
        WHERE status='SENDING' AND "leaseUntil"<NOW()`;
      for (let i = 0; i < 10; i++) {
        const alert = await this.store.transaction(async tx => {
          const rows = await tx.db.$queryRaw<Alert[]>`SELECT a.*,u.email FROM "PortalActionAlert" a
            JOIN "PortalUser" u ON u.id=a."recipientId" AND u.disabled=false AND u."verifiedAt" IS NOT NULL
            WHERE a.status='PENDING' AND a."nextAttemptAt"<=NOW()
            ORDER BY a."createdAt" FOR UPDATE OF a SKIP LOCKED LIMIT 1`;
          if (rows[0]) await tx.db.$executeRaw`UPDATE "PortalActionAlert" SET status='SENDING',"leaseUntil"=NOW()+INTERVAL '2 minutes',attempts=attempts+1 WHERE id=${rows[0].id}`;
          return rows[0];
        });
        if (!alert) break;
        try {
          const authorized = await this.store.db.$queryRaw<any[]>`SELECT 1 FROM "PortalMembership" pm
            JOIN "PortalUser" u ON u.id=pm."userId" AND u.disabled=false AND u."verifiedAt" IS NOT NULL
            JOIN "PortalProfile" p ON p."accountId"=pm."accountId" AND p."tenantId"=pm."tenantId" AND p.status='ACTIVE'
            WHERE pm."tenantId"=${alert.tenantId} AND pm."accountId"=${alert.accountId} AND pm."userId"=${alert.recipientId}`;
          const eligible = alert.kind === 'HANDOFF'
            ? await this.store.db.$queryRaw<any[]>`SELECT 1 FROM "Conversation" WHERE id=${alert.sourceId} AND "tenantId"=${alert.tenantId} AND "accountId"=${alert.accountId} AND status='HANDOFF_REQUESTED'`
            : await this.store.db.$queryRaw<any[]>`SELECT 1 FROM "Lead" WHERE id=${alert.sourceId} AND "tenantId"=${alert.tenantId} AND "accountId"=${alert.accountId} AND status IN ('NEW','CONTACTED','QUALIFIED')
              AND ("assignedToUserId" IS NULL OR "assignedToUserId"=${alert.recipientId})
              AND (${alert.kind}<>'FOLLOW_UP' OR "followUpAt"::text=${alert.occurrence})`;
          if (eligible.length && authorized.length) {
            const path = alert.kind === 'HANDOFF' ? `/app/inbox/${alert.sourceId}` : `/app/leads/${alert.sourceId}`;
            const base = (process.env.PORTAL_PUBLIC_URL || '').replace(/\/$/, '');
            if (!base.startsWith('https://')) throw new Error('Secure portal URL required');
            await this.deliver(alert, base + path);
          }
          await this.store.db.$executeRaw`UPDATE "PortalActionAlert" SET status=${eligible.length && authorized.length ? 'SENT' : 'CANCELLED'},"sentAt"=NOW(),"leaseUntil"=NULL WHERE id=${alert.id}`;
        } catch (error) {
          logger.error(`Staff alert delivery failed (${alert.kind}, attempt ${alert.attempts + 1})`, error);
          const exhausted = alert.attempts + 1 >= 5;
          await this.store.db.$executeRaw`UPDATE "PortalActionAlert" SET status=${exhausted ? 'FAILED' : 'PENDING'},
            "leaseUntil"=NULL,"nextAttemptAt"=NOW()+(${Math.min(60, 2 ** alert.attempts)} * INTERVAL '1 minute') WHERE id=${alert.id}`;
        }
      }
    } finally { this.busy = false; }
  }

  private static async sendEmail(alert: Alert, url: string) {
    const subject = alert.kind === 'HANDOFF' ? 'Relayqo: customer needs a person' : alert.kind === 'FOLLOW_UP' ? 'Relayqo: follow-up due' : 'Relayqo: new customer request';
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000),
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json',
        'Idempotency-Key': `relayqo-action-${alert.id}` },
      body: JSON.stringify({ from: process.env.PORTAL_MAIL_FROM, to: [alert.email], subject,
        text: `A customer action needs your attention in Relayqo.\n\nOpen your workspace: ${url}\n\nThis message contains no customer conversation content.` })
    });
    if (!response.ok) throw new Error(`Email provider returned ${response.status}`);
  }
}
