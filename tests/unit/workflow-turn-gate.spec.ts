import { describe, expect, it } from 'vitest';
import { WorkflowSession } from '@prisma/client';
import { LLMMockProvider } from '../../src/core/llm/LLMProvider';
import { WorkflowEngine } from '../../src/core/engine/WorkflowEngine';
import { WorkflowStateEvaluator } from '../../src/core/engine/WorkflowStateEvaluator';
import { WorkflowTurnGate } from '../../src/core/engine/WorkflowTurnGate';
import { DEFAULT_BUSINESS_CONFIG, WorkflowConfig } from '../../src/domain/tenant/BusinessConfig';

const nameField = { name: 'fullName', type: 'string' as const, required: true, semanticType: 'person_name' as const };
const prompt = 'شنو سميتك باش نسجلو طلب الديمو؟';

describe('workflow turn gate', () => {
  it('routes typo-heavy Darija product questions without saving them as names', async () => {
    const llm = new LLMMockProvider();
    llm.intentMock = 'CUSTOMER_QUESTION';
    expect(await WorkflowTurnGate.classify('wqch chatbit likatbi3o mzyan', 'fullName', nameField, prompt, llm))
      .toBe('CUSTOMER_QUESTION');
  });

  it('fails closed on an unclassified long reply instead of corrupting a name', async () => {
    const llm = new LLMMockProvider();
    expect(await WorkflowTurnGate.classify('wqch chatbit likatbi3o mzyan', 'fullName', nameField, prompt, llm))
      .toBe('UNCLEAR');
  });

  it('accepts an ordinary name without requiring AI availability', async () => {
    expect(await WorkflowTurnGate.classify('Ilyes Saber', 'fullName', nameField, prompt))
      .toBe('FIELD_ANSWER');
  });

  it('uses the same gate while collecting a typed field', async () => {
    const llm = new LLMMockProvider();
    llm.intentMock = 'CUSTOMER_QUESTION';
    expect(await WorkflowTurnGate.classify('wqch chatbit likatbi3o mzyan', 'phone',
      { name: 'phone', type: 'phone', required: true }, 'شنو رقم الهاتف؟', llm))
      .toBe('CUSTOMER_QUESTION');
  });

  it('does not save ambiguous free text when the classifier cannot decide', async () => {
    const llm = new LLMMockProvider();
    const field = { name: 'businessNeed', type: 'string' as const, required: true, semanticType: 'free_text' as const };
    expect(await WorkflowTurnGate.classify('wqch chatbit likatbi3o mzyan', 'businessNeed', field,
      'شنو بغيتي تحسن؟', llm)).toBe('UNCLEAR');
    llm.intentMock = 'FIELD_ANSWER';
    expect(await WorkflowTurnGate.classify('For ecommerce diali', 'businessNeed', field,
      'شنو بغيتي تحسن؟', llm)).toBe('FIELD_ANSWER');
  });

  it('preserves state and collected details for a mid-form question', async () => {
    const llm = new LLMMockProvider();
    llm.intentMock = 'CUSTOMER_QUESTION';
    const workflow: WorkflowConfig = {
      id: 'demo', name: 'Demo', description: 'Demo request', initialState: 'name',
      states: {
        name: { type: 'collect', prompt, field: nameField, next: 'need' },
        need: { type: 'collect', prompt: 'شنو النشاط ديالك؟', field: { name: 'businessNeed', type: 'string', required: true }, next: 'done' },
        done: { type: 'end', prompt: 'Thanks' }
      }
    };
    const session = {
      id: 's1', tenantId: 't1', conversationId: 'c1', workflowId: 'demo',
      stateId: 'name', stateHistory: [], status: 'ACTIVE',
      contextData: { _started: true }, collectedData: { source: 'WhatsApp' },
      createdAt: new Date(), updatedAt: new Date()
    } as WorkflowSession;
    const engine = new WorkflowEngine(new WorkflowStateEvaluator());
    const config = { ...DEFAULT_BUSINESS_CONFIG, workflows: { demo: workflow } };
    const result = await engine.process(session, 'wqch chatbit likatbi3o mzyan', workflow,
      config, llm, undefined, undefined, undefined, 'darija', 'arabic');
    expect(result.nextStateId).toBe('name');
    expect(result.updatedCollectedData).toEqual({ source: 'WhatsApp' });
    expect(result.response).toContain(prompt);

    llm.intentMock = 'FIELD_ANSWER';
    const resumed = await engine.process({ ...session, stateId: result.nextStateId!,
      contextData: result.updatedContext, collectedData: result.updatedCollectedData! },
      'Ilyes Saber', workflow, config, llm, undefined, undefined, undefined, 'darija', 'arabic');
    expect(resumed.nextStateId).toBe('need');
    expect(resumed.updatedCollectedData).toEqual({ source: 'WhatsApp', fullName: 'Ilyes Saber' });
  });
});
