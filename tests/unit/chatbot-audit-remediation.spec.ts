import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { TurnDecisionResolver } from '../../src/domain/conversation/TurnDecision';
import { HandoffService } from '../../src/domain/conversation/HandoffService';
import { ConversationEngine } from '../../src/domain/conversation/ConversationEngine';
import { ConversationService } from '../../src/domain/conversation/ConversationService';
import { DEFAULT_BUSINESS_CONFIG } from '../../src/domain/tenant/BusinessConfig';
import { ResponseBuilder } from '../../src/domain/conversation/ResponseBuilder';
import { ClientSafetyGuard } from '../../src/domain/channel/guard/ClientSafetyGuard';
import { WhatsAppWorker } from '../../src/domain/channel/whatsapp/WhatsAppWorker';
import { CRMService } from '../../src/domain/crm/CRMService';
import { GeminiEmbeddingProvider } from '../../src/core/rag/GeminiEmbeddingProvider';
import { UnavailableEmbeddingProvider } from '../../src/core/rag/EmbeddingProvider';
import { requireServiceAuth } from '../../packages/shared/service-auth';
import { WhatsAppWebhookExtractor } from '../../src/domain/channel/whatsapp/WhatsAppWebhookExtractor';
import { WhatsAppOutboundAdapter } from '../../src/domain/channel/whatsapp/WhatsAppOutboundAdapter';
import { PostgresMessageQueue } from '../../src/domain/channel/whatsapp/MessageQueue';

afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();vi.useRealTimers();});

function engineFixture() {
  const config:any=structuredClone(DEFAULT_BUSINESS_CONFIG);
  config.knowledge.enabled=false;
  config.capabilities={intents:[],ecommerceEnabled:false,faq:[{id:'shipping',question:'How much is shipping?',answer:'Shipping in Morocco costs 30 MAD.',language:'en',category:'SHIPPING'}]};
  const conv:any={id:'c',tenantId:'t',customerId:'customer',accountId:'a',status:'ACTIVE',version:0,messageCount:0,contextData:{}};
  const svc:any={getOrCreateConversation:vi.fn(async()=>conv),getAutomationState:async()=>null,getMessageCount:async()=>0,getActiveSession:async()=>null,getRecentMessages:async()=>[],getLatestCompletedSession:async()=>null,commitConversationTurn:vi.fn(async()=>({success:true})),findExistingTurnResponse:async()=>null};
  const llm:any={classifyIntent:vi.fn(async()=>null),generateResponse:vi.fn(async()=>'UNANSWERABLE')};
  const crm={processTurnSignal:vi.fn(async()=>null)};
  const engine=new ConversationEngine(svc,{getConfig:async()=>config} as any,{} as any,llm,new ResponseBuilder(),undefined,undefined,undefined,{getEffectiveConfig:async()=>config} as any,undefined,crm as any);
  return {engine,config,svc,llm,crm};
}

describe('audit: intent meaning and complete answers',()=>{
  it.each(['I do not want to buy this',"I don't want to buy this",'لا أريد شراء هذا','ما بغيتش نشري هادشي','ma bghitch nchri hada','je ne veux pas acheter ça'])('does not turn negation into a sale: %s',async text=>{
    const decision=TurnDecisionResolver.resolve({text,isEcommerceEnabled:true});
    expect(decision.intent).not.toBe('BUY_INTENT');
    const upsert=vi.fn();
    await new CRMService({lead:{upsert}} as any).processTurnSignal({tenantId:'t',accountId:'a',customerId:'c',turnDecision:decision,userMessage:text});
    expect(upsert).not.toHaveBeenCalled();
  });
  it.each(['Do not transfer me to a human agent',"I don't want a human agent",'لا أريد التحدث مع شخص حقيقي','je ne veux pas parler avec un humain'])('does not trigger a negated handoff: %s',text=>{
    expect(HandoffService.isHandoffRequested(text)).toBe(false);
  });
  it.each(['I want to buy this','أريد شراء هذا','bghit nchri hada','je veux acheter ça'])('preserves affirmative buying: %s',text=>{
    expect(TurnDecisionResolver.resolve({text,isEcommerceEnabled:true}).intent).toBe('BUY_INTENT');
  });
  it.each([
    ['Do you sell skincare products?','CARE'],
    ['What is the discount code?','PAYMENT'],
    ['I want to buy a spaceship toy','SHIPPING']
  ])('does not match policies inside words: %s',(text,incorrect)=>{
    expect(TurnDecisionResolver.resolve({text,isEcommerceEnabled:true}).intent).not.toBe(incorrect);
  });
  it.each(['How much is shipping? And what is the return policy?','How much is shipping to France?'])('does not use an incomplete or wrong-scope FAQ: %s',async text=>{
    const {engine}=engineFixture();
    expect(await engine.handleMessage('t','customer',text,'a')).not.toBe('Shipping in Morocco costs 30 MAD.');
  });
  it('keeps a correct simple FAQ fast path',async()=>{
    const {engine,llm}=engineFixture();
    expect(await engine.handleMessage('t','customer','How much is shipping?','a')).toContain('30 MAD');
    expect(llm.generateResponse).not.toHaveBeenCalled();
  });
  it('does not label a greeting as workflow execution',async()=>{
    const {engine,config,crm}=engineFixture();
    config.workflows={booking:{id:'booking',initialState:'name',states:{name:{type:'collect',field:{name:'name',type:'string'},prompt:'Name?'}}}};
    await engine.handleMessage('t','customer','Hello','a');
    expect(crm.processTurnSignal.mock.calls[0][0].turnDecision.intent).toBe('GREETING');
  });
  it.each(['I want to buy this and how much is shipping?', 'Je veux acheter ceci et combien coûte la livraison?', 'أريد شراء هذا وما تكلفة التوصيل؟'])('preserves an affirmative purchase alongside a policy question: %s',text=>{
    const decision=TurnDecisionResolver.resolve({text,isEcommerceEnabled:true});
    expect(decision.policyIntents).toContain('SHIPPING');
    expect(decision.secondaryIntents).toContain('BUY_INTENT');
  });
  it('does not invent a secondary purchase from a negated clause',()=>{
    expect(TurnDecisionResolver.resolve({text:'I do not want to buy this and how much is shipping?'}).secondaryIntents).toBeUndefined();
  });
  it('asks to confirm the product and retains the pending request for a mixed turn',async()=>{
    const {engine,config,svc,crm}=engineFixture(); config.capabilities.ecommerceEnabled=true;
    const reply=await engine.handleMessage('t','customer','I want to buy this and how much is shipping?','a');
    expect(reply).toContain('confirm the product');
    expect(svc.commitConversationTurn.mock.calls[0][0].contextData.pendingPurchaseRequest.text).toContain('buy this');
    expect(crm.processTurnSignal.mock.calls[0][0].turnDecision.secondaryIntents).toContain('BUY_INTENT');
  });
  it('applies FAQ scope checks after workflow completion too',async()=>{
    const {engine,svc}=engineFixture();
    svc.getLatestCompletedSession=async()=>({id:'done',workflowId:'done',status:'COMPLETED',collectedData:{}});
    expect(await engine.handleMessage('t','customer','How much is shipping to France?','a')).not.toBe('Shipping in Morocco costs 30 MAD.');
  });
});

describe('audit: state and delivery',()=>{
  function workerFixture() {
    const conv:any={id:'c',status:'ACTIVE',humanRequested:false};
    const receipt:any={id:'ack',metadata:{responseType:'HANDOFF',externalMessageId:'first'}};
    const numbers:any={resolveAccountByPhoneNumberId:async()=>({tenantId:'t',accountId:'a',enabled:true,status:'CONNECTED',transport:'META_CLOUD'})};
    const db:any={tenantConfig:{findUnique:async()=>({config:{}})},customer:{findFirst:async()=>({id:'customer'})},conversation:{findFirst:async()=>conv,findUnique:async()=>conv},conversationAutomationState:{findUnique:async()=>null},message:{findFirst:vi.fn(async({where}:any)=>where.AND?.[1]?.metadata?.equals==='first' ? receipt:null)}};
    const guard=new ClientSafetyGuard(db,numbers);
    const engine:any={handleMessage:vi.fn(async()=>{conv.humanRequested=true;conv.status='HANDOFF_REQUESTED';return 'Your request for human support has been recorded.';}),recordInboundMessage:vi.fn(async()=>{})};
    const routeOutbound=vi.fn(async()=>({success:true,providerMessageId:'sent'}));
    const worker=new WhatsAppWorker({registerHandler:()=>{}} as any,engine,{} as any,numbers,{evaluateOutbound:()=>({action:'SEND_TEXT',text:'Acknowledgment',isWithinCustomerServiceWindow:true})} as any,{routeOutbound} as any,guard);
    const job:any={id:'j',wamid:'first',tenantId:'t',accountId:'a',waId:'customer',phoneNumberId:'phone',message:'I want a human agent',timestamp:Date.now(),enqueuedAt:Date.now()};
    return {worker,engine,job,conv,routeOutbound,guard,db};
  }
  it('delivers the persisted handoff acknowledgment but stores later messages without a bot reply',async()=>{
    const {worker,engine,job,routeOutbound}=workerFixture();
    expect((await worker.processJob(job)).outboundResult?.success).toBe(true);
    await worker.processJob({...job,wamid:'second',message:'My order is 123'});
    expect(routeOutbound).toHaveBeenCalledTimes(1);
    expect(engine.handleMessage).toHaveBeenCalledTimes(1);
    expect(engine.recordInboundMessage).toHaveBeenCalledWith('t','customer','My order is 123','a','second');
  });
  it('converts Meta webhook timestamps from seconds to milliseconds before policy evaluation',async()=>{
    const evaluateOutbound=vi.fn(()=>({action:'SEND_TEXT',text:'Reply',isWithinCustomerServiceWindow:true}));
    const routeOutbound=vi.fn(async()=>({success:true,providerMessageId:'sent'}));
    const worker=new WhatsAppWorker(
      {registerHandler:()=>{}} as any,
      {handleMessage:vi.fn(async()=>'Reply')} as any,
      {} as any,
      {resolveAccountByPhoneNumberId:async()=>({tenantId:'t',accountId:'a',enabled:true,status:'CONNECTED',transport:'META_CLOUD'})} as any,
      {evaluateOutbound} as any,
      {routeOutbound} as any
    );
    const timestampSeconds=Math.floor(Date.now()/1000);
    await worker.processJob({id:'j',wamid:'w',tenantId:'t',accountId:'a',waId:'customer',phoneNumberId:'phone',message:'Hello',timestamp:timestampSeconds,enqueuedAt:Date.now()} as any);
    expect(evaluateOutbound).toHaveBeenCalledWith(expect.objectContaining({lastInboundTimestamp:timestampSeconds*1000}));
    expect(routeOutbound).toHaveBeenCalledTimes(1);
  });
  it('does not bypass an actual human takeover with an acknowledgment ID',async()=>{
    const {guard,conv}=workerFixture();conv.status='HUMAN_ACTIVE';conv.humanRequested=true;
    expect((await guard.evaluateOutbound({tenantId:'t',accountId:'a',phoneNumberId:'phone',recipientWaId:'customer',handoffAcknowledgmentFor:'first'})).allowed).toBe(false);
  });
  it.each(['CIRCUIT_BREAKER_OPEN','RATE_LIMIT_EXCEEDED'])('defers temporary restriction %s',async code=>{
    const worker=new WhatsAppWorker({registerHandler:()=>{}} as any,{} as any,{} as any,{} as any,{} as any,{} as any,{evaluateOutbound:async()=>({allowed:false,code})} as any);
    expect((await worker.processJob({wamid:'w',tenantId:'t',accountId:'a',waId:'c',phoneNumberId:'p'} as any)).outboundResult?.isRetryable).toBe(true);
  });
  it('rejects stale writes rather than replacing the expected version',async()=>{
    const updateMany=vi.fn(async()=>({count:0}));const findUnique=vi.fn(async()=>({version:8}));
    const service=new ConversationService({$transaction:async(fn:any)=>fn({conversation:{updateMany}}),conversation:{findUnique}} as any);
    await expect(service.commitConversationTurn({tenantId:'t',conversationId:'c',expectedVersion:7,userMessage:'old input',contextData:{address:'old'}})).rejects.toThrow('Concurrency Conflict');
    expect(updateMany).toHaveBeenCalledTimes(1);expect(findUnique).not.toHaveBeenCalled();
  });
  it('propagates real automation-state read failures',async()=>{
    const service=new ConversationService({conversationAutomationState:{findUnique:async()=>{throw Error('database unavailable');}}} as any);
    await expect(service.getAutomationState('t','c')).rejects.toThrow('SAFETY_STATE_UNAVAILABLE');
  });
  it('delays retries until the circuit can recover',async()=>{
    const guard=new ClientSafetyGuard({tenantConfig:{findUnique:async()=>null}} as any,undefined,{circuitBreakerThreshold:1,circuitBreakerWindowMs:300000});
    guard.recordProviderFailure('p');
    const result=await guard.evaluateOutbound({tenantId:'t',accountId:'a',phoneNumberId:'p',recipientWaId:''});
    expect(result.code).toBe('CIRCUIT_BREAKER_OPEN');
    expect(result.retryAfterSeconds).toBeGreaterThanOrEqual(300);
  });
  it('makes a temporarily blocked durable job pending at the requested future time',async()=>{
    const updateMany=vi.fn(async()=>({count:1}));
    const queue=new PostgresMessageQueue({whatsAppMessageJob:{updateMany,findUnique:async()=>({attempts:1,maxAttempts:3,outboundStatus:'FAILED'})}} as any);
    vi.spyOn(queue,'claimNextJob').mockResolvedValueOnce({id:'j',wamid:'w',leaseAttempt:1} as any).mockResolvedValue(null);
    queue.registerHandler(async()=>({outboundResult:{success:false,isRetryable:true,retryAfterSeconds:301}}));
    const started=Date.now();
    await (queue as any).workerLoop();
    const final=updateMany.mock.calls.at(-1)?.[0] as any;
    expect(final.data.status).toBe('PENDING');
    expect(final.data.availableAt.getTime()).toBeGreaterThanOrEqual(started+301000);
  });
  it('replays only the assistant message linked to the same external turn',async()=>{
    const findFirst=vi.fn().mockResolvedValueOnce({id:'user-a',conversationId:'c',metadata:{turnCommitted:true,responseExpected:true}}).mockResolvedValueOnce({content:'response-a'});
    const svc=new ConversationService({message:{findFirst}} as any);
    expect(await svc.findExistingTurnResponse('t','wamid-a','c')).toBe('response-a');
    expect(findFirst.mock.calls[1][0].where.metadata).toEqual({path:['replyToMessageId'],equals:'user-a'});
  });
  it('replays silent human-mode turns without borrowing the next assistant response',async()=>{
    const findFirst=vi.fn(async()=>({id:'user-a',metadata:{turnCommitted:true,responseExpected:false}}));
    const svc=new ConversationService({message:{findFirst}} as any);
    expect(await svc.findExistingTurnResponse('t','wamid-a','c')).toBe('');
    expect(findFirst).toHaveBeenCalledTimes(1);
  });
  it('serializes overlapping local turns for the same conversation',async()=>{
    const {engine}=engineFixture();
    let release!:()=>void; const first=new Promise<void>(resolve=>{release=resolve;});
    const started:string[]=[];
    vi.spyOn(engine as any,'handleMessageInternal').mockImplementation(async(...args:any[])=>{started.push(args[2]);if(args[2]==='first')await first;return args[2];});
    const a=engine.handleMessage('t','c','first','a'); const b=engine.handleMessage('t','c','second','a');
    await new Promise(resolve=>setImmediate(resolve));expect(started).toEqual(['first']);release();
    expect(await Promise.all([a,b])).toEqual(['first','second']);
  });
});

describe('audit: WhatsApp attachments',()=>{
  function extract(messages:any[]) {
    return WhatsAppWebhookExtractor.extractMessages({entry:[{changes:[{field:'messages',value:{metadata:{phone_number_id:'123'},messages}}]}]});
  }
  it('keeps image captions, interactive choices and unsupported attachment events',()=>{
    const result=extract([
      {id:'i',from:'456',type:'image',image:{id:'789',caption:'Do you sell this?'}},
      {id:'b',from:'456',type:'interactive',interactive:{button_reply:{id:'x',title:'Yes'}}},
      {id:'a',from:'456',type:'audio',audio:{id:'987'}}
    ]);
    expect(result).toHaveLength(3);
    expect(JSON.parse(result[0].message)).toEqual({mediaId:'789',caption:'Do you sell this?'});
    expect(result[1]).toMatchObject({message:'Yes',rawType:'text'});
    expect(JSON.parse(result[2].message).unsupportedMediaType).toBe('audio');
  });
  it('downloads permitted Meta media with time and size bounds',async()=>{
    const fetchFn=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({url:'https://lookaside.fbsbx.com/media',mime_type:'image/png',file_size:3}))).mockResolvedValueOnce(new Response(new Uint8Array([1,2,3])));
    const adapter=new WhatsAppOutboundAdapter({defaultAccessToken:'fake-token',fetchFn});
    expect(await adapter.downloadInboundImage('123','789')).toEqual({imageBase64:'AQID',mimeType:'image/png'});
    expect(fetchFn.mock.calls[0][0]).toContain('phone_number_id=123');
    expect(fetchFn.mock.calls[1][1]).toMatchObject({headers:{Authorization:'Bearer fake-token'},redirect:'error',signal:expect.any(AbortSignal)});
  });
  it('never forwards a credential to an untrusted media URL',async()=>{
    const fetchFn=vi.fn(async()=>new Response(JSON.stringify({url:'https://attacker.invalid/image',mime_type:'image/png'})));
    const adapter=new WhatsAppOutboundAdapter({defaultAccessToken:'fake-token',fetchFn});
    await expect(adapter.downloadInboundImage('123','789')).rejects.toThrow('UNTRUSTED_MEDIA_URL');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
  it('rejects oversized streams even without a content-length header',async()=>{
    const fetchFn=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({url:'https://lookaside.fbsbx.com/media',mime_type:'image/png'}))).mockResolvedValueOnce(new Response(new Uint8Array(5*1024*1024+1)));
    const adapter=new WhatsAppOutboundAdapter({defaultAccessToken:'fake-token',fetchFn});
    await expect(adapter.downloadInboundImage('123','789')).rejects.toThrow('IMAGE_TOO_LARGE');
  });
  it('does not use a global token when number credentials are unavailable',async()=>{
    const fetchFn=vi.fn();const adapter=new WhatsAppOutboundAdapter({defaultAccessToken:'global',fetchFn,numberService:{resolveConnectionByPhoneNumberId:async()=>null} as any});
    await expect(adapter.downloadInboundImage('123','789')).rejects.toThrow('MEDIA_CREDENTIALS_UNAVAILABLE');
    expect(fetchFn).not.toHaveBeenCalled();
  });
  it('routes the image and caption through the unified engine',async()=>{
    const handleMessage=vi.fn(async()=>'');
    const worker=new WhatsAppWorker({registerHandler:()=>{}} as any,{handleMessage} as any,{downloadInboundImage:async()=>({imageBase64:'AQID',mimeType:'image/png'})} as any);
    await worker.processJob({id:'j',wamid:'i',tenantId:'t',accountId:'a',waId:'456',phoneNumberId:'123',rawType:'image',message:JSON.stringify({mediaId:'789',caption:'Find this'})} as any);
    expect(handleMessage).toHaveBeenCalledWith('t','456',{imageBase64:'AQID',mimeType:'image/png',text:'Find this'},'a',{externalMessageId:'i'});
  });
  it('records an unsupported attachment and asks for text without invoking an LLM',async()=>{
    const {engine,svc,llm}=engineFixture();
    expect(await engine.handleMessage('t','c',{unsupportedMediaType:'audio'},'a',{externalMessageId:'audio-id'})).toContain('send your request as text');
    expect(svc.commitConversationTurn.mock.calls[0][0]).toMatchObject({externalMessageId:'audio-id',responseType:'UNSUPPORTED_MEDIA'});
    expect(llm.generateResponse).not.toHaveBeenCalled();
  });
});

describe('audit: provider and internal service boundaries',()=>{
  it('never fabricates vectors when embeddings are unavailable',async()=>{
    await expect(new UnavailableEmbeddingProvider().embedText('document')).rejects.toThrow('EMBEDDING_PROVIDER_UNAVAILABLE');
  });
  it('bounds embedding network calls and validates returned values',async()=>{
    const fetchFn=vi.fn(async()=>new Response(JSON.stringify({embedding:{values:[1,2,3]}}),{status:200}));
    vi.stubGlobal('fetch',fetchFn);
    expect(await new GeminiEmbeddingProvider('fake').embedText('hello')).toEqual([1,2,3]);
    expect(fetchFn.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
  it('requires a configured internal service credential',async()=>{
    const app=express();app.post('/private',requireServiceAuth,(_req,res)=>res.json({ok:true}));
    vi.stubEnv('INTERNAL_SERVICE_TOKEN','');
    expect((await request(app).post('/private')).status).toBe(503);
    vi.stubEnv('INTERNAL_SERVICE_TOKEN','test-service-credential-at-least-32-chars');
    expect((await request(app).post('/private')).status).toBe(401);
    expect((await request(app).post('/private').set('Authorization','test-service-credential-at-least-32-chars')).status).toBe(401);
    expect((await request(app).post('/private').set('Authorization','Bearer test-service-credential-at-least-32-chars')).status).toBe(200);
  });
  it('protects actual monitoring routes before invoking storage',async()=>{
    vi.stubEnv('INTERNAL_SERVICE_TOKEN','test-service-credential-at-least-32-chars');
    const {createMonitoringApp}=await import('../../apps/monitoring-service/src/server');
    const processPayload=vi.fn(async()=>({success:true,accepted:1}));const getTraceByCorrelationId=vi.fn();
    const app=createMonitoringApp({} as any,{processPayload} as any,{getTraceByCorrelationId} as any,{} as any);
    expect((await request(app).post('/api/telemetry/ingest').send([])).status).toBe(401);
    expect(processPayload).not.toHaveBeenCalled();
    expect([401,503]).toContain((await request(app).get('/api/monitoring/traces/private')).status);
    expect(getTraceByCorrelationId).not.toHaveBeenCalled();
    expect((await request(app).post('/api/telemetry/ingest').set('Authorization','Bearer test-service-credential-at-least-32-chars').send([])).status).toBe(200);
  });
  it('protects the actual image endpoint and hides raw provider output outside tests',async()=>{
    vi.stubEnv('INTERNAL_SERVICE_TOKEN','test-service-credential-at-least-32-chars');
    vi.stubEnv('GOOGLE_API_KEY','fake-key-for-constructor-only');
    const {app}=await import('../../apps/image-service/src/index');
    expect((await request(app).post('/analyze-image').send({tenantId:'t'})).status).toBe(401);
    vi.stubEnv('NODE_ENV','production');
    expect((await request(app).get('/test/last-raw-response')).status).toBe(404);
  });
});
