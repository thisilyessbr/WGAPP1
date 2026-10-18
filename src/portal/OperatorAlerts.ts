import { PortalStore } from './PortalStore';
import { telemetry } from '../core/telemetry/TelemetryClient';
import { logger } from '../utils/logger';

export type OperatorFinding = { key: string; severity: 'critical' | 'warning'; title: string; detail: string };

export type OperatorAlertThresholds = {
  queueLagMinutes: number;
  failedDeliveries15m: number;
  aiFailures10m: number;
  handoffWaitMinutes: number;
  spendWarnRatio: number;
};

export const DEFAULT_OPERATOR_THRESHOLDS: OperatorAlertThresholds = {
  queueLagMinutes: Number(process.env.OPERATOR_ALERT_QUEUE_LAG_MINUTES || 5),
  failedDeliveries15m: Number(process.env.OPERATOR_ALERT_FAILED_DELIVERIES || 3),
  aiFailures10m: Number(process.env.OPERATOR_ALERT_AI_FAILURES || 5),
  handoffWaitMinutes: Number(process.env.OPERATOR_ALERT_HANDOFF_MINUTES || 15),
  spendWarnRatio: Number(process.env.OPERATOR_ALERT_SPEND_RATIO || 0.8)
};

type Deliver = (finding: OperatorFinding) => Promise<void>;

/**
 * Platform-wide health checks for the Relayqo operator (not merchants): a
 * stuck queue, failed WhatsApp sends, AI provider outages, customers waiting
 * for a human and accounts close to their monthly spend. Each finding is sent
 * at most once per hour per key, across all workers, through a unique row in
 * "OperatorAlert". Messages carry counts and account ids, never conversation
 * content or phone numbers.
 */
export class OperatorAlerts {
  private timer?: NodeJS.Timeout;
  private busy = false;
  private aiFailures: number[] = [];
  private unsubscribe?: () => void;

  constructor(private store: PortalStore, private deliver: Deliver = OperatorAlerts.send,
    private thresholds: OperatorAlertThresholds = DEFAULT_OPERATOR_THRESHOLDS, private now = () => Date.now()) {}

  static configured() {
    return Boolean(process.env.OPERATOR_ALERT_WEBHOOK_URL
      || (process.env.OPERATOR_ALERT_EMAILS && process.env.RESEND_API_KEY && process.env.PORTAL_MAIL_FROM));
  }

  /** AI failures are only visible in-process (telemetry), so count them as they happen. */
  recordAiFailure(at = this.now()) {
    this.aiFailures.push(at);
    const cutoff = at - 10 * 60000;
    while (this.aiFailures.length && this.aiFailures[0] < cutoff) this.aiFailures.shift();
  }

  start() {
    if (this.timer) return;
    this.unsubscribe = telemetry.onEvent(event => {
      if (event.eventType === 'llm_failed') this.recordAiFailure();
    });
    const run = () => void this.tick().catch(error => logger.error('Operator alert check failed', error));
    run();
    this.timer = setInterval(run, 60000);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  async check(): Promise<OperatorFinding[]> {
    const t = this.thresholds;
    const db = this.store.db;
    const findings: OperatorFinding[] = [];

    const lag = (await db.$queryRaw<any[]>`SELECT COUNT(*)::int AS waiting,
        COALESCE(EXTRACT(EPOCH FROM (NOW()-MIN("createdAt")))/60,0)::float AS "oldestMinutes"
      FROM "WhatsAppMessageJob" WHERE status='PENDING' AND "availableAt"<=NOW()`)[0];
    if (lag && Number(lag.oldestMinutes) >= t.queueLagMinutes) {
      findings.push({ key: 'queue_lag', severity: 'critical', title: 'Customer messages are waiting in the queue',
        detail: `${lag.waiting} message(s) not processed; the oldest has waited ${Math.round(lag.oldestMinutes)} min. Check that the worker is running.` });
    }

    const failed = await db.$queryRaw<any[]>`SELECT "accountId",COUNT(*)::int AS failed FROM (
        SELECT "accountId" FROM "WhatsAppMessageJob"
          WHERE "outboundStatus" IN ('FAILED','UNKNOWN') AND "updatedAt">NOW()-INTERVAL '15 minutes'
        UNION ALL
        SELECT "accountId" FROM "WhatsAppOutboundJob"
          WHERE status='FAILED' AND "updatedAt">NOW()-INTERVAL '15 minutes'
      ) f GROUP BY "accountId" HAVING COUNT(*)>=${t.failedDeliveries15m} ORDER BY failed DESC LIMIT 10`;
    for (const row of failed) {
      findings.push({ key: `failed_deliveries:${row.accountId}`, severity: 'critical', title: 'WhatsApp replies are failing',
        detail: `Account ${row.accountId}: ${row.failed} reply/replies failed or have unknown delivery in the last 15 min. Check the number's connection and Meta status.` });
    }

    const recentAiFailures = this.aiFailures.filter(at => at >= this.now() - 10 * 60000).length;
    if (recentAiFailures >= t.aiFailures10m) {
      findings.push({ key: 'ai_failures', severity: 'critical', title: 'The AI provider is failing',
        detail: `${recentAiFailures} AI call(s) failed or timed out in the last 10 min. Customers may be getting fallback replies.` });
    }

    const waiting = await db.$queryRaw<any[]>`SELECT c."accountId",COUNT(*)::int AS waiting,
        (EXTRACT(EPOCH FROM (NOW()-MIN(c."humanRequestedAt")))/60)::float AS "oldestMinutes"
      FROM "Conversation" c JOIN "Customer" cu ON cu.id=c."customerId" AND cu."tenantId"=c."tenantId"
      WHERE c.status='HANDOFF_REQUESTED' AND c."humanRequestedAt"<=NOW()-(${t.handoffWaitMinutes} * INTERVAL '1 minute')
        AND c."humanRequestedAt">NOW()-INTERVAL '3 days'
        AND (cu."externalId" IS NULL OR cu."externalId" NOT LIKE 'portal-preview:%')
      GROUP BY c."accountId" ORDER BY "oldestMinutes" DESC LIMIT 10`;
    for (const row of waiting) {
      findings.push({ key: `handoff_waiting:${row.accountId}`, severity: 'warning', title: 'Customers are waiting for a human',
        detail: `Account ${row.accountId}: ${row.waiting} customer(s) asked for a person and nobody has picked up; the oldest has waited ${Math.round(row.oldestMinutes)} min.` });
    }

    const period = new Date(this.now()).toISOString().slice(0, 7);
    const spend = await db.$queryRaw<any[]>`SELECT b."accountId",
        (b."spentMicros"+b."reservedMicros")::float/1000000 AS spent,
        (p."planSnapshot"->'limits'->>'monthlyUsd')::float AS "limitUsd"
      FROM "PortalUsageBucket" b JOIN "PortalProfile" p ON p."accountId"=b."accountId"
      WHERE b.period=${period} AND p.status='ACTIVE'
        AND (p."planSnapshot"->'limits'->>'monthlyUsd')::float>0
        AND (b."spentMicros"+b."reservedMicros")::float/1000000>=(p."planSnapshot"->'limits'->>'monthlyUsd')::float*${t.spendWarnRatio}
      LIMIT 20`;
    for (const row of spend) {
      const ratio = Number(row.spent) / Number(row.limitUsd);
      findings.push({ key: `spend:${row.accountId}:${ratio >= 1 ? 'exhausted' : 'near'}`, severity: ratio >= 1 ? 'critical' : 'warning',
        title: ratio >= 1 ? 'An account has used its whole monthly AI budget' : 'An account is close to its monthly AI budget',
        detail: `Account ${row.accountId}: $${Number(row.spent).toFixed(2)} of $${Number(row.limitUsd).toFixed(2)} (${Math.round(ratio * 100)}%) used in ${period}.${ratio >= 1 ? ' New AI replies are blocked until the plan is raised.' : ''}` });
    }
    return findings;
  }

  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      const findings = await this.check();
      const bucket = new Date(this.now()).toISOString().slice(0, 13);
      for (const finding of findings) {
        // Only the worker whose insert wins sends; the rest skip silently.
        const claimed = await this.store.db.$executeRaw`INSERT INTO "OperatorAlert"(id,key,bucket,severity,title,detail)
          VALUES (gen_random_uuid()::text,${finding.key},${bucket},${finding.severity},${finding.title},${finding.detail})
          ON CONFLICT (key,bucket) DO NOTHING`;
        if (!claimed) continue;
        try {
          await this.deliver(finding);
          await this.store.db.$executeRaw`UPDATE "OperatorAlert" SET "sentAt"=NOW() WHERE key=${finding.key} AND bucket=${bucket}`;
        } catch (error) {
          logger.error(`Operator alert delivery failed (${finding.key})`, error);
          await this.store.db.$executeRaw`UPDATE "OperatorAlert" SET error=${String((error as Error)?.message || error).slice(0, 500)} WHERE key=${finding.key} AND bucket=${bucket}`;
        }
      }
    } finally { this.busy = false; }
  }

  async recent(limit = 50) {
    return this.store.db.$queryRaw<any[]>`SELECT key,severity,title,detail,"createdAt","sentAt",error
      FROM "OperatorAlert" ORDER BY "createdAt" DESC LIMIT ${Math.min(200, Math.max(1, limit))}`;
  }

  static async send(finding: OperatorFinding) {
    const text = `${finding.severity === 'critical' ? '🔴' : '🟠'} Relayqo: ${finding.title}\n${finding.detail}`;
    const tasks: Promise<void>[] = [];
    const webhook = process.env.OPERATOR_ALERT_WEBHOOK_URL;
    if (webhook) {
      // {text} works for Slack and Telegram's sendMessage (chat_id in the URL); {content} for Discord.
      tasks.push(fetch(webhook, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000),
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, content: text }) })
        .then(response => { if (!response.ok) throw new Error(`Alert webhook returned ${response.status}`); }));
    }
    const emails = (process.env.OPERATOR_ALERT_EMAILS || '').split(',').map(item => item.trim()).filter(Boolean);
    if (emails.length && process.env.RESEND_API_KEY && process.env.PORTAL_MAIL_FROM) {
      tasks.push(fetch('https://api.resend.com/emails', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000),
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: process.env.PORTAL_MAIL_FROM, to: emails, subject: `Relayqo alert: ${finding.title}`, text }) })
        .then(response => { if (!response.ok) throw new Error(`Email provider returned ${response.status}`); }));
    }
    if (!tasks.length) throw new Error('No operator alert destination configured');
    const results = await Promise.allSettled(tasks);
    if (results.every(result => result.status === 'rejected')) throw (results[0] as PromiseRejectedResult).reason;
  }
}
