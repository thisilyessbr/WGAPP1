import { describe, expect, it, vi } from 'vitest';
import { WhatsAppOnboardingService } from '../../src/domain/channel/whatsapp/WhatsAppOnboardingService';
import { SecretBox } from '../../src/core/security/SecretBox';

describe('Meta code-only WhatsApp signup', () => {
  const secretBox = new SecretBox({ key: 'test-encryption-key-32-bytes-long!' });
  const response = (data: unknown) => ({ ok: true, json: async () => data }) as Response;

  it('discovers numbers from the granted WABA and completes without a browser signup event', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes('/oauth/access_token')) return response({ access_token: 'private-meta-token' });
      if (url.includes('/debug_token')) return response({ data: { is_valid: true, app_id: 'meta-app', granular_scopes: [
        { scope: 'whatsapp_business_management', target_ids: ['waba-1'] }
      ] } });
      if (url.includes('/phone_numbers')) return response({ data: [{ id: 'phone-1', display_phone_number: '+212 600000001' }] });
      return response({ success: true });
    });
    const prisma = { account: { findUnique: vi.fn(async () => ({ tenantId: 'tenant-1' })) },
      whatsAppBusinessNumber: { findUnique: vi.fn(async () => null) } };
    const numbers = { createOrUpdateConnection: vi.fn(async () => ({ id: 'connection-1' })),
      registerNumber: vi.fn(async () => ({})) };
    const service = new WhatsAppOnboardingService(prisma as any, numbers as any, {
      appId: 'meta-app', appSecret: 'meta-secret', secretBox, fetchFn: fetchFn as any
    });
    const prepared = await service.prepareSignup('one-time-code');
    expect(prepared.candidates).toEqual([{ wabaId: 'waba-1', phoneNumberId: 'phone-1', displayPhoneNumber: '+212 600000001' }]);
    expect(prepared.encryptedToken).not.toContain('private-meta-token');
    const result = await service.processEmbeddedSignupCallback({
      tenantId: 'tenant-1', accountId: 'account-1', encryptedMetaToken: prepared.encryptedToken,
      wabaId: 'waba-1', phoneNumberId: 'phone-1', stateToken: service.generateSignupState('tenant-1', 'account-1')
    });
    expect(result.success).toBe(true);
    expect(numbers.createOrUpdateConnection).toHaveBeenCalledWith(expect.objectContaining({
      accountId: 'account-1', connectionKey: 'phone-1', status: 'CONNECTED'
    }));
    expect(numbers.registerNumber).toHaveBeenCalledWith(expect.objectContaining({
      accountId: 'account-1', phoneNumberId: 'phone-1', displayPhoneNumber: '+212 600000001'
    }));
    expect(fetchFn.mock.calls.filter(([url]) => url.includes('/oauth/access_token'))).toHaveLength(1);
  });

  it('rejects a phone number absent from Meta before changing a connection', async () => {
    const fetchFn = vi.fn(async (url: string) => url.includes('/oauth/access_token')
      ? response({ access_token: 'private-meta-token' })
      : response({ data: [{ id: 'different-phone' }] }));
    const prisma = { account: { findUnique: vi.fn(async () => ({ tenantId: 'tenant-1' })) },
      whatsAppBusinessNumber: { findUnique: vi.fn(async () => null) } };
    const numbers = { createOrUpdateConnection: vi.fn(), registerNumber: vi.fn() };
    const service = new WhatsAppOnboardingService(prisma as any, numbers as any, {
      appId: 'meta-app', appSecret: 'meta-secret', secretBox, fetchFn: fetchFn as any
    });
    const result = await service.processEmbeddedSignupCallback({ tenantId: 'tenant-1', accountId: 'account-1',
      code: 'one-time-code', wabaId: 'waba-1', phoneNumberId: 'phone-wrong',
      stateToken: service.generateSignupState('tenant-1', 'account-1') });
    expect(result.success).toBe(false);
    expect(numbers.createOrUpdateConnection).not.toHaveBeenCalled();
    expect(fetchFn.mock.calls.some(([url]) => url.includes('/subscribed_apps'))).toBe(false);
  });
});
