import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';
import { portalDatabase } from '../helpers/portal-db';
import { PortalStaffActions } from '../../src/portal/PortalStaffActions';
import { PortalLeads } from '../../src/portal/PortalLeads';

describe('staff action boundaries and correction flow', () => {
  let database: Awaited<ReturnType<typeof portalDatabase>>;
  let actions: PortalStaffActions;
  let a: { tenant: string; account: string; user: string; conversation: string; answer: string };
  let b: typeof a;
  const create = async (name: string) => {
    const tenant = randomUUID(), account = randomUUID(), user = randomUUID(), customer = randomUUID(), conversation = randomUUID();
    const question = randomUUID(), answer = randomUUID();
    await database.db.$executeRaw`INSERT INTO "Tenant"(id,name,"updatedAt") VALUES (${tenant},${name},NOW())`;
    await database.db.$executeRaw`INSERT INTO "Account"(id,"tenantId",name,"updatedAt") VALUES (${account},${tenant},${name},NOW())`;
    await database.db.$executeRaw`INSERT INTO "PortalUser"(id,email,name,"passwordHash","verifiedAt") VALUES (${user},${`${user}@example.com`},${name},'hash',NOW())`;
    await database.db.$executeRaw`INSERT INTO "PortalMembership"("userId","tenantId","accountId") VALUES (${user},${tenant},${account})`;
    await database.db.$executeRaw`INSERT INTO "Customer"(id,"tenantId","externalId","updatedAt") VALUES (${customer},${tenant},${name},NOW())`;
    await database.db.$executeRaw`INSERT INTO "Conversation"(id,"tenantId","accountId","customerId",status,"humanRequested","updatedAt") VALUES (${conversation},${tenant},${account},${customer},'HANDOFF_REQUESTED',true,NOW())`;
    await database.db.$executeRaw`INSERT INTO "Message"(id,"tenantId","conversationId",role,content,"createdAt") VALUES (${question},${tenant},${conversation},'USER','What time do you open?',NOW()-INTERVAL '1 second')`;
    await database.db.$executeRaw`INSERT INTO "Message"(id,"tenantId","conversationId",role,content,"createdAt") VALUES (${answer},${tenant},${conversation},'ASSISTANT','We open at midnight.',NOW())`;
    return { tenant, account, user, conversation, answer };
  };

  beforeAll(async () => {
    database = await portalDatabase();
    const store: any = { db: database.db, audit: async () => {}, transaction: (fn: any) => database.db.$transaction((db: any) => fn({ db, audit: async () => {} })) };
    actions = new PortalStaffActions(store, async () => {});
    a = await create('First'); b = await create('Second');
  });
  afterAll(async () => { await database?.pg.close(); });

  it('shows each account only its own actions', async () => {
    const first = await actions.queue(a.tenant, a.account);
    expect(first.handoffs.map(item => item.id)).toEqual([a.conversation]);
    expect(first.handoffs.map(item => item.id)).not.toContain(b.conversation);
  });

  it('accepts only AI answers in the same account and keeps one review per answer', async () => {
    await expect(actions.report(a.tenant, a.account, b.conversation, b.answer, a.user, 'Wrong hours')).rejects.toMatchObject({ code: 'AI_MESSAGE_NOT_FOUND' });
    const first = await actions.report(a.tenant, a.account, a.conversation, a.answer, a.user, 'Wrong hours');
    const retry = await actions.report(a.tenant, a.account, a.conversation, a.answer, a.user, 'Wrong hours');
    expect(retry.id).toBe(first.id);
    const review = (await actions.feedback(a.tenant, a.account))[0];
    expect(review.question).toBe('What time do you open?');
    expect(review.answer).toBe('We open at midnight.');
    expect(await actions.feedback(b.tenant, b.account)).toEqual([]);
  });

  it('requires a published retest before a correction can be closed', async () => {
    const id = (await actions.feedback(a.tenant, a.account))[0].id;
    await expect(actions.resolve(a.tenant, a.account, id, a.user, 'Corrected hours in business data')).rejects.toMatchObject({ code: 'PUBLISHED_RETEST_REQUIRED' });
    await actions.retest(a.tenant, a.account, id, a.user, 'draft', 'We open at 9 AM.');
    await expect(actions.resolve(a.tenant, a.account, id, a.user, 'Corrected hours in business data')).rejects.toMatchObject({ code: 'PUBLISHED_RETEST_REQUIRED' });
    await actions.retest(a.tenant, a.account, id, a.user, 'published', 'We open at 9 AM.');
    await actions.resolve(a.tenant, a.account, id, a.user, 'Corrected hours in business data');
    expect((await actions.feedback(a.tenant, a.account))[0].status).toBe('RESOLVED');
  });

  it('sends each recent action once to the account member and does not replay it', async () => {
    const sent: string[] = [];
    const previous = { key: process.env.RESEND_API_KEY, from: process.env.PORTAL_MAIL_FROM, url: process.env.PORTAL_PUBLIC_URL };
    process.env.RESEND_API_KEY = 'test-key'; process.env.PORTAL_MAIL_FROM = 'Relayqo <test@example.test>';
    process.env.PORTAL_PUBLIC_URL = 'https://app.example.test';
    try {
      await database.db.$executeRaw`INSERT INTO "PortalProfile"("accountId","tenantId",status,draft) VALUES (${a.account},${a.tenant},'ACTIVE','{}'::jsonb)`;
      await database.db.$executeRaw`UPDATE "Conversation" SET "humanRequestedAt"=NOW()-INTERVAL '1 second' WHERE id=${a.conversation}`;
      const customer = (await database.db.$queryRaw<any[]>`SELECT "customerId" FROM "Conversation" WHERE id=${a.conversation}`)[0].customerId;
      const leadId = randomUUID();
      await database.db.$executeRaw`INSERT INTO "Lead"(id,"tenantId","accountId","customerId",status,"followUpAt","createdAt","updatedAt")
        VALUES (${leadId},${a.tenant},${a.account},${customer},'NEW',NOW()-INTERVAL '1 minute',NOW()-INTERVAL '1 second',NOW())`;
      const store: any = { db: database.db, audit: async () => {}, transaction: (fn: any) => database.db.$transaction((db: any) => fn({ db, audit: async () => {} })) };
      const worker = new PortalStaffActions(store, async alert => { sent.push(`${alert.kind}:${alert.sourceId}:${alert.recipientId}`); });
      await worker.tick(); await worker.tick();
      expect(sent.sort()).toEqual([`FOLLOW_UP:${leadId}:${a.user}`,`HANDOFF:${a.conversation}:${a.user}`,`REQUEST:${leadId}:${a.user}`].sort());
    } finally {
      if (previous.key === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = previous.key;
      if (previous.from === undefined) delete process.env.PORTAL_MAIL_FROM; else process.env.PORTAL_MAIL_FROM = previous.from;
      if (previous.url === undefined) delete process.env.PORTAL_PUBLIC_URL; else process.env.PORTAL_PUBLIC_URL = previous.url;
    }
  });

  it('rejects request assignment to a member of another account', async () => {
    const store: any = { db: database.db, audit: async () => {}, transaction: (fn: any) => database.db.$transaction((db: any) => fn({ db, audit: async () => {} })) };
    const lead = (await database.db.$queryRaw<any[]>`SELECT id FROM "Lead" WHERE "accountId"=${a.account}`)[0];
    await expect(new PortalLeads(store).update(a.tenant,a.account,lead.id,a.user,{assignedToUserId:b.user})).rejects.toMatchObject({code:'ASSIGNEE_NOT_IN_ACCOUNT'});
    const updated = await new PortalLeads(store).update(a.tenant,a.account,lead.id,a.user,{assignedToUserId:a.user});
    expect(updated.assigneeName).toBe('First');
  });

  it('catches up after downtime, retries delivery, and cancels a closed follow-up', async () => {
    const previous = { key: process.env.RESEND_API_KEY, from: process.env.PORTAL_MAIL_FROM, url: process.env.PORTAL_PUBLIC_URL };
    process.env.RESEND_API_KEY='test-key';process.env.PORTAL_MAIL_FROM='test@example.com';process.env.PORTAL_PUBLIC_URL='https://app.example.test';
    try {
      const customer = (await database.db.$queryRaw<any[]>`SELECT "customerId" FROM "Conversation" WHERE id=${a.conversation}`)[0].customerId;
      const id=randomUUID();
      await database.db.$executeRaw`UPDATE "PortalStaffAlertCursor" SET "scannedThrough"=NOW()-INTERVAL '3 hours' WHERE id='staff-alerts'`;
      await database.db.$executeRaw`INSERT INTO "Lead"(id,"tenantId","accountId","customerId",status,"followUpAt","createdAt","updatedAt")
        VALUES (${id},${a.tenant},${a.account},${customer},'CONTACTED',NOW()-INTERVAL '2 hours',NOW()-INTERVAL '4 hours',NOW()-INTERVAL '4 hours')`;
      const store:any={db:database.db,audit:async()=>{},transaction:(fn:any)=>database.db.$transaction((db:any)=>fn({db,audit:async()=>{}}))};
      let tries=0;
      const worker=new PortalStaffActions(store,async()=>{tries++;throw new Error('Simulated provider failure');});
      await worker.tick();
      const retry=(await database.db.$queryRaw<any[]>`SELECT * FROM "PortalActionAlert" WHERE "sourceId"=${id}`)[0];
      expect(retry.status).toBe('PENDING');expect(retry.attempts).toBe(1);expect(tries).toBe(1);
      await database.db.$executeRaw`UPDATE "Lead" SET status='DONE' WHERE id=${id}`;
      await database.db.$executeRaw`UPDATE "PortalActionAlert" SET "nextAttemptAt"=NOW() WHERE id=${retry.id}`;
      await worker.tick();
      expect(tries).toBe(1);
      expect((await database.db.$queryRaw<any[]>`SELECT status FROM "PortalActionAlert" WHERE id=${retry.id}`)[0].status).toBe('CANCELLED');
    } finally {
      if(previous.key===undefined)delete process.env.RESEND_API_KEY;else process.env.RESEND_API_KEY=previous.key;
      if(previous.from===undefined)delete process.env.PORTAL_MAIL_FROM;else process.env.PORTAL_MAIL_FROM=previous.from;
      if(previous.url===undefined)delete process.env.PORTAL_PUBLIC_URL;else process.env.PORTAL_PUBLIC_URL=previous.url;
    }
  });
});
