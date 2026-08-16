import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ConversationService } from '../domain/conversation/ConversationService';
import { TenantConfigService } from '../domain/tenant/TenantConfigService';
import { WorkflowEngine } from '../core/engine/WorkflowEngine';
import { WorkflowStateEvaluator } from '../core/engine/WorkflowStateEvaluator';
import { LLMMockProvider } from '../core/llm/LLMProvider';
import { ResponseBuilder } from '../domain/conversation/ResponseBuilder';
import { ConversationEngine } from '../domain/conversation/ConversationEngine';
import { FieldValidator } from '../core/engine/FieldValidator';

import { prisma } from './testDb';

let engine: ConversationEngine;
let llmMock: LLMMockProvider;
let configService: TenantConfigService;

describe('Generic Conversation Engine', () => {
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
    configService = new TenantConfigService(prisma);
    llmMock = new LLMMockProvider();
    const evaluator = new WorkflowStateEvaluator(llmMock);
    const responseBuilder = new ResponseBuilder();
    const fieldValidator = new FieldValidator();
    const workflowEngine = new WorkflowEngine(evaluator, llmMock, responseBuilder, fieldValidator);
    const conversationService = new ConversationService(prisma);
    engine = new ConversationEngine(
      conversationService,
      configService,
      workflowEngine,
      llmMock,
      responseBuilder
    );
  });
  beforeEach(() => {
    llmMock.extractedFieldMock = null;
    llmMock.intentMock = null;
  });
  it('1. Mandatory Acceptance Test: Completely Fictional TUTOR_SESSION Workflow', async () => {
    const tenant = await prisma.tenant.create({ data: { name: 'Engine Test Tenant 1' } });
    const workflowDef = {
      id: 'TUTOR_SESSION',
      initialState: 's1',
      states: {
        s1: { id: 's1', type: 'collect', field: { name: 'studentName', type: 'string', required: true, extractionPrompt: 'Name?' }, transitions: [{ target: 's2' }] },
        s2: { id: 's2', type: 'collect', field: { name: 'subject', type: 'string', required: true, extractionPrompt: 'Subject?' }, transitions: [{ target: 's3' }] },
        s3: { id: 's3', type: 'collect', field: { name: 'date', type: 'date', required: true, extractionPrompt: 'Date?' }, transitions: [{ target: 's4' }] },
        s4: { id: 's4', type: 'collect', field: { name: 'duration', type: 'number', required: true, extractionPrompt: 'Duration?' }, transitions: [{ target: 'confirm' }] },
        confirm: { id: 'confirm', type: 'collect', prompt: 'confirm', transitions: [{ intent: 'confirmed', target: 'end' }, { target: 'end' }] },
        end: { id: 'end', type: 'end', prompt: 'Session Scheduled.', transitions: [] }
      }
    };
    await prisma.tenantConfig.create({
      data: { tenantId: tenant.id, config: { workflows: { 'TUTOR_SESSION': workflowDef } } }
    });
    const extId = 'cust_1';
    // 1. Detect workflow request
    // Trigger workflow by sending exact name for test routing
    let res = await engine.handleMessage(tenant.id, extId, 'TUTOR_SESSION');
    expect(res).toBe('Name?');
    // 2. Collect studentName
    llmMock.extractedFieldMock = 'Alex';
    res = await engine.handleMessage(tenant.id, extId, 'Alex is my name');
    expect(res).toBe('Subject?');
    // 3. Collect subject
    llmMock.extractedFieldMock = 'Physics';
    res = await engine.handleMessage(tenant.id, extId, 'Physics');
    expect(res).toBe('Date?');
    // 4. Missing fields detection (simulate LLM failing to extract)
    llmMock.extractedFieldMock = null;
    res = await engine.handleMessage(tenant.id, extId, 'I dont know yet');
    expect(res).toBe('Date?'); // Asks again because date is required and extraction failed
    // 5. Collect date
    llmMock.extractedFieldMock = '2026-09-10';
    res = await engine.handleMessage(tenant.id, extId, 'Next thursday');
    expect(res).toBe('Duration?');
    // 6. Collect duration
    llmMock.extractedFieldMock = 60;
    res = await engine.handleMessage(tenant.id, extId, '1 hour');
    expect(res).toContain('confirm'); // Should reach confirmation
    // 7. Confirm workflow
    llmMock.intentMock = 'confirmed';
    res = await engine.handleMessage(tenant.id, extId, 'yes');
    expect(res).toBe('Session Scheduled.');
    // 8. Verify data storage
    const conv = await prisma.conversation.findFirst({ where: { customer: { externalId: extId } }});
    const session = await prisma.workflowSession.findFirst({ where: { conversationId: conv!.id }, orderBy: { createdAt: 'desc' } });
    expect(session!.status).toBe('COMPLETED');
    expect(session!.contextData).toMatchObject({
      studentName: 'Alex',
      subject: 'Physics',
      date: '2026-09-10',
      duration: 60
    });
  });
  it('2. Second workflow test to prove architecture is purely generic (CUSTOM_REQUEST)', async () => {
    const tenant = await prisma.tenant.create({ data: { name: 'Engine Test Tenant 2' } });
    const workflowDef = {
      id: 'CUSTOM_REQUEST',
      initialState: 's1',
      states: {
        s1: { id: 's1', type: 'collect', field: { name: 'requester', type: 'string', required: true, extractionPrompt: 'Who?' }, transitions: [{ target: 's2' }] },
        s2: { id: 's2', type: 'collect', field: { name: 'category', type: 'string', required: true, extractionPrompt: 'Cat?' }, transitions: [{ target: 's3' }] },
        s3: { id: 's3', type: 'collect', field: { name: 'priority', type: 'string', required: true, extractionPrompt: 'Prio?' }, transitions: [{ target: 's4' }] },
        s4: { id: 's4', type: 'collect', field: { name: 'description', type: 'string', required: true, extractionPrompt: 'Desc?' }, transitions: [{ target: 'end' }] },
        end: { id: 'end', type: 'end', prompt: 'Request Logged.', transitions: [] }
      }
    };
    await prisma.tenantConfig.create({
      data: { tenantId: tenant.id, config: { workflows: { 'CUSTOM_REQUEST': workflowDef } } }
    });
    const extId = 'cust_2';
    let res = await engine.handleMessage(tenant.id, extId, 'CUSTOM_REQUEST');
    expect(res).toBe('Who?');
    llmMock.extractedFieldMock = 'Sarah';
    res = await engine.handleMessage(tenant.id, extId, 'Sarah');
    expect(res).toBe('Cat?');
    llmMock.extractedFieldMock = 'IT';
    res = await engine.handleMessage(tenant.id, extId, 'IT');
    expect(res).toBe('Prio?');
    llmMock.extractedFieldMock = 'High';
    res = await engine.handleMessage(tenant.id, extId, 'High');
    expect(res).toBe('Desc?');
    llmMock.extractedFieldMock = 'Server down';
    res = await engine.handleMessage(tenant.id, extId, 'Server down');
    expect(res).toBe('Request Logged.');
    const conv = await prisma.conversation.findFirst({ where: { customer: { externalId: extId } }});
    const session = await prisma.workflowSession.findFirst({ where: { conversationId: conv!.id } });
    expect(session!.status).toBe('COMPLETED');
    expect(session!.contextData).toMatchObject({
      requester: 'Sarah',
      category: 'IT',
      priority: 'High',
      description: 'Server down'
    });
  });
  it('3. Two tenants cannot access each others conversations (Tenant Isolation)', async () => {
    const tenantA = await prisma.tenant.create({ data: { name: 'A' } });
    const tenantB = await prisma.tenant.create({ data: { name: 'B' } });
    await prisma.tenantConfig.create({ data: { tenantId: tenantA.id, config: {} } });
    await prisma.tenantConfig.create({ data: { tenantId: tenantB.id, config: {} } });
    await engine.handleMessage(tenantA.id, 'shared_ext_id', 'Hello A');
    await engine.handleMessage(tenantB.id, 'shared_ext_id', 'Hello B');
    // Check separation
    const custA = await prisma.customer.findUnique({ where: { tenantId_externalId: { tenantId: tenantA.id, externalId: 'shared_ext_id' } }});
    const convA = await prisma.conversation.findFirst({ where: { customerId: custA!.id } });
    const msgsA = await prisma.message.findMany({ where: { conversationId: convA!.id, role: 'USER' } });
    expect(msgsA[0].content).toBe('Hello A');
    const custB = await prisma.customer.findUnique({ where: { tenantId_externalId: { tenantId: tenantB.id, externalId: 'shared_ext_id' } }});
    const convB = await prisma.conversation.findFirst({ where: { customerId: custB!.id } });
    const msgsB = await prisma.message.findMany({ where: { conversationId: convB!.id, role: 'USER' } });
    expect(msgsB[0].content).toBe('Hello B');
    // Total separation proved
    expect(msgsA.length).toBe(1);
    expect(msgsB.length).toBe(1);
  });
  it('4. LLM failure does not corrupt workflow state', async () => {
    const tenant = await prisma.tenant.create({ data: { name: 'Fail' } });
    await prisma.tenantConfig.create({
      data: {
        tenantId: tenant.id,
        config: {
          workflows: {
            'TEST': {
              id: 'TEST',
              initialState: 's1',
              states: {
                s1: { id: 's1', type: 'collect', field: { name: 'f1', type: 'string', required: true, extractionPrompt: 'Q1' }, transitions: [{ target: 'end' }] },
                end: { id: 'end', type: 'end', prompt: 'Done', transitions: [] }
              }
            }
          }
        }
      }
    });
    let res = await engine.handleMessage(tenant.id, 'ext', 'TEST');
    expect(res).toBe('Q1');
    llmMock.shouldFail = true; // Trigger LLM Error
    res = await engine.handleMessage(tenant.id, 'ext', 'answer');
    // State should not be corrupted, should gracefully fall back to asking again
    expect(res).toBe('Q1');
    llmMock.shouldFail = false;
    llmMock.extractedFieldMock = 'Ans';
    res = await engine.handleMessage(tenant.id, 'ext', 'answer');
    expect(res).toBe('Done');
  });
  it('5. Cannot jump to an unauthorized state (Invalid configuration fails safely)', async () => {
    const tenant = await prisma.tenant.create({ data: { name: 'Invalid' } });
    await prisma.tenantConfig.create({
      data: {
        tenantId: tenant.id,
        config: {
          workflows: {
            'BAD': {
              id: 'BAD',
              initialState: 's1',
              states: {
                s1: { id: 's1', type: 'message', prompt: 'Hello', transitions: [{ target: 'non_existent_state', default: true }] }
              }
            }
          }
        }
      }
    });
    // Should crash safely and terminate workflow gracefully if unauthorized transition
    await expect(engine.handleMessage(tenant.id, 'ext3', 'BAD')).rejects.toThrow(/Unauthorized or missing target state: non_existent_state/);
  });
  it('6. Configurable Prompts: Two tenants have different conversational behaviors', async () => {
    const tenantA = await prisma.tenant.create({ data: { name: 'Prompt A' } });
    const tenantB = await prisma.tenant.create({ data: { name: 'Prompt B' } });
    await prisma.tenantConfig.create({
      data: { tenantId: tenantA.id, config: { prompts: { system: 'I am Bot A, please rephrase.' } } }
    });
    await prisma.tenantConfig.create({
      data: { tenantId: tenantB.id, config: { prompts: { system: 'I am Bot B, what do you mean?' } } }
    });
    // Override mock to return the system prompt to verify injection
    const origGen = llmMock.generateResponse;
    llmMock.generateResponse = async (systemPrompt, history) => systemPrompt;
    // Send unrecognized messages to trigger fallback
    const resA = await engine.handleMessage(tenantA.id, 'ext', 'jibberish');
    const resB = await engine.handleMessage(tenantB.id, 'ext', 'jibberish');
    llmMock.generateResponse = origGen;
    expect(resA).toContain('I am Bot A, please rephrase.');
    expect(resB).toContain('I am Bot B, what do you mean?');
  });
  it('7. Generic validation rejects invalid LLM output and prevents state mutation', async () => {
    const tenant = await prisma.tenant.create({ data: { name: 'Val Tenant' } });
    const workflowDef = {
      id: 'VAL_TEST',
      initialState: 's1',
      states: {
        s1: { id: 's1', type: 'collect', field: { name: 'age', type: 'number', required: true, min: 18, max: 99, extractionPrompt: 'Age?' }, transitions: [{ target: 's2' }] },
        s2: { id: 's2', type: 'collect', field: { name: 'code', type: 'string', required: true, minLength: 3, maxLength: 5, extractionPrompt: 'Code?' }, transitions: [{ target: 'end' }] },
        end: { id: 'end', type: 'end', prompt: 'Done', transitions: [] }
      }
    };
    await prisma.tenantConfig.create({
      data: { tenantId: tenant.id, config: { workflows: { 'VAL_TEST': workflowDef } } }
    });
    const extId = 'val_cust';
    // 1. Start
    let res = await engine.handleMessage(tenant.id, extId, 'VAL_TEST');
    expect(res).toBe('Age?');
    // 2. Reject age < 18
    llmMock.extractedFieldMock = 15;
    res = await engine.handleMessage(tenant.id, extId, '15');
    // Validation fails, should prepend error
    expect(res).toBe('Value must be at least 18. Age?');
    // 3. Reject age > 99
    llmMock.extractedFieldMock = 150;
    res = await engine.handleMessage(tenant.id, extId, '150');
    expect(res).toBe('Value must be at most 99. Age?');
    // 4. Accept valid age
    llmMock.extractedFieldMock = 25;
    res = await engine.handleMessage(tenant.id, extId, '25');
    expect(res).toBe('Code?'); // Moved to next state
    // 5. Reject short code
    llmMock.extractedFieldMock = 'AB';
    res = await engine.handleMessage(tenant.id, extId, 'AB');
    expect(res).toBe('Length must be at least 3. Code?');
    // 6. Reject long code
    llmMock.extractedFieldMock = 'ABCDEF';
    res = await engine.handleMessage(tenant.id, extId, 'ABCDEF');
    expect(res).toBe('Length must be at most 5. Code?');
    // 7. Accept valid code
    llmMock.extractedFieldMock = 'ABCD';
    res = await engine.handleMessage(tenant.id, extId, 'ABCD');
    expect(res).toBe('Done');
    // Verify state was correctly protected until valid input
    const conv = await prisma.conversation.findFirst({ where: { customer: { externalId: extId } }});
    const session = await prisma.workflowSession.findFirst({ where: { conversationId: conv!.id } });
    expect(session!.status).toBe('COMPLETED');
    expect(session!.contextData).toMatchObject({
      age: 25,
      code: 'ABCD'
    });
  });

  it('9. Should inject behavior flags into system prompt when configured', async () => {
    const tenantId = 'behavior-test-tenant';
    const extId = 'behavior-user-1';

    await prisma.tenant.create({ data: { id: tenantId, name: 'Behavior Test' }});
    await prisma.tenantConfig.create({
      data: {
        tenantId,
        config: {
          behavior: {
            stayOnTopic: true,
            allowSmallTalk: false,
            answerOnlyFromKnowledge: true
          }
        }
      }
    });

    const res = await engine.handleMessage(tenantId, extId, 'write me a poem');
    
    // We mock the LLM, so the response is just the mocked response.
    // We need to assert that the injected system prompt correctly contains the behavior rules.
    expect(llmMock.lastSystemPrompt).toContain('strictly stay on topic');
    expect(llmMock.lastSystemPrompt).toContain('Small talk and casual greetings are not allowed');
    expect(llmMock.lastSystemPrompt).toContain('ONLY use retrieved context to answer');
  });
});