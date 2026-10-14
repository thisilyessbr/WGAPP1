import { describe, expect, it, vi } from 'vitest';
import { WhatsAppOutboundAdapter } from '../../src/domain/channel/whatsapp/WhatsAppOutboundAdapter';

describe('published product image delivery', () => {
  it('sends a single Meta image with caption and keeps ambiguous network outcomes from retrying', async () => {
    const old = process.env.PORTAL_PUBLIC_URL;
    process.env.PORTAL_PUBLIC_URL = 'https://relayqo.example';
    try {
      const id = '88888888-8888-4888-8888-888888888888';
      const imageUrl = `https://relayqo.example/api/product-images/${id}`;
      const fetchFn = vi.fn(async (_url: string, init: any) => {
        expect(JSON.parse(init.body)).toMatchObject({ type: 'image', image: { link: imageUrl, caption: 'Here are the shoes.' }, to: '212600000001' });
        return new Response(JSON.stringify({ messages: [{ id: 'wamid.image' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      });
      const adapter = new WhatsAppOutboundAdapter({ defaultAccessToken: 'unit-test-token', fetchFn: fetchFn as any });
      expect(await adapter.sendImageMessage({ phoneNumberId: '1234', to: '212600000001', caption: 'Here are the shoes.', imageUrl })).toMatchObject({ success: true, providerMessageId: 'wamid.image' });
      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect((await adapter.sendImageMessage({ phoneNumberId: '1234', to: '212600000001', caption: 'X', imageUrl: 'https://evil.example/a.jpg' })).success).toBe(false);
      expect(fetchFn).toHaveBeenCalledTimes(1);
      const ambiguous = new WhatsAppOutboundAdapter({ defaultAccessToken: 'unit-test-token', fetchFn: vi.fn(async () => { throw Error('connection reset'); }) as any });
      expect(await ambiguous.sendImageMessage({ phoneNumberId: '1234', to: '212600000001', caption: 'X', imageUrl })).toMatchObject({ success: false, errorCode: 'DELIVERY_UNKNOWN', isRetryable: false });
    } finally { if (old === undefined) delete process.env.PORTAL_PUBLIC_URL; else process.env.PORTAL_PUBLIC_URL = old; }
  });
});
