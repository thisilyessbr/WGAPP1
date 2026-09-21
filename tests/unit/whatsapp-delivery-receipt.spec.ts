import { describe, expect, it, vi } from 'vitest';
import { WhatsAppOutboundAdapter } from '../../src/domain/channel/whatsapp/WhatsAppOutboundAdapter';

describe.each(['text', 'template'] as const)('%s delivery receipt validation', mode => {
  async function send(body: string, status = 200) {
    const fetchFn = vi.fn().mockImplementation(async () => new Response(body, { status }));
    const adapter = new WhatsAppOutboundAdapter({ fetchFn, maxRetries: 3 });
    const params = { phoneNumberId: 'test-number', to: 'test-recipient', accessToken: 'fake-test-token' };
    const result = mode === 'text'
      ? await adapter.sendTextMessage({ ...params, text: 'hello' })
      : await adapter.sendTemplateMessage({ ...params, template: { name: 'test_template', languageCode: 'en_US' } });
    return { result, fetchFn };
  }

  it.each([
    ['invalid JSON', 'not-json'],
    ['empty JSON', '{}'],
    ['missing message', '{"messages":[]}'],
    ['missing ID', '{"messages":[{}]}'],
    ['blank ID', '{"messages":[{"id":"  "}]}'],
    ['non-string ID', '{"messages":[{"id":42}]}'],
    ['invalid messages shape', '{"messages":{"0":{"id":"receipt"}}}'],
    ['contradictory error', '{"messages":[{"id":"receipt"}],"error":{"code":1}}']
  ])('holds %s as uncertain without retrying', async (_label, body) => {
    const { result, fetchFn } = await send(body);
    expect(result).toMatchObject({ success: false, errorCode: 'DELIVERY_UNKNOWN', isRetryable: false });
    expect(result.providerMessageId).toBeUndefined();
    expect(result.sentAt).toBeUndefined();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('accepts a valid message receipt', async () => {
    const { result, fetchFn } = await send('{"messages":[{"id":"wamid.test.receipt"}]}');
    expect(result).toMatchObject({ success: true, providerMessageId: 'wamid.test.receipt' });
    expect(result.sentAt).toEqual(expect.any(Number));
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
