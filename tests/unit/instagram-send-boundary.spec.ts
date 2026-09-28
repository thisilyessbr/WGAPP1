import { describe, expect, it, vi } from 'vitest';
import { InstagramService } from '../../src/domain/channel/instagram/InstagramService';
import { SecretBox } from '../../src/core/security/SecretBox';

function fixture() {
  const box=new SecretBox({key:'test-only-boundary-key'});
  const connection={tenantId:'tenant',accountId:'account',instagramUserId:'1234567890',enabled:true,status:'CONNECTED',
    encryptedToken:box.encrypt('sandbox-token'),tokenExpiresAt:new Date(Date.now()+30*86400000)};
  const profile={tenantId:'tenant',accountId:'account',status:'ACTIVE',instagramAllowed:true,planSnapshot:{modules:['instagram']}};
  const db={instagramConnection:{findUnique:vi.fn(async()=>connection),updateMany:vi.fn(async()=>({count:1}))},
    portalProfile:{findUnique:vi.fn(async()=>profile)}};
  const fetchFn=vi.fn(async()=>new Response(JSON.stringify({message_id:'sandbox-message'})));
  return {box,connection,profile,db,fetchFn};
}
describe('Instagram final provider boundary',()=>{
  it('still sends an authorized manual reply successfully',async()=>{
    const f=fixture(),service=new InstagramService(f.db as any,undefined,{box:f.box,fetchFn:f.fetchFn});
    expect(await service.sendText(f.connection,'2222222222','Hello')).toBe('sandbox-message');
    expect(f.fetchFn).toHaveBeenCalledTimes(1);
  });
  it.each(['owner','suspended','disconnected'])('does not contact Meta when %s changes',async change=>{
    const f=fixture();
    if(change==='owner')f.db.instagramConnection.findUnique.mockResolvedValue({...f.connection,accountId:'other'});
    if(change==='suspended')f.profile.status='SUSPENDED';
    if(change==='disconnected')f.db.instagramConnection.findUnique.mockResolvedValue({...f.connection,status:'DISCONNECTED'});
    const service=new InstagramService(f.db as any,undefined,{box:f.box,fetchFn:f.fetchFn});
    await expect(service.sendText(f.connection,'2222222222','Private')).rejects.toThrow('INSTAGRAM_CONNECTION_UNAVAILABLE');
    expect(f.fetchFn).not.toHaveBeenCalled();
  });
  it('checks human takeover again after token resolution for automated sends',async()=>{
    const f=fixture(),engine={getConversationService:()=>({getLatestConversation:async()=>({status:'HUMAN_ACTIVE'})})};
    const service=new InstagramService(f.db as any,engine as any,{box:f.box,fetchFn:f.fetchFn});
    await expect(service.sendText(f.connection,'2222222222','Automated',true)).rejects.toThrow('INSTAGRAM_HUMAN_TAKEOVER');
    expect(f.fetchFn).not.toHaveBeenCalled();
  });
  it('does not write a refreshed token or send when the connection fence no longer matches',async()=>{
    const f=fixture();f.connection.tokenExpiresAt=new Date(Date.now()+1000);
    f.db.instagramConnection.updateMany.mockResolvedValue({count:0});
    f.fetchFn.mockImplementation(async()=>new Response(JSON.stringify({access_token:'new-sandbox-token',expires_in:3600})));
    const service=new InstagramService(f.db as any,undefined,{box:f.box,fetchFn:f.fetchFn});
    await expect(service.sendText(f.connection,'2222222222','Private')).rejects.toThrow('INSTAGRAM_CONNECTION_CHANGED');
    expect(f.fetchFn).toHaveBeenCalledTimes(1);
    expect(f.db.instagramConnection.updateMany.mock.calls[0][0].where).toMatchObject({accountId:'account',tenantId:'tenant',encryptedToken:f.connection.encryptedToken});
  });
  it('renews a slow generation lease using the same fencing token',async()=>{
    vi.useFakeTimers();
    let release!:()=>void,entered!:()=>void;
    const gate=new Promise<void>(r=>release=r),start=new Promise<void>(r=>entered=r);
    const f=fixture(),updateMany=vi.fn(async()=>({count:1}));
    const db={...f.db,$queryRaw:async()=>[{id:'job',tenantId:'tenant',accountId:'account',instagramUserId:'1234567890',senderId:'2222222222',messageId:'mid',text:'Hello',responseText:null,attempts:3}],
      instagramConnection:{...f.db.instagramConnection,findFirst:async()=>f.connection},instagramInboundJob:{updateMany}};
    const engine={getConversationService:()=>({getLatestConversation:async()=>({status:'AI_ACTIVE'})}),
      handleMessage:async()=>{entered();await gate;return 'Answer';},recordOutboundAssistantMessage:async()=>{}};
    const service=new InstagramService(db as any,engine as any,{box:f.box,fetchFn:f.fetchFn});
    const send=vi.spyOn(service,'sendText').mockResolvedValue('sent');const running=service.tick();
    try {
      await start;await vi.advanceTimersByTimeAsync(20001);
      expect(updateMany.mock.calls.some(([args]:any)=>args.where.attempts===3 && args.where.status?.in && args.data.leaseUntil instanceof Date)).toBe(true);
      release();await running;expect(send).toHaveBeenCalledTimes(1);
    } finally {release();await running;service.stop();vi.useRealTimers();}
  });
});
