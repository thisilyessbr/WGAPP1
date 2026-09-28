import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { InstagramService } from '../../src/domain/channel/instagram/InstagramService';
import { SecretBox } from '../../src/core/security/SecretBox';
import { WhatsAppWorker } from '../../src/domain/channel/whatsapp/WhatsAppWorker';
import { PortalStore } from '../../src/portal/PortalStore';
import { PortalBudget } from '../../src/portal/PortalBudget';
import { validatePlan } from '../../src/portal/validation';
import { portalDatabase } from '../../tests/helpers/portal-db';
import { QrSessionManager } from '../../src/domain/channel/routing/QrSessionManager';
import { QrWebTransport } from '../../src/domain/channel/routing/QrWebTransport';
import { validateAdminConfig } from '../../src/portal/validation';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

describe('additional security boundaries',()=>{
  it('does not deliver twice when another Instagram worker reclaims an expired generation lease',async()=>{
    const database=await portalDatabase(),store=new PortalStore(database.db);
    const owner=await store.register(randomUUID()+'@example.test','IG Lease','hash',null),id=randomUUID();
    await store.db.$executeRaw`INSERT INTO "InstagramInboundJob"(id,"tenantId","accountId","instagramUserId","senderId","messageId",text,"updatedAt") VALUES (${id},${owner.tenantId},${owner.accountId},'1234567890','2222222222',${randomUUID()},'Hello',NOW())`;
    const connection={instagramUserId:'1234567890',accountId:owner.accountId,tenantId:owner.tenantId,enabled:true,status:'CONNECTED'};
    const db={$queryRaw:store.db.$queryRaw,instagramInboundJob:{
      updateMany:async({where,data}:any)=>{
        const rows=await store.db.$queryRaw<any[]>`UPDATE "InstagramInboundJob" SET status=COALESCE(${data.status||null},status),
          "responseText"=CASE WHEN ${data.responseText!==undefined} THEN ${data.responseText??null} ELSE "responseText" END,
          "leaseUntil"=CASE WHEN ${data.leaseUntil!==undefined} THEN ${data.leaseUntil??null} ELSE "leaseUntil" END
          WHERE id=${where.id||id} AND status=${where.status}
            AND (${where.attempts??null}::integer IS NULL OR attempts=${where.attempts??null})
            AND (${where.leaseUntil?.gt??null}::timestamptz IS NULL OR "leaseUntil">${where.leaseUntil?.gt??null})
            AND (${where.leaseUntil?.lt??null}::timestamptz IS NULL OR "leaseUntil"<${where.leaseUntil?.lt??null}) RETURNING id`;
        return {count:rows.length};
      },
      update:async({data}:any)=>store.db.$executeRaw`UPDATE "InstagramInboundJob" SET status=COALESCE(${data.status||null},status),
        "responseText"=CASE WHEN ${data.responseText!==undefined} THEN ${data.responseText??null} ELSE "responseText" END,
        "leaseUntil"=CASE WHEN ${data.leaseUntil!==undefined} THEN ${data.leaseUntil??null} ELSE "leaseUntil" END WHERE id=${id}`},
      instagramConnection:{findFirst:async()=>connection,findUnique:async()=>connection},portalProfile:{findUnique:async()=>({...owner,status:'ACTIVE',instagramAllowed:true,planSnapshot:{modules:['instagram']}})}};
    let enter!:()=>void,release!:()=>void,calls=0;const entered=new Promise<void>(r=>enter=r),gate=new Promise<void>(r=>release=r);
    const engine={getConversationService:()=>({getLatestConversation:async()=>({status:'ACTIVE'})}),handleMessage:async()=>{if(++calls===1){enter();await gate;}return 'Answer';},recordOutboundAssistantMessage:async()=>{}};
    const a=new InstagramService(db as any,engine as any,{box:new SecretBox({key:'audit-only'})}),b=new InstagramService(db as any,engine as any,{box:new SecretBox({key:'audit-only'})});
    const sendA=vi.spyOn(a,'sendText').mockResolvedValue('sent-a'),sendB=vi.spyOn(b,'sendText').mockResolvedValue('sent-b');
    const first=a.tick();
    try{await entered;await store.db.$executeRaw`UPDATE "InstagramInboundJob" SET "leaseUntil"=NOW()-INTERVAL '1 second' WHERE id=${id}`;
      await b.tick();release();await first;expect(sendA.mock.calls.length+sendB.mock.calls.length).toBe(1);
    }finally{release();await first;await database.pg.close();}
  },60000);
  it('rejects a stale QR routing snapshot after connection ownership changes',async()=>{
    const original={id:'qr-connection',tenantId:'tenant-a',accountId:'account-a',provider:'QR_WEB',enabled:true,status:'CONNECTED'};
    const refreshed={...original,tenantId:'tenant-b',accountId:'account-b'};
    const db={channelConnection:{findUnique:async()=>refreshed},portalProfile:{findUnique:async()=>({tenantId:'tenant-b',status:'ACTIVE',qrAllowed:true,qrConsentAt:new Date(),planSnapshot:{modules:['qr']}})},
      qrContactWindow:{findUnique:async()=>({lastInboundAt:new Date()})},$transaction:async(fn:any)=>fn({$queryRaw:async()=>[{count:1}]})};
    const manager=new QrSessionManager(db as any,{isEmergencyQrStopped:async()=>false} as any,{} as any,new SecretBox({key:'qr-audit-only'}),true);
    const send=vi.fn(async()=>({key:{id:'sent'}}));
    (manager as any).sessions.set(original.id,{socket:{sendMessage:send}});
    (manager as any).ownership.owns=async()=>true;
    const transport=new QrWebTransport(manager);
    await transport.sendText({tenantId:original.tenantId,accountId:original.accountId,connection:original,number:{phoneNumberId:'qr:test'},to:'212608477191',text:'Private answer for account A'} as any);
    expect(send).not.toHaveBeenCalled();
  });
  it('blocks manual Instagram sending for a suspended account',async()=>{
    const db={portalProfile:{findUnique:async()=>({tenantId:'t',status:'SUSPENDED',instagramAllowed:true,planSnapshot:{modules:['instagram']}})},
      instagramConnection:{findFirst:async()=>({tenantId:'t',accountId:'a',instagramUserId:'1234567890',enabled:true,status:'CONNECTED'})}};
    const service=new InstagramService(db as any,undefined,{box:new SecretBox({key:'audit-only'})});
    const send=vi.spyOn(service,'sendText').mockResolvedValue('sent');
    await service.sendManual('a','t','instagram:1234567890:2222222222','Hello').catch(()=>{});
    expect(send).not.toHaveBeenCalled();
  });
  it('evaluates nested workflow patterns without blocking the shared Node process',()=>{
    const pattern='^(a+)+$';
    const accepted=validateAdminConfig({workflows:{ask:{initialState:'ask',states:{ask:{type:'collect',fieldName:'name',field:{type:'string',pattern}}}}}});
    expect(accepted.workflows).toBeTruthy();
    const modulePath=resolve('dist/src/core/engine/FieldValidator.js');
    const code=`const {FieldValidator}=require(${JSON.stringify(modulePath)});new FieldValidator().validate('a'.repeat(28)+'!',{type:'string',pattern:${JSON.stringify(pattern)}});`;
    // Isolate a potentially blocking regex in a child and kill it after two seconds.
    let terminated=false;
    try{execFileSync(process.execPath,['-e',code],{timeout:2000,stdio:'pipe'});}catch(error:any){if(error.code==='ETIMEDOUT')terminated=true;else throw error;}
    expect(terminated).toBe(false);
  });
});

// Audit probes: these assert required safeguards. Failures reproduce missing safeguards.
describe('second audit: Instagram changes while a reply is generated', () => {
  async function probe(change: 'human' | 'suspended' | 'owner') {
    let status = 'ACTIVE', human = false;
    const connection = { instagramUserId: '1234567890', accountId: 'a', tenantId: 't', enabled: true, status: 'CONNECTED' };
    const current = { ...connection };
    const db = {
      $queryRaw: vi.fn(async () => [{ id: 'job', accountId: 'a', tenantId: 't', instagramUserId: '1234567890', senderId: '2222222222', messageId: 'mid', text: 'Hi', responseText: null, attempts: 1 }]),
      instagramInboundJob: { updateMany: vi.fn(async () => ({count:1})), update: vi.fn(async () => ({})) },
      instagramConnection: { findFirst: vi.fn(async () => connection), findUnique: vi.fn(async () => current) },
      portalProfile: { findUnique: vi.fn(async () => ({ accountId: 'a', tenantId: 't', status, instagramAllowed: true, planSnapshot: { modules: ['instagram'] } })) }
    };
    const getLatestConversation = vi.fn(async () => ({ status: human ? 'HUMAN_ACTIVE' : 'AI_ACTIVE' }));
    const engine = {
      getConversationService: () => ({ getLatestConversation }),
      handleMessage: vi.fn(async () => {
        if (change === 'human') human = true;
        if (change === 'suspended') status = 'SUSPENDED';
        if (change === 'owner') Object.assign(current, { accountId: 'b', tenantId: 'other-tenant' });
        return 'Private answer belonging to account a';
      }),
      recordOutboundAssistantMessage: vi.fn(async () => {})
    };
    const service = new InstagramService(db as any, engine as any, { box: new SecretBox({ key: 'audit-only' }) });
    const send = vi.spyOn(service, 'sendText').mockResolvedValue('provider-id');
    await service.tick();
    return send;
  }
  it.each(['human','suspended','owner'] as const)('suppresses sending after %s changes during generation', async change => {
    expect(await probe(change)).not.toHaveBeenCalled();
  });
});

describe('second audit: actual PostgreSQL budget and downgrade boundaries', () => {
  let database: Awaited<ReturnType<typeof portalDatabase>>, store: PortalStore, budget: PortalBudget;
  beforeAll(async () => { database = await portalDatabase(); store = new PortalStore(database.db); budget = new PortalBudget(store); },60000);
  afterAll(async () => { budget?.dispose(); await database?.pg.close(); });
  it('does not call the paid voice provider after the account has exhausted its allowance',async()=>{
    const owner = await store.register(randomUUID()+'@example.test','Audio','hash',null);
    const plan = await store.savePlan(owner.userId,validatePlan({name:'Exhausted',modules:['knowledge'],limits:{messages:0,monthlyUsd:0}}));
    const p = await store.profile(owner.accountId);
    await store.updateAccount(owner.userId,owner.accountId,p.revision,{planId:plan.id});
    await store.db.$executeRaw`UPDATE "PortalProfile" SET status='ACTIVE',"voiceNotesAllowed"=true,"voiceNotesEnabled"=true WHERE "accountId"=${owner.accountId}`;
    const transcribe = vi.fn(async()=>({text:'Hello',durationSeconds:30}));
    const engine = {handleMessage: (..._args:any[]) => budget.runTurn(owner.tenantId,owner.accountId,'wamid-budget',async()=> 'response','')};
    const worker = new WhatsAppWorker({registerHandler:()=>{}} as any,engine as any,
      {downloadInboundAudio:async()=>({bytes:Buffer.from([1]),mimeType:'audio/ogg'})} as any,
      undefined,undefined,undefined,undefined,
      {enabled:async()=> 'groq',transcriber:{transcribe},recordUsage:async()=>{}});
    await worker.processJob({id:'job',wamid:'wamid-budget',tenantId:owner.tenantId,accountId:owner.accountId,waId:'customer',phoneNumberId:'123',rawType:'audio',message:JSON.stringify({mediaId:'987'})} as any);
    expect(transcribe).not.toHaveBeenCalled();
  });
  it('rejects a storage downgrade when existing product photos exceed the new ceiling',async()=>{
    const owner = await store.register(randomUUID()+'@example.test','Photos','hash',null);
    const plan = await store.savePlan(owner.userId,validatePlan({name:'Photos',modules:['commerce'],limits:{storageMb:5}}));
    let p = await store.profile(owner.accountId);
    p = await store.updateAccount(owner.userId,owner.accountId,p.revision,{planId:plan.id});
    await store.db.$executeRaw`INSERT INTO "PortalProductImage"(id,"accountId",filename,hash,bytes,size,width,height) VALUES (${randomUUID()},${owner.accountId},'stored.jpg','hash',${Buffer.alloc(2*1048576)},${2*1048576},100,100)`;
    await expect(store.updateAccount(owner.userId,owner.accountId,p.revision,{limitOverrides:{storageMb:1}})).rejects.toMatchObject({code:'DOWNGRADE_REQUIRES_REVIEW'});
    const smaller=await store.savePlan(owner.userId,validatePlan({name:'Smaller',modules:['commerce'],limits:{storageMb:1}}));
    await expect(store.updateAccount(owner.userId,owner.accountId,p.revision,{planId:smaller.id})).rejects.toMatchObject({code:'DOWNGRADE_REQUIRES_REVIEW'});
  });
});
