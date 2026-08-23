import { describe, it, expect, beforeEach, beforeAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { prisma, pool } from '../../src/tests/testDb';
import { bootstrapChatbot } from '../../src/bootstrap';
import { DEFAULT_BUSINESS_CONFIG } from '../../src/domain/tenant/BusinessConfig';
import { createDevChatRouter, createSignedToken } from '../../src/dev/chatApi';

describe('Phase 18: Account / Store Scoped Knowledge + PDF Frontend Tests', () => {
  let deps: ReturnType<typeof bootstrapChatbot>;
  let app: express.Application;
  const createdTenantIds: string[] = [];

  const samplePdfA = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj
4 0 obj << /Length 58 >> stream
BT /F1 24 Tf 100 700 Td (AnimeVerse Store Manga & Merch Return Policy Alpha) Tj ET
endstream endobj
5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
xref
0 6
0000000000 65535 f 
0000000010 00000 n 
0000000060 00000 n 
0000000117 00000 n 
0000000234 00000 n 
0000000343 00000 n 
trailer << /Size 6 /Root 1 0 R >>
startxref
423
%%EOF`;

  const samplePdfB = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj
4 0 obj << /Length 55 >> stream
BT /F1 24 Tf 100 700 Td (TechGadgets Store Hardware Warranty Beta) Tj ET
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

  const globalPdf = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj
4 0 obj << /Length 53 >> stream
BT /F1 24 Tf 100 700 Td (Atlas Global Enterprise Company Terms) Tj ET
endstream endobj
5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
xref
0 6
0000000000 65535 f 
0000000010 00000 n 
0000000060 00000 n 
0000000117 00000 n 
0000000234 00000 n 
0000000338 00000 n 
trailer << /Size 6 /Root 1 0 R >>
startxref
418
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

  async function createTestEnv() {
    const tenantId = `TENANT-P18-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    await prisma.tenant.create({
      data: {
        id: tenantId,
        name: 'Tenant P18 Main',
        config: { create: { config: DEFAULT_BUSINESS_CONFIG } }
      }
    });
    createdTenantIds.push(tenantId);

    const accountA = await prisma.account.create({
      data: {
        id: `ACC-ANIMEVERSE-${Date.now()}`,
        tenantId,
        name: 'AnimeVerse Store',
        enabled: true
      }
    });

    const accountB = await prisma.account.create({
      data: {
        id: `ACC-TECHGADGET-${Date.now()}`,
        tenantId,
        name: 'TechGadgets Store',
        enabled: true
      }
    });

    const token = createSignedToken({ tenantId });

    return { tenantId, accountA, accountB, token };
  }

  it('1. Account-scoped upload stores accountId across KnowledgeSource, Document, and Chunk', async () => {
    const { tenantId, accountA, token } = await createTestEnv();

    const res = await request(app)
      .post(`/api/dev/upload?tenantId=${tenantId}&accountId=${accountA.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-Id', tenantId)
      .set('X-Account-Id', accountA.id)
      .attach('document', Buffer.from(samplePdfA, 'utf-8'), 'anime-policy.pdf');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.accountId).toBe(accountA.id);
    expect(res.body.isReused).toBe(false);

    const source = await prisma.knowledgeSource.findUnique({ where: { id: res.body.sourceId } });
    expect(source?.accountId).toBe(accountA.id);

    const doc = await prisma.knowledgeDocument.findFirst({ where: { sourceId: res.body.sourceId } });
    expect(doc?.accountId).toBe(accountA.id);

    const chunks = await prisma.knowledgeChunk.findMany({ where: { documentId: doc!.id } });
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.accountId).toBe(accountA.id);
    }
  });

  it('2. Same Account duplicate upload reuses existing source with 0 new embeddings and 0 new rows', async () => {
    const { tenantId, accountA, token } = await createTestEnv();

    const provider = (deps.pdfIngestionService as any).embeddingProvider;
    const embedSpy = vi.spyOn(provider, 'embedText');

    // First upload
    const res1 = await request(app)
      .post(`/api/dev/upload?tenantId=${tenantId}&accountId=${accountA.id}`)
      .set('Authorization', `Bearer ${token}`)
      .attach('document', Buffer.from(samplePdfA, 'utf-8'), 'anime.pdf');

    expect(res1.status).toBe(200);
    expect(res1.body.isReused).toBe(false);
    const initialEmbedCalls = embedSpy.mock.calls.length;
    expect(initialEmbedCalls).toBeGreaterThan(0);

    const initialSourceCount = await prisma.knowledgeSource.count({ where: { tenantId } });
    const initialChunkCount = await prisma.knowledgeChunk.count({ where: { tenantId } });

    // Second upload of exact same bytes for same account
    const res2 = await request(app)
      .post(`/api/dev/upload?tenantId=${tenantId}&accountId=${accountA.id}`)
      .set('Authorization', `Bearer ${token}`)
      .attach('document', Buffer.from(samplePdfA, 'utf-8'), 'anime.pdf');

    expect(res2.status).toBe(200);
    expect(res2.body.sourceId).toBe(res1.body.sourceId);
    expect(res2.body.isReused).toBe(true);

    // Verify 0 additional embedding calls
    expect(embedSpy.mock.calls.length).toBe(initialEmbedCalls);

    // Verify 0 additional database rows
    const secondSourceCount = await prisma.knowledgeSource.count({ where: { tenantId } });
    const secondChunkCount = await prisma.knowledgeChunk.count({ where: { tenantId } });
    expect(secondSourceCount).toBe(initialSourceCount);
    expect(secondChunkCount).toBe(initialChunkCount);
  });

  it('3. Same bytes with different filename on same Account reuses existing source', async () => {
    const { tenantId, accountA, token } = await createTestEnv();

    const res1 = await request(app)
      .post(`/api/dev/upload?tenantId=${tenantId}&accountId=${accountA.id}`)
      .set('Authorization', `Bearer ${token}`)
      .attach('document', Buffer.from(samplePdfA, 'utf-8'), 'original-name.pdf');

    const res2 = await request(app)
      .post(`/api/dev/upload?tenantId=${tenantId}&accountId=${accountA.id}`)
      .set('Authorization', `Bearer ${token}`)
      .attach('document', Buffer.from(samplePdfA, 'utf-8'), 'renamed-copy.pdf');

    expect(res2.status).toBe(200);
    expect(res2.body.sourceId).toBe(res1.body.sourceId);
    expect(res2.body.isReused).toBe(true);
  });

  it('4. Modified file creates new ingestion with fresh embeddings', async () => {
    const { tenantId, accountA, token } = await createTestEnv();

    const res1 = await request(app)
      .post(`/api/dev/upload?tenantId=${tenantId}&accountId=${accountA.id}`)
      .set('Authorization', `Bearer ${token}`)
      .attach('document', Buffer.from(samplePdfA, 'utf-8'), 'doc.pdf');

    const res2 = await request(app)
      .post(`/api/dev/upload?tenantId=${tenantId}&accountId=${accountA.id}`)
      .set('Authorization', `Bearer ${token}`)
      .attach('document', Buffer.from(samplePdfB, 'utf-8'), 'doc.pdf');

    expect(res2.status).toBe(200);
    expect(res2.body.sourceId).not.toBe(res1.body.sourceId);
    expect(res2.body.isReused).toBe(false);

    const sourceCount = await prisma.knowledgeSource.count({ where: { tenantId } });
    expect(sourceCount).toBe(2);
  });

  it('5. Global upload (explicit or omitted accountId) creates tenant-global knowledge (accountId = null)', async () => {
    const { tenantId, token } = await createTestEnv();

    const res = await request(app)
      .post(`/api/dev/upload?tenantId=${tenantId}`)
      .set('Authorization', `Bearer ${token}`)
      .attach('document', Buffer.from(globalPdf, 'utf-8'), 'global.pdf');

    expect(res.status).toBe(200);
    expect(res.body.accountId).toBeNull();

    const source = await prisma.knowledgeSource.findUnique({ where: { id: res.body.sourceId } });
    expect(source?.accountId).toBeNull();

    const doc = await prisma.knowledgeDocument.findFirst({ where: { sourceId: res.body.sourceId } });
    expect(doc?.accountId).toBeNull();

    const chunks = await prisma.knowledgeChunk.findMany({ where: { documentId: doc!.id } });
    for (const chunk of chunks) {
      expect(chunk.accountId).toBeNull();
    }
  });

  it('6. Same bytes uploaded to Account vs Global creates separate scoped ingestions', async () => {
    const { tenantId, accountA, token } = await createTestEnv();

    // Upload as Global
    const resGlobal = await request(app)
      .post(`/api/dev/upload?tenantId=${tenantId}&accountId=global`)
      .set('Authorization', `Bearer ${token}`)
      .attach('document', Buffer.from(samplePdfA, 'utf-8'), 'shared.pdf');

    // Upload as Account A
    const resAccount = await request(app)
      .post(`/api/dev/upload?tenantId=${tenantId}&accountId=${accountA.id}`)
      .set('Authorization', `Bearer ${token}`)
      .attach('document', Buffer.from(samplePdfA, 'utf-8'), 'shared.pdf');

    expect(resGlobal.status).toBe(200);
    expect(resAccount.status).toBe(200);
    expect(resGlobal.body.sourceId).not.toBe(resAccount.body.sourceId);
    expect(resGlobal.body.accountId).toBeNull();
    expect(resAccount.body.accountId).toBe(accountA.id);
  });

  it('7. Account A vs Account B isolation: Same bytes to Account A and Account B creates separate scopes', async () => {
    const { tenantId, accountA, accountB, token } = await createTestEnv();

    const resA = await request(app)
      .post(`/api/dev/upload?tenantId=${tenantId}&accountId=${accountA.id}`)
      .set('Authorization', `Bearer ${token}`)
      .attach('document', Buffer.from(samplePdfA, 'utf-8'), 'policy.pdf');

    const resB = await request(app)
      .post(`/api/dev/upload?tenantId=${tenantId}&accountId=${accountB.id}`)
      .set('Authorization', `Bearer ${token}`)
      .attach('document', Buffer.from(samplePdfA, 'utf-8'), 'policy.pdf');

    expect(resA.body.sourceId).not.toBe(resB.body.sourceId);
    expect(resA.body.accountId).toBe(accountA.id);
    expect(resB.body.accountId).toBe(accountB.id);
  });

  it('8. Invalid account is rejected with 404 ACCOUNT_NOT_FOUND', async () => {
    const { tenantId, token } = await createTestEnv();

    const res = await request(app)
      .post(`/api/dev/upload?tenantId=${tenantId}&accountId=NON-EXISTENT-ACCOUNT`)
      .set('Authorization', `Bearer ${token}`)
      .attach('document', Buffer.from(samplePdfA, 'utf-8'), 'test.pdf');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('ACCOUNT_NOT_FOUND');
    expect(res.body.message).toContain('Account not found or access denied');
  });

  it('9. Document list filtering: Global scope returns only global; Account scope returns Global + Account', async () => {
    const { tenantId, accountA, accountB, token } = await createTestEnv();

    // 1 Global doc
    await request(app)
      .post(`/api/dev/upload?tenantId=${tenantId}`)
      .set('Authorization', `Bearer ${token}`)
      .attach('document', Buffer.from(globalPdf, 'utf-8'), 'global.pdf');

    // 1 Account A doc
    await request(app)
      .post(`/api/dev/upload?tenantId=${tenantId}&accountId=${accountA.id}`)
      .set('Authorization', `Bearer ${token}`)
      .attach('document', Buffer.from(samplePdfA, 'utf-8'), 'anime.pdf');

    // 1 Account B doc
    await request(app)
      .post(`/api/dev/upload?tenantId=${tenantId}&accountId=${accountB.id}`)
      .set('Authorization', `Bearer ${token}`)
      .attach('document', Buffer.from(samplePdfB, 'utf-8'), 'tech.pdf');

    // Query Global Scope
    const listGlobal = await request(app)
      .get(`/api/dev/documents?tenantId=${tenantId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(listGlobal.status).toBe(200);
    expect(listGlobal.body.length).toBe(1);
    expect(listGlobal.body[0].name).toBe('global.pdf');
    expect(listGlobal.body[0].scope).toBe('global');

    // Query Account A Scope -> should see Global + Account A (2 docs), NOT Account B
    const listA = await request(app)
      .get(`/api/dev/documents?tenantId=${tenantId}&accountId=${accountA.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(listA.status).toBe(200);
    expect(listA.body.length).toBe(2);
    const namesA = listA.body.map((d: any) => d.name);
    expect(namesA).toContain('global.pdf');
    expect(namesA).toContain('anime.pdf');
    expect(namesA).not.toContain('tech.pdf');

    // Query Account B Scope -> should see Global + Account B (2 docs), NOT Account A
    const listB = await request(app)
      .get(`/api/dev/documents?tenantId=${tenantId}&accountId=${accountB.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(listB.status).toBe(200);
    expect(listB.body.length).toBe(2);
    const namesB = listB.body.map((d: any) => d.name);
    expect(namesB).toContain('global.pdf');
    expect(namesB).toContain('tech.pdf');
    expect(namesB).not.toContain('anime.pdf');
  });

  it('10. Delete own document succeeds and removes source, document, and chunks', async () => {
    const { tenantId, accountA, token } = await createTestEnv();

    const uploadRes = await request(app)
      .post(`/api/dev/upload?tenantId=${tenantId}&accountId=${accountA.id}`)
      .set('Authorization', `Bearer ${token}`)
      .attach('document', Buffer.from(samplePdfA, 'utf-8'), 'anime.pdf');

    const sourceId = uploadRes.body.sourceId;

    const delRes = await request(app)
      .delete(`/api/dev/documents/${sourceId}?tenantId=${tenantId}&accountId=${accountA.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(delRes.status).toBe(200);
    expect(delRes.body.success).toBe(true);

    const source = await prisma.knowledgeSource.findUnique({ where: { id: sourceId } });
    expect(source).toBeNull();
  });

  it('11. Reject delete of another account document with 403 FORBIDDEN', async () => {
    const { tenantId, accountA, accountB } = await createTestEnv();

    // Upload to Account A
    const tokenA = createSignedToken({ tenantId, role: 'user', accountId: accountA.id });
    const uploadRes = await request(app)
      .post(`/api/dev/upload?tenantId=${tenantId}&accountId=${accountA.id}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .attach('document', Buffer.from(samplePdfA, 'utf-8'), 'anime.pdf');

    const sourceId = uploadRes.body.sourceId;

    // Caller from Account B tries to delete Account A document
    const tokenB = createSignedToken({ tenantId, role: 'user', accountId: accountB.id });
    const delRes = await request(app)
      .delete(`/api/dev/documents/${sourceId}?tenantId=${tenantId}&accountId=${accountB.id}`)
      .set('Authorization', `Bearer ${tokenB}`);

    expect(delRes.status).toBe(403);
    expect(delRes.body.error).toBe('FORBIDDEN');
    expect(delRes.body.message).toContain('Cannot delete a document belonging to another account');

    // Verify document was NOT deleted
    const source = await prisma.knowledgeSource.findUnique({ where: { id: sourceId } });
    expect(source).not.toBeNull();
  });

  it('12. RAG Retrieval respects account scoping: Account A retrieves Global + Account A, strictly excluding Account B', async () => {
    const { tenantId, accountA, accountB, token } = await createTestEnv();

    // Upload Global doc
    await request(app)
      .post(`/api/dev/upload?tenantId=${tenantId}`)
      .set('Authorization', `Bearer ${token}`)
      .attach('document', Buffer.from(globalPdf, 'utf-8'), 'global.pdf');

    // Upload Account A doc
    await request(app)
      .post(`/api/dev/upload?tenantId=${tenantId}&accountId=${accountA.id}`)
      .set('Authorization', `Bearer ${token}`)
      .attach('document', Buffer.from(samplePdfA, 'utf-8'), 'anime.pdf');

    // Upload Account B doc
    await request(app)
      .post(`/api/dev/upload?tenantId=${tenantId}&accountId=${accountB.id}`)
      .set('Authorization', `Bearer ${token}`)
      .attach('document', Buffer.from(samplePdfB, 'utf-8'), 'tech.pdf');

    // Query RAG as Account A
    const ragA = await deps.ragService.retrieve(tenantId, 'warranty return policy terms', DEFAULT_BUSINESS_CONFIG, accountA.id);
    expect(ragA.context).toContain('AnimeVerse Store Manga & Merch Return Policy');
    expect(ragA.context).toContain('Atlas Global Enterprise Company Terms');
    expect(ragA.context).not.toContain('TechGadgets Store Hardware Warranty');

    // Query RAG as Account B
    const ragB = await deps.ragService.retrieve(tenantId, 'warranty return policy terms', DEFAULT_BUSINESS_CONFIG, accountB.id);
    expect(ragB.context).toContain('TechGadgets Store Hardware Warranty');
    expect(ragB.context).toContain('Atlas Global Enterprise Company Terms');
    expect(ragB.context).not.toContain('AnimeVerse Store Manga & Merch Return Policy');

    // Query RAG as Global (null accountId)
    const ragGlobal = await deps.ragService.retrieve(tenantId, 'warranty return policy terms', DEFAULT_BUSINESS_CONFIG, null);
    expect(ragGlobal.context).toContain('Atlas Global Enterprise Company Terms');
    expect(ragGlobal.context).not.toContain('AnimeVerse Store Manga & Merch Return Policy');
    expect(ragGlobal.context).not.toContain('TechGadgets Store Hardware Warranty');
  });
});
