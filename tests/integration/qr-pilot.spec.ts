import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { portalDatabase } from '../helpers/portal-db';
import { PortalStore } from '../../src/portal/PortalStore';
import { PortalConnections } from '../../src/portal/PortalConnections';
import { PortalAuth, hashToken } from '../../src/portal/PortalAuth';
import { createPortalRouter } from '../../src/portal/PortalRouter';
import { validateProcessConfig } from '../../src/runtime/shared';
import { validatePlan } from '../../src/portal/validation';
import { QrSessionOwnership } from '../../src/domain/channel/routing/QrSessionOwnership';
import { QrSessionManager } from '../../src/domain/channel/routing/QrSessionManager';
import { PrismaBaileysAuthStore } from '../../src/domain/channel/routing/PrismaBaileysAuthStore';
import { SecretBox } from '../../src/core/security/SecretBox';
import { qrEntitled, qrPhone, qrReconnectDelay } from '../../src/domain/channel/routing/QrPolicy';
import { QrWebTransport } from '../../src/domain/channel/routing/QrWebTransport';

const mock=vi.hoisted(()=>({sockets:[] as any[],make:vi.fn()}));
vi.mock('@whiskeysockets/baileys',()=>({
  default:mock.make,Browsers:{ubuntu:()=>['Test']},DisconnectReason:{loggedOut:401,connectionReplaced:440,badSession:500}
}));

describe('optional QR pilot controls and session ownership',()=>{
  let database:Awaited<ReturnType<typeof portalDatabase>>,store:PortalStore;
  const box=new SecretBox({key:'qr-pilot-tests'}),managers:QrSessionManager[]=[];
  beforeAll(async()=>{
    database=await portalDatabase();store=new PortalStore(database.db);
    vi.spyOn(PrismaBaileysAuthStore.prototype,'createState').mockImplementation(async()=>({state:{} as any,saveCreds:async()=>{},clear:async()=>{}}));
    mock.make.mockImplementation(()=>{
      const handlers=new Map<string,Function>(),socket={ev:{on:(event:string,handler:Function)=>handlers.set(event,handler)},
        handlers,user:{id:'212649402305:1@s.whatsapp.net'},end:vi.fn(),logout:vi.fn(async()=>{}),sendMessage:vi.fn(async()=>({key:{id:randomUUID()}}))};
      mock.sockets.push(socket);return socket;
    });
  },60000);
  afterAll(async()=>{for(const manager of managers)await manager.suspendAll();vi.restoreAllMocks();await database?.pg.close();});
  function adapter(db=store.db):any {
    return {
      $queryRaw:db.$queryRaw,$executeRaw:db.$executeRaw,$transaction:(fn:any)=>db.$transaction((tx:any)=>fn(adapter(tx))),
      portalProfile:{findUnique:async({where}:any)=>store.profile(where.accountId)},
      channelConnection:{findUnique:async({where}:any)=>(await db.$queryRaw<any[]>`SELECT * FROM "ChannelConnection" WHERE id=${where.id}`)[0]},
      qrSessionLease:{
        findUnique:async({where}:any)=>(await db.$queryRaw<any[]>`SELECT * FROM "QrSessionLease" WHERE "connectionId"=${where.connectionId}`)[0],
        deleteMany:async({where}:any)=>db.$executeRaw`DELETE FROM "QrSessionLease" WHERE "connectionId"=${where.connectionId} AND (${where.owner===undefined} OR owner=${where.owner||null})`,
        updateMany:async({where,data}:any)=>db.$executeRaw`UPDATE "QrSessionLease" SET "encryptedQr"=${data.encryptedQr},"qrExpiresAt"=${data.qrExpiresAt} WHERE "connectionId"=${where.connectionId} AND owner=${where.owner} AND "expiresAt">NOW()`
      },
      qrContactWindow:{findUnique:async({where}:any)=>(await db.$queryRaw<any[]>`SELECT * FROM "QrContactWindow" WHERE "connectionId"=${where.connectionId_recipient.connectionId} AND recipient=${where.connectionId_recipient.recipient}`)[0]},
      qrPhoneClaim:{upsert:async({create}:any)=>db.$executeRaw`INSERT INTO "QrPhoneClaim"(phone,"connectionId") VALUES (${create.phone},${create.connectionId}) ON CONFLICT("connectionId") DO UPDATE SET phone=EXCLUDED.phone`},
      whatsAppBusinessNumber:{
        updateMany:async({where,data}:any)=>db.$executeRaw`UPDATE "WhatsAppBusinessNumber" SET enabled=${data.enabled},status=${data.status},"displayPhoneNumber"=COALESCE(${data.displayPhoneNumber||null},"displayPhoneNumber") WHERE (${where.connectionId===undefined} OR "connectionId"=${where.connectionId||null}) AND (${where.transport===undefined} OR transport=${where.transport||null})`,
        findFirst:async({where}:any)=>(await db.$queryRaw<any[]>`SELECT * FROM "WhatsAppBusinessNumber" WHERE "connectionId"=${where.connectionId} AND "tenantId"=${where.tenantId} AND "accountId"=${where.accountId} AND enabled=true`)[0]
      }
    };
  }
  async function account(qr=true) {
    const owner=await store.register(randomUUID()+'@example.test','QR test','hash',null);
    const plan=await store.savePlan(owner.userId,validatePlan({name:'Test',modules:qr?['services','qr']:['services'],limits:{numbers:2}}));
    const p=await store.profile(owner.accountId);await store.updateAccount(owner.userId,owner.accountId,p.revision,{planId:plan.id});
    await store.db.$executeRaw`UPDATE "PortalProfile" SET status='APPROVED' WHERE "accountId"=${owner.accountId}`;
    return {...owner,principal:{accountId:owner.accountId,tenantId:owner.tenantId,user:{id:owner.userId,role:'CLIENT'}} as any};
  }
  async function connection(owner:any) {
    const id=randomUUID();await store.db.$executeRaw`INSERT INTO "ChannelConnection"(id,"tenantId","accountId",provider,"connectionKey",status,"updatedAt") VALUES (${id},${owner.tenantId},${owner.accountId},'QR_WEB',${id},'PENDING',NOW())`;
    await store.db.$executeRaw`INSERT INTO "WhatsAppBusinessNumber"(id,"tenantId","accountId","phoneNumberId",transport,"connectionId",enabled,status,"updatedAt") VALUES (${randomUUID()},${owner.tenantId},${owner.accountId},${'qr:'+id},'QR_WEB',${id},false,'PENDING',NOW())`;
    return id;
  }
  it('requires a QR plan, admin approval and explicit client acceptance',async()=>{
    const absent=await account(false);await expect(store.setQrAllowed(absent.userId,absent.accountId,true)).rejects.toMatchObject({code:'QR_PLAN_REQUIRED'});
    const owner=await account();
    const create=vi.fn(async()=>({connection:{id:await connection(owner)}}));
    const service=new PortalConnections(store,{qrSessionManager:{isEnabled:()=>true,createConnection:create,getQr:async()=>null}} as any);
    await expect(service.startQr(owner.principal,true)).rejects.toMatchObject({code:'QR_NOT_INCLUDED'});
    await store.setQrAllowed(owner.userId,owner.accountId,true);
    await expect(service.startQr(owner.principal)).rejects.toMatchObject({code:'QR_ACCEPTANCE_REQUIRED'});
    expect(create).not.toHaveBeenCalled();
    const linked=await service.startQr(owner.principal,true);expect(linked.connectionId).toBeTruthy();
    expect(qrEntitled(await store.profile(owner.accountId))).toBe(true);
    await store.setQrAllowed(owner.userId,owner.accountId,false);
    expect(qrEntitled(await store.profile(owner.accountId))).toBe(false);
    await expect(service.qr(owner.principal,linked.connectionId)).rejects.toMatchObject({code:'QR_NOT_INCLUDED'});
  });
  it('stores encrypted QR codes and leases a session to only one worker',async()=>{
    const owner=await account(),id=await connection(owner),a=new QrSessionOwnership(adapter(),box),b=new QrSessionOwnership(adapter(),box);
    expect(await a.claim(id)).toBe(true);expect(await b.claim(id)).toBe(false);
    await a.saveQr(id,'data:image/png;base64,test');
    const row=(await store.db.$queryRaw<any[]>`SELECT * FROM "QrSessionLease" WHERE "connectionId"=${id}`)[0];
    expect(row.encryptedQr).not.toContain('data:image');expect((await b.getQr(id))?.dataUrl).toBe('data:image/png;base64,test');
    await store.db.$executeRaw`UPDATE "QrSessionLease" SET "expiresAt"=NOW()-INTERVAL '1 second' WHERE "connectionId"=${id}`;
    expect(await a.renew(id)).toBe(false);expect(await b.claim(id)).toBe(true);expect(await a.owns(id)).toBe(false);expect(await b.getQr(id)).toBeNull();
    await a.release(id);expect(await b.owns(id)).toBe(true);
  });
  it('shares the number allowance with API connections and scopes QR access to its client',async()=>{
    const owner=await account(),other=await account(),official=await connection(owner);
    await store.db.$executeRaw`UPDATE "ChannelConnection" SET provider='META_CLOUD' WHERE id=${official}`;
    await store.db.$executeRaw`UPDATE "WhatsAppBusinessNumber" SET transport='META_CLOUD' WHERE "connectionId"=${official}`;
    await store.setQrAllowed(owner.userId,owner.accountId,true);
    const create=vi.fn(async()=>({connection:{id:await connection(owner)}}));
    const service=new PortalConnections(store,{qrSessionManager:{isEnabled:()=>true,createConnection:create,getQr:async()=>null},prisma:adapter()} as any);
    const linked=await service.startQr(owner.principal,true);
    await expect(service.startQr(owner.principal,true)).rejects.toMatchObject({code:'NUMBER_ALLOWANCE_REACHED'});expect(create).toHaveBeenCalledTimes(1);
    await store.setQrAllowed(other.userId,other.accountId,true);
    await store.db.$executeRaw`UPDATE "PortalProfile" SET "qrConsentAt"=NOW() WHERE "accountId"=${other.accountId}`;
    await expect(service.qr(other.principal,linked.connectionId)).rejects.toMatchObject({code:'CONNECTION_NOT_FOUND'});
    await expect(service.disconnectQr(other.principal,linked.connectionId)).rejects.toMatchObject({code:'CONNECTION_NOT_FOUND'});
  });
  it('allows multiple distinct QR numbers only when the admin raises the account allowance',async()=>{
    const owner=await account();
    let profile=await store.profile(owner.accountId);
    profile=await store.updateAccount(owner.userId,owner.accountId,profile.revision,{limitOverrides:{numbers:3}});
    expect(profile.planSnapshot?.limits.numbers).toBe(3);
    await store.setQrAllowed(owner.userId,owner.accountId,true);
    const create=vi.fn(async()=>({connection:{id:await connection(owner)}}));
    const service=new PortalConnections(store,{qrSessionManager:{isEnabled:()=>true,createConnection:create,getQr:async()=>null},prisma:adapter()} as any);
    const first=await service.startQr(owner.principal,true);
    const second=await service.startQr(owner.principal,true);
    const third=await service.startQr(owner.principal,true);
    expect(new Set([first.connectionId,second.connectionId,third.connectionId]).size).toBe(3);
    await expect(service.startQr(owner.principal,true)).rejects.toMatchObject({code:'NUMBER_ALLOWANCE_REACHED'});
    expect(create).toHaveBeenCalledTimes(3);
  });
  it('rejects unsupported split-process QR deployments',()=>{
    vi.stubEnv('ENABLE_QR_CHANNELS','true');
    vi.stubEnv('RUN_WORKER_IN_WEB','false');
    try {
      expect(()=>validateProcessConfig('web','test')).toThrow('single always-on web process');
      expect(()=>validateProcessConfig('worker','test')).toThrow('single always-on web process');
      vi.stubEnv('RUN_WORKER_IN_WEB','true');
      expect(()=>validateProcessConfig('web','test')).not.toThrow();
    } finally {vi.unstubAllEnvs();}
  });
  it('lets an administrator activate and pause one QR bot without disconnecting its number',async()=>{
    const owner=await account();await store.setQrAllowed(owner.userId,owner.accountId,true);
    await store.db.$executeRaw`UPDATE "PortalProfile" SET "qrConsentAt"=NOW() WHERE "accountId"=${owner.accountId}`;
    const first=await connection(owner),second=await connection(owner);
    await store.db.$executeRaw`UPDATE "ChannelConnection" SET status='CONNECTED',"botEnabled"=false WHERE id IN (${first},${second})`;
    await store.db.$executeRaw`UPDATE "WhatsAppBusinessNumber" SET status='CONNECTED' WHERE "connectionId" IN (${first},${second})`;
    const adminId=randomUUID();
    await store.db.$executeRaw`INSERT INTO "PortalUser"(id,email,name,"passwordHash",role,"verifiedAt") VALUES (${adminId},${randomUUID()+'@example.test'},'QR Admin','test-hash','ADMIN',NOW())`;
    const session=randomUUID().replaceAll('-','')+randomUUID().replaceAll('-',''),csrf=randomUUID();
    await store.newSession(adminId,hashToken(session),csrf,new Date(Date.now()+60000));
    const manager={isEnabled:()=>true,start:vi.fn(async()=>{})};
    const app=express();app.use(express.json());
    app.use('/api',createPortalRouter({store,auth:new PortalAuth(store,{publicUrl:'http://localhost'}),documents:{} as any,connections:{} as any},
      {prisma:adapter(),qrSessionManager:manager} as any));
    const headers={Cookie:'relayqo_portal='+session,'X-CSRF-Token':csrf,Origin:'http://localhost'};
    const url=`/api/admin/accounts/${owner.accountId}/connections/${first}`;
    expect((await request(app).patch(url).set(headers).send({enabled:true})).status).toBe(200);
    expect((await store.db.$queryRaw<any[]>`SELECT "botEnabled",enabled FROM "ChannelConnection" WHERE id=${first}`)[0]).toMatchObject({botEnabled:true,enabled:true});
    expect((await store.db.$queryRaw<any[]>`SELECT enabled FROM "WhatsAppBusinessNumber" WHERE "connectionId"=${first}`)[0].enabled).toBe(true);
    expect((await request(app).patch(url).set(headers).send({enabled:false})).status).toBe(200);
    expect((await store.db.$queryRaw<any[]>`SELECT "botEnabled",enabled FROM "ChannelConnection" WHERE id=${first}`)[0]).toMatchObject({botEnabled:false,enabled:true});
    expect((await store.db.$queryRaw<any[]>`SELECT enabled FROM "WhatsAppBusinessNumber" WHERE "connectionId"=${first}`)[0].enabled).toBe(false);
    expect((await store.db.$queryRaw<any[]>`SELECT "botEnabled" FROM "ChannelConnection" WHERE id=${second}`)[0].botEnabled).toBe(false);
    expect(manager.start).not.toHaveBeenCalled();
  });
  it('revokes QR when the admin removes it from the assigned plan',async()=>{
    const owner=await account();await store.setQrAllowed(owner.userId,owner.accountId,true);const id=await connection(owner);
    const standard=await store.savePlan(owner.userId,validatePlan({name:'API only',modules:['services'],limits:{numbers:2}}));
    const profile=await store.profile(owner.accountId);
    await store.updateAccount(owner.userId,owner.accountId,profile.revision,{planId:standard.id});
    expect((await store.profile(owner.accountId)).qrAllowed).toBe(false);
    expect((await store.db.$queryRaw<any[]>`SELECT enabled,status FROM "ChannelConnection" WHERE id=${id}`)[0]).toMatchObject({enabled:false,status:'PAUSED'});
  });
  async function running() {
    const owner=await account();await store.setQrAllowed(owner.userId,owner.accountId,true);
    await store.db.$executeRaw`UPDATE "PortalProfile" SET status='ACTIVE',"qrConsentAt"=NOW() WHERE "accountId"=${owner.accountId}`;
    const id=await connection(owner),queue={enqueue:vi.fn(async()=>{})};
    const numbers={isEmergencyQrStopped:async()=>false,updateConnectionStatus:async(cid:string,_tenant:string,status:string)=>{
      await store.db.$executeRaw`UPDATE "ChannelConnection" SET status=${status},enabled=${!['FAILED','SUSPENDED','DISCONNECTED'].includes(status)} WHERE id=${cid}`;
    }};
    const manager=new QrSessionManager(adapter(),numbers as any,queue as any,box,true);managers.push(manager);
    const previous=mock.make.mock.calls.length;await Promise.all([manager.start(id),manager.start(id)]);expect(mock.make.mock.calls.length-previous).toBe(1);
    const socket=mock.sockets.at(-1);socket.user.id=`${'212'+String(Date.now()).slice(-9)}:1@s.whatsapp.net`;
    await socket.handlers.get('connection.update')({connection:'open'});
    return {owner,id,manager,socket,queue};
  }
  it('blocks unsolicited replies, enforces shared limits and immediately respects revoked access',async()=>{
    const {owner,id,manager,socket}=await running(); const scope={tenantId:owner.tenantId,accountId:owner.accountId,phoneNumberId:`qr:${id}`};
    await expect(manager.send(id,'212608477191','hello',scope)).rejects.toThrow('QR_CUSTOMER_MESSAGE_REQUIRED');expect(socket.sendMessage).not.toHaveBeenCalled();
    await store.db.$executeRaw`INSERT INTO "QrContactWindow"("connectionId",recipient,"lastInboundAt") VALUES (${id},'212608477191',NOW())`;
    for(let n=0;n<4;n++)await manager.send(id,'212608477191','reply',scope);
    await expect(manager.send(id,'212608477191','loop',scope)).rejects.toThrow('QR_RATE_LIMIT');expect(socket.sendMessage).toHaveBeenCalledTimes(4);
    await store.setQrAllowed(owner.userId,owner.accountId,false);
    await expect(manager.send(id,'212608477191','reply',scope)).rejects.toThrow('QR_NOT_ALLOWED');expect(socket.sendMessage).toHaveBeenCalledTimes(4);
  });
  it('pauses chatbot replies per QR number without unlinking its live socket',async()=>{
    const {owner,id,manager,socket,queue}=await running();
    const scope={tenantId:owner.tenantId,accountId:owner.accountId,phoneNumberId:`qr:${id}`};
    const message={key:{remoteJid:'212608477191@s.whatsapp.net',id:'paused-message'},message:{conversation:'Salam'},messageTimestamp:Math.floor(Date.now()/1000)};
    await store.db.$executeRaw`UPDATE "ChannelConnection" SET "botEnabled"=false WHERE id=${id}`;
    await store.db.$executeRaw`UPDATE "WhatsAppBusinessNumber" SET enabled=false WHERE "connectionId"=${id}`;
    await socket.handlers.get('messages.upsert')({type:'notify',messages:[message]});
    expect(queue.enqueue).not.toHaveBeenCalled();
    await expect(manager.send(id,'212608477191','reply',scope)).rejects.toThrow('QR_NOT_ALLOWED');
    expect(socket.end).not.toHaveBeenCalled();
    await store.db.$executeRaw`UPDATE "ChannelConnection" SET "botEnabled"=true WHERE id=${id}`;
    await store.db.$executeRaw`UPDATE "WhatsAppBusinessNumber" SET enabled=true WHERE "connectionId"=${id}`;
    await socket.handlers.get('messages.upsert')({type:'notify',messages:[message]});
    expect(queue.enqueue).toHaveBeenCalledTimes(1);
  });
  it('ignores history, groups and unresolved device IDs and namespaces incoming message IDs',async()=>{
    const {id,socket,queue}=await running(),handler=socket.handlers.get('messages.upsert');
    const message={key:{remoteJid:'212608477191@s.whatsapp.net',id:'same-id'},message:{conversation:'Salam'},messageTimestamp:Math.floor(Date.now()/1000)};
    await handler({type:'append',messages:[message]});
    await handler({type:'notify',messages:[{...message,key:{...message.key,remoteJid:'123@g.us'}},{...message,key:{...message.key,remoteJid:'123@lid'}}]});
    expect(queue.enqueue).not.toHaveBeenCalled();
    await handler({type:'notify',messages:[message]});expect(queue.enqueue.mock.calls[0][0]).toMatchObject({wamid:`qr:${id}:same-id`,waId:'212608477191'});
  });
  it('does not retry a QR send with an unknown delivery outcome',async()=>{
    const transport=new QrWebTransport({send:async()=>{throw new Error('QR_SEND_OUTCOME_UNKNOWN');}} as any);
    expect(await transport.sendText({connection:{provider:'QR_WEB',id:'id'},to:'212608477191',text:'Hi'} as any)).toMatchObject({success:false,isRetryable:false});
  });
  it('refuses a number already owned by another connection without enabling its new mapping',async()=>{
    const first=await running(),second=await running();
    second.socket.user.id=first.socket.user.id;
    await second.socket.handlers.get('connection.update')({connection:'open'});
    expect((await store.db.$queryRaw<any[]>`SELECT enabled,status FROM "ChannelConnection" WHERE id=${second.id}`)[0]).toMatchObject({enabled:false,status:'FAILED'});
    expect((await store.db.$queryRaw<any[]>`SELECT enabled FROM "WhatsAppBusinessNumber" WHERE "connectionId"=${second.id}`)[0].enabled).toBe(false);
    expect((await store.db.$queryRaw<any[]>`SELECT enabled,status FROM "ChannelConnection" WHERE id=${first.id}`)[0]).toMatchObject({enabled:true,status:'CONNECTED'});
  });
  it('does not create a second socket on a competing worker and stops on logout',async()=>{
    const {id,socket}=await running();const before=mock.make.mock.calls.length;
    const other=new QrSessionManager(adapter(),{isEmergencyQrStopped:async()=>false} as any,{} as any,box,true);
    await other.start(id);expect(mock.make.mock.calls.length).toBe(before);
    await socket.handlers.get('connection.update')({connection:'close',lastDisconnect:{error:{output:{statusCode:401}}}});
    expect((await store.db.$queryRaw<any[]>`SELECT enabled,status FROM "ChannelConnection" WHERE id=${id}`)[0]).toMatchObject({enabled:false,status:'DISCONNECTED'});
    expect((await store.db.$queryRaw<any[]>`SELECT * FROM "QrSessionLease" WHERE "connectionId"=${id}`).length).toBe(0);
  });
  it('restarts an explicitly resumed connection even before the old socket heartbeat',async()=>{
    const {id,manager,socket}=await running();const before=mock.make.mock.calls.length;
    await store.db.$executeRaw`UPDATE "ChannelConnection" SET status='PENDING' WHERE id=${id}`;
    await manager.start(id);expect(socket.end).toHaveBeenCalledTimes(1);expect(mock.make.mock.calls.length-before).toBe(1);
  });
  it('accepts only phone-number JIDs and stops reconnecting after bounded failures',()=>{
    expect(qrPhone('212608477191:3@s.whatsapp.net')).toBe('212608477191');expect(qrPhone('123@lid')).toBeNull();expect(qrPhone('123@g.us')).toBeNull();
    expect([0,1,2,3,4,5].map(qrReconnectDelay)).toEqual([5000,10000,20000,40000,60000,null]);
  });
});
