import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { portalDatabase } from '../helpers/portal-db';
import { PortalStore } from '../../src/portal/PortalStore';
import { ConversationService } from '../../src/domain/conversation/ConversationService';
import { PortalAuth, hashToken } from '../../src/portal/PortalAuth';
import { createPortalRouter } from '../../src/portal/PortalRouter';

describe('multi-number conversation ownership', () => {
  it('keeps one customer and account in separate active threads by receiving number', async () => {
    const database = await portalDatabase();
    try {
      const store = new PortalStore(database.db);
      const owner = await store.register(`${randomUUID()}@example.test`, 'Two-number test', 'hash', null);
      const sql = database.db;
      const prisma = {
        customer: { upsert: async ({ where, create }: any) => {
          await sql.$executeRaw`INSERT INTO "Customer"(id,"tenantId","externalId","updatedAt") VALUES (${randomUUID()},${create.tenantId},${create.externalId},NOW()) ON CONFLICT("tenantId","externalId") DO NOTHING`;
          return (await sql.$queryRaw<any[]>`SELECT * FROM "Customer" WHERE "tenantId"=${where.tenantId_externalId.tenantId} AND "externalId"=${where.tenantId_externalId.externalId}`)[0];
        } },
        account: { findUnique: async ({ where }: any) => (await sql.$queryRaw<any[]>`SELECT * FROM "Account" WHERE id=${where.id}`)[0] },
        $transaction: async (fn: any) => sql.$transaction((tx: any) => fn({
          $executeRaw: tx.$executeRaw,
          conversation: {
            findFirst: async ({ where }: any) => (await tx.$queryRaw<any[]>`SELECT * FROM "Conversation" WHERE "tenantId"=${where.tenantId} AND "customerId"=${where.customerId} AND "accountId"=${where.accountId} AND "sourcePhoneNumberId" IS NOT DISTINCT FROM ${where.sourcePhoneNumberId} AND status IN ('ACTIVE','HANDOFF_REQUESTED','HUMAN_ACTIVE') AND "automationCapped"=false ORDER BY "createdAt" DESC LIMIT 1`)[0] || null,
            create: async ({ data }: any) => {
              const id = randomUUID();
              await tx.$executeRaw`INSERT INTO "Conversation"(id,"tenantId","accountId","customerId","sourcePhoneNumberId","updatedAt") VALUES (${id},${data.tenantId},${data.accountId},${data.customerId},${data.sourcePhoneNumberId},NOW())`;
              return (await tx.$queryRaw<any[]>`SELECT * FROM "Conversation" WHERE id=${id}`)[0];
            }
          }
        }))
      };
      const service = new ConversationService(prisma as any);
      const first = await service.getOrCreateConversation(owner.tenantId, '212600000099', owner.accountId, 'meta-first');
      const second = await service.getOrCreateConversation(owner.tenantId, '212600000099', owner.accountId, 'meta-second');
      const firstAgain = await service.getOrCreateConversation(owner.tenantId, '212600000099', owner.accountId, 'meta-first');
      expect(first.id).not.toBe(second.id);
      expect(firstAgain.id).toBe(first.id);
      const rows = await sql.$queryRaw<any[]>`SELECT "sourcePhoneNumberId" FROM "Conversation" WHERE "accountId"=${owner.accountId} ORDER BY "sourcePhoneNumberId"`;
      expect(rows.map(row => row.sourcePhoneNumberId)).toEqual(['meta-first', 'meta-second']);
    } finally { await database.pg.close(); }
  });

  it('keeps legacy unknown-source threads separate from a newly identified number', async () => {
    const findFirst = vi.fn(async () => null);
    const create = vi.fn(async ({ data }: any) => ({ id: randomUUID(), ...data }));
    const prisma = {
      customer: { upsert: vi.fn(async () => ({ id: 'customer' })) },
      account: { findUnique: vi.fn(async () => ({ id: 'account', tenantId: 'tenant' })) },
      $transaction: async (fn: any) => fn({ $executeRaw: async () => 1, conversation: { findFirst, create } })
    };
    await new ConversationService(prisma as any).getOrCreateConversation('tenant', 'customer', 'account', 'number-b');
    expect(findFirst.mock.calls[0][0].where.sourcePhoneNumberId).toBe('number-b');
    expect(create.mock.calls[0][0].data.sourcePhoneNumberId).toBe('number-b');
  });

  it('routes a human reply only through the receiving number, even when another was updated later', async () => {
    const database = await portalDatabase();
    try {
      const store = new PortalStore(database.db);
      const owner = await store.register(`${randomUUID()}@example.test`, 'Inbox test', 'hash', null);
      await store.db.$executeRaw`UPDATE "PortalUser" SET "verifiedAt"=NOW() WHERE id=${owner.userId}`;
      const first = `meta-${randomUUID()}`, second = `meta-${randomUUID()}`;
      const customerId = randomUUID(), conversationId = randomUUID(), otherConversationId = randomUUID();
      await store.db.$executeRaw`INSERT INTO "Customer"(id,"tenantId","externalId","updatedAt") VALUES (${customerId},${owner.tenantId},'212600000099',NOW())`;
      await store.db.$executeRaw`INSERT INTO "Conversation"(id,"tenantId","accountId","customerId","sourcePhoneNumberId",status,"updatedAt") VALUES (${conversationId},${owner.tenantId},${owner.accountId},${customerId},${first},'HUMAN_ACTIVE',NOW())`;
      await store.db.$executeRaw`INSERT INTO "Message"(id,"tenantId","conversationId",role,content,"phoneNumberId") VALUES (${randomUUID()},${owner.tenantId},${conversationId},'USER','Hi',${first})`;
      await store.db.$executeRaw`INSERT INTO "Conversation"(id,"tenantId","accountId","customerId","sourcePhoneNumberId",status,"updatedAt") VALUES (${otherConversationId},${owner.tenantId},${owner.accountId},${customerId},${second},'ACTIVE',NOW())`;
      await store.db.$executeRaw`INSERT INTO "Message"(id,"tenantId","conversationId",role,content,"phoneNumberId") VALUES (${randomUUID()},${owner.tenantId},${otherConversationId},'USER','Other number',${second})`;
      for (const number of [first, second]) await store.db.$executeRaw`INSERT INTO "WhatsAppBusinessNumber"(id,"tenantId","accountId","phoneNumberId",status,enabled,"updatedAt") VALUES (${randomUUID()},${owner.tenantId},${owner.accountId},${number},'CONNECTED',true,NOW())`;
      const raw = randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '');
      const csrf = randomUUID();
      await store.newSession(owner.userId, hashToken(raw), csrf, new Date(Date.now() + 60000));
      const enqueue = vi.fn(async () => ({}));
      const app = express(); app.use(express.json());
      app.use('/api', createPortalRouter({ store, auth: new PortalAuth(store, { publicUrl: 'http://localhost' }), connections: {} as any, documents: { list: async () => [] } as any }, {
        prisma: {},
        conversationAutomationService: { getOwnershipState: async () => 'HUMAN_ACTIVE' } as any,
        whatsAppOutboundQueue: { enqueue } as any
      }));
      const headers = { Cookie: `relayqo_portal=${raw}`, 'X-CSRF-Token': csrf, Origin: 'http://localhost' };
      const dashboard = await request(app).get('/api/client/dashboard').set(headers);
      expect(dashboard.status).toBe(200);
      expect(dashboard.body.metrics.numbers.map((n: any) => n.phoneNumberId).sort()).toEqual([first, second].sort());
      const firstList = await request(app).get(`/api/client/conversations?phoneNumberId=${first}`).set(headers);
      expect(firstList.status).toBe(200);
      expect(firstList.body.conversations.map((c: any) => c.id)).toEqual([conversationId]);
      expect(firstList.body.conversations[0].sourcePhoneNumberId).toBe(first);
      const secondList = await request(app).get(`/api/client/conversations?phoneNumberId=${second}`).set(headers);
      expect(secondList.body.conversations.map((c: any) => c.id)).toEqual([otherConversationId]);
      const detail = await request(app).get(`/api/client/conversations/${conversationId}`).set(headers);
      expect(detail.body.conversation.sourcePhoneNumberId).toBe(first);
      expect(detail.body.messages[0].phoneNumberId).toBe(first);
      const send = () => request(app).post(`/api/client/conversations/${conversationId}/messages`).set(headers).send({ text: 'I can help' });
      expect((await send()).status).toBe(201);
      expect(enqueue.mock.calls[0][0].phoneNumberId).toBe(first);
      await store.db.$executeRaw`UPDATE "WhatsAppBusinessNumber" SET enabled=false WHERE "phoneNumberId"=${first}`;
      const blocked = await send();
      expect(blocked.status).toBe(400);
      expect(blocked.body.error).toBe('NO_CONNECTED_PHONE_NUMBER');
      expect(enqueue).toHaveBeenCalledTimes(1);
      const legacyId = randomUUID();
      await store.db.$executeRaw`INSERT INTO "Conversation"(id,"tenantId","accountId","customerId",status,"updatedAt") VALUES (${legacyId},${owner.tenantId},${owner.accountId},${customerId},'HUMAN_ACTIVE',NOW())`;
      await store.db.$executeRaw`INSERT INTO "Message"(id,"tenantId","conversationId",role,content) VALUES (${randomUUID()},${owner.tenantId},${legacyId},'USER','Unknown source')`;
      const legacyReply = await request(app).post(`/api/client/conversations/${legacyId}/messages`).set(headers).send({ text: 'Must not guess the number' });
      expect(legacyReply.status).toBe(409);
      expect(legacyReply.body.error).toBe('SOURCE_NUMBER_UNKNOWN');
      expect(enqueue).toHaveBeenCalledTimes(1);
    } finally { await database.pg.close(); }
  });
});
