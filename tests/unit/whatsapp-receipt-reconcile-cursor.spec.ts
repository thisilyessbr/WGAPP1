import { describe, expect, it } from 'vitest';
import { WhatsAppDeliveryReceiptProcessor } from '../../src/domain/channel/whatsapp/WhatsAppDeliveryReceiptProcessor';

describe('delivery receipt reconciliation sweep', () => {
  it('rotates past permanently unmatched receipts instead of re-reading the oldest batch', async () => {
    const base = Date.now() - 60_000;
    const rows = Array.from({ length: 5 }, (_, i) => ({
      id: `r${i}`, tenantId: 't', providerMessageId: `wamid.${i}`, status: 'delivered',
      correlated: false, createdAt: new Date(base + i)
    }));
    const seen: string[][] = [];
    const prisma: any = {
      whatsAppDeliveryReceipt: {
        findMany: async ({ where, take }: any) => {
          const cursor = where.OR ? { createdAt: where.OR[0].createdAt.gt as Date, id: where.OR[1].id.gt as string } : null;
          const page = rows.filter(r => !cursor || r.createdAt > cursor.createdAt
            || (r.createdAt.getTime() === cursor.createdAt.getTime() && r.id > cursor.id)).slice(0, take);
          seen.push(page.map(r => r.id));
          return page;
        }
      },
      // No Message rows exist, so every receipt stays unmatched.
      $transaction: async (fn: any) => fn({ $queryRaw: async () => [] })
    };
    const processor = new WhatsAppDeliveryReceiptProcessor(prisma);
    await processor.reconcilePendingReceipts(2);
    await processor.reconcilePendingReceipts(2);
    await processor.reconcilePendingReceipts(2);
    await processor.reconcilePendingReceipts(2);
    expect(seen).toEqual([['r0', 'r1'], ['r2', 'r3'], ['r4'], ['r0', 'r1']]);
  });
});
