import { describe, it, expect } from 'vitest';
import { WorkflowEngine } from '../core/engine/WorkflowEngine';
import { WorkflowStateEvaluator } from '../core/engine/WorkflowStateEvaluator';
import { FieldValidator } from '../core/engine/FieldValidator';
import { ResponseBuilder } from '../domain/conversation/ResponseBuilder';
import { DEFAULT_BUSINESS_CONFIG, WorkflowConfig } from '../domain/tenant/BusinessConfig';
import { WorkflowSession } from '@prisma/client';

describe('Minimal Choice-Based Workflow Engine', () => {
  const evaluator = new WorkflowStateEvaluator();
  const responseBuilder = new ResponseBuilder();
  const fieldValidator = new FieldValidator();
  const workflowEngine = new WorkflowEngine(evaluator, undefined, responseBuilder, fieldValidator);

  const testWorkflow: WorkflowConfig = {
    id: 'help_workflow',
    name: 'Help Desk Intake',
    description: 'Guided intake for customer inquiries',
    initialState: 'choice_category',
    states: {
      choice_category: {
        id: 'choice_category',
        type: 'choice',
        prompt: 'What do you need help with?',
        options: [
          { label: 'Sales', next: 'choice_sales' },
          { label: 'Support', next: 'choice_support' }
        ]
      },
      choice_sales: {
        id: 'choice_sales',
        type: 'choice',
        prompt: 'Which plan are you interested in?',
        options: [
          { label: 'Starter Plan', next: 'confirm_choice' },
          { label: 'Enterprise Plan', next: 'confirm_choice' }
        ]
      },
      choice_support: {
        id: 'choice_support',
        type: 'choice',
        prompt: 'What type of support do you need?',
        options: [
          { label: 'Billing Question', next: 'confirm_choice' },
          { label: 'Technical Assistance', next: 'confirm_choice' }
        ]
      },
      confirm_choice: {
        id: 'confirm_choice',
        type: 'confirm',
        prompt: 'Please confirm your request details:\n{{summary}}\n\n(Reply "yes" to confirm or "no" to cancel)',
        confirmKeywords: ['yes', 'confirm', 'oui'],
        cancelKeywords: ['no', 'cancel', 'non'],
        transitions: [{ target: 'end_state' }]
      },
      end_state: {
        id: 'end_state',
        type: 'end',
        prompt: 'Thank you! Your request has been recorded.'
      }
    }
  };

  const createMockSession = (stateId: string, contextData: any = {}): WorkflowSession => ({
    id: 'mock-session-1',
    tenantId: 'test-tenant',
    conversationId: 'conv-1',
    workflowId: 'help_workflow',
    stateId,
    status: 'ACTIVE',
    contextData,
    createdAt: new Date(),
    updatedAt: new Date()
  });

  it('1. Initial entry presents choice1 prompt and numbered options', async () => {
    const session = createMockSession('choice_category', {});
    const res = await workflowEngine.process(session, 'I need help', testWorkflow, DEFAULT_BUSINESS_CONFIG);
    
    expect(res.isComplete).toBe(false);
    expect(res.nextStateId).toBe('choice_category');
    expect(res.response).toContain('What do you need help with?');
    expect(res.response).toContain('1. Sales');
    expect(res.response).toContain('2. Support');
  });

  it('2. Selecting a choice by number (1) advances to choice2 (Sales)', async () => {
    const session = createMockSession('choice_category', { _started: true });
    const res = await workflowEngine.process(session, '1', testWorkflow, DEFAULT_BUSINESS_CONFIG);
    
    expect(res.isComplete).toBe(false);
    expect(res.nextStateId).toBe('choice_sales');
    expect(res.updatedContext['choice_category']).toBe('Sales');
    expect(res.response).toContain('Which plan are you interested in?');
    expect(res.response).toContain('1. Starter Plan');
    expect(res.response).toContain('2. Enterprise Plan');
  });

  it('3. Selecting a choice by label text ("Support") advances to choice2 (Support)', async () => {
    const session = createMockSession('choice_category', { _started: true });
    const res = await workflowEngine.process(session, 'Support', testWorkflow, DEFAULT_BUSINESS_CONFIG);
    
    expect(res.isComplete).toBe(false);
    expect(res.nextStateId).toBe('choice_support');
    expect(res.updatedContext['choice_category']).toBe('Support');
    expect(res.response).toContain('What type of support do you need?');
    expect(res.response).toContain('1. Billing Question');
    expect(res.response).toContain('2. Technical Assistance');
  });

  it('4. Off-topic reply redirects back to current choice and does NOT advance', async () => {
    const session = createMockSession('choice_sales', { _started: true, choice_category: 'Sales' });
    const res = await workflowEngine.process(session, "what's the weather today?", testWorkflow, DEFAULT_BUSINESS_CONFIG);
    
    expect(res.isComplete).toBe(false);
    expect(res.nextStateId).toBe('choice_sales'); // Stays in choice_sales
    expect(res.response).toContain("Let's finish this first — please choose one of the options above.");
    expect(res.response).toContain('Which plan are you interested in?');
    expect(res.response).toContain('1. Starter Plan');
  });

  it('5. Valid choice2 reply advances to confirm state', async () => {
    const session = createMockSession('choice_sales', { _started: true, choice_category: 'Sales' });
    const res = await workflowEngine.process(session, '1', testWorkflow, DEFAULT_BUSINESS_CONFIG);
    
    expect(res.isComplete).toBe(false);
    expect(res.nextStateId).toBe('confirm_choice');
    expect(res.updatedContext['choice_sales']).toBe('Starter Plan');
    expect(res.response).toContain('Please confirm your request details:');
    expect(res.response).toContain('choice_category: Sales');
    expect(res.response).toContain('choice_sales: Starter Plan');
  });

  it('6. Confirming at confirm state completes the workflow', async () => {
    const session = createMockSession('confirm_choice', {
      _started: true,
      choice_category: 'Sales',
      choice_sales: 'Starter Plan'
    });
    const res = await workflowEngine.process(session, 'yes', testWorkflow, DEFAULT_BUSINESS_CONFIG);
    
    expect(res.isComplete).toBe(true);
    expect(res.response).toContain('Thank you! Your request has been recorded.');
  });

  it('7. Cancelling at confirm state cancels the workflow', async () => {
    const session = createMockSession('confirm_choice', {
      _started: true,
      choice_category: 'Sales',
      choice_sales: 'Starter Plan'
    });
    const res = await workflowEngine.process(session, 'no', testWorkflow, DEFAULT_BUSINESS_CONFIG);
    
    expect(res.isComplete).toBe(true);
    expect(res.nextStateId).toBeNull();
    expect(res.response).toContain('Workflow cancelled.');
  });
});
