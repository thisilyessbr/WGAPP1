import { describe, it, expect, beforeEach, beforeAll, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { prisma, pool } from '../../src/tests/testDb';
import { bootstrapChatbot } from '../../src/bootstrap';
import { createDevChatRouter, createSignedToken } from '../../src/dev/chatApi';
import { DEFAULT_BUSINESS_CONFIG } from '../../src/domain/tenant/BusinessConfig';
import { LLMMockProvider } from '../../src/core/llm/LLMProvider';

describe('Phase 16B: Ecommerce Frontend / Admin Integration Tests', () => {
  let app: express.Application;
  let deps: ReturnType<typeof bootstrapChatbot>;
  let mockLlm: LLMMockProvider;
  const createdTenantIds: string[] = [];

  beforeAll(async () => {
    const client = await pool.connect();
    try {
      await client.query('SET search_path TO test, public, extensions;');
    } finally {
      client.release();
    }
  });

  beforeEach(async () => {
    deps = bootstrapChatbot(prisma);
    mockLlm = new LLMMockProvider();
    deps.llmFactory.registerProvider('mock', 'mock-model', mockLlm);
    deps.tenantConfigService.clearCache();

    app = express();
    app.use(express.json());
    app.use('/api/dev', createDevChatRouter(deps));
  });

  afterEach(async () => {
    for (const tenantId of createdTenantIds) {
      try {
        await prisma.tenant.delete({ where: { id: tenantId } });
      } catch (err) {}
    }
    createdTenantIds.length = 0;
  });

  async function seedEcommerceTenants() {
    const tenant = await prisma.tenant.create({
      data: {
        name: `Tenant-Ecom-UI-${Date.now()}`,
        config: {
          create: {
            config: {
              ...DEFAULT_BUSINESS_CONFIG,
              workflows: {},
              capabilities: {
                ...DEFAULT_BUSINESS_CONFIG.capabilities,
                ecommerceEnabled: true
              }
            }
          }
        },
        accounts: {
          create: [
            { name: 'store-a', config: { capabilities: { ecommerceEnabled: true } } },
            { name: 'store-b', config: { capabilities: { ecommerceEnabled: true } } },
            { name: 'store-disabled', config: { capabilities: { ecommerceEnabled: false } } }
          ]
        }
      },
      include: { accounts: true }
    });
    createdTenantIds.push(tenant.id);

    const accountA = tenant.accounts.find(a => a.name === 'store-a')!;
    const accountB = tenant.accounts.find(a => a.name === 'store-b')!;
    const accountDisabled = tenant.accounts.find(a => a.name === 'store-disabled')!;

    const token = createSignedToken({ tenantId: tenant.id, role: 'admin' });

    return { tenant, accountA, accountB, accountDisabled, token };
  }

  it('1. Product CRUD via API with account scoping', async () => {
    const { tenant, accountA, token } = await seedEcommerceTenants();

    // 1. Create Product
    const createRes = await request(app)
      .post('/api/dev/products')
      .set('Authorization', `Bearer ${token}`)
      .send({
        accountId: accountA.id,
        name: 'Running Shoes Pro',
        sku: 'RSP-01',
        description: 'High performance marathon shoes',
        price: 130,
        currency: 'USD',
        stock: 20,
        category: 'Footwear',
        nameLocalized: { fr: 'Chaussures Pro', ar: 'حذاء الجري الاحترافي', darija: 'Sbbat Running' },
        descriptionLocalized: { fr: 'Chaussures de marathon', ar: 'حذاء ماراثون عالي الأداء', darija: 'Sbbat dyal lmarathon' },
        active: true
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.success).toBe(true);
    expect(createRes.body.product.name).toBe('Running Shoes Pro');
    expect(createRes.body.product.sku).toBe('RSP-01');
    expect(createRes.body.product.accountId).toBe(accountA.id);
    const productId = createRes.body.product.id;

    // 2. List Products for Account A
    const listRes = await request(app)
      .get(`/api/dev/products?accountId=${accountA.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(listRes.status).toBe(200);
    expect(listRes.body.count).toBe(1);
    expect(listRes.body.products[0].id).toBe(productId);

    // 3. Get Product by ID
    const getRes = await request(app)
      .get(`/api/dev/products/${productId}?accountId=${accountA.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body.product.id).toBe(productId);
    expect(getRes.body.product.nameLocalized.fr).toBe('Chaussures Pro');

    // 4. Update Product
    const updateRes = await request(app)
      .patch(`/api/dev/products/${productId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        accountId: accountA.id,
        price: 145,
        stock: 18
      });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.product.price).toBe('145');
    expect(updateRes.body.product.stock).toBe(18);

    // 5. Delete Product
    const delRes = await request(app)
      .delete(`/api/dev/products/${productId}?accountId=${accountA.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(delRes.status).toBe(200);
    expect(delRes.body.success).toBe(true);

    // Verify deleted
    const verifyRes = await request(app)
      .get(`/api/dev/products/${productId}?accountId=${accountA.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(verifyRes.status).toBe(404);
  });

  it('2. Variant CRUD via API', async () => {
    const { tenant, accountA, token } = await seedEcommerceTenants();

    // Create Base Product
    const createRes = await request(app)
      .post('/api/dev/products')
      .set('Authorization', `Bearer ${token}`)
      .send({
        accountId: accountA.id,
        name: 'Trail Running Jacket',
        sku: 'TRJ-01',
        price: 90,
        currency: 'USD',
        stock: 10
      });
    const productId = createRes.body.product.id;

    // 1. Add Variant
    const addVarRes = await request(app)
      .post(`/api/dev/products/${productId}/variants`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        accountId: accountA.id,
        sku: 'TRJ-01-L-BLUE',
        size: 'L',
        color: 'Blue',
        priceOverride: 95,
        stock: 4,
        active: true
      });

    expect(addVarRes.status).toBe(201);
    expect(addVarRes.body.success).toBe(true);
    expect(addVarRes.body.variant.sku).toBe('TRJ-01-L-BLUE');
    const variantId = addVarRes.body.variant.id;

    // 2. Update Variant
    const updateVarRes = await request(app)
      .patch(`/api/dev/products/${productId}/variants/${variantId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        accountId: accountA.id,
        stock: 7,
        priceOverride: 99
      });

    expect(updateVarRes.status).toBe(200);
    expect(updateVarRes.body.variant.stock).toBe(7);
    expect(updateVarRes.body.variant.priceOverride).toBe('99');

    // 3. Delete Variant
    const delVarRes = await request(app)
      .delete(`/api/dev/products/${productId}/variants/${variantId}?accountId=${accountA.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(delVarRes.status).toBe(200);
    expect(delVarRes.body.success).toBe(true);
  });

  it('3. Account Isolation: Account A cannot access or edit Account B products', async () => {
    const { tenant, accountA, accountB, token } = await seedEcommerceTenants();

    // Create Product in Account B
    const createBRes = await request(app)
      .post('/api/dev/products')
      .set('Authorization', `Bearer ${token}`)
      .send({
        accountId: accountB.id,
        name: 'Account B Exclusive Jacket',
        sku: 'EXCL-B-01',
        price: 200,
        stock: 5
      });
    const productBId = createBRes.body.product.id;

    // Account A tries to view Account B products via list
    const listARes = await request(app)
      .get(`/api/dev/products?accountId=${accountA.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(listARes.status).toBe(200);
    expect(listARes.body.products.some((p: any) => p.id === productBId)).toBe(false);

    // Account A tries to GET Account B product directly
    const getForeignRes = await request(app)
      .get(`/api/dev/products/${productBId}?accountId=${accountA.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(getForeignRes.status).toBe(404);

    // Account A tries to PATCH Account B product
    const patchForeignRes = await request(app)
      .patch(`/api/dev/products/${productBId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        accountId: accountA.id,
        price: 10
      });

    expect(patchForeignRes.status).toBe(404);

    // Account A tries to DELETE Account B product
    const delForeignRes = await request(app)
      .delete(`/api/dev/products/${productBId}?accountId=${accountA.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(delForeignRes.status).toBe(404);
  });

  it('4. Feature Flag: ecommerceEnabled = false rejects product API access', async () => {
    const { tenant, accountDisabled, token } = await seedEcommerceTenants();

    // List products
    const listRes = await request(app)
      .get(`/api/dev/products?accountId=${accountDisabled.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(listRes.status).toBe(403);
    expect(listRes.body.error).toBe('ECOMMERCE_DISABLED');

    // Create product
    const createRes = await request(app)
      .post('/api/dev/products')
      .set('Authorization', `Bearer ${token}`)
      .send({
        accountId: accountDisabled.id,
        name: 'Disabled Store Product',
        sku: 'DIS-01',
        price: 50
      });

    expect(createRes.status).toBe(403);
    expect(createRes.body.error).toBe('ECOMMERCE_DISABLED');
  });

  it('5. Product-to-Chatbot Propagation: UI writes immediately update Chatbot DB responses', async () => {
    const { tenant, accountA, token } = await seedEcommerceTenants();

    // Admin creates Atlas Shoes via UI API
    const createRes = await request(app)
      .post('/api/dev/products')
      .set('Authorization', `Bearer ${token}`)
      .send({
        accountId: accountA.id,
        name: 'Atlas Shoes',
        sku: 'ATLAS-42',
        description: 'Comfortable road running shoes',
        price: 120,
        currency: 'MAD',
        stock: 5,
        active: true
      });
    expect(createRes.status).toBe(201);
    const productId = createRes.body.product.id;

    // Chat query: "How much are the Atlas Shoes?"
    const res1 = await deps.conversationEngine.handleMessage(
      tenant.id,
      'cust-prop-1',
      'How much are the Atlas Shoes?',
      accountA.id
    );
    expect(res1).toContain('120 MAD');

    // Admin updates price to 150 MAD and stock to 0 via UI API
    const updateRes = await request(app)
      .patch(`/api/dev/products/${productId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        accountId: accountA.id,
        price: 150,
        stock: 0
      });
    expect(updateRes.status).toBe(200);

    // Chat query: "How much are the Atlas Shoes?"
    const res2 = await deps.conversationEngine.handleMessage(
      tenant.id,
      'cust-prop-1',
      'How much are the Atlas Shoes?',
      accountA.id
    );
    expect(res2).toContain('150 MAD');

    // Chat query: "Are they in stock?" (or direct availability check)
    const res3 = await deps.conversationEngine.handleMessage(
      tenant.id,
      'cust-prop-2',
      'Is ATLAS-42 available?',
      accountA.id
    );
    expect(res3.toLowerCase()).toContain('out of stock');
  }, 20000);

  it('6. Negative Validation Tests: Invalid data is rejected safely', async () => {
    const { tenant, accountA, token } = await seedEcommerceTenants();

    // Missing Name
    const res1 = await request(app)
      .post('/api/dev/products')
      .set('Authorization', `Bearer ${token}`)
      .send({ accountId: accountA.id, sku: 'TEST-01', price: 50 });
    expect(res1.status).toBe(400);

    // Missing SKU
    const res2 = await request(app)
      .post('/api/dev/products')
      .set('Authorization', `Bearer ${token}`)
      .send({ accountId: accountA.id, name: 'Test Product', price: 50 });
    expect(res2.status).toBe(400);

    // Negative Price
    const res3 = await request(app)
      .post('/api/dev/products')
      .set('Authorization', `Bearer ${token}`)
      .send({ accountId: accountA.id, name: 'Test Product', sku: 'TEST-02', price: -10 });
    expect(res3.status).toBe(400);

    // Negative Stock
    const res4 = await request(app)
      .post('/api/dev/products')
      .set('Authorization', `Bearer ${token}`)
      .send({ accountId: accountA.id, name: 'Test Product', sku: 'TEST-03', price: 50, stock: -5 });
    expect(res4.status).toBe(400);

    // Duplicate SKU in same account
    await request(app)
      .post('/api/dev/products')
      .set('Authorization', `Bearer ${token}`)
      .send({ accountId: accountA.id, name: 'Product 1', sku: 'DUP-SKU-01', price: 50 });

    const dupRes = await request(app)
      .post('/api/dev/products')
      .set('Authorization', `Bearer ${token}`)
      .send({ accountId: accountA.id, name: 'Product 2', sku: 'DUP-SKU-01', price: 60 });
    expect(dupRes.status).toBe(409);
  });
});
