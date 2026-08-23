import { describe, it, expect, beforeEach, beforeAll, afterEach } from 'vitest';
import { prisma, pool } from '../../src/tests/testDb';
import { bootstrapChatbot } from '../../src/bootstrap';
import { DEFAULT_BUSINESS_CONFIG, BusinessConfig } from '../../src/domain/tenant/BusinessConfig';
import { createDevChatRouter, createSignedToken } from '../../src/dev/chatApi';
import express from 'express';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { JSDOM } from 'jsdom';
import { LLMMockProvider } from '../../src/core/llm/LLMProvider';
import { MockEmbeddingProvider } from '../../src/core/rag/EmbeddingProvider';
import { ProductRepository } from '../../src/domain/ecommerce/ProductRepository';

describe('Phase 21A: Single Account / Multi-WhatsApp Client UX Integration Tests', { timeout: 30000 }, () => {
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
    htmlContent = fs.readFileSync(htmlPath, 'utf8');
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
    for (const tenantId of createdTenantIds) {
      try {
        await prisma.knowledgeChunk.deleteMany({ where: { tenantId } });
        await prisma.knowledgeDocument.deleteMany({ where: { tenantId } });
        await prisma.knowledgeSource.deleteMany({ where: { tenantId } });
        await prisma.productVariant.deleteMany({ where: { product: { tenantId } } });
        await prisma.product.deleteMany({ where: { tenantId } });
        await prisma.conversation.deleteMany({ where: { tenantId } });
        await prisma.customer.deleteMany({ where: { tenantId } });
        await prisma.tenantConfig.deleteMany({ where: { tenantId } });
        await prisma.account.deleteMany({ where: { tenantId } });
        await prisma.tenant.deleteMany({ where: { id: tenantId } });
      } catch (err) {}
    }
    createdTenantIds.length = 0;
  });

  async function createTestTenant(name: string, customConfig?: Partial<BusinessConfig>) {
    const tenantId = `tenant-client-ux-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
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
      },
      capabilities: {
        ...DEFAULT_BUSINESS_CONFIG.capabilities,
        ecommerceEnabled: true
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

    // Bridge fetch to express app via supertest
    window.fetch = async (urlStr: string, options: any = {}) => {
      if (customFetchOverride) {
        const customRes = await customFetchOverride(urlStr, options);
        if (customRes !== undefined) return customRes;
      }

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

  it('1. Zero accounts: shows "No store configured" in Ecommerce, Chat, and Knowledge Base', async () => {
    const { tenantId } = await createTestTenant('ZeroStoreTenant');
    const { window, document } = setupVirtualDom(tenantId);

    // Trigger loadAccounts
    await window.loadAccounts();

    // Check Ecommerce Selector
    const ecomSelect = document.getElementById('ecomAccountSelect');
    const ecomStatic = document.getElementById('ecomAccountStatic');
    expect(ecomSelect.style.display).toBe('none');
    expect(ecomStatic.style.display).not.toBe('none');
    expect(ecomStatic.textContent).toBe('No store configured');

    // Check Chat Selector
    const chatSelect = document.getElementById('chatAccountSelect');
    const chatStatic = document.getElementById('chatAccountStatic');
    expect(chatSelect.style.display).toBe('none');
    expect(chatStatic.style.display).not.toBe('none');
    expect(chatStatic.textContent).toBe('No store configured');

    // Check Knowledge Base Selector
    const ragSelect = document.getElementById('ragAccountSelect');
    expect(ragSelect.options.length).toBe(1);
    expect(ragSelect.options[0].value).toBe('global');
    expect(ragSelect.options[0].text).toContain('No store configured');

    // Product list container should show no store configured message
    const container = document.getElementById('productListContainer');
    expect(container.textContent).toContain('No store configured for this tenant');
  });

  it('2. Single account: hides Store dropdowns, shows static store name badge, and auto-selects accountId', async () => {
    const { tenantId } = await createTestTenant('SingleStoreTenant');
    const account = await prisma.account.create({
      data: {
        tenantId,
        name: 'AnimeVerse Flagship Store',
        enabled: true,
        config: { capabilities: { ecommerceEnabled: true } }
      }
    });

    const { window, document } = setupVirtualDom(tenantId);
    await window.loadAccounts();

    // Check Ecommerce UI: Dropdown hidden, static label visible with account name
    const ecomSelect = document.getElementById('ecomAccountSelect');
    const ecomStatic = document.getElementById('ecomAccountStatic');
    expect(ecomSelect.style.display).toBe('none');
    expect(ecomStatic.style.display).not.toBe('none');
    expect(ecomStatic.textContent).toContain('AnimeVerse Flagship Store');
    expect(ecomSelect.value).toBe(account.id);

    // Check Chat UI: Dropdown hidden, static label visible with account name
    const chatSelect = document.getElementById('chatAccountSelect');
    const chatStatic = document.getElementById('chatAccountStatic');
    expect(chatSelect.style.display).toBe('none');
    expect(chatStatic.style.display).not.toBe('none');
    expect(chatStatic.textContent).toContain('AnimeVerse Flagship Store');
    expect(chatSelect.value).toBe(account.id);

    // Check Knowledge Base Scope: Single store defaults to store knowledge with global option
    const ragSelect = document.getElementById('ragAccountSelect');
    expect(ragSelect.options.length).toBe(2);
    expect(ragSelect.options[0].value).toBe(account.id);
    expect(ragSelect.options[0].text).toContain('AnimeVerse Flagship Store (Store Knowledge)');
    expect(ragSelect.options[1].value).toBe('global');
    expect(ragSelect.value).toBe(account.id);
  });

  it('3. Two or more accounts: keeps multi-account dropdowns visible in Ecommerce, Chat, and Knowledge Base', async () => {
    const { tenantId } = await createTestTenant('MultiStoreTenant');
    const accA = await prisma.account.create({
      data: {
        tenantId,
        name: 'Casablanca Store',
        enabled: true,
        config: { capabilities: { ecommerceEnabled: true } }
      }
    });
    const accB = await prisma.account.create({
      data: {
        tenantId,
        name: 'Rabat Store',
        enabled: true,
        config: { capabilities: { ecommerceEnabled: true } }
      }
    });

    const { window, document } = setupVirtualDom(tenantId);
    await window.loadAccounts();

    // Check Ecommerce UI: Dropdown visible, static label hidden
    const ecomSelect = document.getElementById('ecomAccountSelect');
    const ecomStatic = document.getElementById('ecomAccountStatic');
    expect(ecomSelect.style.display).toBe('inline-block');
    expect(ecomStatic.style.display).toBe('none');
    expect(ecomSelect.options.length).toBe(3); // placeholder + 2 accounts

    // Check Chat UI: Dropdown visible, static label hidden
    const chatSelect = document.getElementById('chatAccountSelect');
    const chatStatic = document.getElementById('chatAccountStatic');
    expect(chatSelect.style.display).toBe('inline-block');
    expect(chatStatic.style.display).toBe('none');
    expect(chatSelect.options.length).toBe(3); // default + 2 accounts

    // Check Knowledge Base Scope: Global + 2 accounts
    const ragSelect = document.getElementById('ragAccountSelect');
    expect(ragSelect.options.length).toBe(3);
    expect(ragSelect.options[0].value).toBe('global');
    expect(ragSelect.options[1].value).toBe(accA.id);
    expect(ragSelect.options[2].value).toBe(accB.id);
  });

  it('4. Single Account Chat propagation: sends correct accountId to backend', async () => {
    const { tenantId } = await createTestTenant('SingleAccountChatTenant');
    const account = await prisma.account.create({
      data: {
        tenantId,
        name: 'AnimeVerse Single Chat Store',
        enabled: true,
        config: { capabilities: { ecommerceEnabled: true } }
      }
    });

    // Create a product for this account
    await productRepo.createProduct(tenantId, account.id, {
      name: 'Titan Slayer Hoodie',
      sku: 'HOOD-TITAN-01',
      description: 'Attack on Titan oversized hoodie',
      price: 380,
      currency: 'MAD',
      stock: 15,
      active: true
    });

    const { window, document } = setupVirtualDom(tenantId);
    await window.loadAccounts();

    // Send a message through the UI
    document.getElementById('chatInput').value = 'What hoodies do you have?';
    
    let capturedRequestBody: any = null;
    const originalFetch = window.fetch;
    window.fetch = async (url: string, opts: any) => {
      if (url === '/api/dev/chat' && opts?.method === 'POST') {
        capturedRequestBody = JSON.parse(opts.body);
      }
      return originalFetch(url, opts);
    };

    const form = document.querySelector('form[onsubmit="sendMessage(event)"]');
    const fakeEvent = { preventDefault: () => {} };
    await window.sendMessage(fakeEvent);

    // Verify accountId was correctly populated from the single account
    expect(capturedRequestBody).toBeDefined();
    expect(capturedRequestBody.tenantId).toBe(tenantId);
    expect(capturedRequestBody.accountId).toBe(account.id);
  });

  it('5. Single Account Ecommerce propagation: loads products scoped to the single account', async () => {
    const { tenantId } = await createTestTenant('SingleAccountEcomTenant');
    const account = await prisma.account.create({
      data: {
        tenantId,
        name: 'AnimeVerse Ecom Store',
        enabled: true,
        config: { capabilities: { ecommerceEnabled: true } }
      }
    });

    await productRepo.createProduct(tenantId, account.id, {
      name: 'Dragon Ball Gi Hoodie',
      sku: 'HOOD-DBZ-01',
      description: 'Goku orange gi hoodie',
      price: 320,
      currency: 'MAD',
      stock: 10,
      active: true
    });

    const { window, document } = setupVirtualDom(tenantId);
    await window.loadAccounts();
    await window.loadProducts();

    const productListContainer = document.getElementById('productListContainer');
    expect(productListContainer.innerHTML).toContain('Dragon Ball Gi Hoodie');
    expect(productListContainer.innerHTML).toContain('HOOD-DBZ-01');
    expect(productListContainer.innerHTML).toContain('320 MAD');
  });

  it('6. Dynamic Account derivation: does NOT hardcode "AnimeVerse" and derives from DB', async () => {
    const { tenantId } = await createTestTenant('CustomBrandTenant');
    const account = await prisma.account.create({
      data: {
        tenantId,
        name: 'CyberPunk Mechanics Hub',
        enabled: true,
        config: { capabilities: { ecommerceEnabled: true } }
      }
    });

    const { window, document } = setupVirtualDom(tenantId);
    await window.loadAccounts();

    const ecomStatic = document.getElementById('ecomAccountStatic');
    expect(ecomStatic.textContent).toContain('CyberPunk Mechanics Hub');
    expect(ecomStatic.textContent).not.toContain('AnimeVerse');

    const chatStatic = document.getElementById('chatAccountStatic');
    expect(chatStatic.textContent).toContain('CyberPunk Mechanics Hub');
    expect(chatStatic.textContent).not.toContain('AnimeVerse');
  });

  it('7. Tenant Switching: dynamically switches UI between 0-account, 1-account, and 2-account tenants', async () => {
    // Tenant 1: 0 accounts
    const { tenantId: t0 } = await createTestTenant('TenantZero');
    // Tenant 2: 1 account
    const { tenantId: t1 } = await createTestTenant('TenantOne');
    const acc1 = await prisma.account.create({
      data: { tenantId: t1, name: 'Store One', enabled: true }
    });
    // Tenant 3: 2 accounts
    const { tenantId: t2 } = await createTestTenant('TenantTwo');
    await prisma.account.create({ data: { tenantId: t2, name: 'Store Alpha', enabled: true } });
    await prisma.account.create({ data: { tenantId: t2, name: 'Store Beta', enabled: true } });

    const { window, document } = setupVirtualDom(t0);

    // Initial state: Tenant 0 (0 accounts)
    await window.loadAccounts();
    expect(document.getElementById('ecomAccountStatic').textContent).toBe('No store configured');

    // Switch to Tenant 1 (1 account)
    document.getElementById('tenantId').value = t1;
    await window.onTenantChange();
    expect(document.getElementById('ecomAccountSelect').style.display).toBe('none');
    expect(document.getElementById('ecomAccountStatic').textContent).toContain('Store One');

    // Switch to Tenant 2 (2 accounts)
    document.getElementById('tenantId').value = t2;
    await window.onTenantChange();
    expect(document.getElementById('ecomAccountSelect').style.display).toBe('inline-block');
    expect(document.getElementById('ecomAccountStatic').style.display).toBe('none');
  });

  it('8. Account Isolation: Store A products are never visible to Store B', async () => {
    const { tenantId } = await createTestTenant('IsolationTestTenant');
    const accA = await prisma.account.create({
      data: { tenantId, name: 'AnimeVerse Store A', enabled: true, config: { capabilities: { ecommerceEnabled: true } } }
    });
    const accB = await prisma.account.create({
      data: { tenantId, name: 'Rival Store B', enabled: true, config: { capabilities: { ecommerceEnabled: true } } }
    });

    await productRepo.createProduct(tenantId, accA.id, {
      name: 'AnimeVerse Exclusive Hoodie',
      sku: 'EXCL-A-01',
      description: 'Exclusive to Store A',
      price: 500,
      currency: 'MAD',
      stock: 5,
      active: true
    });

    const token = createSignedToken({ tenantId, role: 'admin' });

    // Request products for Store A
    const resA = await request(app)
      .get(`/api/dev/products?tenantId=${tenantId}&accountId=${accA.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(resA.status).toBe(200);
    expect(resA.body.products.length).toBe(1);
    expect(resA.body.products[0].name).toBe('AnimeVerse Exclusive Hoodie');

    // Request products for Store B
    const resB = await request(app)
      .get(`/api/dev/products?tenantId=${tenantId}&accountId=${accB.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(resB.status).toBe(200);
    expect(resB.body.products.length).toBe(0);
  });
});
