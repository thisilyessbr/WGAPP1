import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'crypto';
import { Request, Response } from 'express';
import { PortalStore } from './PortalStore';
import { PortalError, PortalPrincipal, PortalUser } from './types';
import { email, text } from './validation';
import { localEmailBypass } from './localTesting';

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const randomToken = () => randomBytes(32).toString('base64url');
// Temporary launch access while outbound email is unavailable. Remove after email delivery is configured.
const ADMIN_EMAIL_BYPASS_EXPIRES_AT = Date.parse('2026-10-02T00:00:00Z');
const ADMIN_EMAIL_BYPASS_ACCOUNT = 'admin@admin123.com';
export async function hashPassword(password: string): Promise<string> {
  if (typeof password !== 'string' || password.length < 12 || password.length > 256) throw new PortalError(400, 'WEAK_PASSWORD', 'Use a password with 12–256 characters.');
  const salt = randomBytes(16).toString('hex');
  const key = await derive(password, salt);
  return `scrypt$32768$${salt}$${key.toString('hex')}`;
}
function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 }, (err, key) => err ? reject(err) : resolve(key)));
}
export async function verifyPassword(password: unknown, encoded: string): Promise<boolean> {
  if (typeof password !== 'string' || password.length > 256) return false;
  const parts = encoded.split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt' || parts[1] !== '32768' || !/^[a-f0-9]{32}$/.test(parts[2]) || !/^[a-f0-9]{128}$/.test(parts[3])) return false;
  const key = await derive(password, parts[2]);
  return timingSafeEqual(key, Buffer.from(parts[3], 'hex'));
}

export interface AuthOptions {
  publicUrl: string;
  developmentLinks?: boolean;
  sendLink?: (email: string, kind: string, url: string) => Promise<void>;
}
export class PortalAuth {
  public readonly origin: string;
  private readonly secure: boolean;
  constructor(public store: PortalStore, private options: AuthOptions) {
    const url = new URL(options.publicUrl);
    if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') throw Error('PORTAL_PUBLIC_URL must use HTTPS in production.');
    this.origin = url.origin;
    this.secure = url.protocol === 'https:';
  }
  private developmentLinks() { return process.env.NODE_ENV !== 'production' && this.options.developmentLinks === true; }
  private resendConfigured() { return Boolean(process.env.RESEND_API_KEY && process.env.PORTAL_MAIL_FROM); }
  skipsEmail() { return localEmailBypass(this.origin); }
  private temporaryAdminEmailBypass(user: PortalUser) {
    return user.role === 'ADMIN' && user.email === ADMIN_EMAIL_BYPASS_ACCOUNT && Boolean(user.verifiedAt)
      && Date.now() < ADMIN_EMAIL_BYPASS_EXPIRES_AT
      && !this.options.sendLink && !this.developmentLinks() && !this.resendConfigured()
      && !(process.env.PORTAL_MAIL_WEBHOOK_URL && process.env.PORTAL_MAIL_WEBHOOK_SECRET);
  }
  assertMailConfigured() {
    if (!this.options.sendLink && !this.developmentLinks() && !this.resendConfigured() && !(process.env.PORTAL_MAIL_WEBHOOK_URL && process.env.PORTAL_MAIL_WEBHOOK_SECRET)) {
      throw new PortalError(503, 'EMAIL_SETUP_REQUIRED', 'Email delivery is not configured. Contact the service administrator.');
    }
  }
  private async deliverWithResend(emailAddress: string, kind: string, url: string) {
    const subjects: Record<string, string> = {
      VERIFY: 'Verify your Relayqo account',
      RESET: 'Reset your Relayqo password',
      ADMIN_LOGIN: 'Confirm your Relayqo administrator login'
    };
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Relayqo/1.0',
        'Idempotency-Key': createHash('sha256').update(`${kind}|${emailAddress}|${url}`).digest('hex')
      },
      body: JSON.stringify({
        from: process.env.PORTAL_MAIL_FROM,
        to: [emailAddress],
        subject: subjects[kind] || 'Your secure Relayqo link',
        text: `Use this secure link to continue with Relayqo:\n\n${url}\n\nIf you did not request this, you can ignore this email.`
      }),
      signal: AbortSignal.timeout(8000),
      redirect: 'error'
    });
    if (!response.ok) throw new PortalError(503, 'EMAIL_DELIVERY_FAILED', 'Email delivery is temporarily unavailable. Request a new link shortly.');
  }
  async deliver(emailAddress: string, kind: string, url: string): Promise<{ developmentLink?: string }> {
    if (this.options.sendLink) await this.options.sendLink(emailAddress, kind, url);
    else if (this.developmentLinks()) return { developmentLink: url };
    else if (this.resendConfigured()) await this.deliverWithResend(emailAddress, kind, url);
    else {
      this.assertMailConfigured();
      const endpoint = new URL(process.env.PORTAL_MAIL_WEBHOOK_URL!);
      if (endpoint.protocol !== 'https:') throw new PortalError(503, 'EMAIL_SETUP_REQUIRED');
      const body = JSON.stringify({ to: emailAddress, template: kind, actionUrl: url });
      const timestamp = String(Date.now());
      const signature = createHmac('sha256', process.env.PORTAL_MAIL_WEBHOOK_SECRET!).update(timestamp + '.' + body).digest('hex');
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Relayqo-Timestamp': timestamp, 'X-Relayqo-Signature': signature }, body, signal: AbortSignal.timeout(8000), redirect: 'error' });
      if (!response.ok) throw new PortalError(503, 'EMAIL_DELIVERY_FAILED', 'Email delivery is temporarily unavailable. Request a new link shortly.');
    }
    return {};
  }
  private safeUser(user: PortalUser): Omit<PortalUser, 'passwordHash'> {
    const { passwordHash: _, ...safe } = user; return safe;
  }
  async signup(input: any, ip: string) {
    const address = email(input.email), name = text(input.name, 160);
    if (!name) throw new PortalError(400, 'NAME_REQUIRED');
    await this.store.throttle('signup:' + hashToken(ip), 5, 3600);
    if (!this.skipsEmail()) this.assertMailConfigured();
    const passwordHash = await hashPassword(input.password);
    const existing = await this.store.userByEmail(address);
    const result = existing ? { userId: existing.id } : await this.store.register(address, name, passwordHash, null);
    if (this.skipsEmail()) {
      if (existing) return { message: 'An account already exists for this email. Log in with its password.', redirect: '/login' };
      return { message: 'Your account is ready. Log in to continue.', redirect: '/login' };
    }
    if (existing?.verifiedAt || existing?.disabled) return { message: 'Check your email to continue, or log in if you already have an account.' };
    await this.store.throttle('signup-mail:' + hashToken(address), 3, 900);
    const delivery = await this.sendToken(result.userId, address, 'VERIFY');
    return { message: 'Check your email to verify your account.', ...delivery };
  }
  async sendToken(userId: string, address: string, kind: 'VERIFY' | 'RESET') {
    const token = randomToken();
    await this.store.issueToken(userId, hashToken(token), kind, new Date(Date.now() + (kind === 'VERIFY' ? 86400000 : 1800000)));
    return this.deliver(address, kind, `${this.origin}/${kind === 'VERIFY' ? 'verify-email' : 'reset-password'}#token=${token}`);
  }
  async requestLink(input: any, kind: 'VERIFY' | 'RESET', ip: string) {
    const address = email(input.email);
    await this.store.throttle('mail-ip:' + hashToken(ip), 10, 3600);
    await this.store.throttle('mail:' + hashToken(address), 3, 900);
    this.assertMailConfigured();
    const user = await this.store.userByEmail(address);
    const delivery = user && !user.disabled && (kind === 'RESET' || !user.verifiedAt) ? await this.sendToken(user.id, address, kind) : {};
    return { message: 'If the account is eligible, an email is on its way.', ...delivery };
  }
  async login(input: any, ip: string, res: Response) {
    const address = email(input.email);
    await this.store.throttle('login-ip:' + hashToken(ip), 30, 900);
    await this.store.throttle('login:' + hashToken(address), 10, 900);
    const user = await this.store.userByEmail(address);
    const fallback = 'scrypt$32768$00000000000000000000000000000000$' + '0'.repeat(128);
    const valid = await verifyPassword(input.password, user?.passwordHash || fallback);
    if (!user || !valid || user.disabled) throw new PortalError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
    if (!user.verifiedAt && !this.skipsEmail()) throw new PortalError(403, 'EMAIL_NOT_VERIFIED', 'Verify your email before logging in.');
    if (user.role === 'ADMIN' && !this.skipsEmail() && !this.temporaryAdminEmailBypass(user)) {
      this.assertMailConfigured();
      const token = randomToken();
      await this.store.db.$executeRaw`DELETE FROM "PortalAuthToken" WHERE "userId"=${user.id} AND kind='ADMIN_LOGIN'`;
      await this.store.db.$executeRaw`INSERT INTO "PortalAuthToken"("tokenHash","userId",kind,"expiresAt") VALUES (${hashToken(token)},${user.id},'ADMIN_LOGIN',${new Date(Date.now() + 600000)})`;
      const delivery = await this.deliver(address, 'ADMIN_LOGIN', `${this.origin}/admin-confirm#token=${token}`);
      return { requiresEmailConfirmation: true, message: 'Confirm this administrator login using the link sent to your email.', ...delivery };
    }
    return this.issueSession(user, res);
  }
  async confirmAdmin(token: string, res: Response) {
    const user = await this.store.transaction(async s => {
      const rows = await s.db.$queryRaw<any[]>`DELETE FROM "PortalAuthToken" WHERE "tokenHash"=${hashToken(token)} AND kind='ADMIN_LOGIN' AND "expiresAt">NOW() RETURNING "userId"`;
      if (!rows.length) throw new PortalError(400, 'LINK_EXPIRED');
      const u = await s.userById(rows[0].userId);
      if (!u || u.role !== 'ADMIN' || u.disabled || !u.verifiedAt) throw new PortalError(403, 'ACCESS_DENIED');
      return u;
    });
    return this.issueSession(user, res);
  }
  async issueSession(user: PortalUser, res: Response) {
    const token = randomToken(), csrf = randomToken();
    const ttl = user.role === 'ADMIN' ? 3600000 : 604800000;
    await this.store.newSession(user.id, hashToken(token), csrf, new Date(Date.now() + ttl));
    res.cookie('relayqo_portal', token, { httpOnly: true, secure: this.secure, sameSite: 'lax', path: '/', maxAge: ttl });
    await this.store.audit(user.id, null, 'SESSION_CREATED', { role: user.role });
    return { user: this.safeUser(user), csrf, redirect: user.role === 'ADMIN' ? '/admin' : '/app' };
  }
  async principal(req: Request): Promise<PortalPrincipal> {
    const match = /(?:^|;\s*)relayqo_portal=([A-Za-z0-9_-]{40,100})(?:;|$)/.exec(String(req.headers.cookie || ''));
    if (!match) throw new PortalError(401, 'LOGIN_REQUIRED');
    const row = await this.store.session(hashToken(match[1]), this.skipsEmail());
    if (!row) throw new PortalError(401, 'SESSION_EXPIRED', 'Your session expired. Please log in again.');
    const { sessionId, csrfToken, ...user } = row;
    const memberships = await this.store.memberships(user.id);
    const selected = String(req.headers['x-account-id'] || memberships[0]?.accountId || '');
    const membership = memberships.find(m => m.accountId === selected);
    if (user.role === 'CLIENT' && !membership) throw new PortalError(403, 'ACCOUNT_ACCESS_DENIED');
    return { user: this.safeUser(user), sessionId, csrf: csrfToken, accountId: membership?.accountId, tenantId: membership?.tenantId };
  }
  checkOrigin(req: Request) {
    const origin = req.headers.origin;
    if (origin && origin !== this.origin) throw new PortalError(403, 'ORIGIN_NOT_ALLOWED');
    if (req.headers['sec-fetch-site'] === 'cross-site') throw new PortalError(403, 'ORIGIN_NOT_ALLOWED');
  }
  checkCsrf(req: Request, principal: PortalPrincipal) {
    this.checkOrigin(req);
    const supplied = String(req.headers['x-csrf-token'] || '');
    const expected = principal.csrf;
    if (Buffer.byteLength(supplied) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) throw new PortalError(403, 'CSRF_FAILED');
  }
  clearCookie(res: Response) { res.clearCookie('relayqo_portal', { path: '/', secure: this.secure, httpOnly: true, sameSite: 'lax' }); }
}
