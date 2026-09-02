import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { prisma, pool } from '../../src/tests/testDb';
import { WhatsAppNumberService } from '../../src/domain/channel/whatsapp/WhatsAppNumberService';

describe('PHASE WHATSAPP-ACCOUNT-MAPPING-AUDIT-IMPLEMENT-37: Database Integration Tests', () => {
  let service: WhatsAppNumberService;
  const createdTenantIds: string[] = [];

  beforeAll(async () => {
    const client = await pool.connect();
    try {
      await client.query('SET search_path TO test, public, extensions;');
    } finally {
      client.release();
    }
  });

  beforeEach(() => {
    service = new WhatsAppNumberService(prisma);
  });

  afterEach(async () => {
    for (const tenantId of createdTenantIds) {
      try {
        await prisma.whatsAppBusinessNumber.deleteMany({ where: { tenantId } });
        await prisma.conversation.deleteMany({ where: { tenantId } });
        await prisma.customer.deleteMany({ where: { tenantId } });
        await prisma.account.deleteMany({ where: { tenantId } });
        await prisma.tenant.deleteMany({ where: { id: tenantId } });
      } catch (err) {}
    }
    createdTenantIds.length = 0;
  });

  async function createTestFixture(tenantPrefix: string) {
    const tenantId = `tenant-wa-${tenantPrefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    createdTenantIds.push(tenantId);

    const tenant = await prisma.tenant.create({
      data: { id: tenantId, name: `Tenant ${tenantPrefix}` }
    });

    const accountA = await prisma.account.create({
      data: { tenantId, name: 'Account A' }
    });

    const accountB = await prisma.account.create({
      data: { tenantId, name: 'Account B' }
    });

    return { tenant, accountA, accountB, tenantId };
  }

  it('1. Persists and resolves WhatsApp number mapping for Account A', async () => {
    const { tenantId, accountA } = await createTestFixture('resolve');
    const phoneId = `phone-test-${Date.now()}`;

    const record = await service.registerNumber({
      tenantId,
      accountId: accountA.id,
      phoneNumberId: phoneId,
      wabaId: 'waba-test-123',
      displayPhoneNumber: '+1555000999'
    });

    expect(record.phoneNumberId).toBe(phoneId);
    expect(record.accountId).toBe(accountA.id);

    const resolved = await service.resolveAccountByPhoneNumberId(phoneId);
    expect(resolved).not.toBeNull();
    expect(resolved?.tenantId).toBe(tenantId);
    expect(resolved?.accountId).toBe(accountA.id);
    expect(resolved?.wabaId).toBe('waba-test-123');
  });

  it('2. Same Account can have multiple phone numbers', async () => {
    const { tenantId, accountA } = await createTestFixture('multi-num');
    const phoneId1 = `phone-1-${Date.now()}`;
    const phoneId2 = `phone-2-${Date.now()}`;

    await service.registerNumber({
      tenantId,
      accountId: accountA.id,
      phoneNumberId: phoneId1,
      displayPhoneNumber: '+15551111'
    });

    await service.registerNumber({
      tenantId,
      accountId: accountA.id,
      phoneNumberId: phoneId2,
      displayPhoneNumber: '+15552222'
    });

    const numbers = await service.listNumbersByAccount(tenantId, accountA.id);
    expect(numbers).toHaveLength(2);
    const phoneIds = numbers.map(n => n.phoneNumberId);
    expect(phoneIds).toContain(phoneId1);
    expect(phoneIds).toContain(phoneId2);
  });

  it('3. Account A and Account B cannot share the same phoneNumberId (uniqueness constraint)', async () => {
    const { tenantId, accountA, accountB } = await createTestFixture('unique');
    const phoneId = `phone-unique-${Date.now()}`;

    await service.registerNumber({
      tenantId,
      accountId: accountA.id,
      phoneNumberId: phoneId
    });

    await expect(service.registerNumber({
      tenantId,
      accountId: accountB.id,
      phoneNumberId: phoneId
    })).rejects.toThrow(/already registered/);
  });

  it('4. Deleting Account cascades and removes WhatsAppBusinessNumber mappings', async () => {
    const { tenantId, accountA } = await createTestFixture('cascade');
    const phoneId = `phone-cascade-${Date.now()}`;

    await service.registerNumber({
      tenantId,
      accountId: accountA.id,
      phoneNumberId: phoneId
    });

    const beforeDelete = await service.resolveAccountByPhoneNumberId(phoneId);
    expect(beforeDelete).not.toBeNull();

    // Delete Account
    await prisma.account.delete({ where: { id: accountA.id } });

    const afterDelete = await service.resolveAccountByPhoneNumberId(phoneId);
    expect(afterDelete).toBeNull();
  });

  it('5. Disabled number is filtered out by default', async () => {
    const { tenantId, accountA } = await createTestFixture('disabled');
    const phoneId = `phone-dis-${Date.now()}`;

    await service.registerNumber({
      tenantId,
      accountId: accountA.id,
      phoneNumberId: phoneId,
      enabled: true
    });

    // Disable number
    await service.setNumberEnabled(tenantId, phoneId, false);

    const resolved = await service.resolveAccountByPhoneNumberId(phoneId);
    expect(resolved).toBeNull();

    const rawResolved = await service.resolveAccountByPhoneNumberId(phoneId, { requireEnabled: false });
    expect(rawResolved).not.toBeNull();
    expect(rawResolved?.enabled).toBe(false);
  });
});
