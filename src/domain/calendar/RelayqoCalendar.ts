import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { logger } from '../../utils/logger';
import { BusyRange, CalendarConfig, CalendarProvider, zonedTime } from './CalendarScheduler';
import type { GoogleCalendarConnections } from './GoogleCalendarConnections';

/**
 * Relayqo's built-in calendar. Each account sets the times customers can book; the chatbot books into the
 * Booking table, which refuses two bookings at the same start time. It needs no external account or keys.
 * A Google Calendar the client links later is an optional extra: its busy times are respected and each
 * booking is copied to it, but the booking itself always lives here.
 */

export class CalendarError extends Error {
  constructor(public code: string, message?: string) { super(message || code); }
}

const SETTING_KEYS = ['enabled', 'timezone', 'durationMinutes', 'slotTimes', 'workingDays', 'maxSlots', 'minNoticeMinutes', 'daysAhead', 'eventTitle'] as const;
export type CalendarSettings = Pick<CalendarConfig, typeof SETTING_KEYS[number]>;
export const DEFAULT_TIMEZONE = 'Africa/Casablanca';

/** Checks client-entered availability. */
export function validateCalendarSettings(raw: unknown): CalendarSettings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new CalendarError('INVALID_CALENDAR_SETTINGS');
  const input = raw as Record<string, any>, out: Record<string, any> = {};
  for (const key of Object.keys(input)) if (!(SETTING_KEYS as readonly string[]).includes(key)) throw new CalendarError('INVALID_CALENDAR_SETTINGS');
  const int = (key: string, min: number, max: number) => {
    if (input[key] === undefined || input[key] === null || input[key] === '') return;
    const n = Number(input[key]);
    if (!Number.isInteger(n) || n < min || n > max) throw new CalendarError('INVALID_CALENDAR_SETTINGS', `${key} must be between ${min} and ${max}.`);
    out[key] = n;
  };
  if (input.enabled !== undefined) { if (typeof input.enabled !== 'boolean') throw new CalendarError('INVALID_CALENDAR_SETTINGS'); out.enabled = input.enabled; }
  if (input.timezone !== undefined && input.timezone !== '') {
    try { new Intl.DateTimeFormat('en', { timeZone: String(input.timezone) }); } catch { throw new CalendarError('INVALID_CALENDAR_TIMEZONE', 'Unknown time zone.'); }
    out.timezone = String(input.timezone).slice(0, 100);
  }
  if (input.eventTitle !== undefined && input.eventTitle !== '') out.eventTitle = String(input.eventTitle).trim().slice(0, 100);
  int('durationMinutes', 10, 240); int('maxSlots', 1, 6); int('minNoticeMinutes', 0, 10080); int('daysAhead', 1, 90);
  if (input.slotTimes !== undefined) {
    if (!Array.isArray(input.slotTimes) || !input.slotTimes.length || input.slotTimes.length > 24 || input.slotTimes.some((t: unknown) => !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(t))))
      throw new CalendarError('INVALID_CALENDAR_SLOTS', 'Times must look like 10:00 (24-hour).');
    out.slotTimes = [...new Set(input.slotTimes.map(String))].sort();
  }
  if (input.workingDays !== undefined) {
    if (!Array.isArray(input.workingDays) || !input.workingDays.length || input.workingDays.some((d: unknown) => !Number.isInteger(d) || (d as number) < 0 || (d as number) > 6))
      throw new CalendarError('INVALID_CALENDAR_DAYS', 'Choose at least one working day.');
    out.workingDays = [...new Set(input.workingDays as number[])].sort();
  }
  return out as CalendarSettings;
}

type BookingRow = { id: string; startAt: Date | string; endAt: Date | string; kind: string; status: string; title: string; customerName: string | null; contact: string | null; details: any };
// Times are read back as UTC text so every driver (Prisma, PGlite) returns the same instant for a TIMESTAMP column.
const iso = (v: Date | string) => new Date(v).toISOString();
/** Local day and times are computed here, with the same time-zone data the chatbot uses when it offers times. */
const local = (value: Date | string, timeZone: string) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(value)).map(p => [p.type, p.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
};
const view = (r: BookingRow, timeZone: string) => {
  const start = local(r.startAt, timeZone), end = local(r.endAt, timeZone);
  return { id: r.id, start: iso(r.startAt), end: iso(r.endAt), day: start.day, startTime: start.time, endTime: end.day === start.day ? end.time : '24:00',
    kind: r.kind, title: r.title, customerName: r.customerName, contact: r.contact, details: r.details || {} };
};

export class RelayqoCalendar {
  constructor(private db: PrismaClient, private google?: GoogleCalendarConnections) {}

  async settings(tenantId: string, accountId: string): Promise<CalendarSettings> {
    const rows = await this.db.$queryRaw<{ settings: any }[]>`SELECT settings FROM "AccountCalendar" WHERE "tenantId"=${tenantId} AND "accountId"=${accountId} LIMIT 1`;
    return (rows[0]?.settings || {}) as CalendarSettings;
  }

  async saveSettings(tenantId: string, accountId: string, raw: unknown): Promise<CalendarSettings> {
    const settings = validateCalendarSettings(raw);
    await this.db.$executeRaw`INSERT INTO "AccountCalendar"("accountId","tenantId",settings,"updatedAt") VALUES (${accountId},${tenantId},${JSON.stringify(settings)}::jsonb,NOW())
      ON CONFLICT ("accountId") DO UPDATE SET settings=EXCLUDED.settings,"updatedAt"=NOW()`;
    return settings;
  }

  /** Today's date (YYYY-MM-DD) in the account's time zone. */
  async today(tenantId: string, accountId: string, now = new Date()): Promise<string> {
    const tz = (await this.settings(tenantId, accountId)).timezone || DEFAULT_TIMEZONE;
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  }

  /** Bookings and blocked times between two local days (inclusive), at most 62 days, for the calendar view. */
  async between(tenantId: string, accountId: string, fromDay: string, toDay: string, limit = 1000) {
    if (![fromDay, toDay].every(d => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d + 'T00:00:00Z'))) || toDay < fromDay
      || (Date.parse(toDay + 'T00:00:00Z') - Date.parse(fromDay + 'T00:00:00Z')) / 86400000 > 62) throw new CalendarError('INVALID_CALENDAR_RANGE');
    const tz = (await this.settings(tenantId, accountId)).timezone || DEFAULT_TIMEZONE;
    const next = new Date(Date.parse(toDay + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10);
    const from = zonedTime(fromDay, '00:00', tz), to = zonedTime(next, '00:00', tz);
    const rows = await this.db.$queryRaw<BookingRow[]>`SELECT id,to_char("startAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "startAt",to_char("endAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "endAt",
      kind,status,title,"customerName",contact,details FROM "Booking" WHERE "tenantId"=${tenantId} AND "accountId"=${accountId}
      AND status='BOOKED' AND "startAt"<${to} AND "endAt">${from} ORDER BY "startAt" ASC LIMIT ${limit}`;
    return rows.map(row => view(row, tz));
  }

  /** Bookings and blocked times from the start of today onwards (in the account's time zone). */
  async upcoming(tenantId: string, accountId: string, now = new Date(), days = 60) {
    const today = await this.today(tenantId, accountId, now);
    return this.between(tenantId, accountId, today, new Date(Date.parse(today + 'T12:00:00Z') + days * 86400000).toISOString().slice(0, 10));
  }

  /** Blocks a time (or the whole day) so the chatbot does not offer it. */
  async block(tenantId: string, accountId: string, input: { date?: unknown; from?: unknown; to?: unknown; note?: unknown }) {
    const tz = (await this.settings(tenantId, accountId)).timezone || DEFAULT_TIMEZONE;
    const date = String(input.date || ''), from = String(input.from || '') || '00:00', to = String(input.to || '') || '23:59';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || ![from, to].every(t => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(t)) || to <= from)
      throw new CalendarError('INVALID_CALENDAR_BLOCK', 'Choose a day and a start time before the end time.');
    const start = zonedTime(date, from, tz), end = to === '23:59' ? new Date(zonedTime(date, '23:59', tz).getTime() + 60000) : zonedTime(date, to, tz);
    const note = String(input.note || '').trim().slice(0, 200) || 'Not available';
    await this.insert(tenantId, accountId, { start, end, kind: 'BLOCKED', title: note });
  }

  async cancel(tenantId: string, accountId: string, id: string): Promise<void> {
    const changed = await this.db.$executeRaw`UPDATE "Booking" SET status='CANCELLED',"updatedAt"=NOW() WHERE id=${id} AND "tenantId"=${tenantId} AND "accountId"=${accountId} AND status='BOOKED'`;
    if (!changed) throw new CalendarError('BOOKING_NOT_FOUND', 'This booking no longer exists.');
  }

  private async insert(tenantId: string, accountId: string, b: { start: Date; end: Date; kind: string; title: string; customerName?: string | null; contact?: string | null; details?: Record<string, unknown> }) {
    const id = randomUUID();
    try {
      await this.db.$executeRaw`INSERT INTO "Booking"(id,"tenantId","accountId","startAt","endAt",kind,title,"customerName",contact,details,"updatedAt")
        VALUES (${id},${tenantId},${accountId},${b.start},${b.end},${b.kind},${b.title},${b.customerName ?? null},${b.contact ?? null},${JSON.stringify(b.details || {})}::jsonb,NOW())`;
    } catch (error: any) {
      // The partial unique index refuses a second active booking at the same start time.
      if (error?.code === '23505' || /duplicate key|unique/i.test(String(error?.message || ''))) throw new Error('CALENDAR_EVENT_CONFLICT');
      throw error;
    }
    return id;
  }

  /** What the chatbot uses for this account. Bookings are on unless the client paused them. */
  async runtimeCalendar(tenantId: string, accountId: string): Promise<CalendarConfig> {
    const settings = await this.settings(tenantId, accountId);
    return { ...settings, enabled: settings.enabled !== false, calendarId: 'relayqo', provider: 'relayqo', connectionId: `${tenantId}:${accountId}` };
  }

  /** Calendar access for one account (connection id "tenantId:accountId"), used by the booking steps. */
  provider(connectionId: string): CalendarProvider {
    const [tenantId, accountId] = connectionId.split(':');
    const linked = () => this.google?.linkedCalendar(tenantId, accountId).catch(() => null) ?? Promise.resolve(null);
    return {
      busy: async (_calendarId: string, fromIso: string, toIso: string): Promise<BusyRange[]> => {
        const rows = await this.db.$queryRaw<BookingRow[]>`SELECT to_char("startAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "startAt",to_char("endAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "endAt" FROM "Booking" WHERE "tenantId"=${tenantId} AND "accountId"=${accountId}
          AND status='BOOKED' AND "startAt"<${new Date(toIso)} AND "endAt">${new Date(fromIso)}`;
        const busy = rows.map(r => ({ start: iso(r.startAt), end: iso(r.endAt) }));
        const google = await linked();
        if (google) {
          try { busy.push(...await this.google!.provider(google.connectionId).busy(google.calendarId, fromIso, toIso)); }
          catch (error: any) { logger.warn(`RelayqoCalendar: linked Google Calendar unavailable: ${error?.message || error}`); }
        }
        return busy;
      },
      createEvent: async (_calendarId, e) => {
        const d = (e.details || {}) as Record<string, unknown>;
        const id = await this.insert(tenantId, accountId, { start: new Date(e.startIso), end: new Date(e.endIso), kind: 'BOOKING', title: e.summary,
          customerName: String(d.fullName || d.name || '').trim() || null, contact: String(d.email || d.phone || '').trim() || null, details: d });
        const google = await linked();
        if (google) {
          // A copy in the client's Google Calendar; the booking stands even if the copy fails.
          try { await this.google!.provider(google.connectionId).createEvent(google.calendarId, e); }
          catch (error: any) { logger.warn(`RelayqoCalendar: copy to Google Calendar failed: ${error?.message || error}`); }
        }
        return { id };
      },
      // Moving an appointment frees the old time. (A copy already sent to Google Calendar stays there.)
      cancelEvent: async (_calendarId, eventId) => { await this.cancel(tenantId, accountId, eventId); }
    };
  }

  /** Summary for the admin workflow editor. */
  async status(tenantId: string, accountId: string, now = new Date()) {
    const settings = await this.settings(tenantId, accountId);
    const rows = await this.db.$queryRaw<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM "Booking" WHERE "tenantId"=${tenantId} AND "accountId"=${accountId}
      AND status='BOOKED' AND kind='BOOKING' AND "startAt">=${now}`;
    const google = this.google ? await this.google.status(tenantId, accountId).catch(() => null) : null;
    return { settings, enabled: settings.enabled !== false, upcomingBookings: Number(rows[0]?.n || 0), google };
  }
}
