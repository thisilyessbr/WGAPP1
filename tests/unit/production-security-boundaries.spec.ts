import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app';
import { createDevChatRouter, createSignedToken } from '../../src/dev/chatApi';
import { requireAuth } from '../../src/middleware/authMiddleware';

const originalNodeEnv = process.env.NODE_ENV;
const originalAuthSecret = process.env.AUTH_SECRET;
const originalDevApiKey = process.env.DEV_API_KEY;

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
  process.env.AUTH_SECRET = originalAuthSecret;
  process.env.DEV_API_KEY = originalDevApiKey;
});

describe('production API security boundaries', () => {
  it('does not mount the legacy /api/dev alias in production', async () => {
    process.env.NODE_ENV = 'production';
    const deps: any = {
      prisma: {
        $queryRawUnsafe: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
        $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }])
      }
    };

    const app = await createApp(deps);
    const response = await request(app).get('/api/dev/health');

    expect(response.status).toBe(404);
    expect(response.headers['x-powered-by']).toBeUndefined();
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });

  it('does not allow a tenant admin token to override its tenant', async () => {
    process.env.AUTH_SECRET = 'unit-test-auth-secret-with-at-least-32-bytes';
    const token = createSignedToken({ tenantId: 'tenant-a', role: 'admin' });
    const app = express();
    app.use(express.json());
    app.post('/protected', requireAuth(), (_req, res) => res.json({ ok: true }));

    const response = await request(app)
      .post('/protected')
      .set('Authorization', `Bearer ${token}`)
      .send({ tenantId: 'tenant-b' });

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('FORBIDDEN');
  });

  it('reserves tenant discovery for the platform API key', async () => {
    process.env.AUTH_SECRET = 'unit-test-auth-secret-with-at-least-32-bytes';
    process.env.DEV_API_KEY = 'unit-test-platform-key-with-at-least-32-bytes';
    const findMany = vi.fn().mockResolvedValue([]);
    const deps: any = {
      prisma: { tenant: { findMany } }
    };
    const router = createDevChatRouter(deps);
    const app = express();
    app.use(express.json());
    app.use(router);

    const tenantAdminToken = createSignedToken({ tenantId: 'tenant-a', role: 'admin' });
    const denied = await request(app)
      .get('/tenants')
      .set('Authorization', `Bearer ${tenantAdminToken}`);
    expect(denied.status).toBe(403);
    expect(findMany).not.toHaveBeenCalled();

    const allowed = await request(app)
      .get('/tenants')
      .set('x-api-key', process.env.DEV_API_KEY);
    expect(allowed.status).toBe(200);
    expect(findMany).toHaveBeenCalledOnce();
  });
});
