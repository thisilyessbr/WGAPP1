import { describe, it, expect, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { bootstrapChatbot } from '../bootstrap';
import { createDevChatRouter } from '../dev/chatApi';
import { prisma } from './testDb';

let app: express.Application;
let deps: any;
const TENANT_A = 'test-tenant-a';
const TENANT_B = 'test-tenant-b';

describe('Phase 14: Dev Control Center Tests', () => {
  beforeAll(async () => {
    // Clean state
    await prisma.knowledgeChunk.deleteMany();
    await prisma.knowledgeDocument.deleteMany();
    await prisma.knowledgeSource.deleteMany();
    await prisma.message.deleteMany();
    await prisma.conversation.deleteMany();
    await prisma.workflowSession.deleteMany();
    await prisma.tenantConfig.deleteMany();
    await prisma.customer.deleteMany();
    await prisma.tenant.deleteMany();

    // Setup Dev API
    deps = bootstrapChatbot(prisma);
    
    // Mock PDF Ingestion to avoid requiring a structurally perfect PDF file for tests
    deps.pdfIngestionService.ingestPdf = async (tenantId: string, buffer: Buffer, filename: string, config: any) => {
      const source = await deps.prisma.knowledgeSource.create({
        data: {
          tenantId,
          name: filename,
          type: 'PDF',
          status: 'COMPLETED',
          metadata: { mocked: true }
        }
      });
      return source.id;
    };
    
    app = express();
    app.use(express.json());
    app.use('/api/dev', createDevChatRouter(deps));

    // Bootstrap TENANT_A manually
    await request(app).post('/api/dev/bootstrap').send();
    // Bootstrap creates 'dev-tenant'. Let's rename it to TENANT_A or just create tenants directly.
    await prisma.tenant.create({ data: { id: TENANT_A, name: 'Tenant A' } });
    await prisma.tenant.create({ data: { id: TENANT_B, name: 'Tenant B' } });
  });

  it('1. GET /config respects tenant isolation', async () => {
    // Need to initialize config for Tenant A
    const postRes = await request(app).post('/api/dev/config').send({
      tenantId: TENANT_A,
      config: {
        identity: { botName: 'Bot A' },
        behavior: { tone: 'strict' },
        prompts: { system: 'Sys A' },
        limits: {}, knowledge: {}, llm: {}, capabilities: {}, workflows: {}
      }
    });
    console.log("POST RES:", postRes.body);
    expect(postRes.status).toBe(200);

    // Tenant B should not see Tenant A config
    const resB = await request(app).get(`/api/dev/config?tenantId=${TENANT_B}`);
    expect(resB.status).toBe(500); // Because Tenant B has no config record yet

    const resA = await request(app).get(`/api/dev/config?tenantId=${TENANT_A}`);
    console.log("RESA TEXT:", resA.text);
    expect(resA.status).toBe(200);
    expect(resA.body.identity.botName).toBe('Bot A');
  });

  it('2. Invalid JSON config is rejected without corrupting existing configuration', async () => {
    // Attempt to send malformed config missing required base objects
    const res = await request(app).post('/api/dev/config').send({
      tenantId: TENANT_A,
      config: { identity: null } // Invalid structure
    });
    
    expect(res.status).toBe(400);

    // Verify existing config is intact
    const verify = await request(app).get(`/api/dev/config?tenantId=${TENANT_A}`);
    expect(verify.body.identity.botName).toBe('Bot A'); // Still Bot A
  });

  it('3. Arbitrary Generic Workflow Creation via Config', async () => {
    const configRes = await request(app).get(`/api/dev/config?tenantId=${TENANT_A}`);
    const config: BusinessConfig = configRes.body;

    // Add completely arbitrary workflow
    config.workflows['HARDWARE_RETURN'] = {
      id: 'HARDWARE_RETURN',
      name: 'Return',
      description: 'Return process',
      initialState: 'collect_item',
      states: {
        'collect_item': {
          type: 'collect',
          field: { name: 'item', type: 'string', required: true },
          transitions: [{ target: 'end' }]
        },
        'end': { type: 'end' }
      }
    };
    config.capabilities.intents.push({ id: 'HARDWARE_RETURN', description: 'Return hardware' });

    await request(app).post('/api/dev/config').send({ tenantId: TENANT_A, config });

    // Test Chat Endpoint expects to resolve this workflow
    const chatRes = await request(app).post('/api/dev/chat').send({
      tenantId: TENANT_A,
      customerId: 'cust-1',
      message: 'I want to return my hardware'
    });

    expect(chatRes.status).toBe(200);
    // Diagnostic interception check
    expect(chatRes.body.debug).toBeDefined();
    expect(chatRes.body.debug.latencyMs).toBeGreaterThanOrEqual(0);
  }, 60000);

  it('4. PDF Ingestion endpoint isolated per tenant', async () => {
    // Create a dummy PDF buffer
    const dummyPdf = Buffer.from('%PDF-1.4\\n1 0 obj\\n<< /Type /Catalog >>\\nendobj\\n');

    const res = await request(app)
      .post(`/api/dev/upload`)
      .field('tenantId', TENANT_A)
      .attach('document', dummyPdf, 'test.pdf');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const sourceId = res.body.sourceId;

    // Verify it exists under Tenant A
    const docsA = await request(app).get(`/api/dev/documents?tenantId=${TENANT_A}`);
    expect(docsA.body.some((d: any) => d.id === sourceId)).toBe(true);

    // Verify Tenant B cannot see it
    const docsB = await request(app).get(`/api/dev/documents?tenantId=${TENANT_B}`);
    expect(docsB.body.some((d: any) => d.id === sourceId)).toBe(false);
  });

  it('5. PDF Upload Edge Cases (missing file, wrong mime, tenant missing)', async () => {
    // Missing file
    const resNoFile = await request(app)
      .post('/api/dev/upload')
      .field('tenantId', TENANT_A);
    
    expect(resNoFile.status).toBe(400);
    expect(resNoFile.body.error).toBe('PDF_UPLOAD_FAILED');
    expect(resNoFile.body.message).toBe('No PDF file was received');

    // Wrong MIME type
    const resWrongMime = await request(app)
      .post('/api/dev/upload')
      .field('tenantId', TENANT_A)
      .attach('document', Buffer.from('hello'), { filename: 'test.txt', contentType: 'text/plain' });
    
    expect(resWrongMime.status).toBe(400);
    expect(resWrongMime.body.error).toBe('PDF_UPLOAD_FAILED');
    expect(resWrongMime.body.message).toBe('Invalid file type');

    // Tenant missing
    const resNoTenant = await request(app)
      .post('/api/dev/upload')
      .attach('document', Buffer.from('%PDF-'), { filename: 'test.pdf', contentType: 'application/pdf' });
    
    expect(resNoTenant.status).toBe(400);
    expect(resNoTenant.body.error).toBe('PDF_UPLOAD_FAILED');
    expect(resNoTenant.body.message).toBe('tenantId is missing');

    // Ingestion failure
    // Temporarily mock ingestPdf to throw an error to simulate ingestion failure
    const originalIngest = (deps as any).pdfIngestionService.ingestPdf;
    (deps as any).pdfIngestionService.ingestPdf = async () => {
      throw new Error('Mocked ingestion error');
    };

    const resIngestFail = await request(app)
      .post(`/api/dev/upload?tenantId=${TENANT_A}`)
      .field('tenantId', TENANT_A)
      .attach('document', Buffer.from('%PDF-1.4\\n1 0 obj\\n<< /Type /Catalog >>\\nendobj\\n'), { filename: 'fail.pdf', contentType: 'application/pdf' });

    expect(resIngestFail.status).toBe(500);
    expect(resIngestFail.body.error).toBe('PDF_INGESTION_FAILED');
    expect(resIngestFail.body.message).toBe('Failed to ingest PDF into the knowledge base');

    // Restore original mock
    (deps as any).pdfIngestionService.ingestPdf = originalIngest;
  });
});
