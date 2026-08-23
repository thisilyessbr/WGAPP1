import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { prisma, pool } from '../../src/tests/testDb';
import { bootstrapChatbot } from '../../src/bootstrap';
import { DEFAULT_BUSINESS_CONFIG } from '../../src/domain/tenant/BusinessConfig';
import { LLMMockProvider } from '../../src/core/llm/LLMProvider';

describe('Phase 12: Workflow Conversation Hardening Tests', () => {
  let deps: ReturnType<typeof bootstrapChatbot>;
  let mockLlm: LLMMockProvider;

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
    mockLlm = new LLMMockProvider();
    deps.llmFactory.registerProvider('mock', 'mock-model', mockLlm);
    deps.tenantConfigService.clearCache();
  });

  const testWorkflowConfig = {
    ...DEFAULT_BUSINESS_CONFIG,
    workflows: {
      lead_capture: {
        id: 'lead_capture',
        name: 'Lead Capture',
        initialState: 'ask_name',
        states: {
          ask_name: {
            id: 'ask_name',
            type: 'collect',
            field: { name: 'fullName', type: 'string', required: true, extractionPrompt: 'What is your name?' },
            transitions: [{ target: 'ask_email' }]
          },
          ask_email: {
            id: 'ask_email',
            type: 'collect',
            field: {
              name: 'email',
              type: 'string',
              required: true,
              validationRegex: '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$',
              extractionPrompt: 'What is your email address?'
            },
            transitions: [{ target: 'confirm_details' }]
          },
          confirm_details: {
            id: 'confirm_details',
            type: 'choice',
            prompt: 'Do you confirm your details?',
            options: [
              { label: 'Yes', next: 'completed' },
              { label: 'No', next: 'ask_name' }
            ]
          },
          completed: {
            id: 'completed',
            type: 'end',
            prompt: 'Workflow finished successfully! Thank you.',
            transitions: []
          }
        }
      }
    },
    capabilities: {
      ...DEFAULT_BUSINESS_CONFIG.capabilities,
      faq: [
        {
          id: 'faq-hours',
          question: 'What are your opening hours?',
          answer: 'We are open Monday to Friday from 9am to 6pm.',
          questions: { en: 'What are your opening hours?' },
          answers: { en: 'We are open Monday to Friday from 9am to 6pm.' }
        }
      ]
    }
  };

  it('1. Normal Workflow Progression: Collects fields, confirms, and completes session', async () => {
    const tenant = await prisma.tenant.create({
      data: {
        name: `Tenant-Wf-Norm-${Date.now()}`,
        config: { create: { config: testWorkflowConfig } }
      }
    });

    const custId = `cust-wf-norm-${Date.now()}`;

    // Turn 1: Initial message triggers workflow at ask_name
    const res1 = await deps.conversationEngine.handleMessage(tenant.id, custId, 'start');
    expect(res1).toContain('What is your name?');

    // Turn 2: Provide Name -> transitions to ask_email
    const res2 = await deps.conversationEngine.handleMessage(tenant.id, custId, 'John Doe');
    expect(res2).toContain('What is your email address?');

    // Turn 3: Provide Email -> transitions to confirm_details
    const res3 = await deps.conversationEngine.handleMessage(tenant.id, custId, 'john.doe@example.com');
    expect(res3).toContain('Do you confirm your details?');

    // Turn 4: Confirm Yes -> completes workflow
    const res4 = await deps.conversationEngine.handleMessage(tenant.id, custId, 'Yes');
    expect(res4).toContain('Workflow finished successfully!');

    // Verify session status in DB
    const session = await prisma.workflowSession.findFirst({
      where: { tenantId: tenant.id, conversation: { customer: { externalId: custId } } }
    });
    expect(session?.status).toBe('COMPLETED');
    expect((session?.collectedData as any)?.fullName).toBe('John Doe');
    expect((session?.collectedData as any)?.email).toBe('john.doe@example.com');
  }, 25000);

  it('2. Invalid Input Recovery: Rejects malformed email, reprompts, and does not advance state', async () => {
    const tenant = await prisma.tenant.create({
      data: {
        name: `Tenant-Wf-Invalid-${Date.now()}`,
        config: { create: { config: testWorkflowConfig } }
      }
    });

    const custId = `cust-wf-invalid-${Date.now()}`;
    await deps.conversationEngine.handleMessage(tenant.id, custId, 'start');
    await deps.conversationEngine.handleMessage(tenant.id, custId, 'Alice Smith');

    // Attempt invalid email
    const resInvalid = await deps.conversationEngine.handleMessage(tenant.id, custId, 'not-an-email');
    expect(resInvalid).toContain('Value format is invalid');
    expect(resInvalid).toContain('What is your email address?');

    // Check DB: state remains ask_email
    const session = await prisma.workflowSession.findFirst({
      where: { tenantId: tenant.id, conversation: { customer: { externalId: custId } } }
    });
    expect(session?.stateId).toBe('ask_email');
    expect(session?.status).toBe('ACTIVE');
    expect((session?.collectedData as any)?.email).toBeUndefined();
  }, 25000);

  it('3. Mid-Workflow FAQ Interruption & Seamless Return: Answers FAQ and preserves field collection', async () => {
    const tenant = await prisma.tenant.create({
      data: {
        name: `Tenant-Wf-Faq-${Date.now()}`,
        config: { create: { config: testWorkflowConfig } }
      }
    });

    const custId = `cust-wf-faq-${Date.now()}`;
    await deps.conversationEngine.handleMessage(tenant.id, custId, 'start');
    await deps.conversationEngine.handleMessage(tenant.id, custId, 'Bob Builder');

    // In ask_email state, user asks an FAQ question
    const resFaq = await deps.conversationEngine.handleMessage(tenant.id, custId, 'What are your opening hours?');
    expect(resFaq).toContain('We are open Monday to Friday from 9am to 6pm.');
    expect(resFaq).toContain('What is your email address?');

    // User now answers the original question
    const resResume = await deps.conversationEngine.handleMessage(tenant.id, custId, 'bob@builder.com');
    expect(resResume).toContain('Do you confirm your details?');

    const session = await prisma.workflowSession.findFirst({
      where: { tenantId: tenant.id, conversation: { customer: { externalId: custId } } }
    });
    expect(session?.stateId).toBe('confirm_details');
    expect((session?.collectedData as any)?.email).toBe('bob@builder.com');
  }, 25000);

  it('4. Deterministic Cancellation: "cancel" terminates active session with 0 LLM calls', async () => {
    const tenant = await prisma.tenant.create({
      data: {
        name: `Tenant-Wf-Cancel-${Date.now()}`,
        config: { create: { config: testWorkflowConfig } }
      }
    });

    let llmCalled = false;
    mockLlm.generateResponse = async () => {
      llmCalled = true;
      return 'LLM response';
    };

    const custId = `cust-wf-cancel-${Date.now()}`;
    await deps.conversationEngine.handleMessage(tenant.id, custId, 'start');

    const resCancel = await deps.conversationEngine.handleMessage(tenant.id, custId, 'cancel');
    expect(resCancel).toContain('cancelled');
    expect(llmCalled).toBe(false);

    const session = await prisma.workflowSession.findFirst({
      where: { tenantId: tenant.id, conversation: { customer: { externalId: custId } } }
    });
    expect(session?.status).toBe('CANCELLED');
  }, 20000);

  it('5. Choice Matching Hardening: "Not now" does NOT accidentally match "No"', async () => {
    const tenant = await prisma.tenant.create({
      data: {
        name: `Tenant-Wf-Choice-${Date.now()}`,
        config: { create: { config: testWorkflowConfig } }
      }
    });

    const custId = `cust-wf-choice-${Date.now()}`;
    await deps.conversationEngine.handleMessage(tenant.id, custId, 'start');
    await deps.conversationEngine.handleMessage(tenant.id, custId, 'Charlie Brown');
    await deps.conversationEngine.handleMessage(tenant.id, custId, 'charlie@brown.com');

    // At confirm_details: options are "Yes" and "No"
    // User says "Not now" -> should NOT match "No"
    const resNotNow = await deps.conversationEngine.handleMessage(tenant.id, custId, 'Not now');
    expect(resNotNow).toContain('1. Yes');
    expect(resNotNow).toContain('2. No');

    const session = await prisma.workflowSession.findFirst({
      where: { tenantId: tenant.id, conversation: { customer: { externalId: custId } } }
    });
    expect(session?.stateId).toBe('confirm_details');
  }, 25000);

  it('6. Human Handoff during workflow flags humanRequested and halts automatic state mutation', async () => {
    const tenant = await prisma.tenant.create({
      data: {
        name: `Tenant-Wf-Handoff-${Date.now()}`,
        config: { create: { config: testWorkflowConfig } }
      }
    });

    const custId = `cust-wf-handoff-${Date.now()}`;
    await deps.conversationEngine.handleMessage(tenant.id, custId, 'start');

    await deps.conversationEngine.handleMessage(tenant.id, custId, 'talk to a human');

    const conv = await prisma.conversation.findFirst({
      where: { tenantId: tenant.id, customer: { externalId: custId } }
    });
    expect(conv?.humanRequested).toBe(true);
  }, 20000);
});
