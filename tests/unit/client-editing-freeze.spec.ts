import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createPortalRouter } from '../../src/portal/PortalRouter';

describe('admin client editing freeze', () => {
  it('blocks chatbot data changes for the client while leaving other actions and admin edits available', async () => {
    let frozen = false;
    const profile = () => ({
      accountId: 'account-1', tenantId: 'tenant-1', editingFrozen: frozen, status: 'DRAFT',
      draft: {}, published: null, revision: 1, publishedRevision: 0,
      planSnapshot: null, requestedPlanId: null, adminConfig: {}, lockedFields: [], autoPublish: false
    });
    const store = {
      profile: vi.fn(async () => profile()),
      setEditingFrozen: vi.fn(async (_actor: string, _account: string, value: boolean) => {
        frozen = value;
        return profile();
      }),
      saveDraft: vi.fn(async () => profile()),
      requestPlan: vi.fn(async () => undefined)
    };
    const auth = {
      principal: vi.fn(async (req: express.Request) => ({
        user: { id: 'actor-1', role: req.header('x-role') === 'admin' ? 'ADMIN' : 'CLIENT' },
        accountId: 'account-1', tenantId: 'tenant-1'
      })),
      checkCsrf: vi.fn()
    };
    const app = express();
    app.use(express.json());
    app.use('/api', createPortalRouter({ store, auth, connections: {}, documents: {} } as any, {} as any));
    app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(error.status || 500).json({ code: error.code }));

    const admin = (value: boolean) => request(app).patch('/api/admin/accounts/account-1/editing-freeze')
      .set('x-role', 'admin').send({ frozen: value });
    expect((await admin(true)).status).toBe(200);
    expect((await request(app).put('/api/client/business').send({ data: {}, revision: 1 })).status).toBe(403);
    expect((await request(app).post('/api/client/documents').send()).status).toBe(403);
    expect((await request(app).post('/api/client/plan-request').send({ planId: 'plan-1' })).status).toBe(200);
    expect((await request(app).put('/api/admin/accounts/account-1/business').set('x-role', 'admin').send({ data: {}, revision: 1 })).status).toBe(200);
    expect((await request(app).patch('/api/admin/accounts/account-1/editing-freeze').send({ frozen: false })).status).toBe(403);
    expect((await admin(false)).status).toBe(200);
    expect((await request(app).put('/api/client/business').send({ data: {}, revision: 1 })).status).toBe(200);
  });
});
