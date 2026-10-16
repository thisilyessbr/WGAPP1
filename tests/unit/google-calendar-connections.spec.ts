import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { portalDatabase } from '../helpers/portal-db';
import { SecretBox } from '../../src/core/security/SecretBox';
import { CalendarConnectionError, GoogleCalendarConnections } from '../../src/domain/calendar/GoogleCalendarConnections';
import { RelayqoCalendar, validateCalendarSettings } from '../../src/domain/calendar/RelayqoCalendar';
import { CalendarScheduler, schedulerForConnection, setCalendarConnectionProviders, zonedTime } from '../../src/domain/calendar/CalendarScheduler';

const box = new SecretBox({ key: 'k'.repeat(32) });
const who = { userId: 'user-1', accountId: 'acc-1', tenantId: 'ten-1' };
const env = { GOOGLE_OAUTH_CLIENT_ID: 'client-id', GOOGLE_OAUTH_CLIENT_SECRET: 'client-secret', PORTAL_PUBLIC_URL: 'https://portal.test' };
const idToken = (email: string) => `x.${Buffer.from(JSON.stringify({ email })).toString('base64url')}.y`;
const GRANTED = 'openid email https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events';

/** Google endpoints the connection talks to, recorded for assertions. */
function fakeGoogle(overrides: Record<string, (body: any) => [number, any]> = {}) {
  const calls: { url: string; body: any; auth?: string }[] = [];
  const events: any[] = [];
  const routes: Record<string, (body: any) => [number, any]> = {
    'oauth2.googleapis.com/token': body => body.get('grant_type') === 'authorization_code'
      ? [200, { access_token: 'access-1', refresh_token: 'refresh-secret', scope: GRANTED, id_token: idToken('owner@gmail.com'), expires_in: 3600 }]
      : [200, { access_token: 'access-2', expires_in: 3600 }],
    'calendarList': () => [200, { items: [{ id: 'owner@gmail.com', summary: 'Owner', primary: true }, { id: 'demos@group.calendar.google.com', summary: 'Demos' }] }],
    'freeBusy': () => [200, { calendars: { 'demos@group.calendar.google.com': { busy: [] } } }],
    '/events': body => { events.push(body); return [200, { id: body.id }]; },
    'oauth2.googleapis.com/revoke': () => [200, {}],
    ...overrides
  };
  const fetchFn = (async (url: string, init: any = {}) => {
    const body = init.body instanceof URLSearchParams ? init.body : init.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, body, auth: init.headers?.Authorization });
    const key = Object.keys(routes).find(k => url.includes(k));
    const [status, json] = key ? routes[key](body) : [404, {}];
    return { ok: status < 400, status, json: async () => json, text: async () => JSON.stringify(json) } as any;
  }) as typeof fetch;
  return { fetchFn, calls, events };
}

describe('Google Calendar linked by the client', () => {
  let db: any, saved: Record<string, string | undefined>;
  beforeAll(async () => { ({ db } = await portalDatabase()); }, 60000);
  beforeEach(async () => {
    await db.$executeRaw`DELETE FROM "Tenant"`;
    saved = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]));
    Object.assign(process.env, env);
    await db.$executeRaw`INSERT INTO "Tenant"(id,name,"updatedAt") VALUES ('ten-1','T',NOW())`;
    await db.$executeRaw`INSERT INTO "Account"(id,"tenantId",name,"updatedAt") VALUES ('acc-1','ten-1','A',NOW())`;
  });
  afterEach(() => { for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v; setCalendarConnectionProviders(null); });

  it('asks Google for lasting calendar access with a state bound to the signed-in client', () => {
    const service = new GoogleCalendarConnections(db, box);
    const url = new URL(service.authorizationUrl(who));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('redirect_uri')).toBe('https://portal.test/api/client/calendar/google/callback');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('scope')).toContain('calendar.events');
    const state = url.searchParams.get('state')!;
    expect(() => service.verifyState(state, who)).not.toThrow();
    expect(() => service.verifyState(state, { ...who, accountId: 'acc-2' })).toThrow('CALENDAR_SESSION_MISMATCH');
    expect(() => service.verifyState('forged', who)).toThrow('CALENDAR_STATE_INVALID');
  });

  it('is unavailable until the platform OAuth app is configured', () => {
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    const service = new GoogleCalendarConnections(db, box);
    expect(service.configured()).toBe(false);
    expect(() => service.authorizationUrl(who)).toThrow(CalendarConnectionError);
  });

  it('stores only an encrypted refresh token, then books in the calendar the client chose', async () => {
    const google = fakeGoogle();
    const service = new GoogleCalendarConnections(db, box, google.fetchFn);
    await service.complete('code-1', 'ten-1', 'acc-1');
    const [row] = await db.$queryRaw`SELECT * FROM "CalendarConnection"`;
    expect(row.encryptedRefreshToken).not.toContain('refresh-secret');
    expect(box.decrypt(row.encryptedRefreshToken)).toBe('refresh-secret');
    expect((await service.status('ten-1', 'acc-1')).connection).toMatchObject({ email: 'owner@gmail.com', calendarId: null, status: 'CONNECTED' });
    expect(JSON.stringify(await service.status('ten-1', 'acc-1'))).not.toContain('refresh');

    expect(await service.linkedCalendar('ten-1', 'acc-1')).toBeNull(); // no calendar chosen yet
    await expect(service.choose('ten-1', 'acc-1', 'someone-else@gmail.com')).rejects.toMatchObject({ code: 'CALENDAR_NOT_FOUND' });
    await service.choose('ten-1', 'acc-1', 'demos@group.calendar.google.com');
    expect(await service.linkedCalendar('ten-1', 'acc-1')).toMatchObject({ calendarId: 'demos@group.calendar.google.com' });

    // The booking is made in the built-in calendar and copied to the linked Google Calendar.
    const relayqo = new RelayqoCalendar(db, service);
    setCalendarConnectionProviders(id => relayqo.provider(id));
    const runtime = await relayqo.runtimeCalendar('ten-1', 'acc-1');
    const now = zonedTime('2026-10-15', '09:00', 'Africa/Casablanca');
    const scheduler = new CalendarScheduler((schedulerForConnection(runtime.connectionId!) as any).provider, () => now);
    const booked = await scheduler.book(runtime, { start: zonedTime('2026-10-16', '10:00', 'Africa/Casablanca').toISOString(), end: zonedTime('2026-10-16', '10:30', 'Africa/Casablanca').toISOString(), label: '10:00' }, { fullName: 'Yassine' });
    expect(booked.ok).toBe(true);
    expect((await relayqo.upcoming('ten-1', 'acc-1', now))[0]).toMatchObject({ customerName: 'Yassine', kind: 'BOOKING' });
    expect(google.events[0].summary).toContain('Yassine');
    expect(google.calls.find(c => c.url.includes('/events'))!.auth).toMatch(/^Bearer access-/);
    expect(google.calls.some(c => c.url.includes('freeBusy'))).toBe(true);
  });

  it('keeps the chosen calendar on reconnect with the same Google account, and clears it for another account', async () => {
    let email = 'owner@gmail.com';
    const google = fakeGoogle({ 'oauth2.googleapis.com/token': body => body.get('grant_type') === 'authorization_code'
      ? [200, { access_token: 'a', refresh_token: 'r-' + email, scope: GRANTED, id_token: idToken(email) }] : [200, { access_token: 'a2', expires_in: 3600 }] });
    const service = new GoogleCalendarConnections(db, box, google.fetchFn);
    await service.complete('c', 'ten-1', 'acc-1');
    await service.choose('ten-1', 'acc-1', 'demos@group.calendar.google.com');
    await service.complete('c', 'ten-1', 'acc-1');
    expect((await service.status('ten-1', 'acc-1')).connection?.calendarId).toBe('demos@group.calendar.google.com');
    email = 'other@gmail.com';
    await service.complete('c', 'ten-1', 'acc-1');
    expect((await service.status('ten-1', 'acc-1')).connection).toMatchObject({ email: 'other@gmail.com', calendarId: null });
  });

  it('refuses a sign-in without calendar permission or lasting access', async () => {
    const noScope = fakeGoogle({ 'oauth2.googleapis.com/token': () => [200, { access_token: 'a', refresh_token: 'r', scope: 'openid email' }] });
    await expect(new GoogleCalendarConnections(db, box, noScope.fetchFn).complete('c', 'ten-1', 'acc-1')).rejects.toThrow('CALENDAR_PERMISSION_MISSING');
    const noRefresh = fakeGoogle({ 'oauth2.googleapis.com/token': () => [200, { access_token: 'a', scope: GRANTED }] });
    await expect(new GoogleCalendarConnections(db, box, noRefresh.fetchFn).complete('c', 'ten-1', 'acc-1')).rejects.toThrow('CALENDAR_NO_REFRESH_TOKEN');
    expect(await db.$queryRaw`SELECT * FROM "CalendarConnection"`).toEqual([]);
  });

  it('marks the connection for reconnecting when the client removed access in Google, and stops using it', async () => {
    let revoked = false;
    const google = fakeGoogle({ 'oauth2.googleapis.com/token': body => body.get('grant_type') === 'authorization_code'
      ? [200, { access_token: 'a', refresh_token: 'r', scope: GRANTED, id_token: idToken('o@gmail.com') }]
      : revoked ? [400, { error: 'invalid_grant' }] : [200, { access_token: 'a2', expires_in: 1 }] });
    const service = new GoogleCalendarConnections(db, box, google.fetchFn);
    await service.complete('c', 'ten-1', 'acc-1');
    await service.choose('ten-1', 'acc-1', 'demos@group.calendar.google.com');
    revoked = true;
    await expect(service.calendars('ten-1', 'acc-1')).rejects.toThrow('CALENDAR_RECONNECT_REQUIRED');
    expect((await service.status('ten-1', 'acc-1')).connection?.status).toBe('NEEDS_RECONNECT');
    expect(await service.linkedCalendar('ten-1', 'acc-1')).toBeNull();
  });

  it('revokes and deletes on disconnect', async () => {
    const google = fakeGoogle();
    const service = new GoogleCalendarConnections(db, box, google.fetchFn);
    await service.complete('c', 'ten-1', 'acc-1');
    await service.disconnect('ten-1', 'acc-1');
    expect(google.calls.some(c => c.url.includes('/revoke'))).toBe(true);
    expect((await service.status('ten-1', 'acc-1')).connection).toBeNull();
  });
});

describe('client calendar settings', () => {
  it.each([
    [{ slotTimes: ['25:00'] }, 'INVALID_CALENDAR_SLOTS'], [{ workingDays: [] }, 'INVALID_CALENDAR_DAYS'], [{ maxSlots: 9 }, 'INVALID_CALENDAR_SETTINGS'],
    [{ timezone: 'Mars/Base' }, 'INVALID_CALENDAR_TIMEZONE'], [{ calendarId: 'x' }, 'INVALID_CALENDAR_SETTINGS']
  ])('rejects %j', (input, code) => {
    let error: any;
    try { validateCalendarSettings(input); } catch (e) { error = e; }
    expect(error).toBeInstanceOf(CalendarConnectionError);
    expect(error.code).toBe(code);
  });
  it('keeps valid settings, sorted and de-duplicated', () =>
    expect(validateCalendarSettings({ enabled: false, slotTimes: ['18:00', '10:00', '10:00'], workingDays: [6, 1], eventTitle: ' Démo ', minNoticeMinutes: '60' }))
      .toEqual({ enabled: false, slotTimes: ['10:00', '18:00'], workingDays: [1, 6], eventTitle: 'Démo', minNoticeMinutes: 60 }));
});

describe('runtime configuration', () => {
  it('uses the calendar the client linked, also in admin previews, and keeps working if the lookup fails', async () => {
    const { AccountConfigService } = await import('../../src/domain/tenant/AccountConfigService');
    const { DEFAULT_BUSINESS_CONFIG } = await import('../../src/domain/tenant/BusinessConfig');
    const service = new AccountConfigService({} as any, { getConfig: async () => DEFAULT_BUSINESS_CONFIG } as any);
    const admin = { ...structuredClone(DEFAULT_BUSINESS_CONFIG), calendar: { enabled: true, calendarId: 'admin@example.com' } } as any;
    let linked: any = { enabled: true, calendarId: 'client@gmail.com', connectionId: 'conn-1' };
    service.setCalendarOverlay(async () => { if (linked === 'fail') throw new Error('db down'); return linked; });
    const preview = () => service.runWithConfigOverride('t', 'a', admin, () => service.getEffectiveConfig('t', 'a'));
    expect(((await preview()) as any).calendar).toEqual(linked);
    linked = null;
    expect(((await preview()) as any).calendar.calendarId).toBe('admin@example.com');
    linked = 'fail';
    expect(((await preview()) as any).calendar.calendarId).toBe('admin@example.com');
  });
});
