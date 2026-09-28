import { describe,it,expect } from 'vitest';
import { chromium } from 'playwright';
import express from 'express';
import { resolve } from 'path';

describe('staff action screens',()=>{
  it('keeps the latest inbox turn visible while loading older history and changing conversations',async()=>{
    const app=express();app.use(express.json());
    let detailLoads=0,report:any=null;
    const recent={id:'recent',role:'ASSISTANT',content:'Newest WhatsApp reply',createdAt:'2026-09-28T15:00:00Z'};
    const old={id:'old',role:'USER',content:'Older customer message',createdAt:'2026-09-25T15:00:00Z'};
    const conversation=(id:string)=>({id,status:'AI_ACTIVE',ownership:{state:'AI_ACTIVE'},customer:{phone:id},customerServiceWindow:{canSendFreeform:true},messageCount:1});
    app.use('/api',(req,res)=>{
      if(req.path==='/auth/session')return res.json({user:{id:'owner',name:'Owner',role:'CLIENT'},csrf:'test',accounts:[]});
      if(req.path==='/client/profile')return res.json({profile:{plan:{modules:['services']}}});
      if(req.path==='/client/conversations')return res.json({conversations:['chat-a','chat-b'].map(id=>({...conversation(id),customerPhone:id,lastMessage:{content:'Newest WhatsApp reply',createdAt:recent.createdAt}})),pagination:{total:2,hasMore:false}});
      if(req.path==='/client/conversations/chat-a'){detailLoads++;return res.json({conversation:conversation('chat-a'),messages:req.query.before?[old]:[{...recent,feedbackStatus:report?'OPEN':null}],hasOlderMessages:!req.query.before,nextBefore:req.query.before?null:'recent'});}
      if(req.path==='/client/conversations/chat-a/answer-feedback'){report=req.body;return res.json({feedback:{status:'OPEN'}});}
      if(req.path==='/client/conversations/chat-b')return res.json({conversation:conversation('chat-b'),messages:[{...recent,id:'other',content:'Other customer reply'}],hasOlderMessages:false});
      return res.status(404).json({error:'NOT_FOUND'});
    });
    app.use('/portal-assets',express.static(resolve('src/portal/ui'),{dotfiles:'allow'}));
    app.use((_req,res)=>res.sendFile(resolve('src/portal/ui/index.html'),{dotfiles:'allow'}));
    const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
    const browser=await chromium.launch({headless:true});
    try{
      const page=await browser.newPage(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
      await page.clock.install();
      await page.goto('http://127.0.0.1:'+(server.address() as any).port+'/app/inbox/chat-a');
      const log=page.getByRole('log');await log.getByText('Newest WhatsApp reply',{exact:true}).waitFor();
      await page.getByRole('button',{name:'Load older messages',exact:true}).click();
      await log.getByText('Older customer message',{exact:true}).waitFor();
      expect(await log.getByText('Newest WhatsApp reply',{exact:true}).count()).toBe(1);
      expect(await page.getByRole('button',{name:'Load older messages',exact:true}).count()).toBe(0);
      await page.getByRole('button',{name:'Report a problem',exact:true}).click();
      const note=page.getByPlaceholder('Wrong fact, missed question, wrong language…');
      await note.fill('The requested service was changed without confirmation.');
      const loadsBefore=detailLoads;
      await page.clock.fastForward(4500);
      await page.waitForResponse(response=>response.url().includes('/client/conversations/chat-a?'));
      expect(detailLoads).toBeGreaterThan(loadsBefore);
      expect(await note.isVisible()).toBe(true);
      expect(await note.inputValue()).toBe('The requested service was changed without confirmation.');
      await page.locator('[data-flag-form]').getByRole('button',{name:'Report a problem',exact:true}).click();
      await page.getByRole('status').filter({hasText:'Problem reported to your administrator.'}).waitFor();
      expect(report).toEqual({messageId:'recent',note:'The requested service was changed without confirmation.'});
      expect(await note.isVisible()).toBe(false);
      await log.getByText('Reported · Under review',{exact:true}).waitFor();
      await page.reload();
      await page.getByRole('log').getByText('Reported · Under review',{exact:true}).waitFor();
      expect(await page.locator('.sidebar').getByText('Answer reviews',{exact:true}).count()).toBe(0);
      await page.getByRole('navigation',{name:'Conversations list'}).getByRole('button').filter({hasText:'chat-b'}).click();
      await log.getByText('Other customer reply',{exact:true}).waitFor();
      expect(await log.getByText('Older customer message',{exact:true}).count()).toBe(0);
      expect(errors).toEqual([]);
    }finally{await browser.close();await new Promise<void>(r=>server.close(()=>r()));}
  });
  it('renders Today and the admin correction sequence on desktop, mobile and Arabic',async()=>{
    const app=express();app.use(express.json());
    let admin=false,retested=false,resolved=false;
    const item={id:'review-1',conversationId:'chat-1',question:'What time do you open?',answer:'Wrong opening hours',note:'Hours incorrect',status:'OPEN',createdAt:new Date().toISOString()};
    app.use('/api',(req,res)=>{
      if(req.path==='/auth/session')return res.json({user:{id:'user-1',name:'Test owner',role:admin?'ADMIN':'CLIENT'},csrf:'test',accounts:[]});
      if(req.path==='/client/profile')return res.json({profile:{plan:{modules:['services']}}});
      if(req.path==='/client/actions')return res.json({handoffs:[{id:'chat-1',customer:'Amina',url:'/app/inbox/chat-1'}],requests:[{id:'lead-1',customer:'Karim',assigneeName:'Salma',url:'/app/leads/lead-1'}],feedback:[{id:'review-1',url:'/app/answer-reviews'}]});
      if(req.path.endsWith('/retest')){retested=true;return res.json({answer:'We open at 9 AM',mode:'published'});}
      if(req.path.endsWith('/resolve')){resolved=true;return res.json({success:true});}
      if(req.path.endsWith('/answer-feedback'))return res.json({feedback:[{...item,status:resolved?'RESOLVED':'OPEN',...(retested?{retestMode:'published',retestAt:new Date().toISOString(),retestAnswer:'We open at 9 AM'}:{})}]});
      return res.status(404).json({error:'NOT_FOUND'});
    });
    app.use('/portal-assets',express.static(resolve('src/portal/ui'),{dotfiles:'allow'}));
    app.use((_req,res)=>res.sendFile(resolve('src/portal/ui/index.html'),{dotfiles:'allow'}));
    const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
    const origin='http://127.0.0.1:'+(server.address() as any).port;
    const browser=await chromium.launch({headless:true});
    try{
      const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors:string[]=[];
      page.on('pageerror',error=>errors.push(error.message));
      await page.goto(origin+'/app/today');
      await page.getByRole('heading',{name:'Today',exact:true}).waitFor();
      expect(await page.getByText('Amina',{exact:true}).count()).toBe(1);
      expect(await page.getByText('Chatbot answers to improve',{exact:true}).count()).toBe(0);
      expect(await page.locator('.sidebar').getByText('Answer reviews',{exact:true}).count()).toBe(0);
      expect(await page.getByText('New request · Salma',{exact:true}).count()).toBe(1);
      await page.locator('.language-select').selectOption('ar');
      await page.getByRole('heading',{name:'اليوم',exact:true}).waitFor();
      expect(await page.locator('html').getAttribute('dir')).toBe('rtl');
      await page.setViewportSize({width:390,height:844});
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await page.locator('.language-select').selectOption('en');
      admin=true;await page.goto(origin+'/admin/client/account-1/answer-reviews');
      await page.getByRole('heading',{name:'Answer reviews',exact:true}).waitFor();
      expect(await page.getByRole('button',{name:'Mark reviewed',exact:true}).isDisabled()).toBe(true);
      await page.getByRole('button',{name:'Retest published',exact:true}).click();
      await page.getByText('We open at 9 AM',{exact:true}).waitFor();
      await page.locator('[data-resolution]').fill('Corrected and published opening hours; the new answer is accurate.');
      await page.getByRole('button',{name:'Mark reviewed',exact:true}).click();
      await page.getByText('Reviewed',{exact:true}).waitFor();
      expect(resolved).toBe(true);expect(errors).toEqual([]);
    }finally{await browser.close();await new Promise<void>(r=>server.close(()=>r()));}
  });
  it.each([false,true])('simplifies follow-ups and preserves details for commerce=%s in three languages',async(commerce)=>{
    const app=express();app.use(express.json());
    let lead:any={id:'one',status:'NEW',sourceRequest:'I would like more information',conversationId:'chat-1',customerPhone:'212600000000',details:{},workflowDetails:{product:'Shoes',quantity:'2',city:'Rabat'},createdAt:new Date().toISOString()};
    const updates:any[]=[];
    app.use('/api',(req,res)=>{
      if(req.path==='/auth/session')return res.json({user:{id:'owner',name:'Owner',role:'CLIENT'},csrf:'test',accounts:[]});
      if(req.path==='/client/profile')return res.json({profile:{commerceActive:commerce,plan:{modules:[commerce?'commerce':'services']}}});
      if(req.path==='/client/team')return res.json({members:[]});
      if(req.path==='/client/leads/one'){
        if(req.method==='PATCH'){updates.push(req.body);lead={...lead,...req.body};}
        return res.json({lead});
      }
      return res.status(404).json({error:'NOT_FOUND'});
    });
    app.use('/portal-assets',express.static(resolve('src/portal/ui'),{dotfiles:'allow'}));
    app.use((_req,res)=>res.sendFile(resolve('src/portal/ui/index.html'),{dotfiles:'allow'}));
    const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
    const browser=await chromium.launch({headless:true});
    try{
      const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
      await page.goto('http://127.0.0.1:'+(server.address() as any).port+'/app/leads/one');
      await page.getByRole('heading',{name:'Customer request',exact:true}).waitFor();
      expect(await page.getByRole('link',{name:'Reply',exact:true}).getAttribute('href')).toBe('/app/inbox/chat-1');
      expect(await page.getByText('Qualified',{exact:true}).isVisible()).toBe(false);
      expect(await page.getByLabel('Sales stage').isVisible()).toBe(false);
      await page.getByLabel('Remind me on',{exact:true}).fill('2030-01-02T09:00');
      await page.getByRole('button',{name:'Remind me later',exact:true}).click();
      await page.getByText('Later',{exact:true}).waitFor();
      expect(updates[0].followUpAt).toBeTruthy();
      expect(updates[0].status).toBe('NEW');
      if(commerce){expect(updates[0].details).toMatchObject({product:'Shoes',quantity:'2',city:'Rabat'});}
      await page.getByRole('button',{name:'Done',exact:true}).click();
      await page.getByRole('button',{name:'Reopen',exact:true}).waitFor();
      expect(updates[1].status).toBe('DONE');expect(updates[1].followUpAt).toBeNull();
      expect(updates.some(update=>update.status==='WON')).toBe(false);
      await page.locator('.language-select').selectOption('fr');
      await page.getByRole('link',{name:'Répondre',exact:true}).waitFor();
      await page.locator('.language-select').selectOption('ar');
      await page.getByRole('link',{name:'الرد',exact:true}).waitFor();
      expect(await page.locator('html').getAttribute('dir')).toBe('rtl');
      await page.setViewportSize({width:390,height:844});
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      expect(errors).toEqual([]);
    }finally{await browser.close();await new Promise<void>(r=>server.close(()=>r()));}
  });

});
