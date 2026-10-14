import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { prisma, pool } from '../../src/tests/testDb';
import { bootstrapChatbot } from '../../src/bootstrap';
import { WhatsAppOnboardingService } from '../../src/domain/channel/whatsapp/WhatsAppOnboardingService';
import { WhatsAppOutboundAdapter } from '../../src/domain/channel/whatsapp/WhatsAppOutboundAdapter';
import { SecretBox } from '../../src/core/security/SecretBox';

describe('Phase 1: Meta Multi-Client Credentials & Security Integration Tests', () => {
  let deps: ReturnType<typeof bootstrapChatbot>;
  const createdTenantIds: string[] = [];
  const testEncryptionKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const secretBox = new SecretBox({ key: testEncryptionKey });

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
        await prisma.channelConnection.deleteMany({ where: { tenantId } });
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
    const tenantId = `tenant-mc-${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    createdTenantIds.push(tenantId);

    const tenant = await prisma.tenant.create({
      data: { id: tenantId, name: `Tenant ${prefix}` }
    });

    const accountA = await prisma.account.create({
      data: { tenantId, name: 'Main Account' }
    });

    return { tenantId, accountA };
  }

  it('1. Onboarding creates ChannelConnection with encrypted credentials, linking connectionId to WhatsAppBusinessNumber', async () => {
    const { tenantId, accountA } = await createTestTenant('enc-conn');
    const phoneId = `phone-enc-${Date.now()}`;
    const wabaId = `waba-enc-${Date.now()}`;
    const clientSecretToken = 'EAAG_CLIENT_CONFIDENTIAL_TOKEN_123456';

    const mockFetch = vi.fn(async (url: string) => {
      if (url.includes('/oauth/access_token')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ access_token: clientSecretToken })
        } as Response;
      }
      if (url.includes('/phone_numbers')) return { ok: true, status: 200,
        json: async () => ({ data: [{ id: phoneId, display_phone_number: '+15559090' }] }) } as Response;
      if (url.includes('/subscribed_apps')) {
        return { ok: true, status: 200, json: async () => ({ success: true }) } as Response;
      }
      if (url.includes('/register')) {
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
        secretBox,
        fetchFn: mockFetch as any
      }
    );

    const stateToken = onboardingService.generateSignupState(tenantId, accountA.id);

    const result = await onboardingService.processEmbeddedSignupCallback({
      tenantId,
      accountId: accountA.id,
      code: 'valid_oauth_code',
      wabaId,
      phoneNumberId: phoneId,
      displayPhoneNumber: '+15559090',
      stateToken,
      pin: '654321'
    });

    expect(result.success).toBe(true);
    expect(result.status).toBe('CONNECTED');
    expect(result.connectionId).toBeDefined();

    // Verify ChannelConnection in DB
    const connection = await prisma.channelConnection.findUnique({
      where: { id: result.connectionId! }
    });
    expect(connection).not.toBeNull();
    expect(connection?.tenantId).toBe(tenantId);
    expect(connection?.accountId).toBe(accountA.id);
    expect(connection?.status).toBe('CONNECTED');
    // Ensure credentials are NOT plaintext in DB
    expect(connection?.encryptedCredentials).not.toBe(clientSecretToken);
    expect(connection?.encryptedCredentials).toContain('v1:');

    // Decrypt credentials using SecretBox and verify
    const decrypted = secretBox.decrypt(connection!.encryptedCredentials!);
    expect(JSON.parse(decrypted)).toEqual({
      accessToken: clientSecretToken,
      registrationPin: '654321'
    });

    // Verify WhatsAppBusinessNumber is linked to connectionId
    const numberRecord = await prisma.whatsAppBusinessNumber.findUnique({
      where: { phoneNumberId: phoneId }
    });
    expect(numberRecord?.connectionId).toBe(connection?.id);
    expect(numberRecord?.transport).toBe('META_CLOUD');
  });

  it('2. Outbound adapter resolves and uses decrypted per-client token without exposing it', async () => {
    const { tenantId, accountA } = await createTestTenant('outbound-client');
    const phoneId = `phone-out-${Date.now()}`;
    const clientSpecificToken = 'EAAG_TENANT_SPECIFIC_TOKEN_987654';

    // Create encrypted connection for this client
    const encCreds = secretBox.encrypt(clientSpecificToken);
    const connection = await deps.whatsAppNumberService!.createOrUpdateConnection({
      tenantId,
      accountId: accountA.id,
      provider: 'META_CLOUD',
      status: 'CONNECTED',
      encryptedCredentials: encCreds
    });

    await deps.whatsAppNumberService!.registerNumber({
      tenantId,
      accountId: accountA.id,
      phoneNumberId: phoneId,
      connectionId: connection.id,
      transport: 'META_CLOUD'
    });

    let authHeaderSent = '';
    const mockFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      authHeaderSent = (init?.headers as any)?.Authorization || '';
      return {
        ok: true,
        status: 200,
        json: async () => ({ messages: [{ id: 'wamid.outbound.success.123' }] })
      } as Response;
    });

    const outboundAdapter = new WhatsAppOutboundAdapter({
      numberService: deps.whatsAppNumberService,
      secretBox,
      fetchFn: mockFetch as any
    });

    const sendRes = await outboundAdapter.sendTextMessage({
      phoneNumberId: phoneId,
      to: '+1234567890',
      text: 'Hello from multi-tenant client!'
    });

    expect(sendRes.success).toBe(true);
    expect(sendRes.providerMessageId).toBe('wamid.outbound.success.123');
    // Ensure the outbound adapter retrieved and decrypted the exact token for this client's phone number
    expect(authHeaderSent).toBe(`Bearer ${clientSpecificToken}`);
  });

  it('3. HMAC-SHA256 Signed State rejection for tampered signature or expired timestamp', async () => {
    const { tenantId, accountA } = await createTestTenant('csrf-tamper');
    const onboardingService = new WhatsAppOnboardingService(
      prisma,
      deps.whatsAppNumberService!,
      { appId: 'app_id', appSecret: 'app_secret', secretBox }
    );

    const validState = onboardingService.generateSignupState(tenantId, accountA.id);
    expect(onboardingService.validateSignupState(validState, tenantId, accountA.id)).toBe(true);

    // Tampered payload
    const [payloadB64, sig] = validState.split('.');
    const decoded = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    decoded.tenantId = 'malicious-injected-tenant';
    const tamperedPayloadB64 = Buffer.from(JSON.stringify(decoded)).toString('base64url');
    const tamperedState = `${tamperedPayloadB64}.${sig}`;

    expect(onboardingService.validateSignupState(tamperedState, tenantId, accountA.id)).toBe(false);

    // Tampered signature
    const badSigState = `${payloadB64}.invalidsignature12345`;
    expect(onboardingService.validateSignupState(badSigState, tenantId, accountA.id)).toBe(false);

    // Mismatched expected tenant
    expect(onboardingService.validateSignupState(validState, 'different-tenant', accountA.id)).toBe(false);
  });

  it('4. Failed webhook subscription results in FAILED status and does NOT register CONNECTED number', async () => {
    const { tenantId, accountA } = await createTestTenant('fail-sub');
    const phoneId = `phone-fail-sub-${Date.now()}`;
    const wabaId = `waba-fail-sub-${Date.now()}`;

    const mockFetch = vi.fn(async (url: string) => {
      if (url.includes('/phone_numbers')) return { ok: true, status: 200,
        json: async () => ({ data: [{ id: phoneId }] }) } as Response;
      if (url.includes('/subscribed_apps')) {
        return {
          ok: false,
          status: 403,
          json: async () => ({ error: { message: 'Permissions error subscribing WABA', code: 200 } })
        } as Response;
      }
      return { ok: true, status: 200, json: async () => ({}) } as Response;
    });

    const onboardingService = new WhatsAppOnboardingService(
      prisma,
      deps.whatsAppNumberService!,
      { appId: 'mock_app', appSecret: 'mock_secret', secretBox, fetchFn: mockFetch as any }
    );

    const result = await onboardingService.processEmbeddedSignupCallback({
      tenantId,
      accountId: accountA.id,
      code: 'valid_code',
      wabaId,
      phoneNumberId: phoneId
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe('FAILED');
    expect(result.webhookSubscribed).toBe(false);

    // DB must NOT have a CONNECTED WhatsAppBusinessNumber
    const record = await prisma.whatsAppBusinessNumber.findUnique({
      where: { phoneNumberId: phoneId }
    });
    expect(record).toBeNull();
  });
});
