import { describe, expect, it } from 'vitest';
import { WorkflowSession } from '@prisma/client';
import { LLMMockProvider } from '../../src/core/llm/LLMProvider';
import { WorkflowEngine, WorkflowCancellationDetector } from '../../src/core/engine/WorkflowEngine';
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

  it('separates a clear name-plus-question turn without guessing names from business needs', () => {
    expect(WorkflowTurnGate.splitPersonNameAndQuestion('Ilyes Saber, wach kaydwi français?', 'fullName', nameField))
      .toEqual({ fieldValue: 'Ilyes Saber', question: 'wach kaydwi français?' });
    expect(WorkflowTurnGate.splitPersonNameAndQuestion('kanbi3 srawl djine, wach mzyan?', 'businessNeed',
      { name: 'businessNeed', type: 'string', semanticType: 'free_text' })).toBeNull();
    expect(WorkflowTurnGate.splitPersonNameAndQuestion('wach kaydwi français?', 'fullName', nameField)).toBeNull();
  });

  it('splits a field answer from a following question across Arabic, English and French punctuation', () => {
    const timeField = { name: 'preferredDemoTime', type: 'string' as const, required: true };
    expect(WorkflowTurnGate.splitAnswerAndQuestion('غدا مع 3 العشية. واش كيخدم حتى فـإنستغرام؟', 'preferredDemoTime', timeField))
      .toEqual({ fieldValue: 'غدا مع 3 العشية', question: 'واش كيخدم حتى فـإنستغرام؟' });
    expect(WorkflowTurnGate.splitAnswerAndQuestion('Tomorrow at 3 pm. Does it work on Instagram?', 'preferredDemoTime', timeField))
      .toEqual({ fieldValue: 'Tomorrow at 3 pm', question: 'Does it work on Instagram?' });
    expect(WorkflowTurnGate.splitAnswerAndQuestion('Je gère un salon, mes clientes demandent les horaires. Vous répondez en français ?',
      'businessNeed', { name: 'businessNeed', type: 'string', semanticType: 'free_text' }))
      .toEqual({ fieldValue: 'Je gère un salon, mes clientes demandent les horaires', question: 'Vous répondez en français ?' });
    expect(WorkflowTurnGate.splitAnswerAndQuestion('11.11.2026', 'preferredDemoTime', timeField)).toBeNull();
  });

  it('stores only the person name after a clear introduction', async () => {
    const workflow: WorkflowConfig = { id: 'demo', name: 'Demo', description: 'Demo', initialState: 'name', states: {
      name: { type: 'collect', prompt, field: nameField, next: 'need' },
      need: { type: 'collect', prompt: 'شنو النشاط ديالك؟', field: { name: 'businessNeed', type: 'string', required: true }, next: 'done' },
      done: { type: 'end' }
    } };
    const session = { id: 's1', tenantId: 't1', conversationId: 'c1', workflowId: 'demo', stateId: 'name',
      stateHistory: [], status: 'ACTIVE', contextData: { _started: true }, collectedData: {},
      createdAt: new Date(), updatedAt: new Date() } as WorkflowSession;
    const result = await new WorkflowEngine(new WorkflowStateEvaluator()).process(session, 'سميتي أمين', workflow,
      { ...DEFAULT_BUSINESS_CONFIG, workflows: { demo: workflow } }, undefined, undefined, undefined, undefined, 'darija', 'arabic');
    expect(result.updatedCollectedData).toEqual({ fullName: 'أمين' });
    expect(result.nextStateId).toBe('need');
  });

  it('cancels a demo request during collection without storing the refusal as a business need', async () => {
    const workflow: WorkflowConfig = { id: 'demo', name: 'Demo', description: 'Demo', initialState: 'need', states: {
      need: { type: 'collect', prompt: 'شنو النشاط ديالك؟', field: { name: 'businessNeed', type: 'string', required: true }, next: 'time' },
      time: { type: 'collect', prompt: 'شنو الوقت اللي يناسبك؟', field: { name: 'preferredDemoTime', type: 'string', required: true }, next: 'done' },
      done: { type: 'end' }
    } };
    const session = { id: 's1', tenantId: 't1', conversationId: 'c1', workflowId: 'demo', stateId: 'need',
      stateHistory: [], status: 'ACTIVE', contextData: { _started: true, fullName: 'مريم' }, collectedData: { fullName: 'مريم' },
      createdAt: new Date(), updatedAt: new Date() } as WorkflowSession;
    const message = 'لا، بغيت نلغي طلب الديمو';
    expect(WorkflowCancellationDetector.isCancellation(message)).toBe(true);
    const result = await new WorkflowEngine(new WorkflowStateEvaluator()).process(session, message, workflow,
      { ...DEFAULT_BUSINESS_CONFIG, workflows: { demo: workflow } }, undefined, undefined, undefined, undefined, 'darija', 'arabic');
    expect(result.isComplete).toBe(true);
    expect(result.updatedCollectedData).toEqual({ fullName: 'مريم', _confirmed: false });
    expect(result.response).not.toContain('شنو الوقت');
  });

  it('answers an English side-question in English and saves the time only', async () => {
    const llm = new LLMMockProvider();
    llm.responseResolver = prompt => prompt.includes('previous attempt')
      ? 'Instagram DM is available depending on the plan and connected account.'
      : 'إنستغرام متاح حسب الباقة وربط الحساب.';
    const workflow: WorkflowConfig = { id: 'demo', name: 'Demo', description: 'Demo', initialState: 'time', states: {
      time: { type: 'collect', prompt: 'Which day and time would suit you?', field: { name: 'preferredDemoTime', type: 'string', required: true }, next: 'phone' },
      phone: { type: 'collect', prompt: 'What is your phone number?', field: { name: 'phone', type: 'phone', required: true }, next: 'done' },
      done: { type: 'end' }
    } };
    const session = { id: 's1', tenantId: 't1', conversationId: 'c1', workflowId: 'demo', stateId: 'time',
      stateHistory: [], status: 'ACTIVE', contextData: { _started: true, _lang: 'en', _script: 'latin' }, collectedData: {},
      createdAt: new Date(), updatedAt: new Date() } as WorkflowSession;
    const config = { ...DEFAULT_BUSINESS_CONFIG, portalFacts: { description: 'Instagram DM is available depending on the plan and connected account.' },
      workflows: { demo: workflow } };
    const result = await new WorkflowEngine(new WorkflowStateEvaluator()).process(session,
      'Tomorrow at 3 pm. Does it work on Instagram?', workflow, config, llm, undefined, undefined, undefined, 'en', 'latin');
    expect(result.nextStateId).toBe('phone');
    expect(result.updatedCollectedData).toEqual({ preferredDemoTime: 'Tomorrow at 3 pm' });
    expect(result.response).toContain('Instagram DM is available');
    expect(result.response).toContain('What is your phone number?');
    expect(result.response).not.toMatch(/[\u0621-\u064A]/u);
    expect(llm.callCount).toBe(2);

    llm.responseResolver = () => 'إنستغرام متاح حسب الباقة وربط الحساب.';
    const unavailableTranslation = await new WorkflowEngine(new WorkflowStateEvaluator()).process(session,
      'Tomorrow at 3 pm. Does it work on Instagram?', workflow, config, llm, undefined, undefined, undefined, 'en', 'latin');
    expect(unavailableTranslation.nextStateId).toBe('phone');
    expect(unavailableTranslation.response).not.toMatch(/[\u0621-\u064A]/u);
    expect(unavailableTranslation.response).toContain('What is your phone number?');
    expect(llm.callCount).toBe(4);
  });

  it('answers a Darija Arabic side-question and advances past the captured time', async () => {
    const workflow: WorkflowConfig = { id: 'demo', name: 'Demo', description: 'Demo', initialState: 'time', states: {
      time: { type: 'collect', prompt: 'شنو النهار والوقت اللي يناسبوك؟', field: { name: 'preferredDemoTime', type: 'string', required: true }, next: 'phone' },
      phone: { type: 'collect', prompt: 'شنو الرقم ديالك؟', field: { name: 'phone', type: 'phone', required: true }, next: 'done' },
      done: { type: 'end' }
    } };
    const session = { id: 's1', tenantId: 't1', conversationId: 'c1', workflowId: 'demo', stateId: 'time',
      stateHistory: [], status: 'ACTIVE', contextData: { _started: true, _lang: 'darija', _script: 'arabic' }, collectedData: {},
      createdAt: new Date(), updatedAt: new Date() } as WorkflowSession;
    const config = { ...DEFAULT_BUSINESS_CONFIG, workflows: { demo: workflow }, capabilities: {
      ...DEFAULT_BUSINESS_CONFIG.capabilities,
      faq: [{ id: 'instagram', question: 'واش كيخدم حتى فـإنستغرام؟', answer: 'إييه، إنستغرام متاح حسب الباقة وربط الحساب.', language: 'darija' as const }]
    } };
    const result = await new WorkflowEngine(new WorkflowStateEvaluator()).process(session,
      'غدا مع 3 العشية. واش كيخدم حتى فـإنستغرام؟', workflow, config, undefined, undefined, undefined, undefined, 'darija', 'arabic');
    expect(result.nextStateId).toBe('phone');
    expect(result.updatedCollectedData).toEqual({ preferredDemoTime: 'غدا مع 3 العشية' });
    expect(result.response).toContain('إنستغرام متاح');
    expect(result.response).toContain('شنو الرقم ديالك؟');
  });

  it('answers a question attached to a valid name and advances exactly one form step', async () => {
    const workflow: WorkflowConfig = { id: 'demo', name: 'Demo', description: 'Demo', initialState: 'name', states: {
      name: { type: 'collect', prompt, field: nameField, next: 'need' },
      need: { type: 'collect', prompt: 'شنو النشاط ديالك؟', field: { name: 'businessNeed', type: 'string', required: true }, next: 'done' },
      done: { type: 'end' }
    } };
    const session = { id: 's1', tenantId: 't1', conversationId: 'c1', workflowId: 'demo', stateId: 'name',
      stateHistory: [], status: 'ACTIVE', contextData: { _started: true }, collectedData: {},
      createdAt: new Date(), updatedAt: new Date() } as WorkflowSession;
    const config = { ...DEFAULT_BUSINESS_CONFIG, workflows: { demo: workflow }, capabilities: {
      ...DEFAULT_BUSINESS_CONFIG.capabilities,
      faq: [{ id: 'language', question: 'wach kaydwi francais', answer: 'إييه، كيجاوب بالفرنسية.', language: 'darija' }]
    } };
    const result = await new WorkflowEngine().process(session, 'Ilyes Saber, wach kaydwi francais?', workflow,
      config, undefined, undefined, undefined, undefined, 'darija', 'arabic');
    expect(result.nextStateId).toBe('need');
    expect(result.updatedCollectedData).toEqual({ fullName: 'Ilyes Saber' });
    expect(result.response).toContain('كيجاوب بالفرنسية');
    expect(result.response).toContain('شنو النشاط ديالك؟');
    expect(result.response).not.toContain(prompt);
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
    llm.generatedResponseMock = '{"kind":"FIELD_ANSWER"}';
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

    llm.generatedResponseMock = '{"kind":"FIELD_ANSWER"}';
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

    llm.generatedResponseMock = '{"kind":"FIELD_ANSWER"}';
    const resumed = await engine.process({ ...session, stateId: interruption.nextStateId!,
      contextData: interruption.updatedContext, collectedData: interruption.updatedCollectedData! },
    'kanbi3 srawl djine ou l7wayj', workflow, config,
    llm, undefined, undefined, undefined, 'darija', 'arabic');
    expect(resumed.nextStateId).toBe('time');
    expect(resumed.updatedCollectedData).toEqual({ fullName: 'Ilyes Saber', businessNeed: 'kanbi3 srawl djine ou l7wayj' });
    expect(resumed.response).toContain('شنو النهار');
    expect(resumed.response).not.toContain('مساعد التجارة');
  });

  it('splits an explicit Darija activity plus question without an AI call and advances only after validation', async () => {
    const llm = new LLMMockProvider();
    llm.generatedResponseMock = JSON.stringify({ kind: 'MIXED', fieldValue: 'kanbi3 srawl djine', question: 'wach kaydwi francais?' });
    const workflow: WorkflowConfig = { id: 'demo', name: 'Demo', description: 'Demo', initialState: 'need', states: {
      need: { type: 'collect', prompt: 'شنو كيدير النشاط ديالك؟', field: { name: 'businessNeed', type: 'string', required: true }, next: 'time' },
      time: { type: 'collect', prompt: 'شنو الوقت اللي يناسبك؟', field: { name: 'preferredDemoTime', type: 'string', required: true }, next: 'done' },
      done: { type: 'end' }
    } };
    const session = { id: 's1', tenantId: 't1', conversationId: 'c1', workflowId: 'demo', stateId: 'need',
      stateHistory: [], status: 'ACTIVE', contextData: { _started: true }, collectedData: {},
      createdAt: new Date(), updatedAt: new Date() } as WorkflowSession;
    const config = { ...DEFAULT_BUSINESS_CONFIG, workflows: { demo: workflow }, capabilities: {
      ...DEFAULT_BUSINESS_CONFIG.capabilities,
      faq: [{ id: 'language', question: 'wach kaydwi francais', answer: 'إييه، كيجاوب بالفرنسية.', language: 'darija' }]
    } };
    const result = await new WorkflowEngine().process(session, 'kanbi3 srawl djine, wach kaydwi francais?', workflow,
      config, llm, undefined, undefined, undefined, 'darija', 'arabic');
    expect(llm.callCount).toBe(0);
    expect(result.updatedCollectedData).toEqual({ businessNeed: 'kanbi3 srawl djine' });
    expect(result.nextStateId).toBe('time');
    expect(result.response).toContain('كيجاوب بالفرنسية');
    expect(result.response).toContain('شنو الوقت');
  });

  it('rejects invented spans and invalid JSON instead of storing an uncertain form answer', async () => {
    const llm = new LLMMockProvider();
    const field = { name: 'businessNeed', type: 'string' as const, required: true, semanticType: 'free_text' as const };
    llm.generatedResponseMock = JSON.stringify({ kind: 'MIXED', fieldValue: 'I sell phones', question: 'wach kaydwi francais?' });
    expect(await WorkflowTurnGate.interpret('kanbi3 srawl, wach kaydwi francais?', 'businessNeed', field,
      'شنو النشاط ديالك؟', llm)).toEqual({ kind: 'UNCLEAR' });
    llm.generatedResponseMock = 'FIELD_ANSWER';
    expect(await WorkflowTurnGate.interpret('For ecommerce diali', 'businessNeed', field,
      'شنو النشاط ديالك؟', llm)).toEqual({ kind: 'UNCLEAR' });
    expect(llm.callCount).toBe(2);
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
