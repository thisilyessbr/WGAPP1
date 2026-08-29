import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, pool } from '../../src/tests/testDb';
import { bootstrapChatbot } from '../../src/bootstrap';
import { CRMService } from '../../src/domain/crm/CRMService';
import { DEFAULT_BUSINESS_CONFIG } from '../../src/domain/tenant/BusinessConfig';

describe('CRM Lead Chat Turn Integration & Failure Isolation Tests', () => {
  let deps: ReturnType<typeof bootstrapChatbot>;
  const tenantId = `crm-chat-tenant-${Date.now()}`;
  const accountId = `crm-chat-account-${Date.now()}`;
  const customerId = `crm-chat-cust-${Date.now()}`;

  beforeAll(async () => {
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

    deps = bootstrapChatbot(prisma);

    // Setup base tenant, account, product
    await prisma.tenant.create({
      data: { id: tenantId, name: 'CRM Chat Tenant' }
    });

    await prisma.account.create({
      data: {
        id: accountId,
        tenantId,
        name: 'Main Store',
        enabled: true,
        config: {
          capabilities: { ecommerceEnabled: true }
        }
      }
    });

    await prisma.product.create({
      data: {
        id: `prod-${Date.now()}`,
        tenantId,
        accountId,
        sku: 'CRM-LAPTOP-01',
        name: 'CRM Gaming Laptop',
        description: 'High power gaming laptop.',
        price: 1200,
        currency: 'USD',
        stock: 10,
        active: true,
        category: 'Laptops'
      }
    });
  });

  afterAll(async () => {
    await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  });

  it('1. Ordinary greeting does NOT create a lead', async () => {
    const response = await deps.conversationEngine.handleMessage(
      tenantId,
      customerId,
      'hello',
      accountId
    );

    expect(response).toBeDefined();

    const leads = await deps.crmService!.listLeads(tenantId, accountId);
    expect(leads.length).toBe(0);
  });

  it('2. Strong purchase intent creates a Lead automatically', async () => {
    const response = await deps.conversationEngine.handleMessage(
      tenantId,
      customerId,
      'I want to buy the CRM Gaming Laptop',
      accountId
    );

    expect(response).toBeDefined();

    const leads = await deps.crmService!.listLeads(tenantId, accountId);
    expect(leads.length).toBe(1);
    expect(leads[0].status).toBe('NEW');
    expect(leads[0].customer.externalId).toBe(customerId);
  });

  it('3. Repeated customer message does NOT create duplicate leads', async () => {
    await deps.conversationEngine.handleMessage(
      tenantId,
      customerId,
      'I want to order it now',
      accountId
    );

    const leads = await deps.crmService!.listLeads(tenantId, accountId);
    expect(leads.length).toBe(1);
  });

  it('4. CRM failure does NOT fail or interrupt the customer chatbot turn', async () => {
    // Mock crmService to throw an error
    const faultyCrmService = {
      processTurnSignal: async () => {
        throw new Error('DATABASE_CONNECTION_REFUSED_SIMULATION');
      }
    } as any;

    (deps.conversationEngine as any)['crmService'] = faultyCrmService;

    // Chat turn must succeed normally without crashing
    const response = await deps.conversationEngine.handleMessage(
      tenantId,
      `fault-cust-${Date.now()}`,
      'hello again',
      accountId
    );

    expect(response).toBeDefined();
    expect(typeof response).toBe('string');

    // Restore real CRMService
    (deps.conversationEngine as any)['crmService'] = deps.crmService;
  });

  it('5. Consultation booking workflow completion creates a Lead in CRM', async () => {
    const bookingCustId = `booking-cust-${Date.now()}`;
    await deps.tenantConfigService.updateConfig(tenantId, {
      ...DEFAULT_BUSINESS_CONFIG,
      capabilities: {
        ...DEFAULT_BUSINESS_CONFIG.capabilities,
        ecommerceEnabled: true,
        intents: [
          { id: 'consultation_booking', description: 'Book a consultation', workflowId: 'consultation_booking' }
        ]
      },
      workflows: {
        consultation_booking: {
          id: 'consultation_booking',
          name: 'Consultation Booking',
          initialState: 'ask_name',
          states: {
            ask_name: {
              type: 'collect',
              field: { name: 'name', type: 'string', required: true },
              prompt: 'Please enter your name:',
              next: 'complete'
            },
            complete: {
              type: 'end',
              prompt: 'Your consultation is booked!'
            }
          },
          activation: {
            mode: 'explicit_intent',
            intents: ['consultation_booking']
          }
        }
      }
    });

    // Start workflow
    await deps.conversationEngine.handleMessage(tenantId, bookingCustId, 'consultation_booking', accountId);
    // Complete workflow with name
    await deps.conversationEngine.handleMessage(tenantId, bookingCustId, 'John Doe', accountId);

    const leads = await deps.crmService!.listLeads(tenantId, accountId);
    const custLead = leads.find(l => l.customer.externalId === bookingCustId);
    expect(custLead).toBeDefined();
    expect(custLead?.status).toBe('NEW');
  });

  it('6. Operational feedback workflow completion does NOT create a Lead', async () => {
    const feedbackCustId = `feedback-cust-${Date.now()}`;
    await deps.tenantConfigService.updateConfig(tenantId, {
      ...DEFAULT_BUSINESS_CONFIG,
      capabilities: {
        ...DEFAULT_BUSINESS_CONFIG.capabilities,
        ecommerceEnabled: true
      },
      workflows: {
        feedback_intake_workflow: {
          id: 'feedback_intake_workflow',
          name: 'User Feedback Intake',
          initialState: 'ask_rating',
          states: {
            ask_rating: {
              type: 'collect',
              field: { name: 'rating', type: 'number', required: true },
              prompt: 'Please rate your experience from 1 to 5:',
              next: 'complete'
            },
            complete: {
              type: 'end',
              prompt: 'Thank you for your feedback!'
            }
          }
        }
      }
    });

    // Start workflow
    await deps.conversationEngine.handleMessage(tenantId, feedbackCustId, 'feedback_intake_workflow', accountId);
    // Complete workflow with rating
    await deps.conversationEngine.handleMessage(tenantId, feedbackCustId, '5', accountId);

    const leads = await deps.crmService!.listLeads(tenantId, accountId);
    const custLead = leads.find(l => l.customer.externalId === feedbackCustId);
    expect(custLead).toBeUndefined();
  });

  it('7. Operational support request workflow completion does NOT create a Lead', async () => {
    const supportCustId = `support-cust-${Date.now()}`;
    await deps.tenantConfigService.updateConfig(tenantId, {
      ...DEFAULT_BUSINESS_CONFIG,
      capabilities: {
        ...DEFAULT_BUSINESS_CONFIG.capabilities,
        ecommerceEnabled: true
      },
      workflows: {
        support_request: {
          id: 'support_request',
          name: 'Support Request',
          initialState: 'ask_issue',
          states: {
            ask_issue: {
              type: 'collect',
              field: { name: 'issue', type: 'string', required: true },
              prompt: 'What issue are you facing?',
              next: 'complete'
            },
            complete: {
              type: 'end',
              prompt: 'A ticket has been opened.'
            }
          },
          activation: {
            mode: 'explicit_intent',
            intents: ['request_support']
          }
        }
      }
    });

    // Start workflow
    await deps.conversationEngine.handleMessage(tenantId, supportCustId, 'support_request', accountId);
    // Complete workflow
    await deps.conversationEngine.handleMessage(tenantId, supportCustId, 'Login is broken', accountId);

    const leads = await deps.crmService!.listLeads(tenantId, accountId);
    const custLead = leads.find(l => l.customer.externalId === supportCustId);
    expect(custLead).toBeUndefined();
  });

  it('8. Combined Ecommerce + Booking maintains exactly 1 Lead and preserves advanced status', async () => {
    const combinedCustId = `combined-cust-${Date.now()}`;
    await deps.tenantConfigService.updateConfig(tenantId, {
      ...DEFAULT_BUSINESS_CONFIG,
      capabilities: {
        ...DEFAULT_BUSINESS_CONFIG.capabilities,
        ecommerceEnabled: true
      },
      workflows: {
        consultation_booking: {
          id: 'consultation_booking',
          name: 'Consultation Booking',
          initialState: 'ask_name',
          states: {
            ask_name: {
              type: 'collect',
              field: { name: 'name', type: 'string', required: true },
              prompt: 'Please enter your name:',
              next: 'complete'
            },
            complete: {
              type: 'end',
              prompt: 'Your consultation is booked!'
            }
          }
        }
      }
    });

    // 1. Ecommerce BUY_INTENT -> Creates Lead
    await deps.conversationEngine.handleMessage(tenantId, combinedCustId, 'I want to buy the CRM Gaming Laptop', accountId);
    let leads = await deps.crmService!.listLeads(tenantId, accountId);
    let custLead = leads.find(l => l.customer.externalId === combinedCustId);
    expect(custLead).toBeDefined();
    expect(custLead?.status).toBe('NEW');

    // 2. Advance Lead status to QUALIFIED
    await deps.crmService!.updateLeadStatus(tenantId, accountId, custLead!.id, 'QUALIFIED');

    // 3. Complete Consultation Booking
    await deps.conversationEngine.handleMessage(tenantId, combinedCustId, 'consultation_booking', accountId);
    await deps.conversationEngine.handleMessage(tenantId, combinedCustId, 'Alice Smith', accountId);

    // 4. Verify exactly 1 Lead exists and status is STILL QUALIFIED (not regressed to NEW)
    leads = await deps.crmService!.listLeads(tenantId, accountId);
    const matchingLeads = leads.filter(l => l.customer.externalId === combinedCustId);
    expect(matchingLeads.length).toBe(1);
    expect(matchingLeads[0].status).toBe('QUALIFIED');
  }, 20000);
});
