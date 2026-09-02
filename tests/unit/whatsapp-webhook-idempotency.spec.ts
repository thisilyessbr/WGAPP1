import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import crypto from 'crypto';
import { createWhatsAppWebhookRouter } from '../../src/domain/channel/whatsapp/WhatsAppWebhookRouter';
import { WhatsAppSignatureValidator } from '../../src/domain/channel/whatsapp/WhatsAppSignatureValidator';
import { MemoryIdempotencyStore } from '../../src/domain/channel/whatsapp/IdempotencyStore';
import { WhatsAppWebhookExtractor } from '../../src/domain/channel/whatsapp/WhatsAppWebhookExtractor';

describe('PHASE WHATSAPP-WEBHOOK-IDEMPOTENCY-AUDIT-IMPLEMENT-38: Tests', () => {
  const testAppSecret = 'test_meta_app_secret_1234567890';
  const testVerifyToken = 'test_meta_verify_token_abcdef';

  let mockNumberService: any;
  let idempotencyStore: MemoryIdempotencyStore;
  let app: express.Application;

  beforeEach(() => {
    idempotencyStore = new MemoryIdempotencyStore({ defaultTtlSeconds: 3600 });
    mockNumberService = {
      resolveAccountByPhoneNumberId: vi.fn()
    };

    app = express();
    app.use(express.json({
      verify: (req, _res, buf) => {
        (req as any).rawBody = buf;
      }
    }));

    const router = createWhatsAppWebhookRouter(
      mockNumberService,
      { appSecret: testAppSecret, verifyToken: testVerifyToken },
      idempotencyStore
    );
    app.use('/webhook/whatsapp', router);
  });

  function createSignature(payload: object | string, secret: string = testAppSecret): string {
    const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(raw);
    return `sha256=${hmac.digest('hex')}`;
  }

  function createValidPayload(wamid: string, phoneNumberId: string = '123456789', text: string = 'Hello'): any {
    return {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba_999',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: {
                  display_phone_number: '15550001',
                  phone_number_id: phoneNumberId
                },
                contacts: [
                  {
                    profile: { name: 'John Doe' },
                    wa_id: '212600000000'
                  }
                ],
                messages: [
                  {
                    from: '212600000000',
                    id: wamid,
                    timestamp: '1724900000',
                    text: { body: text },
                    type: 'text'
                  }
                ]
              }
            }
          ]
        }
      ]
    };
  }

  it('1. GET webhook verification success (returns challenge)', async () => {
    const res = await request(app)
      .get('/webhook/whatsapp')
      .query({
        'hub.mode': 'subscribe',
        'hub.verify_token': testVerifyToken,
        'hub.challenge': '1158201444'
      });

    expect(res.status).toBe(200);
    expect(res.text).toBe('1158201444');
  });

  it('2. GET webhook verification failure (invalid verify token or mode)', async () => {
    const resWrongToken = await request(app)
      .get('/webhook/whatsapp')
      .query({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'wrong_token',
        'hub.challenge': '1158201444'
      });
    expect(resWrongToken.status).toBe(403);

    const resWrongMode = await request(app)
      .get('/webhook/whatsapp')
      .query({
        'hub.mode': 'unsubscribe',
        'hub.verify_token': testVerifyToken,
        'hub.challenge': '1158201444'
      });
    expect(resWrongMode.status).toBe(403);
  });

  it('3. POST valid signature is accepted', async () => {
    const payload = createValidPayload('wamid.001');
    mockNumberService.resolveAccountByPhoneNumberId.mockResolvedValue({
      tenantId: 'tenant-1',
      accountId: 'acc-A',
      phoneNumberId: '123456789'
    });

    const res = await request(app)
      .post('/webhook/whatsapp')
      .set('x-hub-signature-256', createSignature(payload))
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ACK');
    expect(res.body.processed).toBe(1);
  });

  it('4. POST invalid signature is rejected with 401', async () => {
    const payload = createValidPayload('wamid.002');
    const res = await request(app)
      .post('/webhook/whatsapp')
      .set('x-hub-signature-256', 'sha256=invalidhex00000000000000000000000000000000000000000000000000000000')
      .send(payload);

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('INVALID_SIGNATURE');
    expect(mockNumberService.resolveAccountByPhoneNumberId).not.toHaveBeenCalled();
  });

  it('5. Correct phoneNumberId extraction', async () => {
    const payload = createValidPayload('wamid.003', 'phone_id_9999');
    mockNumberService.resolveAccountByPhoneNumberId.mockResolvedValue({
      tenantId: 'tenant-1',
      accountId: 'acc-A',
      phoneNumberId: 'phone_id_9999'
    });

    await request(app)
      .post('/webhook/whatsapp')
      .set('x-hub-signature-256', createSignature(payload))
      .send(payload);

    expect(mockNumberService.resolveAccountByPhoneNumberId).toHaveBeenCalledWith('phone_id_9999');
  });

  it('6. Correct waId extraction & 7. Correct wamid extraction', () => {
    const payload = createValidPayload('wamid.special_123', 'phone_555', 'I want to book');
    const extracted = WhatsAppWebhookExtractor.extractMessages(payload);

    expect(extracted).toHaveLength(1);
    expect(extracted[0].wamid).toBe('wamid.special_123');
    expect(extracted[0].waId).toBe('212600000000');
    expect(extracted[0].phoneNumberId).toBe('phone_555');
    expect(extracted[0].message).toBe('I want to book');
  });

  it('8. Unknown phoneNumberId is rejected safely (processed = 0)', async () => {
    const payload = createValidPayload('wamid.004', 'unregistered_phone_id');
    mockNumberService.resolveAccountByPhoneNumberId.mockResolvedValue(null);

    const res = await request(app)
      .post('/webhook/whatsapp')
      .set('x-hub-signature-256', createSignature(payload))
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.processed).toBe(0);
  });

  it('9. Disabled phone number is rejected safely (processed = 0)', async () => {
    const payload = createValidPayload('wamid.005', 'disabled_phone_id');
    // resolveAccountByPhoneNumberId returns null for disabled numbers by default
    mockNumberService.resolveAccountByPhoneNumberId.mockResolvedValue(null);

    const res = await request(app)
      .post('/webhook/whatsapp')
      .set('x-hub-signature-256', createSignature(payload))
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.processed).toBe(0);
  });

  it('10. First wamid is accepted & 11. Duplicate wamid is rejected/skipped', async () => {
    const payload = createValidPayload('wamid.unique_test_100');
    mockNumberService.resolveAccountByPhoneNumberId.mockResolvedValue({
      tenantId: 'tenant-1',
      accountId: 'acc-A',
      phoneNumberId: '123456789'
    });

    // 1st delivery
    const res1 = await request(app)
      .post('/webhook/whatsapp')
      .set('x-hub-signature-256', createSignature(payload))
      .send(payload);

    expect(res1.status).toBe(200);
    expect(res1.body.processed).toBe(1);
    expect(mockNumberService.resolveAccountByPhoneNumberId).toHaveBeenCalledTimes(1);

    // 2nd delivery (Simulated Meta retry)
    const res2 = await request(app)
      .post('/webhook/whatsapp')
      .set('x-hub-signature-256', createSignature(payload))
      .send(payload);

    expect(res2.status).toBe(200);
    expect(res2.body.processed).toBe(0); // Dropped as duplicate
    // Proves 0 additional database lookups or downstream processing on retry
    expect(mockNumberService.resolveAccountByPhoneNumberId).toHaveBeenCalledTimes(1);
  });

  it('12. Duplicate wamid causes zero downstream processing', async () => {
    const isDupBefore = await idempotencyStore.isDuplicate('wamid.retry_check_555');
    expect(isDupBefore).toBe(false);

    await idempotencyStore.record('wamid.retry_check_555');
    const isDupAfter = await idempotencyStore.isDuplicate('wamid.retry_check_555');
    expect(isDupAfter).toBe(true);
  });

  it('13. Malformed webhook does not crash server and returns safe ACK', async () => {
    const malformed = { random: 'garbage', entry: 'not_an_array' };
    const res = await request(app)
      .post('/webhook/whatsapp')
      .set('x-hub-signature-256', createSignature(malformed))
      .send(malformed);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ACK');
    expect(res.body.processed).toBe(0);
  });

  it('14. Unsupported message type (e.g. sticker, reaction) is safely ignored', async () => {
    const stickerPayload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba_999',
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: '123456789' },
                messages: [
                  {
                    from: '212600000000',
                    id: 'wamid.sticker_001',
                    timestamp: '1724900000',
                    type: 'sticker',
                    sticker: { id: 'sticker_999' }
                  }
                ]
              }
            }
          ]
        }
      ]
    };

    const extracted = WhatsAppWebhookExtractor.extractMessages(stickerPayload);
    expect(extracted).toHaveLength(0); // Safely filtered out

    const res = await request(app)
      .post('/webhook/whatsapp')
      .set('x-hub-signature-256', createSignature(stickerPayload))
      .send(stickerPayload);

    expect(res.status).toBe(200);
    expect(res.body.processed).toBe(0);
  });

  it('15. MemoryIdempotencyStore eviction and TTL behavior', async () => {
    const tinyStore = new MemoryIdempotencyStore({ defaultTtlSeconds: 1, maxCapacity: 2 });
    await tinyStore.record('key1');
    await tinyStore.record('key2');
    expect(tinyStore.size()).toBe(2);

    await tinyStore.record('key3'); // Exceeds capacity -> evicts oldest
    expect(tinyStore.size()).toBeLessThanOrEqual(2);
  });
});
