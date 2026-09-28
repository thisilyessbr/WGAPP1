import {it,expect,vi} from 'vitest';
import {chromium} from 'playwright';
import express from 'express';
import {resolve} from 'node:path';
import {mkdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import QRCode from 'qrcode';
import {portalDatabase} from '../helpers/portal-db';
import {PortalStore} from '../../src/portal/PortalStore';
import {PortalAuth,hashPassword} from '../../src/portal/PortalAuth';
import {PortalBudget} from '../../src/portal/PortalBudget';
import {PortalDocuments} from '../../src/portal/PortalDocuments';
import {PortalConnections} from '../../src/portal/PortalConnections';
import {createPortalRouter} from '../../src/portal/PortalRouter';
import {validatePlan} from '../../src/portal/validation';

it('keeps API first and requires plan, admin approval and client acceptance in the browser',async()=>{
  const database=await portalDatabase(),store=new PortalStore(database.db),budget=new PortalBudget(store);
  const password='QR-browser-test-only-2026!',email='qr-browser@example.test';
  const owner=await store.register(email,'QR Browser Client',await hashPassword(password),null);
  await store.db.$executeRaw`UPDATE "PortalUser" SET "verifiedAt"=NOW() WHERE id=${owner.userId}`;
  const plan=await store.savePlan(owner.userId,validatePlan({name:'QR pilot',modules:['services','qr'],limits:{numbers:2}}));
  const p=await store.profile(owner.accountId);await store.updateAccount(owner.userId,owner.accountId,p.revision,{planId:plan.id});
  await store.db.$executeRaw`UPDATE "PortalProfile" SET status='APPROVED' WHERE "accountId"=${owner.accountId}`;
  const code=await QRCode.toDataURL('QR browser test fixture; not a WhatsApp session');
  const manager={isEnabled:()=>true,getQr:async()=>({dataUrl:code,expiresAt:Date.now()+60000}),createConnection:vi.fn(async()=>{
    const id=randomUUID();
    await store.db.$executeRaw`INSERT INTO "ChannelConnection"(id,"tenantId","accountId",provider,"connectionKey",status,"updatedAt") VALUES (${id},${owner.tenantId},${owner.accountId},'QR_WEB',${id},'QR_REQUIRED',NOW())`;
    await store.db.$executeRaw`INSERT INTO "WhatsAppBusinessNumber"(id,"tenantId","accountId","phoneNumberId",transport,"connectionId",enabled,status,"updatedAt") VALUES (${randomUUID()},${owner.tenantId},${owner.accountId},${'qr:'+id},'QR_WEB',${id},false,'QR_REQUIRED',NOW())`;
    return {connection:{id}};
  })};
  const app=express();app.use(express.json());const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
  const origin='http://127.0.0.1:'+(server.address() as any).port;
  const auth=new PortalAuth(store,{publicUrl:origin,developmentLinks:true}),docs=new PortalDocuments(store,budget,{} as any,{} as any);
  const connections=new PortalConnections(store,{qrSessionManager:manager} as any);
  app.use('/api',createPortalRouter({store,auth,documents:docs,connections},{qrSessionManager:manager} as any));
  app.use('/portal-assets',express.static(resolve('src/portal/ui'),{dotfiles:'allow'}));app.use((_req,res)=>res.sendFile(resolve('src/portal/ui/index.html'),{dotfiles:'allow'}));
  let browser;
  try{
    browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(8000);
    const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(origin+'/login');await page.getByLabel('Email address').fill(email);await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Log in',exact:true}).click();await page.waitForURL('**/app');
    await page.goto(origin+'/app/whatsapp');await page.getByRole('heading',{name:'Connect WhatsApp',exact:true}).waitFor();
    expect(await page.locator('#prepare-meta').count()).toBe(1);expect(await page.locator('#prepare-qr').count()).toBe(0);
    await store.setQrAllowed(owner.userId,owner.accountId,true);await page.reload();await page.locator('#prepare-qr').waitFor();
    expect(await page.locator('#prepare-qr').isDisabled()).toBe(true);
    await page.locator('#qr-risk-accepted').check();await page.locator('#prepare-qr').click();await page.locator('#qr-view img').waitFor();
    expect(manager.createConnection).toHaveBeenCalledTimes(1);expect((await store.profile(owner.accountId)).qrConsentAt).toBeTruthy();
    expect(await page.locator('#qr-view img').evaluate((i:HTMLImageElement)=>i.complete&&i.naturalWidth>0)).toBe(true);
    mkdirSync(resolve('output/qr-pilot'),{recursive:true});await page.screenshot({path:resolve('output/qr-pilot/client-desktop.png'),fullPage:true});
    await page.locator('.language-select').selectOption('ar');await page.getByRole('heading',{name:'رقم إضافي عبر رمز QR'}).waitFor();
    await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    await page.screenshot({path:resolve('output/qr-pilot/client-arabic-mobile.png'),fullPage:true});
    await store.setQrAllowed(owner.userId,owner.accountId,false);await page.reload();await page.locator('.connection-card').waitFor();
    expect(await page.locator('#prepare-qr').count()).toBe(0);expect(await page.locator('#qr-risk-accepted').count()).toBe(0);expect(errors).toEqual([]);
  }finally{await browser?.close();budget.dispose();await new Promise<void>(r=>server.close(()=>r()));await database.pg.close();}
},60000);
