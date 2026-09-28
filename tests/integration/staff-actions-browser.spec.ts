import { describe,it,expect } from 'vitest';
import { chromium } from 'playwright';
import express from 'express';
import { resolve } from 'path';

describe('staff action screens',()=>{
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
});
