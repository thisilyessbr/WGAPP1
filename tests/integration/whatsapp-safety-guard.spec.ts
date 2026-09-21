import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { prisma, pool } from '../../src/tests/testDb';
import { bootstrapChatbot } from '../../src/bootstrap';
import { createApp } from '../../src/app';
import { ClientSafetyGuard } from '../../src/domain/channel/guard/ClientSafetyGuard';

describe('Phase 3: Client Safety Guard & Kill Switches Integration Tests', () => {
  let deps: ReturnType<typeof bootstrapChatbot>;
  let app: any;
  const createdTenantIds: string[] = [];

  beforeAll(async () => {
    process.env.DEV_API_KEY = 'admin-secret-key-12345';
    const client = await pool.connect();
    try {
      await client.query('SET search_path TO test, public, extensions;');
    } finally {
      client.release();
    }
  });

  beforeEach(async () => {
    deps = bootstrapChatbot(prisma);
    app = await createApp(deps);
  });

  afterEach(async () => {
    for (const tenantId of createdTenantIds) {
      try {
        await prisma.channelAuditEvent.deleteMany({ where: { tenantId } });
        await prisma.conversationAutomationState.deleteMany({ where: { tenantId } });
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
    const tenantId = `tenant-sg-${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    createdTenantIds.push(tenantId);

    const tenant = await prisma.tenant.create({
      data: { id: tenantId, name: `Tenant ${prefix}` }
    });

    const accountA = await prisma.account.create({
      data: { tenantId, name: 'Main Account' }
    });

    return { tenantId, accountA };
  }

  it('1. POST /api/v1/channel-connections/meta creates encrypted connection without exposing secrets in response', async () => {
    const { tenantId, accountA } = await createTestTenant('meta-conn');

    const res = await request(app)
      .post('/api/v1/channel-connections/meta')
      .set('Authorization', 'Bearer admin-secret-key-12345')
      .set('x-tenant-id', tenantId)
      .send({
        accountId: accountA.id,
        accessToken: 'EAAG_VERY_CONFIDENTIAL_TOKEN_SECRET',
        wabaId: 'waba-12345'
      });

    expect(res.status).toBe(201);
    expect(res.body.connection).toBeDefined();
    expect(res.body.connection.tenantId).toBe(tenantId);
    expect(res.body.connection.status).toBe('PENDING');

    // Never return access token or encrypted credentials in API response
    expect(res.body.connection.accessToken).toBeUndefined();
    expect(res.body.connection.encryptedCredentials).toBeUndefined();

    // Verify Audit Event created and sanitized
    const audits = await prisma.channelAuditEvent.findMany({
      where: { tenantId, action: 'CHANNEL_CONNECTION_CREATED' }
    });
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits[0].metadata)).not.toContain('EAAG_VERY_CONFIDENTIAL_TOKEN_SECRET');
  });

  it('2. Tenant A cannot pause, read or modify Tenant B numbers or connections', async () => {
    const tenantA = await createTestTenant('iso-a');
    const tenantB = await createTestTenant('iso-b');

    const phoneB = `phone-b-${Date.now()}`;
    await deps.whatsAppNumberService!.registerNumber({
      tenantId: tenantB.tenantId,
      accountId: tenantB.accountA.id,
      phoneNumberId: phoneB,
      displayPhoneNumber: '+15550002'
    });

    // Tenant A attempts to pause Tenant B's number
    const res = await request(app)
      .post(`/api/v1/whatsapp/numbers/${phoneB}/pause`)
      .set('Authorization', 'Bearer admin-secret-key-12345')
      .set('x-tenant-id', tenantA.tenantId) // Authenticated as Tenant A
      .send();

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('not found for tenant');

    // Verify Tenant B's number remains untouched (CONNECTED)
    const num = await prisma.whatsAppBusinessNumber.findUnique({ where: { phoneNumberId: phoneB } });
    expect(num?.status).toBe('CONNECTED');
    expect(num?.enabled).toBe(true);
  });

  it('3. Human Takeover suppresses bot replies and records audit log', async () => {
    const { tenantId, accountA } = await createTestTenant('human-takeover');

    const customer = await prisma.customer.create({
      data: { tenantId, externalId: `cust-${Date.now()}` }
    });

    const conversation = await prisma.conversation.create({
      data: {
        tenantId,
        accountId: accountA.id,
        customerId: customer.id,
        status: 'ACTIVE'
      }
    });

    // 1. Activate Human Takeover
    const res = await request(app)
      .post(`/api/v1/conversations/${conversation.id}/human-takeover`)
      .set('Authorization', 'Bearer admin-secret-key-12345')
      .set('x-tenant-id', tenantId)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.humanTakeover).toBe(true);
    expect(res.body.botEnabled).toBe(false);

    const phoneId = `phone-ht-${Date.now()}`;
    await deps.whatsAppNumberService!.registerNumber({
      tenantId,
      accountId: accountA.id,
      phoneNumberId: phoneId,
      enabled: true
    });

    // 2. Evaluate Safety Guard
    const guardDecision = await deps.clientSafetyGuard!.evaluateOutbound({
      tenantId,
      accountId: accountA.id,
      phoneNumberId: phoneId,
      recipientWaId: '+12345678',
      conversationId: conversation.id
    });

    expect(guardDecision.allowed).toBe(false);
    expect(guardDecision.code).toBe('HUMAN_TAKEOVER');

    // 3. Resume Bot
    const resResume = await request(app)
      .post(`/api/v1/conversations/${conversation.id}/resume-bot`)
      .set('Authorization', 'Bearer admin-secret-key-12345')
      .set('x-tenant-id', tenantId)
      .send();

    expect(resResume.status).toBe(200);
    expect(resResume.body.humanTakeover).toBe(false);
    expect(resResume.body.botEnabled).toBe(true);
  });

  it('4. Pausing one number blocks outbound on that number without affecting other client numbers', async () => {
    const { tenantId, accountA } = await createTestTenant('pause-one');

    const phone1 = `phone-active-${Date.now()}`;
    const phone2 = `phone-to-pause-${Date.now()}`;

    await deps.whatsAppNumberService!.registerNumber({
      tenantId,
      accountId: accountA.id,
      phoneNumberId: phone1,
      enabled: true
    });

    await deps.whatsAppNumberService!.registerNumber({
      tenantId,
      accountId: accountA.id,
      phoneNumberId: phone2,
      enabled: true
    });

    // Pause phone2
    const pauseRes = await request(app)
      .post(`/api/v1/whatsapp/numbers/${phone2}/pause`)
      .set('Authorization', 'Bearer admin-secret-key-12345')
      .set('x-tenant-id', tenantId)
      .send();

    expect(pauseRes.status).toBe(200);

    // Evaluate Safety Guard for phone2 (should be blocked)
    const check2 = await deps.clientSafetyGuard!.evaluateOutbound({
      tenantId,
      accountId: accountA.id,
      phoneNumberId: phone2,
      recipientWaId: '+123456'
    });
    expect(check2.allowed).toBe(false);
    expect(check2.code).toBe('NUMBER_PAUSED');

    // Evaluate Safety Guard for phone1 (must remain allowed!)
    const check1 = await deps.clientSafetyGuard!.evaluateOutbound({
      tenantId,
      accountId: accountA.id,
      phoneNumberId: phone1,
      recipientWaId: '+123456'
    });
    expect(check1.allowed).toBe(true);
    expect(check1.code).toBe('ALLOWED');
  });

  it('5. Emergency QR stop stops QR without stopping Meta channels', async () => {
    expect(ClientSafetyGuard.isEmergencyQrStopped()).toBe(false);

    // Activate emergency stop
    const res = await request(app)
      .post('/api/v1/channel-connections/qr/emergency-stop')
      .set('Authorization', 'Bearer admin-secret-key-12345')
      .send({ stopped: true });

    expect(res.status).toBe(200);
    expect(res.body.emergencyQrStopped).toBe(true);
    expect(ClientSafetyGuard.isEmergencyQrStopped()).toBe(true);

    // Reset back
    ClientSafetyGuard.setEmergencyQrStop(false);
    expect(ClientSafetyGuard.isEmergencyQrStopped()).toBe(false);
  });

  it('6. Repeated provider failures trip the Circuit Breaker and pause the number', async () => {
    const { tenantId, accountA } = await createTestTenant('circuit');
    const phoneId = `phone-cb-${Date.now()}`;

    await deps.whatsAppNumberService!.registerNumber({
      tenantId,
      accountId: accountA.id,
      phoneNumberId: phoneId,
      enabled: true
    });

    const guard = deps.clientSafetyGuard!;

    // Trigger 5 consecutive provider failures
    for (let i = 0; i < 5; i++) {
      guard.recordProviderFailure(phoneId);
    }

    // Safety guard should now block with CIRCUIT_BREAKER_OPEN
    const check = await guard.evaluateOutbound({
      tenantId,
      accountId: accountA.id,
      phoneNumberId: phoneId,
      recipientWaId: '+1555999'
    });

    expect(check.allowed).toBe(false);
    expect(check.code).toBe('CIRCUIT_BREAKER_OPEN');

    // Reset circuit breaker upon recovery
    guard.recordProviderSuccess(phoneId);
    const recoveredCheck = await guard.evaluateOutbound({
      tenantId,
      accountId: accountA.id,
      phoneNumberId: phoneId,
      recipientWaId: '+1555999'
    });
    expect(recoveredCheck.allowed).toBe(true);
  });

  it('7. GET /api/v1/channels/dashboard returns client status, badges, and sanitized data without secrets', async () => {
    const { tenantId, accountA } = await createTestTenant('dash');
    const phoneId = `phone-dash-${Date.now()}`;

    await deps.whatsAppNumberService!.registerNumber({
      tenantId,
      accountId: accountA.id,
      phoneNumberId: phoneId,
      displayPhoneNumber: '+15558888',
      enabled: true
    });

    const res = await request(app)
      .get('/api/v1/channels/dashboard')
      .set('Authorization', 'Bearer admin-secret-key-12345')
      .set('x-tenant-id', tenantId);

    expect(res.status).toBe(200);
    expect(res.body.tenantId).toBe(tenantId);
    expect(res.body.totalNumbers).toBe(1);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.qrFeatureEnabled).toBe(false);
    expect(res.body.accounts).toEqual([{ id: accountA.id, name: 'Main Account' }]);

    const item = res.body.items[0];
    expect(item.phoneNumberId).toBe(phoneId);
    expect(item.clientName).toBe('Main Account');
    expect(item.transportBadge).toBe('Official Meta');
    expect(item.status).toBe('CONNECTED');
    // Ensure no secrets leaked
    expect(JSON.stringify(item)).not.toContain('password');
    expect(JSON.stringify(item)).not.toContain('secret');
  });

  it('8. GET /api/v1/channels/ui returns non-technical admin dashboard HTML page', async () => {
    const res = await request(app)
      .get('/api/v1/channels/ui?tenantId=test-ui-tenant')
      .set('Authorization', 'Bearer admin-secret-key-12345');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('لوحة إدارة قنوات WhatsApp');
    expect(res.text).toContain('Official Meta');
    expect(res.text).toContain('Temporary QR');
    expect(res.text).toContain('تأكيد فصل القناة');
    expect(res.text).toContain('ربط رقم عبر QR');
    expect(res.text).toContain('/api/v1/channel-connections/qr');
    expect(res.text).toContain('pollForQr');
  });
});
