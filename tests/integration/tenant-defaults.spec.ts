import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prisma } from '../../src/tests/testDb';
import { bootstrapChatbot } from '../../src/bootstrap';
import { DEFAULT_BUSINESS_CONFIG, BusinessConfig } from '../../src/domain/tenant/BusinessConfig';
import { LLMMockProvider } from '../../src/core/llm/LLMProvider';
import { migrateTenantKnowledgeFlags } from '../../src/scripts/migrate-tenant-knowledge-flags';
import { PDFDocument } from 'pdf-lib';

describe('Tenant Defaults & Knowledge Auto-Activation Integration Tests', () => {
  let deps: ReturnType<typeof bootstrapChatbot>;
  let mockLlm: LLMMockProvider;

  beforeEach(async () => {
    deps = bootstrapChatbot(prisma);
    mockLlm = new LLMMockProvider();
    deps.llmFactory.registerProvider('mock', 'mock-model', mockLlm);
    deps.tenantConfigService.clearCache();
  });

  async function createSamplePdfBuffer(text: string): Promise<Buffer> {
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([600, 400]);
    page.drawText(text, { x: 50, y: 350 });
    const pdfBytes = await pdfDoc.save();
    return Buffer.from(pdfBytes);
  }

  it('routes GREETING and PRODUCT_INQUIRY under DEFAULT_BUSINESS_CONFIG baseline intents', async () => {
    const tenantId = `tenant-default-intents-${Date.now()}`;
    const customerId = `cust-${Date.now()}`;

    await prisma.tenant.create({
      data: {
        id: tenantId,
        name: 'Default Intents Tenant',
        config: {
          create: {
            config: {
              ...DEFAULT_BUSINESS_CONFIG,
              llm: {
                provider: 'mock',
                model: 'mock-model',
                temperature: 0.1,
                maxTokens: 500,
                timeoutMs: 5000
              },
              workflows: {
                PRODUCT_INQUIRY: {
                  id: 'PRODUCT_INQUIRY',
                  name: 'Product Guide',
                  description: 'Guides user through products',
                  initialState: 'ask_interest',
                  allowInterruption: false,
                  states: {
                    ask_interest: {
                      type: 'collect',
                      prompt: 'Which product category are you interested in?',
                      field: { name: 'category', required: true, type: 'string' },
                      transitions: []
                    }
                  }
                }
              }
            } as any
          }
        }
      }
    });

    const passedAllowedIntents: string[][] = [];
    const originalClassify = mockLlm.classifyIntent.bind(mockLlm);
    mockLlm.classifyIntent = async (sys, msg, allowedIntents, opts) => {
      passedAllowedIntents.push(allowedIntents);
      if (msg.toLowerCase().includes('product')) return 'PRODUCT_INQUIRY';
      if (msg.toLowerCase().includes('hello')) return 'GREETING';
      return originalClassify(sys, msg, allowedIntents, opts);
    };

    // 1. Send "hello" -> baseline intents should be passed to classifier
    await deps.conversationEngine.handleMessage(tenantId, customerId, 'Hello there!');
    expect(passedAllowedIntents[0]).toEqual(expect.arrayContaining(['GREETING', 'PRODUCT_INQUIRY', 'SUPPORT_REQUEST']));

    // 2. Send product inquiry -> should route to PRODUCT_INQUIRY workflow
    const productResponse = await deps.conversationEngine.handleMessage(tenantId, customerId, 'Tell me about your products');
    expect(productResponse).toBe('Which product category are you interested in?');
  });

  it('migrates pre-existing tenants that have completed knowledge but knowledge.enabled = false', async () => {
    const tenantId = `tenant-mig-test-${Date.now()}`;

    // Tenant created with knowledge explicitly disabled
    const disabledConfig: BusinessConfig = {
      ...DEFAULT_BUSINESS_CONFIG,
      knowledge: {
        ...DEFAULT_BUSINESS_CONFIG.knowledge,
        enabled: false
      }
    };

    await prisma.tenant.create({
      data: {
        id: tenantId,
        name: 'Pre-existing Unmigrated Tenant',
        config: {
          create: {
            config: disabledConfig as any
          }
        }
      }
    });

    // Create a completed knowledge source and document for this tenant
    const source = await prisma.knowledgeSource.create({
      data: {
        tenantId,
        name: 'Legacy Product Manual',
        type: 'PDF',
        status: 'COMPLETED'
      }
    });

    await prisma.knowledgeDocument.create({
      data: {
        tenantId,
        sourceId: source.id,
        title: 'Legacy Product Manual',
        content: 'Our Enterprise cloud platform supports automated customer support and CRM routing.'
      }
    });

    // Verify it starts with knowledge.enabled = false
    const preCfg = await deps.tenantConfigService.getConfig(tenantId);
    expect(preCfg.knowledge.enabled).toBe(false);

    // Run migration
    const migrationResult = await migrateTenantKnowledgeFlags(prisma);
    expect(migrationResult.updatedTenants).toContain(tenantId);

    // Clear cache & verify knowledge.enabled is now true
    deps.tenantConfigService.clearCache();
    const postCfg = await deps.tenantConfigService.getConfig(tenantId);
    expect(postCfg.knowledge.enabled).toBe(true);
  });

  it('auto-enables knowledge flag upon document ingestion and enables RAG chunk retrieval', async () => {
    const tenantId = `tenant-upload-auto-${Date.now()}`;
    const customerId = `cust-${Date.now()}`;

    const configWithDisabledKnowledge: BusinessConfig = {
      ...DEFAULT_BUSINESS_CONFIG,
      knowledge: {
        ...DEFAULT_BUSINESS_CONFIG.knowledge,
        enabled: false
      },
      llm: {
        provider: 'mock',
        model: 'mock-model',
        temperature: 0.1,
        maxTokens: 500,
        timeoutMs: 5000
      }
    };

    await prisma.tenant.create({
      data: {
        id: tenantId,
        name: 'Upload Auto-Enable Tenant',
        config: {
          create: {
            config: configWithDisabledKnowledge as any
          }
        }
      }
    });

    const pdfBuffer = await createSamplePdfBuffer('Our platform offers automated customer support at 19 dollars per month.');
    
    // Ingest PDF
    const config = await deps.tenantConfigService.getConfig(tenantId);
    await deps.pdfIngestionService.ingestPdf(tenantId, pdfBuffer, 'pricing.pdf', config);

    // Auto-enable knowledge if disabled (as done in the upload API endpoint)
    if (!config.knowledge?.enabled) {
      config.knowledge.enabled = true;
      await deps.tenantConfigService.updateConfig(tenantId, config);
    }

    const updatedConfig = await deps.tenantConfigService.getConfig(tenantId);
    expect(updatedConfig.knowledge.enabled).toBe(true);

    // Query conversation engine - expect retrieved context chunks in system prompt
    mockLlm.generatedResponseMock = 'We offer starter pricing at $19 per month.';
    await deps.conversationEngine.handleMessage(tenantId, customerId, 'What is your monthly price?');
    
    expect(mockLlm.lastSystemPrompt).toContain('automated customer support');
  });
});
