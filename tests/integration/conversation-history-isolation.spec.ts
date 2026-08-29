import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { prisma } from '../../src/tests/testDb';
import { bootstrapChatbot } from '../../src/bootstrap';
import { createApp } from '../../src/app';

describe('Phase CRM-C-FIX-02 — Conversation History Isolation & Lifetime Contract', () => {
  let app: any;
  const tenantId = 'animeverse';
  const accountId = 'animeverse-store';
  const externalCustomerId = 'hist-test-cust-1';

  beforeAll(async () => {
    // Ensure Tenant & Account exist
    await prisma.tenant.upsert({
      where: { id: tenantId },
      update: {},
      create: { id: tenantId, name: 'AnimeVerse' }
    });
    await prisma.account.upsert({
      where: { id: accountId },
      update: {},
      create: { id: accountId, tenantId, name: 'AnimeVerse Store' }
    });

    const deps = bootstrapChatbot(prisma);
    app = await createApp(deps);
  });

  afterAll(async () => {
    // Cleanup
    const customer = await prisma.customer.findUnique({
      where: { tenantId_externalId: { tenantId, externalId: externalCustomerId } }
    });
    if (customer) {
      await prisma.lead.deleteMany({ where: { tenantId, customerId: customer.id } });
      await prisma.message.deleteMany({ where: { tenantId } });
      await prisma.conversation.deleteMany({ where: { tenantId, customerId: customer.id } });
      await prisma.customer.deleteMany({ where: { id: customer.id } });
    }
  });

  it('A. retrieves active conversation with chronological messages and DOES NOT archive it', async () => {
    // 1. Send 2 chat turns
    const res1 = await request(app)
      .post('/api/dev/chat')
      .send({
        tenantId,
        accountId,
        customerId: externalCustomerId,
        message: 'Show me the hoodie'
      });
    expect(res1.status).toBe(200);

    const res2 = await request(app)
      .post('/api/dev/chat')
      .send({
        tenantId,
        accountId,
        customerId: externalCustomerId,
        message: 'I want to buy this'
      });
    expect(res2.status).toBe(200);

    // 2. Fetch history via GET /api/dev/conversations/latest
    const histRes = await request(app)
      .get(`/api/dev/conversations/latest?accountId=${accountId}&customerId=${externalCustomerId}`)
      .set('x-tenant-id', tenantId);

    expect(histRes.status).toBe(200);
    expect(histRes.body.success).toBe(true);
    expect(histRes.body.conversation).not.toBeNull();
    expect(histRes.body.conversation.status).toBe('ACTIVE');
    expect(histRes.body.messages.length).toBe(4);

    // Verify Chronological message order
    expect(histRes.body.messages[0].role).toBe('user');
    expect(histRes.body.messages[0].content).toBe('Show me the hoodie');
    expect(histRes.body.messages[1].role).toBe('assistant');
    expect(histRes.body.messages[2].role).toBe('user');
    expect(histRes.body.messages[2].content).toBe('I want to buy this');
    expect(histRes.body.messages[3].role).toBe('assistant');

    // 3. Verify in DB that conversation is STILL ACTIVE (not archived!)
    const convInDb = await prisma.conversation.findUnique({
      where: { id: histRes.body.conversation.id }
    });
    expect(convInDb?.status).toBe('ACTIVE');

    // 4. Verify no new conversation was created
    const customer = await prisma.customer.findUnique({
      where: { tenantId_externalId: { tenantId, externalId: externalCustomerId } }
    });
    const allConvs = await prisma.conversation.findMany({
      where: { tenantId, customerId: customer!.id }
    });
    expect(allConvs.length).toBe(1);
  }, 25000);

  it('B. returns empty state for customer with no conversations', async () => {
    const histRes = await request(app)
      .get(`/api/dev/conversations/latest?accountId=${accountId}&customerId=non-existent-user-999`)
      .set('x-tenant-id', tenantId);

    expect(histRes.status).toBe(200);
    expect(histRes.body.success).toBe(true);
    expect(histRes.body.conversation).toBeNull();
    expect(histRes.body.messages).toEqual([]);
  });

  it('C. rejects request for non-existent account with 404', async () => {
    const histRes = await request(app)
      .get(`/api/dev/conversations/latest?accountId=non-existent-store&customerId=${externalCustomerId}`)
      .set('x-tenant-id', tenantId);

    expect(histRes.status).toBe(404);
    expect(histRes.body.error).toBe('ACCOUNT_NOT_FOUND');
  });

  it('D. explicit /reset endpoint continues to archive conversation as designed', async () => {
    const resetRes = await request(app)
      .post('/api/dev/reset')
      .send({
        tenantId,
        customerId: externalCustomerId
      });

    expect(resetRes.status).toBe(200);
    expect(resetRes.body.success).toBe(true);

    // Verify conversation is now ARCHIVED
    const customer = await prisma.customer.findUnique({
      where: { tenantId_externalId: { tenantId, externalId: externalCustomerId } }
    });
    const conv = await prisma.conversation.findFirst({
      where: { tenantId, customerId: customer!.id },
      orderBy: { createdAt: 'desc' }
    });
    expect(conv?.status).toBe('ARCHIVED');

    // History endpoint still returns the archived conversation in read-only mode
    const histRes = await request(app)
      .get(`/api/dev/conversations/latest?accountId=${accountId}&customerId=${externalCustomerId}`)
      .set('x-tenant-id', tenantId);

    expect(histRes.status).toBe(200);
    expect(histRes.body.conversation.status).toBe('ARCHIVED');
    expect(histRes.body.messages.length).toBe(4);
  });
});
