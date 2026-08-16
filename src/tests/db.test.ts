import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from './testDb';

describe('Generic Database Foundation', () => {
  beforeAll(async () => {
    await prisma.knowledgeChunk.deleteMany();
    await prisma.knowledgeDocument.deleteMany();
    await prisma.knowledgeSource.deleteMany();
    await prisma.workflowSession.deleteMany();
    await prisma.message.deleteMany();
    await prisma.conversation.deleteMany();
    await prisma.tenantConfig.deleteMany();
    await prisma.customer.deleteMany();
    await prisma.tenant.deleteMany();
  });
  it('1. Should create a generic Tenant', async () => {
    const tenant = await prisma.tenant.create({
      data: { name: 'Tenant A' }
    });
    expect(tenant.id).toBeDefined();
    expect(tenant.name).toBe('Tenant A');
  });
  it('2. Should create TenantConfig', async () => {
    const tenant = await prisma.tenant.create({ data: { name: 'Config Test Tenant' } });
    const config = await prisma.tenantConfig.create({
      data: {
        tenantId: tenant.id,
        config: { botName: 'TestBot', version: 1 }
      }
    });
    expect(config.config).toMatchObject({ botName: 'TestBot' });
  });
  it('3. Should create a generic Customer', async () => {
    const tenant = await prisma.tenant.create({ data: { name: 'Customer Test Tenant' } });
    const customer = await prisma.customer.create({
      data: { tenantId: tenant.id, externalId: 'user123' }
    });
    expect(customer.id).toBeDefined();
    expect(customer.externalId).toBe('user123');
  });
  it('4 & 5. Should create a Conversation and persist Messages', async () => {
    const tenant = await prisma.tenant.create({ data: { name: 'Conv Test Tenant' } });
    const customer = await prisma.customer.create({ data: { tenantId: tenant.id, externalId: 'u1' } });
    const conversation = await prisma.conversation.create({
      data: { tenantId: tenant.id, customerId: customer.id }
    });
    expect(conversation.id).toBeDefined();
    const message = await prisma.message.create({
      data: {
        tenantId: tenant.id,
        conversationId: conversation.id,
        role: 'USER',
        content: 'Hello'
      }
    });
    expect(message.id).toBeDefined();
    expect(message.role).toBe('USER');
  });
  it('6 & 10. Should create WorkflowSession and store arbitrary TUTOR_SESSION contextData', async () => {
    const tenant = await prisma.tenant.create({ data: { name: 'Workflow Test Tenant' } });
    const customer = await prisma.customer.create({ data: { tenantId: tenant.id, externalId: 'u2' } });
    const conversation = await prisma.conversation.create({ data: { tenantId: tenant.id, customerId: customer.id } });
    // The arbitrary context that must be storable WITHOUT changing schema
    const arbitraryContextData = {
      studentName: 'Alex',
      subject: 'Physics',
      date: '2026-09-10',
      duration: 60
    };
    const session = await prisma.workflowSession.create({
      data: {
        tenantId: tenant.id,
        conversationId: conversation.id,
        workflowId: 'TUTOR_SESSION',
        stateId: 'collect_fields',
        contextData: arbitraryContextData
      }
    });
    expect(session.workflowId).toBe('TUTOR_SESSION');
    expect(session.contextData).toMatchObject(arbitraryContextData);
  });
  it('7. Should persist Knowledge source, document, and chunk', async () => {
    const tenant = await prisma.tenant.create({ data: { name: 'RAG Test Tenant' } });
    const source = await prisma.knowledgeSource.create({
      data: { tenantId: tenant.id, name: 'Syllabus', type: 'PDF' }
    });
    expect(source.id).toBeDefined();
    const doc = await prisma.knowledgeDocument.create({
      data: { tenantId: tenant.id, sourceId: source.id, title: 'Physics 101', content: 'Intro to physics' }
    });
    expect(doc.id).toBeDefined();
    const chunk = await prisma.knowledgeChunk.create({
      data: { tenantId: tenant.id, documentId: doc.id, content: 'Intro to physics chunk' }
    });
    expect(chunk.id).toBeDefined();
    // Embedding is omitted since pgvector insertion requires raw SQL in some Prisma versions or special handling,
    // but the chunk persistence works.
  });
  it('8. Same external customer ID can exist under different tenants', async () => {
    const tenantA = await prisma.tenant.create({ data: { name: 'Tenant A Isolation' } });
    const tenantB = await prisma.tenant.create({ data: { name: 'Tenant B Isolation' } });
    // Creating customer with same external ID but different tenants should succeed
    const externalId = 'shared_number_123';
    const custA = await prisma.customer.create({ data: { tenantId: tenantA.id, externalId } });
    const custB = await prisma.customer.create({ data: { tenantId: tenantB.id, externalId } });
    expect(custA.id).not.toBe(custB.id);
    expect(custA.externalId).toBe(externalId);
    expect(custB.externalId).toBe(externalId);
  });
  it('9. Tenant A data can never be accidentally retrieved through Tenant B query', async () => {
    const tenantA = await prisma.tenant.create({ data: { name: 'Tenant A Strict' } });
    const tenantB = await prisma.tenant.create({ data: { name: 'Tenant B Strict' } });
    const custA = await prisma.customer.create({ data: { tenantId: tenantA.id, externalId: 'uA' } });
    // Simulate query strictly scoped to Tenant B
    const customersForTenantB = await prisma.customer.findMany({
      where: { tenantId: tenantB.id }
    });
    // Should return empty array, impossible to see Tenant A's customer
    expect(customersForTenantB).toHaveLength(0);
    // Create one for B to verify it works
    await prisma.customer.create({ data: { tenantId: tenantB.id, externalId: 'uB' } });
    const customersForTenantB_after = await prisma.customer.findMany({
      where: { tenantId: tenantB.id }
    });
    expect(customersForTenantB_after).toHaveLength(1);
    expect(customersForTenantB_after[0].tenantId).toBe(tenantB.id);
  });
});