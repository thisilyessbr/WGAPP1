import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { ConversationEngine } from '../domain/conversation/ConversationEngine';
import { ConversationService } from '../domain/conversation/ConversationService';
import { WorkflowEngine } from '../core/engine/WorkflowEngine';
import { WorkflowStateEvaluator } from '../core/engine/WorkflowStateEvaluator';
import { FieldValidator } from '../core/engine/FieldValidator';
import { ResponseBuilder } from '../domain/conversation/ResponseBuilder';
import { TenantConfigService } from '../domain/tenant/TenantConfigService';
import { DEFAULT_BUSINESS_CONFIG, BusinessConfig } from '../domain/tenant/BusinessConfig';
import { RAGService } from '../domain/rag/RAGService';
import { PdfIngestionService } from '../domain/rag/PdfIngestionService';
import { LLMProvider } from '../core/llm/LLMProvider';
import { EmbeddingProvider } from '../core/rag/EmbeddingProvider';
import { KnowledgeRepository } from '../domain/rag/KnowledgeRepository';

import { prisma } from './testDb';

// Create a highly predictable MockLLM for Phase 13 Acceptance
class MockAcceptanceLLM implements LLMProvider {
  async classifyIntent(systemPrompt: string, message: string, allowedIntents: string[]): Promise<string | null> {
    const text = message.toLowerCase();
    if (text.includes('support')) return 'IT_SUPPORT_REQUEST';
    if (text.includes('tutor')) return 'TUTOR_SESSION';
    return null; // out of scope or fallback
  }
  async extractField(systemPrompt: string, message: string, fieldType: string): Promise<any | null> {
    // If it asks for JSON, parse it, else just return the string
    if (message.includes('Malformed JSON')) {
      throw new Error('LLM crashed');
    }
    if (fieldType === 'number') {
      const match = message.match(/\d+/);
      return match ? parseInt(match[0], 10) : null;
    }
    if (message.includes('support') || message.includes('tutor')) return null;
    return message.trim();
  }
  async generateResponse(systemPrompt: string, history: { role: string; content: string }[]): Promise<string> {
    // Echo the system prompt back to prove config manipulation works
    if (history[history.length - 1].content.includes('ECHO_SYS')) {
      return `SYS:${systemPrompt}`;
    }
    return 'Grounded Answer';
  }
}
class MockEmbeddingProvider implements EmbeddingProvider {
  async embedText(text: string): Promise<number[]> {
    return [0.1, 0.2, 0.3];
  }
}
let engine: ConversationEngine;
let llm: MockAcceptanceLLM;
let tenantConfigService: TenantConfigService;
beforeAll(async () => {
  // Clear DB
  await prisma.knowledgeChunk.deleteMany();
  await prisma.knowledgeDocument.deleteMany();
  await prisma.workflowSession.deleteMany();
  await prisma.message.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.tenantConfig.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.tenant.deleteMany();
});
beforeEach(() => {
  llm = new MockAcceptanceLLM();
  const evaluator = new WorkflowStateEvaluator(llm);
  const validator = new FieldValidator();
  const responseBuilder = new ResponseBuilder();
  const workflowEngine = new WorkflowEngine(evaluator, llm, responseBuilder, validator);
  const conversationService = new ConversationService(prisma);
  tenantConfigService = new TenantConfigService(prisma);
  const embedding = new MockEmbeddingProvider();
  const repo = new KnowledgeRepository(prisma);
  const ragService = new RAGService(embedding, repo);
  engine = new ConversationEngine(
    conversationService,
    tenantConfigService,
    workflowEngine,
    llm,
    responseBuilder,
    ragService
  );
});
describe('Phase 13: Final Chatbot Acceptance', () => {
  it('1. IT_SUPPORT_REQUEST (Second Completely Different Workflow)', async () => {
    const tenant = await prisma.tenant.create({ data: { name: 'IT Tenant' } });
    const config = JSON.parse(JSON.stringify(DEFAULT_BUSINESS_CONFIG)) as BusinessConfig;
    config.capabilities.intents.push({ id: 'IT_SUPPORT_REQUEST', description: 'Request IT help' });
    config.workflows['IT_SUPPORT_REQUEST'] = {
      id: 'IT_SUPPORT_REQUEST',
      name: 'IT Support',
      description: 'Support ticket',
      initialState: 'get_requester',
      allowInterruption: false,
      states: {
        get_requester: {
          type: 'collect',
          prompt: 'Who are you?',
          field: { name: 'requester', type: 'string', required: true },
          transitions: [{ target: 'get_category', default: true }]
        },
        get_category: {
          type: 'collect',
          prompt: 'Category?',
          field: { name: 'category', type: 'string', required: true },
          transitions: [{ target: 'get_priority', default: true }]
        },
        get_priority: {
          type: 'collect',
          prompt: 'Priority (High/Low)?',
          field: { name: 'priority', type: 'enum', required: true, options: ['High', 'Low'] },
          transitions: [{ target: 'end', default: true }]
        },
        end: {
          type: 'end',
          prompt: 'Ticket created.'
        }
      }
    };
    await prisma.tenantConfig.create({ data: { tenantId: tenant.id, config: config as any } });
    let res = await engine.handleMessage(tenant.id, 'cust1', 'I need IT support');
    expect(res).toBe('Who are you?');
    res = await engine.handleMessage(tenant.id, 'cust1', 'Alice');
    expect(res).toBe('Category?');
    res = await engine.handleMessage(tenant.id, 'cust1', 'Hardware');
    expect(res).toBe('Priority (High/Low)?');
    // Test enum validation
    res = await engine.handleMessage(tenant.id, 'cust1', 'Medium');
    expect(res).toBe('Value must be one of: High, Low. Priority (High/Low)?');
    res = await engine.handleMessage(tenant.id, 'cust1', 'High');
    expect(res).toBe('Ticket created.');
    const conv = await prisma.conversation.findFirst({ where: { tenantId: tenant.id, customerId: (await prisma.customer.findFirst({where:{externalId:'cust1'}}))?.id } });
    const session = await prisma.workflowSession.findFirst({ where: { conversationId: conv?.id }, orderBy: { createdAt: 'desc' } });
    expect(session?.status).toBe('COMPLETED');
    expect(session?.contextData).toEqual({ requester: 'Alice', category: 'Hardware', priority: 'High' });
  });
  it('2. Dynamic Workflow Mutation Test (No TS modifications)', async () => {
    const tenant = await prisma.tenant.create({ data: { name: 'Mutation Tenant' } });
    const config = JSON.parse(JSON.stringify(DEFAULT_BUSINESS_CONFIG)) as BusinessConfig;
    config.capabilities.intents.push({ id: 'TUTOR_SESSION', description: 'Tutor' });
    config.workflows['TUTOR_SESSION'] = {
      id: 'TUTOR_SESSION',
      name: 'Tutor',
      description: 'Tutor',
      initialState: 'get_name',
      allowInterruption: false,
      states: {
        get_name: {
          type: 'collect',
          prompt: 'Name?',
          field: { name: 'studentName', type: 'string', required: true },
          transitions: [{ target: 'end', default: true }]
        },
        end: { type: 'end', prompt: 'Done.' }
      }
    };
    await prisma.tenantConfig.create({ data: { tenantId: tenant.id, config: config as any } });
    // Customer starts conversation
    let res = await engine.handleMessage(tenant.id, 'mut_cust', 'I need a tutor');
    expect(res).toBe('Name?');
    // While conversation is active (they haven't answered), admin dynamically MUTATES the workflow via DB
    // Adds `location` field between name and end
    config.workflows['TUTOR_SESSION'].states['get_name'].transitions = [{ target: 'get_location', default: true }];
    config.workflows['TUTOR_SESSION'].states['get_location'] = {
      type: 'collect',
      prompt: 'Where?',
      field: { name: 'location', type: 'string', required: true },
      transitions: [{ target: 'end', default: true }]
    };
    await prisma.tenantConfig.update({ where: { tenantId: tenant.id }, data: { config: config as any } });
    // Customer sends name. The engine loads the NEW config and transitions to get_location!
    res = await engine.handleMessage(tenant.id, 'mut_cust', 'Bob');
    expect(res).toBe('Where?'); // Proves dynamic mutation works perfectly!
    res = await engine.handleMessage(tenant.id, 'mut_cust', 'Library');
    expect(res).toBe('Done.');
    const conv = await prisma.conversation.findFirst({ where: { tenantId: tenant.id, customerId: (await prisma.customer.findFirst({where:{externalId:'mut_cust'}}))?.id } });
    const session = await prisma.workflowSession.findFirst({ where: { conversationId: conv?.id }, orderBy: { createdAt: 'desc' } });
    expect(session?.contextData).toEqual({ studentName: 'Bob', location: 'Library' });
  });
  it('3. BusinessConfig Control-Plane Test (Prompts, Limits, Behaviors)', async () => {
    const tenant = await prisma.tenant.create({ data: { name: 'Control Tenant' } });
    const config = JSON.parse(JSON.stringify(DEFAULT_BUSINESS_CONFIG)) as BusinessConfig;
    // Change core prompts
    config.prompts.greeting = 'HOLA AMIGO';
    config.prompts.fallback = 'NO COMPRENDO';
    config.prompts.system = 'YOU ARE A PIRATE';
    config.limits.maxConversationHistory = 2; // limit triggers after 1st interaction (2 msgs: user+assistant)
    await prisma.tenantConfig.create({ data: { tenantId: tenant.id, config: config as any } });
    // Test system prompt injection (Using ECHO_SYS trick in MockLLM)
    let res = await engine.handleMessage(tenant.id, 'ctrl_cust', 'ECHO_SYS');
    expect(res).toContain('YOU ARE A PIRATE'); // Proves the system prompt is injected accurately!
    // Test limits: limit is 2 total messages, 1st interaction stored 2 (user+assistant), 2nd hits limit
    res = await engine.handleMessage(tenant.id, 'ctrl_cust', 'Message 3');
    expect(res).toContain('Conversation has reached the maximum allowed length');
  });
  it('4. Restart Recovery Test (State Persistence)', async () => {
    const tenant = await prisma.tenant.create({ data: { name: 'Restart Tenant' } });
    const config = JSON.parse(JSON.stringify(DEFAULT_BUSINESS_CONFIG)) as BusinessConfig;
    config.capabilities.intents.push({ id: 'TUTOR_SESSION', description: 'Tutor' });
    config.workflows['TUTOR_SESSION'] = {
      id: 'TUTOR_SESSION',
      name: 'Tutor',
      description: 'Tutor',
      initialState: 'get_name',
      allowInterruption: false,
      states: {
        get_name: {
          type: 'collect',
          prompt: 'Name?',
          field: { name: 'studentName', type: 'string', required: true },
          transitions: [{ target: 'get_subject', default: true }]
        },
        get_subject: {
          type: 'collect',
          prompt: 'Subject?',
          field: { name: 'subject', type: 'string', required: true },
          transitions: [{ target: 'end', default: true }]
        },
        end: { type: 'end', prompt: 'Done.' }
      }
    };
    await prisma.tenantConfig.create({ data: { tenantId: tenant.id, config: config as any } });
    // Step 1: Start on original engine instance
    let res = await engine.handleMessage(tenant.id, 'restart_cust', 'tutor');
    expect(res).toBe('Name?');
    res = await engine.handleMessage(tenant.id, 'restart_cust', 'John');
    expect(res).toBe('Subject?');
    // Simulating Server Crash & Restart by creating a completely new engine instance
    const evaluator2 = new WorkflowStateEvaluator(llm);
    const validator2 = new FieldValidator();
    const responseBuilder2 = new ResponseBuilder();
    const workflowEngine2 = new WorkflowEngine(evaluator2, llm, responseBuilder2, validator2);
    const conversationService2 = new ConversationService(prisma);
    const tenantConfigService2 = new TenantConfigService(prisma);
    const embedding2 = new MockEmbeddingProvider();
    const repo2 = new KnowledgeRepository(prisma);
    const ragService2 = new RAGService(embedding2, repo2);
    const newEngineInstance = new ConversationEngine(
      conversationService2,
      tenantConfigService2,
      workflowEngine2,
      llm,
      responseBuilder2,
      ragService2
    );
    // Step 2: Resume on new engine instance
    res = await newEngineInstance.handleMessage(tenant.id, 'restart_cust', 'Math');
    expect(res).toBe('Done.'); // State perfectly recovered and resumed!
    const conv = await prisma.conversation.findFirst({ where: { tenantId: tenant.id, customerId: (await prisma.customer.findFirst({where:{externalId:'restart_cust'}}))?.id } });
    const session = await prisma.workflowSession.findFirst({ where: { conversationId: conv?.id }, orderBy: { createdAt: 'desc' } });
    expect(session?.contextData).toEqual({ studentName: 'John', subject: 'Math' });
  });

  it('5. Production-Debug Isolation Test', async () => {
    const tenant = await prisma.tenant.create({ data: { name: 'Prod Isolation' } });
    const config = JSON.parse(JSON.stringify(DEFAULT_BUSINESS_CONFIG)) as BusinessConfig;
    await prisma.tenantConfig.create({ data: { tenantId: tenant.id, config: config as any } });
    const result = await engine.handleMessage(tenant.id, 'prod_cust', 'hello');
    expect(typeof result).toBe('string');
    expect(result).toBe('Grounded Answer');
  });
});
