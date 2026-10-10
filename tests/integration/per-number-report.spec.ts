import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { portalDatabase } from '../helpers/portal-db';
import { PortalStore } from '../../src/portal/PortalStore';

describe('per-WhatsApp-number reporting', () => {
  it('attributes activity to the source number, even inside one shared conversation, and isolates clients', async () => {
    const database = await portalDatabase();
    try {
      const store = new PortalStore(database.db);
      const owner = await store.register(randomUUID()+'@example.test', 'First business', 'hash', null);
      const other = await store.register(randomUUID()+'@example.test', 'Second business', 'hash', null);
      const first = 'qr:'+randomUUID(), second = 'qr:'+randomUUID(), foreign = 'qr:'+randomUUID();
      for (const [account, number, label] of [[owner,first,'+212 600 000 001'],[owner,second,'+212 600 000 002'],[other,foreign,'+212 600 000 003']] as const) {
        await store.db.$executeRaw`INSERT INTO "WhatsAppBusinessNumber"(id,"tenantId","accountId","phoneNumberId","displayPhoneNumber",status,enabled,"updatedAt")
          VALUES (${randomUUID()},${account.tenantId},${account.accountId},${number},${label},'CONNECTED',true,NOW())`;
      }
      const customerId=randomUUID(), conversationId=randomUUID(), previewCustomerId=randomUUID(), previewConversationId=randomUUID();
      await store.db.$executeRaw`INSERT INTO "Customer"(id,"tenantId","externalId","updatedAt") VALUES (${customerId},${owner.tenantId},'212600000099',NOW())`;
      await store.db.$executeRaw`INSERT INTO "Conversation"(id,"tenantId","accountId","customerId","updatedAt") VALUES (${conversationId},${owner.tenantId},${owner.accountId},${customerId},NOW())`;
      await store.db.$executeRaw`INSERT INTO "Customer"(id,"tenantId","externalId","updatedAt") VALUES (${previewCustomerId},${owner.tenantId},'portal-preview:test',NOW())`;
      await store.db.$executeRaw`INSERT INTO "Conversation"(id,"tenantId","accountId","customerId","updatedAt") VALUES (${previewConversationId},${owner.tenantId},${owner.accountId},${previewCustomerId},NOW())`;
      for (const [number,role,conversation] of [[first,'USER',conversationId],[first,'ASSISTANT',conversationId],[second,'USER',conversationId],[second,'ASSISTANT',conversationId],[first,'USER',previewConversationId]] as const) {
        await store.db.$executeRaw`INSERT INTO "Message"(id,"tenantId","conversationId",role,content,"phoneNumberId") VALUES (${randomUUID()},${owner.tenantId},${conversation},${role},'test',${number})`;
      }
      for (const number of [first,second]) {
        await store.db.$executeRaw`INSERT INTO "Lead"(id,"tenantId","accountId","customerId",status,"sourcePhoneNumberId","updatedAt") VALUES (${randomUUID()},${owner.tenantId},${owner.accountId},${customerId},'NEW',${number},NOW())`;
      }
      await store.db.$executeRaw`INSERT INTO "WhatsAppMessageJob"(id,wamid,"partitionKey","tenantId","accountId","phoneNumberId","waId",message,timestamp,status,attempts,"outboundStatus","updatedAt")
        VALUES (${randomUUID()},${randomUUID()},'test',${owner.tenantId},${owner.accountId},${second},'212600000099','test',${BigInt(Date.now())},'FAILED',2,'FAILED',NOW())`;
      const report = await store.stats(owner.accountId,owner.tenantId,30);
      expect(report.numbers).toHaveLength(2);
      const byNumber=new Map(report.numbers.map(row=>[row.phoneNumberId,row]));
      expect(byNumber.get(first)).toMatchObject({inbound:1,replies:1,contacts:1,conversations:1,leads:1,failures:0,retries:0});
      expect(byNumber.get(second)).toMatchObject({inbound:1,replies:1,contacts:1,conversations:1,leads:1,failures:1,retries:1});
      expect(byNumber.has(foreign)).toBe(false);
      expect((await store.stats(other.accountId,other.tenantId,30)).numbers).toMatchObject([{phoneNumberId:foreign,inbound:0,leads:0}]);
    } finally { await database.pg.close(); }
  });
});
