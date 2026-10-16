import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { SecretBox } from '../../core/security/SecretBox';
import { logger } from '../../utils/logger';
import { CalendarProvider, GoogleCalendarProvider } from './CalendarScheduler';
import { CalendarError } from './RelayqoCalendar';

/** Google sign-in errors share the calendar error type. */
export { CalendarError as CalendarConnectionError };
const CalendarConnectionError = CalendarError;

/**
 * Optional Google Calendar sync for the built-in Relayqo calendar: the client signs in with Google from their portal
 * and picks a calendar; its busy times are respected and bookings are copied to it. Relayqo keeps only an encrypted
 * refresh token (SecretBox). Hidden until the platform has a Google OAuth app (GOOGLE_OAUTH_CLIENT_ID / _SECRET).
 */

const SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/calendar.readonly', 'https://www.googleapis.com/auth/calendar.events'];
type Row = { id: string; tenantId: string; accountId: string; googleEmail: string | null; encryptedRefreshToken: string;
  calendarId: string | null; calendarName: string | null; status: string };

export class GoogleCalendarConnections {
  private tokens = new Map<string, { value: string; expiresAt: number }>();

  constructor(private db: PrismaClient, private box: SecretBox, private fetchFn: typeof fetch = fetch) {}

  configured() { return Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET && process.env.PORTAL_PUBLIC_URL); }
  private callbackUrl() { return new URL('/api/client/calendar/google/callback', process.env.PORTAL_PUBLIC_URL).toString(); }

  /** Google sign-in URL. The state is encrypted and bound to the signed-in client, and expires after 10 minutes. */
  authorizationUrl(identity: { userId: string; accountId: string; tenantId: string }): string {
    if (!this.configured()) throw new CalendarConnectionError('CALENDAR_NOT_CONFIGURED', 'Google Calendar is not set up on this platform yet. Ask your administrator.');
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', process.env.GOOGLE_OAUTH_CLIENT_ID!);
    url.searchParams.set('redirect_uri', this.callbackUrl());
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', SCOPES.join(' '));
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent'); // always returns a refresh token
    url.searchParams.set('include_granted_scopes', 'true');
    url.searchParams.set('state', Buffer.from(this.box.encrypt(JSON.stringify({ ...identity, issuedAt: Date.now() }))).toString('base64url'));
    return url.toString();
  }

  verifyState(state: string, identity: { userId: string; accountId: string; tenantId: string }): void {
    let parsed: any;
    try { parsed = JSON.parse(this.box.decrypt(Buffer.from(state, 'base64url').toString('utf8'))); }
    catch { throw new CalendarConnectionError('CALENDAR_STATE_INVALID'); }
    if (!Number.isFinite(parsed?.issuedAt) || parsed.issuedAt > Date.now() + 30000 || Date.now() - parsed.issuedAt > 600000) throw new CalendarConnectionError('CALENDAR_STATE_EXPIRED');
    if (parsed.userId !== identity.userId || parsed.accountId !== identity.accountId || parsed.tenantId !== identity.tenantId) throw new CalendarConnectionError('CALENDAR_SESSION_MISMATCH');
  }

  private async google(url: string, init: RequestInit): Promise<any> {
    const response = await this.fetchFn(url, { ...init, signal: AbortSignal.timeout(10000) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new CalendarConnectionError(body?.error === 'invalid_grant' ? 'CALENDAR_RECONNECT_REQUIRED' : 'CALENDAR_GOOGLE_FAILED');
      throw error;
    }
    return body;
  }

  /** Exchanges the sign-in code and saves the connection (replacing an earlier one for this account). */
  async complete(code: string, tenantId: string, accountId: string): Promise<void> {
    const token = await this.google('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!, client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!, redirect_uri: this.callbackUrl(), grant_type: 'authorization_code' }) });
    const granted = String(token.scope || '').split(/\s+/);
    if (!token.refresh_token) throw new CalendarConnectionError('CALENDAR_NO_REFRESH_TOKEN');
    if (!granted.includes('https://www.googleapis.com/auth/calendar.events') || !granted.includes('https://www.googleapis.com/auth/calendar.readonly'))
      throw new CalendarConnectionError('CALENDAR_PERMISSION_MISSING');
    let email: string | null = null;
    try { email = JSON.parse(Buffer.from(String(token.id_token).split('.')[1], 'base64url').toString('utf8')).email || null; } catch { email = null; }
    const encrypted = this.box.encrypt(String(token.refresh_token));
    const previous = await this.row(tenantId, accountId);
    await this.db.$executeRaw`INSERT INTO "CalendarConnection"(id,"tenantId","accountId",provider,"googleEmail","encryptedRefreshToken",status,"updatedAt")
      VALUES (${randomUUID()},${tenantId},${accountId},'google',${email},${encrypted},'CONNECTED',NOW())
      ON CONFLICT ("accountId") DO UPDATE SET "googleEmail"=EXCLUDED."googleEmail","encryptedRefreshToken"=EXCLUDED."encryptedRefreshToken",status='CONNECTED',
        "calendarId"=CASE WHEN "CalendarConnection"."googleEmail"=EXCLUDED."googleEmail" THEN "CalendarConnection"."calendarId" ELSE NULL END,
        "calendarName"=CASE WHEN "CalendarConnection"."googleEmail"=EXCLUDED."googleEmail" THEN "CalendarConnection"."calendarName" ELSE NULL END,
        "updatedAt"=NOW()`;
    if (previous) this.tokens.delete(previous.id);
  }

  private async row(tenantId: string, accountId: string): Promise<Row | null> {
    const rows = await this.db.$queryRaw<Row[]>`SELECT * FROM "CalendarConnection" WHERE "tenantId"=${tenantId} AND "accountId"=${accountId} LIMIT 1`;
    return rows[0] || null;
  }

  private async accessToken(row: Pick<Row, 'id' | 'encryptedRefreshToken'>): Promise<string> {
    const cached = this.tokens.get(row.id);
    if (cached && cached.expiresAt > Date.now() + 60000) return cached.value;
    try {
      const data = await this.google('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: process.env.GOOGLE_OAUTH_CLIENT_ID || '', client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET || '',
          refresh_token: this.box.decrypt(row.encryptedRefreshToken), grant_type: 'refresh_token' }) });
      this.tokens.set(row.id, { value: data.access_token, expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000 });
      return data.access_token;
    } catch (error) {
      // Access was removed in the Google account: the client must connect again; the bot falls back to plain questions.
      if (error instanceof CalendarConnectionError && error.code === 'CALENDAR_RECONNECT_REQUIRED') {
        await this.db.$executeRaw`UPDATE "CalendarConnection" SET status='NEEDS_RECONNECT',"updatedAt"=NOW() WHERE id=${row.id}`;
        logger.warn(`GoogleCalendarConnections: connection ${row.id} needs to be reconnected`);
      }
      throw error;
    }
  }

  /** What the portal shows: never the token. */
  async status(tenantId: string, accountId: string) {
    const row = await this.row(tenantId, accountId);
    return { configured: this.configured(),
      connection: row ? { email: row.googleEmail, calendarId: row.calendarId, calendarName: row.calendarName, status: row.status } : null };
  }

  /** Calendars the client can add events to. */
  async calendars(tenantId: string, accountId: string): Promise<{ id: string; name: string; primary: boolean }[]> {
    const row = await this.row(tenantId, accountId);
    if (!row) throw new CalendarConnectionError('CALENDAR_NOT_CONNECTED');
    const data = await this.google('https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=writer&maxResults=100',
      { headers: { Authorization: `Bearer ${await this.accessToken(row)}` } });
    return (data.items || []).map((c: any) => ({ id: String(c.id), name: String(c.summaryOverride || c.summary || c.id), primary: c.primary === true }));
  }

  async choose(tenantId: string, accountId: string, calendarId: unknown) {
    const row = await this.row(tenantId, accountId);
    if (!row) throw new CalendarConnectionError('CALENDAR_NOT_CONNECTED');
    const chosen = (await this.calendars(tenantId, accountId)).find(c => c.id === calendarId);
    if (!chosen) throw new CalendarConnectionError('CALENDAR_NOT_FOUND', 'Choose one of your Google calendars.');
    await this.db.$executeRaw`UPDATE "CalendarConnection" SET "calendarId"=${chosen.id},"calendarName"=${chosen.name},"updatedAt"=NOW() WHERE id=${row.id}`;
    return this.status(tenantId, accountId);
  }

  async disconnect(tenantId: string, accountId: string): Promise<void> {
    const row = await this.row(tenantId, accountId);
    if (!row) return;
    try {
      await this.fetchFn('https://oauth2.googleapis.com/revoke', { method: 'POST', signal: AbortSignal.timeout(8000),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: this.box.decrypt(row.encryptedRefreshToken) }) });
    } catch (error: any) { logger.warn(`GoogleCalendarConnections: revoke failed: ${error?.message || error}`); }
    await this.db.$executeRaw`DELETE FROM "CalendarConnection" WHERE id=${row.id}`;
    this.tokens.delete(row.id);
  }

  /** The Google calendar to sync with, or null when none is linked and usable. */
  async linkedCalendar(tenantId: string, accountId: string): Promise<{ connectionId: string; calendarId: string } | null> {
    if (!this.configured()) return null;
    const row = await this.row(tenantId, accountId);
    return row && row.status === 'CONNECTED' && row.calendarId ? { connectionId: row.id, calendarId: row.calendarId } : null;
  }

  /** Calendar API access for one connection, used by the booking steps. */
  provider(connectionId: string): CalendarProvider {
    return new GoogleCalendarProvider(async () => {
      const rows = await this.db.$queryRaw<Row[]>`SELECT id,"encryptedRefreshToken",status FROM "CalendarConnection" WHERE id=${connectionId} LIMIT 1`;
      if (!rows[0] || rows[0].status !== 'CONNECTED') throw new CalendarConnectionError('CALENDAR_NOT_CONNECTED');
      return this.accessToken(rows[0]);
    }, this.fetchFn);
  }
}
