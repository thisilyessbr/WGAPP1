import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { portalDatabase } from '../helpers/portal-db';
import { PortalStore } from '../../src/portal/PortalStore';
import { PortalProductImages } from '../../src/portal/PortalProductImages';
import { validatePlan } from '../../src/portal/validation';
import { PortalLeads } from '../../src/portal/PortalLeads';
import { CRMService } from '../../src/domain/crm/CRMService';

describe('project audit: persistent isolation and product photos', () => {
  let database: Awaited<ReturnType<typeof portalDatabase>>, store: PortalStore, photos: PortalProductImages;
  let owner: any, other: any, plan: any;
  beforeAll(async () => {
    database = await portalDatabase(); store = new PortalStore(database.db); photos = new PortalProductImages(store);
    owner = await store.register(randomUUID()+'@example.test', 'Shop', 'test-hash', null);
    other = await store.register(randomUUID()+'@example.test', 'Other', 'test-hash', null);
    plan = await store.savePlan(owner.userId, validatePlan({ name: 'Shop', modules: ['commerce','knowledge'], limits: { storageMb: 5 } }));
    for (const account of [owner,other]) {
      const profile = await store.profile(account.accountId);
      await store.updateAccount(owner.userId,account.accountId,profile.revision,{planId:plan.id});
    }
  },60000);
  afterAll(async () => { await database?.pg.close(); });
  const photo = () => sharp({ create: { width: 40, height: 30, channels: 3, background: '#ff0000' } }).png().toBuffer();

  it('protects drafts, validates ownership and publishes stable photo URLs', async () => {
    const uploaded = await photos.upload(owner.userId,owner.accountId,'test.png',await photo());
    expect(await photos.upload(owner.userId,owner.accountId,'duplicate.png',await photo())).toMatchObject({id:uploaded.id,reused:true});
    expect((await photos.read(uploaded.id,owner.accountId)).length).toBeGreaterThan(0);
    await expect(photos.read(uploaded.id,other.accountId)).rejects.toMatchObject({code:'IMAGE_NOT_FOUND'});
    await expect(photos.read(uploaded.id,undefined,true)).rejects.toMatchObject({code:'IMAGE_NOT_FOUND'});
    let p=await store.profile(owner.accountId);
    const product={sku:'PHOTO-1',name:'Shoes',description:'Red shoes',price:100,stock:4,category:'Shoes',variants:[],imageIds:[uploaded.id]};
    let foreign=await store.profile(other.accountId);
    await expect(store.saveDraft(other.userId,other.accountId,other.tenantId,{...foreign.draft,products:[product]},foreign.revision)).rejects.toMatchObject({code:'IMAGE_UNAVAILABLE'});
    p=await store.saveDraft(owner.userId,owner.accountId,owner.tenantId,{...p.draft,description:'Shoes in Morocco',products:[product]},p.revision);
    p=await store.publish(owner.userId,owner.accountId,p.revision);
    const catalog=await store.db.$queryRaw<any[]>`SELECT metadata FROM "Product" WHERE "accountId"=${owner.accountId} AND active=true`;
    expect(catalog[0].metadata.images[0]).toContain('/api/product-images/'+uploaded.id);
    expect((await photos.read(uploaded.id,undefined,true)).length).toBeGreaterThan(0);
    p=await store.setEditingFrozen(owner.userId,owner.accountId,true);
    await expect(photos.upload(owner.userId,owner.accountId,'new.png',await photo())).rejects.toMatchObject({code:'CLIENT_EDITING_FROZEN'});
    await expect(photos.remove(owner.userId,owner.accountId,uploaded.id)).rejects.toMatchObject({code:'CLIENT_EDITING_FROZEN'});
    await expect(photos.remove(owner.userId,owner.accountId,uploaded.id,true)).rejects.toMatchObject({code:'IMAGE_IN_USE'});
    await expect(photos.upload(owner.userId,other.accountId,'script.svg',Buffer.from('<svg/>'))).rejects.toMatchObject({code:'INVALID_IMAGE'});
  });

  it('excludes UUID-linked preview conversations from statistics and requests',async()=>{
    const customerId=randomUUID(),conversationId=randomUUID();
    await store.db.$executeRaw`INSERT INTO "Customer"(id,"tenantId","externalId","updatedAt") VALUES (${customerId},${other.tenantId},'portal-preview:audit',NOW())`;
    await store.db.$executeRaw`INSERT INTO "Conversation"(id,"tenantId","accountId","customerId","updatedAt") VALUES (${conversationId},${other.tenantId},${other.accountId},${customerId},NOW())`;
    await store.db.$executeRaw`INSERT INTO "Message"(id,"tenantId","conversationId",role,content) VALUES (${randomUUID()},${other.tenantId},${conversationId},'USER','Preview only')`;
    await store.db.$executeRaw`INSERT INTO "Lead"(id,"tenantId","accountId","customerId",status,"updatedAt") VALUES (${randomUUID()},${other.tenantId},${other.accountId},${customerId},'NEW',NOW())`;
    const metrics=await store.stats(other.accountId,other.tenantId);
    expect(metrics.totals.conversations).toBe(0);
    expect(metrics.daily).toHaveLength(0);
    expect((await new PortalLeads(store).list(other.tenantId,other.accountId,'ALL',20,0)).leads).toHaveLength(0);
  });

  it('retains closed requests, reuses open requests, and separates completed orders',async()=>{
    const customerId=randomUUID();
    await store.db.$executeRaw`INSERT INTO "Customer"(id,"tenantId","externalId","updatedAt") VALUES (${customerId},${owner.tenantId},'repeat-customer',NOW())`;
    const adapter=(db:any):any=>({
      $queryRaw: db.$queryRaw,
      $transaction: (fn:any)=>db.$transaction((tx:any)=>fn(adapter(tx))),
      lead:{
        findFirst: async ({where:w}:any)=>(await db.$queryRaw`SELECT * FROM "Lead"
          WHERE "tenantId"=${w.tenantId} AND "accountId"=${w.accountId} AND "customerId"=${w.customerId}
          AND (${w.sourceWorkflowSessionId===undefined} OR "sourceWorkflowSessionId" IS NOT DISTINCT FROM ${w.sourceWorkflowSessionId??null})
          AND (${w.sourceConversationId===undefined} OR "sourceConversationId" IS NOT DISTINCT FROM ${w.sourceConversationId??null})
          AND (${!w.status} OR status IN ('NEW','CONTACTED','QUALIFIED')) ORDER BY "createdAt" DESC LIMIT 1`)[0]||null,
        create: async ({data:d}:any)=>(await db.$queryRaw`INSERT INTO "Lead"(id,"tenantId","accountId","customerId",status,interest,"signalReason","sourceConversationId","sourceWorkflowSessionId","updatedAt")
          VALUES (${randomUUID()},${d.tenantId},${d.accountId},${d.customerId},${d.status},${d.interest},${d.signalReason},${d.sourceConversationId},${d.sourceWorkflowSessionId},NOW()) RETURNING *`)[0],
        update: async ({where,data}:any)=>(await db.$queryRaw`UPDATE "Lead" SET "sourceWorkflowSessionId"=${data.sourceWorkflowSessionId},"signalReason"=${data.signalReason||null} WHERE id=${where.id} RETURNING *`)[0]
      }
    });
    const crm=new CRMService(adapter(store.db));
    const first=await crm.upsertLead(owner.tenantId,owner.accountId,customerId);
    expect((await crm.upsertLead(owner.tenantId,owner.accountId,customerId)).id).toBe(first.id);
    await store.db.$executeRaw`UPDATE "Lead" SET status='WON' WHERE id=${first.id}`;
    const second=await crm.upsertLead(owner.tenantId,owner.accountId,customerId);
    expect(second.id).not.toBe(first.id);
    const session=randomUUID();
    expect((await crm.upsertLead(owner.tenantId,owner.accountId,customerId,'NEW',{workflowSessionId:session})).id).toBe(second.id);
    await store.db.$executeRaw`UPDATE "Lead" SET status='DONE' WHERE id=${second.id}`;
    expect((await crm.upsertLead(owner.tenantId,owner.accountId,customerId,'NEW',{workflowSessionId:session})).id).toBe(second.id);
    const third=await crm.upsertLead(owner.tenantId,owner.accountId,customerId,'NEW',{workflowSessionId:randomUUID()});
    expect(third.id).not.toBe(second.id);
    const history=await store.db.$queryRaw<any[]>`SELECT status FROM "Lead" WHERE "customerId"=${customerId}`;
    expect(history.map(x=>x.status).sort()).toEqual(['DONE','NEW','WON']);
    await expect(crm.upsertLead(other.tenantId,owner.accountId,customerId)).rejects.toThrow('CRM_ACCOUNT_CUSTOMER_MISMATCH');
  });

  it('backfills only unambiguous completed sales requests, never incidental support sessions',async()=>{
    for (const [reason, workflowCount] of [['COMPLETED_SALES_WORKFLOW',1],['PURCHASE_INTENT',1],['COMPLETED_SALES_WORKFLOW',2]] as const) {
      const customerId=randomUUID(), conversationId=randomUUID(), leadId=randomUUID();
      await store.db.$executeRaw`INSERT INTO "Customer"(id,"tenantId","externalId","updatedAt") VALUES (${customerId},${other.tenantId},${customerId},NOW())`;
      await store.db.$executeRaw`INSERT INTO "Conversation"(id,"tenantId","accountId","customerId","updatedAt") VALUES (${conversationId},${other.tenantId},${other.accountId},${customerId},NOW())`;
      await store.db.$executeRaw`INSERT INTO "Lead"(id,"tenantId","accountId","customerId",status,"signalReason","updatedAt") VALUES (${leadId},${other.tenantId},${other.accountId},${customerId},'NEW',${reason},NOW())`;
      for(let n=0;n<workflowCount;n++) await store.db.$executeRaw`INSERT INTO "WorkflowSession"(id,"tenantId","conversationId","workflowId","stateId",status,"collectedData","updatedAt") VALUES (${randomUUID()},${other.tenantId},${conversationId},'booking','done','COMPLETED','{}'::jsonb,NOW())`;
      await database.pg.exec(readFileSync('prisma/migrations/20260928010000_repeat_customer_requests/migration.sql','utf8'));
      const [row]=await store.db.$queryRaw<any[]>`SELECT "sourceWorkflowSessionId","sourceConversationId" FROM "Lead" WHERE id=${leadId}`;
      if(reason==='COMPLETED_SALES_WORKFLOW' && workflowCount===1) {
        expect(row.sourceWorkflowSessionId).toBeTruthy(); expect(row.sourceConversationId).toBe(conversationId);
      } else expect(row.sourceWorkflowSessionId).toBeNull();
    }
  });
});
