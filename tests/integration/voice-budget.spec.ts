import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { portalDatabase } from '../helpers/portal-db';
import { PortalStore } from '../../src/portal/PortalStore';
import { PortalBudget } from '../../src/portal/PortalBudget';
import { validatePlan } from '../../src/portal/validation';

describe('paid transcription account and budget boundaries', () => {
  let database: Awaited<ReturnType<typeof portalDatabase>>, store: PortalStore, budget: PortalBudget;
  beforeAll(async () => { database=await portalDatabase(); store=new PortalStore(database.db); budget=new PortalBudget(store,false); },60000);
  afterAll(async () => { budget?.dispose(); await database?.pg.close(); });
  async function account(limits: any = {}) {
    const owner=await store.register(randomUUID()+'@example.test','Voice','hash',null);
    const plan=await store.savePlan(owner.userId,validatePlan({name:'Voice',modules:['knowledge'],limits:{messages:10,monthlyUsd:1,...limits}}));
    const p=await store.profile(owner.accountId);
    await store.updateAccount(owner.userId,owner.accountId,p.revision,{planId:plan.id});
    await store.db.$executeRaw`UPDATE "PortalProfile" SET status='ACTIVE',"voiceNotesAllowed"=true,"voiceNotesEnabled"=true,"voiceTranscriptionProvider"='groq' WHERE "accountId"=${owner.accountId}`;
    return owner;
  }
  function options() {
    const load=vi.fn(async()=>({bytes:Buffer.from([1,2]),mimeType:'audio/ogg'}));
    const transcribe=vi.fn(async()=>({text:'Salam',durationSeconds:30}));
    const duration=vi.fn(async()=>30);
    return {load,transcribe,duration};
  }
  function run(owner: any, id: string, o: ReturnType<typeof options>) {
    return budget.transcribeVoice(owner.tenantId,owner.accountId,id,'groq',undefined,o.load,{transcribe:o.transcribe},o.duration);
  }
  it.each([{messages:0},{monthlyUsd:0},{monthlyUsd:0.001}])('does not download or pay after exhausted limits %j',async limits=>{
    const owner=await account(limits),o=options();
    await run(owner,randomUUID(),o).catch(()=>{});
    expect(o.load).not.toHaveBeenCalled();expect(o.transcribe).not.toHaveBeenCalled();
  });
  it('charges once and reuses a transcript after a retry and message allowance exhaustion',async()=>{
    const owner=await account({messages:1}),o=options(),id=randomUUID();
    expect((await run(owner,id,o)).text).toBe('Salam');
    expect((await run(owner,id,o)).text).toBe('Salam');
    expect(o.transcribe).toHaveBeenCalledTimes(1);expect(o.load).toHaveBeenCalledTimes(1);
    const rows=await store.db.$queryRaw<any[]>`SELECT * FROM "PortalUsageBucket" WHERE "accountId"=${owner.accountId}`;
    expect(Number(rows[0].messages)).toBe(1);expect(Number(rows[0].spentMicros)).toBe(925);expect(Number(rows[0].reservedMicros)).toBe(0);
    // The subsequent text engine uses the same message key, not a second unit.
    expect(await budget.runTurn(owner.tenantId,owner.accountId,id,async()=> 'Answer','blocked')).toBe('Answer');
    expect(await budget.runTurn(owner.tenantId,owner.accountId,randomUUID(),async()=> 'Answer','blocked')).toBe('blocked');
  });
  it('does not let two concurrent workers transcribe the same message',async()=>{
    const owner=await account(),o=options(),id=randomUUID();
    let entered!:()=>void,release!:()=>void;
    const started=new Promise<void>(r=>entered=r),gate=new Promise<void>(r=>release=r);
    o.transcribe.mockImplementation(async()=>{entered();await gate;return {text:'Salam',durationSeconds:30};});
    const first=run(owner,id,o);
    try { await started;await expect(run(owner,id,o)).rejects.toMatchObject({code:'VOICE_OPERATION_ALREADY_RESERVED'}); }
    finally {release();await first;}
    expect(o.transcribe).toHaveBeenCalledTimes(1);
  });
  it('cannot overspend the last shared audio allowance with different messages',async()=>{
    const owner=await account({monthlyUsd:0.01}),a=options(),b=options();
    let entered!:()=>void,release!:()=>void;
    const started=new Promise<void>(r=>entered=r),gate=new Promise<void>(r=>release=r);
    a.transcribe.mockImplementation(async()=>{entered();await gate;return {text:'Salam',durationSeconds:30};});
    const first=run(owner,randomUUID(),a);
    try {await started;await run(owner,randomUUID(),b).catch(()=>{});expect(b.transcribe).not.toHaveBeenCalled();}
    finally {release();await first;}
  });
  it('keeps identical message IDs isolated across clients and refuses a mismatched tenant',async()=>{
    const a=await account(),b=await account(),oa=options(),ob=options(),id=randomUUID();
    await run(a,id,oa);await run(b,id,ob);
    expect(oa.transcribe).toHaveBeenCalledTimes(1);expect(ob.transcribe).toHaveBeenCalledTimes(1);
    const bad=options();await expect(run({...a,tenantId:b.tenantId},randomUUID(),bad)).rejects.toBeTruthy();
    expect(bad.transcribe).not.toHaveBeenCalled();
  });
  it.each(['SUSPENDED','disabled','revoked'])('blocks voice access when %s',async change=>{
    const owner=await account(),o=options();
    if(change==='SUSPENDED')await store.db.$executeRaw`UPDATE "PortalProfile" SET status='SUSPENDED' WHERE "accountId"=${owner.accountId}`;
    if(change==='disabled')await store.db.$executeRaw`UPDATE "PortalProfile" SET "voiceNotesEnabled"=false WHERE "accountId"=${owner.accountId}`;
    if(change==='revoked')await store.db.$executeRaw`UPDATE "PortalProfile" SET "voiceNotesAllowed"=false WHERE "accountId"=${owner.accountId}`;
    await expect(run(owner,randomUUID(),o)).rejects.toBeTruthy();expect(o.load).not.toHaveBeenCalled();expect(o.transcribe).not.toHaveBeenCalled();
  });
  it('rechecks access after downloading and releases an unspent reservation',async()=>{
    const owner=await account(),o=options();
    o.load.mockImplementation(async()=>{await store.db.$executeRaw`UPDATE "PortalProfile" SET "voiceNotesAllowed"=false WHERE "accountId"=${owner.accountId}`;return {bytes:Buffer.from([1]),mimeType:'audio/ogg'};});
    await expect(run(owner,randomUUID(),o)).rejects.toBeTruthy();expect(o.transcribe).not.toHaveBeenCalled();
    const rows=await store.db.$queryRaw<any[]>`SELECT * FROM "PortalUsageBucket" WHERE "accountId"=${owner.accountId}`;
    expect(Number(rows[0].spentMicros)).toBe(0);expect(Number(rows[0].reservedMicros)).toBe(0);
  });
  it.each([0,301,NaN])('rejects unbounded audio duration %s before the provider call',async seconds=>{
    const owner=await account(),o=options();o.duration.mockResolvedValue(seconds);
    await expect(run(owner,randomUUID(),o)).rejects.toThrow('INVALID_VOICE_NOTE_DURATION');expect(o.transcribe).not.toHaveBeenCalled();
  });
  it('uses the real audio parser and fails closed for malformed containers',async()=>{
    const owner=await account(),o=options();
    await expect(budget.transcribeVoice(owner.tenantId,owner.accountId,randomUUID(),'groq',undefined,o.load,{transcribe:o.transcribe})).rejects.toBeTruthy();
    expect(o.transcribe).not.toHaveBeenCalled();
  });
  it('accepts a valid recording through the real duration parser',async()=>{
    const owner=await account(),o=options();
    const wave=Buffer.alloc(44+32000);
    wave.write('RIFF',0);wave.writeUInt32LE(wave.length-8,4);wave.write('WAVE',8);wave.write('fmt ',12);
    wave.writeUInt32LE(16,16);wave.writeUInt16LE(1,20);wave.writeUInt16LE(1,22);wave.writeUInt32LE(16000,24);
    wave.writeUInt32LE(32000,28);wave.writeUInt16LE(2,32);wave.writeUInt16LE(16,34);wave.write('data',36);wave.writeUInt32LE(32000,40);
    o.load.mockResolvedValue({bytes:wave,mimeType:'audio/wav'});
    expect((await budget.transcribeVoice(owner.tenantId,owner.accountId,randomUUID(),'groq',undefined,o.load,{transcribe:o.transcribe})).text).toBe('Salam');
    expect(o.transcribe).toHaveBeenCalledTimes(1);
  });
  it('reuses a transcript with unknown provider duration without a second paid request',async()=>{
    const owner=await account(),o=options(),id=randomUUID();
    o.transcribe.mockResolvedValue({text:'Salam',durationSeconds:null} as any);
    await run(owner,id,o);expect((await run(owner,id,o)).text).toBe('Salam');expect(o.transcribe).toHaveBeenCalledTimes(1);
  });
  it('settles an interrupted reservation conservatively instead of replaying it',async()=>{
    const owner=await account(),o=options(),id=randomUUID();
    let entered!:()=>void,release!:()=>void;
    const started=new Promise<void>(r=>entered=r),gate=new Promise<void>(r=>release=r);
    o.load.mockImplementation(async()=>{entered();await gate;return {bytes:Buffer.from([1]),mimeType:'audio/ogg'};});
    const first=run(owner,id,o).catch(()=>{});
    try {
      await started;
      await store.db.$executeRaw`UPDATE "PortalUsageEntry" SET "createdAt"=NOW()-INTERVAL '4 minutes' WHERE "accountId"=${owner.accountId} AND kind='audio'`;
      await expect(run(owner,id,options())).rejects.toMatchObject({code:'VOICE_OPERATION_ALREADY_RESERVED'});
    } finally {release();await first;}
    expect(o.transcribe).not.toHaveBeenCalled();
    const rows=await store.db.$queryRaw<any[]>`SELECT * FROM "PortalUsageBucket" WHERE "accountId"=${owner.accountId}`;
    expect(Number(rows[0].reservedMicros)).toBe(0);expect(Number(rows[0].spentMicros)).toBe(9250);
  });
  it('retains uncertain charges and never repeats a timed-out paid request',async()=>{
    const owner=await account(),o=options(),id=randomUUID();o.transcribe.mockRejectedValue(new Error('timeout'));
    await expect(run(owner,id,o)).rejects.toThrow('timeout');
    await expect(run(owner,id,o)).rejects.toMatchObject({code:'VOICE_OPERATION_ALREADY_RESERVED'});
    expect(o.transcribe).toHaveBeenCalledTimes(1);
    const rows=await store.db.$queryRaw<any[]>`SELECT * FROM "PortalUsageBucket" WHERE "accountId"=${owner.accountId}`;
    expect(Number(rows[0].spentMicros)).toBe(9250);expect(Number(rows[0].reservedMicros)).toBe(0);
  });
});
