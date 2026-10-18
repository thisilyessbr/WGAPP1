import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { portalDatabase } from '../helpers/portal-db';
import { PortalStore } from '../../src/portal/PortalStore';
import { BroadcastChannel, PortalBroadcasts, isOptOutMessage, normalizeWaId } from '../../src/portal/PortalBroadcasts';

const templates = [
  { name: 'promo_eid', language: 'ar', status: 'APPROVED', category: 'MARKETING', components: [{ type: 'BODY', text: 'عرض العيد: {{1}} حتى {{2}}' }] },
  { name: 'draft_offer', language: 'fr', status: 'PENDING', category: 'MARKETING', components: [{ type: 'BODY', text: 'Offre' }] }
];

async function setup() {
  const database = await portalDatabase();
  const store = new PortalStore(database.db);
  const shop = await store.register(randomUUID() + '@example.test', 'Shop', 'hash', null);
  const other = await store.register(randomUUID() + '@example.test', 'Other', 'hash', null);
  const actor = (await store.db.$queryRaw<any[]>`SELECT "userId" FROM "PortalMembership" WHERE "accountId"=${shop.accountId}`)[0].userId;
  const plan = (limits: Record<string, number> = {}, modules = ['knowledge', 'broadcasts']) => store.db.$executeRaw`UPDATE "PortalProfile"
    SET "planSnapshot"=${JSON.stringify({ id: 'p', name: 'Plan', modules, limits: { broadcasts: 4, broadcastRecipients: 2000, ...limits } })}::jsonb WHERE "accountId"=${shop.accountId}`;
  await plan();
  await store.db.$executeRaw`UPDATE "PortalProfile" SET "broadcastsAllowed"=true WHERE "accountId"=${shop.accountId}`;
  await store.db.$executeRaw`INSERT INTO "WhatsAppBusinessNumber"(id,"tenantId","accountId","phoneNumberId","wabaId",status,enabled,transport,"updatedAt")
    VALUES (${randomUUID()},${shop.tenantId},${shop.accountId},'pn-official','waba-1','CONNECTED',true,'META_CLOUD',NOW())`;
  await store.db.$executeRaw`INSERT INTO "WhatsAppBusinessNumber"(id,"tenantId","accountId","phoneNumberId","wabaId",status,enabled,transport,"updatedAt")
    VALUES (${randomUUID()},${shop.tenantId},${shop.accountId},'qr:abc','waba-1','CONNECTED',true,'QR',NOW())`;
  const sends: Array<{ to: string; name: string; params: string[] }> = [];
  let failNext = 0;
  const channel: BroadcastChannel = {
    listTemplates: async () => templates,
    sendTemplateMessage: async ({ to, template }) => {
      if (failNext > 0) { failNext--; return { success: false, error: 'rate limited', isRetryable: true, retryAfterSeconds: 0 }; }
      sends.push({ to, name: template.name, params: (template.components?.[0]?.parameters || []).map(p => String(p.text)) });
      return { success: true, providerMessageId: 'wamid.' + sends.length };
    }
  };
  return { database, store, shop, other, actor, sends, channel, plan, failNext: (n: number) => { failNext = n; } };
}

describe('broadcasts', () => {
  const previous = process.env.BROADCAST_REQUIRE_APPROVAL;
  afterEach(() => { if (previous === undefined) delete process.env.BROADCAST_REQUIRE_APPROVAL; else process.env.BROADCAST_REQUIRE_APPROVAL = previous; });

  it('sends an approved template only to opted-in customers, after admin approval, and honours STOP', async () => {
    const t = await setup();
    try {
      const broadcasts = new PortalBroadcasts(t.store, t.channel);
      await expect(broadcasts.importConsent(t.shop.tenantId, t.shop.accountId, t.actor, { phones: ['0612345678'], evidence: 'Checkout box', confirmed: false }))
        .rejects.toMatchObject({ code: 'CONSENT_CONFIRMATION_REQUIRED' });
      const imported = await broadcasts.importConsent(t.shop.tenantId, t.shop.accountId, t.actor,
        { phones: ['0612345678', '+212 7 00 00 00 01', '00212600000002', 'not a phone'], evidence: 'Ticked the box at checkout', confirmed: true });
      expect(imported).toMatchObject({ added: 3, skippedOptOut: 0, invalid: ['not a phone'] });
      // A customer without consent is never targeted.
      await t.store.db.$executeRaw`INSERT INTO "Customer"(id,"tenantId","externalId","updatedAt") VALUES (${randomUUID()},${t.shop.tenantId},'212699999999',NOW())`;

      const synced = await broadcasts.syncTemplates(t.shop.tenantId, t.shop.accountId);
      const approved = synced.find(x => x.name === 'promo_eid')!, pending = synced.find(x => x.name === 'draft_offer')!;
      expect(approved).toMatchObject({ status: 'APPROVED', variableCount: 2 });
      await expect(broadcasts.estimate(t.shop.tenantId, t.shop.accountId, { templateId: pending.id })).rejects.toMatchObject({ code: 'TEMPLATE_NOT_APPROVED' });

      const estimate = await broadcasts.estimate(t.shop.tenantId, t.shop.accountId, { templateId: approved.id });
      expect(estimate).toMatchObject({ recipients: 3, unitPriceUsd: 0.0414, estimatedCostUsd: 0.1242, category: 'MARKETING' });

      await expect(broadcasts.create(t.shop.tenantId, t.shop.accountId, t.actor, { templateId: approved.id, phoneNumberId: 'qr:abc', variables: ['20%', 'Friday'] }))
        .rejects.toMatchObject({ code: 'OFFICIAL_NUMBER_REQUIRED' });
      await expect(broadcasts.create(t.shop.tenantId, t.shop.accountId, t.actor, { templateId: approved.id, phoneNumberId: 'pn-official', variables: ['20%'] }))
        .rejects.toMatchObject({ code: 'TEMPLATE_VARIABLES_REQUIRED' });
      const created = await broadcasts.create(t.shop.tenantId, t.shop.accountId, t.actor, { templateId: approved.id, phoneNumberId: 'pn-official', variables: ['20%', 'Friday'] });
      expect(created).toMatchObject({ status: 'PENDING_APPROVAL', recipientCount: 3, pending: 3 });

      // Nothing leaves before approval, and other clients cannot see it.
      expect(await broadcasts.tick()).toBe(0);
      expect(await broadcasts.list(t.other.tenantId, t.other.accountId)).toEqual([]);

      const admin = randomUUID();
      await broadcasts.review(admin, created.id, true, 'ok');
      expect(await broadcasts.handleInbound(t.shop.tenantId, t.shop.accountId, '212700000001', 'STOP')).toBe(true);
      expect(await broadcasts.handleInbound(t.shop.tenantId, t.shop.accountId, '212612345678', 'stop by tomorrow?')).toBe(false);

      await broadcasts.tick();
      const done = await broadcasts.get(t.shop.tenantId, t.shop.accountId, created.id);
      expect(done).toMatchObject({ status: 'COMPLETED', sent: 2, skipped: 1, failed: 0, pending: 0 });
      expect(t.sends.map(s => s.to).sort()).toEqual(['212600000002', '212612345678']);
      expect(t.sends[0]).toMatchObject({ name: 'promo_eid', params: ['20%', 'Friday'] });

      // A customer who said STOP is not re-subscribed by a later import.
      const again = await broadcasts.importConsent(t.shop.tenantId, t.shop.accountId, t.actor, { phones: ['0700000001'], evidence: 'Re-import list', confirmed: true });
      expect(again).toMatchObject({ added: 0, skippedOptOut: 1 });
      expect(await broadcasts.consentSummary(t.shop.tenantId, t.shop.accountId)).toEqual({ optedIn: 2, optedOut: 1 });
    } finally { await t.database.pg.close(); }
  });

  it('retries a temporary send failure and can be cancelled', async () => {
    const t = await setup();
    try {
      process.env.BROADCAST_REQUIRE_APPROVAL = 'false';
      const broadcasts = new PortalBroadcasts(t.store, t.channel);
      await broadcasts.importConsent(t.shop.tenantId, t.shop.accountId, t.actor, { phones: ['0612345678', '0612345679'], evidence: 'Shop sign-up form', confirmed: true });
      const [approved] = (await broadcasts.syncTemplates(t.shop.tenantId, t.shop.accountId)).filter(x => x.status === 'APPROVED');
      const created = await broadcasts.create(t.shop.tenantId, t.shop.accountId, t.actor, { templateId: approved.id, phoneNumberId: 'pn-official', variables: ['10%', 'Sunday'] });
      expect(created.status).toBe('SENDING');
      t.failNext(1);
      await broadcasts.tick(1);
      await t.store.db.$executeRaw`UPDATE "BroadcastRecipient" SET "leaseUntil"=NOW()-INTERVAL '1 second' WHERE status='PENDING'`;
      await broadcasts.tick();
      expect(await broadcasts.get(t.shop.tenantId, t.shop.accountId, created.id)).toMatchObject({ status: 'COMPLETED', sent: 2, failed: 0 });

      const second = await broadcasts.create(t.shop.tenantId, t.shop.accountId, t.actor, { templateId: approved.id, phoneNumberId: 'pn-official', variables: ['5%', 'Monday'] });
      await broadcasts.cancel(t.shop.tenantId, t.shop.accountId, t.actor, second.id);
      await broadcasts.tick();
      expect(await broadcasts.get(t.shop.tenantId, t.shop.accountId, second.id)).toMatchObject({ status: 'CANCELLED', sent: 0, skipped: 2 });
    } finally { await t.database.pg.close(); }
  });

  it('needs the plan module and the administrator switch, and enforces monthly limits', async () => {
    const t = await setup();
    try {
      process.env.BROADCAST_REQUIRE_APPROVAL = 'false';
      const broadcasts = new PortalBroadcasts(t.store, t.channel);
      await broadcasts.importConsent(t.shop.tenantId, t.shop.accountId, t.actor, { phones: ['0612345678', '0612345679', '0612345670'], evidence: 'Shop sign-up form', confirmed: true });
      const [approved] = (await broadcasts.syncTemplates(t.shop.tenantId, t.shop.accountId)).filter(x => x.status === 'APPROVED');
      const send = () => broadcasts.create(t.shop.tenantId, t.shop.accountId, t.actor, { templateId: approved.id, phoneNumberId: 'pn-official', variables: ['10%', 'Sunday'] });

      await t.store.db.$executeRaw`UPDATE "PortalProfile" SET "broadcastsAllowed"=false WHERE "accountId"=${t.shop.accountId}`;
      await expect(send()).rejects.toMatchObject({ code: 'BROADCASTS_NOT_ENABLED' });
      await t.plan({}, ['knowledge']);
      await expect(send()).rejects.toMatchObject({ code: 'BROADCASTS_NOT_INCLUDED' });
      await expect(t.store.setBroadcastsAllowed(t.actor, t.shop.accountId, true)).rejects.toMatchObject({ code: 'BROADCASTS_PLAN_REQUIRED' });

      await t.plan({ broadcasts: 1, broadcastRecipients: 2 });
      await t.store.setBroadcastsAllowed(t.actor, t.shop.accountId, true);
      await expect(send()).rejects.toMatchObject({ code: 'BROADCAST_RECIPIENT_LIMIT_REACHED' });
      await t.plan({ broadcasts: 1, broadcastRecipients: 10 });
      const first = await send();
      expect((await broadcasts.allowance(t.shop.tenantId, t.shop.accountId))).toMatchObject({ used: { broadcasts: 1, recipients: 3 }, remaining: { broadcasts: 0, recipients: 7 } });
      await expect(send()).rejects.toMatchObject({ code: 'BROADCAST_LIMIT_REACHED' });

      // A broadcast cancelled before anything went out gives its allowance back.
      await broadcasts.cancel(t.shop.tenantId, t.shop.accountId, t.actor, first.id);
      expect((await broadcasts.allowance(t.shop.tenantId, t.shop.accountId)).used).toEqual({ broadcasts: 0, recipients: 0 });

      // Turning broadcasts off stops one in progress.
      const second = await send();
      await t.store.setBroadcastsAllowed(t.actor, t.shop.accountId, false);
      await broadcasts.tick();
      expect(await broadcasts.get(t.shop.tenantId, t.shop.accountId, second.id)).toMatchObject({ status: 'CANCELLED', sent: 0 });
      expect(t.sends).toHaveLength(0);
    } finally { await t.database.pg.close(); }
  });

  it('recognises opt-out replies and Moroccan phone formats', () => {
    for (const text of ['STOP', 'stop.', 'وقف', 'nlghi', 'Désabonner', 'ما بغيتش']) expect(isOptOutMessage(text), text).toBe(true);
    for (const text of ['stop the order?', 'chhal had stop', 'وقف عندي فالمحل']) expect(isOptOutMessage(text), text).toBe(false);
    expect(normalizeWaId('06 12 34 56 78')).toBe('212612345678');
    expect(normalizeWaId('+33 6 12 34 56 78')).toBe('33612345678');
    expect(normalizeWaId('123')).toBeNull();
  });
});
