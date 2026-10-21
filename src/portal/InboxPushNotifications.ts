import webpush from 'web-push';
import { logger } from '../utils/logger';
import { PortalStore } from './PortalStore';

type PushKeys = { p256dh: string; auth: string };
type PushSubscriptionInput = { endpoint: string; keys: PushKeys };

/** Account-scoped browser push for customer messages. Payloads deliberately omit
 * message text and phone numbers because notifications can appear on a lock screen. */
export class InboxPushNotifications {
  private timer?: NodeJS.Timeout;
  private busy = false;

  constructor(private store: PortalStore) {
    if (InboxPushNotifications.configured()) {
      webpush.setVapidDetails(
        process.env.WEB_PUSH_SUBJECT || 'mailto:support@relayqo.online',
        process.env.WEB_PUSH_PUBLIC_KEY!, process.env.WEB_PUSH_PRIVATE_KEY!
      );
    }
  }

  static configured() {
    return Boolean(process.env.WEB_PUSH_PUBLIC_KEY && process.env.WEB_PUSH_PRIVATE_KEY);
  }

  publicKey() { return InboxPushNotifications.configured() ? process.env.WEB_PUSH_PUBLIC_KEY! : null; }

  async subscribe(userId: string, tenantId: string, accountId: string, input: PushSubscriptionInput) {
    await this.store.db.$executeRaw`INSERT INTO "PortalPushSubscription"(id,"userId","tenantId","accountId",endpoint,p256dh,auth,enabled)
      VALUES (gen_random_uuid()::text,${userId},${tenantId},${accountId},${input.endpoint},${input.keys.p256dh},${input.keys.auth},true)
      ON CONFLICT (endpoint) DO UPDATE SET "userId"=EXCLUDED."userId","tenantId"=EXCLUDED."tenantId",
        "accountId"=EXCLUDED."accountId",p256dh=EXCLUDED.p256dh,auth=EXCLUDED.auth,enabled=true,"updatedAt"=NOW()`;
  }

  async unsubscribe(userId: string, endpoint: string) {
    await this.store.db.$executeRaw`DELETE FROM "PortalPushSubscription" WHERE "userId"=${userId} AND endpoint=${endpoint}`;
  }

  async enabled(userId: string, accountId: string) {
    const rows = await this.store.db.$queryRaw<any[]>`SELECT EXISTS(SELECT 1 FROM "PortalPushSubscription"
      WHERE "userId"=${userId} AND "accountId"=${accountId} AND enabled=true) AS enabled`;
    return Boolean(rows[0]?.enabled);
  }

  start() {
    if (this.timer || !InboxPushNotifications.configured()) return;
    const run = () => void this.tick().catch(error => logger.error('Inbox push notification check failed', error));
    run();
    this.timer = setInterval(run, 10000);
    this.timer.unref();
  }

  stop() { if (this.timer) clearInterval(this.timer); this.timer = undefined; }

  async tick() {
    if (this.busy || !InboxPushNotifications.configured()) return;
    this.busy = true;
    try {
      const rows = await this.store.db.$queryRaw<any[]>`
        SELECT s.id AS "subscriptionId",s.endpoint,s.p256dh,s.auth,m.id AS "messageId",c.id AS "conversationId",
          c.status,c."humanRequested",cas."humanTakeover"
        FROM "PortalPushSubscription" s
        JOIN LATERAL (
          SELECT m.id,m."conversationId",m."createdAt" FROM "Message" m
          JOIN "Conversation" c0 ON c0.id=m."conversationId" AND c0."tenantId"=m."tenantId"
          JOIN "Customer" cu ON cu.id=c0."customerId" AND cu."tenantId"=c0."tenantId"
          WHERE m."tenantId"=s."tenantId" AND c0."accountId"=s."accountId" AND m.role='USER'
            AND (cu."externalId" IS NULL OR cu."externalId" NOT LIKE 'portal-preview:%')
            AND m."createdAt">=s."createdAt"
            AND NOT EXISTS (SELECT 1 FROM "PortalPushDelivery" d WHERE d."subscriptionId"=s.id AND d."messageId"=m.id)
          ORDER BY m."createdAt" ASC LIMIT 1
        ) m ON true
        JOIN "Conversation" c ON c.id=m."conversationId"
        LEFT JOIN "ConversationAutomationState" cas ON cas."conversationId"=c.id AND cas."tenantId"=c."tenantId"
        WHERE s.enabled=true ORDER BY m."createdAt" ASC LIMIT 100`;
      for (const row of rows) await this.deliver(row);
      await this.store.db.$executeRaw`DELETE FROM "PortalPushDelivery" WHERE "sentAt"<NOW()-INTERVAL '30 days'`;
    } finally { this.busy = false; }
  }

  private async deliver(row: any) {
    const claimed = await this.store.db.$executeRaw`INSERT INTO "PortalPushDelivery"("subscriptionId","messageId")
      VALUES (${row.subscriptionId},${row.messageId}) ON CONFLICT DO NOTHING`;
    if (!claimed) return;
    const needsHuman = Boolean(row.humanRequested || row.humanTakeover || row.status === 'HANDOFF_REQUESTED');
    const payload = JSON.stringify({
      title: needsHuman ? 'Customer needs you' : 'New message in Relayqo',
      body: needsHuman ? 'Open the inbox to take over this conversation.' : 'A customer sent a new message.',
      url: `/app/inbox/${encodeURIComponent(row.conversationId)}`,
      tag: `relayqo-inbox-${row.messageId}`
    });
    try {
      await webpush.sendNotification({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, payload, { TTL: 3600, urgency: needsHuman ? 'high' : 'normal' });
    } catch (error: any) {
      if (error?.statusCode === 404 || error?.statusCode === 410) {
        await this.store.db.$executeRaw`DELETE FROM "PortalPushSubscription" WHERE id=${row.subscriptionId}`;
      } else {
        await this.store.db.$executeRaw`DELETE FROM "PortalPushDelivery" WHERE "subscriptionId"=${row.subscriptionId} AND "messageId"=${row.messageId}`;
        logger.warn('Inbox push delivery failed', { statusCode: error?.statusCode, message: error?.message });
      }
    }
  }
}
