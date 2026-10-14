import { describe, expect, it } from 'vitest';
import { WhatsAppDeliveryReceiptProcessor } from '../../src/domain/channel/whatsapp/WhatsAppDeliveryReceiptProcessor';

function receiptFixture() {
  let metadata: Record<string, unknown> = { deliveryStatus: 'SENT' };
  let previous = Promise.resolve();
  const prisma: any = {
    $transaction: async (operation: (tx: any) => Promise<unknown>) => {
      const before = previous;
      let release!: () => void;
      previous = new Promise<void>(resolve => { release = resolve; });
      let locked = false;
      const tx: any = {
        $queryRaw: async () => { await before; locked = true; return [{ id: 'message' }]; },
        message: {
          findUniqueOrThrow: async () => {
            if (!locked) throw new Error('status read before row lock');
            return { id: 'message', metadata };
          },
          update: async ({ data }: any) => { metadata = data.metadata; }
        }
      };
      try { return await operation(tx); } finally { release(); }
    }
  };
  return {
    processor: new WhatsAppDeliveryReceiptProcessor(prisma),
    status: () => metadata.deliveryStatus
  };
}

describe('concurrent WhatsApp delivery receipts', () => {
  it.each([
    ['READ', 'DELIVERED'],
    ['DELIVERED', 'READ'],
    ['READ', 'FAILED']
  ])('never regresses when %s races with %s', async (first, second) => {
    const fixture = receiptFixture();
    await Promise.all([first, second].map(status => fixture.processor.applyReceipt({
      tenantId: 'tenant', providerMessageId: 'wamid.1', status, providerTimestamp: new Date()
    })));
    expect(fixture.status()).toBe('READ');
  });
});
