import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { portalDatabase } from '../helpers/portal-db';
import { CalendarError, RelayqoCalendar } from '../../src/domain/calendar/RelayqoCalendar';
import { CalendarScheduler, setCalendarConnectionProviders, zonedTime } from '../../src/domain/calendar/CalendarScheduler';
import { WorkflowEngine } from '../../src/core/engine/WorkflowEngine';
import { WorkflowStateEvaluator } from '../../src/core/engine/WorkflowStateEvaluator';
import { ResponseBuilder } from '../../src/domain/conversation/ResponseBuilder';
import { FieldValidator } from '../../src/core/engine/FieldValidator';
import { DEFAULT_BUSINESS_CONFIG } from '../../src/domain/tenant/BusinessConfig';

// Thursday 15 October 2026, 09:00 in Casablanca.
const NOW = zonedTime('2026-10-15', '09:00', 'Africa/Casablanca');
const at = (day: string, hhmm: string, minutes = 30) => {
  const start = zonedTime(day, hhmm, 'Africa/Casablanca');
  return { start: start.toISOString(), end: new Date(start.getTime() + minutes * 60000).toISOString(), label: hhmm };
};

describe('built-in Relayqo calendar', () => {
  let db: any, calendar: RelayqoCalendar, scheduler: CalendarScheduler;
  beforeAll(async () => { ({ db } = await portalDatabase()); }, 60000);
  beforeEach(async () => {
    await db.$executeRaw`DELETE FROM "Tenant"`;
    for (const t of ['ten-1', 'ten-2']) await db.$executeRaw`INSERT INTO "Tenant"(id,name,"updatedAt") VALUES (${t},'T',NOW())`;
    await db.$executeRaw`INSERT INTO "Account"(id,"tenantId",name,"updatedAt") VALUES ('acc-1','ten-1','A',NOW()),('acc-2','ten-2','B',NOW())`;
    calendar = new RelayqoCalendar(db);
    scheduler = new CalendarScheduler(calendar.provider('ten-1:acc-1'), () => NOW);
  });
  afterEach(() => setCalendarConnectionProviders(null));

  it('works with no setup: bookings on, default times', async () => {
    const runtime = await calendar.runtimeCalendar('ten-1', 'acc-1');
    expect(runtime).toMatchObject({ enabled: true, calendarId: 'relayqo', connectionId: 'ten-1:acc-1' });
    expect((await scheduler.freeSlots(runtime, '2026-10-16')).map(s => s.label)).toEqual(['10:00', '14:00', '18:00']);
  });

  it('books a free time once, keeps the customer details, and no longer offers it', async () => {
    const runtime = { ...(await calendar.saveSettings('ten-1', 'acc-1', { slotTimes: ['10:00', '14:00'], eventTitle: 'Demo' })), calendarId: 'relayqo' };
    expect(await scheduler.book(runtime, at('2026-10-16', '14:00'), { fullName: 'Yassine', email: 'y@example.com', _slotStart: 'x' })).toMatchObject({ ok: true });
    expect(await scheduler.book(runtime, at('2026-10-16', '14:00'), { fullName: 'Other' })).toEqual({ ok: false, reason: 'SLOT_TAKEN' });
    expect((await scheduler.freeSlots(runtime, '2026-10-16')).map(s => s.label)).toEqual(['10:00']);
    const [booking] = await calendar.upcoming('ten-1', 'acc-1', NOW);
    expect(booking).toMatchObject({ kind: 'BOOKING', title: 'Demo — Yassine', customerName: 'Yassine', contact: 'y@example.com', details: { fullName: 'Yassine', email: 'y@example.com' } });
    expect(booking.details._slotStart).toBeUndefined();
  });

  it('refuses a second booking at the same time even when both checked "free" first', async () => {
    const runtime = { calendarId: 'relayqo' };
    const provider = calendar.provider('ten-1:acc-1');
    const event = (name: string) => ({ id: name, summary: name, description: '', startIso: at('2026-10-16', '10:00').start, endIso: at('2026-10-16', '10:00').end, timezone: 'Africa/Casablanca', details: { fullName: name } });
    const results = await Promise.allSettled([provider.createEvent('relayqo', event('A')), provider.createEvent('relayqo', event('B'))]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(String((results.find(r => r.status === 'rejected') as any).reason)).toContain('CALENDAR_EVENT_CONFLICT');
    expect(await calendar.upcoming('ten-1', 'acc-1', NOW)).toHaveLength(1);
    void runtime;
  });

  it('frees the time again when a booking is cancelled, and keeps accounts apart', async () => {
    const runtime = { calendarId: 'relayqo' };
    await scheduler.book(runtime, at('2026-10-16', '10:00'), { fullName: 'Yassine' });
    const [booking] = await calendar.upcoming('ten-1', 'acc-1', NOW);
    await expect(calendar.cancel('ten-2', 'acc-2', booking.id)).rejects.toMatchObject({ code: 'BOOKING_NOT_FOUND' });
    await calendar.cancel('ten-1', 'acc-1', booking.id);
    expect(await calendar.upcoming('ten-1', 'acc-1', NOW)).toEqual([]);
    expect(await scheduler.book(runtime, at('2026-10-16', '10:00'), { fullName: 'Salma' })).toMatchObject({ ok: true });
    expect(await calendar.upcoming('ten-2', 'acc-2', NOW)).toEqual([]);
  });

  it('does not offer blocked times or a blocked day', async () => {
    const runtime = { calendarId: 'relayqo' };
    await calendar.block('ten-1', 'acc-1', { date: '2026-10-16', from: '13:00', to: '15:00', note: 'Dentist' });
    expect((await scheduler.freeSlots(runtime, '2026-10-16')).map(s => s.label)).toEqual(['10:00', '16:00', '18:00']); // free: 10, 12, 16, 18 → 3 spread over the day
    await calendar.block('ten-1', 'acc-1', { date: '2026-10-17' });
    expect(await scheduler.freeSlots(runtime, '2026-10-17')).toEqual([]);
    expect((await calendar.upcoming('ten-1', 'acc-1', NOW)).map(b => [b.kind, b.title])).toEqual([['BLOCKED', 'Dentist'], ['BLOCKED', 'Not available']]);
    await expect(calendar.block('ten-1', 'acc-1', { date: '2026-10-18', from: '15:00', to: '14:00' })).rejects.toBeInstanceOf(CalendarError);
  });

  it('pausing bookings turns the calendar off for the chatbot', async () => {
    await calendar.saveSettings('ten-1', 'acc-1', { enabled: false });
    expect((await calendar.runtimeCalendar('ten-1', 'acc-1')).enabled).toBe(false);
    expect((await calendar.status('ten-1', 'acc-1', NOW)).enabled).toBe(false);
  });

  it('lets the chatbot book through the workflow and say it is confirmed', async () => {
    setCalendarConnectionProviders(id => calendar.provider(id));
    const engine = new WorkflowEngine(new WorkflowStateEvaluator(), undefined, new ResponseBuilder(), new FieldValidator());
    engine.setCalendarScheduler(new CalendarScheduler(calendar.provider('ten-1:acc-1'), () => NOW));
    const workflow: any = { id: 'demo', name: 'Demo', description: '', initialState: 'day', calendarBooking: true, states: {
      day: { type: 'collect', field: 'demoDay', calendar: 'day', next: 'slot', prompt: { darija: 'شنو النهار؟' } },
      slot: { type: 'collect', field: 'demoSlot', calendar: 'slots', next: 'email', prompt: { darija: 'شنو الوقت؟' } },
      email: { type: 'collect', field: { name: 'email', type: 'email', required: true }, next: 'done', prompt: { darija: 'الإيميل؟' } },
      done: { type: 'end', prompt: { darija: 'شكرا' } } } };
    const config: any = { ...structuredClone(DEFAULT_BUSINESS_CONFIG), calendar: await calendar.runtimeCalendar('ten-1', 'acc-1') };
    let session: any = { id: 's', tenantId: 'ten-1', conversationId: 'c', workflowId: 'demo', stateId: 'day', contextData: { _started: true, _lang: 'darija', _script: 'arabic', fullName: 'ياسين' }, collectedData: { fullName: 'ياسين' }, stateHistory: [] };
    const say = async (text: string) => {
      const r = await engine.process(session, text, workflow, config, undefined, undefined, undefined, undefined, 'darija', 'arabic');
      session = { ...session, stateId: r.nextStateId ?? session.stateId, contextData: r.updatedContext, collectedData: r.updatedCollectedData, stateHistory: r.updatedStateHistory };
      return r;
    };
    expect((await say('غدا')).response).toMatch(/10:00[\s\S]*14:00[\s\S]*18:00/);
    await say('14:00');
    const done = await say('yassine@example.com');
    expect(done.response).toContain('تأكد الموعد');
    expect((await calendar.upcoming('ten-1', 'acc-1', NOW))[0]).toMatchObject({ customerName: 'ياسين', contact: 'yassine@example.com' });
  });
});
