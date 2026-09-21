import express, { Request, Response, Router } from 'express';
import multer from 'multer';
import { randomUUID } from 'crypto';
import { PortalStore } from './PortalStore';
import { PortalAuth, hashPassword, hashToken } from './PortalAuth';
import { PortalConnections } from './PortalConnections';
import { PortalDocuments } from './PortalDocuments';
import { EMPTY_BUSINESS, PortalError, PortalPrincipal, PortalProfile, PortalPlan } from './types';
import { allowed, compileBusiness, email, integer, list, object, text, validateAdminConfig, validatePlan } from './validation';
import { ChatbotDependencies } from '../bootstrap';
import { ConversationAutomationService } from '../domain/conversation/ConversationAutomationService';
import { OutboundMessageQueue } from '../domain/channel/whatsapp/WhatsAppOutboundQueue';
import { WhatsAppNumberService } from '../domain/channel/whatsapp/WhatsAppNumberService';
import { logger } from '../utils/logger';

type PortalRequest = Request & { portal: PortalPrincipal };
export interface PortalServices { store: PortalStore; auth: PortalAuth; connections: PortalConnections; documents: PortalDocuments; }
export interface PortalRouterDeps {
  prisma: any;
  conversationEngine?: any;
  qrSessionManager?: any;
  conversationAutomationService?: ConversationAutomationService;
  whatsAppOutboundQueue?: OutboundMessageQueue;
  whatsAppNumberService?: WhatsAppNumberService;
  [key: string]: any;
}
const publicPlan = (p: PortalPlan) => ({ id: p.id, name: p.name, description: p.description, price: p.price, currency: p.currency, modules: p.modules });
const clientProfile = (p: PortalProfile) => ({ accountId: p.accountId, status: p.status, draft: p.draft, revision: p.revision, publishedRevision: p.publishedRevision,
  requestedPlanId: p.requestedPlanId, plan: p.planSnapshot ? publicPlan(p.planSnapshot) : null, reviewNote: p.reviewNote, lockedFields: p.lockedFields, autoPublish: p.autoPublish });
function send(res: Response, data: unknown, status = 200) { res.status(status).json(JSON.parse(JSON.stringify(data, (_key, value) => typeof value === 'bigint' ? Number(value) : value))); }
const route = (fn: (req: PortalRequest, res: Response) => Promise<any>) => (req: Request, res: Response, next: express.NextFunction) => { Promise.resolve(fn(req as PortalRequest, res)).catch(next); };
function validateAccountChanges(changes: Record<string, any>) {
  allowed(changes, ['status','planId','limitOverrides','adminConfig','autoPublish','lockedFields','reviewNote']);
    if (changes.status && !['DRAFT', 'SUBMITTED', 'NEEDS_CHANGES', 'APPROVED', 'ACTIVE', 'SUSPENDED'].includes(changes.status)) throw new PortalError(400, 'INVALID_STATUS');
    if (changes.adminConfig !== undefined) changes.adminConfig = validateAdminConfig(changes.adminConfig);
    if (changes.limitOverrides !== undefined) changes.limitOverrides = object(changes.limitOverrides);
    if (changes.planId !== undefined) changes.planId = text(changes.planId, 100);
    if (changes.reviewNote !== undefined) changes.reviewNote = text(changes.reviewNote, 2000);
    if (changes.autoPublish !== undefined && typeof changes.autoPublish !== 'boolean') throw new PortalError(400, 'INVALID_SETTING');
    if (changes.lockedFields) {
      changes.lockedFields = list(changes.lockedFields, 20).map(k => text(k, 40));
      if (changes.lockedFields.some((k: string) => !Object.keys(EMPTY_BUSINESS).includes(k))) throw new PortalError(400, 'INVALID_LOCKED_FIELD');
    }
  return changes;
}
export function createPortalRouter(services: PortalServices, deps: PortalRouterDeps): Router {
  const { store, auth, connections, documents } = services;
  const automationService = deps.conversationAutomationService || new ConversationAutomationService(services.store.db as any);
  const router = Router(), authRouter = Router(), client = Router(), admin = Router();
  router.use(['/auth', '/client', '/admin', '/portal'], (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  router.get('/portal/plans', route(async (_req, res) => send(res, { plans: (await store.plans(true)).map(publicPlan) })));
  router.get('/portal/settings', (_req, res) => send(res, { emailVerificationSkipped: auth.skipsEmail() }));
  authRouter.use((req, _res, next) => { try { if (!['GET', 'HEAD'].includes(req.method)) auth.checkOrigin(req); next(); } catch (error) { next(error); } });
  authRouter.post('/signup', route(async (req, res) => {
    const input = object(req.body); allowed(input, ['email', 'name', 'password', 'planId']);
    send(res, await auth.signup(input, req.ip || 'unknown'), 201);
  }));
  authRouter.post('/login', route(async (req, res) => { const input = object(req.body); allowed(input, ['email', 'password']); send(res, await auth.login(input, req.ip || 'unknown', res)); }));
  authRouter.post('/verify-email', route(async (req, res) => { await store.consumeToken(hashToken(text(req.body?.token, 100)), 'VERIFY'); send(res, { message: 'Email verified. You can now log in.' }); }));
  authRouter.post('/resend-verification', route(async (req, res) => send(res, await auth.requestLink(req.body, 'VERIFY', req.ip || 'unknown'))));
  authRouter.post('/forgot-password', route(async (req, res) => send(res, await auth.requestLink(req.body, 'RESET', req.ip || 'unknown'))));
  authRouter.post('/reset-password', route(async (req, res) => {
    await store.throttle('reset-submit:' + hashToken(req.ip || 'unknown'), 10, 900);
    await store.consumeToken(hashToken(text(req.body?.token, 100)), 'RESET', await hashPassword(req.body?.password));
    auth.clearCookie(res); send(res, { message: 'Password updated. Please log in again.' });
  }));
  authRouter.post('/admin-confirm', route(async (req, res) => send(res, await auth.confirmAdmin(text(req.body?.token, 100), res))));
  authRouter.get('/session', route(async (req, res) => {
    const principal = await auth.principal(req);
    send(res, { user: principal.user, csrf: principal.csrf, accounts: await store.memberships(principal.user.id), selectedAccountId: principal.accountId });
  }));
  authRouter.post('/logout', route(async (req, res) => { const p = await auth.principal(req); auth.checkCsrf(req, p); await store.revokeSession(p.sessionId); auth.clearCookie(res); send(res, { success: true }); }));
  // Middleware must call next after authentication, unlike terminal route handlers.
  for (const [target, role] of [[client, 'CLIENT'], [admin, 'ADMIN']] as const) target.use((req, res, next) => {
    Promise.resolve(auth.principal(req)).then(p => {
      if (p.user.role !== role) throw new PortalError(403, 'ACCESS_DENIED');
      if (!['GET', 'HEAD'].includes(req.method)) auth.checkCsrf(req, p);
      (req as PortalRequest).portal = p; next();
    }).catch(next);
  });
  client.get('/profile', route(async (req, res) => send(res, { profile: clientProfile(await store.profile(req.portal.accountId!, req.portal.tenantId!)) })));
  client.get('/dashboard', route(async (req, res) => {
    const accountId = req.portal.accountId!, tenantId = req.portal.tenantId!;
    const [profile, connections, stats, portalDocuments, recentConversations] = await Promise.all([
      store.profile(accountId, tenantId),
      store.connections(accountId, tenantId),
      store.stats(accountId, tenantId, 30),
      documents.list(accountId),
      store.db.$queryRaw<any[]>`SELECT id,status,"messageCount","humanRequested","updatedAt","customerId" FROM "Conversation"
        WHERE "accountId"=${accountId} AND "tenantId"=${tenantId} AND "customerId" NOT LIKE 'portal-preview:%'
        ORDER BY "updatedAt" DESC LIMIT 6`
    ]);
    const maskCustomer = (value: unknown) => {
      const raw = String(value || 'Customer');
      return raw.length > 4 ? `Customer ••••${raw.slice(-4)}` : 'Customer';
    };
    send(res, {
      profile: clientProfile(profile),
      connections: connections.map(c => ({ id: c.id, provider: c.provider, status: c.status, enabled: c.enabled, displayPhoneNumber: c.displayPhoneNumber, numberStatus: c.numberStatus, updatedAt: c.updatedAt })),
      metrics: { totals: stats.totals, daily: stats.daily, leads: stats.leads },
      documents: { total: portalDocuments.length, ready: portalDocuments.filter(d => d.status === 'READY').length, pending: portalDocuments.filter(d => d.status !== 'READY').length },
      recentConversations: recentConversations.map(c => ({ id: c.id, status: c.status, messageCount: c.messageCount, humanRequested: c.humanRequested, updatedAt: c.updatedAt, customerLabel: maskCustomer(c.customerId) }))
    });
  }));
  client.put('/business', route(async (req, res) => {
    const body = object(req.body); allowed(body, ['data', 'revision']);
    send(res, { profile: clientProfile(await store.saveDraft(req.portal.user.id, req.portal.accountId!, req.portal.tenantId!, body.data, integer(body.revision, 1))) });
  }));
  client.post('/submit', route(async (req, res) => send(res, { profile: clientProfile(await store.submit(req.portal.user.id, req.portal.accountId!, integer(req.body?.revision, 1))) })));
  client.post('/plan-request', route(async (req, res) => { await store.requestPlan(req.portal.user.id, req.portal.accountId!, text(req.body?.planId, 100)); send(res, { success: true }); }));
  client.get('/documents', route(async (req, res) => send(res, { documents: await documents.list(req.portal.accountId!) })));
  const downloadDocument = async (res: Response, actorId: string, accountId: string, id: string) => {
    const doc = (await store.db.$queryRaw<any[]>`SELECT filename,bytes FROM "PortalDocument" WHERE id=${id} AND "accountId"=${accountId}`)[0];
    if (!doc) throw new PortalError(404, 'DOCUMENT_NOT_FOUND');
    await store.audit(actorId, accountId, 'DOCUMENT_DOWNLOADED', { documentId: id });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
    res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''" + encodeURIComponent(doc.filename));
    res.send(Buffer.from(doc.bytes));
  };
  client.get('/documents/:id/download', route(async (req, res) => downloadDocument(res, req.portal.user.id, req.portal.accountId!, String(req.params.id))));
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1048576, files: 1, fields: 0 } }).single('file');
  client.post('/documents', upload, route(async (req, res) => {
    if (!req.file) throw new PortalError(400, 'PDF_REQUIRED');
    await store.throttle('upload:' + req.portal.accountId!, 5, 3600);
    send(res, await documents.upload(req.portal.user.id, req.portal.accountId!, req.file.originalname, req.file.buffer), 201);
  }));
  client.delete('/documents/:id', route(async (req, res) => { await documents.remove(req.portal.user.id, req.portal.accountId!, String(req.params.id), false); send(res, { success: true }); }));
  client.get('/whatsapp', route(async (req, res) => send(res, { connections: await store.connections(req.portal.accountId!, req.portal.tenantId!), qrEnabled: Boolean(deps.qrSessionManager?.isEnabled()), metaConfigured: Boolean(process.env.META_APP_ID && process.env.META_CONFIG_ID) })));
  client.post('/whatsapp/start', route(async (req, res) => { await store.throttle('wa-start:' + req.portal.accountId!, 5, 900); send(res, await connections.begin(req.portal)); }));
  client.post('/whatsapp/qr', route(async (req, res) => { await store.throttle('wa-start:' + req.portal.accountId!, 5, 900); send(res, await connections.startQr(req.portal)); }));
  client.get('/whatsapp/:id/qr', route(async (req, res) => send(res, await connections.qr(req.portal, String(req.params.id)))));
  client.post('/whatsapp/complete', route(async (req, res) => {
    const input = object(req.body); allowed(input, ['attemptId', 'stateToken', 'code', 'wabaId', 'phoneNumberId', 'displayPhoneNumber', 'pin']);
    for (const key of ['attemptId', 'stateToken', 'code', 'wabaId', 'phoneNumberId']) input[key] = text(input[key], key === 'code' ? 4096 : 2048);
    if (input.pin !== undefined) { input.pin = text(input.pin, 6); if (!/^\d{6}$/.test(input.pin)) throw new PortalError(400, 'INVALID_PIN'); }
    if (input.displayPhoneNumber !== undefined) input.displayPhoneNumber = text(input.displayPhoneNumber, 100);
    send(res, await connections.complete(req.portal, input));
  }));
  client.post('/whatsapp/:id/reconnect', route(async (req, res) => send(res, await connections.reconnect(req.portal, String(req.params.id)))));

  // --- Merchant Inbox Routes ---
  client.get('/conversations', route(async (req, res) => {
    const tenantId = req.portal.tenantId!;
    const accountId = req.portal.accountId!;
    const statusFilter = text(req.query.status, 30, 'all').toLowerCase();
    const unreadFilter = req.query.unread === 'true';
    const searchQuery = text(req.query.search, 100);
    const limit = Math.max(1, Math.min(100, Number(req.query.limit || 20)));
    const offset = Math.max(0, Number(req.query.offset || 0));

    const rows = await store.db.$queryRaw<any[]>`
      WITH conv_stats AS (
        SELECT 
          c.id,
          c."tenantId",
          c."accountId",
          c."customerId",
          c.status,
          c."contextData",
          c."messageCount",
          c."humanRequested",
          c."humanRequestedAt",
          c."lastMerchantViewedAt",
          c."createdAt",
          c."updatedAt",
          cu."externalId" AS "customerPhone",
          cu.metadata AS "customerMetadata",
          (
            SELECT MAX(m."createdAt")
            FROM "Message" m
            WHERE m."conversationId" = c.id AND m.role = 'USER'
          ) AS "lastCustomerMessageAt",
          (
            SELECT m.id
            FROM "Message" m
            WHERE m."conversationId" = c.id
            ORDER BY m."createdAt" DESC
            LIMIT 1
          ) AS "lastMessageId",
          (
            SELECT m.role
            FROM "Message" m
            WHERE m."conversationId" = c.id
            ORDER BY m."createdAt" DESC
            LIMIT 1
          ) AS "lastMessageRole",
          (
            SELECT m.content
            FROM "Message" m
            WHERE m."conversationId" = c.id
            ORDER BY m."createdAt" DESC
            LIMIT 1
          ) AS "lastMessageContent",
          (
            SELECT m."createdAt"
            FROM "Message" m
            WHERE m."conversationId" = c.id
            ORDER BY m."createdAt" DESC
            LIMIT 1
          ) AS "lastMessageCreatedAt"
        FROM "Conversation" c
        JOIN "Customer" cu ON cu.id = c."customerId" AND cu."tenantId" = c."tenantId"
        WHERE c."tenantId" = ${tenantId}
          AND c."accountId" = ${accountId}
          AND c."customerId" NOT LIKE 'portal-preview:%'
      )
      SELECT *
      FROM conv_stats
      ORDER BY "updatedAt" DESC, id DESC
    `;

    const filtered = rows.filter(r => {
      let state: 'AI_ACTIVE' | 'HUMAN_REQUIRED' | 'HUMAN_ACTIVE' | 'RESOLVED' = 'AI_ACTIVE';
      if (r.status === 'HUMAN_ACTIVE' || r.contextData?._portalHandoff?.ownerId) {
        state = 'HUMAN_ACTIVE';
      } else if (r.status === 'HANDOFF_REQUESTED' || r.humanRequested) {
        state = 'HUMAN_REQUIRED';
      } else if (r.status === 'RESOLVED') {
        state = 'RESOLVED';
      }

      if (statusFilter === 'open' && state === 'RESOLVED') return false;
      if (statusFilter === 'needs_human' && state !== 'HUMAN_REQUIRED') return false;
      if (statusFilter === 'human_active' && state !== 'HUMAN_ACTIVE') return false;
      if (statusFilter === 'resolved' && state !== 'RESOLVED') return false;
      if (statusFilter === 'ai_active' && state !== 'AI_ACTIVE') return false;

      const isUnread = r.lastCustomerMessageAt !== null &&
        (!r.lastMerchantViewedAt || new Date(r.lastCustomerMessageAt) > new Date(r.lastMerchantViewedAt));
      if (unreadFilter && !isUnread) return false;

      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const phone = (r.customerPhone || '').toLowerCase();
        const custName = ((r.customerMetadata && r.customerMetadata.name) || '').toLowerCase();
        if (!phone.includes(q) && !custName.includes(q) && !r.id.toLowerCase().includes(q)) {
          return false;
        }
      }

      return true;
    });

    const total = filtered.length;
    const paginated = filtered.slice(offset, offset + limit);

    const conversations = paginated.map(r => {
      let state: 'AI_ACTIVE' | 'HUMAN_REQUIRED' | 'HUMAN_ACTIVE' | 'RESOLVED' = 'AI_ACTIVE';
      if (r.status === 'HUMAN_ACTIVE' || r.contextData?._portalHandoff?.ownerId) {
        state = 'HUMAN_ACTIVE';
      } else if (r.status === 'HANDOFF_REQUESTED' || r.humanRequested) {
        state = 'HUMAN_REQUIRED';
      } else if (r.status === 'RESOLVED') {
        state = 'RESOLVED';
      }

      const isUnread = r.lastCustomerMessageAt !== null &&
        (!r.lastMerchantViewedAt || new Date(r.lastCustomerMessageAt) > new Date(r.lastMerchantViewedAt));

      return {
        id: r.id,
        status: state,
        rawStatus: r.status,
        ownership: {
          owner: state === 'HUMAN_ACTIVE' ? 'HUMAN' : 'AI',
          state,
          claimedBy: r.contextData?._portalHandoff?.ownerId || null,
          claimedAt: r.contextData?._portalHandoff?.claimedAt || null
        },
        customer: {
          id: r.customerId,
          name: r.customerMetadata?.name || null,
          phone: r.customerPhone || r.customerId
        },
        lastMessage: r.lastMessageId ? {
          id: r.lastMessageId,
          role: r.lastMessageRole,
          content: r.lastMessageContent,
          createdAt: r.lastMessageCreatedAt
        } : null,
        lastCustomerMessageAt: r.lastCustomerMessageAt,
        lastMerchantViewedAt: r.lastMerchantViewedAt,
        isUnread,
        humanRequested: Boolean(r.humanRequested),
        humanRequestedAt: r.humanRequestedAt,
        messageCount: r.messageCount,
        updatedAt: r.updatedAt,
        createdAt: r.createdAt
      };
    });

    send(res, {
      conversations,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total
      }
    });
  }));

  client.get('/conversations/:id', route(async (req, res) => {
    const tenantId = req.portal.tenantId!;
    const accountId = req.portal.accountId!;
    const conversationId = String(req.params.id);
    const limit = Math.max(1, Math.min(200, Number(req.query.limit || 50)));

    const convRows = await store.db.$queryRaw<any[]>`
      SELECT c.*, cu."externalId" AS "customerPhone", cu.metadata AS "customerMetadata"
      FROM "Conversation" c
      JOIN "Customer" cu ON cu.id = c."customerId" AND cu."tenantId" = c."tenantId"
      WHERE c.id = ${conversationId} AND c."tenantId" = ${tenantId} AND c."accountId" = ${accountId}
        AND c."customerId" NOT LIKE 'portal-preview:%'
    `;
    const conv = convRows[0];
    if (!conv) throw new PortalError(404, 'CONVERSATION_NOT_FOUND');

    const viewedAt = new Date();
    await store.db.$executeRaw`
      UPDATE "Conversation"
      SET "lastMerchantViewedAt" = ${viewedAt}
      WHERE id = ${conversationId} AND "tenantId" = ${tenantId}
    `;

    const messageRows = await store.db.$queryRaw<any[]>`
      SELECT id, role, content, metadata, "externalId", "createdAt"
      FROM "Message"
      WHERE "conversationId" = ${conversationId} AND "tenantId" = ${tenantId}
      ORDER BY "createdAt" ASC
      LIMIT ${limit}
    `;

    const latestUserMsg = [...messageRows].reverse().find(m => m.role === 'USER');
    let canSendFreeform = false;
    let windowExpiresAt: Date | null = null;
    let secondsRemaining = 0;

    if (latestUserMsg) {
      const lastUserTime = new Date(latestUserMsg.createdAt).getTime();
      const expiresTime = lastUserTime + (24 * 60 * 60 * 1000);
      windowExpiresAt = new Date(expiresTime);
      const diffMs = expiresTime - Date.now();
      if (diffMs > 0) {
        canSendFreeform = true;
        secondsRemaining = Math.floor(diffMs / 1000);
      }
    }

    let state: 'AI_ACTIVE' | 'HUMAN_REQUIRED' | 'HUMAN_ACTIVE' | 'RESOLVED' = 'AI_ACTIVE';
    if (conv.status === 'HUMAN_ACTIVE' || conv.contextData?._portalHandoff?.ownerId) {
      state = 'HUMAN_ACTIVE';
    } else if (conv.status === 'HANDOFF_REQUESTED' || conv.humanRequested) {
      state = 'HUMAN_REQUIRED';
    } else if (conv.status === 'RESOLVED') {
      state = 'RESOLVED';
    }

    send(res, {
      conversation: {
        id: conv.id,
        status: state,
        rawStatus: conv.status,
        ownership: {
          owner: state === 'HUMAN_ACTIVE' ? 'HUMAN' : 'AI',
          state,
          claimedBy: conv.contextData?._portalHandoff?.ownerId || null,
          claimedAt: conv.contextData?._portalHandoff?.claimedAt || null
        },
        customer: {
          id: conv.customerId,
          name: conv.customerMetadata?.name || null,
          phone: conv.customerPhone || conv.customerId
        },
        lastMerchantViewedAt: viewedAt,
        humanRequested: Boolean(conv.humanRequested),
        humanRequestedAt: conv.humanRequestedAt,
        messageCount: conv.messageCount,
        updatedAt: conv.updatedAt,
        createdAt: conv.createdAt,
        customerServiceWindow: {
          canSendFreeform,
          expiresAt: windowExpiresAt,
          secondsRemaining
        }
      },
      messages: messageRows.map(m => ({
        id: m.id,
        role: m.role,
        content: m.content,
        externalId: m.externalId,
        metadata: m.metadata || {},
        createdAt: m.createdAt
      }))
    });
  }));

  client.post('/conversations/:id/takeover', route(async (req, res) => {
    const tenantId = req.portal.tenantId!;
    const accountId = req.portal.accountId!;
    const conversationId = String(req.params.id);

    const convRows = await store.db.$queryRaw<any[]>`
      SELECT id FROM "Conversation"
      WHERE id = ${conversationId} AND "tenantId" = ${tenantId} AND "accountId" = ${accountId}
        AND "customerId" NOT LIKE 'portal-preview:%'
    `;
    if (!convRows.length) throw new PortalError(404, 'CONVERSATION_NOT_FOUND');

    const updated = await automationService.takeover({
      tenantId,
      conversationId,
      accountId,
      actorId: req.portal.user.id
    });

    send(res, {
      success: true,
      conversation: {
        id: updated.id,
        status: 'HUMAN_ACTIVE',
        rawStatus: updated.status,
        ownership: {
          owner: 'HUMAN',
          state: 'HUMAN_ACTIVE',
          claimedBy: req.portal.user.id,
          claimedAt: new Date().toISOString()
        },
        updatedAt: updated.updatedAt
      }
    });
  }));

  client.post('/conversations/:id/resolve', route(async (req, res) => {
    const tenantId = req.portal.tenantId!;
    const accountId = req.portal.accountId!;
    const conversationId = String(req.params.id);

    const convRows = await store.db.$queryRaw<any[]>`
      SELECT id FROM "Conversation"
      WHERE id = ${conversationId} AND "tenantId" = ${tenantId} AND "accountId" = ${accountId}
        AND "customerId" NOT LIKE 'portal-preview:%'
    `;
    if (!convRows.length) throw new PortalError(404, 'CONVERSATION_NOT_FOUND');

    const updated = await automationService.resolve({
      tenantId,
      conversationId,
      accountId,
      actorId: req.portal.user.id
    });

    send(res, {
      success: true,
      conversation: {
        id: updated.id,
        status: 'RESOLVED',
        rawStatus: updated.status,
        ownership: {
          owner: 'AI',
          state: 'RESOLVED',
          claimedBy: null,
          claimedAt: null
        },
        updatedAt: updated.updatedAt
      }
    });
  }));

  client.post('/conversations/:id/reopen', route(async (req, res) => {
    const tenantId = req.portal.tenantId!;
    const accountId = req.portal.accountId!;
    const conversationId = String(req.params.id);

    const convRows = await store.db.$queryRaw<any[]>`
      SELECT id FROM "Conversation"
      WHERE id = ${conversationId} AND "tenantId" = ${tenantId} AND "accountId" = ${accountId}
        AND "customerId" NOT LIKE 'portal-preview:%'
    `;
    if (!convRows.length) throw new PortalError(404, 'CONVERSATION_NOT_FOUND');

    const updated = await automationService.reopen({
      tenantId,
      conversationId,
      accountId,
      actorId: req.portal.user.id
    });

    send(res, {
      success: true,
      conversation: {
        id: updated.id,
        status: 'AI_ACTIVE',
        rawStatus: updated.status,
        ownership: {
          owner: 'AI',
          state: 'AI_ACTIVE',
          claimedBy: null,
          claimedAt: null
        },
        updatedAt: updated.updatedAt
      }
    });
  }));

  client.post('/conversations/:id/read', route(async (req, res) => {
    const tenantId = req.portal.tenantId!;
    const accountId = req.portal.accountId!;
    const conversationId = String(req.params.id);

    const convRows = await store.db.$queryRaw<any[]>`
      SELECT id FROM "Conversation"
      WHERE id = ${conversationId} AND "tenantId" = ${tenantId} AND "accountId" = ${accountId}
        AND "customerId" NOT LIKE 'portal-preview:%'
    `;
    if (!convRows.length) throw new PortalError(404, 'CONVERSATION_NOT_FOUND');

    const viewedAt = new Date();
    await store.db.$executeRaw`
      UPDATE "Conversation"
      SET "lastMerchantViewedAt" = ${viewedAt}
      WHERE id = ${conversationId} AND "tenantId" = ${tenantId}
    `;

    send(res, {
      success: true,
      lastMerchantViewedAt: viewedAt
    });
  }));

  client.post('/conversations/:id/messages', route(async (req, res) => {
    const tenantId = req.portal.tenantId!;
    const accountId = req.portal.accountId!;
    const conversationId = String(req.params.id);

    const body = object(req.body);
    const messageText = text(body.text, 4096);
    if (!messageText || !messageText.trim()) {
      throw new PortalError(400, 'MESSAGE_REQUIRED', 'Message text cannot be empty');
    }

    const rawIdempotencyKey = req.headers['idempotency-key'] 
      ? String(req.headers['idempotency-key'])
      : body.idempotencyKey 
        ? String(body.idempotencyKey)
        : undefined;
    const idempotencyKey = rawIdempotencyKey ? text(rawIdempotencyKey, 128) : undefined;

    const convRows = await store.db.$queryRaw<any[]>`
      SELECT c.*, cu."externalId" AS "customerPhone"
      FROM "Conversation" c
      JOIN "Customer" cu ON cu.id = c."customerId" AND cu."tenantId" = c."tenantId"
      WHERE c.id = ${conversationId} AND c."tenantId" = ${tenantId} AND c."accountId" = ${accountId}
        AND c."customerId" NOT LIKE 'portal-preview:%'
    `;
    const conv = convRows[0];
    if (!conv) throw new PortalError(404, 'CONVERSATION_NOT_FOUND');

    // Precondition 1: Conversation must be claimed (HUMAN_ACTIVE)
    const ownershipState = await automationService.getOwnershipState(tenantId, conversationId);
    if (ownershipState !== 'HUMAN_ACTIVE') {
      throw new PortalError(409, 'HUMAN_TAKEOVER_REQUIRED', 'Conversation must be claimed before sending manual messages');
    }

    // Precondition 2: 24-hour Customer Service Window
    const latestUserMsgRows = await store.db.$queryRaw<any[]>`
      SELECT "createdAt"
      FROM "Message"
      WHERE "conversationId" = ${conversationId} AND "tenantId" = ${tenantId} AND role = 'USER'
      ORDER BY "createdAt" DESC
      LIMIT 1
    `;
    const latestUserMsg = latestUserMsgRows[0];
    if (!latestUserMsg) {
      throw new PortalError(400, 'CUSTOMER_SERVICE_WINDOW_EXPIRED', 'Customer service window has expired (24h). Free-form messages cannot be sent without prior user message.');
    }
    const lastUserTime = new Date(latestUserMsg.createdAt).getTime();
    if (Date.now() - lastUserTime > 24 * 60 * 60 * 1000) {
      throw new PortalError(400, 'CUSTOMER_SERVICE_WINDOW_EXPIRED', 'Customer service window has expired (24h). Free-form messages cannot be sent.');
    }

    // Precondition 3: Resolve connected WhatsApp number
    const numberRows = await store.db.$queryRaw<any[]>`
      SELECT "phoneNumberId", status, enabled
      FROM "WhatsAppBusinessNumber"
      WHERE "tenantId" = ${tenantId} AND "accountId" = ${accountId} AND enabled = true
      ORDER BY status = 'CONNECTED' DESC, "updatedAt" DESC
      LIMIT 1
    `;
    const connectedNumber = numberRows[0];
    if (!connectedNumber || !connectedNumber.phoneNumberId) {
      throw new PortalError(400, 'NO_CONNECTED_PHONE_NUMBER', 'No active WhatsApp business number connected for this account');
    }

    const recipientPhone = conv.customerPhone || conv.customerId;
    const outboundQueue = deps.whatsAppOutboundQueue;
    if (!outboundQueue) {
      throw new PortalError(503, 'OUTBOUND_QUEUE_UNAVAILABLE', 'Outbound message queue is not available');
    }

    const messageId = randomUUID();
    const now = new Date();
    await store.db.$executeRaw`
      INSERT INTO "Message"(id, "tenantId", "conversationId", role, content, metadata, "createdAt")
      VALUES (
        ${messageId},
        ${tenantId},
        ${conversationId},
        'ASSISTANT',
        ${messageText},
        ${JSON.stringify({
          deliveryStatus: 'PENDING',
          manual: true,
          authorId: req.portal.user.id,
          authorName: req.portal.user.name
        })}::jsonb,
        ${now}
      )
    `;

    const dedupeKey = `manual:${conversationId}:${idempotencyKey || messageId}`;
    await outboundQueue.enqueue({
      dedupeKey,
      tenantId,
      accountId,
      conversationId,
      messageId,
      phoneNumberId: connectedNumber.phoneNumberId,
      recipientWaId: recipientPhone,
      text: messageText
    });

    await store.db.$executeRaw`
      UPDATE "Conversation"
      SET "lastMerchantViewedAt" = ${now}, "updatedAt" = ${now}, "messageCount" = "messageCount" + 1
      WHERE id = ${conversationId} AND "tenantId" = ${tenantId}
    `;

    send(res, {
      success: true,
      message: {
        id: messageId,
        role: 'ASSISTANT',
        content: messageText,
        status: 'PENDING',
        metadata: {
          deliveryStatus: 'PENDING',
          manual: true,
          authorId: req.portal.user.id,
          authorName: req.portal.user.name
        },
        createdAt: now
      }
    }, 201);
  }));

  admin.get('/overview', route(async (_req, res) => {
    const period = new Date().toISOString().slice(0, 7);
    const [counts, usageRows, trafficRows, daily, connectionRows, failureRows, recentAccounts, activity] = await Promise.all([
      store.db.$queryRaw<any[]>`SELECT status,COUNT(*)::int AS count FROM "PortalProfile" GROUP BY status`,
      store.db.$queryRaw<any[]>`SELECT COALESCE(SUM(messages),0)::bigint AS messages,COALESCE(SUM("llmCalls"),0)::bigint AS "llmCalls",COALESCE(SUM("spentMicros"),0)::bigint AS "spentMicros",COALESCE(SUM("reservedMicros"),0)::bigint AS "reservedMicros" FROM "PortalUsageBucket" WHERE period=${period}`,
      store.db.$queryRaw<any[]>`SELECT COUNT(*)::int AS conversations,COUNT(DISTINCT (c."accountId",c."customerId"))::int AS contacts,
        COUNT(*) FILTER(WHERE c."humanRequested"=true)::int AS handoffs FROM "Conversation" c
        JOIN "PortalProfile" p ON p."accountId"=c."accountId" AND p."tenantId"=c."tenantId"
        WHERE c."customerId" NOT LIKE 'portal-preview:%' AND c."createdAt">NOW()-INTERVAL '30 days'`,
      store.db.$queryRaw<any[]>`SELECT date_trunc('day',m."createdAt") AS day,
        COUNT(*) FILTER(WHERE m.role='USER')::int AS inbound,COUNT(*) FILTER(WHERE m.role='ASSISTANT')::int AS outbound
        FROM "Message" m JOIN "Conversation" c ON c.id=m."conversationId"
        JOIN "PortalProfile" p ON p."accountId"=c."accountId" AND p."tenantId"=c."tenantId"
        WHERE c."customerId" NOT LIKE 'portal-preview:%' AND m."createdAt">NOW()-INTERVAL '14 days'
        GROUP BY day ORDER BY day`,
      store.db.$queryRaw<any[]>`SELECT COUNT(*)::int AS connected FROM "WhatsAppBusinessNumber" n
        JOIN "PortalProfile" p ON p."accountId"=n."accountId" AND p."tenantId"=n."tenantId"
        LEFT JOIN "ChannelConnection" cc ON cc.id=n."connectionId"
        WHERE n.status='CONNECTED' AND (cc.id IS NULL OR cc.enabled=true)`,
      store.db.$queryRaw<any[]>`SELECT COUNT(*)::int AS failed FROM "WhatsAppMessageJob" j
        JOIN "PortalProfile" p ON p."accountId"=j."accountId" AND p."tenantId"=j."tenantId"
        WHERE j."createdAt">NOW()-INTERVAL '30 days' AND (j.status='FAILED' OR j."outboundStatus"='FAILED')`,
      store.db.$queryRaw<any[]>`SELECT p."accountId",p.status,p."updatedAt",a.name,p."planSnapshot"->>'name' AS "planName"
        FROM "PortalProfile" p JOIN "Account" a ON a.id=p."accountId" AND a."tenantId"=p."tenantId"
        ORDER BY p."updatedAt" DESC LIMIT 6`,
      store.auditHistory(null)
    ]);
    send(res, { counts, usage: usageRows[0], period, traffic: trafficRows[0], daily,
      connectedNumbers: connectionRows[0]?.connected || 0, failedDeliveries: failureRows[0]?.failed || 0,
      recentAccounts, activity });
  }));
  admin.get('/usage', route(async (_req, res) => {
    const period = new Date().toISOString().slice(0, 7);
    const accounts = await store.db.$queryRaw<any[]>`SELECT p."accountId",a.name,p.status,p."planSnapshot"->'limits'->>'monthlyUsd' AS "monthlyUsd",
      b.messages,b."llmCalls",b.images,b.embeddings,b."spentMicros",b."reservedMicros",
      (SELECT COUNT(*)::int FROM "WhatsAppMessageJob" j WHERE j."accountId"=p."accountId" AND j."tenantId"=p."tenantId"
        AND j."createdAt">NOW()-INTERVAL '24 hours' AND (j.status='FAILED' OR j."outboundStatus"='FAILED')) AS "failedDeliveries24h"
      FROM "PortalProfile" p JOIN "Account" a ON a.id=p."accountId"
      LEFT JOIN "PortalUsageBucket" b ON b."accountId"=p."accountId" AND b.period=${period} ORDER BY COALESCE(b."spentMicros",0) DESC LIMIT 500`;
    send(res, { period, accounts });
  }));
  admin.get('/handoffs', route(async (_req, res) => {
    const conversations = await store.db.$queryRaw<any[]>`SELECT c.id,c."accountId",a.name AS "accountName",c.status,c."humanRequestedAt",c."updatedAt",
      COALESCE(cu."externalId",c."customerId") AS "customerLabel",c."contextData"->'_portalHandoff'->>'ownerId' AS "ownerId",u.name AS "ownerName"
      FROM "Conversation" c JOIN "PortalProfile" p ON p."accountId"=c."accountId" AND p."tenantId"=c."tenantId"
      JOIN "Account" a ON a.id=p."accountId" AND a."tenantId"=p."tenantId"
      LEFT JOIN "Customer" cu ON cu.id=c."customerId" AND cu."tenantId"=c."tenantId"
      LEFT JOIN "PortalUser" u ON u.id=c."contextData"->'_portalHandoff'->>'ownerId'
      WHERE c."humanRequested"=true AND c.status IN ('HANDOFF_REQUESTED','HUMAN_ACTIVE') AND c."customerId" NOT LIKE 'portal-preview:%'
      ORDER BY c."humanRequestedAt" ASC NULLS LAST LIMIT 100`;
    send(res, { conversations });
  }));
  admin.get('/accounts', route(async (req, res) => send(res, { accounts: await store.accounts(text(req.query.search, 160), Number(req.query.offset || 0) || 0) })));
  admin.get('/accounts/:id', route(async (req, res) => {
    const p = await store.profile(String(req.params.id));
    send(res, { profile: p, connections: await store.connections(p.accountId, p.tenantId), documents: await documents.list(p.accountId), versions: await store.versions(p.accountId),
      members: await store.db.$queryRaw<any[]>`SELECT u.id,u.name,u.email,u."verifiedAt",u.disabled FROM "PortalUser" u JOIN "PortalMembership" m ON m."userId"=u.id WHERE m."accountId"=${p.accountId}` });
  }));
  admin.patch('/accounts/:id', route(async (req, res) => {
    const data = object(req.body); allowed(data, ['revision', 'status', 'planId', 'limitOverrides', 'adminConfig', 'autoPublish', 'lockedFields', 'reviewNote']);
    const { revision, ...changes } = data;
    validateAccountChanges(changes);
    send(res, { profile: await store.updateAccount(req.portal.user.id, String(req.params.id), integer(revision, 1), changes) });
  }));
  admin.put('/accounts/:id/business', route(async (req, res) => {
    const p = await store.profile(String(req.params.id));
    // Admin edits use the same validated facts contract; technical controls have their own endpoint.
    send(res, { profile: await store.saveDraft(req.portal.user.id, p.accountId, p.tenantId, req.body?.data, integer(req.body?.revision, 1), true) });
  }));
  admin.post('/accounts/:id/publish', route(async (req, res) => {
    const body = object(req.body); allowed(body, ['revision','changes']);
    const revision = integer(body.revision, 1), id = String(req.params.id);
    const profile = body.changes === undefined
      ? await store.publish(req.portal.user.id, id, revision)
      : await store.updateAccount(req.portal.user.id, id, revision, validateAccountChanges(object(body.changes)), true);
    send(res, { profile });
  }));
  admin.post('/accounts/:id/restore', route(async (req, res) => send(res, { profile: await store.restore(req.portal.user.id, String(req.params.id), text(req.body?.publicationId, 100), integer(req.body?.revision, 1)) })));
  admin.get('/accounts/:id/stats', route(async (req, res) => { const p = await store.profile(String(req.params.id)); send(res, await store.stats(p.accountId, p.tenantId, Math.max(1, Math.min(90, Number(req.query.days || 30))))); }));
  admin.get('/accounts/:id/activity', route(async (req, res) => { const p = await store.profile(String(req.params.id)); send(res, { events: await store.auditHistory(p.accountId) }); }));
  admin.post('/accounts/:id/documents/:docId/publish', route(async (req, res) => { await store.profile(String(req.params.id)); await documents.queue(req.portal.user.id, String(req.params.id), String(req.params.docId)); send(res, { queued: true }); }));
  admin.get('/accounts/:id/documents/:docId/download', route(async (req, res) => { const p = await store.profile(String(req.params.id)); await downloadDocument(res, req.portal.user.id, p.accountId, String(req.params.docId)); }));
  admin.delete('/accounts/:id/documents/:docId', route(async (req, res) => { await documents.remove(req.portal.user.id, String(req.params.id), String(req.params.docId), true); send(res, { success: true }); }));
  admin.patch('/accounts/:id/connections/:connectionId', route(async (req, res) => {
    const p = await store.profile(String(req.params.id));
    if (typeof req.body?.enabled !== 'boolean') throw new PortalError(400, 'INVALID_SETTING');
    await store.transaction(async s => {
      const n = await s.db.$executeRaw`UPDATE "ChannelConnection" SET enabled=${req.body.enabled},"updatedAt"=NOW() WHERE id=${String(req.params.connectionId)} AND "tenantId"=${p.tenantId} AND "accountId"=${p.accountId}`;
      if (!n) throw new PortalError(404, 'CONNECTION_NOT_FOUND');
      await s.db.$executeRaw`UPDATE "WhatsAppBusinessNumber" SET enabled=${req.body.enabled},"updatedAt"=NOW() WHERE "connectionId"=${String(req.params.connectionId)} AND "tenantId"=${p.tenantId} AND "accountId"=${p.accountId}`;
      await s.audit(req.portal.user.id, p.accountId, 'CONNECTION_TOGGLED', { enabled: req.body.enabled });
    }); send(res, { success: true });
  }));
  admin.get('/accounts/:id/conversations', route(async (req, res) => {
    const p = await store.profile(String(req.params.id));
    const rows = await store.db.$queryRaw<any[]>`SELECT c.id,c.status,COALESCE(cu."externalId",c."customerId") AS "customerId",c."messageCount",c."humanRequested",c."updatedAt",
      c."contextData"->'_portalHandoff'->>'ownerId' AS "ownerId",u.name AS "ownerName" FROM "Conversation" c
      LEFT JOIN "Customer" cu ON cu.id=c."customerId" AND cu."tenantId"=c."tenantId"
      LEFT JOIN "PortalUser" u ON u.id=c."contextData"->'_portalHandoff'->>'ownerId'
      WHERE c."tenantId"=${p.tenantId} AND c."accountId"=${p.accountId} AND c."customerId" NOT LIKE 'portal-preview:%' ORDER BY c."updatedAt" DESC LIMIT 50`;
    send(res, { conversations: rows });
  }));
  admin.post('/accounts/:id/conversations/:conversationId/triage', route(async (req, res) => {
    const body = object(req.body); allowed(body, ['action']);
    const action = text(body.action, 20);
    if (!['claim','release','resolve'].includes(action)) throw new PortalError(400, 'INVALID_HANDOFF_ACTION');
    const p = await store.profile(String(req.params.id));
    const conversationId = String(req.params.conversationId);
    const conversation = await store.transaction(async s => {
      const rows = await s.db.$queryRaw<any[]>`SELECT id,status,"humanRequested","humanRequestedAt","contextData" FROM "Conversation"
        WHERE id=${conversationId} AND "accountId"=${p.accountId} AND "tenantId"=${p.tenantId} AND "customerId" NOT LIKE 'portal-preview:%' FOR UPDATE`;
      const c = rows[0];
      if (!c) throw new PortalError(404, 'CONVERSATION_NOT_FOUND');
      if (!c.humanRequested || !['HANDOFF_REQUESTED','HUMAN_ACTIVE'].includes(c.status)) throw new PortalError(409, 'HANDOFF_NOT_PENDING');
      const context = c.contextData && typeof c.contextData === 'object' && !Array.isArray(c.contextData) ? c.contextData : {};
      const ownerId = context._portalHandoff?.ownerId;
      if (ownerId && ownerId !== req.portal.user.id) throw new PortalError(409, 'HANDOFF_OWNED_BY_ANOTHER_ADMIN');
      if (action !== 'claim' && ownerId !== req.portal.user.id) throw new PortalError(409, 'CLAIM_HANDOFF_FIRST');
      const updatedContext = { ...context };
      if (action === 'claim') updatedContext._portalHandoff = { ownerId: req.portal.user.id, claimedAt: context._portalHandoff?.claimedAt || new Date().toISOString() };
      else delete updatedContext._portalHandoff;
      const status = action === 'claim' ? 'HUMAN_ACTIVE' : action === 'release' ? 'HANDOFF_REQUESTED' : 'ACTIVE';
      await s.db.$executeRaw`UPDATE "Conversation" SET status=${status},"humanRequested"=${action !== 'resolve'},
        "humanRequestedAt"=${action === 'resolve' ? null : c.humanRequestedAt},"contextData"=${JSON.stringify(updatedContext)}::jsonb,"updatedAt"=NOW()
        WHERE id=${conversationId} AND "accountId"=${p.accountId} AND "tenantId"=${p.tenantId}`;
      await (s.db as any).conversationAutomationState.upsert({
        where: { conversationId },
        create: {
          tenantId: p.tenantId,
          accountId: p.accountId,
          conversationId,
          humanTakeover: action === 'claim',
          botEnabled: action !== 'claim',
          pauseReason: action === 'release' ? 'HANDOFF_REQUESTED' : null,
          updatedBy: req.portal.user.id
        },
        update: {
          humanTakeover: action === 'claim',
          botEnabled: action !== 'claim',
          pauseReason: action === 'release' ? 'HANDOFF_REQUESTED' : null,
          updatedBy: req.portal.user.id
        }
      });
      await s.audit(req.portal.user.id,p.accountId,'HANDOFF_'+action.toUpperCase(),{ conversationId });
      return { id: conversationId, status, humanRequested: action !== 'resolve', ownerId: action === 'claim' ? req.portal.user.id : null };
    });
    send(res, { conversation });
  }));
  admin.get('/accounts/:id/conversations/:conversationId', route(async (req, res) => {
    const p = await store.profile(String(req.params.id));
    const rows = await store.db.$queryRaw<any[]>`SELECT m.id,m.role,m.content,m."createdAt" FROM "Message" m JOIN "Conversation" c ON c.id=m."conversationId"
      WHERE c.id=${String(req.params.conversationId)} AND c."tenantId"=${p.tenantId} AND m."tenantId"=${p.tenantId} AND c."accountId"=${p.accountId} ORDER BY m."createdAt" DESC LIMIT 100`;
    await store.audit(req.portal.user.id, p.accountId, 'CONVERSATION_VIEWED', { conversationId: String(req.params.conversationId) });
    send(res, { messages: rows.reverse() });
  }));
  admin.post('/accounts/:id/preview', route(async (req, res) => {
    const p = await store.profile(String(req.params.id));
    await store.throttle('preview:' + p.accountId, 10, 60);
    const body = object(req.body); allowed(body, ['message', 'mode', 'sessionId']);
    const message = text(body.message, 2000); if (!message) throw new PortalError(400, 'MESSAGE_REQUIRED');
    const mode = text(body.mode, 20, 'published');
    if (!['draft', 'published'].includes(mode)) throw new PortalError(400, 'INVALID_PREVIEW_MODE');
    const sessionId = text(body.sessionId, 100, `${req.portal.user.id}-${Date.now()}`);
    if (!/^[a-zA-Z0-9_-]{8,100}$/.test(sessionId)) throw new PortalError(400, 'INVALID_PREVIEW_SESSION');
    const account = (await store.db.$queryRaw<any[]>`SELECT config FROM "Account" WHERE id=${p.accountId} AND "tenantId"=${p.tenantId}`)[0];
    if (!account) throw new PortalError(404, 'ACCOUNT_NOT_FOUND');
    let config: any;
    if (mode === 'draft') {
      config = compileBusiness(p.draft, p.planSnapshot?.template || {}, p.adminConfig || {}, account.config || {});
    } else {
      if (!p.published || !account.config) throw new PortalError(400, 'PUBLISH_FIRST', 'Publish this account before testing the published version.');
      config = account.config;
    }
    const engine: any = deps.conversationEngine;
    const response = typeof engine.previewMessage === 'function'
      ? await engine.previewMessage(p.tenantId, p.accountId, `${req.portal.user.id}:${sessionId}`, message, config)
      : await engine.handleMessage(p.tenantId, `portal-preview:${req.portal.user.id}:${sessionId}`, message, p.accountId);
    await store.audit(req.portal.user.id, p.accountId, 'CHATBOT_PREVIEWED', { mode, sessionId });
    send(res, { response, mode, sessionId });
  }));
  admin.get('/plans', route(async (_req, res) => send(res, { plans: await store.plans() })));
  admin.post('/plans', route(async (req, res) => send(res, { plan: await store.savePlan(req.portal.user.id, validatePlan(req.body)) }, 201)));
  admin.put('/plans/:id', route(async (req, res) => send(res, { plan: await store.savePlan(req.portal.user.id, validatePlan(req.body), String(req.params.id), integer(req.body?.revision, 1)) })));
  admin.get('/users', route(async (_req, res) => send(res, { users: await store.db.$queryRaw<any[]>`SELECT id,email,name,role,"verifiedAt",disabled,"createdAt" FROM "PortalUser" ORDER BY "createdAt" DESC LIMIT 100` })));
  admin.patch('/users/:id', route(async (req, res) => {
    if (typeof req.body?.disabled !== 'boolean' || String(req.params.id) === req.portal.user.id) throw new PortalError(400, 'INVALID_USER_CHANGE');
    await store.transaction(async s => {
      const target = await s.userById(String(req.params.id));
      if (!target || target.role === 'ADMIN') throw new PortalError(403, 'ADMIN_ACCOUNT_PROTECTED');
      await s.db.$executeRaw`UPDATE "PortalUser" SET disabled=${req.body.disabled} WHERE id=${target.id}`;
      if (req.body.disabled) await s.db.$executeRaw`DELETE FROM "PortalSession" WHERE "userId"=${target.id}`;
      await s.audit(req.portal.user.id, null, 'USER_ACCESS_UPDATED', { userId: target.id, disabled: req.body.disabled });
    }); send(res, { success: true });
  }));
  router.use('/auth', authRouter); router.use('/client', client); router.use('/admin', admin);
  router.use(['/auth', '/client', '/admin', '/portal'], (_req, res) => send(res, { error: 'NOT_FOUND' }, 404));
  router.use((error: any, _req: Request, res: Response, next: express.NextFunction) => {
    if (res.headersSent) return next(error);
    if (error instanceof PortalError) return send(res, { error: error.code, message: error.message }, error.status);
    if (error instanceof multer.MulterError) return send(res, { error: 'UPLOAD_LIMIT', message: 'Choose one PDF up to 10 MB.' }, 400);
    if (error?.code === '42P01' || error?.meta?.code === '42P01') return send(res, { error: 'PORTAL_MIGRATION_REQUIRED', message: 'Portal setup is not complete. Apply the database migration before enabling registration.' }, 503);
    if (error?.code === '23505' || error?.meta?.code === '23505') return send(res, { error: 'ALREADY_EXISTS', message: 'This record already exists. Reload and try again.' }, 409);
    logger.error('Portal request failed', {
      code: error?.code || error?.meta?.code,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    send(res, { error: 'PORTAL_UNAVAILABLE', message: 'The request could not be completed. Please try again.' }, 500);
  });
  return router;
}
