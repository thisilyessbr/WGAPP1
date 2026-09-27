import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { portalDatabase } from '../helpers/portal-db';
import { PortalStore } from '../../src/portal/PortalStore';
import { PortalAuth, hashToken } from '../../src/portal/PortalAuth';
import { createPortalRouter } from '../../src/portal/PortalRouter';

describe('client lead workspace under realistic account data', () => {
  let database: Awaited<ReturnType<typeof portalDatabase>>;
  let store: PortalStore;
  let app: express.Express;
  let first: { userId: string; tenantId: string; accountId: string };
  let second: typeof first;
  let firstHeaders: Record<string, string>;
  let secondHeaders: Record<string, string>;

  async function headers(userId: string) {
    const raw = randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '');
    const csrf = randomUUID();
    await store.newSession(userId, hashToken(raw), csrf, new Date(Date.now() + 600_000));
    return { Cookie: `relayqo_portal=${raw}`, 'X-CSRF-Token': csrf, Origin: 'http://localhost' };
  }

  async function customer(account: typeof first, externalId: string, metadata: Record<string, unknown> = {}) {
    const id = randomUUID();
    await store.db.$executeRaw`INSERT INTO "Customer"(id,"tenantId","externalId",metadata,"updatedAt") VALUES (${id},${account.tenantId},${externalId},${JSON.stringify(metadata)}::jsonb,NOW())`;
    return id;
  }

  async function conversation(account: typeof first, customerId: string, content?: string) {
    const id = randomUUID();
    await store.db.$executeRaw`INSERT INTO "Conversation"(id,"tenantId","accountId","customerId","updatedAt") VALUES (${id},${account.tenantId},${account.accountId},${customerId},NOW())`;
    if (content) await store.db.$executeRaw`INSERT INTO "Message"(id,"tenantId","conversationId",role,content,"createdAt") VALUES (${randomUUID()},${account.tenantId},${id},'USER',${content},NOW())`;
    return id;
  }

  async function lead(account: typeof first, customerId: string, status: string, options: { interest?: string; followUpAt?: Date; conversationId?: string } = {}) {
    const id = randomUUID();
    await store.db.$executeRaw`INSERT INTO "Lead"(id,"tenantId","accountId","customerId",status,interest,"followUpAt","sourceConversationId","updatedAt") VALUES (${id},${account.tenantId},${account.accountId},${customerId},${status},${options.interest || null},${options.followUpAt || null},${options.conversationId || null},NOW())`;
    return id;
  }

  beforeAll(async () => {
    database = await portalDatabase();
    store = new PortalStore(database.db);
    first = await store.register(`${randomUUID()}@example.test`, 'First', 'test-hash', null);
    second = await store.register(`${randomUUID()}@example.test`, 'Second', 'test-hash', null);
    await store.db.$executeRaw`UPDATE "PortalUser" SET "verifiedAt"=NOW() WHERE id IN (${first.userId},${second.userId})`;
    firstHeaders = await headers(first.userId);
    secondHeaders = await headers(second.userId);
    app = express();
    app.use(express.json());
    const auth = new PortalAuth(store, { publicUrl: 'http://localhost' });
    app.use('/api', createPortalRouter({ store, auth, documents: {} as any, connections: {} as any }, {} as any));
  }, 60_000);

  afterAll(async () => { await database?.pg.close(); });

  it('isolates leads, excludes previews, and links the newest account conversation', async () => {
    const aCustomer = await customer(first, '212600100001', { name: 'Amina' });
    const bCustomer = await customer(second, '212600100002', { name: 'Karim' });
    const previewCustomer = await customer(first, 'portal-preview:lead-test');
    const oldConversation = await conversation(first, aCustomer, 'Old question');
    const newConversation = await conversation(first, aCustomer, 'Bghit nchri');
    const aLead = await lead(first, aCustomer, 'NEW', { interest: 'Bghit nchri', conversationId: oldConversation });
    const bLead = await lead(second, bCustomer, 'NEW');
    const previewLead = await lead(first, previewCustomer, 'NEW');

    const list = await request(app).get('/api/client/leads').set(firstHeaders);
    expect(list.status).toBe(200);
    expect(list.body.leads.map((item: any) => item.id)).toContain(aLead);
    expect(list.body.leads.map((item: any) => item.id)).not.toContain(bLead);
    expect(list.body.leads.map((item: any) => item.id)).not.toContain(previewLead);
    const found = list.body.leads.find((item: any) => item.id === aLead);
    expect(found).toMatchObject({ customerPhone: '212600100001', interest: 'Bghit nchri', conversationId: newConversation, lastCustomerMessage: 'Bghit nchri' });
    expect(found.customerMetadata.name).toBe('Amina');
    expect((await request(app).get(`/api/client/leads/${aLead}`).set(secondHeaders)).status).toBe(404);
    expect((await request(app).patch(`/api/client/leads/${aLead}`).set(secondHeaders).send({ status: 'WON' })).status).toBe(404);
    expect((await request(app).get(`/api/client/leads/${previewLead}`).set(firstHeaders)).status).toBe(404);
    expect((await request(app).get('/api/client/leads/summary').set(firstHeaders)).body.new).toBe(1);
  });

  it('recovers the request that created a legacy inquiry without using later unrelated messages', async () => {
    const contact = await customer(first, '212600199999');
    const sourceConversation = await conversation(first, contact, 'I would like to book a lesson');
    const inquiryId = await lead(first, contact, 'NEW', { conversationId: sourceConversation });
    await store.db.$executeRaw`INSERT INTO "Message"(id,"tenantId","conversationId",role,content,"createdAt")
      VALUES (${randomUUID()},${first.tenantId},${sourceConversation},'USER','Unrelated later message',NOW() + INTERVAL '1 second')`;

    const detail = await request(app).get(`/api/client/leads/${inquiryId}`).set(firstHeaders);
    expect(detail.status).toBe(200);
    expect(detail.body.lead.sourceRequest).toBe('I would like to book a lesson');
    const list = await request(app).get('/api/client/leads').set(firstHeaders);
    expect(list.body.leads.find((item: any) => item.id === inquiryId).sourceRequest).toBe('I would like to book a lesson');
  });

  it('validates inputs and requires a client session and CSRF token for changes', async () => {
    const id = await lead(first, await customer(first, '212600100003'), 'NEW');
    expect((await request(app).get('/api/client/leads')).status).toBe(401);
    expect((await request(app).patch(`/api/client/leads/${id}`).set({ Cookie: firstHeaders.Cookie }).send({ status: 'WON' })).status).toBe(403);
    for (const body of [{}, { status: 'INVALID' }, { note: 'x'.repeat(2001) }, { followUpAt: 'tomorrow' }, { followUpAt: '2026-02-31T10:00:00Z' }, { followUpAt: '2026-09-25T10:00:00' }, { evil: true }]) {
      expect((await request(app).patch(`/api/client/leads/${id}`).set(firstHeaders).send(body)).status).toBe(400);
    }
    expect((await request(app).get('/api/client/leads?status=INVALID').set(firstHeaders)).status).toBe(400);
    expect((await request(app).get('/api/client/leads?limit=abc').set(firstHeaders)).status).toBe(400);
    expect((await request(app).get('/api/client/leads?offset=-1').set(firstHeaders)).body.pagination.offset).toBe(0);
  });

  it('tracks stages, due follow-ups, customer ticket, and closure', async () => {
    const id = await lead(first, await customer(first, '212600100004'), 'NEW');
    const due = new Date(Date.now() - 60_000).toISOString();
    const qualified = await request(app).patch(`/api/client/leads/${id}`).set(firstHeaders).send({ status: 'QUALIFIED', note: 'Call back', followUpAt: due, details: { request: 'English class', preferredTime: 'Saturday' } });
    expect(qualified.status).toBe(200);
    expect(qualified.body.lead).toMatchObject({ status: 'QUALIFIED', note: 'Call back', details: { request: 'English class', preferredTime: 'Saturday' } });
    const exportResponse = await request(app).get('/api/client/leads/export.csv').set(firstHeaders);
    expect(exportResponse.status).toBe(200);
    expect(exportResponse.text).toContain('English class');
    expect(exportResponse.text).toContain('Saturday');
    expect(new Date(qualified.body.lead.followUpAt).toISOString()).toBe(due);
    expect((await request(app).get('/api/client/leads/summary').set(firstHeaders)).body.dueFollowUps).toBeGreaterThanOrEqual(1);
    await request(app).patch(`/api/client/leads/${id}`).set(firstHeaders).send({ status: 'CONTACTED' }).expect(200);
    await request(app).patch(`/api/client/leads/${id}`).set(firstHeaders).send({ status: 'QUALIFIED' }).expect(200);
    const won = await request(app).patch(`/api/client/leads/${id}`).set(firstHeaders).send({ status: 'WON', followUpAt: null, note: '' });
    expect(won.status).toBe(200);
    expect(won.body.lead).toMatchObject({ status: 'WON', note: null, followUpAt: null });
    expect(won.body.lead.closedAt).toBeTruthy();
    const summary = (await request(app).get('/api/client/leads/summary').set(firstHeaders)).body;
    expect(summary.won).toBeGreaterThanOrEqual(1);
    const reopened = await request(app).patch(`/api/client/leads/${id}`).set(firstHeaders).send({ status: 'NEW' });
    expect(reopened.status).toBe(200);
    expect(reopened.body.lead.closedAt).toBeNull();
  });

  it('filters and paginates without exposing another account', async () => {
    const customerIds = await Promise.all(Array.from({ length: 23 }, (_, n) => customer(first, `2126002${String(n).padStart(5, '0')}`)));
    for (const id of customerIds) await lead(first, id, 'LOST');
    const page1 = (await request(app).get('/api/client/leads?status=LOST&limit=20').set(firstHeaders)).body;
    const page2 = (await request(app).get('/api/client/leads?status=LOST&limit=20&offset=20').set(firstHeaders)).body;
    expect(page1.leads).toHaveLength(20);
    expect(page2.leads).toHaveLength(3);
    expect(page1.pagination).toMatchObject({ total: 23, hasMore: true });
    expect(page2.pagination.hasMore).toBe(false);
    expect(new Set([...page1.leads, ...page2.leads].map((item: any) => item.id)).size).toBe(23);
    expect((await request(app).get('/api/client/leads?status=LOST').set(secondHeaders)).body.leads).toHaveLength(0);
  });
});
