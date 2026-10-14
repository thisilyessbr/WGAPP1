import { PrismaClient } from '@prisma/client';
import { PortalError } from './types';
import { PhraseStatus, PrismaLearnedPhraseStore, isActivePhrase } from '../domain/understanding/LearnedPhraseStore';

/**
 * Client review of the customer wording the chatbot learned for this business
 * ("l7lawa dyal rjlin" -> "Épilation jambes complètes"). Owners approve, reject
 * or point a phrase to the right product/service; the chatbot follows their call.
 */
export class PortalLearnedWording {
  private store: PrismaLearnedPhraseStore;

  constructor(private db: PrismaClient) {
    this.store = new PrismaLearnedPhraseStore(db);
  }

  async items(tenantId: string, accountId: string): Promise<{ kind: 'product' | 'service'; key: string; label: string }[]> {
    const products = await this.db.product.findMany({ where: { tenantId, accountId, active: true }, select: { id: true, name: true, category: true }, orderBy: { name: 'asc' }, take: 500 });
    const account = await this.db.account.findFirst({ where: { id: accountId, tenantId }, select: { config: true } });
    const services = ((account?.config as any)?.portalFacts?.services || []) as any[];
    return [
      ...products.map(p => ({ kind: 'product' as const, key: p.id, label: p.category ? `${p.name} (${p.category})` : p.name })),
      ...services.filter(s => typeof s?.name === 'string' && s.name.trim()).map(s => ({ kind: 'service' as const, key: String(s.name), label: String(s.name) }))
    ];
  }

  async list(tenantId: string, accountId: string) {
    const rows = await (this.db as any).learnedPhrase.findMany({
      where: { tenantId, accountId }, orderBy: [{ updatedAt: 'desc' }], take: 300
    });
    const phrases = rows.map((r: any) => ({
      id: r.id, kind: r.kind, example: r.example, itemKey: r.itemKey, itemLabel: r.itemLabel,
      status: r.status, hits: r.hits, active: isActivePhrase(r), updatedAt: r.updatedAt
    }));
    return { phrases, items: await this.items(tenantId, accountId) };
  }

  async update(tenantId: string, accountId: string, id: string, body: { status?: unknown; itemKey?: unknown }) {
    const status = String(body.status || '').toUpperCase();
    if (!['APPROVED', 'REJECTED', 'AUTO'].includes(status)) throw new PortalError(400, 'INVALID_WORDING_STATUS');
    const row = await (this.db as any).learnedPhrase.findFirst({ where: { id, tenantId, accountId } });
    if (!row) throw new PortalError(404, 'WORDING_NOT_FOUND');
    let itemKey: string | undefined, itemLabel: string | undefined;
    if (body.itemKey !== undefined && body.itemKey !== row.itemKey) {
      const item = (await this.items(tenantId, accountId)).find(i => i.kind === row.kind && i.key === body.itemKey);
      if (!item) throw new PortalError(400, 'INVALID_WORDING_ITEM');
      itemKey = item.key; itemLabel = item.label;
    }
    if (status === 'APPROVED' && !itemKey && !row.itemKey) throw new PortalError(400, 'WORDING_ITEM_REQUIRED', 'Choose what this wording means before approving it.');
    await this.store.setStatus(tenantId, accountId, id, status as PhraseStatus, itemKey, itemLabel);
    return (await this.list(tenantId, accountId)).phrases.find((p: any) => p.id === id);
  }
}
