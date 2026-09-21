import { afterEach, describe, expect, it, vi } from 'vitest';
import { PortalAuth } from '../../src/portal/PortalAuth';
import { PortalStore } from '../../src/portal/PortalStore';

const original = {
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  PORTAL_MAIL_FROM: process.env.PORTAL_MAIL_FROM,
  PORTAL_MAIL_WEBHOOK_URL: process.env.PORTAL_MAIL_WEBHOOK_URL,
  PORTAL_MAIL_WEBHOOK_SECRET: process.env.PORTAL_MAIL_WEBHOOK_SECRET
};

afterEach(() => {
  vi.unstubAllGlobals();
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('portal Resend email delivery', () => {
  it('sends secure account links through Resend when configured', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    process.env.PORTAL_MAIL_FROM = 'Relayqo <auth@relayqo.online>';
    delete process.env.PORTAL_MAIL_WEBHOOK_URL;
    delete process.env.PORTAL_MAIL_WEBHOOK_SECRET;
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const auth = new PortalAuth({} as PortalStore, { publicUrl: 'https://app.relayqo.online' });

    await auth.deliver('owner@example.com', 'VERIFY', 'https://app.relayqo.online/verify-email#token=safe');

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(request.headers.Authorization).toBe('Bearer re_test_key');
    expect(request.headers['Idempotency-Key']).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.parse(request.body)).toMatchObject({
      from: 'Relayqo <auth@relayqo.online>',
      to: ['owner@example.com'],
      subject: 'Verify your Relayqo account'
    });
  });

  it('reports a temporary delivery failure without exposing provider details', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    process.env.PORTAL_MAIL_FROM = 'Relayqo <auth@relayqo.online>';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('provider secret detail', { status: 429 })));
    const auth = new PortalAuth({} as PortalStore, { publicUrl: 'https://app.relayqo.online' });

    await expect(auth.deliver('owner@example.com', 'RESET', 'https://app.relayqo.online/reset-password#token=safe'))
      .rejects.toMatchObject({ code: 'EMAIL_DELIVERY_FAILED', status: 503 });
  });
});
