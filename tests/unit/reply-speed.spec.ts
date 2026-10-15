import { describe, expect, it, vi } from 'vitest';
import { ConversationEngine } from '../../src/domain/conversation/ConversationEngine';
import { WhatsAppOutboundAdapter } from '../../src/domain/channel/whatsapp/WhatsAppOutboundAdapter';

describe('plain questions skip the workflow-trigger AI check', () => {
  it.each([
    "C'est quoi Relayqo ?", 'شحال الثمن ديالو فالشهر؟', 'Does it work on Instagram too?', 'wach kayn chi tajriba fabor?',
    'How long does the setup take?', 'هل يفهم الرسائل الصوتية؟', 'kifach kaykhdem'
  ])('plain: %s', text => expect(ConversationEngine.isPlainQuestion(text)).toBe(true));

  it.each([
    'bghit demo', 'Can I get a demo?', 'Je voudrais réserver une démo', 'wach n9der nakhod demo?', 'أريد تجربة',
    'How can I book a call?', 'I want to buy it', 'بغيت نعرف الثمن', 'ok', 'Karim Alaoui'
  ])('not plain: %s', text => expect(ConversationEngine.isPlainQuestion(text)).toBe(false));
});

describe('typing indicator', () => {
  it('marks the message read with a typing indicator on Meta numbers', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true });
    const adapter = new WhatsAppOutboundAdapter({ defaultAccessToken: 'fake-token', fetchFn } as any);
    await expect(adapter.sendTypingIndicator('123456', 'wamid.ABC')).resolves.toBe(true);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toMatch(/\/123456\/messages$/);
    expect(JSON.parse(init.body)).toEqual({ messaging_product: 'whatsapp', status: 'read', message_id: 'wamid.ABC', typing_indicator: { type: 'text' } });
  });

  it('never throws and skips non-Meta ids', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('network'));
    const adapter = new WhatsAppOutboundAdapter({ defaultAccessToken: 'fake-token', fetchFn } as any);
    await expect(adapter.sendTypingIndicator('123456', 'wamid.ABC')).resolves.toBe(false);
    await expect(adapter.sendTypingIndicator('qr-session', 'wamid.ABC')).resolves.toBe(false);
    await expect(adapter.sendTypingIndicator('123456', 'local-1')).resolves.toBe(false);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
