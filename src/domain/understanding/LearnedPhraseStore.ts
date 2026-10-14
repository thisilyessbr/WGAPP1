import { PrismaClient } from '@prisma/client';
import { phraseKey } from './MessageUnderstanding';
import { logger } from '../../utils/logger';

/**
 * Customer wording the bot learned for one business ("l7lawa dyal rjlin" means
 * the "Épilation jambes complètes" service). A phrase is used on the fast path
 * once the owner approves it, or automatically after the model resolved it to
 * the same item twice. Rejected phrases are never used or re-learned.
 */
export type PhraseKind = 'product' | 'service';
export type PhraseStatus = 'AUTO' | 'APPROVED' | 'REJECTED';

export interface LearnedPhrase {
  id?: string;
  kind: PhraseKind;
  phrase: string;
  example: string;
  itemKey: string;
  itemLabel: string;
  status: PhraseStatus;
  hits: number;
  updatedAt?: Date;
}

export const AUTO_PROMOTION_HITS = 2;

/** Wording customers used that nothing matched yet has an empty itemKey; it waits for the owner. */
export const isActivePhrase = (p: LearnedPhrase) => Boolean(p.itemKey) && (p.status === 'APPROVED' || (p.status === 'AUTO' && p.hits >= AUTO_PROMOTION_HITS));

export interface LearnedPhraseStore {
  list(tenantId: string, accountId: string, kind?: PhraseKind): Promise<LearnedPhrase[]>;
  record(tenantId: string, accountId: string, entry: { kind: PhraseKind; mention: string; itemKey: string; itemLabel: string }): Promise<void>;
  setStatus(tenantId: string, accountId: string, id: string, status: PhraseStatus, itemKey?: string, itemLabel?: string): Promise<boolean>;
}

/** Longest active learned phrase contained in the message, as whole tokens. */
export function matchLearnedPhrase(message: string, phrases: LearnedPhrase[], kind: PhraseKind): LearnedPhrase | null {
  const text = ` ${phraseKey(message)} `;
  let best: LearnedPhrase | null = null;
  for (const p of phrases) {
    if (p.kind !== kind || !isActivePhrase(p) || !p.phrase) continue;
    if (text.includes(` ${p.phrase} `) && (!best || p.phrase.length > best.phrase.length)) best = p;
  }
  return best;
}

export class MemoryLearnedPhraseStore implements LearnedPhraseStore {
  private rows = new Map<string, LearnedPhrase & { tenantId: string; accountId: string }>();
  private seq = 0;

  async list(tenantId: string, accountId: string, kind?: PhraseKind) {
    return [...this.rows.values()].filter(r => r.tenantId === tenantId && r.accountId === accountId && (!kind || r.kind === kind));
  }

  async record(tenantId: string, accountId: string, entry: { kind: PhraseKind; mention: string; itemKey: string; itemLabel: string }) {
    const phrase = phraseKey(entry.mention);
    if (!phrase) return;
    const key = `${tenantId}|${accountId}|${entry.kind}|${phrase}`;
    const row = this.rows.get(key);
    if (!row) {
      this.rows.set(key, { id: String(++this.seq), tenantId, accountId, kind: entry.kind, phrase, example: entry.mention, itemKey: entry.itemKey, itemLabel: entry.itemLabel, status: 'AUTO', hits: 1, updatedAt: new Date() });
      return;
    }
    if (row.status !== 'AUTO') return;
    if (row.itemKey === entry.itemKey) row.hits++;
    else if (!entry.itemKey) return; // an unmatched sighting never overrides a match
    else Object.assign(row, { itemKey: entry.itemKey, itemLabel: entry.itemLabel, hits: 1 });
    row.updatedAt = new Date();
  }

  async setStatus(tenantId: string, accountId: string, id: string, status: PhraseStatus, itemKey?: string, itemLabel?: string) {
    const row = [...this.rows.values()].find(r => r.id === id && r.tenantId === tenantId && r.accountId === accountId);
    if (!row) return false;
    Object.assign(row, { status, ...(itemKey ? { itemKey, itemLabel: itemLabel || row.itemLabel } : {}), updatedAt: new Date() });
    return true;
  }
}

export class PrismaLearnedPhraseStore implements LearnedPhraseStore {
  private cache = new Map<string, { at: number; rows: LearnedPhrase[] }>();
  private static readonly TTL_MS = 60_000;

  constructor(private prisma: PrismaClient) {}

  async list(tenantId: string, accountId: string, kind?: PhraseKind) {
    const key = `${tenantId}|${accountId}`;
    const hit = this.cache.get(key);
    let rows = hit && Date.now() - hit.at < PrismaLearnedPhraseStore.TTL_MS ? hit.rows : null;
    if (!rows) {
      try {
        rows = (await (this.prisma as any).learnedPhrase.findMany({ where: { tenantId, accountId }, orderBy: { updatedAt: 'desc' }, take: 2000 })) as LearnedPhrase[];
      } catch (error: any) {
        logger.warn(`LearnedPhraseStore: unavailable: ${error?.message || error}`);
        rows = [];
      }
      this.cache.set(key, { at: Date.now(), rows });
    }
    return kind ? rows.filter(r => r.kind === kind) : rows;
  }

  async record(tenantId: string, accountId: string, entry: { kind: PhraseKind; mention: string; itemKey: string; itemLabel: string }) {
    const phrase = phraseKey(entry.mention);
    if (!phrase) return;
    const db = (this.prisma as any).learnedPhrase;
    try {
      const where = { tenantId_accountId_kind_phrase: { tenantId, accountId, kind: entry.kind, phrase } };
      const existing = await db.findUnique({ where });
      if (!existing) {
        await db.create({ data: { tenantId, accountId, kind: entry.kind, phrase, example: entry.mention.slice(0, 200), itemKey: entry.itemKey, itemLabel: entry.itemLabel.slice(0, 250), status: 'AUTO', hits: 1 } });
      } else if (existing.status === 'AUTO' && (entry.itemKey || !existing.itemKey)) {
        await db.update({ where, data: existing.itemKey === entry.itemKey
          ? { hits: { increment: 1 } }
          : { itemKey: entry.itemKey, itemLabel: entry.itemLabel.slice(0, 250), hits: 1 } });
      }
      this.cache.delete(`${tenantId}|${accountId}`);
    } catch (error: any) {
      // A concurrent first sighting may race on the unique key; learning is best effort.
      logger.warn(`LearnedPhraseStore: could not record phrase: ${error?.message || error}`);
    }
  }

  async setStatus(tenantId: string, accountId: string, id: string, status: PhraseStatus, itemKey?: string, itemLabel?: string) {
    const result = await (this.prisma as any).learnedPhrase.updateMany({
      where: { id, tenantId, accountId },
      data: { status, ...(itemKey ? { itemKey, ...(itemLabel ? { itemLabel } : {}) } : {}) }
    });
    this.cache.delete(`${tenantId}|${accountId}`);
    return result.count > 0;
  }
}
