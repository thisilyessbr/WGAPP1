import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { PortalAuth, hashPassword } from '../../src/portal/PortalAuth';
import { PortalStore } from '../../src/portal/PortalStore';

const password = 'Temporary-admin-test-password!';
let passwordHash: string;
const originalMail = {
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  PORTAL_MAIL_WEBHOOK_URL: process.env.PORTAL_MAIL_WEBHOOK_URL,
  PORTAL_MAIL_WEBHOOK_SECRET: process.env.PORTAL_MAIL_WEBHOOK_SECRET
};

beforeAll(async () => { passwordHash = await hashPassword(password); });
afterEach(() => {
  vi.restoreAllMocks();
  for (const [key, value] of Object.entries(originalMail)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('temporary administrator email bypass', () => {
  function setup(address = 'admin@admin123.com') {
    delete process.env.RESEND_API_KEY;
    delete process.env.PORTAL_MAIL_WEBHOOK_URL;
    delete process.env.PORTAL_MAIL_WEBHOOK_SECRET;
    const user = { id: 'admin-id', email: address, role: 'ADMIN', verifiedAt: new Date(), disabled: false, passwordHash };
    const store = {
      throttle: vi.fn(), userByEmail: vi.fn().mockResolvedValue(user), newSession: vi.fn(), audit: vi.fn()
    } as unknown as PortalStore;
    const auth = new PortalAuth(store, { publicUrl: 'https://app.relayqo.online' });
    const res = { cookie: vi.fn() } as any;
    return { auth, res, store };
  }

  it('lets only the existing verified admin log in with the correct password while mail is unavailable', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-25T12:00:00Z'));
    const { auth, res, store } = setup();
    await expect(auth.login({ email: 'admin@admin123.com', password: 'wrong-password' }, '127.0.0.1', res))
      .rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(res.cookie).not.toHaveBeenCalled();
    const result = await auth.login({ email: 'admin@admin123.com', password }, '127.0.0.1', res);
    expect(result).toMatchObject({ redirect: '/admin' });
    expect(result).not.toHaveProperty('requiresEmailConfirmation');
    expect(res.cookie).toHaveBeenCalledOnce();
    expect(store.newSession).toHaveBeenCalledOnce();
  });

  it('does not bypass another administrator or remain active after the deadline', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-25T12:00:00Z'));
    const other = setup('other-admin@example.com');
    await expect(other.auth.login({ email: 'other-admin@example.com', password }, '127.0.0.1', other.res))
      .rejects.toMatchObject({ code: 'EMAIL_SETUP_REQUIRED' });
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-02T00:00:00Z'));
    const expired = setup();
    await expect(expired.auth.login({ email: 'admin@admin123.com', password }, '127.0.0.1', expired.res))
      .rejects.toMatchObject({ code: 'EMAIL_SETUP_REQUIRED' });
    expect(expired.res.cookie).not.toHaveBeenCalled();
  });
});
