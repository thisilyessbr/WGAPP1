import { Router, Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { PortalService } from '../../../portal/PortalService';
import { ConversationEngine } from '../../conversation/ConversationEngine';
import { InstagramService, verifyInstagramSignature } from './InstagramService';

export function createInstagramRouter(db: PrismaClient, portal: PortalService, engine: ConversationEngine): { router: Router; service: InstagramService } {
  const router = Router();
  const service = new InstagramService(db, engine);
  if (process.env.NODE_ENV !== 'test') service.start();
  const wrap = (fn: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
  const client = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const principal = await portal.auth.principal(req);
      if (principal.user.role !== 'CLIENT' || !principal.accountId || !principal.tenantId) return res.status(403).json({ error: 'ACCESS_DENIED' });
      if (!['GET', 'HEAD'].includes(req.method)) portal.auth.checkCsrf(req, principal);
      (req as any).instagramPrincipal = principal;
      next();
    } catch (error) { next(error); }
  };

  router.get('/webhook', (req, res) => {
    if (!service.configured()) return res.sendStatus(503);
    const token = req.query['hub.verify_token'];
    if (req.query['hub.mode'] !== 'subscribe' || typeof token !== 'string' || token !== process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN)
      return res.sendStatus(403);
    res.status(200).type('text/plain').send(String(req.query['hub.challenge'] || ''));
  });
  router.post('/webhook', wrap(async (req, res) => {
    if (!service.configured()) { res.sendStatus(503); return; }
    if (!verifyInstagramSignature((req as any).rawBody, req.headers['x-hub-signature-256'], process.env.INSTAGRAM_APP_SECRET!)) {
      res.sendStatus(401); return;
    }
    const count = await service.ingest(req.body);
    res.status(200).json({ accepted: count });
  }));

  router.get('/connections', client, wrap(async (req, res) => {
    const p = (req as any).instagramPrincipal;
    res.json({ configured: service.configured(), connection: await service.list(p.accountId, p.tenantId) });
  }));
  router.post('/connect/start', client, wrap(async (req, res) => {
    const p = (req as any).instagramPrincipal;
    if (!service.configured()) { res.status(503).json({ error: 'INSTAGRAM_NOT_CONFIGURED', message: 'Instagram setup is not ready yet. Ask your administrator.' }); return; }
    const profile = await db.portalProfile.findUnique({ where: { accountId: p.accountId } });
    if (!profile || profile.tenantId !== p.tenantId || !profile.planSnapshot || !['APPROVED', 'ACTIVE'].includes(profile.status)) {
      res.status(403).json({ error: 'PLAN_APPROVAL_REQUIRED', message: 'An approved plan is required to connect Instagram.' }); return;
    }
    await portal.store.throttle(`ig-start:${p.accountId}`, 5, 900);
    res.json({ url: service.authorizationUrl({ userId: p.user.id, accountId: p.accountId, tenantId: p.tenantId }) });
  }));
  router.get('/connect/callback', wrap(async (req, res) => {
    const fail = (code: string) => res.redirect(`/app/instagram?error=${encodeURIComponent(code)}`);
    if (typeof req.query.code !== 'string' || typeof req.query.state !== 'string') { fail('INSTAGRAM_LOGIN_CANCELLED'); return; }
    try {
      const expected = service.verifyState(req.query.state);
      const p = await portal.auth.principal(req);
      if (p.user.role !== 'CLIENT' || p.user.id !== expected.userId || p.accountId !== expected.accountId || p.tenantId !== expected.tenantId) {
        fail('INSTAGRAM_SESSION_MISMATCH'); return;
      }
      const profile = await db.portalProfile.findUnique({ where: { accountId: expected.accountId } });
      if (!profile || profile.tenantId !== expected.tenantId || !profile.planSnapshot || !['APPROVED', 'ACTIVE'].includes(profile.status)) {
        fail('PLAN_APPROVAL_REQUIRED'); return;
      }
      await service.complete(req.query.code, expected.accountId, expected.tenantId);
      res.redirect('/app/instagram?connected=1');
    } catch (error) {
      const code = error instanceof Error && /^INSTAGRAM_[A-Z_]+$/.test(error.message) ? error.message : 'INSTAGRAM_CONNECTION_FAILED';
      fail(code);
    }
  }));
  router.post('/disconnect', client, wrap(async (req, res) => {
    const p = (req as any).instagramPrincipal;
    await service.disconnect(p.accountId, p.tenantId);
    res.json({ success: true });
  }));

  router.get('/admin/accounts/:accountId', wrap(async (req, res) => {
    const p = await portal.auth.principal(req);
    if (p.user.role !== 'ADMIN') { res.sendStatus(403); return; }
    const accountId = String(req.params.accountId);
    const account = await db.account.findUnique({ where: { id: accountId } });
    if (!account) { res.sendStatus(404); return; }
    res.json({ connection: await service.list(accountId, account.tenantId) });
  }));
  router.patch('/admin/accounts/:accountId', wrap(async (req, res) => {
    const p = await portal.auth.principal(req);
    if (p.user.role !== 'ADMIN') { res.sendStatus(403); return; }
    portal.auth.checkCsrf(req, p);
    if (typeof req.body?.enabled !== 'boolean') { res.status(400).json({ error: 'INVALID_SETTING' }); return; }
    const accountId = String(req.params.accountId);
    const account = await db.account.findUnique({ where: { id: accountId } });
    if (!account) { res.sendStatus(404); return; }
    const connection = await db.instagramConnection.findFirst({ where: { accountId, tenantId: account.tenantId } });
    if (!connection) { res.sendStatus(404); return; }
    if (req.body.enabled && connection.tokenExpiresAt <= new Date()) {
      res.status(409).json({ error: 'INSTAGRAM_RECONNECT_REQUIRED', message: 'The Instagram access token expired. Ask the client to reconnect.' }); return;
    }
    await db.instagramConnection.updateMany({ where: { accountId, tenantId: account.tenantId }, data: { enabled: req.body.enabled } });
    res.json({ connection: await service.list(accountId, account.tenantId) });
  }));
  return { router, service };
}
