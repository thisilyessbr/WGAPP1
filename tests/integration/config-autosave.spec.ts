import { describe, it, expect, beforeEach, beforeAll, afterEach } from 'vitest';
import { prisma, pool } from '../../src/tests/testDb';
import { bootstrapChatbot } from '../../src/bootstrap';
import { DEFAULT_BUSINESS_CONFIG, BusinessConfig } from '../../src/domain/tenant/BusinessConfig';
import { createDevChatRouter } from '../../src/dev/chatApi';
import express from 'express';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { JSDOM } from 'jsdom';

describe('Phase 20: Config Autosave & Navigation Protection Integration Tests', () => {
  let deps: ReturnType<typeof bootstrapChatbot>;
  let app: express.Application;
  const createdTenantIds: string[] = [];
  const htmlPath = path.resolve(__dirname, '../../src/dev/ui/index.html');
  let htmlContent: string;

  beforeAll(async () => {
    const client = await pool.connect();
    try {
      await client.query('SET search_path TO test, public, extensions;');
    } finally {
      client.release();
    }
    htmlContent = fs.readFileSync(htmlPath, 'utf8');
  });

  beforeEach(async () => {
    deps = bootstrapChatbot(prisma);
    deps.tenantConfigService.clearCache();

    app = express();
    app.use(express.json());
    app.use('/api/dev', createDevChatRouter(deps));
  });

  afterEach(async () => {
    for (const tenantId of createdTenantIds) {
      try {
        await prisma.tenantConfig.deleteMany({ where: { tenantId } });
        await prisma.account.deleteMany({ where: { tenantId } });
        await prisma.tenant.deleteMany({ where: { id: tenantId } });
      } catch (err) {}
    }
    createdTenantIds.length = 0;
  });

  async function createTestTenant(name: string, customConfig?: Partial<BusinessConfig>) {
    const tenantId = `tenant-autosave-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    createdTenantIds.push(tenantId);

    await prisma.tenant.create({
      data: { id: tenantId, name }
    });

    const initialConfig: BusinessConfig = {
      ...JSON.parse(JSON.stringify(DEFAULT_BUSINESS_CONFIG)),
      ...customConfig,
      identity: {
        ...DEFAULT_BUSINESS_CONFIG.identity,
        ...(customConfig?.identity || {}),
        botName: customConfig?.identity?.botName || `${name} Bot`
      }
    };

    await deps.tenantConfigService.updateConfig(tenantId, initialConfig);
    return { tenantId, initialConfig };
  }

  function setupVirtualDom(tenantId: string, customFetchOverride?: any) {
    const dom = new JSDOM(htmlContent, {
      runScripts: 'dangerously',
      url: `http://localhost:3000/?tenantId=${tenantId}`
    });

    const window = dom.window as any;
    const document = window.document;

    window.alert = () => {};
    window.confirm = () => true;

    const defaultFetch = async (url: string, init?: any) => {
      const method = (init?.method || 'GET').toLowerCase() as 'get' | 'post' | 'put' | 'delete';
      const headers = init?.headers || {};
      let req = (request(app) as any)[method](url);

      for (const [k, v] of Object.entries(headers)) {
        req = req.set(k, v as string);
      }

      if (init?.body) {
        if (typeof init.body === 'string') {
          req = req.set('Content-Type', 'application/json').send(init.body);
        }
      }

      const res = await req;
      return {
        ok: res.status >= 200 && res.status < 300,
        status: res.status,
        headers: {
          get: (h: string) => res.headers[h.toLowerCase()] || null
        },
        json: async () => res.body,
        text: async () => res.text
      };
    };

    window.fetch = customFetchOverride || defaultFetch;

    return { dom, window, document };
  }

  async function waitForSaveToComplete(window: any, maxWaitMs = 3500) {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      if (!window.isDirty && !window.isSaving && window.saveStatus === 'saved') {
        return;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  async function waitForStatus(window: any, targetStatuses: string[], maxWaitMs = 3500) {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      if (!window.isSaving && targetStatuses.includes(window.saveStatus)) {
        return;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  it('1. Single field change -> exactly one autosave after debounce', async () => {
    const { tenantId } = await createTestTenant('Single Change');
    const { window, document } = setupVirtualDom(tenantId);

    await window.loadConfig();
    expect(window.isDirty).toBe(false);
    expect(window.saveStatus).toBe('saved');

    // Change Bot Name
    const botNameInput = document.getElementById('v_botName') as HTMLInputElement;
    botNameInput.value = 'Autonomous Anime Bot';
    botNameInput.dispatchEvent(new window.Event('input'));

    expect(window.isDirty).toBe(true);
    expect(window.saveStatus).toBe('dirty');

    // Wait for debounced autosave to complete
    await waitForSaveToComplete(window);

    expect(window.isDirty).toBe(false);
    expect(window.saveStatus).toBe('saved');

    // Verify DB
    const savedConfig = await deps.tenantConfigService.getConfig(tenantId);
    expect(savedConfig.identity.botName).toBe('Autonomous Anime Bot');
  });

  it('2. Rapid typing -> exactly one debounced save after typing stops', async () => {
    const { tenantId } = await createTestTenant('Rapid Typing');
    let saveCount = 0;

    const countingFetch = async (url: string, init?: any) => {
      if (url.includes('/config') && init?.method === 'POST') {
        saveCount++;
      }
      const method = (init?.method || 'GET').toLowerCase() as 'get' | 'post';
      let req = (request(app) as any)[method](url);
      if (init?.headers) {
        for (const [k, v] of Object.entries(init.headers)) req = req.set(k, v as string);
      }
      if (init?.body) req = req.set('Content-Type', 'application/json').send(init.body);
      const res = await req;
      return {
        ok: res.status >= 200 && res.status < 300,
        status: res.status,
        headers: { get: (h: string) => res.headers[h.toLowerCase()] || null },
        json: async () => res.body,
        text: async () => res.text
      };
    };

    const { window, document } = setupVirtualDom(tenantId, countingFetch);
    await window.loadConfig();

    const botNameInput = document.getElementById('v_botName') as HTMLInputElement;

    // Simulate typing "A" -> "An" -> "Ani" -> "Anim" -> "Anime" with 50ms intervals
    const keystrokes = ['A', 'An', 'Ani', 'Anim', 'Anime'];
    for (const text of keystrokes) {
      botNameInput.value = text;
      botNameInput.dispatchEvent(new window.Event('input'));
      await new Promise((r) => setTimeout(r, 50));
    }

    expect(window.isDirty).toBe(true);
    expect(saveCount).toBe(0); // Debounce prevented premature saves

    await waitForSaveToComplete(window);

    expect(saveCount).toBe(1);
    expect(window.isDirty).toBe(false);
    expect(window.saveStatus).toBe('saved');

    const dbConfig = await deps.tenantConfigService.getConfig(tenantId);
    expect(dbConfig.identity.botName).toBe('Anime');
  });

  it('3. Multiple fields changed quickly -> single unified autosave', async () => {
    const { tenantId } = await createTestTenant('Multi Field');
    let saveCount = 0;

    const countingFetch = async (url: string, init?: any) => {
      if (url.includes('/config') && init?.method === 'POST') saveCount++;
      const method = (init?.method || 'GET').toLowerCase() as 'get' | 'post';
      let req = (request(app) as any)[method](url);
      if (init?.headers) {
        for (const [k, v] of Object.entries(init.headers)) req = req.set(k, v as string);
      }
      if (init?.body) req = req.set('Content-Type', 'application/json').send(init.body);
      const res = await req;
      return {
        ok: res.status >= 200 && res.status < 300,
        status: res.status,
        headers: { get: (h: string) => res.headers[h.toLowerCase()] || null },
        json: async () => res.body,
        text: async () => res.text
      };
    };

    const { window, document } = setupVirtualDom(tenantId, countingFetch);
    await window.loadConfig();

    // Modify multiple distinct fields
    (document.getElementById('v_botName') as HTMLInputElement).value = 'MultiBot';
    document.getElementById('v_botName')!.dispatchEvent(new window.Event('input'));

    (document.getElementById('v_brand') as HTMLInputElement).value = 'Atlas Mega';
    document.getElementById('v_brand')!.dispatchEvent(new window.Event('input'));

    (document.getElementById('v_currency') as HTMLInputElement).value = 'EUR';
    document.getElementById('v_currency')!.dispatchEvent(new window.Event('input'));

    (document.getElementById('v_maxHistory') as HTMLInputElement).value = '45';
    document.getElementById('v_maxHistory')!.dispatchEvent(new window.Event('input'));

    await waitForSaveToComplete(window);

    expect(saveCount).toBe(1);
    expect(window.isDirty).toBe(false);

    const dbConfig = await deps.tenantConfigService.getConfig(tenantId);
    expect(dbConfig.identity.botName).toBe('MultiBot');
    expect(dbConfig.identity.brand).toBe('Atlas Mega');
    expect(dbConfig.identity.currency).toBe('EUR');
    expect(dbConfig.limits.maxConversationHistory).toBe(45);
  });

  it('4. Save indicator transitions correctly through states (saved -> dirty -> saving -> saved)', async () => {
    const { tenantId } = await createTestTenant('Indicator State');
    const { window, document } = setupVirtualDom(tenantId);
    await window.loadConfig();

    const indicator = document.getElementById('saveStatusIndicator')!;
    const statusText = document.getElementById('saveStatusText')!;

    expect(indicator.className).toContain('saved');
    expect(statusText.textContent).toBe('Saved');

    // Trigger edit
    (document.getElementById('v_botName') as HTMLInputElement).value = 'IndicatorBot';
    document.getElementById('v_botName')!.dispatchEvent(new window.Event('input'));

    expect(indicator.className).toContain('dirty');
    expect(statusText.textContent).toBe('Unsaved changes');

    // Wait for save to complete
    await waitForSaveToComplete(window);

    expect(indicator.className).toContain('saved');
    expect(statusText.textContent).toBe('Saved');
  });

  it('5. Save failure keeps dirty state and displays error indicator with Retry button', async () => {
    const { tenantId } = await createTestTenant('Failure Test');

    // Mock fetch that rejects POST /config with 500
    const failingFetch = async (url: string, init?: any) => {
      if (url.includes('/config') && init?.method === 'POST') {
        return {
          ok: false,
          status: 500,
          headers: { get: () => null },
          json: async () => ({ error: 'Database Disk Full' })
        };
      }
      const method = (init?.method || 'GET').toLowerCase() as 'get' | 'post';
      let req = (request(app) as any)[method](url);
      const res = await req;
      return {
        ok: res.status >= 200 && res.status < 300,
        status: res.status,
        headers: { get: (h: string) => res.headers[h.toLowerCase()] || null },
        json: async () => res.body
      };
    };

    const { window, document } = setupVirtualDom(tenantId, failingFetch);
    await window.loadConfig();

    (document.getElementById('v_botName') as HTMLInputElement).value = 'FailureBot';
    document.getElementById('v_botName')!.dispatchEvent(new window.Event('input'));

    // Wait for debounce and failed save
    await waitForStatus(window, ['failed']);

    expect(window.isDirty).toBe(true);
    expect(window.saveStatus).toBe('failed');
    expect(document.getElementById('saveStatusIndicator')!.className).toContain('failed');
    expect(document.getElementById('retrySaveBtn')!.style.display).toBe('inline-block');
  });

  it('6. Retry succeeds and resolves dirty state', async () => {
    const { tenantId } = await createTestTenant('Retry Test');
    let shouldFail = true;

    const retryFetch = async (url: string, init?: any) => {
      if (url.includes('/config') && init?.method === 'POST' && shouldFail) {
        return {
          ok: false,
          status: 500,
          headers: { get: () => null },
          json: async () => ({ error: 'Temporary Network Blip' })
        };
      }
      const method = (init?.method || 'GET').toLowerCase() as 'get' | 'post';
      let req = (request(app) as any)[method](url);
      if (init?.headers) {
        for (const [k, v] of Object.entries(init.headers)) req = req.set(k, v as string);
      }
      if (init?.body) req = req.set('Content-Type', 'application/json').send(init.body);
      const res = await req;
      return {
        ok: res.status >= 200 && res.status < 300,
        status: res.status,
        headers: { get: (h: string) => res.headers[h.toLowerCase()] || null },
        json: async () => res.body
      };
    };

    const { window, document } = setupVirtualDom(tenantId, retryFetch);
    await window.loadConfig();

    (document.getElementById('v_botName') as HTMLInputElement).value = 'RetryBot';
    document.getElementById('v_botName')!.dispatchEvent(new window.Event('input'));

    await waitForStatus(window, ['failed']);
    expect(window.saveStatus).toBe('failed');

    // Server recovers, user clicks Retry
    shouldFail = false;
    await window.retrySave();

    expect(window.isDirty).toBe(false);
    expect(window.saveStatus).toBe('saved');
    expect(document.getElementById('retrySaveBtn')!.style.display).toBe('none');

    const dbConfig = await deps.tenantConfigService.getConfig(tenantId);
    expect(dbConfig.identity.botName).toBe('RetryBot');
  });

  it('7. 409 STALE_CONFIG is handled safely without silently overwriting server changes', async () => {
    const { tenantId } = await createTestTenant('Stale Guard');
    const { window, document } = setupVirtualDom(tenantId);
    await window.loadConfig();

    // Another client updates config in the background
    await deps.tenantConfigService.updateConfig(tenantId, {
      ...JSON.parse(JSON.stringify(DEFAULT_BUSINESS_CONFIG)),
      identity: { ...DEFAULT_BUSINESS_CONFIG.identity, botName: 'Server Updated Bot' }
    });

    // Local user edits Bot Name without reloading
    (document.getElementById('v_botName') as HTMLInputElement).value = 'Local Conflict Bot';
    document.getElementById('v_botName')!.dispatchEvent(new window.Event('input'));

    await waitForStatus(window, ['stale']);

    expect(window.saveStatus).toBe('stale');
    expect(window.isDirty).toBe(true);
    expect(document.getElementById('saveStatusText')!.textContent).toContain('Server config updated');

    // Server config was NOT corrupted
    const dbConfig = await deps.tenantConfigService.getConfig(tenantId);
    expect(dbConfig.identity.botName).toBe('Server Updated Bot');
  });

  it('8. Race condition protection: newer edits in flight trigger subsequent save', async () => {
    const { tenantId } = await createTestTenant('Race Condition');
    const { window, document } = setupVirtualDom(tenantId);
    await window.loadConfig();

    // Start first edit
    (document.getElementById('v_botName') as HTMLInputElement).value = 'Revision 1';
    document.getElementById('v_botName')!.dispatchEvent(new window.Event('input'));

    // Wait 760ms for first autosave to initiate
    await new Promise((r) => setTimeout(r, 760));

    // While save is in flight or completing, immediately type Revision 2
    (document.getElementById('v_botName') as HTMLInputElement).value = 'Revision 2 Final';
    document.getElementById('v_botName')!.dispatchEvent(new window.Event('input'));

    // Wait for subsequent debounced save to complete
    await waitForSaveToComplete(window, 3000);

    expect(window.isDirty).toBe(false);
    expect(window.saveStatus).toBe('saved');

    const dbConfig = await deps.tenantConfigService.getConfig(tenantId);
    expect(dbConfig.identity.botName).toBe('Revision 2 Final');
  });

  it('9. Tenant switch cannot cross-write configuration to other tenants', async () => {
    const tenantA = await createTestTenant('Tenant Alpha');
    const tenantB = await createTestTenant('Tenant Beta');

    const { window, document } = setupVirtualDom(tenantA.tenantId);
    await window.loadConfig();

    // Edit tenant A config
    (document.getElementById('v_botName') as HTMLInputElement).value = 'Alpha Custom';
    document.getElementById('v_botName')!.dispatchEvent(new window.Event('input'));

    // Switch tenant input to Tenant Beta
    (document.getElementById('tenantId') as HTMLInputElement).value = tenantB.tenantId;
    await window.onTenantChange();

    // Verify Tenant Beta loaded its own config
    expect((document.getElementById('v_botName') as HTMLInputElement).value).toBe('Tenant Beta Bot');

    // Wait to ensure no delayed save leaked to Tenant Beta
    await new Promise((r) => setTimeout(r, 1100));

    const configB = await deps.tenantConfigService.getConfig(tenantB.tenantId);
    expect(configB.identity.botName).toBe('Tenant Beta Bot');
  });

  it('10. Account switch populates correct scoped selectors without cross-writing', async () => {
    const { tenantId } = await createTestTenant('Account Scope Test');
    const accA = await prisma.account.create({
      data: { tenantId, name: 'Store A', enabled: true, config: { ecommerceEnabled: true } }
    });
    const accB = await prisma.account.create({
      data: { tenantId, name: 'Store B', enabled: true, config: { ecommerceEnabled: true } }
    });

    const { window, document } = setupVirtualDom(tenantId);
    await window.loadConfig();
    await window.loadAccounts();

    const ragSelect = document.getElementById('ragAccountSelect') as HTMLSelectElement;
    expect(ragSelect).not.toBeNull();
    expect(ragSelect.innerHTML).toContain(accA.id);
    expect(ragSelect.innerHTML).toContain(accB.id);
  });

  it('11. Raw JSON editing synchronizes to Visual Editor and triggers autosave', async () => {
    const { tenantId } = await createTestTenant('Raw JSON Sync');
    const { window, document } = setupVirtualDom(tenantId);
    await window.loadConfig();

    const rawEditor = document.getElementById('rawJsonEditor') as HTMLTextAreaElement;
    const current = JSON.parse(rawEditor.value);
    current.identity.botName = 'JSON Synced Bot';
    current.identity.brand = 'JSON Brand';
    rawEditor.value = JSON.stringify(current, null, 2);
    rawEditor.dispatchEvent(new window.Event('input'));

    expect(window.isDirty).toBe(true);

    // Switch to visual tab -> syncs
    window.syncJsonToVisual();
    expect((document.getElementById('v_botName') as HTMLInputElement).value).toBe('JSON Synced Bot');
    expect((document.getElementById('v_brand') as HTMLInputElement).value).toBe('JSON Brand');

    await waitForSaveToComplete(window);
    expect(window.isDirty).toBe(false);

    const dbConfig = await deps.tenantConfigService.getConfig(tenantId);
    expect(dbConfig.identity.botName).toBe('JSON Synced Bot');
  });

  it('12. Visual Editor editing synchronizes to Raw JSON editor and triggers autosave', async () => {
    const { tenantId } = await createTestTenant('Visual Sync');
    const { window, document } = setupVirtualDom(tenantId);
    await window.loadConfig();

    (document.getElementById('v_botName') as HTMLInputElement).value = 'Visual Synced Bot';
    document.getElementById('v_botName')!.dispatchEvent(new window.Event('input'));

    const rawEditor = document.getElementById('rawJsonEditor') as HTMLTextAreaElement;
    const parsed = JSON.parse(rawEditor.value);
    expect(parsed.identity.botName).toBe('Visual Synced Bot');

    await waitForSaveToComplete(window);
    expect(window.isDirty).toBe(false);

    const dbConfig = await deps.tenantConfigService.getConfig(tenantId);
    expect(dbConfig.identity.botName).toBe('Visual Synced Bot');
  });

  it('13. Page reload preserves saved configuration', async () => {
    const { tenantId } = await createTestTenant('Persistence Test');
    const { window, document } = setupVirtualDom(tenantId);
    await window.loadConfig();

    (document.getElementById('v_botName') as HTMLInputElement).value = 'Persistent Bot';
    document.getElementById('v_botName')!.dispatchEvent(new window.Event('input'));

    await waitForSaveToComplete(window);
    expect(window.isDirty).toBe(false);

    // Simulate new page load / reload
    const reloaded = setupVirtualDom(tenantId);
    await reloaded.window.loadConfig();

    expect((reloaded.document.getElementById('v_botName') as HTMLInputElement).value).toBe('Persistent Bot');
  });

  it('14. Initial page load does NOT mark config dirty or trigger save', async () => {
    const { tenantId } = await createTestTenant('Initial Clean Load');
    let postCallCount = 0;

    const trackFetch = async (url: string, init?: any) => {
      if (url.includes('/config') && init?.method === 'POST') postCallCount++;
      const method = (init?.method || 'GET').toLowerCase() as 'get' | 'post';
      let req = (request(app) as any)[method](url);
      const res = await req;
      return {
        ok: res.status >= 200 && res.status < 300,
        status: res.status,
        headers: { get: (h: string) => res.headers[h.toLowerCase()] || null },
        json: async () => res.body
      };
    };

    const { window } = setupVirtualDom(tenantId, trackFetch);
    await window.loadConfig();

    // Wait longer than debounce
    await new Promise((r) => setTimeout(r, 900));

    expect(window.isDirty).toBe(false);
    expect(window.saveStatus).toBe('saved');
    expect(postCallCount).toBe(0);
  });

  it('15. Manual Save button still works and immediately saves without waiting for debounce', async () => {
    const { tenantId } = await createTestTenant('Manual Save');
    const { window, document } = setupVirtualDom(tenantId);
    await window.loadConfig();

    (document.getElementById('v_botName') as HTMLInputElement).value = 'Immediate Manual Bot';
    document.getElementById('v_botName')!.dispatchEvent(new window.Event('input'));

    expect(window.isDirty).toBe(true);

    // Immediately click Save Config without waiting 750ms
    await window.saveConfig();

    expect(window.isDirty).toBe(false);
    expect(window.saveStatus).toBe('saved');

    const dbConfig = await deps.tenantConfigService.getConfig(tenantId);
    expect(dbConfig.identity.botName).toBe('Immediate Manual Bot');
  });

  it('16. Unknown JSON fields remain preserved across Visual Editor edits and autosaves', async () => {
    const customConfig: any = {
      ...DEFAULT_BUSINESS_CONFIG,
      customEnterpriseKey: 'enterprise-secret-1234',
      customFeatureMetadata: { betaTester: true, region: 'emea' }
    };

    const { tenantId } = await createTestTenant('Unknown Fields', customConfig);
    const { window, document } = setupVirtualDom(tenantId);
    await window.loadConfig();

    // Edit only standard Visual field
    (document.getElementById('v_botName') as HTMLInputElement).value = 'Preserved Fields Bot';
    document.getElementById('v_botName')!.dispatchEvent(new window.Event('input'));

    await waitForSaveToComplete(window);
    expect(window.isDirty).toBe(false);

    const dbConfig: any = await deps.tenantConfigService.getConfig(tenantId);
    expect(dbConfig.identity.botName).toBe('Preserved Fields Bot');
    expect(dbConfig.customEnterpriseKey).toBe('enterprise-secret-1234');
    expect(dbConfig.customFeatureMetadata).toEqual({ betaTester: true, region: 'emea' });
  });
});
