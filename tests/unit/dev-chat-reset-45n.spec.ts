import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../../src/tests/testDb';
import express from 'express';
import request from 'supertest';
import { createDevChatRouter, createSignedToken } from '../../src/dev/chatApi';
import { bootstrapChatbot } from '../../src/bootstrap';

describe('Phase 45N: Dev Chat Reset Customer Resolution', () => {
  const deps = bootstrapChatbot(prisma);
  const tenantId = 'test-reset-tenant';
  const accountId = 'test-reset-account';
  const authToken = createSignedToken({ tenantId });

  const app = express();
  app.use(express.json());
  app.use('/api/dev', createDevChatRouter(deps));

  beforeEach(async () => {
    deps.tenantConfigService.clearCache();
    await prisma.workflowSession.deleteMany({ where: { tenantId } });
    await prisma.conversation.deleteMany({ where: { tenantId } });
    await prisma.customer.deleteMany({ where: { tenantId } });
    await prisma.account.deleteMany({ where: { tenantId } });
    await prisma.tenantConfig.deleteMany({ where: { tenantId } });
    await prisma.tenant.deleteMany({ where: { id: tenantId } });

    await prisma.tenant.create({
      data: {
        id: tenantId,
        name: 'Reset Test Tenant',
        config: {
          create: {
            config: {} as any
          }
        }
      }
    });

    await prisma.account.create({
      data: {
        id: accountId,
        tenantId,
        name: 'Reset Test Account'
      }
    });
  });

  it('correctly resolves customer by externalId, archives active conversations, and completes workflow sessions', async () => {
    // 1. Create target customer with externalId "manual-customer-A"
    const targetCustomer = await prisma.customer.create({
      data: {
        tenantId,
        externalId: 'manual-customer-A'
      }
    });

    // Create target active conversation
    const targetConv = await prisma.conversation.create({
      data: {
        tenantId,
        accountId,
        customerId: targetCustomer.id,
        status: 'ACTIVE'
      }
    });

    // Create target active workflow session
    const targetSession = await prisma.workflowSession.create({
      data: {
        tenantId,
        conversationId: targetConv.id,
        workflowId: 'consultation_booking',
        stateId: 'collect_name',
        status: 'ACTIVE',
        contextData: {},
        collectedData: {}
      }
    });

    // 2. Create unrelated customer with externalId "other-customer-B"
    const otherCustomer = await prisma.customer.create({
      data: {
        tenantId,
        externalId: 'other-customer-B'
      }
    });

    const otherConv = await prisma.conversation.create({
      data: {
        tenantId,
        accountId,
        customerId: otherCustomer.id,
        status: 'ACTIVE'
      }
    });

    const otherSession = await prisma.workflowSession.create({
      data: {
        tenantId,
        conversationId: otherConv.id,
        workflowId: 'other_workflow',
        stateId: 'step_1',
        status: 'ACTIVE',
        contextData: {},
        collectedData: {}
      }
    });

    // 3. Call POST /api/dev/reset with customerId = "manual-customer-A" and Bearer token
    const res1 = await request(app)
      .post('/api/dev/reset')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ customerId: 'manual-customer-A' });

    expect(res1.status).toBe(200);
    expect(res1.body.success).toBe(true);

    // 4. Verify target conversation is ARCHIVED
    const updatedTargetConv = await prisma.conversation.findUnique({
      where: { id: targetConv.id }
    });
    expect(updatedTargetConv?.status).toBe('ARCHIVED');

    // 5. Verify target workflowSession is COMPLETED (not ACTIVE)
    const updatedTargetSession = await prisma.workflowSession.findUnique({
      where: { id: targetSession.id }
    });
    expect(updatedTargetSession?.status).toBe('COMPLETED');

    // 6. Verify unrelated customer is untouched
    const updatedOtherConv = await prisma.conversation.findUnique({
      where: { id: otherConv.id }
    });
    expect(updatedOtherConv?.status).toBe('ACTIVE');

    const updatedOtherSession = await prisma.workflowSession.findUnique({
      where: { id: otherSession.id }
    });
    expect(updatedOtherSession?.status).toBe('ACTIVE');

    // 7. Verify second reset call is idempotent
    const res2 = await request(app)
      .post('/api/dev/reset')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ customerId: 'manual-customer-A' });

    expect(res2.status).toBe(200);
    expect(res2.body.success).toBe(true);
  });
});
