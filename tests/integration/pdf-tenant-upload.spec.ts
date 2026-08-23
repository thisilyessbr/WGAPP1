import { describe, it, expect, beforeEach, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { prisma, pool } from '../../src/tests/testDb';
import { bootstrapChatbot } from '../../src/bootstrap';
import { DEFAULT_BUSINESS_CONFIG } from '../../src/domain/tenant/BusinessConfig';
import { createDevChatRouter, createSignedToken } from '../../src/dev/chatApi';

describe('Phase 17: PDF Tenant Upload Fix Integration Tests', () => {
  let deps: ReturnType<typeof bootstrapChatbot>;
  let app: express.Application;
  const createdTenantIds: string[] = [];

  const samplePdfContent = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj
4 0 obj << /Length 55 >> stream
BT /F1 24 Tf 100 700 Td (Atlas Knowledge Test Document Alpha) Tj ET
endstream endobj
5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
xref
0 6
0000000000 65535 f 
0000000010 00000 n 
0000000060 00000 n 
0000000117 00000 n 
0000000234 00000 n 
0000000340 00000 n 
trailer << /Size 6 /Root 1 0 R >>
startxref
420
%%EOF`;

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
        await prisma.account.deleteMany({ where: { tenantId } });
        await prisma.tenantConfig.deleteMany({ where: { tenantId } });
        await prisma.tenant.delete({ where: { id: tenantId } });
      } catch (err) {}
    }
    createdTenantIds.length = 0;
  });

  it('A. Active tenant + upload via query param & header -> successful upload', async () => {
    const tenantId = `TENANT-PDF-TEST-A-${Date.now()}`;
    await prisma.tenant.create({
      data: {
        id: tenantId,
        name: 'Tenant PDF Test A',
        config: { create: { config: DEFAULT_BUSINESS_CONFIG } }
      }
    });
    createdTenantIds.push(tenantId);

    const token = createSignedToken({ tenantId });

    // Upload with tenantId in query params and X-Tenant-Id header
    const res = await request(app)
      .post(`/api/dev/upload?tenantId=${encodeURIComponent(tenantId)}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-Id', tenantId)
      .attach('document', Buffer.from(samplePdfContent, 'utf-8'), 'knowledge.pdf')
      .field('tenantId', tenantId);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.sourceId).toBeDefined();

    // Verify document exists in database under target tenant
    const source = await prisma.knowledgeSource.findUnique({
      where: { id: res.body.sourceId }
    });
    expect(source).not.toBeNull();
    expect(source?.tenantId).toBe(tenantId);
    expect(source?.status).toBe('COMPLETED');

    // Verify GET /api/dev/documents returns the document
    const listRes = await request(app)
      .get(`/api/dev/documents?tenantId=${encodeURIComponent(tenantId)}`)
      .set('Authorization', `Bearer ${token}`);

    expect(listRes.status).toBe(200);
    expect(listRes.body.length).toBe(1);
    expect(listRes.body[0].name).toBe('knowledge.pdf');
  });

  it('B. Authenticated tenant A requesting upload for tenant B -> rejected with 403 FORBIDDEN', async () => {
    const tenantA = `TENANT-A-${Date.now()}`;
    const tenantB = `TENANT-B-${Date.now()}`;
    await prisma.tenant.create({
      data: { id: tenantA, name: 'Tenant A', config: { create: { config: DEFAULT_BUSINESS_CONFIG } } }
    });
    await prisma.tenant.create({
      data: { id: tenantB, name: 'Tenant B', config: { create: { config: DEFAULT_BUSINESS_CONFIG } } }
    });
    createdTenantIds.push(tenantA, tenantB);

    const tokenA = createSignedToken({ tenantId: tenantA });

    // Client authenticates as Tenant A but supplies Tenant B in query/header
    const res = await request(app)
      .post(`/api/dev/upload?tenantId=${encodeURIComponent(tenantB)}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .set('X-Tenant-Id', tenantB)
      .attach('document', Buffer.from(samplePdfContent, 'utf-8'), 'forbidden.pdf');

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('FORBIDDEN');
    expect(res.body.message).toContain('Tenant authorization mismatch');

    // Verify no sources were created in Tenant B
    const sourcesB = await prisma.knowledgeSource.count({ where: { tenantId: tenantB } });
    expect(sourcesB).toBe(0);
  });

  it('C. Missing or invalid authentication token -> rejected with 401 UNAUTHORIZED', async () => {
    const tenantId = `TENANT-UNAUTH-${Date.now()}`;
    await prisma.tenant.create({
      data: { id: tenantId, name: 'Tenant Unauth', config: { create: { config: DEFAULT_BUSINESS_CONFIG } } }
    });
    createdTenantIds.push(tenantId);

    const res = await request(app)
      .post(`/api/dev/upload?tenantId=${encodeURIComponent(tenantId)}`)
      .set('Authorization', 'Bearer invalid-forged-token')
      .attach('document', Buffer.from(samplePdfContent, 'utf-8'), 'unauth.pdf');

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('UNAUTHORIZED');
  });

  it('D. Duplicate PDF upload -> idempotent, returns existing source ID with 0 extra DB rows', async () => {
    const tenantId = `TENANT-IDEMPOTENT-${Date.now()}`;
    await prisma.tenant.create({
      data: { id: tenantId, name: 'Tenant Idempotent', config: { create: { config: DEFAULT_BUSINESS_CONFIG } } }
    });
    createdTenantIds.push(tenantId);

    const token = createSignedToken({ tenantId });

    // First upload
    const res1 = await request(app)
      .post(`/api/dev/upload?tenantId=${encodeURIComponent(tenantId)}`)
      .set('Authorization', `Bearer ${token}`)
      .attach('document', Buffer.from(samplePdfContent, 'utf-8'), 'file-v1.pdf');

    expect(res1.status).toBe(200);
    const sourceId1 = res1.body.sourceId;

    const sourceCount1 = await prisma.knowledgeSource.count({ where: { tenantId } });
    const chunkCount1 = await prisma.knowledgeChunk.count({ where: { tenantId } });

    // Second upload of exact same bytes
    const res2 = await request(app)
      .post(`/api/dev/upload?tenantId=${encodeURIComponent(tenantId)}`)
      .set('Authorization', `Bearer ${token}`)
      .attach('document', Buffer.from(samplePdfContent, 'utf-8'), 'file-v2-renamed.pdf');

    expect(res2.status).toBe(200);
    expect(res2.body.sourceId).toBe(sourceId1); // Reuses existing source

    const sourceCount2 = await prisma.knowledgeSource.count({ where: { tenantId } });
    const chunkCount2 = await prisma.knowledgeChunk.count({ where: { tenantId } });

    expect(sourceCount2).toBe(sourceCount1); // Zero additional rows
    expect(chunkCount2).toBe(chunkCount1); // Zero additional chunk rows
  });

  it('E. Existing RAG retrieval remains functional and accurate', async () => {
    const tenantId = `TENANT-RAG-CHECK-${Date.now()}`;
    await prisma.tenant.create({
      data: { id: tenantId, name: 'Tenant RAG', config: { create: { config: DEFAULT_BUSINESS_CONFIG } } }
    });
    createdTenantIds.push(tenantId);

    const token = createSignedToken({ tenantId });

    // Upload knowledge doc
    await request(app)
      .post(`/api/dev/upload?tenantId=${encodeURIComponent(tenantId)}`)
      .set('Authorization', `Bearer ${token}`)
      .attach('document', Buffer.from(samplePdfContent, 'utf-8'), 'rag-doc.pdf');

    // Retrieve chunks using RAGService
    const result = await deps.ragService.retrieve(tenantId, 'Atlas Knowledge Document', DEFAULT_BUSINESS_CONFIG);
    expect(result.chunks.length).toBeGreaterThan(0);
    expect(result.context).toContain('Atlas Knowledge Test Document Alpha');
  });
});
