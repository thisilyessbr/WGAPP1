import { afterEach, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { createSignedToken } from '../../src/dev/chatApi';
import { LLMFactory } from '../../src/core/llm/LLMFactory';

afterEach(() => vi.unstubAllEnvs());

it('customer-scoped user cannot change the tenant-wide bot configuration', async () => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('AUTH_SECRET', 'reaudit-only-secret-at-least-32-characters');
  const updateConfig = vi.fn().mockResolvedValue(undefined);
  const app = await createApp({
    prisma: {
      tenant: { findUnique: vi.fn().mockResolvedValue({ id: 'tenant-a' }) },
      tenantConfig: { findUnique: vi.fn().mockResolvedValue(null) }
    },
    tenantConfigService: { updateConfig },
    whatsAppNumberService: {}, clientSafetyGuard: {}
  } as any);
  const token = createSignedToken({ tenantId: 'tenant-a', customerId: 'customer-a', role: 'user' });
  const response = await request(app).post('/api/v1/config')
    .set('Authorization', `Bearer ${token}`)
    .send({ config: { identity: {}, behavior: {}, prompts: { system: 'changed by customer' } } });
  expect(response.status).toBe(403);
  expect(response.body.error).toBe('FORBIDDEN');
  expect(updateConfig).not.toHaveBeenCalled();
});

it('non-admin tenant user cannot perform state-changing tenant operations', async () => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('AUTH_SECRET', 'reaudit-only-secret-at-least-32-characters');
  const updateConfig = vi.fn().mockResolvedValue(undefined);
  const app = await createApp({
    prisma: {
      tenant: { findUnique: vi.fn().mockResolvedValue({ id: 'tenant-a' }) },
      tenantConfig: { findUnique: vi.fn().mockResolvedValue(null) }
    },
    tenantConfigService: { updateConfig }
  } as any);
  const token = createSignedToken({ tenantId: 'tenant-a', role: 'user' });
  const response = await request(app).post('/api/v1/config')
    .set('Authorization', `Bearer ${token}`)
    .send({ config: { identity: {}, behavior: {}, prompts: {} } });
  expect(response.status).toBe(403);
  expect(updateConfig).not.toHaveBeenCalled();
});

it('production without a DeepSeek key fails clearly instead of selecting a mock', () => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('VITEST', '');
  vi.stubEnv('DEEPSEEK_API_KEY', '');
  expect(() => new LLMFactory().getProvider({ provider: 'deepseek' } as any))
    .toThrow('DEEPSEEK_API_KEY is not configured');
});
