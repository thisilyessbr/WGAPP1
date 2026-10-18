import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { portalDatabase } from '../helpers/portal-db';
import { PortalStore } from '../../src/portal/PortalStore';
import { pilotMetrics } from '../../src/portal/PilotMetrics';

describe('pilot metrics', () => {
  it('scores each active client on delivery, handoffs, outcomes and flagged answers, without previews or other clients', async () => {
    const database = await portalDatabase();
    try {
      const store = new PortalStore(database.db);
      const shop = await store.register(randomUUID() + '@example.test', 'Shop', 'hash', null);
      const draft = await store.register(randomUUID() + '@example.test', 'Draft shop', 'hash', null);
      await store.db.$executeRaw`UPDATE "PortalProfile" SET status='ACTIVE' WHERE "accountId"=${shop.accountId}`;

      const customer = randomUUID(), preview = randomUUID();
      await store.db.$executeRaw`INSERT INTO "Customer"(id,"tenantId","externalId","updatedAt") VALUES (${customer},${shop.tenantId},'212600000001',NOW())`;
      await store.db.$executeRaw`INSERT INTO "Customer"(id,"tenantId","externalId","updatedAt") VALUES (${preview},${shop.tenantId},'portal-preview:x',NOW())`;
      const conversation = randomUUID();
      await store.db.$executeRaw`INSERT INTO "Conversation"(id,"tenantId","accountId","customerId","updatedAt") VALUES (${conversation},${shop.tenantId},${shop.accountId},${customer},NOW())`;
      await store.db.$executeRaw`INSERT INTO "Conversation"(id,"tenantId","accountId","customerId","updatedAt") VALUES (${randomUUID()},${shop.tenantId},${shop.accountId},${customer},NOW())`;
      await store.db.$executeRaw`INSERT INTO "Conversation"(id,"tenantId","accountId","customerId","updatedAt") VALUES (${randomUUID()},${shop.tenantId},${shop.accountId},${preview},NOW())`;

      for (const outbound of ['SENT', 'SENT', 'SENT', 'FAILED']) {
        await store.db.$executeRaw`INSERT INTO "WhatsAppMessageJob"(id,wamid,"partitionKey","tenantId","accountId","phoneNumberId","waId",message,timestamp,status,"outboundStatus","updatedAt")
          VALUES (${randomUUID()},${randomUUID()},'p',${shop.tenantId},${shop.accountId},'n','212600000001','hi',${BigInt(Date.now())},'COMPLETED',${outbound},NOW())`;
      }
      for (const type of ['HANDOFF_REQUESTED', 'LEAD_CREATED', 'LEAD_CREATED', 'ORDER_CONFIRMED', 'QUESTION_MISSED']) {
        await store.db.$executeRaw`INSERT INTO "OutcomeEvent"(id,"tenantId","accountId",type,source,"idempotencyKey") VALUES (${randomUUID()},${shop.tenantId},${shop.accountId},${type},'test',${randomUUID()})`;
      }
      await store.db.$executeRaw`INSERT INTO "OutcomeEvent"(id,"tenantId","accountId",type,source,"idempotencyKey","occurredAt") VALUES (${randomUUID()},${shop.tenantId},${shop.accountId},'ORDER_CONFIRMED','test',${randomUUID()},NOW()-INTERVAL '60 days')`;
      const user = (await store.db.$queryRaw<any[]>`SELECT "userId" FROM "PortalMembership" WHERE "accountId"=${shop.accountId}`)[0].userId;
      const answer = randomUUID();
      await store.db.$executeRaw`INSERT INTO "Message"(id,"tenantId","conversationId",role,content) VALUES (${answer},${shop.tenantId},${conversation},'ASSISTANT','We open at midnight.')`;
      await store.db.$executeRaw`INSERT INTO "PortalAnswerFeedback"(id,"tenantId","accountId","conversationId","messageId","reportedById",question,answer,note)
        VALUES (${randomUUID()},${shop.tenantId},${shop.accountId},${conversation},${answer},${user},'When do you open?','We open at midnight.','Wrong hours')`;

      const rows = await pilotMetrics(store.db, 30);
      expect(rows.map(row => row.accountId)).toEqual([shop.accountId]);
      expect(rows[0]).toMatchObject({
        name: 'Shop', conversations: 2, inbound: 4, repliesSent: 3, repliesFailed: 1, deliveryRate: 0.75,
        handoffs: 1, handoffRate: 0.5, leads: 2, orders: 1, missedQuestions: 1, flaggedAnswers: 1, openFlags: 1
      });
      expect(draft.accountId).not.toBe(shop.accountId);
    } finally { await database.pg.close(); }
  });
});
