import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { SecretBox } from '../../../core/security/SecretBox';
import { ConversationEngine } from '../../conversation/ConversationEngine';
import { instagramEntitled } from './InstagramEntitlement';

type Identity = { userId: string; accountId: string; tenantId: string; issuedAt: number; nonce: string };
type Token = { access_token: string; expires_in?: number; user_id?: string };
type Connection = { tenantId: string; accountId: string; instagramUserId: string; encryptedToken: string; tokenExpiresAt: Date; enabled: boolean; status: string };

export const instagramCustomerId = (igUserId: string, senderId: string) => `instagram:${igUserId}:${senderId}`;
export const instagramMessageId = (igUserId: string, mid: string) => `instagram:${igUserId}:${mid}`;

export function verifyInstagramSignature(rawBody: Buffer, signature: unknown, appSecret: string): boolean {
  if (!Buffer.isBuffer(rawBody) || typeof signature !== 'string' || !/^sha256=[a-f0-9]{64}$/i.test(signature) || !appSecret) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  return timingSafeEqual(expected, Buffer.from(signature.slice(7), 'hex'));
}

export function extractInstagramTextEvents(payload: any): Array<{ igUserId: string; senderId: string; mid: string; text: string }> {
  if (payload?.object !== 'instagram' || !Array.isArray(payload.entry)) return [];
  const result: Array<{ igUserId: string; senderId: string; mid: string; text: string }> = [];
  for (const entry of payload.entry) {
    const igUserId = String(entry?.id || '');
    if (!/^\d{5,30}$/.test(igUserId)) continue;
    for (const event of Array.isArray(entry.messaging) ? entry.messaging : []) {
      const senderId = String(event?.sender?.id || '');
      const mid = String(event?.message?.mid || '');
      const message = event?.message;
      if (!/^\d{5,30}$/.test(senderId) || senderId === igUserId || !mid || mid.length > 250 || message?.is_echo || typeof message?.text !== 'string') continue;
      const text = message.text.trim();
      if (text && text.length <= 4096) result.push({ igUserId, senderId, mid, text });
    }
  }
  return result;
}

export class InstagramService {
  private readonly box: SecretBox;
  private readonly fetchFn: typeof fetch;
  private timer?: ReturnType<typeof setInterval>;
  private busy = false;
  constructor(private readonly db: PrismaClient, private readonly engine?: ConversationEngine, options: { fetchFn?: typeof fetch; box?: SecretBox } = {}) {
    this.box = options.box || new SecretBox();
    this.fetchFn = options.fetchFn || fetch;
  }

  configured() { return Boolean(process.env.INSTAGRAM_APP_ID && process.env.INSTAGRAM_APP_SECRET && process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN && process.env.PORTAL_PUBLIC_URL); }
  private appId() { if (!this.configured()) throw new Error('INSTAGRAM_NOT_CONFIGURED'); return process.env.INSTAGRAM_APP_ID!; }
  private appSecret() { if (!this.configured()) throw new Error('INSTAGRAM_NOT_CONFIGURED'); return process.env.INSTAGRAM_APP_SECRET!; }
  private callbackUrl() { return new URL('/api/instagram/connect/callback', process.env.PORTAL_PUBLIC_URL).toString(); }
  private graphVersion() { return process.env.INSTAGRAM_GRAPH_API_VERSION || 'v26.0'; }

  authorizationUrl(identity: Omit<Identity, 'issuedAt' | 'nonce'>): string {
    const state = this.signState({ ...identity, issuedAt: Date.now(), nonce: randomBytes(16).toString('hex') });
    const url = new URL('https://www.instagram.com/oauth/authorize');
    url.searchParams.set('client_id', this.appId());
    url.searchParams.set('redirect_uri', this.callbackUrl());
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'instagram_business_basic,instagram_business_manage_messages');
    url.searchParams.set('state', state);
    return url.toString();
  }

  private signState(identity: Identity): string {
    const payload = Buffer.from(JSON.stringify(identity)).toString('base64url');
    const signature = createHmac('sha256', this.appSecret()).update(payload).digest('base64url');
    return `${payload}.${signature}`;
  }

  verifyState(state: string): Identity {
    const [payload, signature, extra] = state.split('.');
    if (!payload || !signature || extra || payload.length > 1000) throw new Error('INVALID_INSTAGRAM_STATE');
    const expected = createHmac('sha256', this.appSecret()).update(payload).digest();
    let actual: Buffer;
    try { actual = Buffer.from(signature, 'base64url'); } catch { throw new Error('INVALID_INSTAGRAM_STATE'); }
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error('INVALID_INSTAGRAM_STATE');
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Identity;
    if (!parsed.userId || !parsed.accountId || !parsed.tenantId || !parsed.nonce || !Number.isFinite(parsed.issuedAt)
      || parsed.issuedAt > Date.now() + 30000 || Date.now() - parsed.issuedAt > 600000) throw new Error('EXPIRED_INSTAGRAM_STATE');
    return parsed;
  }

  private async json(url: string, init: RequestInit): Promise<any> {
    const response = await this.fetchFn(url, { ...init, signal: AbortSignal.timeout(12000) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.error) throw new Error('INSTAGRAM_META_REQUEST_FAILED');
    return body;
  }

  async complete(code: string, accountId: string, tenantId: string): Promise<{ username: string | null; instagramUserId: string }> {
    if (!code || code.length > 1500) throw new Error('INVALID_INSTAGRAM_CODE');
    const form = new URLSearchParams({ client_id: this.appId(), client_secret: this.appSecret(), grant_type: 'authorization_code', redirect_uri: this.callbackUrl(), code });
    const short = await this.json('https://api.instagram.com/oauth/access_token', { method: 'POST', body: form });
    if (!short.access_token) throw new Error('INSTAGRAM_TOKEN_MISSING');
    const exchange = new URL('https://graph.instagram.com/access_token');
    exchange.searchParams.set('grant_type', 'ig_exchange_token');
    exchange.searchParams.set('client_secret', this.appSecret());
    exchange.searchParams.set('access_token', short.access_token);
    const long = await this.json(exchange.toString(), { method: 'GET' }) as Token;
    if (!long.access_token) throw new Error('INSTAGRAM_TOKEN_MISSING');
    const profile = await this.json(`https://graph.instagram.com/${this.graphVersion()}/me?fields=id,username`, { headers: { Authorization: `Bearer ${long.access_token}` } });
    const igUserId = String(profile.id || '');
    if (!/^\d{5,30}$/.test(igUserId)) throw new Error('INSTAGRAM_ACCOUNT_INVALID');
    const owner = await this.db.instagramConnection.findUnique({ where: { instagramUserId: igUserId } });
    if (owner && owner.accountId !== accountId) throw new Error('INSTAGRAM_ACCOUNT_ALREADY_CONNECTED');
    const expiresAt = new Date(Date.now() + Math.max(3600, Number(long.expires_in) || 3600) * 1000);
    // Subscribe before saving; a connection that cannot receive DMs must not appear healthy.
    const fields = new URLSearchParams({ subscribed_fields: 'messages' });
    const subscription = await this.json(`https://graph.instagram.com/${this.graphVersion()}/${igUserId}/subscribed_apps`, {
      method: 'POST', headers: { Authorization: `Bearer ${long.access_token}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: fields
    });
    if (subscription.success !== true) throw new Error('INSTAGRAM_WEBHOOK_SUBSCRIPTION_FAILED');
    const data = { tenantId, instagramUserId: igUserId, username: typeof profile.username === 'string' ? profile.username : null,
      encryptedToken: this.box.encrypt(long.access_token), tokenExpiresAt: expiresAt, enabled: owner?.enabled ?? false, status: 'CONNECTED', lastError: null };
    await this.db.instagramConnection.upsert({ where: { accountId }, create: { ...data, accountId }, update: data });
    return { username: data.username, instagramUserId: igUserId };
  }

  async list(accountId: string, tenantId: string) {
    const connection = await this.db.instagramConnection.findFirst({ where: { accountId, tenantId } });
    return connection ? { username: connection.username, instagramUserId: connection.instagramUserId, enabled: connection.enabled,
      status: connection.status, tokenExpiresAt: connection.tokenExpiresAt, lastError: connection.lastError } : null;
  }

  async disconnect(accountId: string, tenantId: string) {
    await this.db.instagramConnection.deleteMany({ where: { accountId, tenantId } });
  }

  async ingest(payload: any): Promise<number> {
    const events = extractInstagramTextEvents(payload);
    let accepted = 0;
    for (const event of events) {
      const connection = await this.db.instagramConnection.findUnique({ where: { instagramUserId: event.igUserId } });
      if (!connection?.enabled || connection.status !== 'CONNECTED') continue;
      const profile = await this.db.portalProfile.findUnique({ where: { accountId: connection.accountId } });
      if (!profile || profile.status !== 'ACTIVE' || profile.tenantId !== connection.tenantId || !instagramEntitled(profile)) continue;
      const created = await this.db.instagramInboundJob.createMany({ data: [{ tenantId: connection.tenantId, accountId: connection.accountId,
        instagramUserId: event.igUserId, senderId: event.senderId, messageId: event.mid, text: event.text }], skipDuplicates: true });
      accepted += created.count;
    }
    return accepted;
  }

  private async token(connection: Connection): Promise<string> {
    const current = this.box.decrypt(connection.encryptedToken);
    if (connection.tokenExpiresAt.getTime() - Date.now() > 7 * 86400000) return current;
    const url = new URL('https://graph.instagram.com/refresh_access_token');
    url.searchParams.set('grant_type', 'ig_refresh_token');
    url.searchParams.set('access_token', current);
    const refreshed = await this.json(url.toString(), { method: 'GET' }) as Token;
    if (!refreshed.access_token) throw new Error('INSTAGRAM_TOKEN_REFRESH_FAILED');
    const saved = await this.db.instagramConnection.updateMany({ where: { instagramUserId: connection.instagramUserId,
      tenantId: connection.tenantId, accountId: connection.accountId, enabled: true, status: 'CONNECTED', encryptedToken: connection.encryptedToken }, data: {
      encryptedToken: this.box.encrypt(refreshed.access_token), tokenExpiresAt: new Date(Date.now() + (Number(refreshed.expires_in) || 3600) * 1000)
    } });
    if (saved.count !== 1) throw new Error('INSTAGRAM_CONNECTION_CHANGED');
    return refreshed.access_token;
  }

  async sendText(connection: Connection, recipientId: string, text: string, automated = false): Promise<string> {
    if (!connection.enabled || connection.status !== 'CONNECTED' || !/^\d{5,30}$/.test(recipientId)) throw new Error('INSTAGRAM_CONNECTION_UNAVAILABLE');
    const token = await this.token(connection);
    const [current, profile] = await Promise.all([
      this.db.instagramConnection.findUnique({ where: { instagramUserId: connection.instagramUserId } }),
      this.db.portalProfile.findUnique({ where: { accountId: connection.accountId } })
    ]);
    if (!current?.enabled || current.status !== 'CONNECTED' || current.accountId !== connection.accountId || current.tenantId !== connection.tenantId
      || profile?.accountId !== connection.accountId || profile.tenantId !== connection.tenantId || profile.status !== 'ACTIVE' || !instagramEntitled(profile)) {
      throw new Error('INSTAGRAM_CONNECTION_UNAVAILABLE');
    }
    if (automated) {
      if (!this.engine) throw new Error('INSTAGRAM_AUTOMATION_UNAVAILABLE');
      const conversation = await this.engine.getConversationService().getLatestConversation(connection.tenantId,
        instagramCustomerId(connection.instagramUserId, recipientId), connection.accountId);
      if (conversation?.status === 'HUMAN_ACTIVE') throw new Error('INSTAGRAM_HUMAN_TAKEOVER');
    }
    const response = await this.json(`https://graph.instagram.com/${this.graphVersion()}/${connection.instagramUserId}/messages`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient: { id: recipientId }, message: { text } })
    });
    if (!response.message_id) throw new Error('INSTAGRAM_SEND_UNCONFIRMED');
    return String(response.message_id);
  }

  async sendManual(accountId: string, tenantId: string, externalId: string, text: string): Promise<string> {
    const profile = await this.db.portalProfile.findUnique({ where: { accountId } });
    if (!profile || profile.status !== 'ACTIVE' || profile.tenantId !== tenantId || !instagramEntitled(profile)) throw new Error('INSTAGRAM_CONNECTION_UNAVAILABLE');
    const connection = await this.db.instagramConnection.findFirst({ where: { accountId, tenantId, enabled: true, status: 'CONNECTED' } });
    if (!connection || !externalId.startsWith(`instagram:${connection.instagramUserId}:`)) throw new Error('INSTAGRAM_CONNECTION_UNAVAILABLE');
    return this.sendText(connection, externalId.slice(`instagram:${connection.instagramUserId}:`.length), text);
  }

  start() {
    if (!this.engine || this.timer) return;
    this.timer = setInterval(() => { void this.tick(); }, 3000);
    this.timer.unref?.();
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = undefined; }

  async tick() {
    if (!this.engine || this.busy) return;
    this.busy = true;
    try {
      // A send interrupted after reaching Meta has an unknown outcome. Never
      // replay it automatically, which could deliver the same answer twice.
      await this.db.instagramInboundJob.updateMany({ where: { status: 'SENDING', leaseUntil: { lt: new Date() } },
        data: { status: 'FAILED', lastError: 'INSTAGRAM_SEND_OUTCOME_UNKNOWN', leaseUntil: null } });
      const jobs = await this.db.$queryRaw<any[]>`
        UPDATE "InstagramInboundJob" SET status='PROCESSING', attempts=attempts+1,
          "leaseUntil"=NOW()+INTERVAL '90 seconds', "updatedAt"=NOW()
        WHERE id=(SELECT candidate.id FROM "InstagramInboundJob" candidate
          WHERE ((candidate.status='PENDING' AND candidate."nextAttemptAt"<=NOW()) OR (candidate.status='PROCESSING' AND candidate."leaseUntil"<NOW()))
            AND candidate.attempts<8
            AND NOT EXISTS (SELECT 1 FROM "InstagramInboundJob" running
              WHERE running.id<>candidate.id AND running."tenantId"=candidate."tenantId" AND running."accountId"=candidate."accountId"
              AND running."instagramUserId"=candidate."instagramUserId" AND running."senderId"=candidate."senderId"
              AND running.status IN ('PROCESSING','SENDING') AND running."leaseUntil">NOW())
            AND NOT EXISTS (SELECT 1 FROM "InstagramInboundJob" earlier
              WHERE earlier."tenantId"=candidate."tenantId" AND earlier."accountId"=candidate."accountId"
              AND earlier."instagramUserId"=candidate."instagramUserId" AND earlier."senderId"=candidate."senderId"
              AND earlier.status IN ('PENDING','PROCESSING','SENDING')
              AND (earlier."createdAt",earlier.id)<(candidate."createdAt",candidate.id))
            ORDER BY candidate."createdAt" LIMIT 1 FOR UPDATE SKIP LOCKED)
        RETURNING *`;
      const job = jobs[0];
      if (!job) return;
      let sendStarted = false;
      let leaseLost = false, renewing = false;
      // attempts is a fencing token: an expired worker cannot update or send a
      // job after a replacement worker has claimed it, even if generation resumes.
      const updateOwned = async (data: any, status: string | string[] = 'PROCESSING') => {
        if (leaseLost) return false;
        const result = await this.db.instagramInboundJob.updateMany({
          where: { id: job.id, attempts: Number(job.attempts), status: Array.isArray(status) ? { in: status } : status, leaseUntil: { gt: new Date() } }, data
        });
        if (result.count !== 1) leaseLost = true;
        return !leaseLost;
      };
      const heartbeat = setInterval(() => {
        if (renewing || leaseLost) return;
        renewing = true;
        void updateOwned({ leaseUntil: new Date(Date.now() + 90000) }, ['PROCESSING','SENDING'])
          .catch(() => { leaseLost = true; }).finally(() => { renewing = false; });
      }, 20000);
      heartbeat.unref?.();
      const scoped = (connection: Connection | null, profile: any) => connection?.enabled && connection.status === 'CONNECTED'
        && connection.instagramUserId === job.instagramUserId && connection.accountId === job.accountId && connection.tenantId === job.tenantId
        && profile?.accountId === job.accountId && profile.tenantId === job.tenantId && profile.status === 'ACTIVE' && instagramEntitled(profile);
      try {
        const connection = await this.db.instagramConnection.findFirst({ where: { instagramUserId: job.instagramUserId,
          accountId: job.accountId, tenantId: job.tenantId, enabled: true, status: 'CONNECTED' } });
        const profile = await this.db.portalProfile.findUnique({ where: { accountId: job.accountId } });
        if (!scoped(connection, profile)) {
          await updateOwned({ status: 'SKIPPED', leaseUntil: null });
          return;
        }
        const customer = instagramCustomerId(job.instagramUserId, job.senderId);
        const external = instagramMessageId(job.instagramUserId, job.messageId);
        let responseText = job.responseText as string | null;
        if (responseText === null) {
          const conversation = await this.engine.getConversationService().getLatestConversation(job.tenantId, customer, job.accountId);
          if (conversation?.status === 'HUMAN_ACTIVE') {
            await this.engine.recordInboundMessage(job.tenantId, customer, job.text, job.accountId, external);
            responseText = '';
          } else {
            responseText = await this.engine.handleMessage(job.tenantId, customer, job.text, job.accountId, { externalMessageId: external });
          }
          if (!await updateOwned({ responseText })) return;
        }
        if (responseText) {
          const [currentConnection, currentProfile, currentConversation] = await Promise.all([
            this.db.instagramConnection.findUnique({ where: { instagramUserId: job.instagramUserId } }),
            this.db.portalProfile.findUnique({ where: { accountId: job.accountId } }),
            this.engine.getConversationService().getLatestConversation(job.tenantId, customer, job.accountId)
          ]);
          if (!scoped(currentConnection, currentProfile) || currentConversation?.status === 'HUMAN_ACTIVE') {
            await updateOwned({ status: 'SKIPPED', leaseUntil: null });
            return;
          }
          if (!await updateOwned({ status: 'SENDING', leaseUntil: new Date(Date.now() + 90000) })) return;
          sendStarted = true;
          const providerId = await this.sendText(currentConnection!, job.senderId, responseText, true);
          await this.engine.recordOutboundAssistantMessage(job.tenantId, external, providerId);
        }
        await updateOwned({ status: 'COMPLETED', leaseUntil: null, lastError: null }, sendStarted ? 'SENDING' : 'PROCESSING');
      } catch (error) {
        const attempts = Number(job.attempts);
        await updateOwned({
          status: sendStarted || attempts >= 8 ? 'FAILED' : 'PENDING', leaseUntil: null,
          nextAttemptAt: new Date(Date.now() + Math.min(300000, 3000 * 2 ** attempts)),
          lastError: sendStarted ? 'INSTAGRAM_SEND_OUTCOME_UNKNOWN' : error instanceof Error ? error.message.slice(0, 200) : 'INSTAGRAM_PROCESSING_FAILED'
        }, sendStarted ? 'SENDING' : 'PROCESSING');
      } finally { clearInterval(heartbeat); }
    } finally { this.busy = false; }
  }
}
