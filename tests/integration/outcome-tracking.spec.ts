import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { prisma, pool } from '../../src/tests/testDb';
import { OutcomeTrackingService } from '../../src/domain/outcome/OutcomeTrackingService';
import { OutcomePublisher } from '../../src/domain/outcome/OutcomePublisher';
import { RecordOutcomeParams } from '../../src/domain/outcome/types';
import { CRMService } from '../../src/domain/crm/CRMService';
import { ConversationAutomationService } from '../../src/domain/conversation/ConversationAutomationService';
import { ConversationEngine } from '../../src/domain/conversation/ConversationEngine';
import { ConversationService } from '../../src/domain/conversation/ConversationService';
import { TenantConfigService } from '../../src/domain/tenant/TenantConfigService';
import { AccountConfigService } from '../../src/domain/tenant/AccountConfigService';
import { WorkflowEngine } from '../../src/core/engine/WorkflowEngine';
import { WorkflowStateEvaluator } from '../../src/core/engine/WorkflowStateEvaluator';
import { ResponseBuilder } from '../../src/domain/conversation/ResponseBuilder';
import { FieldValidator } from '../../src/core/engine/FieldValidator';
import { LLMMockProvider } from '../../src/core/llm/LLMProvider';
import { PortalStore } from '../../src/portal/PortalStore';
import { PortalAuth, hashPassword } from '../../src/portal/PortalAuth';
import { createPortalRouter } from '../../src/portal/PortalRouter';

describe('Relayqo Outcome Tracking MVP Integration Tests', () => {
  let outcomeService: OutcomeTrackingService;
  let tenantId: string;
  let accountId: string;
  let customerId: string;
  let conversationId: string;

  // Portal API test harness
  let app: express.Express;
  let store: PortalStore;
  let auth: PortalAuth;
  let clientSessionCookie: string;
  let clientCsrfToken: string;
  let adminSessionCookie: string;
  let adminCsrfToken: string;
  let clientAccountId: string;
  let clientTenantId: string;

  beforeAll(async () => {
    // Ensure OutcomeEvent table exists in test schema
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "test"."OutcomeEvent" (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        "tenantId" TEXT NOT NULL,
        "accountId" TEXT NOT NULL,
        type TEXT NOT NULL,
        source TEXT NOT NULL,
        "conversationId" TEXT,
        "customerId" TEXT,
        value DECIMAL(12, 2),
        currency TEXT,
        "relatedOutcomeId" TEXT,
        "idempotencyKey" TEXT NOT NULL,
        metadata JSONB,
        "occurredAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "OutcomeEvent_accountId_idempotencyKey_key" UNIQUE ("accountId", "idempotencyKey")
      );
      CREATE INDEX IF NOT EXISTS "OutcomeEvent_tenantId_accountId_type_occurredAt_idx" 
        ON "test"."OutcomeEvent"("tenantId", "accountId", type, "occurredAt");
      CREATE INDEX IF NOT EXISTS "OutcomeEvent_relatedOutcomeId_idx" 
        ON "test"."OutcomeEvent"("relatedOutcomeId");
    `);

    outcomeService = new OutcomeTrackingService(prisma);

    // Setup base tenant, account, customer, conversation
    tenantId = `outcome-ten-${Date.now()}`;
    accountId = `outcome-acct-${Date.now()}`;
    customerId = `outcome-cust-${Date.now()}`;

    await prisma.tenant.create({
      data: { id: tenantId, name: 'Outcome Tenant' }
    });

    await prisma.account.create({
      data: {
        id: accountId,
        tenantId,
        name: 'Outcome Account',
        enabled: true
      }
    });

    const customer = await prisma.customer.create({
      data: {
        id: customerId,
        tenantId,
        externalId: customerId
      }
    });

    const conv = await prisma.conversation.create({
      data: {
        id: `conv-out-${Date.now()}`,
        tenantId,
        accountId,
        customerId: customer.id,
        status: 'ACTIVE'
      }
    });
    conversationId = conv.id;

    // Setup Portal API test app
    store = new PortalStore(prisma as any);
    auth = new PortalAuth(store, { publicUrl: 'http://localhost' });

    app = express();
    app.use(express.json());
    app.use('/api', createPortalRouter(
      {
        store,
        auth,
        connections: {} as any,
        documents: { list: vi.fn(async () => []) } as any
      },
      {
        prisma,
        outcomeTrackingService: outcomeService
      }
    ));

    // Create client user and membership
    const clientPassHash = await hashPassword('TestClientPassword123!');
    const clientUserId = randomUUID();
    clientTenantId = tenantId;
    clientAccountId = accountId;

    await prisma.portalUser.create({
      data: {
        id: clientUserId,
        email: `client-${clientUserId}@example.com`,
        name: 'Client User',
        passwordHash: clientPassHash,
        role: 'CLIENT',
        verifiedAt: new Date()
      }
    });

    await prisma.portalMembership.create({
      data: {
          userId: clientUserId,
          tenantId: clientTenantId,
          accountId: clientAccountId
      }
    });

    await prisma.portalProfile.create({
      data: {
        accountId: clientAccountId,
        tenantId: clientTenantId,
        status: 'ACTIVE',
        draft: { name: 'Client Biz' },
        revision: 1
      }
    });

    // Login client
    const clientLoginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: `client-${clientUserId}@example.com`, password: 'TestClientPassword123!' });

    clientSessionCookie = clientLoginRes.headers['set-cookie']?.[0] || '';
    const clientSessionRes = await request(app)
      .get('/api/auth/session')
      .set('Cookie', clientSessionCookie);
    clientCsrfToken = clientSessionRes.body.csrf;

    // Create admin user
    const adminPassHash = await hashPassword('TestAdminPassword123!');
    const adminUserId = randomUUID();

    await prisma.portalUser.create({
      data: {
        id: adminUserId,
        email: `admin-${adminUserId}@example.com`,
        name: 'Platform Admin',
        passwordHash: adminPassHash,
        role: 'ADMIN',
        verifiedAt: new Date()
      }
    });

    const adminLoginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: `admin-${adminUserId}@example.com`, password: 'TestAdminPassword123!' });

    adminSessionCookie = adminLoginRes.headers['set-cookie']?.[0] || '';
    const adminSessionRes = await request(app)
      .get('/api/auth/session')
      .set('Cookie', adminSessionCookie);
    adminCsrfToken = adminSessionRes.body.csrf;
  });

  afterAll(async () => {
    await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  });

  it('1. recordEvent stores an outcome event with required fields', async () => {
    const key = `test-key-1-${Date.now()}`;
    const event = await outcomeService.recordEvent({
      tenantId,
      accountId,
      type: 'LEAD_CREATED',
      source: 'CHATBOT_SIGNAL',
      conversationId,
      customerId,
      idempotencyKey: key,
      metadata: { note: 'initial lead' }
    });

    expect(event).toBeDefined();
    expect(event.id).toBeDefined();
    expect(event.tenantId).toBe(tenantId);
    expect(event.accountId).toBe(accountId);
    expect(event.type).toBe('LEAD_CREATED');
    expect(event.source).toBe('CHATBOT_SIGNAL');
    expect(event.idempotencyKey).toBe(key);
    expect((event.metadata as any)?.note).toBe('initial lead');
  });

  it('2. Deduplication enforces unique (accountId, idempotencyKey) and returns existing event', async () => {
    const key = `idemp-key-${Date.now()}`;
    const first = await outcomeService.recordEvent({
      tenantId,
      accountId,
      type: 'LEAD_CREATED',
      source: 'CHATBOT_SIGNAL',
      idempotencyKey: key,
      metadata: { attempt: 1 }
    });

    const second = await outcomeService.recordEvent({
      tenantId,
      accountId,
      type: 'LEAD_CREATED',
      source: 'CHATBOT_SIGNAL',
      idempotencyKey: key,
      metadata: { attempt: 2 }
    });

    expect(first.id).toBe(second.id);
    expect((second.metadata as any)?.attempt).toBe(1); // Original preserved
  });

  it('3. Pagination respects limit, offset, and bounds (limit capped at 100)', async () => {
    // Insert 5 unique events
    for (let i = 0; i < 5; i++) {
      await outcomeService.recordEvent({
        tenantId,
        accountId,
        type: 'QUESTION_MISSED',
        source: 'CHATBOT_SIGNAL',
        idempotencyKey: `page-test-${i}-${Date.now()}`,
        metadata: { index: i }
      });
    }

    const page1 = await outcomeService.listEvents({
      tenantId,
      accountId,
      type: 'QUESTION_MISSED',
      limit: 2,
      offset: 0
    });
    expect(page1.events.length).toBe(2);

    const page2 = await outcomeService.listEvents({
      tenantId,
      accountId,
      type: 'QUESTION_MISSED',
      limit: 2,
      offset: 2
    });
    expect(page2.events.length).toBe(2);
    expect(page1.events[0].id).not.toBe(page2.events[0].id);

    // Limit capped at 100 (test that passing 999 does not throw and caps)
    const capped = await outcomeService.listEvents({
      tenantId,
      accountId,
      limit: 999
    });
    expect(capped.events.length).toBeLessThanOrEqual(100);
  });

  it('4. Type filtering returns only requested event types', async () => {
    const handoffKey = `type-filter-handoff-${Date.now()}`;
    await outcomeService.recordEvent({
      tenantId,
      accountId,
      type: 'HANDOFF_REQUESTED',
      source: 'HANDOFF',
      idempotencyKey: handoffKey
    });

    const handoffsOnly = await outcomeService.listEvents({
      tenantId,
      accountId,
      type: 'HANDOFF_REQUESTED',
      limit: 10
    });

    expect(handoffsOnly.events.length).toBeGreaterThan(0);
    expect(handoffsOnly.events.every(e => e.type === 'HANDOFF_REQUESTED')).toBe(true);
  });

  it('5. Date-window filtering excludes events outside the days window', async () => {
    const oldDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000); // 40 days ago
    const oldKey = `old-event-${Date.now()}`;

    // Direct insert with backdated occurredAt
    await prisma.outcomeEvent.create({
      data: {
        tenantId,
        accountId,
        type: 'LEAD_CREATED',
        source: 'CHATBOT_SIGNAL',
        idempotencyKey: oldKey,
        occurredAt: oldDate
      }
    });

    // Query for last 30 days
    const events30d = await outcomeService.listEvents({
      tenantId,
      accountId,
      days: 30,
      limit: 100
    });

    expect(events30d.events.some(e => e.idempotencyKey === oldKey)).toBe(false);

    // Query for last 60 days
    const events60d = await outcomeService.listEvents({
      tenantId,
      accountId,
      days: 60,
      limit: 100
    });

    expect(events60d.events.some(e => e.idempotencyKey === oldKey)).toBe(true);
  });

  it('6. Summary correctly calculates leadsCreated, leadsQualified, and qualificationRate', async () => {
    const uniqueAcct = `acct-leads-${Date.now()}`;
    await prisma.account.create({ data: { id: uniqueAcct, tenantId, name: 'Lead Acct', enabled: true } });

    // 4 created, 2 qualified -> 50%
    await outcomeService.recordEvent({ tenantId, accountId: uniqueAcct, type: 'LEAD_CREATED', source: 'CHATBOT_SIGNAL', idempotencyKey: `l1-${Date.now()}` });
    await outcomeService.recordEvent({ tenantId, accountId: uniqueAcct, type: 'LEAD_CREATED', source: 'CHATBOT_SIGNAL', idempotencyKey: `l2-${Date.now()}` });
    await outcomeService.recordEvent({ tenantId, accountId: uniqueAcct, type: 'LEAD_CREATED', source: 'CHATBOT_SIGNAL', idempotencyKey: `l3-${Date.now()}` });
    await outcomeService.recordEvent({ tenantId, accountId: uniqueAcct, type: 'LEAD_CREATED', source: 'CHATBOT_SIGNAL', idempotencyKey: `l4-${Date.now()}` });

    await outcomeService.recordEvent({ tenantId, accountId: uniqueAcct, type: 'LEAD_QUALIFIED', source: 'CRM_STATUS', idempotencyKey: `lq1-${Date.now()}` });
    await outcomeService.recordEvent({ tenantId, accountId: uniqueAcct, type: 'LEAD_QUALIFIED', source: 'CRM_STATUS', idempotencyKey: `lq2-${Date.now()}` });

    const summary = await outcomeService.getAccountSummary(tenantId, uniqueAcct, 30);
    expect(summary.leadsCreated).toBe(4);
    expect(summary.leadsQualified).toBe(2);
    expect(summary.qualificationRate).toBe(0.5);
  });

  it('7. Summary correctly counts handoffs requested, claimed, and resolved, and calculates handoffResolutionRate', async () => {
    const uniqueAcct = `acct-handoffs-${Date.now()}`;
    await prisma.account.create({ data: { id: uniqueAcct, tenantId, name: 'Handoff Acct', enabled: true } });

    // 3 requested, 2 claimed, 1 resolved -> 33.3% resolution rate
    await outcomeService.recordEvent({ tenantId, accountId: uniqueAcct, type: 'HANDOFF_REQUESTED', source: 'HANDOFF', idempotencyKey: `hr1-${Date.now()}` });
    await outcomeService.recordEvent({ tenantId, accountId: uniqueAcct, type: 'HANDOFF_REQUESTED', source: 'HANDOFF', idempotencyKey: `hr2-${Date.now()}` });
    await outcomeService.recordEvent({ tenantId, accountId: uniqueAcct, type: 'HANDOFF_REQUESTED', source: 'HANDOFF', idempotencyKey: `hr3-${Date.now()}` });

    await outcomeService.recordEvent({ tenantId, accountId: uniqueAcct, type: 'HANDOFF_CLAIMED', source: 'HANDOFF', idempotencyKey: `hc1-${Date.now()}` });
    await outcomeService.recordEvent({ tenantId, accountId: uniqueAcct, type: 'HANDOFF_CLAIMED', source: 'HANDOFF', idempotencyKey: `hc2-${Date.now()}` });

    await outcomeService.recordEvent({ tenantId, accountId: uniqueAcct, type: 'HANDOFF_RESOLVED', source: 'HANDOFF', idempotencyKey: `hres1-${Date.now()}` });

    const summary = await outcomeService.getAccountSummary(tenantId, uniqueAcct, 30);
    expect(summary.handoffsRequested).toBe(3);
    expect(summary.handoffsClaimed).toBe(2);
    expect(summary.handoffsResolved).toBe(1);
    expect(summary.handoffResolutionRate).toBe(0.3333);
  });

  it('8. Summary correctly calculates median durations for time-to-claim and time-to-resolve', async () => {
    const uniqueAcct = `acct-durations-${Date.now()}`;
    await prisma.account.create({ data: { id: uniqueAcct, tenantId, name: 'Duration Acct', enabled: true } });

    // Claim durations: 10s (10000ms), 20s (20000ms), 30s (30000ms) -> median = 20s
    await outcomeService.recordEvent({
      tenantId, accountId: uniqueAcct, type: 'HANDOFF_CLAIMED', source: 'HANDOFF',
      idempotencyKey: `dur-c1-${Date.now()}`,
      metadata: { timeFromRequestToClaimMs: 10000 }
    });
    await outcomeService.recordEvent({
      tenantId, accountId: uniqueAcct, type: 'HANDOFF_CLAIMED', source: 'HANDOFF',
      idempotencyKey: `dur-c2-${Date.now()}`,
      metadata: { timeFromRequestToClaimMs: 20000 }
    });
    await outcomeService.recordEvent({
      tenantId, accountId: uniqueAcct, type: 'HANDOFF_CLAIMED', source: 'HANDOFF',
      idempotencyKey: `dur-c3-${Date.now()}`,
      metadata: { timeFromRequestToClaimMs: 30000 }
    });

    // Resolve durations: 60s (60000ms), 120s (120000ms) -> median = 90s
    await outcomeService.recordEvent({
      tenantId, accountId: uniqueAcct, type: 'HANDOFF_RESOLVED', source: 'HANDOFF',
      idempotencyKey: `dur-r1-${Date.now()}`,
      metadata: { totalResolutionTimeMs: 60000 }
    });
    await outcomeService.recordEvent({
      tenantId, accountId: uniqueAcct, type: 'HANDOFF_RESOLVED', source: 'HANDOFF',
      idempotencyKey: `dur-r2-${Date.now()}`,
      metadata: { totalResolutionTimeMs: 120000 }
    });

    const summary = await outcomeService.getAccountSummary(tenantId, uniqueAcct, 30);
    expect(summary.medianTimeToClaimSeconds).toBe(20);
    expect(summary.medianTimeToResolveSeconds).toBe(90);
  });

  it('9. Summary correctly calculates missedQuestions, resolvedMissedQuestions, and resolution rate', async () => {
    const uniqueAcct = `acct-missed-${Date.now()}`;
    await prisma.account.create({ data: { id: uniqueAcct, tenantId, name: 'Missed Acct', enabled: true } });

    // 4 missed, 3 resolved -> 75%
    await outcomeService.recordEvent({ tenantId, accountId: uniqueAcct, type: 'QUESTION_MISSED', source: 'CHATBOT_SIGNAL', idempotencyKey: `qm1-${Date.now()}` });
    await outcomeService.recordEvent({ tenantId, accountId: uniqueAcct, type: 'QUESTION_MISSED', source: 'CHATBOT_SIGNAL', idempotencyKey: `qm2-${Date.now()}` });
    await outcomeService.recordEvent({ tenantId, accountId: uniqueAcct, type: 'QUESTION_MISSED', source: 'CHATBOT_SIGNAL', idempotencyKey: `qm3-${Date.now()}` });
    await outcomeService.recordEvent({ tenantId, accountId: uniqueAcct, type: 'QUESTION_MISSED', source: 'CHATBOT_SIGNAL', idempotencyKey: `qm4-${Date.now()}` });

    await outcomeService.recordEvent({ tenantId, accountId: uniqueAcct, type: 'QUESTION_RESOLVED', source: 'MERCHANT', idempotencyKey: `qr1-${Date.now()}` });
    await outcomeService.recordEvent({ tenantId, accountId: uniqueAcct, type: 'QUESTION_RESOLVED', source: 'MERCHANT', idempotencyKey: `qr2-${Date.now()}` });
    await outcomeService.recordEvent({ tenantId, accountId: uniqueAcct, type: 'QUESTION_RESOLVED', source: 'MERCHANT', idempotencyKey: `qr3-${Date.now()}` });

    const summary = await outcomeService.getAccountSummary(tenantId, uniqueAcct, 30);
    expect(summary.missedQuestions).toBe(4);
    expect(summary.resolvedMissedQuestions).toBe(3);
    expect(summary.missedQuestionResolutionRate).toBe(0.75);
  });

  it('10. Summary correctly sums confirmed bookings and confirmed orders with currency breakdowns', async () => {
    const uniqueAcct = `acct-orders-${Date.now()}`;
    await prisma.account.create({ data: { id: uniqueAcct, tenantId, name: 'Orders Acct', enabled: true } });

    // 2 bookings
    await outcomeService.recordEvent({ tenantId, accountId: uniqueAcct, type: 'BOOKING_CONFIRMED', source: 'WORKFLOW', idempotencyKey: `b1-${Date.now()}` });
    await outcomeService.recordEvent({ tenantId, accountId: uniqueAcct, type: 'BOOKING_CONFIRMED', source: 'WORKFLOW', idempotencyKey: `b2-${Date.now()}` });

    // 3 orders: 200 USD, 300 USD, 500 MAD
    await outcomeService.recordEvent({ tenantId, accountId: uniqueAcct, type: 'ORDER_CONFIRMED', source: 'WORKFLOW', value: 200, currency: 'USD', idempotencyKey: `o1-${Date.now()}` });
    await outcomeService.recordEvent({ tenantId, accountId: uniqueAcct, type: 'ORDER_CONFIRMED', source: 'WORKFLOW', value: 300, currency: 'USD', idempotencyKey: `o2-${Date.now()}` });
    await outcomeService.recordEvent({ tenantId, accountId: uniqueAcct, type: 'ORDER_CONFIRMED', source: 'WORKFLOW', value: 500, currency: 'MAD', idempotencyKey: `o3-${Date.now()}` });

    const summary = await outcomeService.getAccountSummary(tenantId, uniqueAcct, 30);
    expect(summary.confirmedBookings).toBe(2);
    expect(summary.confirmedOrders).toBe(3);
    expect(summary.confirmedOrderValueByCurrency['USD']).toBe(500);
    expect(summary.confirmedOrderValueByCurrency['MAD']).toBe(500);
  });

  it('11. resolveMissedQuestion transitions a missed question by recording QUESTION_RESOLVED and referencing relatedOutcomeId', async () => {
    const missed = await outcomeService.recordEvent({
      tenantId,
      accountId,
      type: 'QUESTION_MISSED',
      source: 'CHATBOT_SIGNAL',
      idempotencyKey: `qm-to-res-${Date.now()}`,
      metadata: { question: 'Do you ship to Tangier?' }
    });

    const resolution = await outcomeService.resolveMissedQuestion({
      tenantId,
      accountId,
      outcomeId: missed.id,
      actorId: 'test-user-123'
    });

    expect(resolution).toBeDefined();
    expect(resolution.type).toBe('QUESTION_RESOLVED');
    expect(resolution.relatedOutcomeId).toBe(missed.id);
    expect(resolution.source).toBe('MERCHANT');
  });

  it('12. Duplicate resolution calls for the same missed question are idempotent and do not create multiple events', async () => {
    const missed = await outcomeService.recordEvent({
      tenantId,
      accountId,
      type: 'QUESTION_MISSED',
      source: 'CHATBOT_SIGNAL',
      idempotencyKey: `qm-dup-${Date.now()}`,
      metadata: { question: 'What is your refund policy?' }
    });

    const res1 = await outcomeService.resolveMissedQuestion({
      tenantId,
      accountId,
      outcomeId: missed.id
    });

    const res2 = await outcomeService.resolveMissedQuestion({
      tenantId,
      accountId,
      outcomeId: missed.id
    });

    expect(res1.id).toBe(res2.id);

    const count = await prisma.outcomeEvent.count({
      where: {
        tenantId,
        accountId,
        type: 'QUESTION_RESOLVED',
        relatedOutcomeId: missed.id
      }
    });
    expect(count).toBe(1);
  });

  it('13. getUnresolvedMissedQuestions returns only missed questions that do not have an active QUESTION_RESOLVED event', async () => {
    const uniqueAcct = `acct-unres-${Date.now()}`;
    await prisma.account.create({ data: { id: uniqueAcct, tenantId, name: 'Unresolved Acct', enabled: true } });

    const q1 = await outcomeService.recordEvent({
      tenantId, accountId: uniqueAcct, type: 'QUESTION_MISSED', source: 'CHATBOT_SIGNAL',
      idempotencyKey: `unres-1-${Date.now()}`,
      metadata: { question: 'Question 1 unresolved', language: 'en' }
    });
    const q2 = await outcomeService.recordEvent({
      tenantId, accountId: uniqueAcct, type: 'QUESTION_MISSED', source: 'CHATBOT_SIGNAL',
      idempotencyKey: `unres-2-${Date.now()}`,
      metadata: { question: 'Question 2 to be resolved', language: 'fr' }
    });

    // Resolve q2
    await outcomeService.resolveMissedQuestion({
      tenantId,
      accountId: uniqueAcct,
      outcomeId: q2.id
    });

    const result = await outcomeService.getUnresolvedMissedQuestions(tenantId, uniqueAcct, 30);
    expect(result.questions.length).toBe(1);
    expect(result.questions[0].id).toBe(q1.id);
    expect(result.questions[0].question).toBe('Question 1 unresolved');
  });

  it('14. Prevents preview conversations (portal-preview:) from recording lead or outcome events', async () => {
    const uniqueAcct = `acct-prev-${Date.now()}`;
    await prisma.account.create({ data: { id: uniqueAcct, tenantId, name: 'Preview Acct', enabled: true } });
    const previewCustomer = await prisma.customer.create({
      data: { tenantId, externalId: `portal-preview:user1:${Date.now()}` }
    });
    const previewConversation = await prisma.conversation.create({
      data: { tenantId, accountId: uniqueAcct, customerId: previewCustomer.id }
    });

    const auto = new ConversationAutomationService(prisma, outcomeService);

    // Try requesting handoff for preview conversation
    await auto.requestHandoff({
      tenantId,
      conversationId: previewConversation.id,
      reason: 'TEST'
    });

    const events = await outcomeService.listEvents({
      tenantId,
      accountId: uniqueAcct
    });

    expect(events.events.length).toBe(0);
  });

  it('15. Safe order value extraction: non-numeric or negative values are safely ignored, currency defaults safely', async () => {
    // Record with invalid/negative value
    const ev1 = await outcomeService.recordEvent({
      tenantId,
      accountId,
      type: 'ORDER_CONFIRMED',
      source: 'WORKFLOW',
      value: -50,
      currency: 'INVALID_LONG_CODE',
      idempotencyKey: `safe-ord-1-${Date.now()}`
    });

    // Value was negative, currency invalid
    expect(ev1).toBeDefined();

    // In summary, negative or invalid order values do not corrupt numeric arithmetic
    const summary = await outcomeService.getAccountSummary(tenantId, accountId, 30);
    expect(summary).toBeDefined();
    for (const val of Object.values(summary.confirmedOrderValueByCurrency)) {
      expect(val).toBeGreaterThanOrEqual(0);
    }
  });

  it('16. Non-blocking error handling: outcome tracking service errors do not fail chatbot replies', async () => {
    // Mock outcomeService with a throwing recordEvent
    const failingOutcomeService = {
      recordEvent: vi.fn().mockRejectedValue(new Error('Simulated database failure during outcome tracking'))
    } as unknown as OutcomeTrackingService;

    const convService = new ConversationService(prisma);
    const tenantConfigService = new TenantConfigService(prisma);
    const responseBuilder = new ResponseBuilder();
    const evaluator = new WorkflowStateEvaluator();
    const fieldValidator = new FieldValidator();
    const workflowEngine = new WorkflowEngine(evaluator, undefined, responseBuilder, fieldValidator);
    const engine = new ConversationEngine(
      convService,
      tenantConfigService,
      workflowEngine,
      new LLMMockProvider(),
      responseBuilder,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      failingOutcomeService
    );

    const reply = await engine.handleMessage(
      tenantId,
      `cust-handoff-resilience-${Date.now()}`,
      'I want to speak to a human agent',
      accountId,
      { externalMessageId: `wamid-handoff-${Date.now()}` }
    );

    // The handoff acknowledgment still succeeds when outcome telemetry fails afterward.
    expect(reply.length).toBeGreaterThan(0);
    expect(failingOutcomeService.recordEvent).toHaveBeenCalled();
  });

  it('17. CRM publisher interface: events dispatch to registered OutcomePublisher without throwing or blocking', async () => {
    const dispatchedEvents: RecordOutcomeParams[] = [];
    const testPublisher: OutcomePublisher = {
      publish: vi.fn(async (event: RecordOutcomeParams) => {
        dispatchedEvents.push(event);
      })
    };

    const pubService = new OutcomeTrackingService(prisma, testPublisher);

    const key = `pub-test-${Date.now()}`;
    await pubService.recordEvent({
      tenantId,
      accountId,
      type: 'LEAD_QUALIFIED',
      source: 'CRM_STATUS',
      idempotencyKey: key,
      metadata: { crmTarget: 'hubspot' }
    });

    expect(testPublisher.publish).toHaveBeenCalled();
    expect(dispatchedEvents.length).toBe(1);
    expect(dispatchedEvents[0].type).toBe('LEAD_QUALIFIED');
    expect(dispatchedEvents[0].idempotencyKey).toBe(key);
  });

  it('18. HTTP APIs: Client and Admin outcome endpoints return correct status codes, require auth, enforce isolation, and check CSRF on POST', async () => {
    // 18a. Unauthenticated request -> 401
    const unauthSummary = await request(app).get('/api/client/outcomes/summary');
    expect(unauthSummary.status).toBe(401);

    // 18b. Authenticated client GET /api/client/outcomes/summary
    const clientSummary = await request(app)
      .get('/api/client/outcomes/summary?days=30')
      .set('Cookie', clientSessionCookie);
    expect(clientSummary.status).toBe(200);
    expect(clientSummary.body.periodDays).toBe(30);
    expect(typeof clientSummary.body.leadsCreated).toBe('number');

    // 18c. Authenticated client GET /api/client/outcomes list
    const clientList = await request(app)
      .get('/api/client/outcomes?days=30&limit=10')
      .set('Cookie', clientSessionCookie);
    expect(clientList.status).toBe(200);
    expect(Array.isArray(clientList.body.events)).toBe(true);

    // 18d. Client POST /api/client/outcomes/:id/resolve without CSRF -> 403
    const qToResolve = await outcomeService.recordEvent({
      tenantId: clientTenantId,
      accountId: clientAccountId,
      type: 'QUESTION_MISSED',
      source: 'CHATBOT_SIGNAL',
      idempotencyKey: `csrf-test-${Date.now()}`,
      metadata: { question: 'Will this fail without CSRF?' }
    });

    const noCsrfRes = await request(app)
      .post(`/api/client/outcomes/${qToResolve.id}/resolve`)
      .set('Cookie', clientSessionCookie);
    expect(noCsrfRes.status).toBe(403);

    // 18e. Client POST /api/client/outcomes/:id/resolve with valid CSRF -> 200
    const withCsrfRes = await request(app)
      .post(`/api/client/outcomes/${qToResolve.id}/resolve`)
      .set('Cookie', clientSessionCookie)
      .set('X-CSRF-Token', clientCsrfToken);
    expect(withCsrfRes.status).toBe(200);
    expect(withCsrfRes.body.success).toBe(true);
    expect(withCsrfRes.body.resolvedEvent.type).toBe('QUESTION_RESOLVED');

    // 18f. Client role cannot access admin endpoints -> 403
    const clientAccessAdmin = await request(app)
      .get('/api/admin/outcomes/summary')
      .set('Cookie', clientSessionCookie);
    expect(clientAccessAdmin.status).toBe(403);

    // 18g. Admin GET /api/admin/outcomes/summary -> 200
    const adminSummary = await request(app)
      .get('/api/admin/outcomes/summary?days=30')
      .set('Cookie', adminSessionCookie);
    expect(adminSummary.status).toBe(200);
    expect(adminSummary.body.totals).toBeDefined();
    expect(Array.isArray(adminSummary.body.clientsWithHighMissedQuestions)).toBe(true);

    // 18h. Admin GET /api/admin/accounts/:id/outcomes -> 200
    const adminAcctOutcomes = await request(app)
      .get(`/api/admin/accounts/${clientAccountId}/outcomes?days=30`)
      .set('Cookie', adminSessionCookie);
    expect(adminAcctOutcomes.status).toBe(200);
    expect(adminAcctOutcomes.body.periodDays).toBe(30);
    expect(Array.isArray(adminAcctOutcomes.body.events)).toBe(true);
  });
});
