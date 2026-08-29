import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, pool } from '../../src/tests/testDb';
import { CRMService, VALID_LEAD_STATUSES } from '../../src/domain/crm/CRMService';

describe('CRMService: Minimal Lead Unit Tests', () => {
  let crmService: CRMService;
  const tenantId = `crm-unit-tenant-${Date.now()}`;
  const accountId = `crm-unit-account-${Date.now()}`;
  const customerId = `crm-unit-cust-${Date.now()}`;

  beforeAll(async () => {
    // Ensure Lead table exists in test schema
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "test"."Lead" (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        "tenantId" TEXT NOT NULL REFERENCES "test"."Tenant"(id) ON DELETE CASCADE,
        "accountId" TEXT NOT NULL REFERENCES "test"."Account"(id) ON DELETE CASCADE,
        "customerId" TEXT NOT NULL REFERENCES "test"."Customer"(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'NEW',
        "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        CONSTRAINT "Lead_tenantId_accountId_customerId_key" UNIQUE ("tenantId", "accountId", "customerId")
      );
      CREATE INDEX IF NOT EXISTS "Lead_tenantId_accountId_status_idx" ON "test"."Lead"("tenantId", "accountId", status);
    `);

    crmService = new CRMService(prisma);

    // Setup base tenant, account, customer
    await prisma.tenant.create({
      data: { id: tenantId, name: 'CRM Unit Tenant' }
    });

    await prisma.account.create({
      data: { id: accountId, tenantId, name: 'Main Account', enabled: true }
    });

    await prisma.customer.create({
      data: { id: customerId, tenantId, externalId: 'cust-phone-123', metadata: { name: 'Alice Smith', phone: '+1234567890' } }
    });
  });

  afterAll(async () => {
    await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  });

  it('1. upsertLead() creates a new minimal Lead with default status NEW', async () => {
    const lead = await crmService.upsertLead(tenantId, accountId, customerId);

    expect(lead).toBeDefined();
    expect(lead.id).toBeDefined();
    expect(lead.tenantId).toBe(tenantId);
    expect(lead.accountId).toBe(accountId);
    expect(lead.customerId).toBe(customerId);
    expect(lead.status).toBe('NEW');
    expect(lead.createdAt).toBeInstanceOf(Date);
    expect(lead.updatedAt).toBeInstanceOf(Date);
  });

  it('2. upsertLead() is idempotent for the same customer and does NOT create a duplicate lead', async () => {
    const initialLead = await crmService.getLead(tenantId, accountId, customerId); // or by id
    const leadsBefore = await crmService.listLeads(tenantId, accountId);
    expect(leadsBefore.length).toBe(1);

    // Upsert same customer again
    const secondCall = await crmService.upsertLead(tenantId, accountId, customerId);
    expect(secondCall.id).toBe(leadsBefore[0].id);

    const leadsAfter = await crmService.listLeads(tenantId, accountId);
    expect(leadsAfter.length).toBe(1);
  });

  it('3. updateLeadStatus() successfully updates status across valid values (NEW -> CONTACTED -> QUALIFIED -> WON -> LOST)', async () => {
    const leads = await crmService.listLeads(tenantId, accountId);
    const leadId = leads[0].id;

    for (const status of VALID_LEAD_STATUSES) {
      const updated = await crmService.updateLeadStatus(tenantId, accountId, leadId, status);
      expect(updated.status).toBe(status);
    }
  });

  it('4. updateLeadStatus() rejects invalid status values', async () => {
    const leads = await crmService.listLeads(tenantId, accountId);
    const leadId = leads[0].id;

    await expect(crmService.updateLeadStatus(tenantId, accountId, leadId, 'INVALID_STATUS'))
      .rejects.toThrow(/Invalid lead status/);
  });

  it('5. getLead() returns lead with dynamically resolved customer record without duplicating customer fields in Lead', async () => {
    const leads = await crmService.listLeads(tenantId, accountId);
    const leadId = leads[0].id;

    const leadWithCustomer = await crmService.getLead(tenantId, accountId, leadId);
    expect(leadWithCustomer).toBeDefined();
    expect(leadWithCustomer!.customer).toBeDefined();
    expect(leadWithCustomer!.customer.id).toBe(customerId);
    expect(leadWithCustomer!.customer.externalId).toBe('cust-phone-123');
    expect((leadWithCustomer!.customer.metadata as any).name).toBe('Alice Smith');

    // Lead entity itself only contains minimal fields
    const leadKeys = Object.keys(leadWithCustomer!).filter(k => k !== 'customer');
    expect(leadKeys.sort()).toEqual(['accountId', 'createdAt', 'customerId', 'id', 'status', 'tenantId', 'updatedAt'].sort());
  });

  it('6. listLeads() filters by status correctly', async () => {
    // Create second customer and mark as WON
    const cust2Id = `crm-unit-cust2-${Date.now()}`;
    await prisma.customer.create({
      data: { id: cust2Id, tenantId, externalId: 'cust-phone-456' }
    });
    const lead2 = await crmService.upsertLead(tenantId, accountId, cust2Id, 'WON');

    const wonLeads = await crmService.listLeads(tenantId, accountId, 'WON');
    expect(wonLeads.length).toBe(1);
    expect(wonLeads[0].customerId).toBe(cust2Id);

    const allLeads = await crmService.listLeads(tenantId, accountId);
    expect(allLeads.length).toBe(2);
  });
});
