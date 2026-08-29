import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { bootstrapChatbot } from '../../src/bootstrap';
import { createSignedToken } from '../../src/dev/chatApi';
import { prisma } from '../../src/tests/testDb';
import { BusinessConfig, DEFAULT_BUSINESS_CONFIG } from '../../src/domain/tenant/BusinessConfig';
import { LLMMockProvider } from '../../src/core/llm/LLMProvider';

describe('PHASE ACCOUNT-ARCHITECTURE-FIX-17: Generic Account Architecture', () => {
  let app: any;
  let deps: any;
  let mockLlm: LLMMockProvider;
  const createdTenantIds: string[] = [];
  const adminToken = createSignedToken({ tenantId: 'admin-tenant', role: 'admin' });
  const authHeader = { 'Authorization': `Bearer ${adminToken}` };

  beforeEach(async () => {
    deps = bootstrapChatbot(prisma);
    mockLlm = new LLMMockProvider();
    deps.llmFactory.registerProvider('mock', 'mock-model', mockLlm);
    deps.llmFactory.registerProvider('deepseek', 'deepseek-chat', mockLlm);
    app = await createApp(deps);
  });

  afterEach(async () => {
    for (const tenantId of createdTenantIds) {
      await prisma.lead.deleteMany({ where: { tenantId } });
      await prisma.workflowSession.deleteMany({ where: { tenantId } });
      await prisma.message.deleteMany({ where: { tenantId } });
      await prisma.conversation.deleteMany({ where: { tenantId } });
      await prisma.customer.deleteMany({ where: { tenantId } });
      await prisma.account.deleteMany({ where: { tenantId } });
      await prisma.tenantConfig.deleteMany({ where: { tenantId } });
      await prisma.tenant.deleteMany({ where: { id: tenantId } });
    }
  });

  it('1. New tenant creation automatically provisions a default generic Account named "Main"', async () => {
    const tenantSlug = `tenant-gen-${Date.now()}`;
    createdTenantIds.push(tenantSlug);

    const res = await request(app)
      .post('/api/dev/tenants')
      .set(authHeader)
      .send({ name: 'Atlas Fitness Hub', id: tenantSlug })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.tenant.id).toBe(tenantSlug);
    expect(res.body.tenant.accounts).toBeDefined();
    expect(res.body.tenant.accounts.length).toBe(1);
    expect(res.body.tenant.accounts[0].name).toBe('Main');

    const accountsInDb = await prisma.account.findMany({ where: { tenantId: tenantSlug } });
    expect(accountsInDb.length).toBe(1);
    expect(accountsInDb[0].name).toBe('Main');
  });

  it('2. Retrying tenant creation fails with 409 and does not duplicate accounts', async () => {
    const tenantSlug = `tenant-dup-${Date.now()}`;
    createdTenantIds.push(tenantSlug);

    await request(app)
      .post('/api/dev/tenants')
      .set(authHeader)
      .send({ name: 'Atlas Unique', id: tenantSlug })
      .expect(201);

    const retryRes = await request(app)
      .post('/api/dev/tenants')
      .set(authHeader)
      .send({ name: 'Atlas Unique', id: tenantSlug })
      .expect(409);

    expect(retryRes.body.error).toBe('TENANT_EXISTS');

    const accountsInDb = await prisma.account.findMany({ where: { tenantId: tenantSlug } });
    expect(accountsInDb.length).toBe(1);
  });

  it('3. Workflow-only tenant (ecommerceEnabled: false) completes workflow and creates CRM Lead in default Account', async () => {
    const tenantId = `tenant-wf-${Date.now()}`;
    createdTenantIds.push(tenantId);

    const createRes = await request(app)
      .post('/api/dev/tenants')
      .set(authHeader)
      .send({ name: 'Atlas Workflow Only', id: tenantId })
      .expect(201);

    const defaultAccount = createRes.body.tenant.accounts[0];
    expect(defaultAccount).toBeDefined();

    const config: BusinessConfig = {
      ...DEFAULT_BUSINESS_CONFIG,
      identity: {
        botName: 'Atlas Bot',
        businessName: 'Atlas Gym',
        language: 'en'
      },
      capabilities: {
        ...DEFAULT_BUSINESS_CONFIG.capabilities,
        ecommerceEnabled: false, // Non-ecommerce workflow-only
        intents: [
          {
            id: 'fitness_consultation',
            description: 'Customer wants to book a fitness consultation',
            workflowId: 'fitness_consultation'
          }
        ]
      },
      workflows: {
        fitness_consultation: {
          id: 'fitness_consultation',
          name: 'Fitness Consultation',
          description: 'Booking private fitness consultations',
          initialState: 'collect_name',
          allowInterruption: true,
          states: {
            collect_name: {
              type: 'collect',
              prompt: 'What is your full name?',
              field: { name: 'userName', type: 'string', required: true },
              transitions: [{ target: 'confirm_step', default: true }]
            },
            confirm_step: {
              type: 'confirm',
              prompt: 'Confirm consultation?',
              confirmKeywords: ['yes', 'confirm', 'yeah'],
              transitions: [{ target: 'end_step', default: true }]
            },
            end_step: {
              type: 'end',
              prompt: 'Booking confirmed for {{userName}}.'
            }
          }
        }
      }
    };

    await deps.tenantConfigService.updateConfig(tenantId, config);

    mockLlm.classifyIntent = async () => 'fitness_consultation';

    const customerExternalId = `cust-wf-${Date.now()}`;

    // Turn 1: Start workflow
    const r1 = await deps.conversationEngine.handleMessage(tenantId, customerExternalId, 'I want a private session', defaultAccount.id);
    expect(r1).toContain('What is your full name?');

    // Turn 2: Collect Name
    const r2 = await deps.conversationEngine.handleMessage(tenantId, customerExternalId, 'Sarah Connor', defaultAccount.id);
    expect(r2).toContain('Confirm consultation?');

    // Turn 3: Confirm & Complete
    const r3 = await deps.conversationEngine.handleMessage(tenantId, customerExternalId, 'yeah', defaultAccount.id);
    expect(r3).toContain('Booking confirmed for Sarah Connor.');

    // Verify CRM Lead was created in default Account
    const leads = await deps.crmService.listLeads(tenantId, defaultAccount.id);
    expect(leads.length).toBe(1);
    expect(leads[0].status).toBe('NEW');
    expect(leads[0].accountId).toBe(defaultAccount.id);
  }, 25000);

  it('4. Multi-account isolation: Leads created in Account A do not leak into Account B', async () => {
    const tenantId = `tenant-multi-${Date.now()}`;
    createdTenantIds.push(tenantId);

    const createRes = await request(app)
      .post('/api/dev/tenants')
      .set(authHeader)
      .send({ name: 'Atlas Multi-Location', id: tenantId })
      .expect(201);

    const accountA = createRes.body.tenant.accounts[0];

    // Create Account B via POST /api/dev/accounts
    const accBRes = await request(app)
      .post('/api/dev/accounts?tenantId=' + tenantId)
      .set(authHeader)
      .set('x-tenant-id', tenantId)
      .send({ name: 'Downtown Branch' })
      .expect(201);

    const accountB = accBRes.body.account;
    expect(accountB.id).not.toBe(accountA.id);

    // Create a customer and lead directly in Account A
    const customer = await prisma.customer.create({
      data: { tenantId, externalId: `cust-iso-${Date.now()}` }
    });

    await deps.crmService.upsertLead(tenantId, accountA.id, customer.id, 'NEW');

    // Verify Account A has 1 lead, Account B has 0 leads
    const leadsA = await deps.crmService.listLeads(tenantId, accountA.id);
    const leadsB = await deps.crmService.listLeads(tenantId, accountB.id);

    expect(leadsA.length).toBe(1);
    expect(leadsB.length).toBe(0);
  });
});
