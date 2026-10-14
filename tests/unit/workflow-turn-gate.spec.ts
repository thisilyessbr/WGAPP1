import { describe, expect, it } from 'vitest';
import { WorkflowSession } from '@prisma/client';
import { LLMMockProvider } from '../../src/core/llm/LLMProvider';
import { WorkflowEngine } from '../../src/core/engine/WorkflowEngine';
import { WorkflowStateEvaluator } from '../../src/core/engine/WorkflowStateEvaluator';
import { WorkflowTurnGate } from '../../src/core/engine/WorkflowTurnGate';
import { AnswerComposer } from '../../src/domain/conversation/AnswerComposer';
import { FaqAnswerPolicy } from '../../src/domain/faq/FaqAnswerPolicy';
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

  it('recognizes legacy userName fields as names and rejects a phone number in that slot', async () => {
    const llm = new LLMMockProvider();
    llm.intentMock = 'fitness_consultation';
    const field = { name: 'userName', type: 'string' as const, required: true };
    expect(await WorkflowTurnGate.classify('User A', 'userName', field, 'What is your full name?', llm))
      .toBe('FIELD_ANSWER');
    expect(await WorkflowTurnGate.classify('+212600000001', 'userName', field, 'What is your full name?', llm))
      .toBe('UNCLEAR');
  });

  it('uses the same question gate while collecting a typed field', async () => {
    const llm = new LLMMockProvider();
    llm.intentMock = 'CUSTOMER_QUESTION';
    expect(await WorkflowTurnGate.classify('wqch chatbit likatbi3o mzyan', 'phone',
      { name: 'phone', type: 'phone', required: true }, 'شنو رقم الهاتف؟', llm))
      .toBe('CUSTOMER_QUESTION');
  });

  it('does not save ambiguous free text when a configured classifier cannot decide', async () => {
    const llm = new LLMMockProvider();
    const field = { name: 'businessNeed', type: 'string' as const, required: true, semanticType: 'free_text' as const };
    expect(await WorkflowTurnGate.classify('wqch chatbit likatbi3o mzyan', 'businessNeed', field,
      'شنو بغيتي تحسن؟', llm)).toBe('UNCLEAR');
    llm.intentMock = 'FIELD_ANSWER';
    expect(await WorkflowTurnGate.classify('For ecommerce diali', 'businessNeed', field,
      'شنو بغيتي تحسن؟', llm)).toBe('FIELD_ANSWER');
  });

  it('preserves state and previously collected details for an interruption', async () => {
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
    const result = await engine.process(session, 'wqch chatbit likatbi3o mzyan', workflow,
      { ...DEFAULT_BUSINESS_CONFIG, workflows: { demo: workflow } }, llm, undefined, undefined, undefined, 'darija', 'arabic');
    expect(result.nextStateId).toBe('name');
    expect(result.updatedCollectedData).toEqual({ source: 'WhatsApp' });
    expect(result.response).toContain(prompt);

    llm.intentMock = null;
    const resumed = await engine.process({ ...session, stateId: result.nextStateId!,
      contextData: result.updatedContext, collectedData: result.updatedCollectedData! },
      'Ilyes Saber', workflow, { ...DEFAULT_BUSINESS_CONFIG, workflows: { demo: workflow } },
      llm, undefined, undefined, undefined, 'darija', 'arabic');
    expect(resumed.nextStateId).toBe('need');
    expect(resumed.updatedCollectedData).toEqual({ source: 'WhatsApp', fullName: 'Ilyes Saber' });
  });

  it('saves a business description even when its words match a product FAQ', async () => {
    const llm = new LLMMockProvider();
    llm.intentMock = 'FIELD_ANSWER';
    const workflow: WorkflowConfig = {
      id: 'demo', name: 'Demo', description: 'Demo request', initialState: 'need',
      states: {
        need: { type: 'collect', prompt: 'شنو كيدير النشاط ديالك؟', field: { name: 'businessNeed', type: 'string', required: true }, next: 'time' },
        time: { type: 'collect', prompt: 'شنو النهار اللي يناسبك؟', field: { name: 'preferredDemoTime', type: 'string', required: true }, next: 'done' },
        done: { type: 'end', prompt: 'Thanks' }
      }
    };
    const session = {
      id: 's1', tenantId: 't1', conversationId: 'c1', workflowId: 'demo',
      stateId: 'need', stateHistory: ['name'], status: 'ACTIVE',
      contextData: { fullName: 'Ilyes Saber', _started: true }, collectedData: { fullName: 'Ilyes Saber' },
      createdAt: new Date(), updatedAt: new Date()
    } as WorkflowSession;
    const config = {
      ...DEFAULT_BUSINESS_CONFIG,
      workflows: { demo: workflow },
      capabilities: {
        ...DEFAULT_BUSINESS_CONFIG.capabilities,
        faq: [
          { id: 'language', question: 'wach kaydwi ffrancais',
            answer: 'إييه، Relayqo كيجاوب بالفرنسية.', language: 'darija' },
          { id: 'commerce', question: 'kanbi3 srawl djine ou l7wayj',
            answer: 'Our commerce assistant handles product questions.', language: 'darija' }
        ]
      }
    };
    llm.intentMock = 'CUSTOMER_QUESTION';
    const interrupted = await new WorkflowEngine(new WorkflowStateEvaluator()).process(
      session, 'wach kaydwi ffrancais', workflow, config, llm,
      undefined, undefined, undefined, 'darija', 'arabic'
    );
    expect(interrupted.nextStateId).toBe('need');
    expect(interrupted.updatedCollectedData).toEqual({ fullName: 'Ilyes Saber' });
    expect(interrupted.response).toContain('كيجاوب بالفرنسية');
    expect(interrupted.response).toContain('شنو كيدير النشاط');

    llm.intentMock = 'FIELD_ANSWER';
    const result = await new WorkflowEngine(new WorkflowStateEvaluator()).process(
      { ...session, stateId: interrupted.nextStateId!, contextData: interrupted.updatedContext,
        collectedData: interrupted.updatedCollectedData! },
      'kanbi3 srawl djine ou l7wayj', workflow, config, llm,
      undefined, undefined, undefined, 'darija', 'arabic'
    );
    expect(result.nextStateId).toBe('time');
    expect(result.updatedCollectedData).toEqual({ fullName: 'Ilyes Saber', businessNeed: 'kanbi3 srawl djine ou l7wayj' });
    expect(result.response).toContain('شنو النهار');
    expect(result.response).not.toContain('Our commerce assistant');
  });

  it('does not let a partial FAQ answer a two-part question', () => {
    const config = {
      ...DEFAULT_BUSINESS_CONFIG,
      capabilities: {
        ...DEFAULT_BUSINESS_CONFIG.capabilities,
        faq: [{ id: 'price-only', question: 'What is the price and delivery?',
          answer: 'The price is 100 MAD.', language: 'en' }]
      }
    };
    expect(FaqAnswerPolicy.match('What is the price and delivery?', config, 'en')).toBeNull();
  });

  it('retains the pending workflow question when a long FAQ answer is shortened', () => {
    const pendingPrompt = 'شنو كيدير النشاط ديالك؟';
    const answer = 'Relayqo كيجاوب بالدارجة والعربية والفرنسية والإنجليزية. '.repeat(9);
    const response = AnswerComposer.finalizeResponse(`${answer}\n\n---\n${pendingPrompt}`, null,
      DEFAULT_BUSINESS_CONFIG, { maxResponseLength: 150, preserveTrailingWorkflowPrompt: true });
    expect(response).toContain(pendingPrompt);
    expect(response.length).toBeLessThanOrEqual(150);
  });
});
