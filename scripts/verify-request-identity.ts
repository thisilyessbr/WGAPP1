import { config as loadEnv } from 'dotenv';
import { DeepSeekProvider } from '../src/core/llm/DeepSeekProvider';
import { ConversationEngine } from '../src/domain/conversation/ConversationEngine';
import { DEFAULT_BUSINESS_CONFIG } from '../src/domain/tenant/BusinessConfig';
import { AccountConfigService } from '../src/domain/tenant/AccountConfigService';
import { ResponseBuilder } from '../src/domain/conversation/ResponseBuilder';
import { Pool } from 'pg';
import { resolveGroundedAnswer } from '../src/domain/conversation/GroundedAnswer';

// Manual checks never persist conversations or send channel messages.
// Production replay is opt-in and requires authorization to use its data with the provider.
async function main() {
  if (process.env.RELAYQO_TEST_ENV_FILE) loadEnv({path:process.env.RELAYQO_TEST_ENV_FILE,quiet:true});
  if (!process.env.DEEPSEEK_API_KEY) throw new Error('Configure DEEPSEEK_API_KEY outside this script');
  const provider=new DeepSeekProvider(process.env.DEEPSEEK_API_KEY);
  if (process.env.RELAYQO_REPLAY_ACCOUNT_ID) {
    const db=new Pool({connectionString:process.env.DIRECT_URL||process.env.DATABASE_URL,max:1});
    try {
      const result=await db.query('SELECT "tenantId",config FROM "Account" WHERE id=$1',[process.env.RELAYQO_REPLAY_ACCOUNT_ID]);
      if(result.rows.length!==1) throw new Error('Replay account not found');
      const row=result.rows[0];
      const merger=Object.create(AccountConfigService.prototype) as any;
      const config=merger.mergeAccountOverrides(DEFAULT_BUSINESS_CONFIG,row.config);
      // No workflow execution or retrieval/database writes in this FAQ-and-answer replay.
      config.workflows={}; config.knowledge.enabled=false; config.capabilities.intents=[];
      let providerCalls=0;
      const measuredProvider={
        classifyIntent:provider.classifyIntent.bind(provider),
        generateResponse:async (...args:any[])=>{providerCalls++;return (provider.generateResponse as any)(...args);}
      };
      const conversation={id:'isolated-replay',tenantId:row.tenantId,customerId:'isolated-replay',accountId:process.env.RELAYQO_REPLAY_ACCOUNT_ID,status:'ACTIVE',version:0,messageCount:0,contextData:{}};
      const svc:any={getOrCreateConversation:async()=>structuredClone(conversation),getAutomationState:async()=>null,getMessageCount:async()=>0,getActiveSession:async()=>null,getRecentMessages:async()=>[],getLatestCompletedSession:async()=>null,commitConversationTurn:async()=>({success:true}),findExistingTurnResponse:async()=>null};
      const replay=new ConversationEngine(svc,{getConfig:async()=>config} as any,{} as any,measuredProvider,new ResponseBuilder(),undefined,undefined,undefined,{getEffectiveConfig:async()=>config} as any);
      const questions=['Salam bghit n7jez cours farabe','Salam bghit n7jez cours anglais','Je veux réserver un cours en arabe.'];
      for(const question of Array.from({length:Number(process.env.RELAYQO_REPLAY_REPEATS||1)},()=>questions).flat()) {
        const start=Date.now(); const callsBefore=providerCalls;
        const answer=await replay.handleMessage(row.tenantId,'isolated-replay',question,process.env.RELAYQO_REPLAY_ACCOUNT_ID);
        console.log(JSON.stringify({id:'approved-account-replay',question,answer,providerCalls:providerCalls-callsBefore,latencyMs:Date.now()-start}));
      }
    } finally {await db.end();}
    return;
  }
  const engine=Object.create(ConversationEngine.prototype) as any;
  const fixtures=[
    {id:'darija-uncertain-course',lang:'darija',script:'arabizi',question:'Salam bghit n7jez cours farabe',evidence:'French group course: 900 MAD. English group course: 900 MAD. Moroccan Darija course: 650 MAD.'},
    {id:'french-unlisted-course',lang:'fr',script:'latin',question:'Je veux réserver un cours en arabe.',evidence:'French course: 900 MAD. English course: 900 MAD.'},
    {id:'darija-known-course',lang:'darija',script:'arabizi',question:'Salam bghit n7jez cours anglais',evidence:'French group course: 900 MAD. English group course: 900 MAD. Registration requires staff confirmation.'},
    {id:'arabic-unlisted-service',lang:'ar',script:'arabic',question:'هل يمكنني حجز تصوير بالرنين المغناطيسي؟',evidence:'X-ray examination: 300 MAD. General medical consultation: 200 MAD.'},
    {id:'english-diet-qualifier',lang:'en',script:'latin',question:'Can I order a vegan pizza?',evidence:'Cheese vegetarian pizza: 80 MAD. Chicken pizza: 90 MAD. No vegan ingredients are specified.'},
    {id:'french-uncertain-service',lang:'fr',script:'latin',question:'Je veux réserver votre soin zenta.',evidence:'Relaxing massage: 250 MAD. Facial treatment: 200 MAD.'},
    {id:'english-known-product',lang:'en',script:'latin',question:'How much is the wireless charger?',evidence:'Wireless charger: 120 MAD. Phone case: 50 MAD.'},
    {id:'arabic-known-service',lang:'ar',script:'arabic',question:'ما ثمن الاستشارة العامة؟',evidence:'General consultation: 200 MAD. Dental cleaning: 350 MAD.'}
  ];
  for(const fixture of fixtures){
    const config=structuredClone(DEFAULT_BUSINESS_CONFIG);
    config.llm.temperature=0;
    const system=engine.buildGroundedSystemPrompt(config,fixture.lang,fixture.script);
    const question=engine.buildGroundedUserMessage(fixture.evidence,fixture.question,false,null,fixture.script);
    const start=Date.now();
    const raw=await provider.generateResponse(system,[{role:'user',content:question}],{temperature:0,maxTokens:200,timeoutMs:20000});
    const answer=resolveGroundedAnswer(raw,fixture.question,fixture.lang,fixture.script);
    console.log(JSON.stringify({id:fixture.id,question:fixture.question,answer,latencyMs:Date.now()-start}));
  }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
