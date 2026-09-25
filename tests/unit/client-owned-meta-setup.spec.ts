import { describe, it, expect } from 'vitest';
import { SecretBox } from '../../src/core/security/SecretBox';
import { ClientOwnedMetaService } from '../../src/domain/channel/whatsapp/ClientOwnedMetaService';

const input = {
  appId: '123456789', appSecret: 'client-app-secret', wabaId: '987654321',
  phoneNumberId: '555555555', accessToken: 'client-token'
};

function fixture(options: { tokenAppId?: string; wabaPhoneId?: string; existingOwner?: string } = {}) {
  const saved: any = { connection: null, number: options.existingOwner ? { accountId: options.existingOwner } : null };
  const db: any = {
    account: { findUnique: async () => ({ id: 'client-1', tenantId: 'tenant-1' }) },
    whatsAppBusinessNumber: {
      findUnique: async () => saved.number,
      create: async ({ data }: any) => { saved.number = data; return data; },
      update: async ({ data }: any) => { saved.number = { ...saved.number, ...data }; return saved.number; }
    },
    channelConnection: {
      findFirst: async () => saved.connection,
      findMany: async () => saved.connection ? [saved.connection] : [],
      findUnique: async () => saved.connection,
      upsert: async ({ create, update }: any) => {
        saved.connection = saved.connection ? { ...saved.connection, ...update } : { ...create, id: '11111111-1111-4111-8111-111111111111' };
        return saved.connection;
      }
    }
  };
  const calls: string[] = [];
  const fetchFn: any = async (url: string, init: any) => {
    calls.push(url);
    expect(init.headers.Authorization).not.toContain('undefined');
    return { ok: true, json: async () => url.includes('/debug_token')
      ? { data: { is_valid: true, app_id: options.tokenAppId || input.appId,
        scopes: ['whatsapp_business_management', 'whatsapp_business_messaging'] } }
      : { data: [{ id: options.wabaPhoneId || input.phoneNumberId, display_phone_number: '+212 600000000' }] } };
  };
  const service = new ClientOwnedMetaService(db, { secretBox: new SecretBox({ key: 'unit-test-key' }), fetchFn });
  return { service, saved, calls };
}

describe('client-owned Meta setup', () => {
  it('validates the app and WABA phone before storing encrypted credentials', async () => {
    const { service, saved, calls } = fixture();
    const result = await service.prepare('client-1', input);
    expect(calls).toHaveLength(2);
    expect(result.status).toBe('PENDING');
    expect(result.callbackUrl).toContain('/api/webhook/whatsapp/client/');
    expect(saved.number.enabled).toBe(false);
    expect(saved.connection.enabled).toBe(false);
    expect(saved.connection.encryptedCredentials).not.toContain(input.accessToken);
    expect(saved.connection.encryptedCredentials).not.toContain(input.appSecret);
  });

  it('rejects a token from a different Meta app before creating a mapping', async () => {
    const { service, saved } = fixture({ tokenAppId: '999999999' });
    await expect(service.prepare('client-1', input)).rejects.toThrow('META_TOKEN_APP_OR_PERMISSIONS_INVALID');
    expect(saved.connection).toBeNull();
  });

  it('rejects a phone not owned by the supplied WABA', async () => {
    const { service, saved } = fixture({ wabaPhoneId: '777777777' });
    await expect(service.prepare('client-1', input)).rejects.toThrow('NUMBER_NOT_IN_WABA');
    expect(saved.connection).toBeNull();
  });

  it('does not move a phone number owned by another Relayqo client', async () => {
    const { service, calls } = fixture({ existingOwner: 'client-2' });
    await expect(service.prepare('client-1', input)).rejects.toThrow('NUMBER_ALREADY_ASSIGNED');
    expect(calls).toHaveLength(0);
  });
});
