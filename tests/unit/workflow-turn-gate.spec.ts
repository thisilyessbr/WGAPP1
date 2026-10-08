import { describe, expect, it } from 'vitest';
import { WorkflowSession } from '@prisma/client';
import { LLMMockProvider } from '../../src/core/llm/LLMProvider';
import { WorkflowEngine } from '../../src/core/engine/WorkflowEngine';
import { WorkflowStateEvaluator } from '../../src/core/engine/WorkflowStateEvaluator';
import { WorkflowTurnGate } from '../../src/core/engine/WorkflowTurnGate';
import { AnswerComposer } from '../../src/domain/conversation/AnswerComposer';
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

  it('recognizes a one-character typo in a question opener without relying on AI', async () => {
    const llm = new LLMMockProvider();
    expect(await WorkflowTurnGate.classify('wqch chatbit likatbi3o mzyan', 'fullName', nameField, prompt, llm))
      .toBe('CUSTOMER_QUESTION');
    expect(llm.callCount).toBe(0);
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
    expect(await WorkflowTurnGate.classify('no idea about this', 'businessNeed', field,
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

  it('answers an interrupted question from approved business facts, then asks for the pending name', async () => {
    const llm = new LLMMockProvider();
    llm.generatedResponseMock = 'Relayqo كيجاوب زبناء نشاطك وكيجمع الطلبات؛ فالديمو تقدر تشوف واش مناسب ليك.';
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
      contextData: { _started: true }, collectedData: {},
      createdAt: new Date(), updatedAt: new Date()
    } as WorkflowSession;
    const config = {
      ...DEFAULT_BUSINESS_CONFIG,
      portalFacts: { description: 'Relayqo كيجاوب الزبناء من معلومات النشاط المعتمدة. كيجمع الطلبات باش يتابعها الفريق.' },
      workflows: { demo: workflow }
    };
    const result = await new WorkflowEngine(new WorkflowStateEvaluator()).process(
      session, 'wqch chatbit likatbi3o mzyan', workflow, config, llm,
      undefined, undefined, undefined, 'darija', 'arabic'
    );
    expect(result.response).toContain(config.portalFacts.description);
    expect(result.response).toContain('فالديمو تقدر تشوف واش مناسب لنشاطك.');
    expect(result.response).toContain(prompt);
    expect(result.nextStateId).toBe('name');
    expect(result.updatedCollectedData).toEqual({});
  });

  it('resumes demo intake after a language question and saves the clothing activity despite a colliding FAQ', async () => {
    const llm = new LLMMockProvider();
    const workflow: WorkflowConfig = {
      id: 'demo', name: 'Demo', description: 'Demo request', initialState: 'need',
      states: {
        need: { type: 'collect', prompt: 'شنو كيدير النشاط ديالك؟',
          field: { name: 'businessNeed', type: 'string', required: true }, next: 'time' },
        time: { type: 'collect', prompt: 'شنو النهار اللي يناسبك؟',
          field: { name: 'preferredDemoTime', type: 'string', required: true }, next: 'done' },
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
            answer: 'مساعد التجارة كيعاون البائعين.', language: 'darija' }
        ]
      }
    };
    const engine = new WorkflowEngine(new WorkflowStateEvaluator());
    const interruption = await engine.process(session, 'wach kaydwi ffrancais', workflow, config,
      llm, undefined, undefined, undefined, 'darija', 'arabic');
    expect(interruption.nextStateId).toBe('need');
    expect(interruption.updatedCollectedData).toEqual({ fullName: 'Ilyes Saber' });
    expect(interruption.response).toContain('كيجاوب بالفرنسية');
    expect(interruption.response).toContain('شنو كيدير النشاط');

    llm.intentMock = 'FIELD_ANSWER';
    const resumed = await engine.process({ ...session, stateId: interruption.nextStateId!,
      contextData: interruption.updatedContext, collectedData: interruption.updatedCollectedData! },
    'kanbi3 srawl djine ou l7wayj', workflow, config,
    llm, undefined, undefined, undefined, 'darija', 'arabic');
    expect(resumed.nextStateId).toBe('time');
    expect(resumed.updatedCollectedData).toEqual({ fullName: 'Ilyes Saber', businessNeed: 'kanbi3 srawl djine ou l7wayj' });
    expect(resumed.response).toContain('شنو النهار');
    expect(resumed.response).not.toContain('مساعد التجارة');
  });

  it('keeps the pending question visible when a side-answer exceeds the reply limit', () => {
    const question = 'شنو كيدير النشاط ديالك؟';
    const answer = 'Relayqo كيجاوب بالدارجة والعربية والفرنسية والإنجليزية. '.repeat(9);
    const response = AnswerComposer.finalizeResponse(`${answer}\n\n---\n${question}`, null,
      DEFAULT_BUSINESS_CONFIG, { maxResponseLength: 150, preserveTrailingWorkflowPrompt: true });
    expect(response).toContain(question);
    expect(response.length).toBeLessThanOrEqual(150);
  });
});
