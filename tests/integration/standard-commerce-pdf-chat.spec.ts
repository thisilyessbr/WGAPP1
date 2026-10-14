import { afterEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../src/tests/testDb';
import { bootstrapChatbot } from '../../src/bootstrap';
import { DEFAULT_BUSINESS_CONFIG } from '../../src/domain/tenant/BusinessConfig';
import { LLMMockProvider } from '../../src/core/llm/LLMProvider';

async function pdfWithText(text: string): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 400]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText(text, { x: 40, y: 340, size: 12, font });
  return Buffer.from(await doc.save());
}

describe('standard and commerce chatbots with account PDFs', () => {
  const tenants: string[] = [];

  afterEach(async () => {
    for (const id of tenants.splice(0)) await prisma.tenant.delete({ where: { id } });
    vi.unstubAllEnvs();
  });

  async function setup(commerce: boolean, pdfText: string) {
    vi.stubEnv('PORTAL_ENABLED', 'false');
    const config = structuredClone(DEFAULT_BUSINESS_CONFIG);
    config.knowledge.minSimilarityScore = 0;
    config.knowledge.topK = 5;
    config.llm = { ...config.llm, provider: 'mock', model: 'mock-model' };
    const tenant = await prisma.tenant.create({
      data: { name: `PDF mode test ${randomUUID()}`, config: { create: { config: config as any } } }
    });
    tenants.push(tenant.id);
    const account = await prisma.account.create({
      data: { tenantId: tenant.id, name: 'test-business', enabled: true,
        config: { llm: { provider: 'mock', model: 'mock-model' },
          capabilities: { ecommerceEnabled: commerce }, knowledge: { enabled: true, minSimilarityScore: 0 } } }
    });
    const deps = bootstrapChatbot(prisma);
    const llm = new LLMMockProvider();
    deps.llmFactory.registerProvider('mock', 'mock-model', llm);
    const sourceId = await deps.pdfIngestionService.ingestPdf(tenant.id, await pdfWithText(pdfText), 'business-guide.pdf', config, account.id);
    expect((await prisma.knowledgeSource.findUnique({ where: { id: sourceId } }))?.status).toBe('COMPLETED');
    return { tenant, account, deps, llm };
  }

  it('answers a standard service question from its PDF with commerce disabled', async () => {
    const fact = 'Private lessons last 75 minutes and cost 180 MAD.';
    const { tenant, account, deps, llm } = await setup(false, fact);
    const retrieved = await deps.ragService.retrieve(tenant.id, 'How long are private lessons and what do they cost?',
      { ...DEFAULT_BUSINESS_CONFIG, knowledge: { ...DEFAULT_BUSINESS_CONFIG.knowledge, minSimilarityScore: 0 } }, account.id);
    expect(retrieved.context).toContain(fact);
    llm.responseResolver = (_system, history) => {
      expect(JSON.stringify(history)).toContain(fact);
      return 'Private lessons last 75 minutes and cost 180 MAD.';
    };
    const reply = await deps.conversationEngine.handleMessage(tenant.id, 'service-pdf-test',
      'How long are private lessons and what do they cost?', account.id);
    expect(reply).toContain('75 minutes');
    expect(reply).toContain('180 MAD');
  });

  it('answers a shop policy from its PDF while keeping product lookup active', async () => {
    const fact = 'Shoes can be returned within 21 days with the receipt.';
    const { tenant, account, deps, llm } = await setup(true, fact);
    await prisma.product.create({ data: { tenantId: tenant.id, accountId: account.id,
      sku: 'SHOE-TEST', name: 'Atlas Running Shoes', description: 'Light running shoes',
      price: 240, currency: 'MAD', stock: 7, active: true, category: 'Shoes' } });
    const retrieved = await deps.ragService.retrieve(tenant.id, 'What is the return period for shoes?',
      { ...DEFAULT_BUSINESS_CONFIG, knowledge: { ...DEFAULT_BUSINESS_CONFIG.knowledge, minSimilarityScore: 0 } }, account.id);
    expect(retrieved.context).toContain(fact);
    llm.responseResolver = (_system, history) => {
      expect(JSON.stringify(history)).toContain(fact);
      return 'Shoes can be returned within 21 days with the receipt.';
    };
    const policy = await deps.conversationEngine.handleMessage(tenant.id, 'shop-pdf-policy-test',
      'What is the return period for shoes?', account.id);
    expect(policy).toContain('21 days');
    const product = await deps.conversationEngine.handleMessage(tenant.id, 'shop-pdf-product-test',
      'Show me Atlas Running Shoes', account.id);
    expect(product).toContain('Atlas Running Shoes');
    expect(product).toContain('240 MAD');
  });
});
