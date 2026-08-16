import { describe, it, expect, beforeEach } from 'vitest';
import { WorkflowEngine } from '../core/engine/WorkflowEngine';
import { WorkflowStateEvaluator } from '../core/engine/WorkflowStateEvaluator';
import { FieldValidator } from '../core/engine/FieldValidator';
import { ResponseBuilder } from '../domain/conversation/ResponseBuilder';
import { DEFAULT_BUSINESS_CONFIG, WorkflowConfig, BusinessConfig } from '../domain/tenant/BusinessConfig';
import { WorkflowSession } from '@prisma/client';

describe('Hybrid Mid-Workflow Handling & Global Interrupts', () => {
  const evaluator = new WorkflowStateEvaluator();
  const responseBuilder = new ResponseBuilder();
  const fieldValidator = new FieldValidator();
  const workflowEngine = new WorkflowEngine(evaluator, undefined, responseBuilder, fieldValidator);

  const testConfig: BusinessConfig = {
    ...DEFAULT_BUSINESS_CONFIG,
    capabilities: {
      intents: [],
      faq: [
        {
          id: 'faq_enterprise_pricing',
          questions: {
            en: 'How much is the Enterprise plan?',
            fr: 'Combien coûte le plan Enterprise ?'
          },
          answers: {
            en: 'The Enterprise plan is $299/month and includes unlimited seats, dedicated support, and custom integrations.',
            fr: 'Le forfait Enterprise est à 299 $/mois.'
          },
          keywords: {
            en: ['enterprise', 'price', 'pricing', 'cost', 'how much'],
            fr: ['enterprise', 'prix', 'cout', 'tarif']
          }
        }
      ]
    }
  };

  const testWorkflow: WorkflowConfig = {
    id: 'triage_workflow',
    name: 'Atlas Triage Flow',
    description: 'Support and sales triage',
    initialState: 'step_plans',
    states: {
      step_plans: {
        id: 'step_plans',
        name: 'Plans',
        type: 'choice',
        prompt: 'Which plan would you like to explore?',
        options: [
          { label: 'Starter Plan ($29/mo)', next: 'step_confirm' },
          { label: 'Pro Plan ($99/mo)', next: 'step_confirm' },
          { label: 'Enterprise Plan', next: 'step_confirm' }
        ]
      },
      step_confirm: {
        id: 'step_confirm',
        name: 'Confirm',
        type: 'confirm',
        prompt: 'Please confirm your plan selection:\n{{summary}}',
        transitions: [{ target: 'step_end' }]
      },
      step_end: {
        id: 'step_end',
        name: 'Complete',
        type: 'end',
        prompt: 'Thank you! Your selection is complete.'
      }
    }
  };

  const createMockSession = (stateId: string, contextData: any = {}): WorkflowSession => ({
    id: 'session-123',
    tenantId: 'dev-tenant',
    conversationId: 'conv-123',
    workflowId: 'triage_workflow',
    stateId,
    status: 'ACTIVE',
    contextData,
    createdAt: new Date(),
    updatedAt: new Date()
  });

  it('Check a: Number selection "2" advances to step_confirm via Layer 1 option match', async () => {
    const session = createMockSession('step_plans', { _started: true });
    const res = await workflowEngine.process(session, '2', testWorkflow, testConfig);

    expect(res.isComplete).toBe(false);
    expect(res.nextStateId).toBe('step_confirm');
    expect(res.updatedContext['step_plans']).toBe('Pro Plan ($99/mo)');
    expect(res.response).toContain('Please confirm your plan selection:');
  });

  it('Check b: FAQ question "how much is Enterprise" matches Layer 2 FAQ, answers and re-prompts choice with stateId unchanged', async () => {
    const session = createMockSession('step_plans', { _started: true });
    const res = await workflowEngine.process(session, 'how much is Enterprise', testWorkflow, testConfig);

    expect(res.isComplete).toBe(false);
    expect(res.nextStateId).toBe('step_plans'); // Remains in step_plans!
    expect(res.response).toContain('The Enterprise plan is $299/month and includes unlimited seats');
    expect(res.response).toContain('---');
    expect(res.response).toContain('Which plan would you like to explore?');
    expect(res.response).toContain('1. Starter Plan ($29/mo)');
    expect(res.response).toContain('2. Pro Plan ($99/mo)');
    expect(res.response).toContain('3. Enterprise Plan');
  });

  it('Check c: Vague input "I don\'t know" or "asdf" is NOT matched by FAQ and gets Layer 4 redirect reprompt', async () => {
    const session = createMockSession('step_plans', { _started: true });
    const res1 = await workflowEngine.process(session, "I don't know", testWorkflow, testConfig);

    expect(res1.isComplete).toBe(false);
    expect(res1.nextStateId).toBe('step_plans');
    expect(res1.response).toContain("Let's finish this first — please choose one of the options above.");
    expect(res1.response).not.toContain('The Enterprise plan is $299/month');

    const res2 = await workflowEngine.process(session, 'asdf', testWorkflow, testConfig);
    expect(res2.isComplete).toBe(false);
    expect(res2.nextStateId).toBe('step_plans');
    expect(res2.response).toContain("Let's finish this first — please choose one of the options above.");
    expect(res2.response).not.toContain('The Enterprise plan is $299/month');
  });
});
