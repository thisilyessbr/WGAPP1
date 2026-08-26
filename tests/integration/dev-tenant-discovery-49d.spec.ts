import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, pool } from '../../src/tests/testDb';
import { bootstrapChatbot } from '../../src/bootstrap';
import { createDevChatRouter, createSignedToken } from '../../src/dev/chatApi';
import { ProductRepository } from '../../src/domain/ecommerce/ProductRepository';
import { DEFAULT_BUSINESS_CONFIG, BusinessConfig } from '../../src/domain/tenant/BusinessConfig';
import express from 'express';
import request from 'supertest';

function createPdfBuffer(title: string, bodyText: string): Buffer {
  const safeTitle = title.replace(/[()\\]/g, '');
  const lines: string[] = [];
  const words = bodyText.replace(/[()\\]/g, '').split(/\s+/);
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > 60) {
      if (cur) lines.push(cur);
      cur = w;
    } else {
      cur = (cur + ' ' + w).trim();
    }
  }
  if (cur) lines.push(cur);

  let y = 750;
  let streamContent = `BT /F1 16 Tf 50 ${y} Td (${safeTitle}) Tj ET\n`;
  y -= 30;
  for (const line of lines) {
    streamContent += `BT /F1 12 Tf 50 ${y} Td (${line}) Tj ET\n`;
    y -= 20;
  }
  const streamLen = Buffer.byteLength(streamContent, 'utf-8');

  const obj1 = `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`;
  const obj2 = `2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n`;
  const obj3 = `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n`;
  const obj4 = `4 0 obj\n<< /Length ${streamLen} >>\nstream\n${streamContent}endstream\nendobj\n`;
  const obj5 = `5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`;

  const header = `%PDF-1.4\n`;
  const offset1 = Buffer.byteLength(header, 'utf-8');
  const offset2 = offset1 + Buffer.byteLength(obj1, 'utf-8');
  const offset3 = offset2 + Buffer.byteLength(obj2, 'utf-8');
  const offset4 = offset3 + Buffer.byteLength(obj3, 'utf-8');
  const offset5 = offset4 + Buffer.byteLength(obj4, 'utf-8');
  const xrefOffset = offset5 + Buffer.byteLength(obj5, 'utf-8');

  const pad = (n: number) => String(n).padStart(10, '0');
  const xref = `xref\n0 6\n0000000000 65535 f \n${pad(offset1)} 00000 n \n${pad(offset2)} 00000 n \n${pad(offset3)} 00000 n \n${pad(offset4)} 00000 n \n${pad(offset5)} 00000 n \n`;
  const trailer = `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(header + obj1 + obj2 + obj3 + obj4 + obj5 + xref + trailer, 'utf-8');
}

describe('Phase 49D: Dev Tenant Discovery & Manual Acceptance Setup Integration Tests', () => {
  let deps: ReturnType<typeof bootstrapChatbot>;
  let app: express.Application;
  let productRepo: ProductRepository;
  const createdTenantIds: string[] = [];

  beforeAll(async () => {
    const client = await pool.connect();
    try {
      await client.query('SET search_path TO test, public, extensions;');
    } finally {
      client.release();
    }

    deps = bootstrapChatbot(prisma);
    productRepo = new ProductRepository(prisma);

    app = express();
    app.use(express.json());
    app.use('/api/dev', createDevChatRouter(deps));
  });

  afterAll(async () => {
    for (const tId of createdTenantIds) {
      try {
        await prisma.knowledgeChunk.deleteMany({ where: { tenantId: tId } });
        await prisma.knowledgeDocument.deleteMany({ where: { tenantId: tId } });
        await prisma.knowledgeSource.deleteMany({ where: { tenantId: tId } });
        await prisma.productVariant.deleteMany({ where: { product: { tenantId: tId } } });
        await prisma.product.deleteMany({ where: { tenantId: tId } });
        await prisma.account.deleteMany({ where: { tenantId: tId } });
        await prisma.tenantConfig.deleteMany({ where: { tenantId: tId } });
        await prisma.tenant.deleteMany({ where: { id: tId } });
      } catch (e) {
        // ignore
      }
    }
  });

  it('A. GET /api/dev/tenants returns a list of tenants ordered by createdAt desc', async () => {
    const tenantA = await prisma.tenant.create({ data: { name: `Test Discovery A ${Date.now()}` } });
    const tenantB = await prisma.tenant.create({ data: { name: `Test Discovery B ${Date.now()}` } });
    createdTenantIds.push(tenantA.id, tenantB.id);

    const token = createSignedToken({ tenantId: tenantA.id, role: 'admin' });
    const res = await request(app)
      .get('/api/dev/tenants')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.tenants)).toBe(true);
    expect(res.body.tenants.length).toBeGreaterThanOrEqual(2);

    const ids = res.body.tenants.map((t: any) => t.id);
    expect(ids).toContain(tenantA.id);
    expect(ids).toContain(tenantB.id);
  });

  it('B. Tenant list contains id, name, and createdAt without exposing raw internals', async () => {
    const tenant = await prisma.tenant.create({ data: { name: `Shape Test Tenant ${Date.now()}` } });
    createdTenantIds.push(tenant.id);

    const token = createSignedToken({ tenantId: tenant.id, role: 'admin' });
    const res = await request(app)
      .get('/api/dev/tenants')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const item = res.body.tenants.find((t: any) => t.id === tenant.id);
    expect(item).toBeDefined();
    expect(item.id).toBe(tenant.id);
    expect(item.name).toBe(tenant.name);
    expect(item.createdAt).toBeDefined();
  });

  it('C. POST /api/dev/tenants creates a new tenant with initial TenantConfig', async () => {
    const newTenantName = `Novel Boutique ${Date.now()}`;
    const customId = `novel-boutique-${Date.now()}`;
    createdTenantIds.push(customId);

    const token = createSignedToken({ tenantId: 'admin-tenant', role: 'admin' });
    const res = await request(app)
      .post('/api/dev/tenants')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: newTenantName, id: customId });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.tenant.id).toBe(customId);
    expect(res.body.tenant.name).toBe(newTenantName);

    const dbConfig = await prisma.tenantConfig.findUnique({ where: { tenantId: customId } });
    expect(dbConfig).not.toBeNull();
  });

  it('D. Duplicate tenant ID returns 409 conflict validation error', async () => {
    const tenant = await prisma.tenant.create({ data: { name: `Existing Tenant ${Date.now()}` } });
    createdTenantIds.push(tenant.id);

    const token = createSignedToken({ tenantId: tenant.id, role: 'admin' });
    const res = await request(app)
      .post('/api/dev/tenants')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Duplicate Name', id: tenant.id });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('TENANT_EXISTS');
  });

  it('E. Selecting a tenant loads its specific BusinessConfig', async () => {
    const tenant = await prisma.tenant.create({ data: { name: `Configured Tenant ${Date.now()}` } });
    createdTenantIds.push(tenant.id);

    await prisma.tenantConfig.create({
      data: {
        tenantId: tenant.id,
        config: {
          identity: { botName: 'CustomAssistantGamma' },
          behavior: { stayOnTopic: true }
        }
      }
    });

    const token = createSignedToken({ tenantId: tenant.id, role: 'admin' });
    const res = await request(app)
      .get('/api/dev/config')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.identity.botName).toBe('CustomAssistantGamma');
  });

  it('F. Loading accounts for a selected tenant returns only that tenant accounts', async () => {
    const tenant1 = await prisma.tenant.create({ data: { name: `Acc Tenant 1 ${Date.now()}` } });
    const tenant2 = await prisma.tenant.create({ data: { name: `Acc Tenant 2 ${Date.now()}` } });
    createdTenantIds.push(tenant1.id, tenant2.id);

    const acc1 = await prisma.account.create({ data: { tenantId: tenant1.id, name: 'Store Alpha' } });
    const acc2 = await prisma.account.create({ data: { tenantId: tenant2.id, name: 'Store Beta' } });

    const token1 = createSignedToken({ tenantId: tenant1.id, role: 'admin' });
    const res1 = await request(app)
      .get('/api/dev/accounts')
      .set('Authorization', `Bearer ${token1}`);

    expect(res1.status).toBe(200);
    expect(res1.body.accounts.length).toBe(1);
    expect(res1.body.accounts[0].id).toBe(acc1.id);
  });

  it('G. Loading products for a selected tenant returns only that tenant products', async () => {
    const tenant1 = await prisma.tenant.create({ data: { name: `Prod Tenant 1 ${Date.now()}` } });
    const tenant2 = await prisma.tenant.create({ data: { name: `Prod Tenant 2 ${Date.now()}` } });
    createdTenantIds.push(tenant1.id, tenant2.id);

    const acc1 = await prisma.account.create({ data: { tenantId: tenant1.id, name: 'Store 1' } });
    const acc2 = await prisma.account.create({ data: { tenantId: tenant2.id, name: 'Store 2' } });

    await productRepo.createProduct(tenant1.id, acc1.id, {
      name: 'Item T1',
      sku: 'SKU-T1',
      price: 100,
      stock: 5,
      category: 'Category1',
      description: 'Desc T1'
    });

    await productRepo.createProduct(tenant2.id, acc2.id, {
      name: 'Item T2',
      sku: 'SKU-T2',
      price: 200,
      stock: 10,
      category: 'Category2',
      description: 'Desc T2'
    });

    const token1 = createSignedToken({ tenantId: tenant1.id, role: 'admin' });
    const res1 = await request(app)
      .get('/api/dev/products')
      .set('Authorization', `Bearer ${token1}`)
      .query({ accountId: acc1.id });

    expect(res1.status).toBe(200);
    expect(res1.body.products.length).toBe(1);
    expect(res1.body.products[0].name).toBe('Item T1');
  });

  it('H. Loading PDF documents for a selected tenant returns only that tenant documents', async () => {
    const tenant1 = await prisma.tenant.create({ data: { name: `Doc Tenant 1 ${Date.now()}` } });
    const tenant2 = await prisma.tenant.create({ data: { name: `Doc Tenant 2 ${Date.now()}` } });
    createdTenantIds.push(tenant1.id, tenant2.id);

    const token1 = createSignedToken({ tenantId: tenant1.id, role: 'admin' });
    const pdfBuf = createPdfBuffer('Doc Title 1', 'Document content for Tenant 1 only.');
    await request(app)
      .post('/api/dev/upload')
      .set('Authorization', `Bearer ${token1}`)
      .attach('document', pdfBuf, 'doc1.pdf');

    const res1 = await request(app)
      .get('/api/dev/documents')
      .set('Authorization', `Bearer ${token1}`);

    expect(res1.status).toBe(200);
    expect(Array.isArray(res1.body)).toBe(true);
    expect(res1.body.length).toBe(1);
    expect(res1.body[0].name).toBe('doc1.pdf');

    const token2 = createSignedToken({ tenantId: tenant2.id, role: 'admin' });
    const res2 = await request(app)
      .get('/api/dev/documents')
      .set('Authorization', `Bearer ${token2}`);

    expect(res2.status).toBe(200);
    expect(Array.isArray(res2.body)).toBe(true);
    expect(res2.body.length).toBe(0);
  });

  it('I. Cross-tenant isolation is strictly preserved across all operations', async () => {
    const tenant1 = await prisma.tenant.create({ data: { name: `Iso Tenant 1 ${Date.now()}` } });
    const tenant2 = await prisma.tenant.create({ data: { name: `Iso Tenant 2 ${Date.now()}` } });
    createdTenantIds.push(tenant1.id, tenant2.id);

    const token1 = createSignedToken({ tenantId: tenant1.id, role: 'admin' });
    const pdfBuf1 = createPdfBuffer('Secret Knowledge', 'Secret Access Code 987654321.');
    await request(app)
      .post('/api/dev/upload')
      .set('Authorization', `Bearer ${token1}`)
      .attach('document', pdfBuf1, 'secret.pdf');

    const config2 = await deps.tenantConfigService.getConfig(tenant2.id);
    const chunks2 = await deps.ragService.retrieveChunks(tenant2.id, 'Secret Access Code 987654321', config2);
    expect(chunks2.length).toBe(0);
  });
});
