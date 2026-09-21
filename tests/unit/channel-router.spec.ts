import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChannelRouter } from '../../src/domain/channel/routing/ChannelRouter';
import { ChannelTransport, SendMessageParams } from '../../src/domain/channel/routing/ChannelTransport';
import { WhatsAppNumberService } from '../../src/domain/channel/whatsapp/WhatsAppNumberService';

describe('Phase 2: ChannelRouter Unit Tests', () => {
  let mockNumberService: any;
  let mockMetaTransport: ChannelTransport;
  let mockQrTransport: ChannelTransport;
  let router: ChannelRouter;

  beforeEach(() => {
    mockNumberService = {
      resolveConnectionByPhoneNumberId: vi.fn()
    };

    mockMetaTransport = {
      provider: 'META_CLOUD',
      sendText: vi.fn().mockResolvedValue({ success: true, providerMessageId: 'meta-msg-1' }),
      getStatus: vi.fn(),
      disconnect: vi.fn()
    };

    mockQrTransport = {
      provider: 'QR_WEB',
      sendText: vi.fn().mockResolvedValue({ success: true, providerMessageId: 'qr-msg-1' }),
      getStatus: vi.fn(),
      disconnect: vi.fn()
    };

    router = new ChannelRouter(mockNumberService as unknown as WhatsAppNumberService, [
      mockMetaTransport,
      mockQrTransport
    ]);
  });

  it('1. Routes official Meta numbers strictly to MetaCloudTransport with correct params', async () => {
    mockNumberService.resolveConnectionByPhoneNumberId.mockResolvedValue({
      number: {
        id: 'num-1',
        tenantId: 'tenant-1',
        accountId: 'acc-1',
        phoneNumberId: 'phone-meta-1',
        transport: 'META_CLOUD',
        enabled: true
      },
      connection: {
        id: 'conn-1',
        tenantId: 'tenant-1',
        accountId: 'acc-1',
        provider: 'META_CLOUD',
        status: 'CONNECTED',
        enabled: true
      }
    });

    const res = await router.routeOutbound({
      tenantId: 'tenant-1',
      accountId: 'acc-1',
      phoneNumberId: 'phone-meta-1',
      to: '+123456789',
      text: 'Hello via Meta!'
    });

    expect(res.success).toBe(true);
    expect(res.providerMessageId).toBe('meta-msg-1');
    expect(mockMetaTransport.sendText).toHaveBeenCalledTimes(1);
    expect(mockQrTransport.sendText).not.toHaveBeenCalled();
  });

  it('2. Unknown/unregistered transport is rejected with an error', async () => {
    mockNumberService.resolveConnectionByPhoneNumberId.mockResolvedValue({
      number: {
        id: 'num-2',
        tenantId: 'tenant-1',
        accountId: 'acc-1',
        phoneNumberId: 'phone-unknown-1',
        transport: 'TELEGRAM_BOT', // Not registered
        enabled: true
      },
      connection: {
        id: 'conn-2',
        tenantId: 'tenant-1',
        accountId: 'acc-1',
        provider: 'TELEGRAM_BOT',
        status: 'CONNECTED',
        enabled: true
      }
    });

    const res = await router.routeOutbound({
      tenantId: 'tenant-1',
      accountId: 'acc-1',
      phoneNumberId: 'phone-unknown-1',
      to: '+123456789',
      text: 'Hello'
    });

    expect(res.success).toBe(false);
    expect(res.error).toContain('Unknown or unregistered transport');
  });

  it('3. Disabled number is rejected before sending', async () => {
    mockNumberService.resolveConnectionByPhoneNumberId.mockResolvedValue(null);

    const res = await router.routeOutbound({
      tenantId: 'tenant-1',
      accountId: 'acc-1',
      phoneNumberId: 'phone-disabled',
      to: '+123456789',
      text: 'Hello'
    });

    expect(res.success).toBe(false);
    expect(res.error).toContain('unknown or disabled');
    expect(mockMetaTransport.sendText).not.toHaveBeenCalled();
  });

  it('4. Connection/Number Tenant mismatch is strictly rejected as a security violation', async () => {
    mockNumberService.resolveConnectionByPhoneNumberId.mockResolvedValue({
      number: {
        id: 'num-1',
        tenantId: 'tenant-A', // Belongs to Tenant A
        accountId: 'acc-A',
        phoneNumberId: 'phone-1',
        transport: 'META_CLOUD',
        enabled: true
      },
      connection: null
    });

    // Attacker Tenant B tries to route through Tenant A's number
    const res = await router.routeOutbound({
      tenantId: 'tenant-B',
      accountId: 'acc-B',
      phoneNumberId: 'phone-1',
      to: '+123456789',
      text: 'Exploit attempt'
    });

    expect(res.success).toBe(false);
    expect(res.error).toContain('SECURITY VIOLATION');
    expect(mockMetaTransport.sendText).not.toHaveBeenCalled();
  });

  it('5. Mismatched ChannelConnection tenant is rejected', async () => {
    mockNumberService.resolveConnectionByPhoneNumberId.mockResolvedValue({
      number: {
        id: 'num-1',
        tenantId: 'tenant-1',
        accountId: 'acc-1',
        phoneNumberId: 'phone-1',
        transport: 'META_CLOUD',
        enabled: true
      },
      connection: {
        id: 'conn-evil',
        tenantId: 'foreign-tenant', // Tampered foreign connection!
        accountId: 'foreign-acc',
        provider: 'META_CLOUD',
        status: 'CONNECTED',
        enabled: true
      }
    });

    const res = await router.routeOutbound({
      tenantId: 'tenant-1',
      accountId: 'acc-1',
      phoneNumberId: 'phone-1',
      to: '+123456789',
      text: 'Exploit'
    });

    expect(res.success).toBe(false);
    expect(res.error).toContain('SECURITY VIOLATION');
    expect(mockMetaTransport.sendText).not.toHaveBeenCalled();
  });

  it('6. A mapped number without an isolated connection is rejected', async () => {
    mockNumberService.resolveConnectionByPhoneNumberId.mockResolvedValue({
      number: {
        id: 'num-no-connection',
        tenantId: 'tenant-1',
        accountId: 'acc-1',
        phoneNumberId: 'phone-no-connection',
        transport: 'META_CLOUD',
        enabled: true
      },
      connection: null
    });

    const res = await router.routeOutbound({
      tenantId: 'tenant-1',
      accountId: 'acc-1',
      phoneNumberId: 'phone-no-connection',
      to: '+123456789',
      text: 'must not use a platform token'
    });

    expect(res.success).toBe(false);
    expect(res.error).toContain('CHANNEL_CONNECTION_REQUIRED');
    expect(mockMetaTransport.sendText).not.toHaveBeenCalled();
  });
});
