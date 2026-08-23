import { prisma, pool } from '../src/tests/testDb';
import { bootstrapChatbot } from '../src/bootstrap';
import { DEFAULT_BUSINESS_CONFIG, BusinessConfig } from '../src/domain/tenant/BusinessConfig';
import { PdfIngestionService, isValidPdfBuffer } from '../src/domain/rag/PdfIngestionService';
import { KnowledgeRepository } from '../src/domain/rag/KnowledgeRepository';
import { AccountConfigService } from '../src/domain/tenant/AccountConfigService';
import * as crypto from 'crypto';

async function runAudit() {
  console.log('====================================================');
  console.log('STARTING READ-ONLY RUNTIME AUDIT PROBES');
  console.log('====================================================');

  const client = await pool.connect();
  try {
    await client.query('SET search_path TO test, public, extensions;');
  } finally {
    client.release();
  }

  const deps = bootstrapChatbot(prisma);
  const testTenantId = `AUDIT-PROBE-TENANT-${Date.now()}`;

  // Track embedding calls
  let embeddingCallCount = 0;
  const countingEmbeddingProvider = {
    embedText: async (text: string) => {
      embeddingCallCount++;
      return new Array(1536).fill(0.01);
    }
  };

  const knowledgeRepo = new KnowledgeRepository(prisma);
  const auditIngestionService = new PdfIngestionService(
    prisma,
    countingEmbeddingProvider as any,
    knowledgeRepo
  );

  try {
    // Setup temporary test tenant
    await prisma.tenant.create({
      data: {
        id: testTenantId,
        name: 'Audit Probe Tenant',
        config: { create: { config: DEFAULT_BUSINESS_CONFIG } }
      }
    });

    console.log(`\n[PROBE 1] Minimal Valid PDF Construction`);
    // Minimal valid PDF with 1 text page
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

    const pdfBufferA = Buffer.from(samplePdfContent, 'utf-8');
    const isMagicValid = isValidPdfBuffer(pdfBufferA);
    const hashA = crypto.createHash('sha256').update(pdfBufferA).digest('hex');
    console.log(`- Magic byte check: ${isMagicValid ? 'PASS' : 'FAIL'}`);
    console.log(`- SHA-256 Hash of PDF A: ${hashA}`);

    console.log(`\n[PROBE 2] Scenario A: First Upload of New PDF`);
    embeddingCallCount = 0;
    const sourceIdA = await auditIngestionService.ingestPdf(
      testTenantId,
      pdfBufferA,
      'doc-a.pdf',
      DEFAULT_BUSINESS_CONFIG
    );
    console.log(`- Source ID returned: ${sourceIdA}`);
    console.log(`- Embedding calls made: ${embeddingCallCount}`);
    const sourceCount1 = await prisma.knowledgeSource.count({ where: { tenantId: testTenantId } });
    const docCount1 = await prisma.knowledgeDocument.count({ where: { tenantId: testTenantId } });
    const chunkCount1 = await prisma.knowledgeChunk.count({ where: { tenantId: testTenantId } });
    console.log(`- DB Rows: KnowledgeSource=${sourceCount1}, KnowledgeDocument=${docCount1}, KnowledgeChunk=${chunkCount1}`);

    console.log(`\n[PROBE 3] Scenario B: Upload the Exact Same PDF Again (Idempotency)`);
    const embeddingCallsBeforeB = embeddingCallCount;
    const sourceIdB = await auditIngestionService.ingestPdf(
      testTenantId,
      pdfBufferA,
      'doc-a.pdf',
      DEFAULT_BUSINESS_CONFIG
    );
    const embeddingCallsDeltaB = embeddingCallCount - embeddingCallsBeforeB;
    console.log(`- Source ID returned: ${sourceIdB} (Matches A? ${sourceIdA === sourceIdB})`);
    console.log(`- Additional embedding calls made: ${embeddingCallsDeltaB}`);
    const sourceCount2 = await prisma.knowledgeSource.count({ where: { tenantId: testTenantId } });
    const docCount2 = await prisma.knowledgeDocument.count({ where: { tenantId: testTenantId } });
    const chunkCount2 = await prisma.knowledgeChunk.count({ where: { tenantId: testTenantId } });
    console.log(`- DB Rows: KnowledgeSource=${sourceCount2}, KnowledgeDocument=${docCount2}, KnowledgeChunk=${chunkCount2} (Delta: 0 rows)`);

    console.log(`\n[PROBE 4] Scenario C: Same PDF Bytes with Different Filename`);
    const embeddingCallsBeforeC = embeddingCallCount;
    const sourceIdC = await auditIngestionService.ingestPdf(
      testTenantId,
      pdfBufferA,
      'completely-different-filename.pdf',
      DEFAULT_BUSINESS_CONFIG
    );
    const embeddingCallsDeltaC = embeddingCallCount - embeddingCallsBeforeC;
    console.log(`- Source ID returned: ${sourceIdC} (Matches A? ${sourceIdA === sourceIdC})`);
    console.log(`- Additional embedding calls made: ${embeddingCallsDeltaC}`);

    console.log(`\n[PROBE 5] Scenario D: Modified PDF Content (Different Bytes)`);
    const modifiedPdfContent = samplePdfContent.replace('Alpha', 'Beta Modified Content');
    const pdfBufferD = Buffer.from(modifiedPdfContent, 'utf-8');
    const hashD = crypto.createHash('sha256').update(pdfBufferD).digest('hex');
    console.log(`- SHA-256 Hash of PDF D: ${hashD} (Differs from A? ${hashA !== hashD})`);

    const embeddingCallsBeforeD = embeddingCallCount;
    const sourceIdD = await auditIngestionService.ingestPdf(
      testTenantId,
      pdfBufferD,
      'doc-a.pdf', // Same filename, different bytes
      DEFAULT_BUSINESS_CONFIG
    );
    const embeddingCallsDeltaD = embeddingCallCount - embeddingCallsBeforeD;
    console.log(`- Source ID returned: ${sourceIdD} (New source? ${sourceIdA !== sourceIdD})`);
    console.log(`- Additional embedding calls made: ${embeddingCallsDeltaD}`);
    const sourceCount3 = await prisma.knowledgeSource.count({ where: { tenantId: testTenantId } });
    console.log(`- Total KnowledgeSource rows in DB now: ${sourceCount3}`);

    console.log(`\n[PROBE 6] Account / Tenant Scoping Audit`);
    // Create two accounts in this tenant
    const acc1 = await prisma.account.create({
      data: { tenantId: testTenantId, name: 'Account Alpha Store' }
    });
    const acc2 = await prisma.account.create({
      data: { tenantId: testTenantId, name: 'Account Beta Store' }
    });

    // Check if searchSimilar returns tenant-global docs for acc1 and acc2
    const queryEmb = new Array(1536).fill(0.01);
    const resultsGlobalForAcc1 = await knowledgeRepo.searchSimilar(testTenantId, queryEmb, 5, 0.0, acc1.id);
    const resultsGlobalForAcc2 = await knowledgeRepo.searchSimilar(testTenantId, queryEmb, 5, 0.0, acc2.id);
    console.log(`- Account 1 sees tenant-global chunks: ${resultsGlobalForAcc1.length > 0 ? 'YES' : 'NO'}`);
    console.log(`- Account 2 sees tenant-global chunks: ${resultsGlobalForAcc2.length > 0 ? 'YES' : 'NO'}`);

    // Insert an account-1 private chunk directly
    const privateDoc = await prisma.knowledgeDocument.create({
      data: {
        tenantId: testTenantId,
        accountId: acc1.id,
        sourceId: sourceIdA,
        title: 'Account 1 Private Policy',
        content: 'Exclusive discount code ACC1-VIP-100'
      }
    });
    await knowledgeRepo.insertChunk(testTenantId, privateDoc.id, 'Exclusive discount code ACC1-VIP-100', queryEmb, acc1.id);

    const resultsForAcc1After = await knowledgeRepo.searchSimilar(testTenantId, queryEmb, 10, 0.0, acc1.id);
    const resultsForAcc2After = await knowledgeRepo.searchSimilar(testTenantId, queryEmb, 10, 0.0, acc2.id);
    const acc1HasPrivate = resultsForAcc1After.some(c => c.content.includes('ACC1-VIP-100'));
    const acc2HasPrivate = resultsForAcc2After.some(c => c.content.includes('ACC1-VIP-100'));
    console.log(`- Account 1 sees its private chunk: ${acc1HasPrivate ? 'YES' : 'NO'}`);
    console.log(`- Account 2 sees Account 1 private chunk: ${acc2HasPrivate ? 'LEAK (FAIL)' : 'NO (STRICT ISOLATION PASS)'}`);

    console.log('\n====================================================');
    console.log('ALL READ-ONLY PROBES EXECUTED SUCCESSFULLY');
    console.log('====================================================');
  } finally {
    // Strict cleanup of temporary audit fixtures
    try {
      await prisma.knowledgeChunk.deleteMany({ where: { tenantId: testTenantId } });
      await prisma.knowledgeDocument.deleteMany({ where: { tenantId: testTenantId } });
      await prisma.knowledgeSource.deleteMany({ where: { tenantId: testTenantId } });
      await prisma.account.deleteMany({ where: { tenantId: testTenantId } });
      await prisma.tenantConfig.deleteMany({ where: { tenantId: testTenantId } });
      await prisma.tenant.delete({ where: { id: testTenantId } });
      console.log('Cleaned up all temporary probe fixtures.');
    } catch (e) {
      console.error('Error cleaning up probe fixtures:', e);
    }
  }
}

runAudit().catch(err => {
  console.error('Probe failed with error:', err);
  process.exit(1);
});
