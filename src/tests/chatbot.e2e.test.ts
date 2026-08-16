import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import { ConversationEngine } from '../domain/conversation/ConversationEngine';
import { ConversationService } from '../domain/conversation/ConversationService';
import { TenantConfigService } from '../domain/tenant/TenantConfigService';
import { WorkflowEngine } from '../core/engine/WorkflowEngine';
import { WorkflowStateEvaluator } from '../core/engine/WorkflowStateEvaluator';
import { FieldValidator } from '../core/engine/FieldValidator';
import { MockEmbeddingProvider } from '../core/rag/EmbeddingProvider';
import { KnowledgeRepository } from '../domain/rag/KnowledgeRepository';
import { RAGService } from '../domain/rag/RAGService';
import { PdfIngestionService } from '../domain/rag/PdfIngestionService';
import { ResponseBuilder } from '../domain/conversation/ResponseBuilder';
import { DEFAULT_BUSINESS_CONFIG } from '../domain/tenant/BusinessConfig';

import { prisma } from './testDb';

// Mock pdf-parse
vi.mock('pdf-parse', () => {
  return {
    default: vi.fn().mockImplementation(async (buffer: Buffer) => {
      return { text: buffer.toString('utf8'), numpages: 1 };
    })
  };
});
// Mock LLM
class MockLLM {
  async classifyIntent(systemPrompt: string, message: string, intents: string[]): Promise<string | null> {
    console.log(`MockLLM.classifyIntent called with:`, message);
    if (message.toLowerCase().includes('tutor')) return 'TUTOR_SESSION';
    if (message.toLowerCase().includes('order')) return 'ORDER_SESSION';
    return null;
  }
  async extractField(systemPrompt: string, message: string, type: string): Promise<any> {
    console.log(`MockLLM.extractField called with:`, message, type);
    if (message.toLowerCase().includes('tutor')) return null;
    if (message.toLowerCase().includes('order')) return null;
    if (message === 'start workflow') return null;
    if (message === 'InvalidField') return null; // simulates extraction failure
    if (message === 'Malformed JSON') throw new Error('Malformed JSON'); // simulates crash
    if (type === 'number') return parseInt(message) || null;
    return message;
  }
  async generateResponse(systemPrompt: string, history: any[]): Promise<string> {
    console.log(`MockLLM.generateResponse called`);
    if (systemPrompt.includes('Use the following context')) {
      return 'Grounded Answer';
    }
    return 'Default fallback';
  }
}
let conversationService: ConversationService;
let configService: TenantConfigService;
let workflowEngine: WorkflowEngine;
let llmMock: MockLLM;
let ragService: RAGService;
let knowledgeRepo: KnowledgeRepository;
let embedProvider: MockEmbeddingProvider;
let ingestionService: PdfIngestionService;
let engine: ConversationEngine;
describe('Phase 11: End-to-End Chatbot Acceptance', () => {
  beforeAll(async () => {
    await prisma.knowledgeChunk.deleteMany();
    await prisma.knowledgeDocument.deleteMany();
    await prisma.knowledgeSource.deleteMany();
    await prisma.workflowSession.deleteMany();
    await prisma.message.deleteMany();
    await prisma.conversation.deleteMany();
    await prisma.tenantConfig.deleteMany();
    await prisma.customer.deleteMany();
    await prisma.tenant.deleteMany();
    conversationService = new ConversationService(prisma);
    configService = new TenantConfigService(prisma);
    llmMock = new MockLLM();
    const validator = new FieldValidator();
    const evaluator = new WorkflowStateEvaluator(llmMock as any);
    const responseBuilder = new ResponseBuilder();
    workflowEngine = new WorkflowEngine(evaluator, llmMock as any, responseBuilder, validator);
    knowledgeRepo = new KnowledgeRepository(prisma);
    embedProvider = new MockEmbeddingProvider();
    ragService = new RAGService(embedProvider, knowledgeRepo);
    ingestionService = new PdfIngestionService(prisma, embedProvider, knowledgeRepo);
    engine = new ConversationEngine(
      conversationService,
      configService,
      workflowEngine,
      llmMock as any,
      responseBuilder,
      ragService
    );
  });
  it('1. Mandatory end-to-end acceptance test (TUTOR_SESSION)', async () => {
    const tenant = await prisma.tenant.create({ data: { name: 'E2E Tenant' } });
    const extId = 'user123';
    const config = JSON.parse(JSON.stringify(DEFAULT_BUSINESS_CONFIG));
    config.capabilities.intents.push({ id: 'TUTOR_SESSION', description: 'Start tutoring' });
    config.workflows['TUTOR_SESSION'] = {
      id: 'TUTOR_SESSION',
      name: 'Tutoring',
      description: 'Collect details',
      initialState: 'collect_student',
      allowInterruption: false,
      states: {
        collect_student: {
          type: 'collect',
          prompt: 'Name?',
          field: { name: 'studentName', required: true, type: 'string' },
          transitions: [{ target: 'collect_subject', default: true }]
        },
        collect_subject: {
          type: 'collect',
          prompt: 'Subject?',
          field: { name: 'subject', required: true, type: 'string' },
          transitions: [{ target: 'collect_duration', default: true }]
        },
        collect_duration: {
          type: 'collect',
          prompt: 'Minutes?',
          field: { name: 'duration', required: true, type: 'number', min: 30, max: 120 },
          transitions: [{ target: 'end', default: true }]
        },
        end: {
          type: 'end',
          prompt: 'Workflow completed successfully.'
        }
      }
    };
    await prisma.tenantConfig.create({ data: { tenantId: tenant.id, config } });
    // 1. Initial trigger -> goes to collect_student
    let res = await engine.handleMessage(tenant.id, extId, 'I want a tutor');
    expect(res).toBe('Name?');
    // 2. Provide student name -> goes to collect_subject
    res = await engine.handleMessage(tenant.id, extId, 'John');
    expect(res).toBe('Subject?');
    // 3. Provide subject -> goes to collect_duration
    res = await engine.handleMessage(tenant.id, extId, 'Math');
    expect(res).toBe('Minutes?');
    // 4. Provide invalid duration (< 30) -> stays in collect_duration
    res = await engine.handleMessage(tenant.id, extId, '10');
    expect(res).toBe('Value must be at least 30. Minutes?');
    // 5. Provide valid duration -> completes workflow
    res = await engine.handleMessage(tenant.id, extId, '60');
    expect(res).toBe('Workflow completed successfully.');
    // 6. Verify final state
    const conv = await prisma.conversation.findFirst({ where: { tenantId: tenant.id, customerId: (await prisma.customer.findFirst({where:{externalId:extId}}))?.id } });
    const session = await prisma.workflowSession.findFirst({ where: { conversationId: conv?.id }, orderBy: { createdAt: 'desc' } });
    expect(session?.status).toBe('COMPLETED');
    const context = session?.contextData as any;
    expect(context.studentName).toBe('John');
    expect(context.subject).toBe('Math');
    expect(context.duration).toBe(60);
  });
  it('2. Mandatory RAG acceptance test (PDF -> RAG -> Answer)', async () => {
    const tenant = await prisma.tenant.create({ data: { name: 'RAG Tenant' } });
    const config = JSON.parse(JSON.stringify(DEFAULT_BUSINESS_CONFIG));
    config.knowledge.enabled = true;
    await prisma.tenantConfig.create({ data: { tenantId: tenant.id, config } });
    // Ingest PDF
    const buffer = Buffer.from('The school colors are blue and gold.');
    await ingestionService.ingestPdf(tenant.id, buffer, 'school.pdf', config);
    // Ensure RAG can retrieve it generically
    const res = await engine.handleMessage(tenant.id, 'user456', 'What are the colors?');
    // MockLLM is programmed to return 'Grounded Answer' when context is provided
    expect(res).toBe('Grounded Answer');
  });
  it('3. Tenant isolation test (Cross-tenant knowledge access)', async () => {
    const tenantA = await prisma.tenant.create({ data: { name: 'Isolation A' } });
    const tenantB = await prisma.tenant.create({ data: { name: 'Isolation B' } });
    const configA = JSON.parse(JSON.stringify(DEFAULT_BUSINESS_CONFIG));
    configA.knowledge.enabled = true;
    const configB = JSON.parse(JSON.stringify(DEFAULT_BUSINESS_CONFIG));
    configB.knowledge.enabled = true;
    await prisma.tenantConfig.create({ data: { tenantId: tenantA.id, config: configA } });
    await prisma.tenantConfig.create({ data: { tenantId: tenantB.id, config: configB } });
    // Ingest completely different knowledge
    await ingestionService.ingestPdf(tenantA.id, Buffer.from('Apple is a fruit'), 'a.pdf', configA);
    await ingestionService.ingestPdf(tenantB.id, Buffer.from('Dog is an animal'), 'b.pdf', configB);
    // Tenant A searches for Dog
    const contextA = await ragService.retrieveContext(tenantA.id, 'animal', configA);
    expect(contextA).toBe(''); // Tenant A cannot see Tenant B's 'Dog is an animal'
    // Tenant B searches for Apple
    const contextB = await ragService.retrieveContext(tenantB.id, 'fruit', configB);
    expect(contextB).toBe(''); // Isolated
  });
  it('4. LLM failure tests do not corrupt state', async () => {
    const tenant = await prisma.tenant.create({ data: { name: 'Fail Tenant' } });
    const config = JSON.parse(JSON.stringify(DEFAULT_BUSINESS_CONFIG));
    config.capabilities.intents.push({ id: 'ORDER_SESSION', description: 'Start' });
    config.workflows['ORDER_SESSION'] = {
      id: 'ORDER_SESSION',
      name: 'Order',
      description: 'Order',
      initialState: 'start',
      states: {
        start: {
          type: 'collect',
          prompt: 'Item?',
          field: { name: 'item', required: true, type: 'string' },
          transitions: [{ target: 'end', default: true }]
        },
        end: {
          type: 'end',
          prompt: 'Workflow completed successfully.'
        }
      }
    };
    await prisma.tenantConfig.create({ data: { tenantId: tenant.id, config } });
    let res = await engine.handleMessage(tenant.id, 'fail_user', 'I want an order');
    expect(res).toBe('Item?');
    // Simulate LLM crash during extraction. The engine should catch this and ask again.
    res = await engine.handleMessage(tenant.id, 'fail_user', 'Malformed JSON');
    expect(res).toBe('Item?');
    // Provide valid item
    res = await engine.handleMessage(tenant.id, 'fail_user', 'Burger');
    expect(res).toBe('Workflow completed successfully.'); // Assuming empty transitions array acts as terminal
  });
  it('5. Concurrency test: Duplicate messages do not create duplicate workflow sessions', async () => {
    const tenant = await prisma.tenant.create({ data: { name: 'Concurrency Tenant' } });
    const extId = 'concurrent_user';
    const config = JSON.parse(JSON.stringify(DEFAULT_BUSINESS_CONFIG));
    // Explicit naive exact match route for 'start workflow'
    config.workflows['start workflow'] = {
      id: 'start workflow',
      name: 'Test',
      description: 'Test',
      initialState: 's1',
      states: {
        s1: {
          type: 'collect',
          prompt: 'Q1?',
          field: { name: 'q1', required: true, type: 'string' },
          transitions: [{ target: 'end', default: true }]
        },
        end: { type: 'end' }
      }
    };
    await prisma.tenantConfig.create({ data: { tenantId: tenant.id, config } });
    // Two exactly simultaneous messages arrive
    const p1 = engine.handleMessage(tenant.id, extId, 'start workflow');
    const p2 = engine.handleMessage(tenant.id, extId, 'start workflow');
    const results = await Promise.allSettled([p1, p2]);
    // One should succeed, one should fail due to optimistic lock
    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    // Ensure only one active session exists
    const conv = await prisma.conversation.findFirst({ where: { tenantId: tenant.id } });
    const sessions = await prisma.workflowSession.findMany({ where: { conversationId: conv?.id } });
    expect(sessions.length).toBe(1); // No duplicates!
  });
});