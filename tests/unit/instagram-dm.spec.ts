import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { SecretBox } from '../../src/core/security/SecretBox';
import { extractInstagramTextEvents, instagramCustomerId, instagramMessageId, InstagramService, verifyInstagramSignature } from '../../src/domain/channel/instagram/InstagramService';

describe('Instagram DM boundary', () => {
  it('accepts only inbound text DMs and ignores echoes and other event types', () => {
    const events = extractInstagramTextEvents({ object: 'instagram', entry: [{ id: '1234567890', messaging: [
      { sender: { id: '2222222222' }, message: { mid: 'mid-1', text: ' Salam ' } },
      { sender: { id: '2222222222' }, message: { mid: 'mid-2', text: 'Echo', is_echo: true } },
      { sender: { id: '2222222222' }, message: { mid: 'mid-3', attachments: [] } },
      { sender: { id: '1234567890' }, message: { mid: 'mid-4', text: 'Own message' } }
    ] }] });
    expect(events).toEqual([{ igUserId: '1234567890', senderId: '2222222222', mid: 'mid-1', text: 'Salam' }]);
    expect(extractInstagramTextEvents({ object: 'page', entry: [{ id: '1234567890', messaging: [] }] })).toEqual([]);
  });

  it('namespaces customers and message IDs by destination account', () => {
    expect(instagramCustomerId('1234567890', '2222222222')).not.toBe(instagramCustomerId('9999999999', '2222222222'));
    expect(instagramMessageId('1234567890', 'mid-1')).not.toBe(instagramMessageId('9999999999', 'mid-1'));
    expect(instagramCustomerId('1234567890', '2222222222')).not.toBe('2222222222');
  });

  it('requires a valid Meta signature over the original body', () => {
    const body = Buffer.from('{"object":"instagram","entry":[]}');
    const signature = 'sha256=' + createHmac('sha256', 'secret').update(body).digest('hex');
    expect(verifyInstagramSignature(body, signature, 'secret')).toBe(true);
    expect(verifyInstagramSignature(Buffer.from('{}'), signature, 'secret')).toBe(false);
    expect(verifyInstagramSignature(body, 'sha256=bad', 'secret')).toBe(false);
  });

  it('queues a DM only for the owning active client', async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 1 });
    const db = {
      instagramConnection: { findUnique: vi.fn().mockResolvedValue({ instagramUserId: '1234567890', accountId: 'account-a', tenantId: 'tenant-a', enabled: true, status: 'CONNECTED' }) },
      portalProfile: { findUnique: vi.fn().mockResolvedValue({ accountId: 'account-a', tenantId: 'tenant-a', status: 'ACTIVE', instagramAllowed: true, planSnapshot: { modules: ['instagram'] } }) },
      instagramInboundJob: { createMany }
    };
    const service = new InstagramService(db as any, undefined, { box: new SecretBox({ key: 'test-secret' }) });
    const payload = { object: 'instagram', entry: [{ id: '1234567890', messaging: [{ sender: { id: '2222222222' }, message: { mid: 'mid-1', text: 'Hi' } }] }] };
    expect(await service.ingest(payload)).toBe(1);
    expect(createMany).toHaveBeenCalledWith({ data: [{ tenantId: 'tenant-a', accountId: 'account-a', instagramUserId: '1234567890', senderId: '2222222222', messageId: 'mid-1', text: 'Hi' }], skipDuplicates: true });
    db.portalProfile.findUnique.mockResolvedValue({ accountId: 'account-a', tenantId: 'tenant-a', status: 'ACTIVE', instagramAllowed: false, planSnapshot: { modules: ['instagram'] } });
    expect(await service.ingest(payload)).toBe(0);
    db.portalProfile.findUnique.mockResolvedValue({ accountId: 'account-a', tenantId: 'tenant-a', status: 'ACTIVE', instagramAllowed: true, planSnapshot: { modules: ['knowledge'] } });
    expect(await service.ingest(payload)).toBe(0);
    db.portalProfile.findUnique.mockResolvedValue({ accountId: 'account-a', tenantId: 'tenant-a', status: 'SUSPENDED', instagramAllowed: true, planSnapshot: { modules: ['instagram'] } });
    expect(await service.ingest(payload)).toBe(0);
    expect(createMany).toHaveBeenCalledTimes(1);
  });

  it('binds Instagram authorization to the initiating client and rejects altered state', () => {
    const previous = { id: process.env.INSTAGRAM_APP_ID, secret: process.env.INSTAGRAM_APP_SECRET,
      verify: process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN, url: process.env.PORTAL_PUBLIC_URL };
    process.env.INSTAGRAM_APP_ID = '1234567890';
    process.env.INSTAGRAM_APP_SECRET = 'test-instagram-app-secret';
    process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN = 'test-verify-token';
    process.env.PORTAL_PUBLIC_URL = 'https://app.relayqo.online';
    try {
      const service = new InstagramService({} as any, undefined, { box: new SecretBox({ key: 'test-secret' }) });
      const url = new URL(service.authorizationUrl({ userId: 'user-a', accountId: 'account-a', tenantId: 'tenant-a' }));
      expect(url.searchParams.get('scope')).toBe('instagram_business_basic,instagram_business_manage_messages');
      expect(service.verifyState(url.searchParams.get('state')!)).toMatchObject({ userId: 'user-a', accountId: 'account-a', tenantId: 'tenant-a' });
      const state = url.searchParams.get('state')!;
      expect(() => service.verifyState(state.slice(0, -10) + 'aaaaaaaaaa')).toThrow('INVALID_INSTAGRAM_STATE');
    } finally {
      for (const [key, value] of Object.entries({ INSTAGRAM_APP_ID: previous.id, INSTAGRAM_APP_SECRET: previous.secret,
        INSTAGRAM_WEBHOOK_VERIFY_TOKEN: previous.verify, PORTAL_PUBLIC_URL: previous.url })) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
  });
});
