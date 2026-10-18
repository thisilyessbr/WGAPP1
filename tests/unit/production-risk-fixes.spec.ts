import { describe, expect, it, vi } from 'vitest';
import { WorkflowSession } from '@prisma/client';
import { ConversationEngine } from '../../src/domain/conversation/ConversationEngine';
import { BusinessQuestionScope } from '../../src/domain/conversation/BusinessQuestionScope';
import { BusinessHoursClause } from '../../src/domain/conversation/BusinessHoursClause';
import { GroundedAnswerGuard } from '../../src/domain/conversation/GroundedAnswerGuard';
import { ResponseBuilder } from '../../src/domain/conversation/ResponseBuilder';
import { WorkflowEngine } from '../../src/core/engine/WorkflowEngine';
import { WorkflowStateEvaluator } from '../../src/core/engine/WorkflowStateEvaluator';
import { WorkflowTurnGate } from '../../src/core/engine/WorkflowTurnGate';
import { LLMMockProvider } from '../../src/core/llm/LLMProvider';
import { DEFAULT_BUSINESS_CONFIG, WorkflowConfig } from '../../src/domain/tenant/BusinessConfig';

function makeEngine(configure: (config: any) => void) {
  const config: any = structuredClone(DEFAULT_BUSINESS_CONFIG);
  config.identity.brand = 'Fictional Casa Salon';
  config.identity.locations = ['Fictional address, Casa'];
  config.knowledge.enabled = false;
  configure(config);
  const conv: any = { id: 'c1', tenantId: 't1', accountId: 't1', customerId: 'fictional-customer', status: 'ACTIVE', version: 0, messageCount: 0, contextData: {} };
  const messages: any[] = [];
  const commits: any[] = [];
  const service: any = {
    getOrCreateConversation: async () => conv,
    getMessageCount: async () => messages.length,
    getAutomationState: async () => null,
    getActiveSession: async () => null,
    getLatestCompletedSession: async () => null,
    countCompletedWorkflowSessions: async () => 0,
    createSession: async (tenantId: string, conversationId: string, workflowId: string, stateId: string) => ({
      id: 's1', tenantId, conversationId, workflowId, stateId, stateHistory: [], status: 'ACTIVE',
      contextData: {}, collectedData: {}, createdAt: new Date(), updatedAt: new Date()
    }),
    getRecentMessages: async (_t: string, _c: string, n: number) => messages.slice(-n).reverse(),
    commitConversationTurn: async (p: any) => {
      commits.push(p);
      messages.push({ role: 'USER', content: p.userMessage, createdAt: new Date() });
      if (p.assistantMessage) messages.push({ role: 'ASSISTANT', content: p.assistantMessage, createdAt: new Date() });
      if (p.contextData) conv.contextData = p.contextData;
      conv.version++; conv.messageCount++;
      return { success: true };
    }
  };
  const llm: any = { generateResponse: vi.fn(async () => 'UNANSWERABLE'), classifyIntent: vi.fn(async () => null), extractField: vi.fn(async () => null) };
  const engine = new ConversationEngine(service, { getConfig: async () => config } as any, new WorkflowEngine(new WorkflowStateEvaluator(), llm), llm, new ResponseBuilder());
  return { engine, llm, config, commits };
}

describe('production risk fixes', () => {
  describe('business hours clause (fix 1)', () => {
    it('recognizes configured hours in any time format instead of a fixture value', () => {
      expect(BusinessHoursClause.alreadyStated('Kan7ello mn 9h 7ta 19h.', 'Mon–Sat, 09:00–19:00')).toBe(true);
      expect(BusinessHoursClause.alreadyStated('Open 09h00 to 19h00.', '9:00 - 19:00')).toBe(true);
      expect(BusinessHoursClause.alreadyStated('We close at 18:00.', '09:00–19:00')).toBe(false);
      expect(BusinessHoursClause.alreadyStated('كنسدو على 21:00، من الثلاثاء حتى الحد.', 'Mardi au dimanche de 10:00 à 21:00.')).toBe(true);
    });

    it('shortens the first answer so the hours clause is never truncated', () => {
      const long = 'We are located at Fictional address, Casa. Parking is available nearby. '.repeat(4);
      const result = BusinessHoursClause.append(long, 'Monday to Saturday, 09:00–19:00', 'Hours: ', 140);
      expect(result.length).toBeLessThanOrEqual(140);
      expect(result.endsWith('Hours: Monday to Saturday, 09:00–19:00.')).toBe(true);
    });

    it('appends the tenant hours (not 18:00) to a generated address reply', async () => {
      const { engine, llm } = makeEngine(config => {
        config.identity.businessHours = 'Monday to Saturday, 09h00–19h00';
        config.limits.maxResponseLength = 160;
      });
      llm.generateResponse.mockResolvedValueOnce('Kaynin f Fictional address, Casa.');
      const answer = await engine.handleMessage('t1', 'customer', 'fin kaynin w fach katseddo?', 't1');
      expect(answer).toContain('Fictional address, Casa');
      expect(answer).toContain('09h00–19h00');
      expect(answer.length).toBeLessThanOrEqual(160);
    });

    it('does not duplicate hours the reply already states in another format', async () => {
      const { engine, llm } = makeEngine(config => { config.identity.businessHours = '09:00–19:00'; });
      llm.generateResponse.mockResolvedValueOnce('Kaynin f Fictional address, Casa. Kan7ello mn 9h 7ta 19h.');
      const answer = await engine.handleMessage('t1', 'customer', 'fin kaynin w fach katseddo?', 't1');
      expect(answer).not.toContain('L-wa9t');
    });
  });

  describe('Arabic-script topic boundaries (fix 2)', () => {
    it('counts Darija delivery questions as one topic', () => {
      expect(BusinessQuestionScope.requestedTopicCount('واش كاين التوصيل لطنجة؟')).toBe(1);
      expect(BusinessQuestionScope.requestedTopicCount('شحال كيدوم التوصيل')).toBe(1);
    });

    it('recognizes Arabizi "fin kaynin" as a location question', () => {
      expect(BusinessQuestionScope.requestedTopicCount('fin kaynin')).toBe(1);
      expect(BusinessQuestionScope.isCovered('fin kaynin', 'Our address is 12 rue Atlas.')).toBe(true);
      expect(BusinessQuestionScope.isCovered('fin kaynin', 'We open at 9:00.')).toBe(false);
    });

    it('does not read كي- verbs or كاين as ironing or location topics', () => {
      expect(BusinessQuestionScope.requestedTopicCount('كيفاش نغسل هاد القميص؟')).toBe(1);
      expect(BusinessQuestionScope.requestedTopicCount('واش كاين؟')).toBe(0);
      expect(BusinessQuestionScope.requestedTopicCount('واش نقدر نستعمل المكواة؟')).toBe(1);
      expect(BusinessQuestionScope.requestedTopicCount('أين يوجد المحل؟')).toBe(1);
    });
  });

  describe('grounded answer guard (fix 3)', () => {
    const evidence = 'Brushing 80 MAD. Coloring 200 MAD. Hours: 09:00–19:00. Summer offer: 10% off coloring.';

    it('catches invented prices with Arabic, Arabizi and symbol currencies on either side', () => {
      for (const answer of ['الثمن هو 999 درهم', 'b 999 dh', '999 drahm', 'MAD 999', '$999', '999€', '999 دراهم']) {
        expect(GroundedAnswerGuard.evaluate(answer, evidence), answer).toMatchObject({ safe: false, reason: 'UNSUPPORTED_PRICE' });
      }
      expect(GroundedAnswerGuard.evaluate('الثمن هو 80 درهم', evidence)).toMatchObject({ safe: true });
    });

    it('checks hours on Arabizi questions and treats 9:00, 09:00, 9h and 9h00 as equal', () => {
      const context = { question: 'fach kat7lo?', businessHours: '9:00 - 19:00' };
      expect(GroundedAnswerGuard.evaluate('Kan7ello mn 09h00 7ta 19h.', evidence, context)).toMatchObject({ safe: true });
      expect(GroundedAnswerGuard.evaluate('Kan7ello mn 9h 7ta 21h.', evidence, context)).toMatchObject({ safe: false, reason: 'CONFLICTING_HOURS' });
      expect(GroundedAnswerGuard.evaluate('Open 9h to 21h.', evidence, { question: 'chno l7oraire?', businessHours: '09:00–19:00' }))
        .toMatchObject({ safe: false, reason: 'CONFLICTING_HOURS' });
    });

    it('rejects Darija, Arabizi and French false confirmations but not instructions', () => {
      for (const answer of ['تأكد الحجز ديالك.', 'الموعد ديالك تسجل.', 'Ra tconfirma lmaw3id dyalk.', 'tsjjel l7ajz dyalk', 'Réservation confirmée !']) {
        expect(GroundedAnswerGuard.evaluate(answer, evidence), answer).toMatchObject({ safe: false, reason: 'FALSE_ACTION' });
      }
      expect(GroundedAnswerGuard.evaluate('Bach t2akkad lmaw3id, l-équipe ghadi tttasel bik.', evidence)).toMatchObject({ safe: true });
    });

    it('rejects invented positive discounts and keeps documented ones', () => {
      for (const answer of ['Get 20% off today!', 'Brushing -20% cette semaine.', 'كاين تخفيض 20% على كلشي', 'Remise de 20% sur le brushing.']) {
        expect(GroundedAnswerGuard.evaluate(answer, evidence), answer).toMatchObject({ safe: false, reason: 'UNSUPPORTED_DISCOUNT' });
      }
      expect(GroundedAnswerGuard.evaluate('Coloring has 10% off this summer.', evidence)).toMatchObject({ safe: true });
    });

    it('does not flag a reply that lists several supported service prices', () => {
      const context = { question: 'how much is brushing?', services: [{ name: 'brushing', price: 80 }, { name: 'coloring', price: 200 }] };
      expect(GroundedAnswerGuard.evaluate('Coloring is 200 MAD and brushing is 80 MAD.', evidence, context)).toMatchObject({ safe: true });
      expect(GroundedAnswerGuard.evaluate('Coloring is 200 MAD and brushing is 200 MAD.', evidence, context))
        .toMatchObject({ safe: false, reason: 'CONFLICTING_PRICE' });
    });
  });

  describe('LLM intent classification default (fix 4)', () => {
    it('is enabled unless a tenant explicitly turns it off', () => {
      expect(DEFAULT_BUSINESS_CONFIG.behavior.useLlmIntentClassification).toBe(true);
    });

    it('classifies a Darija-worded workflow request for a config without the flag', async () => {
      const { engine, llm } = makeEngine(config => {
        delete config.behavior.useLlmIntentClassification;
        config.capabilities.intents = [{ id: 'book', description: 'Book an appointment', workflowId: 'book' }];
        config.workflows = { book: bookingWorkflow };
      });
      llm.classifyIntent.mockResolvedValueOnce('book');
      const answer = await engine.handleMessage('t1', 'customer', 'bghit nji ndir chi 7aja l chàri', 't1');
      expect(llm.classifyIntent).toHaveBeenCalled();
      expect(answer).toContain('smitek');
    });
  });

  describe('deterministic shortcuts yield to workflows (fix 5)', () => {
    it('starts the triggered workflow instead of answering the address', async () => {
      const { engine } = makeEngine(config => {
        config.capabilities.intents = [{ id: 'book', description: 'Book', workflowId: 'book', keywords: ['bghit nhjz'] }];
        config.workflows = { book: bookingWorkflow };
      });
      const answer = await engine.handleMessage('t1', 'customer', 'bghit nhjz, fin kaynin?', 't1');
      expect(answer).toContain('smitek');
      expect(answer).not.toContain('Kaynin f');
    });
  });

  describe('workflow turn gate (fix 6)', () => {
    const nameField = { name: 'fullName', type: 'string' as const, required: true, semanticType: 'person_name' as const };
    const cityField = { name: 'city', type: 'string' as const, required: true, semanticType: 'free_text' as const };

    it('does not treat ordinary answers as questions', async () => {
      // The question heuristic is private in the merged gate; assert it through
      // classify() without a classifier so only deterministic routing applies.
      expect(await WorkflowTurnGate.classify('my name is Ali', 'fullName', nameField, 'Name?')).toBe('FIELD_ANSWER');
      expect(await WorkflowTurnGate.classify('من الدار البيضاء', 'city', cityField, 'City?')).toBe('FIELD_ANSWER');
      expect(await WorkflowTurnGate.classify('ana mn casa', 'city', cityField, 'City?')).toBe('FIELD_ANSWER');
      expect(await WorkflowTurnGate.classify('is it open on sunday', 'city', cityField, 'City?')).toBe('CUSTOMER_QUESTION');
      expect(await WorkflowTurnGate.classify('Ali, from Casa?', 'city', cityField, 'City?')).toBe('CUSTOMER_QUESTION');
      // An embedded question is never saved as a free-text value.
      expect(await WorkflowTurnGate.classify('bghit n3ref chhal taman', 'city', cityField, 'City?')).not.toBe('FIELD_ANSWER');
    });

    it('accepts "من الدار البيضاء" as a city answer without an LLM', async () => {
      expect(await WorkflowTurnGate.classify('من الدار البيضاء', 'city', cityField, 'منين نتا؟')).toBe('FIELD_ANSWER');
    });

    it('fails closed for free text but keeps names and structured fields reachable when the classifier fails', async () => {
      // The provider enforces the 4s deadline (timeoutMs); a timeout surfaces here as a thrown error.
      const dateField = { name: 'date', type: 'date' as const, required: true };
      const failing = new LLMMockProvider();
      failing.generateResponse = async () => { throw new Error('provider down'); };
      expect(await WorkflowTurnGate.classify('Ali Benali', 'fullName', nameField, 'Name?', failing)).toBe('FIELD_ANSWER');
      expect(await WorkflowTurnGate.classify('next monday morning', 'date', dateField, 'Date?', failing)).toBe('FIELD_ANSWER');
      expect(await WorkflowTurnGate.classify('kanbi3 lhwayj', 'city', cityField, 'Activity?', failing)).toBe('UNCLEAR');
    });

    it('counts UNCLEAR replies toward the unmatched limit instead of looping forever', async () => {
      const llm = new LLMMockProvider();
      llm.intentMock = 'UNCLEAR';
      // The turn interpreter reads strict JSON from generateResponse.
      llm.responseResolver = (_prompt, _history, options) => options?.purpose === 'structured_turn_interpretation'
        ? JSON.stringify({ kind: 'UNCLEAR', fieldSourceSpan: null, questionSourceSpan: null, targetField: null, newValueSourceSpan: null, intent: null })
        : 'Mocked response';
      const workflow: WorkflowConfig = {
        id: 'demo', name: 'Demo', description: 'Demo', initialState: 'need',
        states: {
          need: { type: 'collect', prompt: 'What do you need?', field: { name: 'businessNeed', type: 'string', required: true }, next: 'done' },
          done: { type: 'end', prompt: 'Thanks' }
        }
      };
      const config = { ...DEFAULT_BUSINESS_CONFIG, workflows: { demo: workflow } };
      const engine = new WorkflowEngine(new WorkflowStateEvaluator());
      let session = {
        id: 's1', tenantId: 't1', conversationId: 'c1', workflowId: 'demo', stateId: 'need', stateHistory: [],
        status: 'ACTIVE', contextData: { _started: true }, collectedData: {}, createdAt: new Date(), updatedAt: new Date()
      } as unknown as WorkflowSession;
      const turns = [];
      for (let i = 0; i < 3; i++) {
        const result = await engine.process(session, 'hmm mumkin chi haja', workflow, config, llm, undefined, undefined, undefined, 'en', 'latin');
        turns.push(result);
        session = { ...session, stateId: result.nextStateId!, contextData: result.updatedContext, collectedData: result.updatedCollectedData! } as WorkflowSession;
      }
      expect(turns[0].updatedContext._consecutiveUnmatched).toBe(1);
      // "Sorry, I didn't get that" + the question, then the question alone: never the same reply twice in a row.
      expect(turns[0].response).not.toBe('What do you need?');
      expect(turns[0].response).toContain('What do you need?');
      expect(turns[1].updatedContext._consecutiveUnmatched).toBe(2);
      expect(turns[1].response).toBe('What do you need?');
      expect(turns[2].isComplete).toBe(true);
      expect(turns[2].updatedCollectedData).toMatchObject({ businessNeed: 'hmm mumkin chi haja' });
    });
  });

  describe('international shipping script (fix 7)', () => {
    it('answers Arabizi users in Latin script', () => {
      const reply = ConversationEngine.unconfirmedInternationalShipping('darija', 'arabizi');
      expect(reply).not.toMatch(/[؀-ۿ]/u);
      expect(ConversationEngine.unconfirmedInternationalShipping('darija', 'arabic')).toMatch(/[؀-ۿ]/u);
      expect(ConversationEngine.unconfirmedInternationalShipping('fr', 'latin')).toContain('destination internationale');
    });
  });
});

const bookingWorkflow: WorkflowConfig = {
  id: 'book', name: 'Booking', description: 'Book an appointment', initialState: 'name',
  activation: { mode: 'explicit_intent', intents: ['book'], allowManualStart: true },
  states: {
    name: { type: 'collect', prompt: 'Chno smitek?', field: { name: 'fullName', type: 'string', required: true }, next: 'done' },
    done: { type: 'end', prompt: 'Thanks' }
  }
};
