import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../../src/tests/testDb';
import { OutcomeTrackingService } from '../../src/domain/outcome/OutcomeTrackingService';
import { ConversationEngine } from '../../src/domain/conversation/ConversationEngine';
import { ConversationService } from '../../src/domain/conversation/ConversationService';
import { TenantConfigService } from '../../src/domain/tenant/TenantConfigService';
import { AccountConfigService } from '../../src/domain/tenant/AccountConfigService';
import { WorkflowEngine } from '../../src/core/engine/WorkflowEngine';
import { WorkflowStateEvaluator } from '../../src/core/engine/WorkflowStateEvaluator';
import { ResponseBuilder } from '../../src/domain/conversation/ResponseBuilder';
import { FieldValidator } from '../../src/core/engine/FieldValidator';
import { LLMMockProvider } from '../../src/core/llm/LLMProvider';
import { DEFAULT_BUSINESS_CONFIG } from '../../src/domain/tenant/BusinessConfig';

describe('Workflow Outcome Controls & Precedence Integration Tests', () => {
  let outcomeService: OutcomeTrackingService;
  let conversationService: ConversationService;
  let tenantConfigService: TenantConfigService;
  let accountConfigService: AccountConfigService;
  let workflowEngine: WorkflowEngine;
  let builder: ResponseBuilder;
  let engine: ConversationEngine;

  let tenantId: string;
  let accountId: string;
  let customerId: string;

  beforeAll(async () => {
    outcomeService = new OutcomeTrackingService(prisma);
    conversationService = new ConversationService(prisma);
    tenantConfigService = new TenantConfigService(prisma);
    accountConfigService = new AccountConfigService(prisma, tenantConfigService);

    const validator = new FieldValidator();
    const evaluator = new WorkflowStateEvaluator(validator);
    builder = new ResponseBuilder();
    workflowEngine = new WorkflowEngine(evaluator, builder);

    engine = new ConversationEngine(
      conversationService,
      tenantConfigService,
      workflowEngine,
      new LLMMockProvider(),
      builder,
      undefined, // ragService
      undefined, // imageGateway
      undefined, // capabilityRouter
      accountConfigService,
      undefined, // ecommerceService
      undefined, // crmService
      undefined, // portalBudget
      outcomeService
    );

    tenantId = `wf-ten-${Date.now()}`;
    accountId = `wf-acct-${Date.now()}`;
    customerId = `wf-cust-${Date.now()}`;

    await prisma.tenant.create({
      data: { id: tenantId, name: 'Workflow Outcome Tenant' }
    });

    await prisma.account.create({
      data: { id: accountId, tenantId, name: 'Workflow Outcome Account', enabled: true }
    });

    await prisma.customer.create({
      data: { id: customerId, tenantId, externalId: customerId }
    });
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(`
      DELETE FROM "OutcomeEvent" WHERE "tenantId" = '${tenantId}';
      DELETE FROM "Message" WHERE "tenantId" = '${tenantId}';
      DELETE FROM "WorkflowSession" WHERE "tenantId" = '${tenantId}';
      DELETE FROM "Conversation" WHERE "tenantId" = '${tenantId}';
      DELETE FROM "Customer" WHERE "tenantId" = '${tenantId}';
      DELETE FROM "Account" WHERE "tenantId" = '${tenantId}';
      DELETE FROM "Tenant" WHERE id = '${tenantId}';
    `);
  });

  it('1. Workflow-level BOOKING_CONFIRMED emits outcome event on terminal completion', async () => {
    const bookingWorkflowId = 'consultation_booking';
    const baseConfig = JSON.parse(JSON.stringify(DEFAULT_BUSINESS_CONFIG));
    baseConfig.identity.currency = 'MAD';
    baseConfig.workflows = {
      [bookingWorkflowId]: {
        id: bookingWorkflowId,
        name: 'Consultation Booking',
        initialState: 'start',
        outcome: {
          type: 'BOOKING_CONFIRMED'
        },
        activation: {
          mode: 'explicit_intent',
          keywords: ['book consultation']
        },
        states: {
          start: {
            name: 'Collect Name',
            type: 'collect',
            prompt: 'Please enter your name:',
            field: { name: 'fullName', type: 'string', required: true },
            next: 'done'
          },
          done: {
            name: 'Confirmation',
            type: 'end',
            prompt: 'Your booking is confirmed!'
          }
        }
      }
    };

    await tenantConfigService.updateConfig(tenantId, baseConfig);

    // Turn 1: Trigger workflow
    const r1 = await engine.handleMessage(
      tenantId,
      customerId,
      'I want to book consultation',
      accountId,
      { externalMessageId: `msg-book-1-${Date.now()}` }
    );
    expect(r1).toContain('Please enter your name:');

    // Turn 2: Provide name -> completes workflow at 'done'
    const r2 = await engine.handleMessage(
      tenantId,
      customerId,
      'Karim Bennani',
      accountId,
      { externalMessageId: `msg-book-2-${Date.now()}` }
    );
    expect(r2).toContain('Your booking is confirmed!');

    // Verify outcome event
    const events = await outcomeService.listEvents({
      tenantId,
      accountId,
      type: 'BOOKING_CONFIRMED'
    });

    expect(events.events.length).toBe(1);
    expect(events.events[0].type).toBe('BOOKING_CONFIRMED');
    expect(events.events[0].source).toBe('WORKFLOW');
    expect((events.events[0].metadata as any).workflowId).toBe(bookingWorkflowId);
    expect((events.events[0].metadata as any).terminalStateId).toBe('done');
  });

  it('2. Workflow-level ORDER_CONFIRMED extracts valueField and currencyField from collected context data', async () => {
    const orderWorkflowId = 'order_flow';
    const baseConfig = JSON.parse(JSON.stringify(DEFAULT_BUSINESS_CONFIG));
    baseConfig.identity.currency = 'MAD';
    baseConfig.workflows = {
      [orderWorkflowId]: {
        id: orderWorkflowId,
        name: 'Order Placement',
        initialState: 'ask_amount',
        outcome: {
          type: 'ORDER_CONFIRMED',
          valueField: 'totalAmount',
          currencyField: 'orderCurrency'
        },
        activation: {
          mode: 'explicit_intent',
          keywords: ['order shoes']
        },
        states: {
          ask_amount: {
            name: 'Order Amount',
            type: 'collect',
            prompt: 'Enter order total amount:',
            field: { name: 'totalAmount', type: 'number', required: true },
            next: 'ask_curr'
          },
          ask_curr: {
            name: 'Order Currency',
            type: 'collect',
            prompt: 'Enter order currency code (USD, MAD, EUR):',
            field: { name: 'orderCurrency', type: 'string', required: true },
            next: 'finish'
          },
          finish: {
            name: 'Order Finish',
            type: 'end',
            prompt: 'Order placed successfully!'
          }
        }
      }
    };

    await tenantConfigService.updateConfig(tenantId, baseConfig);

    const convCust = await prisma.customer.create({
      data: { tenantId, externalId: `cust-order-${Date.now()}` }
    });

    // Turn 1: Trigger
    await engine.handleMessage(
      tenantId,
      convCust.externalId,
      'I want to order shoes',
      accountId,
      { externalMessageId: `msg-ord-1-${Date.now()}` }
    );

    // Turn 2: Total amount
    await engine.handleMessage(
      tenantId,
      convCust.externalId,
      '750.50',
      accountId,
      { externalMessageId: `msg-ord-2-${Date.now()}` }
    );

    // Turn 3: Currency code -> reaches finish end step
    const r3 = await engine.handleMessage(
      tenantId,
      convCust.externalId,
      'USD',
      accountId,
      { externalMessageId: `msg-ord-3-${Date.now()}` }
    );
    expect(r3).toContain('Order placed successfully!');

    // Verify ORDER_CONFIRMED event
    const events = await outcomeService.listEvents({
      tenantId,
      accountId,
      type: 'ORDER_CONFIRMED'
    });

    expect(events.events.length).toBe(1);
    expect(events.events[0].type).toBe('ORDER_CONFIRMED');
    expect(Number(events.events[0].value)).toBe(750.5);
    expect(events.events[0].currency).toBe('USD');
  });

  it('3. Precedence: Terminal state override outcome: { type: "none" } suppresses outcome emission', async () => {
    const cancelWorkflowId = 'approval_flow';
    const baseConfig = JSON.parse(JSON.stringify(DEFAULT_BUSINESS_CONFIG));
    baseConfig.identity.currency = 'MAD';
    baseConfig.workflows = {
      [cancelWorkflowId]: {
        id: cancelWorkflowId,
        name: 'Approval Flow',
        initialState: 'choice_step',
        outcome: {
          type: 'ORDER_CONFIRMED',
          valueField: 'totalPrice'
        },
        activation: {
          mode: 'explicit_intent',
          keywords: ['purchase item']
        },
        states: {
          choice_step: {
            name: 'Review Order',
            type: 'choice',
            prompt: 'Do you want to confirm or reject your order?',
            options: [
              { label: 'Reject', next: 'cancel_end' },
              { label: 'Confirm', next: 'success_end' }
            ]
          },
          cancel_end: {
            name: 'Order Cancelled',
            type: 'end',
            prompt: 'Order cancelled.',
            outcome: {
              type: 'none' // Explicit terminal override: suppresses ORDER_CONFIRMED!
            }
          },
          success_end: {
            name: 'Order Success',
            type: 'end',
            prompt: 'Thank you for your order!'
            // No override: inherits workflow-level ORDER_CONFIRMED
          }
        }
      }
    };

    await tenantConfigService.updateConfig(tenantId, baseConfig);

    const cancelCust = await prisma.customer.create({
      data: { tenantId, externalId: `cust-cancel-${Date.now()}` }
    });

    // Turn 1: Trigger
    await engine.handleMessage(
      tenantId,
      cancelCust.externalId,
      'purchase item',
      accountId,
      { externalMessageId: `msg-c-1-${Date.now()}` }
    );

    // Turn 2: Select 'Reject' -> routes to cancel_end which has outcome: { type: 'none' }
    const r2 = await engine.handleMessage(
      tenantId,
      cancelCust.externalId,
      'Reject',
      accountId,
      { externalMessageId: `msg-c-2-${Date.now()}` }
    );
    expect(r2).toContain('Order cancelled.');

    // Verify NO new ORDER_CONFIRMED outcome event was recorded for this customer
    const events = await prisma.outcomeEvent.findMany({
      where: {
        tenantId,
        accountId,
        customerId: cancelCust.id
      }
    });

    expect(events.length).toBe(0);
  });

  it('4. Precedence: Terminal state override to BOOKING_CONFIRMED overrides workflow-level ORDER_CONFIRMED', async () => {
    const mixedWorkflowId = 'mixed_flow';
    const baseConfig = JSON.parse(JSON.stringify(DEFAULT_BUSINESS_CONFIG));
    baseConfig.identity.currency = 'MAD';
    baseConfig.workflows = {
      [mixedWorkflowId]: {
        id: mixedWorkflowId,
        name: 'Mixed Flow',
        initialState: 'choose_path',
        outcome: {
          type: 'ORDER_CONFIRMED', // Workflow default
          valueField: 'amount'
        },
        activation: {
          mode: 'explicit_intent',
          keywords: ['schedule consultation instead']
        },
        states: {
          choose_path: {
            name: 'Choose',
            type: 'choice',
            prompt: 'Choose next action:\n1. Book Appointment',
            options: [
              { label: 'Book Appointment', next: 'appointment_end' }
            ]
          },
          appointment_end: {
            name: 'Appointment Booked',
            type: 'end',
            prompt: 'Consultation appointment scheduled!',
            outcome: {
              type: 'BOOKING_CONFIRMED' // Terminal state overrides ORDER_CONFIRMED
            }
          }
        }
      }
    };

    await tenantConfigService.updateConfig(tenantId, baseConfig);

    const mixCust = await prisma.customer.create({
      data: { tenantId, externalId: `cust-mix-${Date.now()}` }
    });

    // Turn 1: Trigger
    await engine.handleMessage(
      tenantId,
      mixCust.externalId,
      'schedule consultation instead',
      accountId,
      { externalMessageId: `msg-m-1-${Date.now()}` }
    );

    // Turn 2: Choose Book Appointment -> reaches appointment_end
    const r2 = await engine.handleMessage(
      tenantId,
      mixCust.externalId,
      '1',
      accountId,
      { externalMessageId: `msg-m-2-${Date.now()}` }
    );
    expect(r2).toContain('Consultation appointment scheduled!');

    // Verify outcome recorded is BOOKING_CONFIRMED, not ORDER_CONFIRMED
    const events = await prisma.outcomeEvent.findMany({
      where: {
        tenantId,
        accountId,
        customerId: mixCust.id
      }
    });

    expect(events.length).toBe(1);
    expect(events[0].type).toBe('BOOKING_CONFIRMED');
    expect(events[0].source).toBe('WORKFLOW');
  });

  it('5. Fallback currency defaults safely to business currency when currencyField is not configured', async () => {
    const fallbackWorkflowId = 'fallback_curr_flow';
    const baseConfig = JSON.parse(JSON.stringify(DEFAULT_BUSINESS_CONFIG));
    baseConfig.identity.currency = 'EUR'; // Business default currency
    baseConfig.workflows = {
      [fallbackWorkflowId]: {
        id: fallbackWorkflowId,
        name: 'Fallback Currency Flow',
        initialState: 'collect_val',
        outcome: {
          type: 'ORDER_CONFIRMED',
          valueField: 'price'
          // currencyField omitted!
        },
        activation: {
          mode: 'explicit_intent',
          keywords: ['order with default currency']
        },
        states: {
          collect_val: {
            name: 'Price',
            type: 'collect',
            prompt: 'Enter price:',
            field: { name: 'price', type: 'number', required: true },
            next: 'end_step'
          },
          end_step: {
            name: 'End Step',
            type: 'end',
            prompt: 'Done with fallback currency!'
          }
        }
      }
    };

    await tenantConfigService.updateConfig(tenantId, baseConfig);

    const currCust = await prisma.customer.create({
      data: { tenantId, externalId: `cust-curr-${Date.now()}` }
    });

    // Turn 1
    await engine.handleMessage(
      tenantId,
      currCust.externalId,
      'order with default currency',
      accountId,
      { externalMessageId: `msg-fc-1-${Date.now()}` }
    );

    // Turn 2 -> provides 99.00 -> reaches end_step
    await engine.handleMessage(
      tenantId,
      currCust.externalId,
      '99',
      accountId,
      { externalMessageId: `msg-fc-2-${Date.now()}` }
    );

    const events = await prisma.outcomeEvent.findMany({
      where: {
        tenantId,
        accountId,
        customerId: currCust.id,
        type: 'ORDER_CONFIRMED'
      }
    });

    expect(events.length).toBe(1);
    expect(Number(events[0].value)).toBe(99);
    expect(events[0].currency).toBe('EUR'); // Fell back to identity.currency
  });
});
