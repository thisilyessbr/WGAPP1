import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WhatsAppNumberService } from '../../src/domain/channel/whatsapp/WhatsAppNumberService';

describe('PHASE WHATSAPP-ACCOUNT-MAPPING-AUDIT-IMPLEMENT-37: Unit Tests', () => {
  let mockPrisma: any;
  let service: WhatsAppNumberService;

  beforeEach(() => {
    mockPrisma = {
      account: {
        findUnique: vi.fn()
      },
      whatsAppBusinessNumber: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn()
      }
    };
    service = new WhatsAppNumberService(mockPrisma as any);
  });

  it('1. Create WhatsApp number mapping for Account A', async () => {
    mockPrisma.account.findUnique.mockResolvedValue({ id: 'acc-A', tenantId: 'tenant-1' });
    mockPrisma.whatsAppBusinessNumber.findUnique.mockResolvedValue(null);
    mockPrisma.whatsAppBusinessNumber.create.mockResolvedValue({
      id: 'num-1',
      tenantId: 'tenant-1',
      accountId: 'acc-A',
      phoneNumberId: 'phone-12345',
      wabaId: 'waba-999',
      displayPhoneNumber: '+15550001',
      enabled: true
    });

    const result = await service.registerNumber({
      tenantId: 'tenant-1',
      accountId: 'acc-A',
      phoneNumberId: 'phone-12345',
      wabaId: 'waba-999',
      displayPhoneNumber: '+15550001'
    });

    expect(result.phoneNumberId).toBe('phone-12345');
    expect(result.accountId).toBe('acc-A');
    expect(result.tenantId).toBe('tenant-1');
  });

  it('2. Resolve phoneNumberId -> Account A', async () => {
    mockPrisma.whatsAppBusinessNumber.findUnique.mockResolvedValue({
      id: 'num-1',
      tenantId: 'tenant-1',
      accountId: 'acc-A',
      phoneNumberId: 'phone-12345',
      enabled: true
    });

    const mapping = await service.resolveAccountByPhoneNumberId('phone-12345');
    expect(mapping).not.toBeNull();
    expect(mapping?.accountId).toBe('acc-A');
    expect(mapping?.tenantId).toBe('tenant-1');
  });

  it('3. Same Account can have multiple phone numbers', async () => {
    mockPrisma.whatsAppBusinessNumber.findMany.mockResolvedValue([
      { id: 'num-1', tenantId: 'tenant-1', accountId: 'acc-A', phoneNumberId: 'phone-1' },
      { id: 'num-2', tenantId: 'tenant-1', accountId: 'acc-A', phoneNumberId: 'phone-2' }
    ]);

    const numbers = await service.listNumbersByAccount('tenant-1', 'acc-A');
    expect(numbers).toHaveLength(2);
    expect(numbers[0].phoneNumberId).toBe('phone-1');
    expect(numbers[1].phoneNumberId).toBe('phone-2');
  });

  it('4. Account A and Account B cannot share the same phoneNumberId', async () => {
    mockPrisma.account.findUnique.mockResolvedValue({ id: 'acc-B', tenantId: 'tenant-1' });
    mockPrisma.whatsAppBusinessNumber.findUnique.mockResolvedValue({
      id: 'num-1',
      tenantId: 'tenant-1',
      accountId: 'acc-A',
      phoneNumberId: 'phone-12345'
    });

    await expect(service.registerNumber({
      tenantId: 'tenant-1',
      accountId: 'acc-B',
      phoneNumberId: 'phone-12345'
    })).rejects.toThrow(/already registered to another account/);
  });

  it('5. Tenant isolation: cross-tenant access is rejected', async () => {
    mockPrisma.account.findUnique.mockResolvedValue({ id: 'acc-A', tenantId: 'tenant-1' });

    await expect(service.registerNumber({
      tenantId: 'tenant-2', // Wrong tenant
      accountId: 'acc-A',
      phoneNumberId: 'phone-12345'
    })).rejects.toThrow(/Account \[acc-A\] not found for tenant \[tenant-2\]/);
  });

  it('6. Account isolation: number lookup returns exact accountId', async () => {
    mockPrisma.whatsAppBusinessNumber.findUnique.mockResolvedValue({
      id: 'num-1',
      tenantId: 'tenant-1',
      accountId: 'acc-B',
      phoneNumberId: 'phone-999',
      enabled: true
    });

    const mapping = await service.resolveAccountByPhoneNumberId('phone-999');
    expect(mapping?.accountId).toBe('acc-B');
    expect(mapping?.accountId).not.toBe('acc-A');
  });

  it('7. Disabled number is rejected by lookup by default', async () => {
    mockPrisma.whatsAppBusinessNumber.findUnique.mockResolvedValue({
      id: 'num-1',
      tenantId: 'tenant-1',
      accountId: 'acc-A',
      phoneNumberId: 'phone-disabled',
      enabled: false
    });

    const mapping = await service.resolveAccountByPhoneNumberId('phone-disabled');
    expect(mapping).toBeNull();

    // But resolvable if requireEnabled is false
    const rawMapping = await service.resolveAccountByPhoneNumberId('phone-disabled', { requireEnabled: false });
    expect(rawMapping).not.toBeNull();
    expect(rawMapping?.enabled).toBe(false);
  });

  it('8. Unknown phoneNumberId returns no mapping', async () => {
    mockPrisma.whatsAppBusinessNumber.findUnique.mockResolvedValue(null);

    const mapping = await service.resolveAccountByPhoneNumberId('non-existent-phone');
    expect(mapping).toBeNull();
  });

  it('9. Enable/disable toggling validates tenant boundary', async () => {
    mockPrisma.whatsAppBusinessNumber.findUnique.mockResolvedValue({
      id: 'num-1',
      tenantId: 'tenant-1',
      phoneNumberId: 'phone-12345',
      enabled: true
    });
    mockPrisma.whatsAppBusinessNumber.update.mockResolvedValue({
      id: 'num-1',
      tenantId: 'tenant-1',
      phoneNumberId: 'phone-12345',
      enabled: false
    });

    const updated = await service.setNumberEnabled('tenant-1', 'phone-12345', false);
    expect(updated.enabled).toBe(false);

    // Cross-tenant toggle fails
    await expect(service.setNumberEnabled('tenant-2', 'phone-12345', false)).rejects.toThrow(/not found for tenant/);
  });

  it('10. Delete number mapping enforces tenant boundary', async () => {
    mockPrisma.whatsAppBusinessNumber.findUnique.mockResolvedValue({
      id: 'num-1',
      tenantId: 'tenant-1',
      phoneNumberId: 'phone-12345'
    });
    mockPrisma.whatsAppBusinessNumber.delete.mockResolvedValue({});

    await service.deleteNumber('tenant-1', 'phone-12345');
    expect(mockPrisma.whatsAppBusinessNumber.delete).toHaveBeenCalledWith({
      where: { phoneNumberId: 'phone-12345' }
    });

    // Cross-tenant delete fails
    await expect(service.deleteNumber('tenant-2', 'phone-12345')).rejects.toThrow(/not found for tenant/);
  });
});
