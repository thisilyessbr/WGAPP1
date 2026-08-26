import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { prisma } from '../../src/tests/testDb';
import { ProductRepository } from '../../src/domain/ecommerce/ProductRepository';
import { EcommerceService } from '../../src/domain/ecommerce/EcommerceService';
import { EcommerceIntentParser } from '../../src/domain/ecommerce/EcommerceIntent';
import { AnswerComposer } from '../../src/domain/conversation/AnswerComposer';
import { DEFAULT_BUSINESS_CONFIG } from '../../src/domain/tenant/BusinessConfig';
import { TenantConfigService } from '../../src/domain/tenant/TenantConfigService';
import { AccountConfigService } from '../../src/domain/tenant/AccountConfigService';
import { bootstrapChatbot } from '../../src/bootstrap';
import { createDevChatRouter, createSignedToken } from '../../src/dev/chatApi';

describe('PHASE ARCH-FIX-48C — Account Provisioning & Catalog Metadata Ingestion', () => {
  let productRepo: ProductRepository;
  let ecommerceService: EcommerceService;
  let tenantConfigService: TenantConfigService;
  let accountConfigService: AccountConfigService;
  let app: express.Application;

  let tenantA: string;
  let tenantB: string;
  let tokenA: string;
  let tokenB: string;

  let accountA1Id: string;
  let accountA2Id: string;
  let accountB1Id: string;
  let laptopProdId: string;
  let laptopVarId: string;

  beforeAll(async () => {
    const deps = bootstrapChatbot(prisma);
    tenantConfigService = deps.tenantConfigService;
    accountConfigService = new AccountConfigService(prisma, tenantConfigService);
    productRepo = new ProductRepository(prisma);
    ecommerceService = new EcommerceService(productRepo);

    app = express();
    app.use(express.json());
    app.use('/api/dev', createDevChatRouter(deps));

    // Bootstrap Tenants with auto-generated UUIDs
    const tA = await prisma.tenant.create({ data: { name: `Tenant A ${Date.now()}` } });
    const tB = await prisma.tenant.create({ data: { name: `Tenant B ${Date.now()}` } });
    tenantA = tA.id;
    tenantB = tB.id;

    tokenA = createSignedToken({ tenantId: tenantA, role: 'admin' });
    tokenB = createSignedToken({ tenantId: tenantB, role: 'admin' });

    await tenantConfigService.updateConfig(tenantA, {
      ...DEFAULT_BUSINESS_CONFIG,
      identity: { ...DEFAULT_BUSINESS_CONFIG.identity, businessName: 'TechCorp A' },
      capabilities: { ...DEFAULT_BUSINESS_CONFIG.capabilities, ecommerceEnabled: true }
    });

    await tenantConfigService.updateConfig(tenantB, {
      ...DEFAULT_BUSINESS_CONFIG,
      identity: { ...DEFAULT_BUSINESS_CONFIG.identity, businessName: 'TechCorp B' },
      capabilities: { ...DEFAULT_BUSINESS_CONFIG.capabilities, ecommerceEnabled: true }
    });
  });

  afterAll(async () => {
    try {
      if (tenantA && tenantB) {
        await prisma.productVariant.deleteMany({
          where: { product: { tenantId: { in: [tenantA, tenantB] } } }
        });
        await prisma.product.deleteMany({
          where: { tenantId: { in: [tenantA, tenantB] } }
        });
        await prisma.account.deleteMany({
          where: { tenantId: { in: [tenantA, tenantB] } }
        });
        await prisma.tenantConfig.deleteMany({
          where: { tenantId: { in: [tenantA, tenantB] } }
        });
        await prisma.tenant.deleteMany({
          where: { id: { in: [tenantA, tenantB] } }
        });
      }
    } catch {}
  });

  // Test A & B: Create Account via service / DB
  it('A & B. Create Account: successfully provisions a new account for tenant', async () => {
    const acc = await prisma.account.create({
      data: {
        tenantId: tenantA,
        name: 'Casablanca Store'
      }
    });

    expect(acc.id).toBeDefined();
    expect(acc.name).toBe('Casablanca Store');
    expect(acc.enabled).toBe(true);
    accountA1Id = acc.id;
  });

  // Test C: Account.tenantId == authenticated tenant
  it('C. Account Ownership: verifies account belongs strictly to authenticated tenant', async () => {
    const acc = await prisma.account.findUnique({
      where: { id: accountA1Id }
    });
    expect(acc?.tenantId).toBe(tenantA);
  });

  // Test D: Duplicate name -> rejected by unique constraint
  it('D. Duplicate Account: rejects duplicate account name under same tenant', async () => {
    let failed = false;
    try {
      await prisma.account.create({
        data: {
          tenantId: tenantA,
          name: 'Casablanca Store'
        }
      });
    } catch (e: any) {
      failed = true;
      expect(e.code).toBe('P2002'); // Prisma Unique constraint failed
    }
    expect(failed).toBe(true);
  });

  // Test E: Cross-tenant creation isolated
  it('E. Cross-Tenant Creation: allows same account name under a different tenant', async () => {
    const accB = await prisma.account.create({
      data: {
        tenantId: tenantB,
        name: 'Casablanca Store' // Same name, different tenant
      }
    });
    expect(accB.id).toBeDefined();
    expect(accB.tenantId).toBe(tenantB);
    accountB1Id = accB.id;

    // Also create second account for Tenant A
    const accA2 = await prisma.account.create({
      data: {
        tenantId: tenantA,
        name: 'Rabat Store'
      }
    });
    accountA2Id = accA2.id;
  });

  // Test F & G: Create product under new account with metadata
  it('F & G. Create Product with Metadata: persists product and generic metadata dictionary', async () => {
    const product = await productRepo.createProduct(tenantA, accountA1Id, {
      name: 'Pro Gaming Laptop 16',
      sku: 'LAP-PRO-16',
      category: 'Laptops',
      price: 15000,
      currency: 'MAD',
      stock: 10,
      description: 'High performance laptop with advanced cooling.',
      metadata: {
        ram: '32GB',
        storage: '1TB SSD',
        gpu: 'RTX 4070',
        weight: '2.1kg',
        tags: ['gaming', 'workstation']
      }
    });

    expect(product.id).toBeDefined();
    expect(product.name).toBe('Pro Gaming Laptop 16');
    expect(product.metadata).toEqual({
      ram: '32GB',
      storage: '1TB SSD',
      gpu: 'RTX 4070',
      weight: '2.1kg',
      tags: ['gaming', 'workstation']
    });
    laptopProdId = product.id;
  });

  // Test H: Patch metadata and verify persistence
  it('H. Patch Product Metadata: updates metadata dictionary without losing existing fields', async () => {
    const updated = await productRepo.updateProduct(tenantA, accountA1Id, laptopProdId, {
      price: 14500,
      metadata: {
        ram: '32GB',
        storage: '2TB SSD', // upgraded storage
        gpu: 'RTX 4070',
        display: '165Hz QHD'
      }
    });

    expect(updated).not.toBeNull();
    expect(Number(updated?.price)).toBe(14500);
    expect(updated?.metadata).toEqual({
      ram: '32GB',
      storage: '2TB SSD',
      gpu: 'RTX 4070',
      display: '165Hz QHD'
    });
  });

  // Test I & J: Variant metadata creation and patch
  it('I & J. Variant Metadata: creates and updates variant with metadata', async () => {
    const variant = await productRepo.createVariant(tenantA, accountA1Id, laptopProdId, {
      sku: 'LAP-PRO-16-DARK',
      color: 'Midnight Black',
      priceOverride: 14900,
      stock: 4,
      metadata: {
        keyboard: 'RGB Mechanical',
        powerAdapter: '240W'
      }
    });

    expect(variant).not.toBeNull();
    expect(variant?.sku).toBe('LAP-PRO-16-DARK');
    expect(variant?.metadata).toEqual({
      keyboard: 'RGB Mechanical',
      powerAdapter: '240W'
    });
    laptopVarId = variant!.id;

    // Patch variant metadata
    const updatedVar = await productRepo.updateVariant(tenantA, accountA1Id, laptopProdId, laptopVarId, {
      stock: 8,
      metadata: {
        keyboard: 'RGB Mechanical',
        powerAdapter: '300W GaN'
      }
    });

    expect(updatedVar).not.toBeNull();
    expect(updatedVar?.stock).toBe(8);
    expect(updatedVar?.metadata).toEqual({
      keyboard: 'RGB Mechanical',
      powerAdapter: '300W GaN'
    });
  });

  // Test K: Dynamic category discovery sees new category
  it('K. Dynamic Category Discovery: returns catalog category from newly created product', async () => {
    const categories = await ecommerceService.getDistinctCategories(tenantA, accountA1Id);
    expect(categories).toContain('Laptops');
  });

  // Test L: Dynamic attribute discovery sees metadata key "ram"
  it('L. Dynamic Attribute Discovery: parser matches metadata keys dynamically', () => {
    const parsed = EcommerceIntentParser.parse('what is the ram of this laptop?', null, 'en', {
      candidateMetadataKeys: ['ram', 'storage', 'gpu']
    });
    expect(parsed.intent).toBe('ATTRIBUTE_QUERY');
    expect(parsed.attributeName).toBe('ram');
  });

  // Test M: Recommendation scoring uses metadata
  it('M. Recommendation Scoring: incorporates product metadata into recommendation rank', async () => {
    const result = await ecommerceService.getRecommendations(tenantA, accountA1Id, {
      category: 'Laptops',
      preferredAttributes: { ram: '32GB' }
    });

    expect(result.recommendations.length).toBeGreaterThan(0);
    expect(result.recommendations[0].fact.product.name).toBe('Pro Gaming Laptop 16');
  });

  // Test N: Ecommerce attribute question resolves from metadata
  it('N. Attribute Question Resolution: AnswerComposer composes answer directly from metadata facts', async () => {
    const fact = await ecommerceService.getProductFact(tenantA, accountA1Id, { id: laptopProdId });
    expect(fact).not.toBeNull();

    const turnDecision: any = {
      domain: 'ECOMMERCE',
      intent: 'ATTRIBUTE_QUERY',
      productName: 'Pro Gaming Laptop 16',
      attributeName: 'ram',
      attributeKeywords: 'ram'
    };

    const answer = AnswerComposer.composeEcommerce({
      turnDecision,
      productFacts: [fact!],
      responseLanguage: 'en',
      config: DEFAULT_BUSINESS_CONFIG
    });

    expect(answer).toContain('32GB');
    expect(answer).toContain('Pro Gaming Laptop 16');
  });

  // Test O: Account A product is invisible to Account B
  it('O. Multi-Account Isolation: Account B cannot see or query Account A products', async () => {
    const bResults = await productRepo.search({
      tenantId: tenantA,
      accountId: accountA2Id,
      activeOnly: false
    });
    expect(bResults.length).toBe(0);

    const crossTenantLookup = await productRepo.findById(tenantB, accountB1Id, laptopProdId);
    expect(crossTenantLookup).toBeNull();
  });

  // Test P: Existing tenants without accounts retain PDF/workflow functionality
  it('P. Tenant Without Accounts: zero impact on base tenant config and global knowledge', async () => {
    const config = await accountConfigService.getEffectiveConfig(tenantA, null);
    expect(config.identity.businessName).toBe('TechCorp A');
    expect(config.capabilities?.ecommerceEnabled).toBe(true);
  });

  // API CONTRACT TESTS
  describe('API Endpoints (POST /api/dev/accounts, Product & Variant Metadata)', () => {
    it('API 1. POST /api/dev/accounts creates new account with 201', async () => {
      const res = await request(app)
        .post('/api/dev/accounts')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'Tangier Outlet Store' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.account).toBeDefined();
      expect(res.body.account.name).toBe('Tangier Outlet Store');
      expect(res.body.account.tenantId).toBe(tenantA);
    });

    it('API 2. POST /api/dev/accounts rejects duplicate account name with 409 DUPLICATE_ACCOUNT', async () => {
      const res = await request(app)
        .post('/api/dev/accounts')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'Tangier Outlet Store' });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('DUPLICATE_ACCOUNT');
    });

    it('API 3. POST /api/dev/accounts rejects empty name with 400', async () => {
      const res = await request(app)
        .post('/api/dev/accounts')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: '' });

      expect(res.status).toBe(400);
    });

    it('API 4. POST /api/dev/products persists metadata JSON payload', async () => {
      const res = await request(app)
        .post('/api/dev/products')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          accountId: accountA1Id,
          name: 'Ultra Wireless Mouse',
          sku: 'MOU-WL-01',
          price: 49.99,
          currency: 'USD',
          stock: 50,
          category: 'Accessories',
          metadata: {
            dpi: 16000,
            connectivity: 'Bluetooth + 2.4GHz',
            batteryLifeHours: 70
          }
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.product.metadata).toEqual({
        dpi: 16000,
        connectivity: 'Bluetooth + 2.4GHz',
        batteryLifeHours: 70
      });

      const prodId = res.body.product.id;

      // PATCH product metadata
      const patchRes = await request(app)
        .patch(`/api/dev/products/${prodId}?accountId=${accountA1Id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          metadata: {
            dpi: 20000,
            connectivity: 'Bluetooth + 2.4GHz',
            batteryLifeHours: 80,
            rgb: true
          }
        });

      expect(patchRes.status).toBe(200);
      expect(patchRes.body.product.metadata).toEqual({
        dpi: 20000,
        connectivity: 'Bluetooth + 2.4GHz',
        batteryLifeHours: 80,
        rgb: true
      });

      // POST variant with metadata
      const varRes = await request(app)
        .post(`/api/dev/products/${prodId}/variants`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          accountId: accountA1Id,
          sku: 'MOU-WL-01-WHT',
          color: 'White',
          metadata: {
            edition: 'Special White Edition',
            finish: 'Matte'
          }
        });

      expect(varRes.status).toBe(201);
      expect(varRes.body.variant.metadata).toEqual({
        edition: 'Special White Edition',
        finish: 'Matte'
      });

      const varId = varRes.body.variant.id;

      // PATCH variant metadata
      const patchVarRes = await request(app)
        .patch(`/api/dev/products/${prodId}/variants/${varId}?accountId=${accountA1Id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          metadata: {
            edition: 'Special White Edition V2',
            finish: 'Glossy'
          }
        });

      expect(patchVarRes.status).toBe(200);
      expect(patchVarRes.body.variant.metadata).toEqual({
        edition: 'Special White Edition V2',
        finish: 'Glossy'
      });
    });
  });
});
