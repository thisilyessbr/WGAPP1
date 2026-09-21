import express from 'express';
import request from 'supertest';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createApp } from '../../src/app';
import { createDevChatRouter, createSignedToken } from '../../src/dev/chatApi';
import { validateProductionConfig, ConfigurationError } from '../../src/config/env';

describe('Production Security Remediation Suite', () => {
  const originalEnv = { ...process.env };
  const validSecret = 'production-secret-with-at-least-32-characters-entropy!';
  const validKey = 'encryption-key-with-at-least-32-characters-entropy!';
  const platformKey = 'platform-admin-key-with-at-least-32-characters!';

  beforeEach(() => {
    process.env.AUTH_SECRET = validSecret;
    process.env.ENCRYPTION_KEY = validKey;
    process.env.DEV_API_KEY = platformKey;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  // =========================================================================
  // 1. Production Startup Configuration Fail-Closed Validation
  // =========================================================================
  describe('1. Production Configuration Validation', () => {
    const baseValidConfig = {
      port: 3000,
      databaseUrl: 'postgresql://prod_user:secret@prod-db.supabase.co:5432/postgres?schema=public',
      authSecret: validSecret,
      deepseekApiKey: 'sk-deepseek-prod-12345',
      googleApiKey: 'AIzaSyProd12345',
      logLevel: 'info',
      encryptionKey: validKey,
      whatsappAppSecret: 'meta-app-secret-prod-12345',
      whatsappWebhookVerifyToken: 'verify-token-prod-12345',
      metaAppId: 'meta-app-id-prod',
      metaAppSecret: 'meta-app-secret-prod',
      signupStateSecret: 'signup-secret-at-least-32-chars-long!',
    };

    it('passes when all production configurations are satisfied', () => {
      expect(() => validateProductionConfig(baseValidConfig, 'production')).not.toThrow();
    });

    it('rejects localhost database URL in production', () => {
      const cfg = { ...baseValidConfig, databaseUrl: 'postgresql://postgres:postgres@localhost:5432/chatbot' };
      expect(() => validateProductionConfig(cfg, 'production')).toThrow(ConfigurationError);
    });

    it('rejects missing or short AUTH_SECRET (<32 chars) in production', () => {
      const cfgMissing = { ...baseValidConfig, authSecret: '' };
      expect(() => validateProductionConfig(cfgMissing, 'production')).toThrow(ConfigurationError);

      const cfgShort = { ...baseValidConfig, authSecret: 'too-short-secret' };
      expect(() => validateProductionConfig(cfgShort, 'production')).toThrow(ConfigurationError);
    });

    it('rejects missing or short ENCRYPTION_KEY (<32 chars) in production', () => {
      const cfgMissing = { ...baseValidConfig, encryptionKey: '' };
      expect(() => validateProductionConfig(cfgMissing, 'production')).toThrow(ConfigurationError);

      const cfgShort = { ...baseValidConfig, encryptionKey: 'short-key' };
      expect(() => validateProductionConfig(cfgShort, 'production')).toThrow(ConfigurationError);
    });

    it('rejects missing WHATSAPP_APP_SECRET in production', () => {
      const cfg = { ...baseValidConfig, whatsappAppSecret: '' };
      expect(() => validateProductionConfig(cfg, 'production')).toThrow(ConfigurationError);
    });

    it('rejects missing WHATSAPP_WEBHOOK_VERIFY_TOKEN in production', () => {
      const cfg = { ...baseValidConfig, whatsappWebhookVerifyToken: '' };
      expect(() => validateProductionConfig(cfg, 'production')).toThrow(ConfigurationError);
    });

    it('rejects missing Meta Embedded Signup secrets in production', () => {
      const cfg = { ...baseValidConfig, signupStateSecret: '' };
      expect(() => validateProductionConfig(cfg, 'production')).toThrow(ConfigurationError);
    });

    it('rejects when both DEEPSEEK_API_KEY and GOOGLE_API_KEY are missing in production', () => {
      const cfg = { ...baseValidConfig, deepseekApiKey: '', googleApiKey: '' };
      expect(() => validateProductionConfig(cfg, 'production')).toThrow(ConfigurationError);
    });

    it('ignores strict production checks in non-production environments', () => {
      const cfgIncomplete = { ...baseValidConfig, authSecret: '', encryptionKey: '' };
      expect(() => validateProductionConfig(cfgIncomplete, 'development')).not.toThrow();
      expect(() => validateProductionConfig(cfgIncomplete, 'test')).not.toThrow();
    });
  });

  // =========================================================================
  // 2. Production Authentication, Role Boundaries & Tenant Isolation
  // =========================================================================
  describe('2. Production Authentication & Multi-Tenant Boundaries', () => {
    it('returns 401 Unauthorized for unauthenticated requests in production', async () => {
      process.env.NODE_ENV = 'production';
      const deps: any = {
        prisma: {
          $queryRawUnsafe: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
          $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
          tenant: { findUnique: vi.fn().mockResolvedValue({ id: 'tenant-a' }) }
        },
        tenantConfigService: { getConfig: vi.fn().mockResolvedValue({}) }
      };

      const router = createDevChatRouter(deps);
      const app = express();
      app.use(express.json());
      app.use('/api/v1', router);

      const res = await request(app).get('/api/v1/config');
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('UNAUTHORIZED');
    });

    it('strictly forbids x-tenant-id header bypass in production', async () => {
      process.env.NODE_ENV = 'production';
      const deps: any = {
        prisma: {
          $queryRawUnsafe: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
          tenant: { findUnique: vi.fn().mockResolvedValue({ id: 'tenant-target' }) }
        },
        tenantConfigService: { getConfig: vi.fn().mockResolvedValue({}) }
      };

      const router = createDevChatRouter(deps);
      const app = express();
      app.use(express.json());
      app.use('/api/v1', router);

      const res = await request(app)
        .get('/api/v1/config')
        .set('x-tenant-id', 'tenant-target');

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('UNAUTHORIZED');
    });

    it('rejects forged or tampered Bearer tokens', async () => {
      process.env.NODE_ENV = 'production';
      const deps: any = {
        prisma: {
          tenant: { findUnique: vi.fn().mockResolvedValue({ id: 'tenant-a' }) }
        }
      };

      const router = createDevChatRouter(deps);
      const app = express();
      app.use(express.json());
      app.use('/api/v1', router);

      // Create token with different secret
      const forgedToken = createSignedToken({ tenantId: 'tenant-a', role: 'admin' }, 'different-secret-key-32-chars-long!');

      const res = await request(app)
        .get('/api/v1/config')
        .set('Authorization', `Bearer ${forgedToken}`);

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('UNAUTHORIZED');
    });

    it('prevents cross-tenant IDOR: tenant-a token cannot access tenant-b', async () => {
      process.env.NODE_ENV = 'production';
      const deps: any = {
        prisma: {
          tenant: { findUnique: vi.fn().mockResolvedValue({ id: 'tenant-a' }) }
        },
        tenantConfigService: { getConfig: vi.fn().mockResolvedValue({}) }
      };

      const router = createDevChatRouter(deps);
      const app = express();
      app.use(express.json());
      app.use('/api/v1', router);

      const tokenA = createSignedToken({ tenantId: 'tenant-a', role: 'admin' });

      // Attempt to access tenant-b with tenant-a token
      const res = await request(app)
        .get('/api/v1/config')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('x-tenant-id', 'tenant-b');

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('FORBIDDEN');
      expect(res.body.message).toContain('Tenant authorization mismatch');
    });

    it('restricts customer credentials strictly to chat endpoint', async () => {
      process.env.NODE_ENV = 'production';
      const deps: any = {
        prisma: {
          tenant: { findUnique: vi.fn().mockResolvedValue({ id: 'tenant-a' }) }
        },
        tenantConfigService: { getConfig: vi.fn().mockResolvedValue({}) }
      };

      const router = createDevChatRouter(deps);
      const app = express();
      app.use(express.json());
      app.use('/api/v1', router);

      const customerToken = createSignedToken({ tenantId: 'tenant-a', customerId: 'cust-123' });

      // Attempt to access business config with customer token
      const res = await request(app)
        .get('/api/v1/config')
        .set('Authorization', `Bearer ${customerToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('FORBIDDEN');
      expect(res.body.message).toContain('Customer credentials are restricted to the chat endpoint');
    });

    it('reserves /tenants exclusively for platform admin', async () => {
      process.env.NODE_ENV = 'production';
      const findMany = vi.fn().mockResolvedValue([{ id: 'tenant-a', name: 'Tenant A' }]);
      const deps: any = {
        prisma: {
          tenant: { findMany }
        }
      };

      const router = createDevChatRouter(deps);
      const app = express();
      app.use(express.json());
      app.use('/api/v1', router);

      // Merchant admin token attempt -> 403
      const merchantToken = createSignedToken({ tenantId: 'tenant-a', role: 'admin' });
      const denied = await request(app)
        .get('/api/v1/tenants')
        .set('Authorization', `Bearer ${merchantToken}`);

      expect(denied.status).toBe(403);
      expect(denied.body.error).toBe('FORBIDDEN');

      // Platform admin API key -> 200
      const allowed = await request(app)
        .get('/api/v1/tenants')
        .set('x-api-key', platformKey);

      expect(allowed.status).toBe(200);
      expect(findMany).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 3. Production Route Lockdown
  // =========================================================================
  describe('3. Production Route Lockdown', () => {
    it('unmounts /bootstrap in production', async () => {
      process.env.NODE_ENV = 'production';
      const deps: any = {
        prisma: {
          $queryRawUnsafe: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
          $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
          tenant: { findUnique: vi.fn().mockResolvedValue({ id: 'tenant-a' }) }
        }
      };

      const app = await createApp(deps);
      const token = createSignedToken({ tenantId: 'tenant-a', role: 'admin' });

      const res = await request(app)
        .post('/api/v1/bootstrap')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'New Tenant' });

      expect(res.status).toBe(404);
    });

    it('unmounts /pilot-harness/chat in production', async () => {
      process.env.NODE_ENV = 'production';
      const deps: any = {
        prisma: {
          $queryRawUnsafe: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
          $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
          tenant: { findUnique: vi.fn().mockResolvedValue({ id: 'pilot-auto-repair' }) }
        }
      };

      const app = await createApp(deps);
      const token = createSignedToken({ tenantId: 'pilot-auto-repair', role: 'admin' });

      const res = await request(app)
        .post('/api/v1/pilot-harness/chat')
        .set('Authorization', `Bearer ${token}`)
        .send({ text: 'test' });

      expect(res.status).toBe(404);
    });

    it('unmounts /reset in production', async () => {
      process.env.NODE_ENV = 'production';
      const deps: any = {
        prisma: {
          $queryRawUnsafe: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
          $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
          tenant: { findUnique: vi.fn().mockResolvedValue({ id: 'tenant-a' }) }
        }
      };

      const app = await createApp(deps);
      const token = createSignedToken({ tenantId: 'tenant-a', role: 'admin' });

      const res = await request(app)
        .post('/api/v1/reset')
        .set('Authorization', `Bearer ${token}`)
        .send({ customerId: 'cust-1' });

      expect(res.status).toBe(404);
    });

    it('completely disables /api/dev/* in production', async () => {
      process.env.NODE_ENV = 'production';
      const deps: any = {
        prisma: {
          $queryRawUnsafe: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
          $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }])
        }
      };

      const app = await createApp(deps);
      const res = await request(app).get('/api/dev/health');

      expect(res.status).toBe(404);
    });
  });

  // =========================================================================
  // 4. Security Headers & Information Disclosure
  // =========================================================================
  describe('4. Security Headers & Information Disclosure Prevention', () => {
    it('sets nosniff and suppresses X-Powered-By header', async () => {
      process.env.NODE_ENV = 'production';
      const deps: any = {
        prisma: {
          $queryRawUnsafe: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
          $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }])
        }
      };

      const app = await createApp(deps);
      const res = await request(app).get('/health');

      expect(res.status).toBe(200);
      expect(res.headers['x-powered-by']).toBeUndefined();
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });

    it('sanitizes health check database errors without leaking credentials', async () => {
      process.env.NODE_ENV = 'production';
      const deps: any = {
        prisma: {
          $queryRawUnsafe: vi.fn().mockRejectedValue(new Error('FATAL: password authentication failed for user "prod_db_user"'))
        }
      };

      const app = await createApp(deps);
      const res = await request(app).get('/health');

      expect(res.status).toBe(503);
      expect(res.body.status).toBe('unhealthy');
      expect(res.body.error).toBe('DATABASE_UNAVAILABLE');
    });
  });
});
