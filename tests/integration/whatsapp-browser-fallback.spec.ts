import { describe, expect, it } from 'vitest';
import { chromium } from 'playwright';
import express from 'express';
import { resolve } from 'path';

describe('WhatsApp signup browser fallback', () => {
  it('lets a client select a Meta-granted number when no signup event arrives', async () => {
    const app = express(); app.use(express.json());
    let connected = false; let completion: any;
    app.get('/api/auth/session', (_req, res) => res.json({ user: { id: 'user-a', name: 'Client A', role: 'CLIENT' }, csrf: 'test' }));
    app.get('/api/client/profile', (_req, res) => res.json({ profile: { plan: { modules: [] } } }));
    app.get('/api/client/whatsapp', (_req, res) => res.json({ connections: connected
      ? [{ id: 'connection-2', provider: 'META_CLOUD', displayPhoneNumber: '+212 600000002', numberStatus: 'CONNECTED' }]
      : [], canAddNumber: !connected, qrEnabled: false, metaConfigured: true }));
    app.post('/api/client/whatsapp/start', (_req, res) => res.json({
      attemptId: 'attempt-a', stateToken: 'state-a', appId: 'meta-app', configId: 'meta-config', graphApiVersion: 'v26.0'
    }));
    app.post('/api/client/whatsapp/discover', (req, res) => {
      expect(req.body).toMatchObject({ attemptId: 'attempt-a', stateToken: 'state-a', code: 'meta-code' });
      res.json({ candidates: [
        { wabaId: 'waba-1', phoneNumberId: 'phone-1', displayPhoneNumber: '+212 600000001' },
        { wabaId: 'waba-2', phoneNumberId: 'phone-2', displayPhoneNumber: '+212 600000002' }
      ] });
    });
    app.post('/api/client/whatsapp/complete', (req, res) => { completion = req.body; connected = true; res.json({ success: true }); });
    app.use('/portal-assets', express.static(resolve('src/portal/ui')));
    app.use((_req, res) => res.type('html').send('<div id="root"></div><div id="toast"></div><script src="/portal-assets/portal.js"></script>'));
    const server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server.once('listening', r));
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.addInitScript(() => { (window as any).FB = { init() {}, login(callback: any, options: any) {
        (window as any).metaOptions = options; callback({ authResponse: { code: 'meta-code' } });
      } }; });
      await page.goto(`http://127.0.0.1:${(server.address() as any).port}/app/whatsapp`);
      await page.getByRole('button', { name: 'Connect with Meta' }).click();
      await page.getByRole('button', { name: 'Continue to WhatsApp' }).click();
      await page.getByLabel('Choose the WhatsApp number to connect').waitFor({ timeout: 18000 });
      await page.getByLabel('Choose the WhatsApp number to connect').selectOption('1');
      await page.getByRole('button', { name: 'Connect selected number' }).click();
      await page.getByText('+212 600000002').waitFor();
      expect(completion).toMatchObject({ attemptId: 'attempt-a', stateToken: 'state-a', wabaId: 'waba-2', phoneNumberId: 'phone-2' });
      expect(completion.code).toBeUndefined();
      expect(await page.evaluate(() => (window as any).metaOptions.extras.sessionInfoVersion)).toBe('3');
    } finally { await browser.close(); await new Promise<void>(r => server.close(() => r())); }
  }, 30000);
});
