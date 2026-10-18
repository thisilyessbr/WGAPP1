import { randomUUID } from 'crypto';
import { PortalStore } from './PortalStore';
import { PortalError } from './types';
import { logger } from '../utils/logger';
import type { OutboundSendResult, OutboundTemplateRequest } from '../domain/channel/whatsapp/WhatsAppOutboundAdapter';

export type MetaTemplate = { name: string; language: string; status: string; category: string; components?: Array<{ type: string; text?: string }> };
export type BroadcastChannel = {
  listTemplates(phoneNumberId: string, wabaId: string): Promise<MetaTemplate[]>;
  sendTemplateMessage(params: { phoneNumberId: string; to: string; template: OutboundTemplateRequest }): Promise<OutboundSendResult>;
};
export type BroadcastSegment = { lastActiveDays?: number; leadStatuses?: string[] };

/**
 * Meta's per-message fee for Morocco (+212) since 1 October 2026, in USD.
 * Shown to merchants as an estimate only; override with BROADCAST_PRICE_USD_<CATEGORY>
 * whenever Meta's rate card changes.
 */
const DEFAULT_PRICES: Record<string, number> = { MARKETING: 0.0414, UTILITY: 0.023, AUTHENTICATION: 0.023 };
export const broadcastPrice = (category: string) => {
  const override = Number(process.env[`BROADCAST_PRICE_USD_${category.toUpperCase()}`]);
  return Number.isFinite(override) && override >= 0 && process.env[`BROADCAST_PRICE_USD_${category.toUpperCase()}`] !== undefined
    ? override : DEFAULT_PRICES[category.toUpperCase()] ?? DEFAULT_PRICES.MARKETING;
};
const maxRecipients = () => Math.max(1, Math.min(10000, Number(process.env.BROADCAST_MAX_RECIPIENTS || 1000)));
export const broadcastsNeedApproval = () => process.env.BROADCAST_REQUIRE_APPROVAL !== 'false';

/** Replies that withdraw marketing consent: STOP and its Darija, Arabic and French equivalents. */
const OPT_OUT = /^\s*(?:stop|unsubscribe|desabonner|désabonner|stop pub|arr[eê]t(?:er)?|nlghi|bghit nlghi|ma bghitch|wa9ef|w9ef|وقف|حبس|الغاء|إلغاء|بغيت نلغي|ما بغيتش)\s*[.!]*\s*$/iu;
export const isOptOutMessage = (text: string) => OPT_OUT.test(String(text || '').normalize('NFC'));

/** Moroccan numbers in local form (06/07...) become 2126/2127...; everything else keeps its digits. */
export function normalizeWaId(raw: string): string | null {
  let digits = String(raw || '').replace(/\D/gu, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (/^0[5-7]\d{8}$/u.test(digits)) digits = '212' + digits.slice(1);
  return /^\d{8,15}$/u.test(digits) ? digits : null;
}

const SEGMENT_STATUSES = new Set(['NEW', 'CONTACTED', 'QUALIFIED', 'WON', 'LOST']);
function cleanSegment(input: any): BroadcastSegment {
  const segment: BroadcastSegment = {};
  const days = Number(input?.lastActiveDays);
  if (Number.isInteger(days) && days > 0 && days <= 365) segment.lastActiveDays = days;
  const statuses = Array.isArray(input?.leadStatuses) ? input.leadStatuses.map(String).filter((s: string) => SEGMENT_STATUSES.has(s)) : [];
  if (statuses.length) segment.leadStatuses = [...new Set<string>(statuses)];
  return segment;
}

/**
 * Template broadcasts for official (Meta Cloud) numbers only. Every recipient
 * needs a recorded opt-in; consent is checked again right before each send, and
 * a STOP reply opts the customer out at once. During the pilot an admin approves
 * each broadcast before it starts (BROADCAST_REQUIRE_APPROVAL=false turns that off).
 */
export class PortalBroadcasts {
  private timer?: NodeJS.Timeout;
  private busy = false;
  constructor(private store: PortalStore, private channel?: BroadcastChannel) {}

  async numbers(tenantId: string, accountId: string) {
    return this.store.db.$queryRaw<any[]>`SELECT n."phoneNumberId",n."displayPhoneNumber",n."wabaId" FROM "WhatsAppBusinessNumber" n
      LEFT JOIN "ChannelConnection" cc ON cc.id=n."connectionId"
      WHERE n."tenantId"=${tenantId} AND n."accountId"=${accountId} AND n.transport='META_CLOUD' AND n.enabled=true
        AND n.status='CONNECTED' AND n."wabaId" IS NOT NULL AND (cc.id IS NULL OR (cc.enabled=true AND cc.provider='META_CLOUD'))
      ORDER BY n."createdAt"`;
  }

  async syncTemplates(tenantId: string, accountId: string) {
    if (!this.channel) throw new PortalError(503, 'WHATSAPP_UNAVAILABLE');
    const numbers = await this.numbers(tenantId, accountId);
    if (!numbers.length) throw new PortalError(409, 'OFFICIAL_NUMBER_REQUIRED', 'Broadcasts need a WhatsApp number connected through Meta (not the QR connection).');
    const seen = new Set<string>();
    for (const number of numbers) {
      if (seen.has(number.wabaId)) continue;
      seen.add(number.wabaId);
      let templates: MetaTemplate[];
      try { templates = await this.channel.listTemplates(number.phoneNumberId, number.wabaId); }
      catch (error) { throw new PortalError(502, 'TEMPLATE_SYNC_FAILED', `Meta did not return your templates: ${(error as Error).message}`.slice(0, 300)); }
      for (const t of templates) {
        if (!t?.name || !t?.language) continue;
        const body = String(t.components?.find(c => String(c.type).toUpperCase() === 'BODY')?.text || '').slice(0, 2000);
        const variableCount = new Set(body.match(/\{\{\s*\d+\s*\}\}/gu) || []).size;
        await this.store.db.$executeRaw`INSERT INTO "WhatsAppTemplate"(id,"tenantId","accountId","wabaId",name,language,category,status,body,"variableCount","syncedAt")
          VALUES (${randomUUID()},${tenantId},${accountId},${number.wabaId},${String(t.name).slice(0, 512)},${String(t.language).slice(0, 20)},
            ${String(t.category || 'MARKETING').toUpperCase()},${String(t.status || 'UNKNOWN').toUpperCase()},${body},${variableCount},NOW())
          ON CONFLICT ("accountId","wabaId",name,language) DO UPDATE SET category=EXCLUDED.category,status=EXCLUDED.status,
            body=EXCLUDED.body,"variableCount"=EXCLUDED."variableCount","syncedAt"=NOW()`;
      }
      // A template deleted at Meta is no longer usable here.
      const names = templates.map(t => `${t.name}|${t.language}`);
      await this.store.db.$executeRaw`UPDATE "WhatsAppTemplate" SET status='DELETED',"syncedAt"=NOW()
        WHERE "accountId"=${accountId} AND "wabaId"=${number.wabaId} AND NOT (name || '|' || language = ANY(${names}::text[]))`;
    }
    return this.templates(tenantId, accountId);
  }

  async templates(tenantId: string, accountId: string) {
    return this.store.db.$queryRaw<any[]>`SELECT id,name,language,category,status,body,"variableCount","syncedAt" FROM "WhatsAppTemplate"
      WHERE "tenantId"=${tenantId} AND "accountId"=${accountId} AND status<>'DELETED' ORDER BY status='APPROVED' DESC,name,language`;
  }

  /** Records opt-ins the merchant collected elsewhere (a form, the shop, an order). The merchant must confirm consent. */
  async importConsent(tenantId: string, accountId: string, actorId: string, input: { phones: string[]; evidence: string; confirmed: boolean }) {
    if (input.confirmed !== true) throw new PortalError(400, 'CONSENT_CONFIRMATION_REQUIRED', 'Confirm that every customer on the list agreed to receive your messages.');
    const evidence = String(input.evidence || '').trim();
    if (evidence.length < 5 || evidence.length > 500) throw new PortalError(400, 'CONSENT_EVIDENCE_REQUIRED', 'Say how these customers agreed (for example "ticked the box at checkout").');
    const phones = Array.isArray(input.phones) ? input.phones.slice(0, 5000) : [];
    let added = 0, skippedOptOut = 0;
    const invalid: string[] = [];
    for (const raw of phones) {
      const waId = normalizeWaId(raw);
      if (!waId) { if (invalid.length < 20) invalid.push(String(raw).slice(0, 40)); continue; }
      await this.store.db.$executeRaw`INSERT INTO "Customer"(id,"tenantId","externalId","updatedAt") VALUES (${randomUUID()},${tenantId},${waId},NOW())
        ON CONFLICT ("tenantId","externalId") DO NOTHING`;
      const customer = (await this.store.db.$queryRaw<any[]>`SELECT id FROM "Customer" WHERE "tenantId"=${tenantId} AND "externalId"=${waId}`)[0];
      // A customer who opted out themselves is never re-subscribed by an import.
      const changed = await this.store.db.$executeRaw`INSERT INTO "MarketingConsent"(id,"tenantId","accountId","customerId",status,source,evidence,"recordedById")
        VALUES (${randomUUID()},${tenantId},${accountId},${customer.id},'OPTED_IN','merchant_import',${evidence},${actorId})
        ON CONFLICT ("accountId","customerId") DO UPDATE SET status='OPTED_IN',source='merchant_import',evidence=EXCLUDED.evidence,
          "recordedById"=EXCLUDED."recordedById","updatedAt"=NOW() WHERE "MarketingConsent".status<>'OPTED_OUT'`;
      if (changed) added++; else skippedOptOut++;
    }
    await this.store.audit(actorId, accountId, 'MARKETING_CONSENT_IMPORTED', { added, skippedOptOut, invalid: invalid.length });
    return { added, skippedOptOut, invalid };
  }

  async setConsent(tenantId: string, accountId: string, actorId: string | null, customerId: string, status: 'OPTED_IN' | 'OPTED_OUT', source: string, evidence = '') {
    await this.store.db.$executeRaw`INSERT INTO "MarketingConsent"(id,"tenantId","accountId","customerId",status,source,evidence,"recordedById")
      SELECT ${randomUUID()},${tenantId},${accountId},cu.id,${status},${source},${evidence},${actorId} FROM "Customer" cu WHERE cu.id=${customerId} AND cu."tenantId"=${tenantId}
      ON CONFLICT ("accountId","customerId") DO UPDATE SET status=EXCLUDED.status,source=EXCLUDED.source,evidence=EXCLUDED.evidence,
        "recordedById"=EXCLUDED."recordedById","updatedAt"=NOW()`;
  }

  /** Called for every inbound customer message: a STOP reply opts the customer out of broadcasts. */
  async handleInbound(tenantId: string, accountId: string, waId: string, text: string): Promise<boolean> {
    if (!isOptOutMessage(text)) return false;
    const customer = (await this.store.db.$queryRaw<any[]>`SELECT id FROM "Customer" WHERE "tenantId"=${tenantId} AND "externalId"=${waId}`)[0];
    if (!customer) return false;
    await this.setConsent(tenantId, accountId, null, customer.id, 'OPTED_OUT', 'customer_keyword', String(text).trim().slice(0, 100));
    await this.store.db.$executeRaw`UPDATE "BroadcastRecipient" r SET status='SKIPPED',error='Customer opted out',"updatedAt"=NOW()
      FROM "Broadcast" b WHERE b.id=r."broadcastId" AND b."accountId"=${accountId} AND r."customerId"=${customer.id} AND r.status='PENDING'`;
    return true;
  }

  async consentSummary(tenantId: string, accountId: string) {
    return (await this.store.db.$queryRaw<any[]>`SELECT COUNT(*) FILTER (WHERE status='OPTED_IN')::int AS "optedIn",
      COUNT(*) FILTER (WHERE status='OPTED_OUT')::int AS "optedOut"
      FROM "MarketingConsent" WHERE "tenantId"=${tenantId} AND "accountId"=${accountId}`)[0];
  }

  private async audience(tenantId: string, accountId: string, segment: BroadcastSegment, limit: number) {
    const days = segment.lastActiveDays ?? null, statuses = segment.leadStatuses?.length ? segment.leadStatuses : null;
    return this.store.db.$queryRaw<any[]>`SELECT cu.id AS "customerId",cu."externalId" AS "waId" FROM "MarketingConsent" mc
      JOIN "Customer" cu ON cu.id=mc."customerId" AND cu."tenantId"=mc."tenantId"
      WHERE mc."tenantId"=${tenantId} AND mc."accountId"=${accountId} AND mc.status='OPTED_IN'
        AND cu."externalId" ~ '^[0-9]{8,15}$'
        AND (${days}::int IS NULL OR EXISTS (SELECT 1 FROM "Conversation" c WHERE c."customerId"=cu.id AND c."tenantId"=cu."tenantId"
          AND c."accountId"=${accountId} AND c."updatedAt">=NOW()-(${days}::int * INTERVAL '1 day')))
        AND (${statuses}::text[] IS NULL OR EXISTS (SELECT 1 FROM "Lead" l WHERE l."customerId"=cu.id AND l."tenantId"=cu."tenantId"
          AND l."accountId"=${accountId} AND l.status = ANY(${statuses}::text[])))
      ORDER BY mc."updatedAt" LIMIT ${limit}`;
  }

  private async approvedTemplate(tenantId: string, accountId: string, templateId: string) {
    const template = (await this.store.db.$queryRaw<any[]>`SELECT * FROM "WhatsAppTemplate" WHERE id=${templateId} AND "tenantId"=${tenantId} AND "accountId"=${accountId}`)[0];
    if (!template) throw new PortalError(404, 'TEMPLATE_NOT_FOUND');
    if (template.status !== 'APPROVED') throw new PortalError(409, 'TEMPLATE_NOT_APPROVED', 'Meta has not approved this template yet.');
    return template;
  }

  /** Recipient count and Meta's fee before anything is sent. */
  async estimate(tenantId: string, accountId: string, input: { templateId: string; segment?: any }) {
    const template = await this.approvedTemplate(tenantId, accountId, input.templateId);
    const segment = cleanSegment(input.segment);
    const cap = maxRecipients();
    const recipients = (await this.audience(tenantId, accountId, segment, cap + 1)).length;
    const unit = broadcastPrice(template.category);
    return { recipients: Math.min(recipients, cap), capped: recipients > cap, maxRecipients: cap, category: template.category,
      unitPriceUsd: unit, estimatedCostUsd: Number((Math.min(recipients, cap) * unit).toFixed(4)), segment };
  }

  async create(tenantId: string, accountId: string, actorId: string, input: { templateId: string; phoneNumberId: string; variables?: unknown[]; segment?: any }) {
    const template = await this.approvedTemplate(tenantId, accountId, input.templateId);
    const number = (await this.numbers(tenantId, accountId)).find(n => n.phoneNumberId === input.phoneNumberId && n.wabaId === template.wabaId);
    if (!number) throw new PortalError(400, 'OFFICIAL_NUMBER_REQUIRED', 'Choose the Meta-connected number that owns this template.');
    const variables = (Array.isArray(input.variables) ? input.variables : []).map(v => String(v ?? '').trim().slice(0, 200));
    if (variables.length !== Number(template.variableCount) || variables.some(v => !v)) {
      throw new PortalError(400, 'TEMPLATE_VARIABLES_REQUIRED', `Fill in all ${template.variableCount} template value(s).`);
    }
    const estimate = await this.estimate(tenantId, accountId, input);
    if (!estimate.recipients) throw new PortalError(409, 'NO_RECIPIENTS', 'No opted-in customers match this audience.');
    const recipients = await this.audience(tenantId, accountId, estimate.segment, estimate.maxRecipients);
    const id = randomUUID(), status = broadcastsNeedApproval() ? 'PENDING_APPROVAL' : 'SENDING';
    await this.store.transaction(async tx => {
      await tx.db.$executeRaw`INSERT INTO "Broadcast"(id,"tenantId","accountId","phoneNumberId","templateId",variables,segment,status,"recipientCount","estimatedCostUsd","createdById","startedAt")
        VALUES (${id},${tenantId},${accountId},${number.phoneNumberId},${template.id},${JSON.stringify(variables)}::jsonb,${JSON.stringify(estimate.segment)}::jsonb,
          ${status},${recipients.length},${estimate.estimatedCostUsd},${actorId},${status === 'SENDING' ? new Date() : null})`;
      for (const r of recipients) {
        await tx.db.$executeRaw`INSERT INTO "BroadcastRecipient"(id,"broadcastId","customerId","waId") VALUES (${randomUUID()},${id},${r.customerId},${r.waId}) ON CONFLICT DO NOTHING`;
      }
      await tx.audit(actorId, accountId, 'BROADCAST_CREATED', { broadcastId: id, recipients: recipients.length, status });
    });
    return this.get(tenantId, accountId, id);
  }

  async cancel(tenantId: string, accountId: string, actorId: string, id: string) {
    const changed = await this.store.db.$executeRaw`UPDATE "Broadcast" SET status='CANCELLED',"updatedAt"=NOW(),"completedAt"=NOW()
      WHERE id=${id} AND "tenantId"=${tenantId} AND "accountId"=${accountId} AND status IN ('PENDING_APPROVAL','SENDING')`;
    if (!changed) throw new PortalError(409, 'BROADCAST_NOT_CANCELLABLE');
    await this.store.db.$executeRaw`UPDATE "BroadcastRecipient" SET status='SKIPPED',error='Broadcast cancelled',"updatedAt"=NOW() WHERE "broadcastId"=${id} AND status='PENDING'`;
    await this.store.audit(actorId, accountId, 'BROADCAST_CANCELLED', { broadcastId: id });
  }

  async get(tenantId: string, accountId: string, id: string) {
    const row = (await this.list(tenantId, accountId, id))[0];
    if (!row) throw new PortalError(404, 'BROADCAST_NOT_FOUND');
    return row;
  }

  async list(tenantId: string | null, accountId: string | null, id: string | null = null, status: string | null = null) {
    return this.store.db.$queryRaw<any[]>`SELECT b.id,b."accountId",a.name AS "accountName",b."phoneNumberId",b.status,b.variables,b.segment,b."recipientCount",
        b."estimatedCostUsd",b."reviewNote",b."createdAt",b."startedAt",b."completedAt",t.name AS "templateName",t.language,t.category,t.body,
        COUNT(r.id) FILTER (WHERE r.status='SENT')::int AS sent,COUNT(r.id) FILTER (WHERE r.status='FAILED')::int AS failed,
        COUNT(r.id) FILTER (WHERE r.status='SKIPPED')::int AS skipped,COUNT(r.id) FILTER (WHERE r.status='PENDING')::int AS pending
      FROM "Broadcast" b JOIN "WhatsAppTemplate" t ON t.id=b."templateId" JOIN "Account" a ON a.id=b."accountId"
      LEFT JOIN "BroadcastRecipient" r ON r."broadcastId"=b.id
      WHERE (${tenantId}::text IS NULL OR b."tenantId"=${tenantId}) AND (${accountId}::text IS NULL OR b."accountId"=${accountId})
        AND (${id}::text IS NULL OR b.id=${id}) AND (${status}::text IS NULL OR b.status=${status})
      GROUP BY b.id,a.name,t.name,t.language,t.category,t.body ORDER BY b."createdAt" DESC LIMIT 100`;
  }

  /** Admin decision during the pilot. */
  async review(actorId: string, id: string, approve: boolean, note: string) {
    const changed = await this.store.db.$executeRaw`UPDATE "Broadcast" SET status=${approve ? 'SENDING' : 'REJECTED'},"reviewedById"=${actorId},
      "reviewNote"=${String(note || '').slice(0, 500)},"startedAt"=${approve ? new Date() : null},"completedAt"=${approve ? null : new Date()},"updatedAt"=NOW()
      WHERE id=${id} AND status='PENDING_APPROVAL'`;
    if (!changed) throw new PortalError(409, 'BROADCAST_NOT_PENDING');
    const row = (await this.store.db.$queryRaw<any[]>`SELECT "accountId" FROM "Broadcast" WHERE id=${id}`)[0];
    if (!approve) await this.store.db.$executeRaw`UPDATE "BroadcastRecipient" SET status='SKIPPED',error='Broadcast rejected',"updatedAt"=NOW() WHERE "broadcastId"=${id} AND status='PENDING'`;
    await this.store.audit(actorId, row.accountId, approve ? 'BROADCAST_APPROVED' : 'BROADCAST_REJECTED', { broadcastId: id });
  }

  start(intervalMs = 5000) {
    if (this.timer || !this.channel) return;
    const run = () => void this.tick().catch(error => logger.error('Broadcast sender failed', error));
    this.timer = setInterval(run, intervalMs);
    this.timer.unref();
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = undefined; }

  /** Sends up to `batch` messages; WhatsApp's per-number throughput is far above this pace. */
  async tick(batch = 20) {
    if (this.busy || !this.channel) return 0;
    this.busy = true;
    let processed = 0;
    try {
      await this.store.db.$executeRaw`UPDATE "BroadcastRecipient" SET status='PENDING',"leaseUntil"=NULL WHERE status='SENDING' AND "leaseUntil"<NOW()`;
      for (let i = 0; i < batch; i++) {
        const job = await this.store.transaction(async tx => {
          const rows = await tx.db.$queryRaw<any[]>`SELECT r.id,r."customerId",r."waId",r.attempts,b.id AS "broadcastId",b."tenantId",b."accountId",b."phoneNumberId",
              b.variables,t.name,t.language,t.category,t.status AS "templateStatus"
            FROM "BroadcastRecipient" r JOIN "Broadcast" b ON b.id=r."broadcastId" JOIN "WhatsAppTemplate" t ON t.id=b."templateId"
            WHERE r.status='PENDING' AND b.status='SENDING' AND (r."leaseUntil" IS NULL OR r."leaseUntil"<=NOW())
            ORDER BY b."startedAt",r.id FOR UPDATE OF r SKIP LOCKED LIMIT 1`;
          if (rows[0]) await tx.db.$executeRaw`UPDATE "BroadcastRecipient" SET status='SENDING',"leaseUntil"=NOW()+INTERVAL '2 minutes',attempts=attempts+1,"updatedAt"=NOW() WHERE id=${rows[0].id}`;
          return rows[0];
        });
        if (!job) break;
        processed++;
        const consent = (await this.store.db.$queryRaw<any[]>`SELECT status FROM "MarketingConsent" WHERE "accountId"=${job.accountId} AND "customerId"=${job.customerId}`)[0];
        const finish = (status: string, error: string | null, messageId: string | null = null) => this.store.db.$executeRaw`UPDATE "BroadcastRecipient"
          SET status=${status},error=${error},"messageId"=${messageId},"leaseUntil"=NULL,"updatedAt"=NOW() WHERE id=${job.id}`;
        if (consent?.status !== 'OPTED_IN') { await finish('SKIPPED', 'No current opt-in'); continue; }
        if (job.templateStatus !== 'APPROVED') { await finish('FAILED', 'Template is no longer approved'); continue; }
        const variables: string[] = Array.isArray(job.variables) ? job.variables : [];
        const result = await this.channel.sendTemplateMessage({ phoneNumberId: job.phoneNumberId, to: job.waId, template: {
          name: job.name, languageCode: job.language, category: job.category,
          components: variables.length ? [{ type: 'body', parameters: variables.map(text => ({ type: 'text' as const, text })) }] : []
        } }).catch(error => ({ success: false, error: String(error?.message || error), isRetryable: true }) as OutboundSendResult);
        if (result.success) await finish('SENT', null, result.providerMessageId || null);
        else if (result.isRetryable && job.attempts + 1 < 3) {
          await this.store.db.$executeRaw`UPDATE "BroadcastRecipient" SET status='PENDING',error=${String(result.error || '').slice(0, 300)},
            "leaseUntil"=NOW()+(${Math.max(60, Number(result.retryAfterSeconds || 0))} * INTERVAL '1 second'),"updatedAt"=NOW() WHERE id=${job.id}`;
        } else await finish('FAILED', String(result.error || 'Send failed').slice(0, 300));
      }
      await this.store.db.$executeRaw`UPDATE "Broadcast" b SET status='COMPLETED',"completedAt"=NOW(),"updatedAt"=NOW()
        WHERE b.status='SENDING' AND NOT EXISTS (SELECT 1 FROM "BroadcastRecipient" r WHERE r."broadcastId"=b.id AND r.status IN ('PENDING','SENDING'))`;
    } finally { this.busy = false; }
    return processed;
  }
}
