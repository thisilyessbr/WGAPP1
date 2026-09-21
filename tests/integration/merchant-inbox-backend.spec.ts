import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { prisma, pool } from '../../src/tests/testDb';
import { PortalStore } from '../../src/portal/PortalStore';
import { PortalAuth, hashPassword, hashToken } from '../../src/portal/PortalAuth';
import { PortalBudget } from '../../src/portal/PortalBudget';
import { PortalDocuments } from '../../src/portal/PortalDocuments';
import { PortalConnections } from '../../src/portal/PortalConnections';
import { createPortalRouter } from '../../src/portal/PortalRouter';
import { validatePlan } from '../../src/portal/validation';
import { ConversationAutomationService } from '../../src/domain/conversation/ConversationAutomationService';
import { MemoryOutboundQueue, WhatsAppOutboundWorker } from '../../src/domain/channel/whatsapp/WhatsAppOutboundQueue';
import { WhatsAppOutboundAdapter } from '../../src/domain/channel/whatsapp/WhatsAppOutboundAdapter';
import { ClientSafetyGuard } from '../../src/domain/channel/guard/ClientSafetyGuard';
import { WhatsAppWorker } from '../../src/domain/channel/whatsapp/WhatsAppWorker';
import { WhatsAppNumberService } from '../../src/domain/channel/whatsapp/WhatsAppNumberService';
import { PartitionedFifoQueue, InboundQueueJob } from '../../src/domain/channel/whatsapp/MessageQueue';
import { WhatsAppPolicyAdapter } from '../../src/domain/channel/whatsapp/WhatsAppPolicyAdapter';
import { ChannelRouter } from '../../src/domain/channel/routing/ChannelRouter';
import { MetaCloudTransport } from '../../src/domain/channel/routing/MetaCloudTransport';
import { SecretBox } from '../../src/core/security/SecretBox';

describe('Phase 3B: Merchant Inbox Backend & Human Takeover Integration Tests', () => {
  let store: PortalStore;
  let budget: PortalBudget;
  let auth: PortalAuth;
  let docs: PortalDocuments;
  let connections: PortalConnections;
  let automationService: ConversationAutomationService;
  let outboundQueue: MemoryOutboundQueue;
  let outboundWorker: WhatsAppOutboundWorker;
  let mockOutboundAdapter: any;
  let app: express.Express;

  let testAdminUser: any;
  let testPlan: any;
  const testPassword = 'Password123!';
  let testPasswordHash: string;
  const createdTenantIds: string[] = [];

  beforeAll(async () => {
    const client = await pool.connect();
    try {
      await client.query('SET search_path TO test, public, extensions;');
    } finally {
      client.release();
    }

    store = new PortalStore(prisma as any);
    budget = new PortalBudget(store);
    auth = new PortalAuth(store, { publicUrl: 'http://localhost' });
    docs = new PortalDocuments(store, budget, { ingestPdf: vi.fn(async () => 'doc-id') } as any, { getEffectiveConfig: vi.fn(async () => ({})) } as any);
    connections = new PortalConnections(store, {
      whatsAppOnboardingService: { generateSignupState: () => randomUUID(), processEmbeddedSignupCallback: vi.fn(async () => ({ success: true })) } as any,
      qrSessionManager: { isEnabled: () => false } as any
    });
    automationService = new ConversationAutomationService(prisma);
    outboundQueue = new MemoryOutboundQueue(prisma);

    mockOutboundAdapter = {
      sendTextMessage: vi.fn(async ({ to, text }: { to: string; text: string }) => {
        return {
          success: true,
          providerMessageId: `wamid.test.${randomUUID()}`,
          isRetryable: false
        };
      })
    };
    outboundWorker = new WhatsAppOutboundWorker(outboundQueue, mockOutboundAdapter as any);

    app = express();
    app.use(express.json());
    app.use('/api', createPortalRouter(
      { store, auth, documents: docs, connections },
      {
        prisma,
        conversationAutomationService: automationService,
        whatsAppOutboundQueue: outboundQueue
      }
    ));

    testPasswordHash = await hashPassword(testPassword);
    const adminId = randomUUID();
    await prisma.portalUser.create({
      data: {
        id: adminId,
        email: `admin-${adminId}@test.com`,
        name: 'Super Admin',
        passwordHash: testPasswordHash,
        role: 'ADMIN',
        verifiedAt: new Date()
      }
    });
    testAdminUser = await store.userById(adminId);

    testPlan = await store.savePlan(adminId, validatePlan({
      name: 'Merchant Test Plan',
      published: true,
      modules: ['commerce', 'knowledge', 'services'],
      limits: { monthlyUsd: 10, messages: 1000, llmCalls: 1000, numbers: 5, documents: 10 }
    }));
  }, 60000);

  afterAll(async () => {
    budget?.dispose();
    if (outboundQueue) {
      await outboundQueue.shutdown();
    }
  });

  afterEach(async () => {
    vi.clearAllMocks();
    for (const tenantId of createdTenantIds) {
      try {
        await prisma.whatsAppOutboundJob.deleteMany({ where: { tenantId } });
        await prisma.whatsAppMessageJob.deleteMany({ where: { tenantId } });
        await prisma.message.deleteMany({ where: { tenantId } });
        await prisma.conversationAutomationState.deleteMany({ where: { tenantId } });
        await prisma.conversation.deleteMany({ where: { tenantId } });
        await prisma.channelAuditEvent.deleteMany({ where: { tenantId } });
        await prisma.whatsAppBusinessNumber.deleteMany({ where: { tenantId } });
        await prisma.channelConnection.deleteMany({ where: { tenantId } });
        await prisma.customer.deleteMany({ where: { tenantId } });
        await prisma.portalProfile.deleteMany({ where: { tenantId } });
        await prisma.account.deleteMany({ where: { tenantId } });
        await prisma.portalMembership.deleteMany({ where: { tenantId } });
        await prisma.tenant.deleteMany({ where: { id: tenantId } });
      } catch {}
    }
    createdTenantIds.length = 0;
  });

  async function createMerchantFixture(namePrefix: string) {
    const email = `${namePrefix}-${randomUUID().substring(0, 8)}@merchant.test`;
    const reg = await store.register(email, `${namePrefix} Shop`, testPasswordHash, testPlan.id);
    createdTenantIds.push(reg.tenantId);

    await prisma.portalUser.update({
      where: { id: reg.userId },
      data: { verifiedAt: new Date() }
    });
    const user = await store.userById(reg.userId);

    const phoneNumberId = `phone-${randomUUID().substring(0, 8)}`;
    await prisma.whatsAppBusinessNumber.create({
      data: {
        tenantId: reg.tenantId,
        accountId: reg.accountId,
        phoneNumberId,
        displayPhoneNumber: '+212600112233',
        status: 'CONNECTED',
        enabled: true
      }
    });

    const rawSession = randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '');
    const csrf = randomUUID();
    await store.newSession(user.id, hashToken(rawSession), csrf, new Date(Date.now() + 3600000));
    const authHeaders = {
      Cookie: `relayqo_portal=${rawSession}`,
      'X-CSRF-Token': csrf,
      Origin: 'http://localhost'
    };

    return {
      userId: reg.userId,
      tenantId: reg.tenantId,
      accountId: reg.accountId,
      user,
      phoneNumberId,
      authHeaders
    };
  }

  async function createConversationWithCustomer(
    tenantId: string,
    accountId: string,
    customerWaId: string,
    customerName?: string,
    status = 'ACTIVE'
  ) {
    const customer = await prisma.customer.create({
      data: {
        tenantId,
        externalId: customerWaId,
        metadata: customerName ? { name: customerName } : {}
      }
    });

    const conv = await prisma.conversation.create({
      data: {
        tenantId,
        accountId,
        customerId: customer.id,
        status,
        humanRequested: status === 'HANDOFF_REQUESTED' || status === 'HUMAN_ACTIVE',
        humanRequestedAt: status === 'HANDOFF_REQUESTED' || status === 'HUMAN_ACTIVE' ? new Date() : null,
        messageCount: 0
      }
    });

    return { customer, conversation: conv };
  }

  // ==========================================
  // Group 1: Conversation Listing & Permissions
  // ==========================================
  describe('Group 1: Conversation Listing & Permissions', () => {
    it('1. returns paginated conversations scoped to authenticated merchant', async () => {
      const merchant = await createMerchantFixture('m1');
      await createConversationWithCustomer(merchant.tenantId, merchant.accountId, '212611111111', 'Customer One');
      await createConversationWithCustomer(merchant.tenantId, merchant.accountId, '212622222222', 'Customer Two');

      const res = await request(app)
        .get('/api/client/conversations')
        .set(merchant.authHeaders);

      expect(res.status).toBe(200);
      expect(res.body.conversations).toHaveLength(2);
      expect(res.body.pagination.total).toBe(2);
      expect(res.body.conversations[0].customer.phone).toBeDefined();
    });

    it('2. enforces strict tenant isolation - never exposes conversations from other tenants', async () => {
      const merchantA = await createMerchantFixture('mA');
      const merchantB = await createMerchantFixture('mB');

      await createConversationWithCustomer(merchantA.tenantId, merchantA.accountId, '212600000001', 'Customer A');
      await createConversationWithCustomer(merchantB.tenantId, merchantB.accountId, '212600000002', 'Customer B');

      const resA = await request(app)
        .get('/api/client/conversations')
        .set(merchantA.authHeaders);

      expect(resA.status).toBe(200);
      expect(resA.body.conversations).toHaveLength(1);
      expect(resA.body.conversations[0].customer.phone).toBe('212600000001');

      const resB = await request(app)
        .get('/api/client/conversations')
        .set(merchantB.authHeaders);

      expect(resB.status).toBe(200);
      expect(resB.body.conversations).toHaveLength(1);
      expect(resB.body.conversations[0].customer.phone).toBe('212600000002');
    });

    it('3. rejects unauthenticated requests with 401', async () => {
      const res = await request(app).get('/api/client/conversations');
      expect(res.status).toBe(401);
    });

    it('4. rejects admin role accessing client inbox with 403', async () => {
      const rawSession = randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '');
      const csrf = randomUUID();
      await store.newSession(testAdminUser.id, hashToken(rawSession), csrf, new Date(Date.now() + 3600000));
      const adminHeaders = {
        Cookie: `relayqo_portal=${rawSession}`,
        'X-CSRF-Token': csrf,
        Origin: 'http://localhost'
      };

      const res = await request(app)
        .get('/api/client/conversations')
        .set(adminHeaders);

      expect(res.status).toBe(403);
    });

    it('5. returns conversations in stable order: updatedAt DESC, id DESC', async () => {
      const merchant = await createMerchantFixture('m-order');
      const now = Date.now();

      const { conversation: c1 } = await createConversationWithCustomer(merchant.tenantId, merchant.accountId, '212601');
      await prisma.conversation.update({
        where: { id: c1.id },
        data: { updatedAt: new Date(now - 10000) }
      });

      const { conversation: c2 } = await createConversationWithCustomer(merchant.tenantId, merchant.accountId, '212602');
      await prisma.conversation.update({
        where: { id: c2.id },
        data: { updatedAt: new Date(now - 5000) }
      });

      const { conversation: c3 } = await createConversationWithCustomer(merchant.tenantId, merchant.accountId, '212603');
      await prisma.conversation.update({
        where: { id: c3.id },
        data: { updatedAt: new Date(now) }
      });

      const res = await request(app)
        .get('/api/client/conversations')
        .set(merchant.authHeaders);

      expect(res.status).toBe(200);
      expect(res.body.conversations).toHaveLength(3);
      expect(res.body.conversations[0].id).toBe(c3.id);
      expect(res.body.conversations[1].id).toBe(c2.id);
      expect(res.body.conversations[2].id).toBe(c1.id);
    });

    it('6. respects pagination parameters limit and offset', async () => {
      const merchant = await createMerchantFixture('m-page');
      for (let i = 1; i <= 5; i++) {
        await createConversationWithCustomer(merchant.tenantId, merchant.accountId, `2126000000${i}`);
      }

      const resPage1 = await request(app)
        .get('/api/client/conversations?limit=2&offset=0')
        .set(merchant.authHeaders);

      expect(resPage1.status).toBe(200);
      expect(resPage1.body.conversations).toHaveLength(2);
      expect(resPage1.body.pagination.total).toBe(5);
      expect(resPage1.body.pagination.hasMore).toBe(true);

      const resPage2 = await request(app)
        .get('/api/client/conversations?limit=2&offset=2')
        .set(merchant.authHeaders);

      expect(resPage2.status).toBe(200);
      expect(resPage2.body.conversations).toHaveLength(2);
      expect(resPage2.body.conversations[0].id).not.toBe(resPage1.body.conversations[0].id);
    });
  });

  // ==========================================
  // Group 2: Filters & Search
  // ==========================================
  describe('Group 2: Filters & Search', () => {
    it('7. filter status=open returns AI_ACTIVE, HUMAN_REQUIRED, and HUMAN_ACTIVE but excludes RESOLVED', async () => {
      const m = await createMerchantFixture('m-filt-open');
      const { conversation: cActive } = await createConversationWithCustomer(m.tenantId, m.accountId, '21261', undefined, 'ACTIVE');
      const { conversation: cHandoff } = await createConversationWithCustomer(m.tenantId, m.accountId, '21262', undefined, 'HANDOFF_REQUESTED');
      const { conversation: cHuman } = await createConversationWithCustomer(m.tenantId, m.accountId, '21263', undefined, 'HUMAN_ACTIVE');
      const { conversation: cResolved } = await createConversationWithCustomer(m.tenantId, m.accountId, '21264', undefined, 'RESOLVED');

      const res = await request(app)
        .get('/api/client/conversations?status=open')
        .set(m.authHeaders);

      expect(res.status).toBe(200);
      const ids = res.body.conversations.map((c: any) => c.id);
      expect(ids).toContain(cActive.id);
      expect(ids).toContain(cHandoff.id);
      expect(ids).toContain(cHuman.id);
      expect(ids).not.toContain(cResolved.id);
    });

    it('8. filter status=needs_human returns only HUMAN_REQUIRED', async () => {
      const m = await createMerchantFixture('m-filt-needs');
      const { conversation: cActive } = await createConversationWithCustomer(m.tenantId, m.accountId, '21261', undefined, 'ACTIVE');
      const { conversation: cHandoff } = await createConversationWithCustomer(m.tenantId, m.accountId, '21262', undefined, 'HANDOFF_REQUESTED');

      const res = await request(app)
        .get('/api/client/conversations?status=needs_human')
        .set(m.authHeaders);

      expect(res.status).toBe(200);
      expect(res.body.conversations).toHaveLength(1);
      expect(res.body.conversations[0].id).toBe(cHandoff.id);
      expect(res.body.conversations[0].status).toBe('HUMAN_REQUIRED');
    });

    it('9. filter status=human_active returns only HUMAN_ACTIVE', async () => {
      const m = await createMerchantFixture('m-filt-active');
      await createConversationWithCustomer(m.tenantId, m.accountId, '21261', undefined, 'ACTIVE');
      const { conversation: cHuman } = await createConversationWithCustomer(m.tenantId, m.accountId, '21262', undefined, 'HUMAN_ACTIVE');

      const res = await request(app)
        .get('/api/client/conversations?status=human_active')
        .set(m.authHeaders);

      expect(res.status).toBe(200);
      expect(res.body.conversations).toHaveLength(1);
      expect(res.body.conversations[0].id).toBe(cHuman.id);
      expect(res.body.conversations[0].status).toBe('HUMAN_ACTIVE');
    });

    it('10. filter status=resolved returns only RESOLVED', async () => {
      const m = await createMerchantFixture('m-filt-res');
      await createConversationWithCustomer(m.tenantId, m.accountId, '21261', undefined, 'ACTIVE');
      const { conversation: cRes } = await createConversationWithCustomer(m.tenantId, m.accountId, '21262', undefined, 'RESOLVED');

      const res = await request(app)
        .get('/api/client/conversations?status=resolved')
        .set(m.authHeaders);

      expect(res.status).toBe(200);
      expect(res.body.conversations).toHaveLength(1);
      expect(res.body.conversations[0].id).toBe(cRes.id);
      expect(res.body.conversations[0].status).toBe('RESOLVED');
    });

    it('11. filter unread=true returns only unread conversations', async () => {
      const m = await createMerchantFixture('m-filt-unread');
      const { conversation: cUnread } = await createConversationWithCustomer(m.tenantId, m.accountId, '21261');
      await prisma.message.create({
        data: {
          tenantId: m.tenantId,
          conversationId: cUnread.id,
          role: 'USER',
          content: 'Hello, need help',
          createdAt: new Date()
        }
      });

      const { conversation: cRead } = await createConversationWithCustomer(m.tenantId, m.accountId, '21262');
      await prisma.message.create({
        data: {
          tenantId: m.tenantId,
          conversationId: cRead.id,
          role: 'USER',
          content: 'Already seen',
          createdAt: new Date(Date.now() - 5000)
        }
      });
      await prisma.conversation.update({
        where: { id: cRead.id },
        data: { lastMerchantViewedAt: new Date(Date.now()) }
      });

      const res = await request(app)
        .get('/api/client/conversations?unread=true')
        .set(m.authHeaders);

      expect(res.status).toBe(200);
      expect(res.body.conversations).toHaveLength(1);
      expect(res.body.conversations[0].id).toBe(cUnread.id);
      expect(res.body.conversations[0].isUnread).toBe(true);
    });

    it('12. search query matches customer phone number', async () => {
      const m = await createMerchantFixture('m-search-phone');
      await createConversationWithCustomer(m.tenantId, m.accountId, '212699887766');
      await createConversationWithCustomer(m.tenantId, m.accountId, '212611223344');

      const res = await request(app)
        .get('/api/client/conversations?search=998877')
        .set(m.authHeaders);

      expect(res.status).toBe(200);
      expect(res.body.conversations).toHaveLength(1);
      expect(res.body.conversations[0].customer.phone).toBe('212699887766');
    });

    it('13. search query matches customer name in metadata', async () => {
      const m = await createMerchantFixture('m-search-name');
      await createConversationWithCustomer(m.tenantId, m.accountId, '212600000001', 'Youssef Alami');
      await createConversationWithCustomer(m.tenantId, m.accountId, '212600000002', 'Fatima Zahra');

      const res = await request(app)
        .get('/api/client/conversations?search=Youssef')
        .set(m.authHeaders);

      expect(res.status).toBe(200);
      expect(res.body.conversations).toHaveLength(1);
      expect(res.body.conversations[0].customer.name).toBe('Youssef Alami');
    });
  });

  // ==========================================
  // Group 3: Transcript, Read Status & Customer Service Window
  // ==========================================
  describe('Group 3: Transcript, Read Status & Customer Service Window', () => {
    it('14. returns full conversation transcript in chronological order', async () => {
      const m = await createMerchantFixture('m-transcript');
      const { conversation } = await createConversationWithCustomer(m.tenantId, m.accountId, '212612345678');
      const t0 = Date.now();

      await prisma.message.create({
        data: {
          tenantId: m.tenantId,
          conversationId: conversation.id,
          role: 'USER',
          content: 'First message',
          createdAt: new Date(t0 - 2000)
        }
      });
      await prisma.message.create({
        data: {
          tenantId: m.tenantId,
          conversationId: conversation.id,
          role: 'ASSISTANT',
          content: 'Second message reply',
          createdAt: new Date(t0 - 1000)
        }
      });

      const res = await request(app)
        .get(`/api/client/conversations/${conversation.id}`)
        .set(m.authHeaders);

      expect(res.status).toBe(200);
      expect(res.body.conversation.id).toBe(conversation.id);
      expect(res.body.messages).toHaveLength(2);
      expect(res.body.messages[0].content).toBe('First message');
      expect(res.body.messages[1].content).toBe('Second message reply');
    });

    it('15. returns 404 for unknown conversation or cross-tenant conversation', async () => {
      const mA = await createMerchantFixture('m-cross-a');
      const mB = await createMerchantFixture('m-cross-b');
      const { conversation: cB } = await createConversationWithCustomer(mB.tenantId, mB.accountId, '212699999999');

      const resUnknown = await request(app)
        .get(`/api/client/conversations/${randomUUID()}`)
        .set(mA.authHeaders);
      expect(resUnknown.status).toBe(404);

      const resCross = await request(app)
        .get(`/api/client/conversations/${cB.id}`)
        .set(mA.authHeaders);
      expect(resCross.status).toBe(404);
    });

    it('16. automatically marks conversation as viewed, turning unread to false', async () => {
      const m = await createMerchantFixture('m-auto-read');
      const { conversation } = await createConversationWithCustomer(m.tenantId, m.accountId, '212655555555');

      await prisma.message.create({
        data: {
          tenantId: m.tenantId,
          conversationId: conversation.id,
          role: 'USER',
          content: 'Inbound message',
          createdAt: new Date()
        }
      });

      const listBefore = await request(app)
        .get('/api/client/conversations?unread=true')
        .set(m.authHeaders);
      expect(listBefore.body.conversations).toHaveLength(1);

      const detail = await request(app)
        .get(`/api/client/conversations/${conversation.id}`)
        .set(m.authHeaders);
      expect(detail.status).toBe(200);

      const listAfter = await request(app)
        .get('/api/client/conversations?unread=true')
        .set(m.authHeaders);
      expect(listAfter.body.conversations).toHaveLength(0);
    });

    it('17. explicit POST /read updates lastMerchantViewedAt', async () => {
      const m = await createMerchantFixture('m-explicit-read');
      const { conversation } = await createConversationWithCustomer(m.tenantId, m.accountId, '212655555555');

      const res = await request(app)
        .post(`/api/client/conversations/${conversation.id}/read`)
        .set(m.authHeaders);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.lastMerchantViewedAt).toBeDefined();

      const updated = await prisma.conversation.findUnique({ where: { id: conversation.id } });
      expect(updated?.lastMerchantViewedAt).not.toBeNull();
    });

    it('18. evaluates 24-hour Customer Service Window (open, expired, or absent)', async () => {
      const m = await createMerchantFixture('m-csw');

      // Case A: Recent user message (< 24h)
      const { conversation: cOpen } = await createConversationWithCustomer(m.tenantId, m.accountId, '212601');
      await prisma.message.create({
        data: {
          tenantId: m.tenantId,
          conversationId: cOpen.id,
          role: 'USER',
          content: 'Recent inquiry',
          createdAt: new Date(Date.now() - 3600000) // 1 hour ago
        }
      });
      const resOpen = await request(app)
        .get(`/api/client/conversations/${cOpen.id}`)
        .set(m.authHeaders);
      expect(resOpen.body.conversation.customerServiceWindow.canSendFreeform).toBe(true);
      expect(resOpen.body.conversation.customerServiceWindow.secondsRemaining).toBeGreaterThan(80000);

      // Case B: Expired user message (> 24h)
      const { conversation: cExpired } = await createConversationWithCustomer(m.tenantId, m.accountId, '212602');
      await prisma.message.create({
        data: {
          tenantId: m.tenantId,
          conversationId: cExpired.id,
          role: 'USER',
          content: 'Old inquiry',
          createdAt: new Date(Date.now() - 25 * 3600000) // 25 hours ago
        }
      });
      const resExpired = await request(app)
        .get(`/api/client/conversations/${cExpired.id}`)
        .set(m.authHeaders);
      expect(resExpired.body.conversation.customerServiceWindow.canSendFreeform).toBe(false);
      expect(resExpired.body.conversation.customerServiceWindow.secondsRemaining).toBe(0);

      // Case C: No user messages
      const { conversation: cNone } = await createConversationWithCustomer(m.tenantId, m.accountId, '212603');
      const resNone = await request(app)
        .get(`/api/client/conversations/${cNone.id}`)
        .set(m.authHeaders);
      expect(resNone.body.conversation.customerServiceWindow.canSendFreeform).toBe(false);
      expect(resNone.body.conversation.customerServiceWindow.expiresAt).toBeNull();
    });
  });

  // ==========================================
  // Group 4: Human Takeover Lifecycle & Transitions
  // ==========================================
  describe('Group 4: Human Takeover Lifecycle & Transitions', () => {
    it('19. POST /takeover transitions to HUMAN_ACTIVE, updates automation state, and records audit event', async () => {
      const m = await createMerchantFixture('m-takeover');
      const { conversation } = await createConversationWithCustomer(m.tenantId, m.accountId, '212677777777');

      const res = await request(app)
        .post(`/api/client/conversations/${conversation.id}/takeover`)
        .set(m.authHeaders);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.conversation.status).toBe('HUMAN_ACTIVE');

      const autoState = await prisma.conversationAutomationState.findUnique({
        where: { conversationId: conversation.id }
      });
      expect(autoState?.humanTakeover).toBe(true);
      expect(autoState?.botEnabled).toBe(false);

      const audit = await prisma.channelAuditEvent.findFirst({
        where: { conversationId: conversation.id, action: 'HUMAN_TAKEOVER_ACTIVATED' }
      });
      expect(audit).not.toBeNull();
      expect(audit?.actorId).toBe(m.userId);
    });

    it('20. POST /resolve transitions to RESOLVED, resets takeover flag, and records audit event', async () => {
      const m = await createMerchantFixture('m-resolve');
      const { conversation } = await createConversationWithCustomer(m.tenantId, m.accountId, '212677777777', undefined, 'HUMAN_ACTIVE');

      const res = await request(app)
        .post(`/api/client/conversations/${conversation.id}/resolve`)
        .set(m.authHeaders);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.conversation.status).toBe('RESOLVED');

      const autoState = await prisma.conversationAutomationState.findUnique({
        where: { conversationId: conversation.id }
      });
      expect(autoState?.humanTakeover).toBe(false);

      const audit = await prisma.channelAuditEvent.findFirst({
        where: { conversationId: conversation.id, action: 'HANDOFF_RESOLVED' }
      });
      expect(audit).not.toBeNull();
    });

    it('21. POST /reopen transitions to AI_ACTIVE and records audit event', async () => {
      const m = await createMerchantFixture('m-reopen');
      const { conversation } = await createConversationWithCustomer(m.tenantId, m.accountId, '212677777777', undefined, 'RESOLVED');

      const res = await request(app)
        .post(`/api/client/conversations/${conversation.id}/reopen`)
        .set(m.authHeaders);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.conversation.status).toBe('AI_ACTIVE');

      const updated = await prisma.conversation.findUnique({ where: { id: conversation.id } });
      expect(updated?.status).toBe('ACTIVE');
      expect(updated?.humanRequested).toBe(false);
    });

    it('22. state transitions are idempotent', { timeout: 30000 }, async () => {
      const m = await createMerchantFixture('m-idempotent');
      const { conversation } = await createConversationWithCustomer(m.tenantId, m.accountId, '212677777777');

      // Double takeover
      const t1 = await request(app).post(`/api/client/conversations/${conversation.id}/takeover`).set(m.authHeaders);
      expect(t1.status).toBe(200);
      const t2 = await request(app).post(`/api/client/conversations/${conversation.id}/takeover`).set(m.authHeaders);
      expect(t2.status).toBe(200);

      // Double resolve
      const r1 = await request(app).post(`/api/client/conversations/${conversation.id}/resolve`).set(m.authHeaders);
      expect(r1.status).toBe(200);
      const r2 = await request(app).post(`/api/client/conversations/${conversation.id}/resolve`).set(m.authHeaders);
      expect(r2.status).toBe(200);

      // Double reopen
      const o1 = await request(app).post(`/api/client/conversations/${conversation.id}/reopen`).set(m.authHeaders);
      expect(o1.status).toBe(200);
      const o2 = await request(app).post(`/api/client/conversations/${conversation.id}/reopen`).set(m.authHeaders);
      expect(o2.status).toBe(200);
    });
  });

  // ==========================================
  // Group 5: Manual Merchant Messaging & Outbound Queue
  // ==========================================
  describe('Group 5: Manual Merchant Messaging & Outbound Queue', () => {
    it('23. rejects manual message with 409 if conversation is not claimed', async () => {
      const m = await createMerchantFixture('m-unclaimed');
      const { conversation } = await createConversationWithCustomer(m.tenantId, m.accountId, '212688888888', undefined, 'ACTIVE');

      // Add recent message to satisfy customer service window
      await prisma.message.create({
        data: {
          tenantId: m.tenantId,
          conversationId: conversation.id,
          role: 'USER',
          content: 'Hello',
          createdAt: new Date()
        }
      });

      const res = await request(app)
        .post(`/api/client/conversations/${conversation.id}/messages`)
        .set(m.authHeaders)
        .send({ text: 'Trying to reply without takeover' });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('HUMAN_TAKEOVER_REQUIRED');
    });

    it('24. rejects manual message with 400 if 24-hour Customer Service Window has expired', async () => {
      const m = await createMerchantFixture('m-csw-expired');
      const { conversation } = await createConversationWithCustomer(m.tenantId, m.accountId, '212688888888', undefined, 'HUMAN_ACTIVE');

      // User message older than 24 hours
      await prisma.message.create({
        data: {
          tenantId: m.tenantId,
          conversationId: conversation.id,
          role: 'USER',
          content: 'Old message',
          createdAt: new Date(Date.now() - 25 * 3600000)
        }
      });

      const res = await request(app)
        .post(`/api/client/conversations/${conversation.id}/messages`)
        .set(m.authHeaders)
        .send({ text: 'Trying to send after 24h' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('CUSTOMER_SERVICE_WINDOW_EXPIRED');
    });

    it('25. enqueues outbound message with deduplication, and worker delivers via WhatsApp adapter', async () => {
      const m = await createMerchantFixture('m-send-success');
      const { conversation } = await createConversationWithCustomer(m.tenantId, m.accountId, '212688888888', undefined, 'HUMAN_ACTIVE');

      // Valid recent user message
      await prisma.message.create({
        data: {
          tenantId: m.tenantId,
          conversationId: conversation.id,
          role: 'USER',
          content: 'Need assistance please',
          createdAt: new Date()
        }
      });

      const idemKey = `key-${randomUUID()}`;
      const res = await request(app)
        .post(`/api/client/conversations/${conversation.id}/messages`)
        .set(m.authHeaders)
        .set('Idempotency-Key', idemKey)
        .send({ text: 'Hello, this is human support!' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.message.role).toBe('ASSISTANT');
      expect(res.body.message.status).toBe('PENDING');

      // Wait brief moment for in-memory worker to dispatch
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockOutboundAdapter.sendTextMessage).toHaveBeenCalledTimes(1);
      expect(mockOutboundAdapter.sendTextMessage).toHaveBeenCalledWith(expect.objectContaining({
        to: '212688888888',
        text: 'Hello, this is human support!'
      }));

      // Verify Message deliveryStatus updated to SENT in database
      const savedMsg = await prisma.message.findUnique({
        where: { id: res.body.message.id }
      });
      expect(savedMsg).not.toBeNull();
      expect((savedMsg?.metadata as any)?.deliveryStatus).toBe('SENT');
      expect(savedMsg?.externalId).toBeDefined();

      // Duplicate request with same Idempotency-Key
      const resDup = await request(app)
        .post(`/api/client/conversations/${conversation.id}/messages`)
        .set(m.authHeaders)
        .set('Idempotency-Key', idemKey)
        .send({ text: 'Hello, this is human support!' });

      expect(resDup.status).toBe(201);
      // Adapter should not be called again because dedupe dropped second job
      expect(mockOutboundAdapter.sendTextMessage).toHaveBeenCalledTimes(1);
    });
  });

  // ==========================================
  // Group 6: AI Suppression & Race A Simulation
  // ==========================================
  describe('Group 6: AI Suppression & Race A Simulation', () => {
    it('26. [CRITICAL RACE A] Suppresses AI delivery at Gate 2 when human takeover occurs during active LLM generation', async () => {
      const m = await createMerchantFixture('m-race-a');
      const customerWaId = '212699991111';
      const { conversation } = await createConversationWithCustomer(m.tenantId, m.accountId, customerWaId, 'Customer Race', 'ACTIVE');

      const numberService = new WhatsAppNumberService(prisma);
      const secretBox = new SecretBox({ key: 'test-encryption-key-32-bytes-long!' });
      const outboundAdapter = new WhatsAppOutboundAdapter({ numberService, secretBox });
      const policyAdapter = new WhatsAppPolicyAdapter();
      const safetyGuard = new ClientSafetyGuard(prisma, numberService, {}, automationService);
      const messageQueue = new PartitionedFifoQueue<InboundQueueJob>();

      // Track outbound delivery attempts
      let outboundCallsCount = 0;
      const mockMetaTransport = {
        send: vi.fn(async () => {
          outboundCallsCount++;
          return { success: true, providerMessageId: `wamid.race.${Date.now()}` };
        }),
        downloadInboundImage: vi.fn(),
        supportsTransport: () => true
      };

      const channelRouter = new ChannelRouter(numberService, [mockMetaTransport as any]);

      // Mock ConversationEngine where handleMessage is delayed, simulating slow LLM turn
      let takeoverOccurred = false;
      const delayedConversationEngine: any = {
        handleMessage: vi.fn(async () => {
          // While "generating" the LLM response, human takeover occurs!
          await automationService.takeover({
            tenantId: m.tenantId,
            conversationId: conversation.id,
            accountId: m.accountId,
            actorId: m.userId
          });
          takeoverOccurred = true;

          // Simulate completion of LLM generation
          return 'AI generated response that MUST be suppressed by Gate 2!';
        })
      };

      const worker = new WhatsAppWorker(
        messageQueue,
        delayedConversationEngine,
        outboundAdapter,
        numberService,
        policyAdapter,
        channelRouter,
        safetyGuard
      );

      // Enqueue inbound user message to trigger worker
      const inboundJob: InboundQueueJob = {
        id: randomUUID(),
        tenantId: m.tenantId,
        accountId: m.accountId,
        phoneNumberId: m.phoneNumberId,
        waId: customerWaId,
        wamid: `wamid.user.${Date.now()}`,
        message: 'Hello bot',
        timestamp: Date.now(),
        enqueuedAt: Date.now(),
        attempts: 0
      };

      // Process the job through the worker
      const processResult = await worker.processJob(inboundJob);

      // Verify that takeover successfully committed during the turn
      expect(takeoverOccurred).toBe(true);

      const convFinal = await prisma.conversation.findUnique({ where: { id: conversation.id } });
      expect(convFinal?.status).toBe('HUMAN_ACTIVE');

      // Gate 2 should have intercepted the LLM output and suppressed outbound delivery
      expect(processResult.outboundResult?.success).toBe(false);
      expect(processResult.outboundResult?.error).toMatch(/Human takeover|Blocked by post-LLM Client Safety Guard/);

      // Invariant: ZERO messages sent to Meta Cloud API!
      expect(outboundCallsCount).toBe(0);
      expect(mockMetaTransport.send).not.toHaveBeenCalled();
    });
  });
});
