import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { prisma, pool } from '../../src/tests/testDb';
import { bootstrapChatbot } from '../../src/bootstrap';
import { WhatsAppOnboardingService } from '../../src/domain/channel/whatsapp/WhatsAppOnboardingService';

describe('PHASE WHATSAPP-EMBEDDED-SIGNUP-ONBOARDING-AUDIT-IMPLEMENT-46: Embedded Signup Integration Tests', () => {
  let deps: ReturnType<typeof bootstrapChatbot>;
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
    deps = bootstrapChatbot(prisma);
  });

  afterEach(async () => {
    for (const tenantId of createdTenantIds) {
      try {
        await prisma.whatsAppMessageJob.deleteMany({ where: { tenantId } });
        await prisma.whatsAppBusinessNumber.deleteMany({ where: { tenantId } });
        await prisma.lead.deleteMany({ where: { tenantId } });
        await prisma.message.deleteMany({ where: { tenantId } });
        await prisma.workflowSession.deleteMany({ where: { tenantId } });
        await prisma.conversation.deleteMany({ where: { tenantId } });
        await prisma.customer.deleteMany({ where: { tenantId } });
        await prisma.account.deleteMany({ where: { tenantId } });
        await prisma.tenantConfig.deleteMany({ where: { tenantId } });
        await prisma.tenant.deleteMany({ where: { id: tenantId } });
      } catch (err) {}
    }
    createdTenantIds.length = 0;
  });

  async function createTestTenant(prefix: string) {
    const tenantId = `tenant-emb-${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    createdTenantIds.push(tenantId);

    const tenant = await prisma.tenant.create({
      data: { id: tenantId, name: `Tenant ${prefix}` }
    });

    const accountA = await prisma.account.create({
      data: { tenantId, name: 'Main Account' }
    });

    const accountB = await prisma.account.create({
      data: { tenantId, name: 'Secondary Account' }
    });

    return { tenantId, accountA, accountB };
  }

  it('1, 2, 3, 4, 5, 14. Successful Embedded Signup callback exchanges code, subscribes WABA webhook, registers phone, and associates with Account', async () => {
    const { tenantId, accountA } = await createTestTenant('success');

    const phoneId = `phone-emb-1-${Date.now()}`;
    const wabaId = `waba-emb-1-${Date.now()}`;
    const code = `oauth-auth-code-${Date.now()}`;

    const subscribedUrls: string[] = [];
    const registeredUrls: string[] = [];

    const mockFetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/oauth/access_token')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: 'EAAG_mock_business_token_999',
            token_type: 'bearer'
          })
        } as Response;
      }
      if (url.includes('/subscribed_apps')) {
        subscribedUrls.push(url);
        return { ok: true, status: 200, json: async () => ({ success: true }) } as Response;
      }
      if (url.includes('/register')) {
        registeredUrls.push(url);
        return { ok: true, status: 200, json: async () => ({ success: true }) } as Response;
      }
      return { ok: true, status: 200, json: async () => ({}) } as Response;
    });

    const onboardingService = new WhatsAppOnboardingService(
      prisma,
      deps.whatsAppNumberService!,
      {
        appId: 'mock_app_id',
        appSecret: 'mock_app_secret',
        fetchFn: mockFetch as any
      }
    );

    const stateToken = onboardingService.generateSignupState(tenantId, accountA.id);

    const result = await onboardingService.processEmbeddedSignupCallback({
      tenantId,
      accountId: accountA.id,
      code,
      wabaId,
      phoneNumberId: phoneId,
      displayPhoneNumber: '+1 555 1234',
      stateToken
    });

    expect(result.success).toBe(true);
    expect(result.status).toBe('CONNECTED');
    expect(result.phoneNumberId).toBe(phoneId);
    expect(result.wabaId).toBe(wabaId);
    expect(result.accountId).toBe(accountA.id);
    expect(result.webhookSubscribed).toBe(true);
    expect(result.registered).toBe(true);

    // Verify secrets are NEVER in result
    expect((result as any).access_token).toBeUndefined();
    expect((result as any).appSecret).toBeUndefined();

    // Verify endpoints invoked
    expect(subscribedUrls.some(u => u.includes(wabaId))).toBe(true);
    expect(registeredUrls.some(u => u.includes(phoneId))).toBe(true);

    // Verify database record
    const record = await prisma.whatsAppBusinessNumber.findUnique({
      where: { phoneNumberId: phoneId }
    });
    expect(record).not.toBeNull();
    expect(record?.tenantId).toBe(tenantId);
    expect(record?.accountId).toBe(accountA.id);
    expect(record?.wabaId).toBe(wabaId);
    expect(record?.status).toBe('CONNECTED');
  }, 25000);

  it('6. Unknown or cross-tenant Account is strictly rejected', async () => {
    const tenant1 = await createTestTenant('t1');
    const tenant2 = await createTestTenant('t2');

    const onboardingService = new WhatsAppOnboardingService(prisma, deps.whatsAppNumberService!);

    // Attempt to connect with Account from Tenant 2 under Tenant 1's request
    await expect(
      onboardingService.processEmbeddedSignupCallback({
        tenantId: tenant1.tenantId,
        accountId: tenant2.accountA.id, // Foreign Account!
        code: 'mock_code',
        wabaId: 'waba_test',
        phoneNumberId: 'phone_test_cross'
      })
    ).rejects.toThrow('not found for tenant');
  }, 25000);

  it('7 & 8. Same phoneNumberId cannot be registered by another tenant or account', async () => {
    const tenant1 = await createTestTenant('dup1');
    const tenant2 = await createTestTenant('dup2');

    const sharedPhone = `phone-shared-${Date.now()}`;

    const onboardingService = new WhatsAppOnboardingService(prisma, deps.whatsAppNumberService!);

    // Tenant 1 registers the number
    await onboardingService.processEmbeddedSignupCallback({
      tenantId: tenant1.tenantId,
      accountId: tenant1.accountA.id,
      code: 'mock_code',
      wabaId: 'waba_1',
      phoneNumberId: sharedPhone
    });

    // Tenant 2 attempts to register the same phone number
    await expect(
      onboardingService.processEmbeddedSignupCallback({
        tenantId: tenant2.tenantId,
        accountId: tenant2.accountA.id,
        code: 'mock_code',
        wabaId: 'waba_2',
        phoneNumberId: sharedPhone
      })
    ).rejects.toThrow('already registered to another account or tenant');
  }, 25000);

  it('9. Same Account can connect MULTIPLE WhatsApp numbers without replacement', async () => {
    const { tenantId, accountA } = await createTestTenant('multi-num');

    const phone1 = `phone-acc-1-${Date.now()}`;
    const phone2 = `phone-acc-2-${Date.now()}`;
    const phone3 = `phone-acc-3-${Date.now()}`;

    const onboardingService = new WhatsAppOnboardingService(prisma, deps.whatsAppNumberService!);

    await onboardingService.processEmbeddedSignupCallback({
      tenantId,
      accountId: accountA.id,
      code: 'mock_code',
      wabaId: 'waba_1',
      phoneNumberId: phone1,
      displayPhoneNumber: '+1 555 0001'
    });

    await onboardingService.processEmbeddedSignupCallback({
      tenantId,
      accountId: accountA.id,
      code: 'mock_code',
      wabaId: 'waba_1',
      phoneNumberId: phone2,
      displayPhoneNumber: '+1 555 0002'
    });

    await onboardingService.processEmbeddedSignupCallback({
      tenantId,
      accountId: accountA.id,
      code: 'mock_code',
      wabaId: 'waba_1',
      phoneNumberId: phone3,
      displayPhoneNumber: '+1 555 0003'
    });

    const numbers = await deps.whatsAppNumberService!.listNumbersByAccount(tenantId, accountA.id);
    expect(numbers).toHaveLength(3);

    const ids = numbers.map(n => n.phoneNumberId);
    expect(ids).toContain(phone1);
    expect(ids).toContain(phone2);
    expect(ids).toContain(phone3);
  }, 25000);

  it('13. Re-running Embedded Signup with the same phoneNumberId is fully idempotent', async () => {
    const { tenantId, accountA } = await createTestTenant('idemp');

    const phoneId = `phone-idemp-${Date.now()}`;
    const onboardingService = new WhatsAppOnboardingService(prisma, deps.whatsAppNumberService!);

    // Run 1
    const res1 = await onboardingService.processEmbeddedSignupCallback({
      tenantId,
      accountId: accountA.id,
      code: 'mock_code',
      wabaId: 'waba_idemp',
      phoneNumberId: phoneId,
      displayPhoneNumber: '+1 555 9999'
    });
    expect(res1.success).toBe(true);

    // Run 2 (Customer re-completes signup)
    const res2 = await onboardingService.processEmbeddedSignupCallback({
      tenantId,
      accountId: accountA.id,
      code: 'mock_code',
      wabaId: 'waba_idemp',
      phoneNumberId: phoneId,
      displayPhoneNumber: '+1 555 9999'
    });
    expect(res2.success).toBe(true);

    const allNumbers = await deps.whatsAppNumberService!.listNumbersByAccount(tenantId, accountA.id);
    expect(allNumbers).toHaveLength(1);
    expect(allNumbers[0].phoneNumberId).toBe(phoneId);
  }, 25000);

  it('10. Invalid OAuth code exchange returns status FAILED without marking number connected', async () => {
    const { tenantId, accountA } = await createTestTenant('fail-code');

    const phoneId = `phone-fail-${Date.now()}`;
    const mockFailFetch = vi.fn(async () => {
      return {
        ok: false,
        status: 400,
        json: async () => ({
          error: { message: 'Invalid verification code format.', code: 100 }
        })
      } as Response;
    });

    const onboardingService = new WhatsAppOnboardingService(
      prisma,
      deps.whatsAppNumberService!,
      {
        appId: 'mock_app_id',
        appSecret: 'mock_app_secret',
        fetchFn: mockFailFetch as any
      }
    );

    const result = await onboardingService.processEmbeddedSignupCallback({
      tenantId,
      accountId: accountA.id,
      code: 'invalid_code_123',
      wabaId: 'waba_fail',
      phoneNumberId: phoneId
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe('FAILED');
    expect(result.error).toContain('Invalid verification code');

    // Verify DB does not contain the failed number
    const record = await prisma.whatsAppBusinessNumber.findUnique({
      where: { phoneNumberId: phoneId }
    });
    expect(record).toBeNull();
  }, 25000);
});
