import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import { prisma, pool } from '../../src/tests/testDb';
import { bootstrapChatbot } from '../../src/bootstrap';
import { createSignedToken } from '../../src/dev/chatApi';
import { createApp } from '../../src/app';

describe('CRM Lead Isolation & Authorization Integration Tests', () => {
  let app: express.Application;
  const tenantA = `crm-iso-tenantA-${Date.now()}`;
  const tenantB = `crm-iso-tenantB-${Date.now()}`;
  const accA1 = `crm-iso-accA1-${Date.now()}`;
  const accA2 = `crm-iso-accA2-${Date.now()}`;
  const accB1 = `crm-iso-accB1-${Date.now()}`;

  const custA1 = `crm-iso-custA1-${Date.now()}`;
  const custB1 = `crm-iso-custB1-${Date.now()}`;

  let tokenA: string;
  let tokenB: string;

  beforeAll(async () => {
    process.env.STRICT_AUTH = 'true';

    // Ensure Lead table exists
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

    const deps = bootstrapChatbot(prisma);
    app = await createApp(deps);

    // Setup Tenant A & accounts
    await prisma.tenant.create({ data: { id: tenantA, name: 'Tenant A' } });
    await prisma.account.create({ data: { id: accA1, tenantId: tenantA, name: 'Store A1', enabled: true } });
    await prisma.account.create({ data: { id: accA2, tenantId: tenantA, name: 'Store A2', enabled: true } });
    await prisma.customer.create({ data: { id: custA1, tenantId: tenantA, externalId: 'phone-A1' } });

    // Setup Tenant B & accounts
    await prisma.tenant.create({ data: { id: tenantB, name: 'Tenant B' } });
    await prisma.account.create({ data: { id: accB1, tenantId: tenantB, name: 'Store B1', enabled: true } });
    await prisma.customer.create({ data: { id: custB1, tenantId: tenantB, externalId: 'phone-B1' } });

    // Populate Leads
    await deps.crmService!.upsertLead(tenantA, accA1, custA1, 'NEW');
    await deps.crmService!.upsertLead(tenantB, accB1, custB1, 'QUALIFIED');

    tokenA = createSignedToken({ tenantId: tenantA, role: 'admin' });
    tokenB = createSignedToken({ tenantId: tenantB, role: 'admin' });
  });

  afterAll(async () => {
    delete process.env.STRICT_AUTH;
    await prisma.tenant.delete({ where: { id: tenantA } }).catch(() => {});
    await prisma.tenant.delete({ where: { id: tenantB } }).catch(() => {});
  });

  it('1. GET /api/v1/crm/leads requires authentication (401 without token)', async () => {
    const res = await request(app)
      .get('/api/v1/crm/leads')
      .query({ accountId: accA1 });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('UNAUTHORIZED');
  });

  it('2. GET /api/v1/crm/leads returns only Tenant A leads and never leaks Tenant B leads', async () => {
    const resA = await request(app)
      .get('/api/v1/crm/leads')
      .set('Authorization', `Bearer ${tokenA}`)
      .query({ accountId: accA1 });

    expect(resA.status).toBe(200);
    expect(resA.body.success).toBe(true);
    expect(resA.body.count).toBe(1);
    expect(resA.body.leads[0].customerId).toBe(custA1);
    expect(resA.body.leads[0].tenantId).toBe(tenantA);

    // Tenant B leads
    const resB = await request(app)
      .get('/api/v1/crm/leads')
      .set('Authorization', `Bearer ${tokenB}`)
      .query({ accountId: accB1 });

    expect(resB.status).toBe(200);
    expect(resB.body.count).toBe(1);
    expect(resB.body.leads[0].customerId).toBe(custB1);
    expect(resB.body.leads[0].tenantId).toBe(tenantB);
  });

  it('3. GET /api/v1/crm/leads enforces account isolation within the same tenant', async () => {
    // Querying Account A2 (which has no leads yet) returns empty list, not Account A1 leads
    const resA2 = await request(app)
      .get('/api/v1/crm/leads')
      .set('Authorization', `Bearer ${tokenA}`)
      .query({ accountId: accA2 });

    expect(resA2.status).toBe(200);
    expect(resA2.body.count).toBe(0);
    expect(resA2.body.leads).toEqual([]);
  });

  it('4. Cross-tenant account access is rejected (Tenant A cannot query Tenant B account)', async () => {
    const res = await request(app)
      .get('/api/v1/crm/leads')
      .set('Authorization', `Bearer ${tokenA}`)
      .query({ accountId: accB1 }); // accB1 belongs to Tenant B!

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('INVALID_ACCOUNT');
  });

  it('5. PATCH /api/v1/crm/leads/:id allows status updates within authorized tenant and account', async () => {
    const leads = (await request(app)
      .get('/api/v1/crm/leads')
      .set('Authorization', `Bearer ${tokenA}`)
      .query({ accountId: accA1 })).body.leads;

    const leadId = leads[0].id;

    const patchRes = await request(app)
      .patch(`/api/v1/crm/leads/${leadId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ accountId: accA1, status: 'CONTACTED' });

    expect(patchRes.status).toBe(200);
    expect(patchRes.body.success).toBe(true);
    expect(patchRes.body.lead.status).toBe('CONTACTED');
  });

  it('6. PATCH /api/v1/crm/leads/:id rejects unauthorized cross-tenant mutations', async () => {
    // Tenant B tries to update Tenant A's lead
    const leadsA = (await request(app)
      .get('/api/v1/crm/leads')
      .set('Authorization', `Bearer ${tokenA}`)
      .query({ accountId: accA1 })).body.leads;

    const leadAId = leadsA[0].id;

    const res = await request(app)
      .patch(`/api/v1/crm/leads/${leadAId}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ accountId: accB1, status: 'WON' });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('NOT_FOUND');
  });
});
