import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { portalDatabase } from '../helpers/portal-db';
import { PortalStore } from '../../src/portal/PortalStore';
import { PortalAuth, hashPassword, hashToken } from '../../src/portal/PortalAuth';
import { PortalBudget } from '../../src/portal/PortalBudget';
import { PortalDocuments } from '../../src/portal/PortalDocuments';
import { PortalConnections } from '../../src/portal/PortalConnections';
import { createPortalRouter } from '../../src/portal/PortalRouter';
import { validateAdminConfig, validatePlan } from '../../src/portal/validation';
import { portalBusinessEvidence } from '../../src/portal/BusinessFacts';

describe('portal PostgreSQL and HTTP boundaries', () => {
  let database: Awaited<ReturnType<typeof portalDatabase>>, store: PortalStore, budget: PortalBudget, auth: PortalAuth, docs: PortalDocuments, connections: PortalConnections, app: express.Express;
  let passwordHash: string, admin: any, plan: any;
  const password = 'Portal-test-password-2026!', delivered: { email: string; kind: string; url: string }[] = [];
  const onboarding = { generateSignupState: () => randomUUID(), prepareSignup: vi.fn(async () => ({
    encryptedToken: 'encrypted-test-token', candidates: [{ wabaId: 'waba-a', phoneNumberId: 'phone-a', displayPhoneNumber: '+212 600000001' }]
  })), processEmbeddedSignupCallback: vi.fn(async () => ({ success: true })) };
  beforeAll(async () => {
    database = await portalDatabase(); store = new PortalStore(database.db); budget = new PortalBudget(store);
    auth = new PortalAuth(store, { publicUrl: 'http://localhost', sendLink: async (email, kind, url) => { delivered.push({ email, kind, url }); } });
    docs = new PortalDocuments(store, budget, { ingestPdf: vi.fn(async () => 'source-test') } as any, { getEffectiveConfig: vi.fn(async () => ({})) } as any);
    connections = new PortalConnections(store, { whatsAppOnboardingService: onboarding, qrSessionManager: { isEnabled: () => false } } as any);
    app = express(); app.use(express.json()); app.use('/api', createPortalRouter({ store, auth, documents: docs, connections }, { conversationEngine: { previewMessage: vi.fn(async () => 'Preview reply') } } as any));
    passwordHash = await hashPassword(password);
    const id = randomUUID(); await store.db.$executeRaw`INSERT INTO "PortalUser"(id,email,name,"passwordHash",role,"verifiedAt") VALUES (${id},'admin@portal.test','Admin',${passwordHash},'ADMIN',NOW())`;
    admin = await store.userById(id);
    plan = await store.savePlan(id, validatePlan({ name: 'Test plan', published: true, modules: ['commerce','knowledge','services'], limits: { monthlyUsd: 1, messages: 2, llmCalls: 2, numbers: 1, documents: 1 } }));
  }, 60000);
  afterAll(async () => { budget?.dispose(); await database?.pg.close(); });
  async function client() {
    const result = await store.register(randomUUID()+'@portal.test', 'Test business', passwordHash, plan.id);
    await store.db.$executeRaw`UPDATE "PortalUser" SET "verifiedAt"=NOW() WHERE id=${result.userId}`;
    return { ...result, user: await store.userById(result.userId) };
  }
  async function cookie(user: any) {
    const raw = randomUUID().replaceAll('-','') + randomUUID().replaceAll('-',''), csrf = randomUUID();
    await store.newSession(user.id, hashToken(raw), csrf, new Date(Date.now()+60000));
    return { Cookie: 'relayqo_portal='+raw, 'X-CSRF-Token': csrf, Origin: 'http://localhost' };
  }
  async function approved(c: any) {
    let p = await store.profile(c.accountId);
    p = await store.saveDraft(c.userId,c.accountId,c.tenantId,{...p.draft,description:'A Moroccan shop',policies:{...p.draft.policies,shipping:'Delivery in 48 hours'},products:[{sku:'P1',name:'Shoes',description:'Handmade',price:99.5,stock:5,category:'Shoes',variants:[{sku:'P1-42',size:'42',color:'Black',stock:2,price:null}]}]},p.revision);
    p = await store.updateAccount(admin.id,c.accountId,p.revision,{planId:plan.id});
    return store.publish(admin.id,c.accountId,p.revision);
  }
  async function active(c: any) {
    const p = await approved(c);
    await store.db.$executeRaw`INSERT INTO "WhatsAppBusinessNumber"(id,"tenantId","accountId","phoneNumberId",status,"updatedAt") VALUES (${randomUUID()},${c.tenantId},${c.accountId},${randomUUID()},'CONNECTED',NOW())`;
    return store.updateAccount(admin.id,c.accountId,p.revision,{status:'ACTIVE'});
  }
  it('freezes and unfreezes one client without blocking admin edits or plan requests', async () => {
    const c = await client(), other = await client();
    const adminHeaders = await cookie(admin), clientHeaders = await cookie(c.user);
    const original = await store.profile(c.accountId);
    const frozen = await request(app).patch('/api/admin/accounts/' + c.accountId + '/editing-freeze')
      .set(adminHeaders).send({ frozen: true });
    expect(frozen.status).toBe(200);
    expect((await store.profile(c.accountId)).editingFrozen).toBe(true);
    expect((await store.profile(other.accountId)).editingFrozen).toBe(false);
    expect((await request(app).put('/api/client/business').set(clientHeaders)
      .send({ data: original.draft, revision: frozen.body.profile.revision })).status).toBe(403);
    expect((await request(app).post('/api/client/documents').set(clientHeaders).send()).status).toBe(403);
    expect((await request(app).post('/api/client/plan-request').set(clientHeaders).send({ planId: plan.id })).status).toBe(200);
    const current = await store.profile(c.accountId);
    expect((await request(app).put('/api/admin/accounts/' + c.accountId + '/business').set(adminHeaders)
      .send({ data: { ...current.draft, description: 'Admin update while frozen' }, revision: current.revision })).status).toBe(200);
    expect((await request(app).patch('/api/admin/accounts/' + c.accountId + '/editing-freeze').set(clientHeaders)
      .send({ frozen: false })).status).toBe(403);
    expect((await request(app).patch('/api/admin/accounts/' + c.accountId + '/editing-freeze').set(adminHeaders)
      .send({ frozen: false })).status).toBe(200);
    const editable = await store.profile(c.accountId);
    expect((await request(app).put('/api/client/business').set(clientHeaders)
      .send({ data: editable.draft, revision: editable.revision })).status).toBe(200);
  });
  it('signup creates an isolated draft account, without granting privileges', async () => {
    const r=await request(app).post('/api/auth/signup').set('Origin','http://localhost').send({email:'signup@portal.test',name:'New client',password,role:'ADMIN'});expect(r.status).toBe(400);
    const signup=await request(app).post('/api/auth/signup').send({email:'signup@portal.test',name:'New client',password});expect(signup.status).toBe(201);
    const user=await store.userByEmail('signup@portal.test');expect(user?.role).toBe('CLIENT');expect(user?.verifiedAt).toBeNull();
    const login=await request(app).post('/api/auth/login').send({email:user!.email,password});expect(login.status).toBe(403);
    const link=delivered.find(d=>d.email===user!.email&&d.kind==='VERIFY')!;const token=new URLSearchParams(new URL(link.url).hash.slice(1)).get('token');
    expect((await request(app).post('/api/auth/verify-email').send({token})).status).toBe(200);
    expect((await request(app).post('/api/auth/verify-email').send({token})).status).toBe(400);
    const ok=await request(app).post('/api/auth/login').send({email:user!.email,password});expect(ok.status).toBe(200);expect(ok.headers['set-cookie'][0]).toContain('HttpOnly');expect(JSON.stringify(ok.body)).not.toContain('passwordHash');
  });
  it('creates accounts without a signup plan and lets admins find the owner by name or email', async () => {
    const address = randomUUID() + '@portal.test';
    const signup = await request(app).post('/api/auth/signup').send({ email: address, name: 'Layla Owner', password, planId: plan.id });
    expect(signup.status).toBe(400);
    expect((await request(app).post('/api/auth/signup').send({ email: address, name: 'Layla Owner', password })).status).toBe(201);
    const user = await store.userByEmail(address);
    const memberships = await store.memberships(user!.id);
    const found = (await store.accounts('Layla Owner')).find(a => a.accountId === memberships[0].accountId);
    expect(found).toMatchObject({ clientName: 'Layla Owner', clientEmail: address, planId: null });
    expect((await store.accounts(address)).some(a => a.accountId === found.accountId)).toBe(true);
  });
  it('temporarily permits new client signup without email but keeps existing unverified users blocked', async () => {
    vi.stubEnv('RESEND_API_KEY', '');
    vi.stubEnv('PORTAL_MAIL_WEBHOOK_URL', '');
    vi.stubEnv('PORTAL_MAIL_WEBHOOK_SECRET', '');
    vi.stubEnv('PORTAL_DEV_SKIP_EMAIL', 'false');
    const noMailAuth = new PortalAuth(store, { publicUrl: 'http://localhost' });
    try {
      const address = randomUUID() + '@portal.test';
      const created = await noMailAuth.signup({ email: address, name: 'No mail test', password }, 'signup-test-ip');
      expect(created).toMatchObject({ redirect: '/login' });
      const user = await store.userByEmail(address);
      expect(user?.verifiedAt).toBeTruthy();
      const response = { cookie: vi.fn() } as any;
      expect(await noMailAuth.login({ email: address, password }, 'login-test-ip', response)).toMatchObject({ redirect: '/app' });
      expect(response.cookie).toHaveBeenCalledOnce();
      const unverifiedAddress = randomUUID() + '@portal.test';
      await store.register(unverifiedAddress, 'Earlier signup', passwordHash, null);
      await noMailAuth.signup({ email: unverifiedAddress, name: 'Earlier signup', password }, 'signup-test-ip');
      expect((await store.userByEmail(unverifiedAddress))?.verifiedAt).toBeNull();
      await expect(noMailAuth.login({ email: unverifiedAddress, password }, 'login-test-ip', response)).rejects.toMatchObject({ code: 'EMAIL_NOT_VERIFIED' });
      vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-02T00:00:00Z'));
      await expect(noMailAuth.signup({ email: randomUUID() + '@portal.test', name: 'Expired', password }, 'signup-test-ip'))
        .rejects.toMatchObject({ code: 'EMAIL_SETUP_REQUIRED' });
    } finally { vi.restoreAllMocks(); vi.unstubAllEnvs(); }
  });
  it('shows only account-scoped admin conversation transcripts', async () => {
    const c = await client(), other = await client(), headers = await cookie(admin);
    const customerId = randomUUID(), conversationId = randomUUID(), messageId = randomUUID();
    await store.db.$executeRaw`INSERT INTO "Customer"(id,"tenantId","externalId","updatedAt") VALUES (${customerId},${c.tenantId},'+212600000001',NOW())`;
    await store.db.$executeRaw`INSERT INTO "Conversation"(id,"tenantId","accountId","customerId","messageCount","updatedAt") VALUES (${conversationId},${c.tenantId},${c.accountId},${customerId},1,NOW())`;
    await store.db.$executeRaw`INSERT INTO "Message"(id,"tenantId","conversationId",role,content) VALUES (${messageId},${c.tenantId},${conversationId},'USER','Hello, do you deliver?')`;
    const list = await request(app).get('/api/admin/accounts/' + c.accountId + '/conversations').set(headers);
    expect(list.status).toBe(200);
    expect(list.body.conversations.find((row: any) => row.id === conversationId)).toMatchObject({ customerId: '+212600000001', lastMessage: 'Hello, do you deliver?' });
    const detail = await request(app).get('/api/admin/accounts/' + c.accountId + '/conversations/' + conversationId).set(headers);
    expect(detail.body).toMatchObject({ hasMore: false, messages: [{ content: 'Hello, do you deliver?' }] });
    expect((await request(app).get('/api/admin/accounts/' + other.accountId + '/conversations/' + conversationId).set(headers)).status).toBe(404);
  });
  it('requires email confirmation for every administrator login', async () => {
    const r=await request(app).post('/api/auth/login').send({email:admin.email,password});expect(r.body.requiresEmailConfirmation).toBe(true);expect(r.headers['set-cookie']).toBeUndefined();
    const link=delivered.findLast(d=>d.kind==='ADMIN_LOGIN')!;const token=new URLSearchParams(new URL(link.url).hash.slice(1)).get('token');
    expect((await request(app).post('/api/auth/admin-confirm').send({token})).body.redirect).toBe('/admin');
    expect((await request(app).post('/api/auth/admin-confirm').send({token})).status).toBe(400);
  });
  it('skips email locally without verifying users, bypassing passwords or widening roles', async () => {
    vi.stubEnv('PORTAL_DEV_SKIP_EMAIL', 'true');
    try {
      const sent = delivered.length;
      const signup = await request(app).post('/api/auth/signup').send({email:'local-testing@portal.test',name:'Local test',password});
        expect(signup.status).toBe(201); expect(signup.body.redirect).toBe('/login');
        expect(signup.headers['set-cookie']).toBeUndefined(); expect(signup.body.csrf).toBeUndefined();
        expect((await request(app).get('/api/client/profile')).status).toBe(401);
      const user = await store.userByEmail('local-testing@portal.test'); expect(user?.verifiedAt).toBeNull();
        const login = await request(app).post('/api/auth/login').send({email:user!.email,password});
        expect(login.body.redirect).toBe('/app');
        const headers = { Cookie: login.headers['set-cookie'][0].split(';')[0] };
      expect((await request(app).get('/api/client/profile').set(headers)).status).toBe(200);
      expect((await request(app).get('/api/admin/accounts').set(headers)).status).toBe(403);
      expect((await request(app).post('/api/auth/login').send({email:user!.email,password:'Incorrect-password'})).status).toBe(401);
      const duplicate = await request(app).post('/api/auth/signup').send({email:user!.email,name:'Imposter',password:'Different-password-2026!'});
      expect(duplicate.headers['set-cookie']).toBeUndefined();
      expect((await request(app).post('/api/auth/login').send({email:user!.email,password})).body.redirect).toBe('/app');
      expect((await request(app).post('/api/auth/login').send({email:admin.email,password})).body.redirect).toBe('/admin');
      expect(delivered.length).toBe(sent);
      vi.stubEnv('PORTAL_DEV_SKIP_EMAIL', 'false');
      expect((await request(app).get('/api/client/profile').set(headers)).status).toBe(401);
      expect((await request(app).post('/api/auth/login').send({email:user!.email,password})).status).toBe(403);
    } finally { vi.unstubAllEnvs(); }
  });
  it('denies unauthenticated and cross-role access', async () => {
    expect((await request(app).get('/api/admin/accounts')).status).toBe(401);
    const c=await client(), headers=await cookie(c.user);
    expect((await request(app).get('/api/admin/accounts').set(headers)).status).toBe(403);
    expect((await request(app).patch('/api/admin/accounts/'+c.accountId).set(headers).send({status:'ACTIVE'})).status).toBe(403);
  });
  it('rejects cross-account headers and filters secrets from client responses', async () => {
    const a=await client(), b=await client(), headers=await cookie(a.user);
    expect((await request(app).get('/api/client/profile').set(headers).set('X-Account-Id',b.accountId)).status).toBe(403);
    const r=await request(app).get('/api/client/profile').set(headers);expect(r.body.profile.accountId).toBe(a.accountId);expect(r.body.profile).not.toHaveProperty('adminConfig');expect(r.body.profile).not.toHaveProperty('tenantId');
    await expect(store.profile(b.accountId,a.tenantId)).rejects.toMatchObject({status:404});
  });
  it('serves a tenant-isolated client dashboard and previews drafts before activation', async () => {
    const c=await client(),clientHeaders=await cookie(c.user),adminHeaders=await cookie(admin);
    const dashboard=await request(app).get('/api/client/dashboard').set(clientHeaders);
    expect(dashboard.status).toBe(200);expect(dashboard.body.profile.accountId).toBe(c.accountId);
    expect(dashboard.body).toHaveProperty('metrics.totals');expect(dashboard.body).toHaveProperty('documents');
    expect(dashboard.body.metrics).not.toHaveProperty('usage');expect(dashboard.body.profile.plan).toBeNull();
    const publishedPlans=await request(app).get('/api/portal/plans');
    expect(publishedPlans.body.plans[0]).not.toHaveProperty('limits');
    expect(JSON.stringify(dashboard.body)).not.toContain('spentMicros');expect(JSON.stringify(dashboard.body)).not.toContain('adminConfig');
    const adminOverview=await request(app).get('/api/admin/overview').set(adminHeaders);
    expect(adminOverview.status).toBe(200);expect(adminOverview.body).toHaveProperty('traffic.conversations');
    expect(adminOverview.body).toHaveProperty('connectedNumbers');expect(adminOverview.body).toHaveProperty('failedDeliveries');
    expect(Array.isArray(adminOverview.body.daily)).toBe(true);
    const preview=await request(app).post('/api/admin/accounts/'+c.accountId+'/preview').set(adminHeaders)
      .send({message:'Salam, chno katbi3o?',mode:'draft',sessionId:'draftsession01'});
    expect(preview.status).toBe(200);expect(preview.body).toMatchObject({response:'Preview reply',mode:'draft',sessionId:'draftsession01'});
    const afterPreview=await request(app).get('/api/admin/overview').set(adminHeaders);
    expect(afterPreview.body.traffic).toEqual(adminOverview.body.traffic);
    const published=await request(app).post('/api/admin/accounts/'+c.accountId+'/preview').set(adminHeaders)
      .send({message:'Hello',mode:'published',sessionId:'publishedsession01'});
    expect(published.status).toBe(400);expect(published.body.error).toBe('PUBLISH_FIRST');
  });
  it('blocks missing CSRF, multibyte CSRF and cross-site mutations', async () => {
    const c=await client(), headers=await cookie(c.user), p=await store.profile(c.accountId);
    for(const token of ['', 'é'.repeat(headers['X-CSRF-Token'].length)]) expect((await request(app).put('/api/client/business').set(headers).set('X-CSRF-Token',token).send({data:p.draft,revision:p.revision})).status).toBe(403);
    expect((await request(app).post('/api/auth/login').set('Origin','https://attacker.test').send({email:c.user.email,password})).status).toBe(403);
  });
  it('rejects technical data injection and stale saves; admin can edit locked fields', async () => {
    const c=await client();let p=await store.profile(c.accountId);
    await expect(store.saveDraft(c.userId,c.accountId,c.tenantId,{...p.draft,llm:{maxTokens:9999}},p.revision)).rejects.toMatchObject({code:'FIELD_NOT_ALLOWED'});
    p=await store.updateAccount(admin.id,c.accountId,p.revision,{lockedFields:['name']});
    await expect(store.saveDraft(c.userId,c.accountId,c.tenantId,{...p.draft,name:'Client override'},p.revision)).rejects.toMatchObject({code:'FIELD_LOCKED'});
    const updated=await store.saveDraft(admin.id,c.accountId,c.tenantId,{...p.draft,name:'Admin correction'},p.revision,true);expect(updated.draft.name).toBe('Admin correction');
    await expect(store.saveDraft(c.userId,c.accountId,c.tenantId,updated.draft,p.revision)).rejects.toMatchObject({code:'REVISION_CONFLICT'});
  });
  it('publishes catalog variants and policy facts to the correct account', async () => {
    const c=await client();await approved(c);
    const rows=await store.db.$queryRaw<any[]>`SELECT config FROM "Account" WHERE id=${c.accountId}`;expect(rows[0].config.capabilities.ecommerceEnabled).toBe(true);expect(portalBusinessEvidence(rows[0].config,'delivery')).toContain('48 hours');
    const products=await store.db.$queryRaw<any[]>`SELECT * FROM "Product" WHERE "accountId"=${c.accountId}`;expect(Number(products[0].price)).toBe(99.5);
    const variants=await store.db.$queryRaw<any[]>`SELECT * FROM "ProductVariant" WHERE "productId"=${products[0].id}`;expect(variants[0].sku).toBe('P1-42');
  });
  it('saves a newly selected plan and workflow in the same publication request', async () => {
    const c=await client(), headers=await cookie(admin);let p=await store.profile(c.accountId);
    const workflow={id:'contact',name:'Contact',description:'Collect details',initialState:'name',states:{name:{type:'collect',field:'fullName',prompt:{fr:'Votre nom ?',darija:'Chno smitek?'},next:'done'},done:{type:'end',prompt:'Merci'}}};
    const r=await request(app).post('/api/admin/accounts/'+c.accountId+'/publish').set(headers).send({revision:p.revision,changes:{planId:plan.id,adminConfig:{workflows:{contact:workflow},capabilities:{intents:[{id:'CONTACT',description:'Contact request',workflowId:'contact'}]}}}});
    expect(r.status).toBe(200);expect(r.body.profile.planId).toBe(plan.id);expect(r.body.profile.status).toBe('APPROVED');expect(r.body.profile.published).not.toBeNull();
    const runtime=(await store.db.$queryRaw<any[]>`SELECT config FROM "Account" WHERE id=${c.accountId}`)[0].config;
    expect(runtime.workflows.contact.states.name.prompt.darija).toBe('Chno smitek?');expect(runtime.capabilities.intents[0].workflowId).toBe('contact');
    const stale=await request(app).post('/api/admin/accounts/'+c.accountId+'/publish').set(headers).send({revision:p.revision,changes:{reviewNote:'stale'}});
    expect(stale.status).toBe(409);expect((await store.profile(c.accountId)).reviewNote).not.toBe('stale');
  });
  it('rolls back pending controls if combined publication fails', async () => {
    const c=await client(), headers=await cookie(admin),p=await store.profile(c.accountId);
    const before=(await store.auditHistory(c.accountId)).length;
    const r=await request(app).post('/api/admin/accounts/'+c.accountId+'/publish').set(headers).send({revision:p.revision,changes:{reviewNote:'Do not partially save',adminConfig:{identity:{botName:'Changed'}}}});
    expect(r.status).toBe(400);expect(r.body.error).toBe('PLAN_REQUIRED');
    const after=await store.profile(c.accountId);expect(after.revision).toBe(p.revision);expect(after.reviewNote).toBe(p.reviewNote);expect(after.adminConfig).toEqual(p.adminConfig);
    expect((await store.auditHistory(c.accountId)).length).toBe(before);
    expect((await request(app).post('/api/admin/accounts/'+c.accountId+'/publish').set(await cookie(c.user)).send({revision:p.revision,changes:{planId:plan.id}})).status).toBe(403);
    expect((await request(app).post('/api/admin/accounts/'+c.accountId+'/publish').set(headers).send({revision:p.revision,changes:{tenantId:'other'}})).status).toBe(400);
  });
  it('keeps plan snapshots stable and preserves suspension on publication restore', async () => {
    const c=await client();let p=await approved(c);const version=(await store.versions(c.accountId))[0];
    p=await store.updateAccount(admin.id,c.accountId,p.revision,{status:'SUSPENDED',adminConfig:{llm:{maxTokens:123}}});
    p=await store.restore(admin.id,c.accountId,version.id,p.revision);expect(p.status).toBe('SUSPENDED');expect(p.adminConfig.llm.maxTokens).toBe(123);expect(p.planSnapshot!.revision).toBe(plan.revision);
    const a=await store.db.$queryRaw<any[]>`SELECT enabled FROM "Account" WHERE id=${c.accountId}`;expect(a[0].enabled).toBe(false);
  });
  it('publishes a larger catalog in batches and retires removed entries', async () => {
    const c=await client();let p=await approved(c);
    const products=Array.from({length:50},(_,i)=>({sku:'batch-'+i,name:'Product '+i,description:'',price:10,stock:20,category:'',variants:Array.from({length:20},(_,j)=>({sku:'v-'+j,size:String(j),color:'',stock:1,price:null}))}));
    p=await store.saveDraft(c.userId,c.accountId,c.tenantId,{...p.draft,products},p.revision);
    p=await store.publish(admin.id,c.accountId,p.revision);
    const rows=await store.db.$queryRaw<any[]>`SELECT COUNT(*)::int AS n FROM "ProductVariant" v JOIN "Product" p ON p.id=v."productId" WHERE p."accountId"=${c.accountId} AND v.active=true AND p.active=true`;
    expect(rows[0].n).toBe(1000);
    p=await store.saveDraft(c.userId,c.accountId,c.tenantId,{...p.draft,products:[]},p.revision);await store.publish(admin.id,c.accountId,p.revision);
    expect((await store.db.$queryRaw<any[]>`SELECT COUNT(*)::int AS n FROM "Product" WHERE "accountId"=${c.accountId} AND active=true`)[0].n).toBe(0);
  });
  it('requires published data, verified user and WhatsApp for activation', async () => {
    const c=await client();let p=await store.profile(c.accountId);
    await expect(store.updateAccount(admin.id,c.accountId,p.revision,{status:'ACTIVE'})).rejects.toMatchObject({code:'ACTIVATION_NOT_READY'});
    p=await approved(c);await expect(store.updateAccount(admin.id,c.accountId,p.revision,{status:'ACTIVE'})).rejects.toMatchObject({code:'WHATSAPP_NOT_CONNECTED'});
  });
  it('enforces concurrent message allowances and leaves legacy accounts untouched', async () => {
    const c=await client();await active(c);let calls=0;
    const result=await Promise.all(Array.from({length:6},(_,i)=>budget.runTurn(c.tenantId,c.accountId,'m'+i,async()=>{calls++;return 'ok';},'blocked')));
    expect(result.filter(x=>x==='ok')).toHaveLength(2);expect(calls).toBe(2);expect((await store.usage(c.accountId)).messages).toBe(2);
    expect(await budget.runTurn('legacy','legacy','x',async()=> 'legacy reply','blocked')).toBe('legacy reply');
  });
  it('allows unlimited message counts while retaining the internal monthly AI spend cap', async () => {
    const c=await client();let p=await active(c);
    p=await store.updateAccount(admin.id,c.accountId,p.revision,{limitOverrides:{messages:-1}});
    expect(p.planSnapshot!.limits.messages).toBe(-1);
    const result=await Promise.all(Array.from({length:6},(_,i)=>budget.runTurn(c.tenantId,c.accountId,'unlimited-'+i,async()=> 'ok','blocked')));
    expect(result).toEqual(Array(6).fill('ok'));
    expect((await store.usage(c.accountId)).messages).toBe(6);
    const snapshot={...p.planSnapshot,limits:{...p.planSnapshot!.limits,monthlyUsd:0}};
    await store.db.$executeRaw`UPDATE "PortalProfile" SET "planSnapshot"=${JSON.stringify(snapshot)}::jsonb WHERE "accountId"=${c.accountId}`;
    const generate=vi.fn(async()=> 'charged'), provider=budget.wrapLLM({generateResponse:generate} as any,{provider:'deepseek',model:'deepseek-flash'});
    await expect(budget.runTurn(c.tenantId,c.accountId,'unlimited-paid',()=>provider.generateResponse('system',[{role:'user',content:'hello'}]),'blocked')).rejects.toBeDefined();
    expect(generate).not.toHaveBeenCalled();
  });
  it('blocks paid provider calls before an exhausted budget is exceeded', async () => {
    const c=await client();let p=await active(c);
    const snapshot={...p.planSnapshot,limits:{...p.planSnapshot!.limits,monthlyUsd:0}};
    await store.db.$executeRaw`UPDATE "PortalProfile" SET "planSnapshot"=${JSON.stringify(snapshot)}::jsonb WHERE "accountId"=${c.accountId}`;
    const generate=vi.fn(async()=> 'charged'), provider=budget.wrapLLM({generateResponse:generate} as any,{provider:'deepseek',model:'deepseek-flash'});
    await expect(budget.runTurn(c.tenantId,c.accountId,'expensive',()=>provider.generateResponse('system',[{role:'user',content:'hello'}]),'blocked')).rejects.toBeDefined();expect(generate).not.toHaveBeenCalled();
  });
  it('records actual provider usage without clipping it to a reservation', async () => {
    const c=await client();await active(c);
    const provider=budget.wrapLLM({generateResponse:async(_p:any,_h:any,o:any)=>{o.onUsage({attempts:1,tokenSource:'provider',inputTokens:100000,outputTokens:10000});return 'ok';}} as any,{provider:'deepseek',model:'deepseek-flash'});
    await budget.runTurn(c.tenantId,c.accountId,'receipt',()=>provider.generateResponse('s',[{role:'user',content:'q'}]),'blocked');
    const u=await store.usage(c.accountId);expect(Number(u.spentMicros)).toBe(42000);expect(Number(u.reservedMicros)).toBe(0);
  });
  it('deduplicates PDFs, enforces limits and requires admin approval to index', async () => {
    const c=await client();await approved(c);const pdf=Buffer.from('%PDF-1.7\nTest\n%%EOF');
    const a=await docs.upload(c.userId,c.accountId,'../policy.pdf',pdf);expect((await docs.upload(c.userId,c.accountId,'same.pdf',pdf)).id).toBe(a.id);
    await expect(docs.upload(c.userId,c.accountId,'second.pdf',Buffer.from('%PDF-1.7\nSecond\n%%EOF'))).rejects.toMatchObject({code:'DOCUMENT_ALLOWANCE_REACHED'});
    expect((await docs.list(c.accountId))[0].filename).toBe('policy.pdf');
    await docs.queue(admin.id,c.accountId,a.id);await docs.tick();expect((await docs.list(c.accountId))[0].status).toBe('READY');
    await expect(docs.remove(c.userId,c.accountId,a.id,false)).rejects.toMatchObject({code:'DOCUMENT_REQUIRES_ADMIN'});
    const other=await client();await expect(docs.remove(other.userId,other.accountId,a.id,false)).rejects.toMatchObject({code:'DOCUMENT_NOT_FOUND'});
  });
  it('binds WhatsApp signup state to a client and makes callbacks single-use', async () => {
    vi.stubEnv('META_APP_ID','test-app');vi.stubEnv('META_CONFIG_ID','test-config');
    const a=await client(),b=await client();await approved(a);await approved(b);
    const principal={user:a.user,accountId:a.accountId,tenantId:a.tenantId,sessionId:'s',csrf:'c'} as any;
    const start=await connections.begin(principal);expect(await connections.begin(principal)).toEqual(start);
    const input={...start,code:'not-a-real-code',wabaId:'waba',phoneNumberId:'phone'};
    await expect(connections.complete({...principal,user:b.user,accountId:b.accountId,tenantId:b.tenantId},input)).rejects.toMatchObject({code:'CONNECTION_ATTEMPT_EXPIRED'});
    expect((await connections.complete(principal,input)).success).toBe(true);
    await expect(connections.complete(principal,input)).rejects.toMatchObject({code:'CONNECTION_ATTEMPT_EXPIRED'});expect(onboarding.processEmbeddedSignupCallback).toHaveBeenCalledTimes(1);
    vi.unstubAllEnvs();
  });
  it('recovers code-only Meta signup without exposing the token or crossing accounts', async () => {
    vi.stubEnv('META_APP_ID','test-app');vi.stubEnv('META_CONFIG_ID','test-config');
    try {
      const a=await client(),b=await client();await approved(a);await approved(b);
      const principal={user:a.user,accountId:a.accountId,tenantId:a.tenantId,sessionId:'s',csrf:'c'} as any;
      const other={user:b.user,accountId:b.accountId,tenantId:b.tenantId,sessionId:'s',csrf:'c'} as any;
      const start=await connections.begin(principal);
      await expect(connections.discover(other,{...start,code:'oauth-code'})).rejects.toMatchObject({code:'CONNECTION_ATTEMPT_EXPIRED'});
      const discovered=await connections.discover(principal,{...start,code:'oauth-code'});
      expect(discovered).toEqual({candidates:[{wabaId:'waba-a',phoneNumberId:'phone-a',displayPhoneNumber:'+212 600000001'}]});
      expect(JSON.stringify(discovered)).not.toContain('encrypted-test-token');
      await expect(connections.complete(principal,{...start,wabaId:'waba-a',phoneNumberId:'another-phone'})).rejects.toMatchObject({code:'META_NUMBER_NOT_GRANTED'});
      expect((await connections.complete(principal,{...start,wabaId:'waba-a',phoneNumberId:'phone-a'})).success).toBe(true);
      expect(onboarding.processEmbeddedSignupCallback).toHaveBeenLastCalledWith(expect.objectContaining({
        accountId:a.accountId,phoneNumberId:'phone-a',encryptedMetaToken:'encrypted-test-token'
      }));
      const rows=await store.db.$queryRaw<any[]>`SELECT "encryptedMetaToken","metaCandidates" FROM "PortalConnectionAttempt" WHERE id=${start.attemptId}`;
      expect(rows[0].encryptedMetaToken).toBeNull();expect(rows[0].metaCandidates).toBeNull();
    } finally { vi.unstubAllEnvs(); }
  });
  it('returns real SQL statistics and admin usage without credentials', async () => {
    const c=await client();await active(c);const headers=await cookie(admin);
    for(const path of ['/api/admin/overview','/api/admin/usage','/api/admin/accounts/'+c.accountId+'/stats','/api/admin/accounts/'+c.accountId]){
      const r=await request(app).get(path).set(headers);expect(r.status,JSON.stringify(r.body)).toBe(200);expect(JSON.stringify(r.body)).not.toContain('passwordHash');
    }
  });
  it('allows administrative per-client limits without modifying the shared plan', async () => {
    const c=await client();let p=await active(c);
    p=await store.updateAccount(admin.id,c.accountId,p.revision,{limitOverrides:{monthlyUsd:0.5,messages:1}});
    expect(p.planSnapshot!.limits.monthlyUsd).toBe(0.5);expect((await store.plan(plan.id))!.limits.monthlyUsd).toBe(1);
    expect(await budget.runTurn(c.tenantId,c.accountId,'first',async()=> 'ok','blocked')).toBe('ok');
    expect(await budget.runTurn(c.tenantId,c.accountId,'second',async()=> 'ok','blocked')).toBe('blocked');
    await expect(store.updateAccount(admin.id,c.accountId,p.revision,{limitOverrides:{numbers:0}})).rejects.toMatchObject({code:'DOWNGRADE_REQUIRES_REVIEW'});
  });
  it('revokes every existing session after password reset', async () => {
    const c=await client(),headers=await cookie(c.user),token=randomUUID();
    await store.issueToken(c.userId,hashToken(token),'RESET',new Date(Date.now()+60000));
    expect((await request(app).post('/api/auth/reset-password').send({token,password:'New-long-password-2026!'})).status).toBe(200);
    expect((await request(app).get('/api/client/profile').set(headers)).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({email:c.user.email,password})).status).toBe(401);
  });
  it('rejects malformed admin prompts, expensive models and broken workflow targets', () => {
    expect(()=>validateAdminConfig({prompts:{system:{bad:'value'}}})).toThrow();
    expect(()=>validateAdminConfig({llm:{maxTokens:999999}})).toThrow();
    expect(()=>validateAdminConfig({llm:{provider:'unpriced'}})).toThrow();
    expect(()=>validateAdminConfig({workflows:{a:{initialState:'a',states:{a:{type:'message',next:'missing'}}}}})).toThrow();
  });
  it('serves portal pages and APIs through the main server alongside existing channel routes', async () => {
    const { createApp } = await import('../../src/app');
    const main = await createApp({ prisma: database.db, portalService: { store, auth, documents: docs, connections },
      conversationEngine: {}, whatsAppNumberService: {}, whatsAppOnboardingService: onboarding, clientSafetyGuard: {} } as any);
    for (const path of ['/signup','/login','/app/business','/admin/clients']) {
      const r=await request(main).get(path);expect(r.status).toBe(200);expect(r.text).toContain('/portal-assets/portal.js');
      expect(r.headers['content-security-policy']).toContain("default-src 'self'");
    }
    expect((await request(main).get('/portal-assets/portal.js')).status).toBe(200);
    expect((await request(main).get('/api/portal/plans')).status).toBe(200);
    expect((await request(main).get('/api/auth/session')).status).toBe(401);
    expect((await request(main).get('/api/admin/accounts').set(await cookie(admin))).status).toBe(200);
    expect((await request(main).get('/api/client/missing').set(await cookie((await client()).user))).status).toBe(404);
  });
});
