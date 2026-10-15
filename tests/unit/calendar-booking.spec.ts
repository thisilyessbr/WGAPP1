import { describe, expect, it } from 'vitest';
import { CalendarScheduler, FakeCalendarProvider, matchSlot, parseDay, slotList, zonedTime } from '../../src/domain/calendar/CalendarScheduler';
import { WorkflowEngine } from '../../src/core/engine/WorkflowEngine';
import { WorkflowTurnGate } from '../../src/core/engine/WorkflowTurnGate';
import { WorkflowStateEvaluator } from '../../src/core/engine/WorkflowStateEvaluator';
import { ResponseBuilder } from '../../src/domain/conversation/ResponseBuilder';
import { FieldValidator } from '../../src/core/engine/FieldValidator';
import { DEFAULT_BUSINESS_CONFIG } from '../../src/domain/tenant/BusinessConfig';

// Thursday 15 October 2026, 09:00 in Casablanca.
const NOW = zonedTime('2026-10-15', '09:00', 'Africa/Casablanca');

describe('parseDay', () => {
  it.each([
    ['غدا', '2026-10-16'], ['ghda', '2026-10-16'], ['demain', '2026-10-16'], ['tomorrow please', '2026-10-16'],
    ['بعد غدا', '2026-10-17'], ['après-demain', '2026-10-17'], ['ba3d ghda', '2026-10-17'],
    ['lundi', '2026-10-19'], ['التنين', '2026-10-19'], ['letnin', '2026-10-19'], ['الاثنين', '2026-10-19'], ['Saturday', '2026-10-17'],
    ['20/10', '2026-10-20'], ['le 3/1', '2027-01-03'], ['22 octobre', '2026-10-22'], ['اليوم', '2026-10-15']
  ])('%s → %s', (text, day) => expect(parseDay(text, NOW)).toBe(day));
  it('returns null when no day is named', () => expect(parseDay('mazal ma3reft', NOW)).toBeNull());
  it('rejects dates that do not exist', () => {
    expect(parseDay('31/02/2027', NOW)).toBeNull();
    expect(parseDay('31 février', NOW)).toBeNull();
  });
});

const offered = ['10:00', '14:00', '18:00'].map(label => ({ start: label, end: label, label }));
describe('matchSlot', () => {
  it.each([['14:00', '14:00'], ['14h', '14:00'], ['2pm', '14:00'], ['m3a 6 dl3chiya', '18:00'], ['2', '14:00'], ['3', '18:00'],
    ['الثانية', '14:00'], ['the first one', '10:00'], ['f sba7', '10:00'], ['l3chiya', '18:00'], ['من بعد الزوال', '14:00'], ['العاشرة', '10:00'], ['١٨:٠٠', '18:00'], ['14:00 مناسب', '14:00']])(
    '%s → %s', (text, label) => expect(matchSlot(text, offered)?.label).toBe(label));
  it('returns null for an unrelated reply', () => expect(matchSlot('chhal taman?', offered)).toBeNull());
});

describe('CalendarScheduler', () => {
  const cfg = { enabled: true, calendarId: 'team@example.com', slotTimes: ['10:00', '14:00', '18:00'] };
  it('offers only free slots, with notice, on working days', async () => {
    const busy = { start: zonedTime('2026-10-16', '13:30', 'Africa/Casablanca').toISOString(), end: zonedTime('2026-10-16', '15:00', 'Africa/Casablanca').toISOString() };
    const s = new CalendarScheduler(new FakeCalendarProvider([busy]), () => NOW);
    expect((await s.freeSlots(cfg, '2026-10-16')).map(x => x.label)).toEqual(['10:00', '18:00']);
    expect((await s.freeSlots(cfg, '2026-10-15')).map(x => x.label)).toEqual(['14:00', '18:00']); // 10:00 is within 2h notice
    expect(await s.freeSlots(cfg, '2026-10-18')).toEqual([]); // Sunday
  });
  it('refuses to book a slot that became busy', async () => {
    const provider = new FakeCalendarProvider();
    const s = new CalendarScheduler(provider, () => NOW);
    const [slot] = await s.freeSlots(cfg, '2026-10-16');
    expect((await s.book(cfg, slot, { fullName: 'Yassine' })).ok).toBe(true);
    expect(await s.book(cfg, slot, { fullName: 'Other' })).toEqual({ ok: false, reason: 'SLOT_TAKEN' });
  });
  it('accepts an available half-hour time between displayed suggestions', async () => {
    const s = new CalendarScheduler(new FakeCalendarProvider(), () => NOW);
    expect((await s.allFreeSlots(cfg, '2026-10-16')).some(slot => slot.label === '11:30')).toBe(true);
  });
  it('cannot double-book the same slot under concurrent requests', async () => {
    const provider = new FakeCalendarProvider();
    const s = new CalendarScheduler(provider, () => NOW);
    const [slot] = await s.freeSlots(cfg, '2026-10-16');
    const results = await Promise.all([s.book(cfg, slot, { fullName: 'A' }), s.book(cfg, slot, { fullName: 'B' })]);
    expect(results.filter(result => result.ok)).toHaveLength(1);
    expect(provider.events).toHaveLength(1);
  });
  it('fails closed when calendar availability cannot be read', async () => {
    const provider = new FakeCalendarProvider();
    provider.busy = async () => { throw new Error('calendar down'); };
    const s = new CalendarScheduler(provider, () => NOW);
    const slot = { start: zonedTime('2026-10-16', '10:00', 'Africa/Casablanca').toISOString(), end: zonedTime('2026-10-16', '10:30', 'Africa/Casablanca').toISOString(), label: '10:00' };
    expect((await s.book(cfg, slot, { fullName: 'A' })).ok).toBe(false);
    expect(provider.events).toHaveLength(0);
  });
});

describe('workflow with calendar booking', () => {
  const workflow: any = {
    id: 'demo', name: 'Demo', description: '', initialState: 'name', calendarBooking: true,
    states: {
      name: { type: 'collect', field: { name: 'fullName', type: 'string', semanticType: 'person_name', required: true }, next: 'day', prompt: { darija: 'شنو سميتك؟' } },
      day: { type: 'collect', field: 'demoDay', calendar: 'day', next: 'slot', prompt: { darija: 'مرحبا {{fullName}}! شنو النهار اللي يناسبك؟' } },
      slot: { type: 'collect', field: 'demoSlot', calendar: 'slots', next: 'email', prompt: { darija: 'شنو الوقت اللي يناسبك؟' } },
      email: { type: 'collect', field: { name: 'email', type: 'email', required: true }, next: 'done', prompt: { darija: 'عطيني الإيميل ديالك' } },
      done: { type: 'end', prompt: { darija: 'شكرا {{fullName}}! تأكد الموعد ديالك {{slotWhen}} ✅' } }
    }
  };
  const config: any = { ...structuredClone(DEFAULT_BUSINESS_CONFIG), calendar: { enabled: true, calendarId: 'team@example.com', slotTimes: ['10:00', '14:00', '18:00'] } };

  it('offers free slots, books the chosen one and only then confirms', async () => {
    const provider = new FakeCalendarProvider();
    const engine = new WorkflowEngine(new WorkflowStateEvaluator(), undefined, new ResponseBuilder(), new FieldValidator());
    engine.setCalendarScheduler(new CalendarScheduler(provider, () => NOW));
    let session: any = { id: 's1', tenantId: 't', conversationId: 'c', workflowId: 'demo', stateId: 'name', contextData: { _started: true, _lang: 'darija', _script: 'arabic' }, collectedData: {}, stateHistory: [] };
    const say = async (text: string) => {
      const r = await engine.process(session, text, workflow, config, undefined, undefined, undefined, undefined, 'darija', 'arabic');
      session = { ...session, stateId: r.nextStateId ?? session.stateId, contextData: r.updatedContext, collectedData: r.updatedCollectedData, stateHistory: r.updatedStateHistory };
      return r;
    };
    expect((await say('ياسين')).response).toContain('مرحبا ياسين!');
    const slots = await say('غدا');
    expect(slots.response).toMatch(/10:00[\s\S]*14:00[\s\S]*18:00/);
    expect(session.stateId).toBe('slot');
    expect((await say('14:00 مناسب')).response).toContain('الإيميل');
    const done = await say('yassine@example.com');
    expect(done.isComplete).toBe(true);
    expect(done.response).toContain('تأكد الموعد');
    expect(done.response).toContain('14:00');
    expect(provider.events).toHaveLength(1);
    expect(provider.events[0].summary).toContain('ياسين');
  });

  it('says the team will confirm when the calendar cannot book', async () => {
    const failing = new FakeCalendarProvider();
    failing.createEvent = async () => { throw new Error('down'); };
    const engine = new WorkflowEngine(new WorkflowStateEvaluator(), undefined, new ResponseBuilder(), new FieldValidator());
    engine.setCalendarScheduler(new CalendarScheduler(failing, () => NOW));
    const session: any = { id: 's2', tenantId: 't', conversationId: 'c', workflowId: 'demo', stateId: 'email',
      contextData: { _started: true, _lang: 'darija', _script: 'arabic', fullName: 'ياسين' },
      collectedData: { fullName: 'ياسين', _slotStart: '2026-10-16T13:00:00.000Z', _slotEnd: '2026-10-16T13:30:00.000Z', _slotLabel: '14:00', _slotWhen: 'غدا مع 14:00' }, stateHistory: [] };
    const r = await engine.process(session, 'yassine@example.com', workflow, config, undefined, undefined, undefined, undefined, 'darija', 'arabic');
    expect(r.isComplete).toBe(true);
    expect(r.response).toContain('الفريق ديالنا غادي يأكد');
    expect(r.response).not.toContain('تأكد الموعد ديالك');
  });
});

describe('slot list wording', () => {
  const slots = ['10:00', '12:00', '14:00', '18:00'].map(label => ({ start: '', end: '', label }));
  it('adds the part of the day in the customer language', () => {
    expect(slotList(slots, 'darija', 'arabic')).toBe('🕙 10:00 صباحاً\n🕑 12:00 فالزوال\n🕕 14:00 من بعد الزوال\n🕛 18:00 العشية');
    expect(slotList(slots, 'darija', 'arabizi')).toContain('18:00 l3chiya');
    expect(slotList(slots, 'fr', 'latin')).toContain("14:00 l'après-midi");
  });
  it('keeps plain times without a language', () => {
    expect(slotList(slots.slice(0, 1))).toBe('🕙 10:00');
  });
});

describe('names in a sales conversation', () => {
  it.each([['سلام، سميتي رشيد وعندي مطعم فكازا', 'رشيد'], ['salam smiti Aziz w 3ndi magasin', 'Aziz'], ["Bonjour, je m'appelle Salma Bennani, j'ai une boutique", 'Salma Bennani'],
    ['Hi, my name is Karim and I run a shop', 'Karim'], ['bghit n3ref ktar', null], ['je suis intéressé', null]])('%s → %s', (text, name) =>
    expect(WorkflowTurnGate.introducedName(text)).toBe(name));
  const field = { name: 'fullName', type: 'string' as const, semanticType: 'person_name' as const, required: true };
  it.each(['3ziz', '7assan', 'Sa3id', 'ياسين'])('accepts %s as a name', async text =>
    expect((await WorkflowTurnGate.interpret(text, 'fullName', field, 'What is your name?')).kind).toBe('FIELD_ANSWER'));
  it.each(['الواتساب', 'WhatsApp', 'wakha', 'bghit n3rf ktr'])('does not take %s as a name', async text =>
    expect((await WorkflowTurnGate.interpret(text, 'fullName', field, 'What is your name?')).kind).not.toBe('FIELD_ANSWER'));
});
