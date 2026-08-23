import { describe, it, expect, beforeEach, beforeAll, afterEach } from 'vitest';
import { prisma, pool } from '../../src/tests/testDb';
import { bootstrapChatbot } from '../../src/bootstrap';
import { createDevChatRouter, createSignedToken } from '../../src/dev/chatApi';
import express from 'express';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { JSDOM } from 'jsdom';
import { LLMMockProvider } from '../../src/core/llm/LLMProvider';
import { MockEmbeddingProvider } from '../../src/core/rag/EmbeddingProvider';
import { ProductRepository } from '../../src/domain/ecommerce/ProductRepository';

describe('Phase 21C: Client Tenant Isolation & No Test-Tenant Fallback Tests', { timeout: 30000 }, () => {
  let deps: ReturnType<typeof bootstrapChatbot>;
  let app: express.Application;
  let mockLlm: LLMMockProvider;
  let productRepo: ProductRepository;
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
    htmlContent = fs.readFileSync(htmlPath, 'utf-8');
  });

  beforeEach(async () => {
    deps = bootstrapChatbot(prisma);
    (deps.ragService as any)['embeddingProvider'] = new MockEmbeddingProvider();
    mockLlm = new LLMMockProvider();
    deps.llmFactory.registerProvider('mock', 'mock-model', mockLlm);
    deps.tenantConfigService.clearCache();
    productRepo = new ProductRepository(prisma);

    app = express();
    app.use(express.json());
    app.use('/api/dev', createDevChatRouter(deps));
  });

  afterEach(async () => {
    for (const tid of createdTenantIds) {
      try {
        await prisma.productVariant.deleteMany({ where: { product: { tenantId: tid } } });
        await prisma.product.deleteMany({ where: { tenantId: tid } });
        await prisma.account.deleteMany({ where: { tenantId: tid } });
        await prisma.tenantConfig.deleteMany({ where: { tenantId: tid } });
        await prisma.tenant.deleteMany({ where: { id: tid } });
      } catch (e) {}
    }
    createdTenantIds.length = 0;
  });

  function setupVirtualDom(tenantId: string = 'animeverse') {
    const dom = new JSDOM(htmlContent, {
      runScripts: 'dangerously',
      url: `http://localhost:3000/?tenantId=${tenantId}`
    });

    const window = dom.window as any;
    const document = window.document;

    window.alert = () => {};
    window.confirm = () => true;

    window.fetch = async (urlStr: string, options: any = {}) => {
      const parsedUrl = new URL(urlStr, 'http://localhost:3000');
      const pathname = parsedUrl.pathname;
      const query = parsedUrl.search;
      const fullPath = pathname + query;
      const method = (options.method || 'GET').toUpperCase();

      let reqBuilder: any;
      if (method === 'GET') reqBuilder = request(app).get(fullPath);
      else if (method === 'POST') reqBuilder = request(app).post(fullPath);
      else if (method === 'PUT') reqBuilder = request(app).put(fullPath);
      else if (method === 'PATCH') reqBuilder = request(app).patch(fullPath);
      else if (method === 'DELETE') reqBuilder = request(app).delete(fullPath);

      if (options.headers) {
        for (const [k, v] of Object.entries(options.headers)) {
          reqBuilder.set(k, v as string);
        }
      }

      if (options.body) {
        if (typeof options.body === 'string') {
          try {
            reqBuilder.send(JSON.parse(options.body));
          } catch {
            reqBuilder.send(options.body);
          }
        } else {
          reqBuilder.send(options.body);
        }
      }

      const res = await reqBuilder;

      return {
        ok: res.status >= 200 && res.status < 300,
        status: res.status,
        statusText: res.statusText || '',
        headers: {
          get: (name: string) => res.headers[name.toLowerCase()] || null
        },
        json: async () => res.body,
        text: async () => res.text
      };
    };

    return { window, document };
  }

  it('1. AnimeVerse tenant exists and loads correctly', async () => {
    const tenant = await prisma.tenant.findUnique({
      where: { id: 'animeverse' },
      include: { accounts: true, products: { include: { variants: true } } }
    });

    expect(tenant).toBeTruthy();
    expect(tenant?.id).toBe('animeverse');
    expect(tenant?.name).toBe('AnimeVerse');
  });

  it('2. AnimeVerse has exactly ONE account: animeverse-store', async () => {
    const accounts = await prisma.account.findMany({
      where: { tenantId: 'animeverse' }
    });

    expect(accounts.length).toBe(1);
    expect(accounts[0].id).toBe('animeverse-store');
    expect(accounts[0].name).toBe('AnimeVerse Store');
    expect(accounts[0].enabled).toBe(true);
  });

  it('3. AnimeVerse UI shows static store badge and hides dropdown selectors', async () => {
    const { window, document } = setupVirtualDom('animeverse');
    await window.loadAccounts();

    const ecomSelect = document.getElementById('ecomAccountSelect') as HTMLSelectElement;
    const ecomStatic = document.getElementById('ecomAccountStatic') as HTMLElement;
    const chatSelect = document.getElementById('chatAccountSelect') as HTMLSelectElement;
    const chatStatic = document.getElementById('chatAccountStatic') as HTMLElement;
    const ragSelect = document.getElementById('ragAccountSelect') as HTMLSelectElement;

    // Dropdowns must be hidden
    expect(ecomSelect.style.display).toBe('none');
    expect(chatSelect.style.display).toBe('none');

    // Static badges must be visible
    expect(ecomStatic.style.display).toBe('inline-block');
    expect(ecomStatic.textContent).toContain('AnimeVerse Store');
    expect(chatStatic.style.display).toBe('inline-block');
    expect(chatStatic.textContent).toContain('AnimeVerse Store');

    // Knowledge scope must default to animeverse-store
    expect(ragSelect.value).toBe('animeverse-store');
  });

  it('4. MANUAL-ECOMMERCE-TEST never becomes the automatic client default', () => {
    const { document } = setupVirtualDom();
    const tenantInput = document.getElementById('tenantId') as HTMLInputElement;

    expect(tenantInput.value).not.toBe('MANUAL-ECOMMERCE-TEST');
    expect(tenantInput.value).toBe('animeverse');
  });

  it('5. Explicit MANUAL-ECOMMERCE-TEST selection displays test warning banner', async () => {
    const { window, document } = setupVirtualDom('animeverse');

    const bannerBefore = document.getElementById('testTenantWarningBanner') as HTMLElement;
    expect(bannerBefore.style.display).toBe('none');

    document.getElementById('tenantId').value = 'MANUAL-ECOMMERCE-TEST';
    await window.onTenantChange();

    const bannerAfter = document.getElementById('testTenantWarningBanner') as HTMLElement;
    expect(bannerAfter.style.display).toBe('block');
    expect(bannerAfter.textContent).toContain('Test tenant selected');
  });

  it('6. Empty tenant ID does not silently fallback to a test tenant', async () => {
    const { window, document } = setupVirtualDom('animeverse');

    document.getElementById('tenantId').value = '   ';
    await window.onTenantChange();

    const tenantInput = document.getElementById('tenantId') as HTMLInputElement;
    expect(tenantInput.value).not.toBe('MANUAL-ECOMMERCE-TEST');
    expect(tenantInput.value).not.toBe('dev-tenant');
    expect(tenantInput.value).toBe('animeverse');
  });

  it('7. Ecommerce product requests carry animeverse + animeverse-store', async () => {
    const res = await request(app)
      .get('/api/dev/products?tenantId=animeverse&accountId=animeverse-store&activeOnly=false')
      .set('X-Tenant-Id', 'animeverse')
      .set('X-Account-Id', 'animeverse-store');

    expect(res.status).toBe(200);
    expect(res.body.products).toBeDefined();
    expect(res.body.products.length).toBeGreaterThanOrEqual(3);

    const skus = res.body.products.map((p: any) => p.sku);
    expect(skus).toContain('ANV-H001');
    expect(skus).toContain('ANV-T001');
    expect(skus).toContain('ANV-J001');

    for (const p of res.body.products) {
      expect(p.tenantId).toBe('animeverse');
      expect(p.accountId).toBe('animeverse-store');
    }
  });

  it('8. Test Chat carries animeverse + animeverse-store', async () => {
    const res = await request(app)
      .post('/api/dev/chat')
      .set('X-Tenant-Id', 'animeverse')
      .send({
        tenantId: 'animeverse',
        accountId: 'animeverse-store',
        customerId: 'animeverse-shopper-01',
        message: 'Hello, what hoodies do you have?'
      });

    expect(res.status).toBe(200);
    expect(res.body.message).toBeDefined();
  });

  it('9. Knowledge Base defaults to animeverse-store scope', async () => {
    const { window, document } = setupVirtualDom('animeverse');
    await window.loadAccounts();

    const ragSelect = document.getElementById('ragAccountSelect') as HTMLSelectElement;

    expect(ragSelect.value).toBe('animeverse-store');
    expect(ragSelect.options.length).toBe(2);
    expect(ragSelect.options[0].value).toBe('animeverse-store');
    expect(ragSelect.options[1].value).toBe('global');
  });

  it('10. Global Knowledge remains accessible with null/empty accountId', async () => {
    const { window, document } = setupVirtualDom('animeverse');
    await window.loadAccounts();

    const ragSelect = document.getElementById('ragAccountSelect') as HTMLSelectElement;

    ragSelect.value = 'global';
    window.onRagAccountChange();

    const badge = document.getElementById('ragScopeBadge') as HTMLElement;
    expect(badge.textContent).toContain('Scope: Global');
  });

  it('11. Multi-account test tenants still display the interactive selector', async () => {
    const { window, document } = setupVirtualDom('MANUAL-ECOMMERCE-TEST');
    await window.loadAccounts();

    const ecomSelect = document.getElementById('ecomAccountSelect') as HTMLSelectElement;
    const ecomStatic = document.getElementById('ecomAccountStatic') as HTMLElement;

    expect(ecomSelect.style.display).toBe('inline-block');
    expect(ecomStatic.style.display).toBe('none');
    expect(ecomSelect.options.length).toBeGreaterThanOrEqual(3);
  });

  it('12. Manual test fixtures remain intact in the database', async () => {
    const testTenant = await prisma.tenant.findUnique({
      where: { id: 'MANUAL-ECOMMERCE-TEST' },
      include: { accounts: true, products: true }
    });

    expect(testTenant).toBeTruthy();
    expect(testTenant?.accounts.length).toBe(3);
    const accountIds = testTenant?.accounts.map((a: any) => a.id);
    expect(accountIds).toContain('STORE-A-MANUAL');
    expect(accountIds).toContain('STORE-B-MANUAL');
    expect(accountIds).toContain('STORE-C-OFF-MANUAL');
  });
});
