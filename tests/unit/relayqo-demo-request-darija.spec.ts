import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { inMemoryChatDb } from '../helpers/in-memory-chat-db';
import { transactionalLeadMock } from '../helpers/transactional-lead-mock';
import { ConversationEngine } from '../../src/domain/conversation/ConversationEngine';
import { ConversationService } from '../../src/domain/conversation/ConversationService';
import { WorkflowEngine } from '../../src/core/engine/WorkflowEngine';
import { WorkflowStateEvaluator } from '../../src/core/engine/WorkflowStateEvaluator';
import { ResponseBuilder } from '../../src/domain/conversation/ResponseBuilder';
import { FieldValidator } from '../../src/core/engine/FieldValidator';
import { TenantConfigService } from '../../src/domain/tenant/TenantConfigService';
import { CRMService } from '../../src/domain/crm/CRMService';
import { LLMMockProvider } from '../../src/core/llm/LLMProvider';
import { DEFAULT_BUSINESS_CONFIG } from '../../src/domain/tenant/BusinessConfig';
import { isDeclineReply } from '../../src/core/engine/OptionalFieldSkip';
import { WorkflowTurnInterpreter, isBareLatinName } from '../../src/core/engine/WorkflowTurnInterpreter';
import { WorkflowFieldValueParser } from '../../src/core/engine/WorkflowFieldValueParser';

// Relayqo's own WhatsApp-ad demo request: seven questions, no email, the WhatsApp number is the contact.
const workflow = JSON.parse(readFileSync('tests/fixtures/relayqo-sales-demo.workflow.json', 'utf8'));
const config = { ...DEFAULT_BUSINESS_CONFIG, workflows: { sales_demo: workflow } } as any;
const DONE_DARIJA = 'ممتاز! سجلنا طلب الديمو ديالك. الفريق غادي يتواصل معاك هنا فالواتساب باش يأكد الموعد.';

/** Runs a conversation with the AI provider down, so only deterministic understanding is exercised. */
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
  return { replies, session: db.sessions[db.sessions.length - 1], leads: db.leads };
}

describe('Relayqo demo request in Darija and Arabic', () => {
  it('asks the seven questions and never an email', () => {
    const order: string[] = [];
    for (let id: string | undefined = workflow.initialState; id && !order.includes(id); id = workflow.states[id].next) order.push(id);
    expect(order).toEqual(['name', 'business', 'channels', 'pain', 'volume', 'demo', 'slot', 'done']);
    expect(Object.values(workflow.states).some((s: any) => s.field?.type === 'email')).toBe(false);
    expect(workflow.states.done.prompt.darija_arabic).toBe(DONE_DARIJA);
  });

  it.each([
    ['Darija', ['بغيت ديمو', 'يوسف', 'كنبيع الحوايج ديال النسا', 'بجوج', 'كنتأخر فالجواب بزاف', 'تقريبا 50', 'غدا', 'مع 3 ديال العشية'], 'يوسف', DONE_DARIJA],
    ['Darija introduction', ['باغي ديمو', 'أنا اسمي يوسف بنعلي', 'محل ديال الماكلة', 'الانستغرام', 'ماكنلحقش نجاوب الكل', 'بزاف', 'الاثنين', '11'], 'يوسف بنعلي', DONE_DARIJA],
    ['Darija "I am"', ['بغيت نحجز ديمو', 'انا كريم', 'كنبيع العطور', 'واتساب', 'الناس كيسولو نفس الأسئلة', '100', 'غدا', 'الضهر'], 'كريم', DONE_DARIJA],
    ['Darija long messages', ['سلام عليكم خويا بغيت نعرف واش ممكن ندير معاكم ديمو', 'سميتي محمد أمين', 'انا عندي محل ديال الملابس فكازا', 'بجوج ولكن الواتساب كتر', 'ماكنلحقش نجاوب الكل', 'شي مية ولا كتر', 'غدا إلا ممكن', 'العشية مع الربعة'], 'محمد أمين', DONE_DARIJA],
    ['Darija with Eastern digits', ['بغيت ديمو', 'خديجة', 'ملابس الأطفال', 'واتساب', 'ماكنجاوبش فالليل', '٣٠', '٢٠/١٠', '١٠ الصباح'], 'خديجة', DONE_DARIJA],
    ['Arabizi', ['bghit demo', 'smiti youssef', 'kanbi3 7wayj', 'bjouj', 'kant2khr f jawab', '50', 'ghda', '3 dyal l3chiya'], 'youssef', 'Sjjlna talab dyal demo'],
    ['Arabizi lower-case name', ['bghit demo', 'youssef', 'magasin dyal sbabt', 'whatsapp', 'bzaf dyal messages', 'ta9riban 40', 'lkhmis', '10'], 'youssef', 'hna f WhatsApp'],
    ['Arabic', ['السلام عليكم، أود حجز عرض توضيحي', 'اسمي عبد الرحمن', 'أعمل في بيع الأجهزة الإلكترونية', 'عبر واتساب وإنستغرام', 'لا أستطيع الرد في الوقت المناسب', 'حوالي مئة رسالة', 'يوم الثلاثاء', 'الساعة الحادية عشرة صباحاً'], 'عبد الرحمن', 'سيتواصل معك الفريق هنا على واتساب']
  ])('completes a %s demo request and creates the lead from the WhatsApp number', async (_label, turns, name, closing) => {
    const { replies, session, leads } = await chat(turns as string[]);
    expect(session.status).toBe('COMPLETED');
    expect(session.collectedData.fullName).toBe(name);
    expect(session.collectedData).not.toHaveProperty('email');
    expect(replies.at(-1)).toContain(closing);
    expect(replies.join('\n')).not.toMatch(/الإيميل|البريد الإلكتروني|e-?mail/i);
    expect(leads).toHaveLength(1);
  });

  it('keeps every answer in its own field (no shifted answers)', async () => {
    const { session } = await chat(['بغيت ديمو', 'سميتي فاطمة الزهراء', 'عندي صالون ديال الحلاقة', 'غير الواتساب', 'كاينين ميساجات كيتأخرو', 'بين 20 و 30', 'نهار الخميس', 'العشرة الصباح']);
    expect(session.collectedData).toMatchObject({ fullName: 'فاطمة الزهراء', businessType: 'عندي صالون ديال الحلاقة', channels: 'غير الواتساب',
      mainProblem: 'كاينين ميساجات كيتأخرو', dailyMessages: 'بين 20 و 30', demoDay: 'نهار الخميس', demoSlot: 'العشرة الصباح' });
  });

  it.each([['لا'], ['لا شكراً'], ['ماشي دابا'], ['la merci']])('treats "%s" to the demo offer as declining it, never as the day', async answer => {
    const { session, leads, replies } = await chat(['بغيت ديمو', 'عمر', 'مطعم', 'واتساب', 'التأخر', '50', answer]);
    expect(session.collectedData).not.toHaveProperty('demoDay');
    expect(leads).toHaveLength(0);
    expect(replies.at(-1)).not.toContain('شنو الوقت');
  });
});

describe('optional questions, names and emails in degraded mode', () => {
  it.each(['لا', 'لا شكرا', 'لا 🙏', 'منبعد', 'ماشي ضروري', 'ماشي دابا', 'بلاش', 'خليها', 'ماعنديش', 'ماعنديش الإيميل دابا', 'ما بغيتش نعطي الإيميل',
    'واخا لا ماشي مشكل', 'لا داعي', 'لا أريد', 'la', 'la merci', 'mn ba3d', 'ma3ndich email', 'non merci', 'no', 'skip', "pas d'email merci"])('declines: %s', text => {
    expect(isDeclineReply(text)).toBe(true);
  });
  it.each(['hicham@gmail.com', 'لا، الإيميل ديالي hicham@gmail.com', 'غدا', 'شحال الثمن؟', 'la livraison', 'واخا', 'نعم', 'ok', 'بغيت نعرف كثر'])('is not a refusal: %s', text => {
    expect(isDeclineReply(text)).toBe(false);
  });

  it.each([['youssef', true], ['karim alami', true], ['whatsapp', false], ['salam', false], ['ok', false], ['bghit demo', false], ['magasin dyal sbabt', false]])('lower-case Latin name "%s" -> %s', (text, expected) => {
    expect(isBareLatinName(text as string)).toBe(expected);
  });

  it.each([['أنا اسمي يوسف بنعلي', 'يوسف بنعلي'], ['انا كريم', 'كريم'], ['سميتي ياسين، عندي حانوت', 'ياسين'], ['يوسف، عندي محل ديال الملابس', 'يوسف'], ['اسمي هو عمر', 'عمر']])('reads the name in "%s"', async (message, name) => {
    const pending = { name: 'fullName', type: 'string' as const, semanticType: 'person_name' as const };
    const result = await WorkflowTurnInterpreter.interpret({ message, pendingField: pending, pendingPrompt: 'شنو سميتك؟', fields: [pending] });
    expect(result.kind).toBe('FIELD_ANSWER');
    expect(result.fieldSourceSpan?.text).toBe(name);
  });

  it('takes the address out of a sentence', () => {
    const text = 'هاهو الإيميل ديالي salma123@gmail.com شكرا';
    expect(WorkflowFieldValueParser.parse({ text, start: 0, end: text.length }, { name: 'email', type: 'email' })?.value).toBe('salma123@gmail.com');
  });
});

describe('questions from an ad: answered, never stored as the name', () => {
  const faq = [
    { id: 'price', language: 'darija', question: 'شحال الثمن ديال Relayqo؟', answer: 'الثمن كيتبدل حسب عدد الرسائل والقنوات، والفريق كيقترح الباقة بعد الديمو.' },
    { id: 'what', language: 'darija', question: 'شنو هو Relayqo؟', answer: 'Relayqo مساعد محادثات كيجاوب الزبناء ديالك بالدارجة.' }
  ];
  const autoConfig = { ...DEFAULT_BUSINESS_CONFIG, capabilities: { ...DEFAULT_BUSINESS_CONFIG.capabilities, faq },
    workflows: { sales_demo: { ...workflow, activation: { ...workflow.activation, mode: 'auto_start' } } } } as any;

  async function autoChat(turns: string[]) {
    const db = inMemoryChatDb('relayqo');
    const tenants = new TenantConfigService(db.prisma);
    vi.spyOn(tenants, 'getConfig').mockResolvedValue(autoConfig);
    const llm = new LLMMockProvider(); llm.shouldFail = true; llm.failureType = 'timeout' as any;
    const rb = new ResponseBuilder();
    const engine = new ConversationEngine(new ConversationService(db.prisma), tenants,
      new WorkflowEngine(new WorkflowStateEvaluator(), undefined, rb, new FieldValidator()), llm, rb,
      undefined, undefined, undefined, undefined, undefined, new CRMService(transactionalLeadMock(db.prisma)));
    const replies: string[] = [];
    for (const turn of turns) replies.push(String(await engine.handleMessage('relayqo', '212612345678', turn, 'relayqo-account')));
    return { replies, session: db.sessions[db.sessions.length - 1] };
  }

  it('answers a first-message question, then asks the name', async () => {
    const { replies, session } = await autoChat(['شحال الثمن ديال Relayqo؟']);
    expect(replies[0]).toContain('الفريق كيقترح الباقة');
    expect(replies[0]).toMatch(/سميتك|اسمك/);
    expect(session.stateId).toBe('name');
    expect(session.collectedData).not.toHaveProperty('fullName');
  });

  it('still opens with the welcome when the first message is not a question', async () => {
    const { replies } = await autoChat(['سلام، بغيت نعرف كثر على الخدمة ديالكم.']);
    expect(replies[0]).not.toContain('الفريق كيقترح الباقة');
    expect(replies[0]).toMatch(/سميتك|اسمك/);
  });

  it('keeps fields in place when a question comes at the name step', async () => {
    const { session } = await autoChat(['سلام، بغيت نعرف كثر على الخدمة ديالكم.', 'شنو هو هاد البرنامج بالضبط؟ واش روبو؟', 'فاطمة', 'صالون ديال التجميل']);
    expect(session.collectedData.fullName).toBe('فاطمة');
    expect(session.collectedData.businessType).toBe('صالون ديال التجميل');
  });

  it('never splits two questions into an answer and a question', async () => {
    const pending = { name: 'fullName', type: 'string' as const, semanticType: 'person_name' as const };
    const result = await WorkflowTurnInterpreter.interpret({ message: 'شنو هو هاد البرنامج بالضبط؟ واش روبو؟', pendingField: pending, pendingPrompt: 'شنو سميتك؟', fields: [pending] });
    expect(result.kind).toBe('SIDE_QUESTION');
    expect(result.fieldSourceSpan).toBeNull();
  });

  it('rejects a question the model returns as the name', async () => {
    const pending = { name: 'fullName', type: 'string' as const, semanticType: 'person_name' as const };
    const llm = new LLMMockProvider();
    llm.responseResolver = () => JSON.stringify({ kind: 'ANSWER_AND_QUESTION', fieldSourceSpan: 'شنو هاد الخدمة', questionSourceSpan: 'واش روبو', targetField: null, newValueSourceSpan: null, intent: null });
    const result = await WorkflowTurnInterpreter.interpret({ message: 'شنو هاد الخدمة واش روبو', pendingField: pending, pendingPrompt: 'شنو سميتك؟', fields: [pending], llm });
    expect(result.kind).toBe('SIDE_QUESTION');
    expect(result.fieldSourceSpan).toBeNull();
  });
});
