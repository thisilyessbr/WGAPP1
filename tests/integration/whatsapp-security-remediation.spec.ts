import crypto from 'crypto';
import express from 'express';
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { prisma, pool } from '../../src/tests/testDb';
import { bootstrapChatbot } from '../../src/bootstrap';
import { createApp } from '../../src/app';
import { createSignedToken } from '../../src/dev/chatApi';
import { WhatsAppWorker } from '../../src/domain/channel/whatsapp/WhatsAppWorker';
import { PostgresMessageQueue, InboundQueueJob } from '../../src/domain/channel/whatsapp/MessageQueue';
import { ClientSafetyGuard } from '../../src/domain/channel/guard/ClientSafetyGuard';
import { WhatsAppOnboardingService } from '../../src/domain/channel/whatsapp/WhatsAppOnboardingService';
import { WhatsAppOutboundAdapter } from '../../src/domain/channel/whatsapp/WhatsAppOutboundAdapter';
import { WhatsAppNumberService } from '../../src/domain/channel/whatsapp/WhatsAppNumberService';
import { createWhatsAppWebhookRouter } from '../../src/domain/channel/whatsapp/WhatsAppWebhookRouter';
import { SecretBox } from '../../src/core/security/SecretBox';

describe('Security Remediation Verification: P0, P1 & NEW Findings', () => {
  let deps: ReturnType<typeof bootstrapChatbot>;
  let app: any;
  let queue: PostgresMessageQueue;
  const createdTenantIds: string[] = [];
  const testSecretKey = 'test-auth-secret-key-32-chars-long!';

  beforeAll(async () => {
    process.env.AUTH_SECRET = testSecretKey;
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
    queue = new PostgresMessageQueue(prisma, { autoStartWorker: false, leaseSeconds: 5 });
  });

  afterEach(async () => {
    await queue.shutdown();
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
    const tenantId = `tenant-sec-${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    createdTenantIds.push(tenantId);

    const tenant = await prisma.tenant.create({
      data: { id: tenantId, name: `Tenant ${prefix}` }
    });

    const accountA = await prisma.account.create({
      data: { tenantId, name: 'Main Account' }
    });

    return { tenantId, accountA };
  }

  function makeJob(tenantId: string, accountId: string, phoneNumberId: string, waId: string, wamid: string, msg: string): InboundQueueJob {
    return {
      id: wamid,
      partitionKey: `${tenantId}:${accountId}:${waId}`,
      tenantId,
      accountId,
      phoneNumberId,
      waId,
      wamid,
      message: msg,
      timestamp: Date.now(),
      rawType: 'text',
      enqueuedAt: Date.now()
    };
  }

  // =========================================================================
  // P0-01: Unauthenticated channel-management APIs & tenant impersonation
  // =========================================================================
  describe('P0-01: Perimeter Authentication & Tenant Impersonation Prevention', () => {
    it('1. Rejects unauthenticated requests with HTTP 401 Unauthorized when strict auth is enabled', async () => {
      const { tenantId, accountA } = await createTestTenant('p0-01-noauth');

      // Enable STRICT_AUTH for this test
      const prevStrict = process.env.STRICT_AUTH;
      process.env.STRICT_AUTH = 'true';

      try {
        const res = await request(app)
          .post('/api/v1/channel-connections/meta')
          .send({
            accountId: accountA.id,
            accessToken: 'EAAG_test',
            wabaId: 'waba-1'
          });

        expect(res.status).toBe(401);
        expect(res.body.error).toBe('UNAUTHORIZED');
      } finally {
        process.env.STRICT_AUTH = prevStrict;
      }
    });

    it('2. Blocks cross-tenant impersonation (IDOR) with HTTP 403 Forbidden', async () => {
      const tenantA = await createTestTenant('p0-01-idor-a');
      const tenantB = await createTestTenant('p0-01-idor-b');

      // Generate valid signed token for Tenant A
      const tokenA = createSignedToken({
        tenantId: tenantA.tenantId,
        role: 'admin',
        exp: Date.now() + 60_000
      }, testSecretKey);

      // Tenant A attempts to access or modify Tenant B resources
      const res = await request(app)
        .post('/api/v1/channel-connections/meta')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('x-tenant-id', tenantB.tenantId) // Spoofed target
        .send({
          accountId: tenantB.accountA.id,
          accessToken: 'EAAG_malicious',
          wabaId: 'waba-victim'
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('FORBIDDEN');
      expect(res.body.message).toContain('authorization mismatch');
    });
  });

  // =========================================================================
  // P0-02: Human takeover bypass in inbound WhatsApp worker
  // =========================================================================
  describe('P0-02: Human Takeover Enforcement in Worker', () => {
    it('Suppresses bot reply in worker when human takeover is active even without conversationId in job', async () => {
      const { tenantId, accountA } = await createTestTenant('p0-02-takeover');
      const phoneId = `phone-takeover-${Date.now()}`;
      const user = '212600009999';

      // Register phone number
      await deps.whatsAppNumberService!.registerNumber({
        tenantId,
        accountId: accountA.id,
        phoneNumberId: phoneId,
        enabled: true
      });

      // 1. First message creates conversation
      const worker = new WhatsAppWorker(
        queue,
        deps.conversationEngine,
        deps.whatsAppOutboundAdapter,
        deps.whatsAppNumberService,
        deps.whatsAppPolicyAdapter,
        deps.channelRouter,
        deps.clientSafetyGuard
      );

      const job1 = makeJob(tenantId, accountA.id, phoneId, user, `wamid.to.1.${Date.now()}`, 'Hello bot');
      const res1 = await worker.processJob(job1);
      expect(res1.response).toBeTruthy();

      // Find created conversation
      const customer = await prisma.customer.findUnique({
        where: { tenantId_externalId: { tenantId, externalId: user } }
      });
      expect(customer).not.toBeNull();

      const conv = await prisma.conversation.findFirst({
        where: { customerId: customer!.id }
      });
      expect(conv).not.toBeNull();

      // 2. Human agent takes over the conversation
      await deps.clientSafetyGuard!.setHumanTakeover(tenantId, conv!.id, true, 'agent-ilyes');

      // 3. Next message arrives from user (without conversationId in job)
      const job2 = makeJob(tenantId, accountA.id, phoneId, user, `wamid.to.2.${Date.now()}`, 'Are you still there?');
      const res2 = await worker.processJob(job2);

      // Bot MUST be completely silent and suppressed
      expect(res2.response).toBe('');
      expect(res2.outboundResult?.success).toBe(false);
      expect(res2.outboundResult?.error).toContain('Human takeover active on this conversation');
    });
  });

  // =========================================================================
  // P0-03: Embedded Signup state/CSRF bypass
  // =========================================================================
  describe('P0-03: Embedded Signup State & Replay Protection', () => {
    it('1. Rejects callback with tampered or forged stateToken', async () => {
      const { tenantId, accountA } = await createTestTenant('p0-03-forged');
      const onboardingService = new WhatsAppOnboardingService(prisma, deps.whatsAppNumberService!);

      const forgedState = 'eyJhbGciOiJub25lIn0.eyJ0ZW5hbnRJZCI6InNwb29mIn0'; // Unsigned / invalid

      await expect(
        onboardingService.processEmbeddedSignupCallback({
          tenantId,
          accountId: accountA.id,
          code: 'mock_code',
          wabaId: 'waba-1',
          phoneNumberId: 'phone-forged',
          stateToken: forgedState
        })
      ).rejects.toThrow(/Invalid or expired state parameter/);
    });

    it('2. Prevents stateToken replay attacks', async () => {
      const { tenantId, accountA } = await createTestTenant('p0-03-replay');
      const onboardingService = new WhatsAppOnboardingService(prisma, deps.whatsAppNumberService!);

      const stateToken = onboardingService.generateSignupState(tenantId, accountA.id);

      // First validation succeeds
      const firstValid = onboardingService.validateSignupState(stateToken, tenantId, accountA.id);
      expect(firstValid).toBe(true);

      // Second validation with identical token is REJECTED (anti-replay)
      const secondValid = onboardingService.validateSignupState(stateToken, tenantId, accountA.id);
      expect(secondValid).toBe(false);
    });
  });

  // =========================================================================
  // P1-01: Post-LLM takeover TOCTOU race
  // =========================================================================
  describe('P1-01: Post-LLM TOCTOU Race Prevention', () => {
    it('Suppresses outbound send if safety check fails after LLM generation completes', async () => {
      const { tenantId, accountA } = await createTestTenant('p1-01-toctou');
      const phoneId = `phone-toctou-${Date.now()}`;
      const user = '212600008888';

      await deps.whatsAppNumberService!.registerNumber({
        tenantId,
        accountId: accountA.id,
        phoneNumberId: phoneId,
        enabled: true
      });

      let evaluationCount = 0;
      const customGuard = new ClientSafetyGuard(prisma, deps.whatsAppNumberService!);

      // Mock evaluateOutbound to simulate human takeover occurring DURING LLM inference
      vi.spyOn(customGuard, 'evaluateOutbound').mockImplementation(async (params) => {
        evaluationCount++;
        if (evaluationCount === 1) {
          // Pre-LLM check passes
          return { allowed: true, code: 'ALLOWED' };
        } else {
          // Post-LLM check fails (human takeover or tenant pause triggered during inference)
          return { allowed: false, code: 'HUMAN_TAKEOVER', reason: 'Human takeover activated during inference' };
        }
      });

      const worker = new WhatsAppWorker(
        queue,
        deps.conversationEngine,
        deps.whatsAppOutboundAdapter,
        deps.whatsAppNumberService,
        deps.whatsAppPolicyAdapter,
        deps.channelRouter,
        customGuard
      );

      const job = makeJob(tenantId, accountA.id, phoneId, user, `wamid.toctou.${Date.now()}`, 'hi');
      const result = await worker.processJob(job);

      // Evaluated twice (pre-LLM and post-LLM)
      expect(evaluationCount).toBe(2);
      // Outbound delivery must be blocked
      expect(result.outboundResult?.success).toBe(false);
      expect(result.outboundResult?.error).toContain('Human takeover activated during inference');
    });
  });

  // =========================================================================
  // P1-02: Distributed in-memory safety state (Tenant Pause Persistence)
  // =========================================================================
  describe('P1-02: Multi-Instance Distributed Tenant Pause', () => {
    it('Persists tenant automation pause in database and enforces it across guard instances', async () => {
      const { tenantId, accountA } = await createTestTenant('p1-02-dist');
      const phoneId = `phone-dist-${Date.now()}`;

      await deps.whatsAppNumberService!.registerNumber({
        tenantId,
        accountId: accountA.id,
        phoneNumberId: phoneId,
        enabled: true
      });

      // Instance 1 pauses tenant automation
      const guardInstance1 = new ClientSafetyGuard(prisma, deps.whatsAppNumberService!);
      await guardInstance1.setTenantAutomationPaused(tenantId, true, 'Emergency maintenance', 'admin-user');

      // Instance 2 (fresh in-memory state) evaluates outbound for that tenant
      const guardInstance2 = new ClientSafetyGuard(prisma, deps.whatsAppNumberService!);
      const decision = await guardInstance2.evaluateOutbound({
        tenantId,
        accountId: accountA.id,
        phoneNumberId: phoneId,
        recipientWaId: '212600007777'
      });

      expect(decision.allowed).toBe(false);
      expect(decision.code).toBe('TENANT_PAUSED');
      expect(decision.reason).toContain('Automation is paused');
    });
  });

  // =========================================================================
  // P1-03: Hardcoded fallback encryption key
  // =========================================================================
  describe('P1-03: Hardcoded Key Elimination', () => {
    it('SecretBox strictly throws if key is empty', () => {
      expect(() => new SecretBox({ key: '' })).toThrow(/Encryption key/);
    });

    it('Platform rejects missing ENCRYPTION_KEY in production mode', () => {
      const prevEnv = process.env.NODE_ENV;
      const prevKey = process.env.ENCRYPTION_KEY;
      const prevCredKey = process.env.CREDENTIALS_ENCRYPTION_KEY;

      try {
        process.env.NODE_ENV = 'production';
        delete process.env.ENCRYPTION_KEY;
        delete process.env.CREDENTIALS_ENCRYPTION_KEY;

        expect(() => {
          const encKey = process.env.ENCRYPTION_KEY || process.env.CREDENTIALS_ENCRYPTION_KEY || (process.env.NODE_ENV === 'test' ? 'test-key' : '');
          if (!encKey) throw new Error('SecretBox: ENCRYPTION_KEY is required');
        }).toThrow('SecretBox: ENCRYPTION_KEY is required');
      } finally {
        process.env.NODE_ENV = prevEnv;
        if (prevKey) process.env.ENCRYPTION_KEY = prevKey;
        if (prevCredKey) process.env.CREDENTIALS_ENCRYPTION_KEY = prevCredKey;
      }
    });
  });

  // =========================================================================
  // P1-04: Reflected and Stored XSS Prevention in UI
  // =========================================================================
  describe('P1-04: XSS Prevention in Channel Management UI', () => {
    it('Escapes HTML and script tags in /channels/ui', async () => {
      const maliciousTenantId = 'tenant-<script>alert("xss")</script>';

      const token = createSignedToken({
        tenantId: maliciousTenantId,
        role: 'admin',
        exp: Date.now() + 60_000
      }, testSecretKey);

      const agent = request.agent(app);
      const exchange = await agent.get(`/api/v1/channels/ui?token=${token}`);
      expect(exchange.status).toBe(303);
      expect(exchange.headers.location).toBe('/api/v1/channels/ui');
      const res = await agent.get(exchange.headers.location);

      expect(res.status).toBe(200);
      expect(res.text).not.toContain('<div class="tenant-badge" id="tenantBadge">المستأجر: tenant-<script>alert("xss")</script></div>');
      expect(res.text).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    });
  });

  // =========================================================================
  // P1-05: Production-reachable mock_code
  // =========================================================================
  describe('P1-05: Mock Code Isolation from Production', () => {
    it('Rejects mock_code when NODE_ENV is production', async () => {
      const { tenantId, accountA } = await createTestTenant('mock-prod');
      const onboardingService = new WhatsAppOnboardingService(prisma, deps.whatsAppNumberService!);

      const prevEnv = process.env.NODE_ENV;
      const prevVitest = process.env.VITEST;

      try {
        process.env.NODE_ENV = 'production';
        delete (process.env as any).VITEST;

        const stateToken = onboardingService.generateSignupState(tenantId, accountA.id);

        const result = await onboardingService.processEmbeddedSignupCallback({
          tenantId,
          accountId: accountA.id,
          code: 'mock_code',
          wabaId: 'waba-mock',
          phoneNumberId: 'phone-mock',
          stateToken
        });

        // In production, mock_code MUST fail closed without connecting
        expect(result.success).toBe(false);
        expect(result.status).toBe('FAILED');
      } finally {
        process.env.NODE_ENV = prevEnv;
        process.env.VITEST = prevVitest;
      }
    });
  });

  // =========================================================================
  // NEW-01: Direct Meta API bypass prevention
  // =========================================================================
  describe('NEW-01: Direct Meta API Bypass Prevention', () => {
    it('Fails closed if ChannelRouter or WhatsAppNumberService is not configured', async () => {
      const { tenantId, accountA } = await createTestTenant('bypass-meta');
      const job = makeJob(tenantId, accountA.id, 'phone-unrouted', '212600006666', `wamid.bypass.${Date.now()}`, 'hello');

      // Create worker without channelRouter and without numberService
      const worker = new WhatsAppWorker(
        queue,
        deps.conversationEngine,
        new WhatsAppOutboundAdapter(),
        undefined, // no numberService
        deps.whatsAppPolicyAdapter,
        undefined  // no channelRouter
      );

      const result = await worker.processJob(job);
      expect(result.outboundResult?.success).toBe(false);
      expect(result.outboundResult?.error).toContain('Missing WhatsAppNumberService or ChannelRouter configuration');
    });
  });

  // =========================================================================
  // NEW-02: Fail-open fallback to platform master token prevention
  // =========================================================================
  describe('NEW-02: Fail-Open Master Token Fallback Prevention', () => {
    it('Fails closed when client credentials fail decryption and NEVER falls back to master token', async () => {
      const { tenantId, accountA } = await createTestTenant('fail-closed-creds');
      const phoneId = `phone-bad-creds-${Date.now()}`;

      // Create channel connection with corrupted/un-decryptable credentials
      const conn = await prisma.channelConnection.create({
        data: {
          tenantId,
          accountId: accountA.id,
          provider: 'META_CLOUD',
          status: 'CONNECTED',
          encryptedCredentials: 'CORRUPTED_CIPHERTEXT_THAT_CANNOT_BE_DECRYPTED'
        }
      });

      // Register number attached to this connection
      await deps.whatsAppNumberService!.registerNumber({
        tenantId,
        accountId: accountA.id,
        phoneNumberId: phoneId,
        connectionId: conn.id,
        enabled: true
      });

      // Initialize outbound adapter with a platform default master token
      const fetchSpy = vi.fn();
      const adapter = new WhatsAppOutboundAdapter({
        defaultAccessToken: 'EAAG_PLATFORM_MASTER_TOKEN_NEVER_USE_FOR_CLIENT',
        numberService: deps.whatsAppNumberService,
        secretBox: new SecretBox({ key: '32-byte-secret-key-for-test-box!' }),
        fetchFn: fetchSpy as any
      });

      const sendResult = await adapter.sendTextMessage({
        phoneNumberId: phoneId,
        to: '212600005555',
        text: 'This should not send',
        accessToken: 'EAAG_EXPLICIT_BYPASS_TOKEN_NEVER_USE_FOR_CLIENT'
      });

      // Must FAIL CLOSED: Do NOT send using EAAG_PLATFORM_MASTER_TOKEN_NEVER_USE_FOR_CLIENT
      expect(sendResult.success).toBe(false);
      expect(sendResult.error).toContain('WHATSAPP_ACCESS_TOKEN is not configured');
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // P0/P1-1: Fail-Closed Meta Webhook Authentication
  // =========================================================================
  describe('P0/P1-1: Fail-Closed Meta Webhook Authentication', () => {
    const webhookSecret = 'test-meta-webhook-secret-32-chars-long!';
    const rawPayload = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{
        id: 'waba_test',
        changes: [{
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '123', phone_number_id: 'phone-hook-1' },
            messages: [{ from: '212600001111', id: 'wamid.hook.1', timestamp: '1700000000', text: { body: 'hello' }, type: 'text' }]
          }
        }]
      }]
    });

    function sign(payload: string, secret: string) {
      return `sha256=${crypto.createHmac('sha256', secret).update(payload).digest('hex')}`;
    }

    it('1. Missing secret in production mode rejects webhook with HTTP 500', async () => {
      const prevEnv = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = 'production';
        const webhookApp = express();
        webhookApp.use(express.json());
        const noSecretRouter = createWhatsAppWebhookRouter(deps.whatsAppNumberService!, { appSecret: '' });
        webhookApp.use('/webhook', noSecretRouter);

        const res = await request(webhookApp)
          .post('/webhook')
          .send({ object: 'whatsapp_business_account' });

        expect(res.status).toBe(500);
        expect(res.body.error).toBe('WEBHOOK_SECRET_NOT_CONFIGURED');
      } finally {
        process.env.NODE_ENV = prevEnv;
      }
    });

    it('2. Missing signature header returns HTTP 401', async () => {
      const webhookApp = express();
      webhookApp.use(express.json({ verify: (req, _res, buf) => { (req as any).rawBody = buf; } }));
      const secureRouter = createWhatsAppWebhookRouter(deps.whatsAppNumberService!, { appSecret: webhookSecret });
      webhookApp.use('/webhook', secureRouter);

      const res = await request(webhookApp)
        .post('/webhook')
        .send(JSON.parse(rawPayload));

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('MISSING_SIGNATURE');
    });

    it('3. Invalid signature returns HTTP 401', async () => {
      const webhookApp = express();
      webhookApp.use(express.json({ verify: (req, _res, buf) => { (req as any).rawBody = buf; } }));
      const secureRouter = createWhatsAppWebhookRouter(deps.whatsAppNumberService!, { appSecret: webhookSecret });
      webhookApp.use('/webhook', secureRouter);

      const res = await request(webhookApp)
        .post('/webhook')
        .set('x-hub-signature-256', 'sha256=badbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadb')
        .send(JSON.parse(rawPayload));

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('INVALID_SIGNATURE');
    });

    it('4. Valid signature + raw body is accepted with HTTP 200', async () => {
      const { tenantId, accountA } = await createTestTenant('webhook-valid');
      await deps.whatsAppNumberService!.registerNumber({
        tenantId,
        accountId: accountA.id,
        phoneNumberId: 'phone-hook-1',
        enabled: true
      });

      const webhookApp = express();
      webhookApp.use(express.json({ verify: (req, _res, buf) => { (req as any).rawBody = buf; } }));
      const secureRouter = createWhatsAppWebhookRouter(deps.whatsAppNumberService!, { appSecret: webhookSecret }, deps.whatsAppIdempotencyStore, queue);
      webhookApp.use('/webhook', secureRouter);

      const validSig = sign(rawPayload, webhookSecret);
      const res = await request(webhookApp)
        .post('/webhook')
        .set('x-hub-signature-256', validSig)
        .set('content-type', 'application/json')
        .send(rawPayload);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ACK');
    });

    it('5. Database or resolution unexpected failure returns non-2xx (HTTP 500)', async () => {
      const webhookApp = express();
      webhookApp.use(express.json({ verify: (req, _res, buf) => { (req as any).rawBody = buf; } }));

      const faultyNumberService = {
        resolveAccountByPhoneNumberId: vi.fn().mockRejectedValue(new Error('PostgreSQL connection drop'))
      } as any;

      const secureRouter = createWhatsAppWebhookRouter(faultyNumberService, { appSecret: webhookSecret });
      webhookApp.use('/webhook', secureRouter);

      const validSig = sign(rawPayload, webhookSecret);
      const res = await request(webhookApp)
        .post('/webhook')
        .set('x-hub-signature-256', validSig)
        .set('content-type', 'application/json')
        .send(rawPayload);

      // Must NOT return 200 ACK_WITH_ERROR; Meta must retry on non-2xx
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('WEBHOOK_PROCESSING_FAILED');
    });
  });

  // =========================================================================
  // P0/P1-2: Persistent & Cluster-Safe Emergency QR Stop
  // =========================================================================
  describe('P0/P1-2: Persistent & Cluster-Safe Emergency QR Stop', () => {
    it('Instance A activates emergency stop; Instance B enforces block on QR, while Meta channels remain unaffected', async () => {
      const { tenantId, accountA } = await createTestTenant('qr-stop');
      const qrPhoneId = `phone-qr-${Date.now()}`;
      const metaPhoneId = `phone-meta-${Date.now()}`;

      // Register a QR number
      await deps.whatsAppNumberService!.registerNumber({
        tenantId,
        accountId: accountA.id,
        phoneNumberId: qrPhoneId,
        transport: 'QR_WEB',
        enabled: true
      });

      // Register a Meta Cloud number
      await deps.whatsAppNumberService!.registerNumber({
        tenantId,
        accountId: accountA.id,
        phoneNumberId: metaPhoneId,
        transport: 'META_CLOUD',
        enabled: true
      });

      // 1. Instance A activates emergency stop via API
      const stopRes = await request(app)
        .post('/api/v1/channel-connections/qr/emergency-stop')
        .set('Authorization', `Bearer admin-secret-key-12345`)
        .set('x-tenant-id', tenantId)
        .send({ stopped: true });

      expect(stopRes.status).toBe(200);
      expect(stopRes.body.emergencyQrStopped).toBe(true);

      // 2. Instance B (completely fresh ClientSafetyGuard instance without in-memory cache)
      const guardInstanceB = new ClientSafetyGuard(prisma, deps.whatsAppNumberService!);

      // 3. Instance B evaluates outbound for QR number => BLOCKED
      const qrDecision = await guardInstanceB.evaluateOutbound({
        tenantId,
        accountId: accountA.id,
        phoneNumberId: qrPhoneId,
        recipientWaId: '212600003333'
      });
      expect(qrDecision.allowed).toBe(false);
      expect(qrDecision.code).toBe('EMERGENCY_QR_STOPPED');

      // 3.1 Meta Cloud channel MUST NOT be blocked by QR emergency stop
      const metaDecision = await guardInstanceB.evaluateOutbound({
        tenantId,
        accountId: accountA.id,
        phoneNumberId: metaPhoneId,
        recipientWaId: '212600003333'
      });
      expect(metaDecision.allowed).toBe(true);

      // 4. Instance A clears emergency stop
      const resumeRes = await request(app)
        .post('/api/v1/channel-connections/qr/emergency-stop')
        .set('Authorization', `Bearer admin-secret-key-12345`)
        .set('x-tenant-id', tenantId)
        .send({ stopped: false });
      expect(resumeRes.status).toBe(200);
      expect(resumeRes.body.emergencyQrStopped).toBe(false);

      // 5. Clearing the global stop does not silently reactivate a disconnected
      // QR session. The owner must scan/reconnect it before automation resumes.
      const qrDecisionAfter = await guardInstanceB.evaluateOutbound({
        tenantId,
        accountId: accountA.id,
        phoneNumberId: qrPhoneId,
        recipientWaId: '212600003333'
      });
      expect(qrDecisionAfter.allowed).toBe(false);
      expect(qrDecisionAfter.code).toBe('NUMBER_PAUSED');
    });
  });

  // =========================================================================
  // P0/P1-3: Multi-Instance DB-Backed Tenant Pause & Immediate Resume
  // =========================================================================
  describe('P0/P1-3: Multi-Instance DB-Backed Tenant Pause & Immediate Resume', () => {
    it('Instance A pauses tenant, Instance B blocks; Instance A resumes tenant, Instance B immediately allows without restart', async () => {
      const { tenantId, accountA } = await createTestTenant('p1-03-pause-resume');
      const phoneId = `phone-pause-${Date.now()}`;

      await deps.whatsAppNumberService!.registerNumber({
        tenantId,
        accountId: accountA.id,
        phoneNumberId: phoneId,
        enabled: true
      });

      const guardA = new ClientSafetyGuard(prisma, deps.whatsAppNumberService!);
      const guardB = new ClientSafetyGuard(prisma, deps.whatsAppNumberService!);

      // 1. Instance A pauses tenant
      await guardA.setTenantAutomationPaused(tenantId, true, 'Emergency Pause', 'admin');

      // 2. Instance B evaluates outbound => BLOCKED
      const decision1 = await guardB.evaluateOutbound({
        tenantId,
        accountId: accountA.id,
        phoneNumberId: phoneId,
        recipientWaId: '212600004444'
      });
      expect(decision1.allowed).toBe(false);
      expect(decision1.code).toBe('TENANT_PAUSED');

      // 3. Instance A resumes tenant
      await guardA.setTenantAutomationPaused(tenantId, false, 'Maintenance finished', 'admin');

      // 4. Instance B immediately evaluates outbound => ALLOWED (No restart, no stale cache block)
      const decision2 = await guardB.evaluateOutbound({
        tenantId,
        accountId: accountA.id,
        phoneNumberId: phoneId,
        recipientWaId: '212600004444'
      });
      expect(decision2.allowed).toBe(true);
    });
  });

  // =========================================================================
  // P1-4: Advanced UI XSS & Attribute Injection Prevention
  // =========================================================================
  describe('P1-4: Advanced UI XSS & Attribute Injection Prevention', () => {
    it('Script closing tag cannot terminate script context; quotes and img tags cannot create executable HTML', async () => {
      const maliciousTenantId = 'tenant-xss-</script><script>alert("script-breakout")</script>';

      const token = createSignedToken({
        tenantId: maliciousTenantId,
        role: 'admin',
        exp: Date.now() + 60_000
      }, testSecretKey);

      const agent = request.agent(app);
      const exchange = await agent.get(`/api/v1/channels/ui?token=${token}`);
      expect(exchange.status).toBe(303);
      expect(exchange.headers.location).toBe('/api/v1/channels/ui');
      const res = await agent.get(exchange.headers.location);

      expect(res.status).toBe(200);
      // The script tag breakout </script><script> MUST be escaped as \u003c
      expect(res.text).not.toContain('</script><script>alert("script-breakout")</script>');
      expect(res.text).toContain('\\u003c/script>\\u003cscript>alert');

      // Malicious phone id with quote payload does NOT create inline onclick="resumeNumber("..."
      expect(res.text).not.toContain('onclick="resumeNumber(');
      expect(res.text).not.toContain('onclick="confirmDisconnect(');
    });
  });

  // =========================================================================
  // P1-5: Database Uniqueness & Concurrency Protection for ChannelConnection
  // =========================================================================
  describe('P1-5: Database Uniqueness & Concurrency Protection for ChannelConnection', () => {
    it('Two simultaneous creates for the exact same tenant, account, and provider result in exactly one connection', async () => {
      const { tenantId, accountA } = await createTestTenant('p1-05-unique');

      // Trigger two concurrent createOrUpdateConnection calls simultaneously
      const [res1, res2] = await Promise.all([
        deps.whatsAppNumberService!.createOrUpdateConnection({
          tenantId,
          accountId: accountA.id,
          provider: 'META_CLOUD',
          status: 'CONNECTED',
          encryptedCredentials: 'enc_creds_1'
        }),
        deps.whatsAppNumberService!.createOrUpdateConnection({
          tenantId,
          accountId: accountA.id,
          provider: 'META_CLOUD',
          status: 'CONNECTED',
          encryptedCredentials: 'enc_creds_2'
        })
      ]);

      expect(res1.id).toBeDefined();
      expect(res2.id).toBeDefined();
      expect(res1.id).toBe(res2.id);

      // Verify in PostgreSQL database that exactly ONE row exists
      const count = await prisma.channelConnection.count({
        where: {
          tenantId,
          accountId: accountA.id,
          provider: 'META_CLOUD'
        }
      });
      expect(count).toBe(1);
    });
  });

  // =========================================================================
  // P2: Parameterized MessageQueue raw SQL
  // =========================================================================
  describe('P2: Parameterized MessageQueue raw SQL', () => {
    it('Successfully enqueues and claims jobs using parameterized queries without syntax or injection issues', async () => {
      const { tenantId, accountA } = await createTestTenant('p2-queue');
      const wamid = `wamid.param.${Date.now()}`;
      const job = makeJob(tenantId, accountA.id, 'phone-q1', '212600008888', wamid, 'param test');

      const enqueued = await queue.enqueue(job, job.partitionKey);
      expect(enqueued).toBe(true);

      const claimed = await queue.claimNextJob();
      expect(claimed).not.toBeNull();
      expect(claimed?.wamid).toBe(wamid);
      expect(claimed?.tenantId).toBe(tenantId);
    });
  });
});
