import { randomUUID } from 'crypto';
import { BusinessData, EMPTY_BUSINESS, PlanLimits, PortalDb, PortalError, PortalPlan, PortalProfile, PortalUser } from './types';
import { compileBusiness, validateBusiness, validatePlan } from './validation';
import { localEmailBypass } from './localTesting';

const json = (value: unknown) => JSON.stringify(value);
export class PortalStore {
  constructor(public db: PortalDb) {}
  transaction<T>(run: (store: PortalStore) => Promise<T>) { return this.db.$transaction(tx => run(new PortalStore(tx)), { timeout: 15000 }); }
  async audit(actorId: string, accountId: string | null, action: string, metadata: Record<string, unknown> = {}) {
    await this.db.$executeRaw`INSERT INTO "PortalAudit"(id,"actorId","accountId",action,metadata) VALUES (${randomUUID()},${actorId},${accountId},${action},${json(metadata)}::jsonb)`;
  }
  async throttle(key: string, limit: number, seconds: number) {
    const rows = await this.db.$queryRaw<any[]>`INSERT INTO "PortalThrottle"(key,count,"resetsAt") VALUES (${key},1,NOW()+${seconds}*INTERVAL '1 second')
      ON CONFLICT(key) DO UPDATE SET count=CASE WHEN "PortalThrottle"."resetsAt"<NOW() THEN 1 ELSE "PortalThrottle".count+1 END,
      "resetsAt"=CASE WHEN "PortalThrottle"."resetsAt"<NOW() THEN NOW()+${seconds}*INTERVAL '1 second' ELSE "PortalThrottle"."resetsAt" END RETURNING count`;
    if (rows[0].count > limit) throw new PortalError(429, 'TOO_MANY_REQUESTS', 'Too many attempts. Please try again later.');
  }
  async userByEmail(email: string) { return (await this.db.$queryRaw<PortalUser[]>`SELECT * FROM "PortalUser" WHERE email=${email}`)[0] || null; }
  async userById(id: string) { return (await this.db.$queryRaw<PortalUser[]>`SELECT * FROM "PortalUser" WHERE id=${id}`)[0] || null; }
  async register(email: string, name: string, passwordHash: string, requestedPlanId: string | null, verifyWithoutEmail = false) {
    return this.transaction(async s => {
      if (requestedPlanId && !(await s.plan(requestedPlanId))?.published) throw new PortalError(400, 'PLAN_UNAVAILABLE');
      const userId = randomUUID(), tenantId = randomUUID(), accountId = randomUUID();
      await s.db.$executeRaw`INSERT INTO "PortalUser"(id,email,name,"passwordHash","verifiedAt") VALUES (${userId},${email},${name},${passwordHash},${verifyWithoutEmail ? new Date() : null})`;
      await s.db.$executeRaw`INSERT INTO "Tenant"(id,name,"updatedAt") VALUES (${tenantId},${name},NOW())`;
      await s.db.$executeRaw`INSERT INTO "Account"(id,"tenantId",name,enabled,config,"updatedAt") VALUES (${accountId},${tenantId},${name},true,'{"portalManaged":true}',NOW())`;
      await s.db.$executeRaw`INSERT INTO "PortalMembership"("userId","tenantId","accountId") VALUES (${userId},${tenantId},${accountId})`;
      const draft = { ...structuredClone(EMPTY_BUSINESS), name, email };
      await s.db.$executeRaw`INSERT INTO "PortalProfile"("accountId","tenantId",draft,"requestedPlanId") VALUES (${accountId},${tenantId},${json(draft)}::jsonb,${requestedPlanId})`;
      await s.audit(userId, accountId, 'CLIENT_REGISTERED', { emailVerificationBypassed: verifyWithoutEmail });
      return { userId, tenantId, accountId };
    });
  }
  async memberships(userId: string) { return this.db.$queryRaw<any[]>`SELECT m.*,a.name FROM "PortalMembership" m JOIN "Account" a ON a.id=m."accountId" AND a."tenantId"=m."tenantId" WHERE m."userId"=${userId} ORDER BY a."createdAt"`; }
  async issueToken(userId: string, tokenHash: string, kind: 'VERIFY' | 'RESET', expiresAt: Date) {
    await this.db.$executeRaw`DELETE FROM "PortalAuthToken" WHERE "userId"=${userId} AND kind=${kind}`;
    await this.db.$executeRaw`INSERT INTO "PortalAuthToken"("tokenHash","userId",kind,"expiresAt") VALUES (${tokenHash},${userId},${kind},${expiresAt})`;
  }
  async consumeToken(tokenHash: string, kind: 'VERIFY' | 'RESET', passwordHash?: string) {
    return this.transaction(async s => {
      const tokens = await s.db.$queryRaw<any[]>`DELETE FROM "PortalAuthToken" WHERE "tokenHash"=${tokenHash} AND kind=${kind} AND "expiresAt">NOW() RETURNING "userId"`;
      if (!tokens.length) throw new PortalError(400, 'LINK_EXPIRED', 'This link is invalid or expired. Request a new one.');
      const userId = tokens[0].userId;
      if (kind === 'VERIFY') await s.db.$executeRaw`UPDATE "PortalUser" SET "verifiedAt"=NOW() WHERE id=${userId} AND disabled=false`;
      else {
        await s.db.$executeRaw`UPDATE "PortalUser" SET "passwordHash"=${passwordHash!} WHERE id=${userId} AND disabled=false`;
        await s.db.$executeRaw`DELETE FROM "PortalSession" WHERE "userId"=${userId}`;
      }
      await s.audit(userId, null, kind === 'VERIFY' ? 'EMAIL_VERIFIED' : 'PASSWORD_RESET');
    });
  }
  async newSession(userId: string, tokenHash: string, csrfToken: string, expiresAt: Date) {
    const id = randomUUID();
    await this.db.$executeRaw`INSERT INTO "PortalSession"(id,"userId","tokenHash","csrfToken","expiresAt") VALUES (${id},${userId},${tokenHash},${csrfToken},${expiresAt})`;
    return id;
  }
  async session(tokenHash: string, allowUnverified = false) {
    return (await this.db.$queryRaw<any[]>`SELECT s.id AS "sessionId",s."csrfToken",u.* FROM "PortalSession" s JOIN "PortalUser" u ON u.id=s."userId"
      WHERE s."tokenHash"=${tokenHash} AND s."expiresAt">NOW() AND u.disabled=false AND (u."verifiedAt" IS NOT NULL OR ${allowUnverified})`)[0] || null;
  }
  async revokeSession(id: string) { await this.db.$executeRaw`DELETE FROM "PortalSession" WHERE id=${id}`; }
  async plans(publicOnly = false): Promise<PortalPlan[]> {
    const rows = await this.db.$queryRaw<any[]>`SELECT * FROM "PortalPlan" WHERE (${publicOnly}=false OR published=true) ORDER BY price,name`;
    return rows.map(r => ({ ...r, price: Number(r.price) }));
  }
  async plan(id: string): Promise<PortalPlan | null> {
    const row = (await this.db.$queryRaw<any[]>`SELECT * FROM "PortalPlan" WHERE id=${id}`)[0];
    return row ? { ...row, price: Number(row.price) } : null;
  }
  async savePlan(actorId: string, data: Omit<PortalPlan, 'id' | 'revision'>, id?: string, expectedRevision?: number) {
    return this.transaction(async s => {
      const planId = id || randomUUID();
      if (!id) await s.db.$executeRaw`INSERT INTO "PortalPlan"(id,name,description,price,currency,published,modules,limits,template)
        VALUES (${planId},${data.name},${data.description},${data.price},${data.currency},${data.published},${json(data.modules)}::jsonb,${json(data.limits)}::jsonb,${json(data.template)}::jsonb)`;
      else {
        const count = await s.db.$executeRaw`UPDATE "PortalPlan" SET name=${data.name},description=${data.description},price=${data.price},currency=${data.currency},published=${data.published},
          modules=${json(data.modules)}::jsonb,limits=${json(data.limits)}::jsonb,template=${json(data.template)}::jsonb,revision=revision+1,"updatedAt"=NOW() WHERE id=${id} AND revision=${expectedRevision ?? -1}`;
        if (!count) throw new PortalError(409, 'REVISION_CONFLICT', 'This plan changed. Reload before saving.');
      }
      await s.audit(actorId, null, 'PLAN_SAVED', { planId });
      return s.plan(planId);
    });
  }
  async profile(accountId: string, tenantId?: string): Promise<PortalProfile> {
    const row = (await this.db.$queryRaw<PortalProfile[]>`SELECT * FROM "PortalProfile" WHERE "accountId"=${accountId} AND (${tenantId || null}::text IS NULL OR "tenantId"=${tenantId || null})`)[0];
    if (!row) throw new PortalError(404, 'ACCOUNT_NOT_FOUND');
    return row;
  }
  async lockProfile(accountId: string): Promise<PortalProfile> {
    const row = (await this.db.$queryRaw<PortalProfile[]>`SELECT * FROM "PortalProfile" WHERE "accountId"=${accountId} FOR UPDATE`)[0];
    if (!row) throw new PortalError(404, 'ACCOUNT_NOT_FOUND');
    return row;
  }
  async setEditingFrozen(actorId: string, accountId: string, frozen: boolean) {
    return this.transaction(async s => {
      const p = await s.lockProfile(accountId);
      if (p.editingFrozen === frozen) return p;
      await s.db.$executeRaw`UPDATE "PortalProfile" SET "editingFrozen"=${frozen},revision=revision+1,"updatedAt"=NOW() WHERE "accountId"=${accountId}`;
      await s.audit(actorId, accountId, frozen ? 'CLIENT_EDITING_FROZEN' : 'CLIENT_EDITING_UNFROZEN');
      return s.profile(accountId);
    });
  }
  async saveDraft(actorId: string, accountId: string, tenantId: string, draft: unknown, expectedRevision: number, administrative = false) {
    return this.transaction(async s => {
      const profile = await s.lockProfile(accountId);
      if (profile.tenantId !== tenantId) throw new PortalError(404, 'ACCOUNT_NOT_FOUND');
      if (profile.editingFrozen && !administrative) throw new PortalError(403, 'CLIENT_EDITING_FROZEN', 'Chatbot information is locked by the administrator.');
      if (profile.revision !== expectedRevision) throw new PortalError(409, 'REVISION_CONFLICT', 'Your data changed in another window. Reload before saving.');
      const plan = profile.planSnapshot || (profile.requestedPlanId ? await s.plan(profile.requestedPlanId) : null);
      const data = validateBusiness(draft, plan, profile.draft, administrative ? [] : profile.lockedFields);
      await s.db.$executeRaw`UPDATE "PortalProfile" SET draft=${json(data)}::jsonb,revision=revision+1,"updatedAt"=NOW() WHERE "accountId"=${accountId}`;
      await s.audit(actorId, accountId, 'BUSINESS_DATA_SAVED', { revision: expectedRevision + 1 });
      const updated = await s.profile(accountId);
      if (updated.autoPublish && updated.status === 'ACTIVE' && updated.planSnapshot) await s.publishLocked(actorId, updated);
      return s.profile(accountId);
    });
  }
  async submit(actorId: string, accountId: string, expectedRevision: number) {
    return this.transaction(async s => {
      const p = await s.lockProfile(accountId);
      if (p.editingFrozen) throw new PortalError(403, 'CLIENT_EDITING_FROZEN', 'Chatbot information is locked by the administrator.');
      if (p.revision !== expectedRevision) throw new PortalError(409, 'REVISION_CONFLICT');
      if (!p.draft.name || !p.draft.description || (!p.draft.email && !p.draft.phone)) throw new PortalError(400, 'INCOMPLETE_SETUP', 'Add a business description and contact details before submitting.');
      if (p.status === 'SUSPENDED') throw new PortalError(403, 'ACCOUNT_SUSPENDED');
      if (p.status !== 'ACTIVE') await s.db.$executeRaw`UPDATE "PortalProfile" SET status='SUBMITTED',revision=revision+1,"updatedAt"=NOW() WHERE "accountId"=${accountId}`;
      await s.audit(actorId, accountId, 'SETUP_SUBMITTED');
      return s.profile(accountId);
    });
  }
  async requestPlan(actorId: string, accountId: string, planId: string) {
    if (!(await this.plan(planId))?.published) throw new PortalError(400, 'PLAN_UNAVAILABLE');
    await this.db.$executeRaw`UPDATE "PortalProfile" SET "requestedPlanId"=${planId},revision=revision+1,"updatedAt"=NOW() WHERE "accountId"=${accountId}`;
    await this.audit(actorId, accountId, 'PLAN_REQUESTED', { planId });
  }
  async updateAccount(actorId: string, accountId: string, expectedRevision: number, changes: any, publishData = false) {
    return this.transaction(async s => {
      const profile = await s.lockProfile(accountId);
      if (profile.revision !== expectedRevision) throw new PortalError(409, 'REVISION_CONFLICT');
      if (changes.planId !== undefined) {
        const plan = await s.plan(changes.planId);
        if (!plan) throw new PortalError(400, 'PLAN_UNAVAILABLE');
        validateBusiness(profile.draft, plan);
        const numbers = await s.db.$queryRaw<any[]>`SELECT (SELECT COUNT(*) FROM "WhatsAppBusinessNumber" WHERE "accountId"=${accountId} AND "tenantId"=${profile.tenantId}) +
          (SELECT COUNT(*) FROM "PortalConnectionAttempt" WHERE "accountId"=${accountId} AND "reconnectId" IS NULL AND (status='PROCESSING' OR (status='PENDING' AND "expiresAt">NOW()))) AS n`;
        const docs = await s.db.$queryRaw<any[]>`SELECT COUNT(*)::int AS n,COALESCE(SUM(size),0)::bigint AS bytes FROM "PortalDocument" WHERE "accountId"=${accountId}`;
        if (numbers[0].n > plan.limits.numbers || docs[0].n > plan.limits.documents || Number(docs[0].bytes) > plan.limits.storageMb * 1048576) throw new PortalError(409, 'DOWNGRADE_REQUIRES_REVIEW', 'This account exceeds the new plan. Remove excess connections or documents first.');
        profile.planId = plan.id; profile.planSnapshot = plan;
      }
      if (changes.limitOverrides !== undefined) {
        if (!profile.planSnapshot) throw new PortalError(400, 'PLAN_REQUIRED');
        const { id, revision, ...current } = profile.planSnapshot;
        const adjusted = validatePlan({ name: current.name, description: current.description, price: current.price, currency: current.currency, published: current.published,
          modules: current.modules, template: current.template, limits: { ...current.limits, ...changes.limitOverrides } });
        validateBusiness(profile.draft, { ...adjusted, id, revision });
        const numbers = await s.db.$queryRaw<any[]>`SELECT (SELECT COUNT(*) FROM "WhatsAppBusinessNumber" WHERE "accountId"=${accountId}) +
          (SELECT COUNT(*) FROM "PortalConnectionAttempt" WHERE "accountId"=${accountId} AND "reconnectId" IS NULL AND (status='PROCESSING' OR (status='PENDING' AND "expiresAt">NOW()))) AS n`;
        const docs = await s.db.$queryRaw<any[]>`SELECT COUNT(*)::int AS n,COALESCE(SUM(size),0)::bigint AS bytes FROM "PortalDocument" WHERE "accountId"=${accountId}`;
        if (numbers[0].n > adjusted.limits.numbers || docs[0].n > adjusted.limits.documents || Number(docs[0].bytes) > adjusted.limits.storageMb * 1048576) throw new PortalError(409, 'DOWNGRADE_REQUIRES_REVIEW');
        profile.planSnapshot = { ...adjusted, id, revision };
      }
      if (changes.status) profile.status = changes.status;
      if (changes.autoPublish !== undefined) profile.autoPublish = changes.autoPublish;
      if (changes.reviewNote !== undefined) profile.reviewNote = changes.reviewNote;
      if (changes.lockedFields !== undefined) profile.lockedFields = changes.lockedFields;
      if (changes.adminConfig !== undefined) profile.adminConfig = changes.adminConfig;
      if (profile.status === 'ACTIVE' && (!profile.planSnapshot || !profile.published)) throw new PortalError(400, 'ACTIVATION_NOT_READY', 'Assign a plan and publish the business data before activation.');
      if (profile.status === 'ACTIVE') {
        const users = await s.db.$queryRaw<any[]>`SELECT u.id FROM "PortalUser" u JOIN "PortalMembership" m ON m."userId"=u.id WHERE m."accountId"=${accountId} AND (u."verifiedAt" IS NOT NULL OR ${localEmailBypass()}) AND u.disabled=false`;
        if (!users.length) throw new PortalError(400, 'EMAIL_NOT_VERIFIED');
        const numbers = await s.db.$queryRaw<any[]>`SELECT id FROM "WhatsAppBusinessNumber" WHERE "accountId"=${accountId} AND "tenantId"=${profile.tenantId} AND status='CONNECTED' AND enabled=true LIMIT 1`;
        if (!numbers.length) throw new PortalError(400, 'WHATSAPP_NOT_CONNECTED');
      }
      await s.db.$executeRaw`UPDATE "PortalProfile" SET status=${profile.status},"planId"=${profile.planId},"planSnapshot"=${json(profile.planSnapshot)}::jsonb,
        "autoPublish"=${profile.autoPublish},"reviewNote"=${profile.reviewNote},"lockedFields"=${json(profile.lockedFields)}::jsonb,"adminConfig"=${json(profile.adminConfig)}::jsonb,
        revision=revision+1,"updatedAt"=NOW() WHERE "accountId"=${accountId}`;
      await s.db.$executeRaw`UPDATE "Account" SET enabled=${profile.status !== 'SUSPENDED'},"updatedAt"=NOW() WHERE id=${accountId} AND "tenantId"=${profile.tenantId}`;
      if ((changes.adminConfig !== undefined || changes.planId !== undefined) && profile.published) {
        if (profile.planSnapshot) validateBusiness(profile.published, profile.planSnapshot);
        const cfg = this.runtimeConfig(profile.published, profile);
        await s.db.$executeRaw`UPDATE "Account" SET config=${json(cfg)}::jsonb,"updatedAt"=NOW() WHERE id=${accountId}`;
      }
      await s.audit(actorId, accountId, 'ACCOUNT_SETTINGS_UPDATED', { fields: Object.keys(changes), status: profile.status });
      if (publishData) await s.publishLocked(actorId, await s.profile(accountId));
      return s.profile(accountId);
    });
  }
  async publish(actorId: string, accountId: string, expectedRevision: number) {
    return this.transaction(async s => {
      const p = await s.lockProfile(accountId);
      if (p.revision !== expectedRevision) throw new PortalError(409, 'REVISION_CONFLICT');
      await s.publishLocked(actorId, p);
      return s.profile(accountId);
    });
  }
  private runtimeConfig(data: BusinessData, profile: PortalProfile) {
    const config = compileBusiness(data, profile.planSnapshot?.template || {}, profile.adminConfig);
    config.capabilities.ecommerceEnabled = Boolean(profile.planSnapshot?.modules.includes('commerce')) && config.capabilities.ecommerceEnabled !== false;
    config.capabilities.imageEnabled = Boolean(profile.planSnapshot?.modules.includes('images')) && config.capabilities.imageEnabled !== false;
    if (!profile.planSnapshot?.modules.includes('knowledge')) config.knowledge.enabled = false;
    return config;
  }
  private async publishLocked(actorId: string, profile: PortalProfile) {
    if (!profile.planSnapshot) throw new PortalError(400, 'PLAN_REQUIRED', 'Assign a plan before publishing.');
    const data = validateBusiness(profile.draft, profile.planSnapshot);
    const config = this.runtimeConfig(data, profile);
    const accountId = profile.accountId, tenantId = profile.tenantId;
    await this.db.$executeRaw`UPDATE "Account" SET config=${json(config)}::jsonb,name=${data.name},"updatedAt"=NOW() WHERE id=${accountId} AND "tenantId"=${tenantId}`;
    // Retire removed catalog entries without deleting historical product references.
    await this.db.$executeRaw`UPDATE "Product" SET active=false,"updatedAt"=NOW() WHERE "tenantId"=${tenantId} AND "accountId"=${accountId}`;
    // Batch the catalog so a large client import does not perform thousands of database round trips.
    const catalog = data.products.map(p => ({ ...p, id: randomUUID() }));
    const rows = await this.db.$queryRaw<any[]>`INSERT INTO "Product"(id,"tenantId","accountId",sku,name,description,price,currency,stock,active,category,"updatedAt")
      SELECT x.id,${tenantId},${accountId},x.sku,x.name,x.description,x.price,${data.currency},x.stock,true,NULLIF(x.category,''),NOW()
      FROM jsonb_to_recordset(${json(catalog)}::jsonb) AS x(id text,sku text,name text,description text,price numeric,stock int,category text)
      ON CONFLICT("tenantId","accountId",sku) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,price=EXCLUDED.price,currency=EXCLUDED.currency,stock=EXCLUDED.stock,active=true,category=EXCLUDED.category,"updatedAt"=NOW() RETURNING id,sku`;
    const ids = new Map(rows.map(p => [p.sku, p.id]));
    await this.db.$executeRaw`UPDATE "ProductVariant" SET active=false,"updatedAt"=NOW() WHERE "productId" IN (SELECT id FROM "Product" WHERE "tenantId"=${tenantId} AND "accountId"=${accountId})`;
    const variants = data.products.flatMap(p => p.variants.map(v => ({ ...v, id: randomUUID(), productId: ids.get(p.sku) })));
    await this.db.$executeRaw`INSERT INTO "ProductVariant"(id,"productId",sku,size,color,"priceOverride",stock,active,"updatedAt")
      SELECT x.id,x."productId",x.sku,NULLIF(x.size,''),NULLIF(x.color,''),x.price,x.stock,true,NOW()
      FROM jsonb_to_recordset(${json(variants)}::jsonb) AS x(id text,"productId" text,sku text,size text,color text,price numeric,stock int)
      ON CONFLICT("productId",sku) DO UPDATE SET size=EXCLUDED.size,color=EXCLUDED.color,"priceOverride"=EXCLUDED."priceOverride",stock=EXCLUDED.stock,active=true,"updatedAt"=NOW()`;
    const revision = profile.revision + 1;
    await this.db.$executeRaw`INSERT INTO "PortalPublication"(id,"accountId",revision,data,config,"actorId") VALUES (${randomUUID()},${accountId},${revision},${json(data)}::jsonb,${json(config)}::jsonb,${actorId})`;
    await this.db.$executeRaw`UPDATE "PortalProfile" SET published=${json(data)}::jsonb,"publishedRevision"=${revision},revision=${revision},status=CASE WHEN status IN ('ACTIVE','SUSPENDED') THEN status ELSE 'APPROVED' END,"updatedAt"=NOW() WHERE "accountId"=${accountId}`;
    await this.audit(actorId, accountId, 'BUSINESS_DATA_PUBLISHED', { revision });
  }
  async restore(actorId: string, accountId: string, publicationId: string, expectedRevision: number) {
    return this.transaction(async s => {
      const p = await s.lockProfile(accountId);
      if (p.revision !== expectedRevision) throw new PortalError(409, 'REVISION_CONFLICT');
      const version = (await s.db.$queryRaw<any[]>`SELECT * FROM "PortalPublication" WHERE id=${publicationId} AND "accountId"=${accountId}`)[0];
      if (!version) throw new PortalError(404, 'VERSION_NOT_FOUND');
      p.draft = version.data;
      // Restore data without silently replacing current administrative controls or limits.
      await s.db.$executeRaw`UPDATE "PortalProfile" SET draft=${json(p.draft)}::jsonb,"adminConfig"=${json(p.adminConfig)}::jsonb WHERE "accountId"=${accountId}`;
      await s.publishLocked(actorId, p);
      await s.audit(actorId, accountId, 'PUBLICATION_RESTORED', { publicationId });
      return s.profile(accountId);
    });
  }
  async accounts(search = '', offset = 0) {
    offset = Math.max(0, Math.min(1000000, Math.floor(Number.isFinite(offset) ? offset : 0)));
    return this.db.$queryRaw<any[]>`SELECT p."accountId",p."tenantId",a.name,owner.name AS "clientName",owner.email AS "clientEmail",p.status,p.revision,p."planId",p."requestedPlanId",p."createdAt",p."updatedAt",p."planSnapshot"->>'name' AS "planName",
      (SELECT COUNT(*)::int FROM "Conversation" c WHERE c."accountId"=p."accountId" AND c."tenantId"=p."tenantId") AS conversations
      FROM "PortalProfile" p JOIN "Account" a ON a.id=p."accountId" AND a."tenantId"=p."tenantId"
      LEFT JOIN LATERAL (SELECT u.name,u.email FROM "PortalMembership" m JOIN "PortalUser" u ON u.id=m."userId"
        WHERE m."accountId"=p."accountId" AND m."tenantId"=p."tenantId" AND u.role='CLIENT'
        ORDER BY u."createdAt",u.id LIMIT 1) owner ON true
      WHERE a.name ILIKE ${'%' + search + '%'} OR owner.name ILIKE ${'%' + search + '%'} OR owner.email ILIKE ${'%' + search + '%'}
      ORDER BY p."updatedAt" DESC LIMIT 50 OFFSET ${offset}`;
  }
  async auditHistory(accountId: string | null, offset = 0) { return this.db.$queryRaw<any[]>`SELECT * FROM "PortalAudit" WHERE (${accountId}::text IS NULL OR "accountId"=${accountId}) ORDER BY "createdAt" DESC LIMIT 100 OFFSET ${offset}`; }
  async versions(accountId: string) { return this.db.$queryRaw<any[]>`SELECT id,revision,"actorId","createdAt" FROM "PortalPublication" WHERE "accountId"=${accountId} ORDER BY revision DESC LIMIT 30`; }
  async connections(accountId: string, tenantId: string) { return this.db.$queryRaw<any[]>`SELECT c.id,c.provider,c.status,c.enabled,c."connectionKey" AS label,c."updatedAt",n.id AS "numberRecordId",n."phoneNumberId",n."displayPhoneNumber",n.status AS "numberStatus"
    FROM "ChannelConnection" c LEFT JOIN "WhatsAppBusinessNumber" n ON n."connectionId"=c.id AND n."tenantId"=c."tenantId" AND n."accountId"=c."accountId"
    WHERE c."accountId"=${accountId} AND c."tenantId"=${tenantId} ORDER BY c."createdAt"`; }
  async usage(accountId: string) {
    const period = new Date().toISOString().slice(0, 7);
    return (await this.db.$queryRaw<any[]>`SELECT * FROM "PortalUsageBucket" WHERE "accountId"=${accountId} AND period=${period}`)[0] || { period, messages: 0, llmCalls: 0, images: 0, embeddings: 0, spentMicros: 0, reservedMicros: 0 };
  }
  async stats(accountId: string, tenantId: string, days = 30) {
    days = Math.max(1, Math.min(90, Number.isFinite(days) ? Math.floor(days) : 30));
    const [totals, daily, sources, costs, usage, responses, delivery] = await Promise.all([
      this.db.$queryRaw<any[]>`SELECT COUNT(*)::int AS conversations,COUNT(DISTINCT "customerId")::int AS contacts,
        COUNT(*) FILTER(WHERE "humanRequested"=true)::int AS handoffs FROM "Conversation" WHERE "accountId"=${accountId} AND "tenantId"=${tenantId}
        AND "customerId" NOT LIKE 'portal-preview:%' AND "createdAt">NOW()-${days}*INTERVAL '1 day'`,
      this.db.$queryRaw<any[]>`SELECT date_trunc('day',m."createdAt") AS day,COUNT(*) FILTER(WHERE m.role='USER')::int AS inbound,COUNT(*) FILTER(WHERE m.role='ASSISTANT')::int AS outbound
        FROM "Message" m JOIN "Conversation" c ON c.id=m."conversationId" WHERE c."accountId"=${accountId} AND c."tenantId"=${tenantId}
        AND c."customerId" NOT LIKE 'portal-preview:%' AND m."tenantId"=${tenantId} AND m."createdAt">NOW()-${days}*INTERVAL '1 day' GROUP BY day ORDER BY day`,
      this.db.$queryRaw<any[]>`SELECT l.status,COUNT(*)::int AS count FROM "Lead" l JOIN "Customer" cu ON cu.id=l."customerId" AND cu."tenantId"=l."tenantId"
        WHERE l."accountId"=${accountId} AND l."tenantId"=${tenantId} AND COALESCE(cu."externalId",'') NOT LIKE 'portal-preview:%'
        AND l."createdAt">NOW()-${days}*INTERVAL '1 day' GROUP BY l.status`,
      this.db.$queryRaw<any[]>`SELECT kind,status,COUNT(*)::int AS calls,COALESCE(SUM("chargedMicros"),0)::bigint AS "chargedMicros",
        COALESCE(SUM((metadata->>'inputTokens')::bigint),0)::bigint AS "inputTokens",COALESCE(SUM((metadata->>'outputTokens')::bigint),0)::bigint AS "outputTokens"
        FROM "PortalUsageEntry" WHERE "accountId"=${accountId} AND "createdAt">NOW()-${days}*INTERVAL '1 day' GROUP BY kind,status`,
      this.usage(accountId),
      this.db.$queryRaw<any[]>`SELECT metadata->>'source' AS source,metadata->>'language' AS language,metadata->>'script' AS script,metadata->>'intent' AS intent,COUNT(*)::int AS count,
        ROUND(AVG((metadata->>'latencyMs')::numeric)) AS "averageLatencyMs" FROM "PortalUsageEntry" WHERE "accountId"=${accountId} AND kind='message' AND status='COMPLETED'
        AND "createdAt">NOW()-${days}*INTERVAL '1 day' GROUP BY metadata->>'source',metadata->>'language',metadata->>'script',metadata->>'intent'`,
      this.db.$queryRaw<any[]>`SELECT "phoneNumberId",status,"outboundStatus",COUNT(*)::int AS count,COALESCE(SUM(GREATEST(attempts-1,0)),0)::int AS retries FROM "WhatsAppMessageJob"
        WHERE "accountId"=${accountId} AND "tenantId"=${tenantId} AND "createdAt">NOW()-${days}*INTERVAL '1 day' GROUP BY "phoneNumberId",status,"outboundStatus"`
    ]);
    return { days, totals: totals[0], daily, leads: sources, operations: costs, responses, delivery, usage, currency: 'USD', costBasis: 'Configured peak-rate estimates; unknown outcomes retain their reservation. Channel and hosting charges excluded.' };
  }
}
