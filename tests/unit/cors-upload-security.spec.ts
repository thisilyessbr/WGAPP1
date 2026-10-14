import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app';
import { createDevChatRouter } from '../../src/dev/chatApi';

describe('CORS and legacy upload security', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.NODE_ENV = 'production';
    process.env.AUTH_SECRET = 'production-auth-secret-with-at-least-32-bytes';
    process.env.DEV_API_KEY = 'production-platform-key-with-at-least-32-bytes';
    process.env.CORS_ORIGINS = 'https://app.relayqo.online, https://relayqo.online';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('rejects an unauthenticated legacy PDF upload before parsing the file', async () => {
    const deps: any = {
      prisma: {
        tenant: { findUnique: vi.fn() }
      }
    };
    const app = express();
    app.use('/api/v1', createDevChatRouter(deps));

    const response = await request(app)
      .post('/api/v1/upload?tenantId=tenant-a')
      .attach('document', Buffer.from('%PDF-1.4\n'), 'knowledge.pdf');

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('UNAUTHORIZED');
    expect(deps.prisma.tenant.findUnique).not.toHaveBeenCalled();
  });

  it('emits credentialed CORS headers for a configured production origin', async () => {
    const deps: any = {
      prisma: {
        $queryRawUnsafe: vi.fn().mockResolvedValue([{ value: 1 }])
      }
    };
    const app = await createApp(deps);

    const response = await request(app)
      .get('/health')
      .set('Origin', 'https://app.relayqo.online');

    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe('https://app.relayqo.online');
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  it('does not emit CORS permission for an untrusted production origin', async () => {
    const deps: any = {
      prisma: {
        $queryRawUnsafe: vi.fn().mockResolvedValue([{ value: 1 }])
      }
    };
    const app = await createApp(deps);

    const response = await request(app)
      .get('/health')
      .set('Origin', 'https://attacker.example');

    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect(response.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('keeps origin-less server callbacks available', async () => {
    const deps: any = {
      prisma: {
        $queryRawUnsafe: vi.fn().mockResolvedValue([{ value: 1 }])
      }
    };
    const app = await createApp(deps);

    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
  });
});
