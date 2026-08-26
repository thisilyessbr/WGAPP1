import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, pool } from '../../src/tests/testDb';
import { bootstrapChatbot } from '../../src/bootstrap';
import { TenantConfigService } from '../../src/domain/tenant/TenantConfigService';
import { DEFAULT_BUSINESS_CONFIG, BusinessConfig } from '../../src/domain/tenant/BusinessConfig';
import { createDevChatRouter, createSignedToken } from '../../src/dev/chatApi';
import express from 'express';
import request from 'supertest';

// Helper for generating dynamic valid PDF buffers
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

describe('Phase 49B: Safe Tenant Config Fallback Unit & API Tests', () => {
  let deps: ReturnType<typeof bootstrapChatbot>;
  let configService: TenantConfigService;
  let app: express.Application;
  const createdTenantIds: string[] = [];

  beforeAll(async () => {
    const client = await pool.connect();
    try {
      await client.query('SET search_path TO test, public, extensions;');
    } finally {
      client.release();
    }

    deps = bootstrapChatbot(prisma);
    configService = deps.tenantConfigService;

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
        await prisma.account.deleteMany({ where: { tenantId: tId } });
        await prisma.tenantConfig.deleteMany({ where: { tenantId: tId } });
        await prisma.tenant.deleteMany({ where: { id: tId } });
      } catch (e) {
        // ignore
      }
    }
  });

  it('A. getConfig with existing TenantConfig returns unchanged custom config', async () => {
    const tenant = await prisma.tenant.create({ data: { name: `Existing Config Tenant ${Date.now()}` } });
    createdTenantIds.push(tenant.id);

    await prisma.tenantConfig.create({
      data: {
        tenantId: tenant.id,
        config: {
          identity: { botName: 'CustomBotAlpha' },
          behavior: { stayOnTopic: false }
        }
      }
    });

    const config = await configService.getConfig(tenant.id);
    expect(config.identity.botName).toBe('CustomBotAlpha');
    expect(config.behavior.stayOnTopic).toBe(false);
  });

  it('B. getConfig with missing TenantConfig returns DEFAULT_BUSINESS_CONFIG fallback', async () => {
    const tenant = await prisma.tenant.create({ data: { name: `Missing Config Tenant ${Date.now()}` } });
    createdTenantIds.push(tenant.id);

    const config = await configService.getConfig(tenant.id);
    expect(config).toBeDefined();
    expect(config.identity.botName).toBe(DEFAULT_BUSINESS_CONFIG.identity.botName);
    expect(config.knowledge.topK).toBe(DEFAULT_BUSINESS_CONFIG.knowledge.topK);
    expect(config.knowledge.ingestion.maxFileSizeMb).toBe(DEFAULT_BUSINESS_CONFIG.knowledge.ingestion.maxFileSizeMb);
  });

  it('C. returned fallback is deep-cloned and mutating it does not corrupt global defaults', async () => {
    const tenant = await prisma.tenant.create({ data: { name: `Clone Test Tenant ${Date.now()}` } });
    createdTenantIds.push(tenant.id);

    const config = await configService.getConfig(tenant.id);
    config.identity.botName = 'MutatedBotName';
    config.knowledge.topK = 999;

    expect(DEFAULT_BUSINESS_CONFIG.identity.botName).not.toBe('MutatedBotName');
    expect(DEFAULT_BUSINESS_CONFIG.knowledge.topK).not.toBe(999);

    const freshConfig = await configService.getConfig(tenant.id);
    expect(freshConfig.identity.botName).toBe(DEFAULT_BUSINESS_CONFIG.identity.botName);
    expect(freshConfig.knowledge.topK).toBe(DEFAULT_BUSINESS_CONFIG.knowledge.topK);
  });

  it('D. PDF upload with missing TenantConfig succeeds without crashing', async () => {
    const tenant = await prisma.tenant.create({ data: { name: `Upload Missing Config Tenant ${Date.now()}` } });
    createdTenantIds.push(tenant.id);
    const token = createSignedToken({ tenantId: tenant.id, role: 'admin' });

    const pdfBuffer = createPdfBuffer('Fallback Ingestion Guide', 'Fallback Ingestion Guide: Policy details for unconfigured tenant.');
    const res = await request(app)
      .post('/api/dev/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('document', pdfBuffer, 'fallback-guide.pdf');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.sourceId).toBeTruthy();
  });

  it('E. Global PDF scope remains accountId=null when uploaded without accountId', async () => {
    const tenant = await prisma.tenant.create({ data: { name: `Global Scope Tenant ${Date.now()}` } });
    createdTenantIds.push(tenant.id);
    const token = createSignedToken({ tenantId: tenant.id, role: 'admin' });

    const pdfBuffer = createPdfBuffer('Global Policy', 'Global Policy: Applicable across the entire tenant.');
    const res = await request(app)
      .post('/api/dev/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('document', pdfBuffer, 'global-policy.pdf');

    expect(res.status).toBe(200);
    expect(res.body.accountId).toBeNull();

    const source = await prisma.knowledgeSource.findUnique({ where: { id: res.body.sourceId } });
    expect(source?.accountId).toBeNull();
  });

  it('F. Account-scoped PDF upload remains scoped correctly with missing TenantConfig', async () => {
    const tenant = await prisma.tenant.create({ data: { name: `Account Scope Tenant ${Date.now()}` } });
    createdTenantIds.push(tenant.id);

    const account = await prisma.account.create({
      data: { tenantId: tenant.id, name: 'Private Store Alpha' }
    });

    const token = createSignedToken({ tenantId: tenant.id, role: 'admin' });
    const pdfBuffer = createPdfBuffer('Private Policy', 'Private Policy: Only for Private Store Alpha.');
    const res = await request(app)
      .post('/api/dev/upload')
      .set('Authorization', `Bearer ${token}`)
      .set('x-account-id', account.id)
      .attach('document', pdfBuffer, 'private-policy.pdf');

    expect(res.status).toBe(200);
    expect(res.body.accountId).toBe(account.id);

    const source = await prisma.knowledgeSource.findUnique({ where: { id: res.body.sourceId } });
    expect(source?.accountId).toBe(account.id);
  });

  it('G. RAG retrieval returns the uploaded knowledge for tenant without TenantConfig', async () => {
    const tenant = await prisma.tenant.create({ data: { name: `RAG Retrieval Tenant ${Date.now()}` } });
    createdTenantIds.push(tenant.id);
    const token = createSignedToken({ tenantId: tenant.id, role: 'admin' });

    const pdfBuffer = createPdfBuffer('Pricing FAQ', 'Pricing Policy: Standard fee is 450 MAD per session.');
    await request(app)
      .post('/api/dev/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('document', pdfBuffer, 'pricing.pdf');

    const config = await configService.getConfig(tenant.id);
    const chunks = await deps.ragService.retrieveChunks(tenant.id, 'Standard fee', config);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].content).toContain('450 MAD');
  });

  it('H. Tenant with existing config remains unchanged and isolates custom overrides', async () => {
    const tenant = await prisma.tenant.create({ data: { name: `Isolated Override Tenant ${Date.now()}` } });
    createdTenantIds.push(tenant.id);

    await prisma.tenantConfig.create({
      data: {
        tenantId: tenant.id,
        config: {
          identity: { botName: 'SpecializedAssistant' },
          knowledge: { topK: 7 }
        }
      }
    });

    const config = await configService.getConfig(tenant.id);
    expect(config.identity.botName).toBe('SpecializedAssistant');
    expect(config.knowledge.topK).toBe(7);
  });

  it('I. Cross-tenant isolation remains strictly enforced during RAG retrieval', async () => {
    const tenant1 = await prisma.tenant.create({ data: { name: `Isolation Tenant 1 ${Date.now()}` } });
    const tenant2 = await prisma.tenant.create({ data: { name: `Isolation Tenant 2 ${Date.now()}` } });
    createdTenantIds.push(tenant1.id, tenant2.id);

    const token1 = createSignedToken({ tenantId: tenant1.id, role: 'admin' });
    const pdfBuffer1 = createPdfBuffer('Secret Doc', 'Secret Information Alpha 123456');
    await request(app)
      .post('/api/dev/upload')
      .set('Authorization', `Bearer ${token1}`)
      .attach('document', pdfBuffer1, 'secret.pdf');

    const config2 = await configService.getConfig(tenant2.id);
    const chunksTenant2 = await deps.ragService.retrieveChunks(tenant2.id, 'Secret Information Alpha 123456', config2);
    expect(chunksTenant2.length).toBe(0);
  });
});
