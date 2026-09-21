import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { randomUUID, createHash, createHmac } from 'crypto';
import { prisma, pool } from '../../src/tests/testDb';
import { PortalStore } from '../../src/portal/PortalStore';
import { hashPassword } from '../../src/portal/PortalAuth';
import { validatePlan } from '../../src/portal/validation';
import {
  canTransitionDeliveryStatus,
  ALLOWED_DELIVERY_TRANSITIONS
} from '../../src/domain/channel/whatsapp/WhatsAppDeliveryStateMachine';
import { classifyMetaError } from '../../src/domain/channel/whatsapp/WhatsAppErrorClassification';
import { WhatsAppOutboundAdapter } from '../../src/domain/channel/whatsapp/WhatsAppOutboundAdapter';
import {
  PostgresOutboundQueue,
  MemoryOutboundQueue,
  WhatsAppOutboundWorker
} from '../../src/domain/channel/whatsapp/WhatsAppOutboundQueue';
import { WhatsAppDeliveryReceiptProcessor } from '../../src/domain/channel/whatsapp/WhatsAppDeliveryReceiptProcessor';
import { ConversationService } from '../../src/domain/conversation/ConversationService';
import { createWhatsAppWebhookRouter } from '../../src/domain/channel/whatsapp/WhatsAppWebhookRouter';
import { extractStatuses } from '../../src/domain/channel/whatsapp/WhatsAppWebhookExtractor';
import { WhatsAppNumberService } from '../../src/domain/channel/whatsapp/WhatsAppNumberService';

describe('Phase 4B: WhatsApp Delivery Reliability Integration Tests', () => {
  let store: PortalStore;
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
      name: 'Reliability Test Plan',
      published: true,
      modules: ['commerce', 'knowledge', 'services'],
      limits: { monthlyUsd: 10, messages: 1000, llmCalls: 1000, numbers: 5, documents: 10 }
    }));
  }, 60000);

  afterAll(async () => {
    try {
      if (testAdminUser) {
        await prisma.portalUser.delete({ where: { id: testAdminUser.id } }).catch(() => {});
      }
      if (testPlan) {
        await prisma.portalPlan.delete({ where: { id: testPlan.id } }).catch(() => {});
      }
    } catch {}
  });

  afterEach(async () => {
    vi.clearAllMocks();
    for (const tenantId of createdTenantIds) {
      try {
        await prisma.whatsAppDeliveryReceipt.deleteMany({ where: { tenantId } });
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

  async function createFixture(namePrefix: string) {
    const email = `${namePrefix}-${randomUUID().substring(0, 8)}@test.com`;
    const reg = await store.register(email, `${namePrefix} Co`, testPasswordHash, testPlan.id);
    createdTenantIds.push(reg.tenantId);

    const customer = await prisma.customer.create({
      data: {
        tenantId: reg.tenantId,
        externalId: `+1555${Math.floor(1000000 + Math.random() * 9000000)}`,
        metadata: { name: 'Test Customer' }
      }
    });

    const conversation = await prisma.conversation.create({
      data: {
        tenantId: reg.tenantId,
        accountId: reg.accountId,
        customerId: customer.id,
        status: 'HUMAN_ACTIVE'
      }
    });

    return {
      tenantId: reg.tenantId,
      accountId: reg.accountId,
      customer,
      conversation
    };
  }

  describe('Directive 1: Explicit Delivery State Machine & Monotonic Transitions', () => {
    it('allows valid progressive transitions', () => {
      expect(canTransitionDeliveryStatus('PENDING', 'SENT')).toBe(true);
      expect(canTransitionDeliveryStatus('PENDING', 'DELIVERED')).toBe(true);
      expect(canTransitionDeliveryStatus('PENDING', 'READ')).toBe(true);
      expect(canTransitionDeliveryStatus('PENDING', 'FAILED')).toBe(true);

      expect(canTransitionDeliveryStatus('SENT', 'DELIVERED')).toBe(true);
      expect(canTransitionDeliveryStatus('SENT', 'READ')).toBe(true);
      expect(canTransitionDeliveryStatus('SENT', 'FAILED')).toBe(true);

      expect(canTransitionDeliveryStatus('DELIVERED', 'READ')).toBe(true);
      expect(canTransitionDeliveryStatus('DELIVERED', 'DELIVERED')).toBe(false);
      expect(canTransitionDeliveryStatus('READ', 'READ')).toBe(false);
    });

    it('strictly forbids DELIVERED -> FAILED transition (Directive 1)', () => {
      expect(canTransitionDeliveryStatus('DELIVERED', 'FAILED')).toBe(false);
      expect(ALLOWED_DELIVERY_TRANSITIONS['DELIVERED'].has('FAILED')).toBe(false);
    });

    it('strictly forbids READ -> FAILED transition (Directive 1)', () => {
      expect(canTransitionDeliveryStatus('READ', 'FAILED')).toBe(false);
      expect(ALLOWED_DELIVERY_TRANSITIONS['READ'].has('FAILED')).toBe(false);
    });

    it('forbids status regressions from READ to earlier statuses', () => {
      expect(canTransitionDeliveryStatus('READ', 'DELIVERED')).toBe(false);
      expect(canTransitionDeliveryStatus('READ', 'SENT')).toBe(false);
      expect(canTransitionDeliveryStatus('READ', 'PENDING')).toBe(false);
    });

    it('treats FAILED as a terminal status with no outbound transitions', () => {
      expect(canTransitionDeliveryStatus('FAILED', 'SENT')).toBe(false);
      expect(canTransitionDeliveryStatus('FAILED', 'DELIVERED')).toBe(false);
      expect(canTransitionDeliveryStatus('FAILED', 'READ')).toBe(false);
      expect(canTransitionDeliveryStatus('FAILED', 'PENDING')).toBe(false);
      expect(ALLOWED_DELIVERY_TRANSITIONS['FAILED'].size).toBe(0);
    });
  });

  describe('Directive 3: Verified Meta Cloud API Error Codes', () => {
    it('classifies 130429 (throughput rate limit) as retryable', () => {
      const result = classifyMetaError(130429, 429, 'Rate limit hit');
      expect(result.isRetryable).toBe(true);
      expect(result.errorCode).toBe(130429);
    });

    it('classifies 131000 (generic transient "Something went wrong") as retryable', () => {
      const result = classifyMetaError(131000, 500, 'Something went wrong');
      expect(result.isRetryable).toBe(true);
      expect(result.errorCode).toBe(131000);
    });

    it('classifies 131056 (pair rate limit) as non-retryable (Meta: do not retry immediately)', () => {
      const result = classifyMetaError(131056, 400, 'Too many messages to pair');
      expect(result.isRetryable).toBe(false);
      expect(result.errorCode).toBe(131056);
    });

    it('classifies 131026 (message undeliverable) as non-retryable', () => {
      const result = classifyMetaError(131026, 400, 'Message undeliverable');
      expect(result.isRetryable).toBe(false);
      expect(result.errorCode).toBe(131026);
    });

    it('classifies 131047 (re-engagement / CSW window expired) as non-retryable', () => {
      const result = classifyMetaError(131047, 400, 'Re-engagement required');
      expect(result.isRetryable).toBe(false);
      expect(result.errorCode).toBe(131047);
    });

    it('classifies transient HTTP 429 and 503 without Meta subcode as retryable', () => {
      expect(classifyMetaError(undefined, 429).isRetryable).toBe(true);
      expect(classifyMetaError(undefined, 503).isRetryable).toBe(true);
      expect(classifyMetaError(undefined, 500).isRetryable).toBe(true);
    });

    it('classifies client HTTP 400 and 401 without Meta subcode as non-retryable', () => {
      expect(classifyMetaError(undefined, 400).isRetryable).toBe(false);
      expect(classifyMetaError(undefined, 401).isRetryable).toBe(false);
    });
  });

  describe('Directive 2: Conservative DELIVERY_UNKNOWN & Ambiguous Outbound Handling', () => {
    it('returns DELIVERY_UNKNOWN and isRetryable=false on network fetch timeout', async () => {
      const timeoutFetch = vi.fn().mockImplementation(async () => {
        throw new Error('The operation was aborted due to timeout');
      });
      const adapter = new WhatsAppOutboundAdapter({
        fetchFn: timeoutFetch,
        maxRetries: 3
      });

      const result = await adapter.sendTextMessage({
        phoneNumberId: '123456789',
        to: '+15551234567',
        text: 'Hello test',
        accessToken: 'valid-test-token'
      });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('DELIVERY_UNKNOWN');
      expect(result.isRetryable).toBe(false);
      expect(timeoutFetch).toHaveBeenCalledTimes(1); // Did not blindly hammer provider
    });

    it('does not re-queue or auto-resend DELIVERY_UNKNOWN jobs in PostgresOutboundQueue', async () => {
      const { tenantId, accountId, conversation } = await createFixture('del-unknown');

      const message = await prisma.message.create({
        data: {
          tenantId,
          conversationId: conversation.id,
          role: 'ASSISTANT',
          content: 'Hello merchant reply',
          metadata: { manual: true, deliveryStatus: 'PENDING' }
        }
      });

      const queue = new PostgresOutboundQueue(prisma, { disableWorker: true });

      const { job } = await queue.enqueue({
        dedupeKey: `outbound-${message.id}`,
        tenantId,
        accountId,
        conversationId: conversation.id,
        messageId: message.id,
        phoneNumberId: '123456789',
        recipientWaId: '+15551234567',
        text: 'Hello merchant reply'
      });

      // Claim the job
      const claimed = await queue.claimNextJob();
      expect(claimed?.id).toBe(job.id);

      // Fail with DELIVERY_UNKNOWN
      await queue.failJob(job.id, 'Delivery outcome unknown; reconcile before retry.', false, 'DELIVERY_UNKNOWN');

      // Verify job record is marked FAILED, not left PENDING
      const dbJob = await prisma.whatsAppOutboundJob.findUnique({ where: { id: job.id } });
      expect(dbJob?.status).toBe('FAILED');
      expect(dbJob?.lockedAt).toBeNull();

      // Verify Message metadata is marked DELIVERY_UNKNOWN
      const updatedMsg = await prisma.message.findUnique({ where: { id: message.id } });
      expect((updatedMsg?.metadata as any)?.deliveryStatus).toBe('DELIVERY_UNKNOWN');
      expect((updatedMsg?.metadata as any)?.errorCode).toBe('DELIVERY_UNKNOWN');

      // Verify audit event logged
      const audit = await prisma.channelAuditEvent.findFirst({
        where: { tenantId, action: 'HUMAN_MESSAGE_DELIVERY_UNKNOWN' }
      });
      expect(audit).toBeDefined();

      // Verify claimNextJob does NOT re-claim the job
      const nextClaim = await queue.claimNextJob();
      expect(nextClaim).toBeNull();

      await queue.shutdown();
    });
  });

  describe('Webhook Status Ingestion, Deduplication, & Ingress Separation', () => {
    it('extracts status updates correctly from Meta webhook payload', () => {
      const payload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'WHATSAPP_BUSINESS_ACCOUNT_ID',
            changes: [
              {
                value: {
                  messaging_product: 'whatsapp',
                  metadata: {
                    display_phone_number: '15551234567',
                    phone_number_id: '99887766'
                  },
                  statuses: [
                    {
                      id: 'wamid.HBgLMTIzNDU2Nzg5MA==',
                      status: 'delivered',
                      timestamp: '1710000000',
                      recipient_id: '15557654321',
                      conversation: {
                        id: 'conv_123',
                        expiration_timestamp: '1710086400'
                      }
                    }
                  ]
                },
                field: 'messages'
              }
            ]
          }
        ]
      };

      const extracted = extractStatuses(payload);
      expect(extracted).toHaveLength(1);
      expect(extracted[0].wamid).toBe('wamid.HBgLMTIzNDU2Nzg5MA==');
      expect(extracted[0].status).toBe('delivered');
      expect(extracted[0].recipientWaId).toBe('15557654321');
      expect(extracted[0].phoneNumberId).toBe('99887766');
    });

    it('ingests status webhooks, creates WhatsAppDeliveryReceipt, and deduplicates identical webhooks', async () => {
      const { tenantId, accountId } = await createFixture('webhook-ingest');

      // Create connected number mapping
      await prisma.whatsAppBusinessNumber.create({
        data: {
          tenantId,
          accountId,
          phoneNumberId: 'phone-test-999',
          displayPhoneNumber: '+15559990000',
          status: 'CONNECTED',
          enabled: true
        }
      });

      const numberService = new WhatsAppNumberService(prisma);
      const appSecret = 'test-secret-webhook-key';
      const webhookRouter = createWhatsAppWebhookRouter(
        numberService,
        {
          prisma,
          appSecret,
          verifyToken: 'test-token'
        }
      );

      const app = express();
      app.use(express.json({
        verify: (req, _res, buf) => {
          (req as any).rawBody = buf;
        }
      }));
      app.use('/webhook/whatsapp', webhookRouter);

      const statusPayload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'wba-1',
            changes: [
              {
                value: {
                  messaging_product: 'whatsapp',
                  metadata: {
                    display_phone_number: '15559990000',
                    phone_number_id: 'phone-test-999'
                  },
                  statuses: [
                    {
                      id: 'wamid.status.ingest.001',
                      status: 'delivered',
                      timestamp: '1710000000',
                      recipient_id: '15550001111'
                    }
                  ]
                },
                field: 'messages'
              }
            ]
          }
        ]
      };

      const rawPayload = JSON.stringify(statusPayload);
      const signature = 'sha256=' + createHmac('sha256', appSecret).update(rawPayload).digest('hex');

      // 1. First webhook post
      const res1 = await request(app)
        .post('/webhook/whatsapp')
        .set('x-hub-signature-256', signature)
        .set('Content-Type', 'application/json')
        .send(rawPayload);
      expect(res1.status).toBe(200);

      // Verify row persisted in WhatsAppDeliveryReceipt
      const receipts1 = await prisma.whatsAppDeliveryReceipt.findMany({
        where: { tenantId, providerMessageId: 'wamid.status.ingest.001' }
      });
      expect(receipts1).toHaveLength(1);
      expect(receipts1[0].status).toBe('DELIVERED');
      expect(receipts1[0].correlated).toBe(false);

      // 2. Duplicate webhook post (Meta replay)
      const res2 = await request(app)
        .post('/webhook/whatsapp')
        .set('x-hub-signature-256', signature)
        .set('Content-Type', 'application/json')
        .send(rawPayload);
      expect(res2.status).toBe(200);

      // Verify deduplication: still exactly 1 receipt row in DB
      const receipts2 = await prisma.whatsAppDeliveryReceipt.findMany({
        where: { tenantId, providerMessageId: 'wamid.status.ingest.001' }
      });
      expect(receipts2).toHaveLength(1);
    });
  });

  describe('Race Condition 1: Early Delivery Webhook Arrives Before Message DB Commit', () => {
    it('reconciles early delivery receipts once completeJob records the providerMessageId', async () => {
      const { tenantId, accountId, conversation } = await createFixture('race-1');
      const providerMessageId = `wamid.race1.${randomUUID()}`;

      // 1. Webhook arrives FIRST: Store delivery receipt before Message exists with this externalId
      const dedupeKey = createHash('sha256').update(`${tenantId}:${providerMessageId}:DELIVERED:1710000000`).digest('hex');
      await prisma.whatsAppDeliveryReceipt.create({
        data: {
          dedupeKey,
          tenantId,
          accountId,
          phoneNumberId: '123456789',
          providerMessageId,
          recipientWaId: '+15551234567',
          status: 'DELIVERED',
          providerTimestamp: new Date(),
          correlated: false
        }
      });

      // 2. Message created in PENDING status
      const message = await prisma.message.create({
        data: {
          tenantId,
          conversationId: conversation.id,
          role: 'ASSISTANT',
          content: 'Race 1 message',
          metadata: { manual: true, deliveryStatus: 'PENDING' }
        }
      });

      // 3. Complete the outbound job
      const queue = new PostgresOutboundQueue(prisma, { disableWorker: true });
      const { job } = await queue.enqueue({
        dedupeKey: `job-${message.id}`,
        tenantId,
        accountId,
        conversationId: conversation.id,
        messageId: message.id,
        phoneNumberId: '123456789',
        recipientWaId: '+15551234567',
        text: 'Race 1 message'
      });

      await queue.completeJob(job.id, providerMessageId);

      // 4. Verify reconciliation: Message should have transitioned from SENT to DELIVERED
      const updatedMsg = await prisma.message.findUnique({ where: { id: message.id } });
      expect(updatedMsg?.externalId).toBe(providerMessageId);
      expect((updatedMsg?.metadata as any)?.deliveryStatus).toBe('DELIVERED');

      // Verify delivery receipt marked correlated
      const updatedReceipt = await prisma.whatsAppDeliveryReceipt.findUnique({ where: { dedupeKey } });
      expect(updatedReceipt?.correlated).toBe(true);

      await queue.shutdown();
    });

    it('reconciles early delivery receipts when AI message is recorded with providerMessageId', async () => {
      const { tenantId, accountId, customer, conversation } = await createFixture('ai-race');
      const inboundWamid = `wamid.inbound.${randomUUID()}`;
      const assistantProviderId = `wamid.ai.${randomUUID()}`;

      // 1. Pre-insert early READ delivery receipt for AI message
      const dedupeKey = createHash('sha256').update(`${tenantId}:${assistantProviderId}:READ:1710000010`).digest('hex');
      await prisma.whatsAppDeliveryReceipt.create({
        data: {
          dedupeKey,
          tenantId,
          accountId,
          phoneNumberId: 'phone-test-999',
          providerMessageId: assistantProviderId,
          recipientWaId: customer.externalId,
          status: 'READ',
          providerTimestamp: new Date(),
          correlated: false
        }
      });

      // 2. AI engine creates assistant message turn
      await prisma.message.create({
        data: {
          tenantId,
          conversationId: conversation.id,
          role: 'ASSISTANT',
          content: 'AI auto reply',
          metadata: {
            externalMessageId: inboundWamid,
            deliveryStatus: 'PENDING'
          }
        }
      });

      // 3. ConversationService updates message with providerMessageId
      const convService = new ConversationService(prisma);
      const updated = await convService.updateOutboundAssistantMessage({
        tenantId,
        inboundExternalId: inboundWamid,
        providerMessageId: assistantProviderId,
        deliveryStatus: 'SENT'
      });

      expect(updated).not.toBeNull();
      expect(updated?.externalId).toBe(assistantProviderId);

      // Verify the early READ receipt was reconciled onto the message
      const checkMsg = await prisma.message.findUnique({ where: { id: updated!.id } });
      expect((checkMsg?.metadata as any)?.deliveryStatus).toBe('READ');

      // Verify receipt correlated
      const receipt = await prisma.whatsAppDeliveryReceipt.findUnique({ where: { dedupeKey } });
      expect(receipt?.correlated).toBe(true);
    });
  });

  describe('Race Condition 2: Out-of-Order Delivery Receipts', () => {
    it('does not regress status when DELIVERED arrives after READ', async () => {
      const { tenantId, conversation } = await createFixture('order-race');
      const providerMessageId = `wamid.order.${randomUUID()}`;

      const message = await prisma.message.create({
        data: {
          tenantId,
          conversationId: conversation.id,
          role: 'ASSISTANT',
          content: 'Order race message',
          externalId: providerMessageId,
          metadata: { manual: true, deliveryStatus: 'SENT' }
        }
      });

      const processor = new WhatsAppDeliveryReceiptProcessor(prisma);

      // 1. READ arrives first
      await processor.applyReceipt({
        tenantId,
        providerMessageId,
        status: 'READ',
        providerTimestamp: new Date()
      });

      let checkMsg = await prisma.message.findUnique({ where: { id: message.id } });
      expect((checkMsg?.metadata as any)?.deliveryStatus).toBe('READ');

      // 2. DELIVERED arrives second (out of order network delivery)
      await processor.applyReceipt({
        tenantId,
        providerMessageId,
        status: 'DELIVERED',
        providerTimestamp: new Date(Date.now() - 5000)
      });

      checkMsg = await prisma.message.findUnique({ where: { id: message.id } });
      expect((checkMsg?.metadata as any)?.deliveryStatus).toBe('READ'); // Remains READ!
    });

    it('does not mark message FAILED if a delayed failure webhook arrives after DELIVERED or READ', async () => {
      const { tenantId, conversation } = await createFixture('order-fail');
      const providerMessageId = `wamid.orderfail.${randomUUID()}`;

      const message = await prisma.message.create({
        data: {
          tenantId,
          conversationId: conversation.id,
          role: 'ASSISTANT',
          content: 'Order fail message',
          externalId: providerMessageId,
          metadata: { manual: true, deliveryStatus: 'DELIVERED' }
        }
      });

      const processor = new WhatsAppDeliveryReceiptProcessor(prisma);

      // Delayed FAILED arrives after DELIVERED
      await processor.applyReceipt({
        tenantId,
        providerMessageId,
        status: 'FAILED',
        errorCode: 131026,
        errorMessage: 'Delayed error',
        providerTimestamp: new Date()
      });

      const checkMsg = await prisma.message.findUnique({ where: { id: message.id } });
      expect((checkMsg?.metadata as any)?.deliveryStatus).toBe('DELIVERED'); // Must NOT become FAILED!
    });
  });

  describe('Tenant Isolation', () => {
    it('does not allow receipts from Tenant A to correlate or mutate messages in Tenant B', async () => {
      const tenantA = await createFixture('tenant-a');
      const tenantB = await createFixture('tenant-b');
      const sharedProviderId = `wamid.shared.${randomUUID()}`;

      // Message in Tenant B
      const messageB = await prisma.message.create({
        data: {
          tenantId: tenantB.tenantId,
          conversationId: tenantB.conversation.id,
          role: 'ASSISTANT',
          content: 'Tenant B message',
          externalId: sharedProviderId,
          metadata: { manual: true, deliveryStatus: 'SENT' }
        }
      });

      // Receipt arriving for Tenant A
      const processor = new WhatsAppDeliveryReceiptProcessor(prisma);
      const applied = await processor.applyReceipt({
        tenantId: tenantA.tenantId,
        providerMessageId: sharedProviderId,
        status: 'READ',
        providerTimestamp: new Date()
      });

      expect(applied.applied).toBe(false); // No message in Tenant A matched

      // Message in Tenant B remained untouched
      const checkMsgB = await prisma.message.findUnique({ where: { id: messageB.id } });
      expect((checkMsgB?.metadata as any)?.deliveryStatus).toBe('SENT');
    });
  });
});
