import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { inMemoryChatDb } from '../helpers/in-memory-chat-db';
import { transactionalLeadMock } from '../helpers/transactional-lead-mock';
import { ConversationEngine } from '../../src/domain/conversation/ConversationEngine';
import { ConversationService } from '../../src/domain/conversation/ConversationService';
import { WorkflowEngine, questionPart } from '../../src/core/engine/WorkflowEngine';
import { WorkflowStateEvaluator } from '../../src/core/engine/WorkflowStateEvaluator';
import { ResponseBuilder } from '../../src/domain/conversation/ResponseBuilder';
import { FieldValidator } from '../../src/core/engine/FieldValidator';
import { TenantConfigService } from '../../src/domain/tenant/TenantConfigService';
import { CRMService } from '../../src/domain/crm/CRMService';
import { LLMMockProvider } from '../../src/core/llm/LLMProvider';
import { DEFAULT_BUSINESS_CONFIG } from '../../src/domain/tenant/BusinessConfig';
import { WorkflowTurnInterpreter, asksForInformation, isBareLatinName } from '../../src/core/engine/WorkflowTurnInterpreter';
import { isSchedulingStep, undecidedSchedulingReply } from '../../src/core/engine/WorkflowCalendar';
import { WorkflowCancellationDetector } from '../../src/core/engine/WorkflowEngine';

// Replays of real WhatsApp conversations with the Relayqo demo flow (October 2026), AI provider down.
const workflow = JSON.parse(readFileSync('tests/fixtures/relayqo-sales-demo.workflow.json', 'utf8'));
const config = { ...DEFAULT_BUSINESS_CONFIG, workflows: { sales_demo: workflow } } as any;
const PITCH = 'شنو رأيك نحجزو';
const UNDECIDED = 'تتافقو على وقت اللي يناسبك';

async function chat(turns: string[]) {
  const db = inMemoryChatDb('relayqo');
  const tenants = new TenantConfigService(db.prisma);
  vi.spyOn(tenants, 'getConfig').mockResolvedValue(config);
  const llm = new LLMMockProvider(); llm.shouldFail = true; llm.failureType = 'timeout' as any;
  const rb = new ResponseBuilder();
  const engine = new ConversationEngine(new ConversationService(db.prisma), tenants,
    new WorkflowEngine(new WorkflowStateEvaluator(), undefined, rb, new FieldValidator()), llm, rb,
    undefined, undefined, undefined, undefined, undefined, new CRMService(transactionalLeadMock(db.prisma)));
  const replies: string[] = [];
  for (const turn of turns) replies.push(String(await engine.handleMessage('relayqo', '212612345678', turn, 'relayqo-account')));
  return { replies, sessions: db.sessions, session: db.sessions[db.sessions.length - 1], leads: db.leads };
}

const UP_TO_DEMO = ['سلام، بغيت نعرف كثر على الخدمة ديالكم.', 'انا سميتي إلياس', 'كنبيع الحوايج', 'بجوج', 'كنتأخر فالجواب', '30'];

describe('a day or time is never invented', () => {
  it.each([['انا عندي سمانة كامل عامر'], ['والله معارف'], ['حتى واحد منم'], ['ma3rftch'], ["je ne sais pas"]])(
    '"%s" to "which day?" stores no day and hands the time to the team', async answer => {
      const { replies, session, leads } = await chat([...UP_TO_DEMO, answer]);
      expect(session.status).toBe('COMPLETED');
      expect(session.collectedData).not.toHaveProperty('demoDay');
      expect(session.collectedData._scheduling).toBe('undecided');
      expect(replies.at(-1)).toContain(UNDECIDED);
      expect(replies.at(-1)).not.toContain('سجلنا طلب الديمو');
      expect(leads).toHaveLength(1);
    });

  it('"والله معارف" to "which time?" is not stored as the slot', async () => {
    const { replies, session } = await chat([...UP_TO_DEMO, 'غدا', 'والله معارف']);
    expect(session.collectedData.demoDay).toBe('غدا');
    expect(session.collectedData).not.toHaveProperty('demoSlot');
    expect(replies.at(-1)).toContain(UNDECIDED);
  });

  it.each(['غدا', 'نهار الخميس', 'مع 3 ديال العشية', 'lyoma m3a 6 dl3chia', 'مشغول غدا، بعد غدا مزيان', 'العشرة الصباح'])('"%s" names a day or time', text => {
    expect(undecidedSchedulingReply(text)).toBe(false);
  });

  it('recognises day and time steps without a connected calendar', () => {
    expect(isSchedulingStep(workflow.states.demo, 'demoDay')).toBe(true);
    expect(isSchedulingStep(workflow.states.slot, 'demoSlot')).toBe(true);
    expect(isSchedulingStep({ type: 'collect', field: { name: 'preferredDemoTime', type: 'string', required: true } } as any, 'preferredDemoTime')).toBe(true);
    expect(isSchedulingStep(workflow.states.volume, 'dailyMessages')).toBe(false);
    expect(isSchedulingStep(workflow.states.business, 'businessType')).toBe(false);
  });
});

describe('asking the step again repeats only its question', () => {
  it('drops the pitch line above the day question', () => {
    expect(questionPart(`${PITCH} ليك واحد الموعد؟\nشنو النهار اللي يناسبك؟ اليوم، غدا، ولا نهار آخر؟`))
      .toBe('شنو النهار اللي يناسبك؟ اليوم، غدا، ولا نهار آخر؟');
    expect(questionPart('مرحبا بيك إلياس! تشرفنا 🙌\nقولي، شنو هو النشاط التجاري ديالك؟')).toBe('قولي، شنو هو النشاط التجاري ديالك؟');
    expect(questionPart('شنو الوقت اللي يناسبك؟')).toBe('شنو الوقت اللي يناسبك؟');
  });
});

describe('Darija replies that are not answers', () => {
  it('"Safi" mid-flow is "OK", not a cancel', async () => {
    const { session, replies } = await chat(['بغيت ديمو', 'يوسف', 'Safi']);
    expect(session.status).toBe('ACTIVE');
    expect(session.stateId).toBe('business');
    expect(replies.at(-1)).not.toContain('تلغى');
    expect(WorkflowCancellationDetector.isCancellation('safi')).toBe(false);
    expect(WorkflowCancellationDetector.isCancellation('صافي')).toBe(false);
    expect(WorkflowCancellationDetector.isCancellation('safi baraka')).toBe(true);
    expect(WorkflowCancellationDetector.isCancellation('بغيت نلغي')).toBe(true);
  });

  it('a greeting or "Safi" mid-flow re-asks only the question, never the welcome, and is not stored', async () => {
    const { replies, session } = await chat(['سلام، بغيت نعرف كثر على الخدمة ديالكم.', 'Safi', 'إلياس', 'كنبيع الحوايج', 'بجوج', 'كنتأخر', '30', 'سلام عليكم']);
    expect(replies[1]).toMatch(/سميتك/);
    expect(replies[1]).not.toContain('معاك المساعد');
    expect(session.collectedData).not.toHaveProperty('demoDay');
    expect(replies.at(-1)).toMatch(/^شنو النهار اللي يناسبك/);
  });

  it.each(['Walo', 'walo', 'Merce', 'Safi', 'Test notification Relayqo'])('"%s" is not a name', async message => {
    const pending = { name: 'fullName', type: 'string' as const, semanticType: 'person_name' as const };
    const result = await WorkflowTurnInterpreter.interpret({ message, pendingField: pending, pendingPrompt: 'شنو سميتك؟', fields: [pending] });
    expect(result.kind).not.toBe('FIELD_ANSWER');
    expect(isBareLatinName(message)).toBe(false);
  });

  it.each(['Youssef', 'Karim Alami', 'ilyes saber'])('"%s" is still a name', async message => {
    const pending = { name: 'fullName', type: 'string' as const, semanticType: 'person_name' as const };
    const result = await WorkflowTurnInterpreter.interpret({ message, pendingField: pending, pendingPrompt: 'شنو سميتك؟', fields: [pending] });
    expect(result.kind).toBe('FIELD_ANSWER');
  });

  it.each(['خسني نتعرف على هد الخدمة', 'قولي دبا دكشي لي كونتي عتقولي', 'bghit n3rf ktar 3la chatbot', 'tell me more', 'je veux savoir le prix'])(
    '"%s" asks for information', text => {
      expect(asksForInformation(text)).toBe(true);
    });
  it.each(['كنبيع الحوايج', 'بجوج', 'كنتأخر فالجواب', 'ecom kanbi3 t-shirts', '50'])('"%s" is an answer', text => {
    expect(asksForInformation(text)).toBe(false);
  });

  it('a request to learn about the service is answered, never stored as the business', async () => {
    const { session } = await chat(['سلام، بغيت نعرف كثر على الخدمة ديالكم.', 'انا سميتي إلياس', 'خسني نتعرف على هد الخدمة']);
    expect(session.collectedData.fullName).toBe('إلياس');
    expect(session.collectedData).not.toHaveProperty('businessType');
    expect(session.stateId).toBe('business');
  });

  it('"فين" ("where?") is a question, not the channel', async () => {
    const { session } = await chat(['سلام، بغيت نعرف كثر على الخدمة ديالكم.', 'ادم', 'كنبيع ماطيشة', 'فين']);
    expect(session.collectedData).not.toHaveProperty('channels');
    expect(session.stateId).toBe('channels');
  });
});

describe('after the flow ends', () => {
  it('a thank-you after a cancel does not restart the flow', async () => {
    const { replies, sessions } = await chat(['بغيت ديمو', 'يوسف', 'safi baraka', 'Merce']);
    expect(replies[2]).toContain('تلغى');
    expect(sessions).toHaveLength(1);
    expect(replies.at(-1)).not.toMatch(/النشاط التجاري|سميتك/);
  });

  it('a question after a cancel is not answered by restarting the flow; its keyword still restarts it', async () => {
    const { replies, sessions } = await chat(['بغيت ديمو', 'يوسف', 'safi baraka', 'شنو هو Relayqo؟']);
    expect(sessions).toHaveLength(1);
    expect(replies.at(-1)).not.toMatch(/النشاط التجاري|سميتك/);
    const again = await chat(['بغيت ديمو', 'يوسف', 'safi baraka', 'بغيت ديمو']);
    expect(again.sessions).toHaveLength(2);
  });

  it('"صفي" and "سلام عليكم" after a finished request do not re-pitch the demo', async () => {
    const { replies } = await chat([...UP_TO_DEMO, 'غدا', 'مع 3 ديال العشية', 'صفي', 'سلام عليكم']);
    expect(replies[7]).toContain('سجلنا طلب الديمو');
    expect(replies[8]).not.toContain('الطلب ديالك');
    expect(replies[9]).not.toMatch(/ديمو|Demo/);
  });
});

describe('a question step followed by a hand-over step', () => {
  const handoffFlow = {
    id: 'welcome', name: 'Welcome', description: '', initialState: 'business', allowInterruption: true, outcome: { createLead: true },
    states: {
      business: { type: 'collect', field: { name: 'businessType', type: 'string', required: true, acceptAnyReply: true }, next: 'channels',
        prompt: { darija_arabic: 'سلام! 👋\nشنو كتبيع؟' } },
      channels: { type: 'collect', field: { name: 'channels', type: 'string', required: true, acceptAnyReply: true }, next: 'handoff',
        prompt: { darija_arabic: 'زوين! 👌\nالكليان ديالك كيسولوك فالإنستغرام، فالواتساب، ولا بجوج؟' } },
      handoff: { type: 'handoff', pauseBotHours: 72, prompt: { darija_arabic: 'شكراً! 🙏 واحد من الفريق ديالنا غادي يتواصل معاك قريب.' } }
    }
  } as any;

  it('hands over on the last answer, once, with the lead', async () => {
    const engine = new WorkflowEngine({ evaluateNextState: async () => null } as any);
    let s: any = { id: 's', tenantId: 't', conversationId: 'c', workflowId: 'welcome', stateId: 'business', status: 'ACTIVE',
      contextData: {}, collectedData: {}, stateHistory: [], createdAt: new Date(), updatedAt: new Date() };
    const results = [];
    for (const turn of ['سلام', 'كنبيع العطور', 'بجوج']) {
      const r = await engine.process(s, turn, handoffFlow, DEFAULT_BUSINESS_CONFIG as any, undefined, undefined, undefined, undefined, 'darija', 'arabic');
      results.push(r);
      s = { ...s, stateId: r.nextStateId || s.stateId, contextData: r.updatedContext, collectedData: r.updatedCollectedData || {}, stateHistory: r.updatedStateHistory || [] };
    }
    const last = results.at(-1)!;
    expect(last.response).toBe('شكراً! 🙏 واحد من الفريق ديالنا غادي يتواصل معاك قريب.');
    expect(last).toMatchObject({ isComplete: true, requestHumanHandoff: true, handoffPauseHours: 72, createLead: true });
    expect(last.updatedCollectedData).toMatchObject({ businessType: 'كنبيع العطور', channels: 'بجوج' });
  });
});
