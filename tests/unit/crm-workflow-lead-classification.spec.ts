import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CRMService } from '../../src/domain/crm/CRMService';

describe('Phase CRM-WORKFLOW-FIX-04 — CRM Workflow Lead Classification Unit Tests', () => {
  let mockPrisma: any;
  let crmService: CRMService;
  const tenantId = 'test-tenant';
  const accountId = 'test-account';
  const customerId = 'test-customer';

  beforeEach(() => {
    mockPrisma = {
      lead: {
        upsert: vi.fn().mockImplementation(async ({ create, update, where }: any) => ({
          id: 'lead-uuid-1',
          tenantId: where.tenantId_accountId_customerId.tenantId,
          accountId: where.tenantId_accountId_customerId.accountId,
          customerId: where.tenantId_accountId_customerId.customerId,
          status: create?.status || 'NEW',
          createdAt: new Date(),
          updatedAt: new Date()
        })),
        findFirst: vi.fn(),
        findMany: vi.fn(),
        update: vi.fn()
      }
    };
    crmService = new CRMService(mockPrisma);
  });

  describe('1. Sales / Booking Workflows (Expected: TRUE -> Lead Created)', () => {
    it('creates lead for consultation_booking workflow', async () => {
      const result = await crmService.processTurnSignal({
        tenantId,
        accountId,
        customerId,
        isWorkflowCompleted: true,
        workflowId: 'consultation_booking',
        workflowConfig: {
          id: 'consultation_booking',
          name: 'Consultation Booking Workflow',
          activation: { intents: ['book_consultation'] }
        },
        terminalStateId: 'booking_end',
        workflowIntents: ['book_consultation']
      });

      expect(result).not.toBeNull();
      expect(mockPrisma.lead.upsert).toHaveBeenCalledTimes(1);
    });

    it('creates lead for fitness_consultation workflow', async () => {
      const result = await crmService.processTurnSignal({
        tenantId,
        accountId,
        customerId,
        isWorkflowCompleted: true,
        workflowId: 'fitness_consultation',
        workflowConfig: {
          id: 'fitness_consultation',
          name: 'Fitness Consultation',
          activation: { intents: ['fitness_consultation'] }
        },
        terminalStateId: 'confirm_step',
        workflowIntents: ['fitness_consultation']
      });

      expect(result).not.toBeNull();
      expect(mockPrisma.lead.upsert).toHaveBeenCalledTimes(1);
    });

    it('creates lead for interior_consultation workflow', async () => {
      const result = await crmService.processTurnSignal({
        tenantId,
        accountId,
        customerId,
        isWorkflowCompleted: true,
        workflowId: 'interior_consultation',
        workflowConfig: {
          id: 'interior_consultation',
          name: 'Interior Consultation',
          activation: { intents: ['interior_consultation'] }
        },
        terminalStateId: 'end_step',
        workflowIntents: ['interior_consultation']
      });

      expect(result).not.toBeNull();
      expect(mockPrisma.lead.upsert).toHaveBeenCalledTimes(1);
    });

    it('creates lead for service_selector_workflow', async () => {
      const result = await crmService.processTurnSignal({
        tenantId,
        accountId,
        customerId,
        isWorkflowCompleted: true,
        workflowId: 'service_selector_workflow',
        workflowConfig: {
          id: 'service_selector_workflow',
          name: 'Service Package Selector'
        },
        terminalStateId: 'complete'
      });

      expect(result).not.toBeNull();
      expect(mockPrisma.lead.upsert).toHaveBeenCalledTimes(1);
    });

    it('creates lead for TUTOR_SESSION workflow', async () => {
      const result = await crmService.processTurnSignal({
        tenantId,
        accountId,
        customerId,
        isWorkflowCompleted: true,
        workflowId: 'TUTOR_SESSION',
        workflowConfig: {
          id: 'TUTOR_SESSION',
          name: 'Tutor Session Booking'
        },
        workflowIntents: ['TUTOR_SESSION']
      });

      expect(result).not.toBeNull();
      expect(mockPrisma.lead.upsert).toHaveBeenCalledTimes(1);
    });
  });

  describe('2. Operational / Non-Sales Workflows (Expected: FALSE -> NO Lead)', () => {
    it('does NOT create lead for feedback_intake_workflow', async () => {
      const result = await crmService.processTurnSignal({
        tenantId,
        accountId,
        customerId,
        isWorkflowCompleted: true,
        workflowId: 'feedback_intake_workflow',
        workflowConfig: {
          id: 'feedback_intake_workflow',
          name: 'User Feedback Intake'
        },
        workflowIntents: ['feedback']
      });

      expect(result).toBeNull();
      expect(mockPrisma.lead.upsert).not.toHaveBeenCalled();
    });

    it('does NOT create lead for support_request workflow', async () => {
      const result = await crmService.processTurnSignal({
        tenantId,
        accountId,
        customerId,
        isWorkflowCompleted: true,
        workflowId: 'support_request',
        workflowConfig: {
          id: 'support_request',
          name: 'Support Request',
          activation: { intents: ['request_support'] }
        },
        workflowIntents: ['request_support', 'SUPPORT_REQUEST']
      });

      expect(result).toBeNull();
      expect(mockPrisma.lead.upsert).not.toHaveBeenCalled();
    });

    it('does NOT create lead for order_tracking workflow', async () => {
      const result = await crmService.processTurnSignal({
        tenantId,
        accountId,
        customerId,
        isWorkflowCompleted: true,
        workflowId: 'order_tracking',
        workflowConfig: {
          id: 'order_tracking',
          name: 'Order Tracking'
        },
        workflowIntents: ['TRACKING']
      });

      expect(result).toBeNull();
      expect(mockPrisma.lead.upsert).not.toHaveBeenCalled();
    });

    it('does NOT create lead for return_request workflow', async () => {
      const result = await crmService.processTurnSignal({
        tenantId,
        accountId,
        customerId,
        isWorkflowCompleted: true,
        workflowId: 'return_request',
        workflowConfig: {
          id: 'return_request',
          name: 'Return Request'
        },
        workflowIntents: ['RETURNS']
      });

      expect(result).toBeNull();
      expect(mockPrisma.lead.upsert).not.toHaveBeenCalled();
    });
  });

  describe('3. Triage Workflow Branch Discrimination', () => {
    const triageConfig = {
      id: 'triage_workflow',
      name: 'Support & Sales Triage',
      states: {
        plans: { id: 'plans', name: 'Plans', type: 'end', prompt: 'Here are our available subscription plans: Starter, Pro, Enterprise.' },
        refunds: { id: 'refunds', name: 'Refunds', type: 'end', prompt: 'Please provide your order number to initiate a refund.' },
        support: { id: 'support', name: 'Support', type: 'end', prompt: 'A support technician will join shortly.' }
      }
    };

    it('creates lead when triage completes on sales "plans" branch', async () => {
      const result = await crmService.processTurnSignal({
        tenantId,
        accountId,
        customerId,
        isWorkflowCompleted: true,
        workflowId: 'triage_workflow',
        workflowConfig: triageConfig,
        terminalStateId: 'plans'
      });

      expect(result).not.toBeNull();
      expect(mockPrisma.lead.upsert).toHaveBeenCalledTimes(1);
    });

    it('does NOT create lead when triage completes on operational "support" branch', async () => {
      const result = await crmService.processTurnSignal({
        tenantId,
        accountId,
        customerId,
        isWorkflowCompleted: true,
        workflowId: 'triage_workflow',
        workflowConfig: triageConfig,
        terminalStateId: 'support'
      });

      expect(result).toBeNull();
      expect(mockPrisma.lead.upsert).not.toHaveBeenCalled();
    });

    it('does NOT create lead when triage completes on operational "refunds" branch', async () => {
      const result = await crmService.processTurnSignal({
        tenantId,
        accountId,
        customerId,
        isWorkflowCompleted: true,
        workflowId: 'triage_workflow',
        workflowConfig: triageConfig,
        terminalStateId: 'refunds'
      });

      expect(result).toBeNull();
      expect(mockPrisma.lead.upsert).not.toHaveBeenCalled();
    });

    it('does NOT create lead when triage completes on unrecognized branch', async () => {
      const result = await crmService.processTurnSignal({
        tenantId,
        accountId,
        customerId,
        isWorkflowCompleted: true,
        workflowId: 'triage_workflow',
        workflowConfig: triageConfig,
        terminalStateId: 'unknown_branch'
      });

      expect(result).toBeNull();
      expect(mockPrisma.lead.upsert).not.toHaveBeenCalled();
    });
  });

  describe('4. Custom Unknown Workflows (Safety Principle: UNKNOWN -> NO LEAD)', () => {
    it('does NOT create lead for arbitrary custom workflow without sales intent', async () => {
      const result = await crmService.processTurnSignal({
        tenantId,
        accountId,
        customerId,
        isWorkflowCompleted: true,
        workflowId: 'workflow_custom_123',
        workflowConfig: {
          id: 'workflow_custom_123',
          name: 'Custom Form',
          description: 'A custom user flow'
        },
        terminalStateId: 'end'
      });

      expect(result).toBeNull();
      expect(mockPrisma.lead.upsert).not.toHaveBeenCalled();
    });
  });

  describe('5. Ecommerce BUY_INTENT Preservation', () => {
    it('creates lead when BUY_INTENT is present even with no workflow', async () => {
      const result = await crmService.processTurnSignal({
        tenantId,
        accountId,
        customerId,
        turnDecision: {
          domain: 'ECOMMERCE',
          intent: 'BUY_INTENT',
          source: 'ECOMMERCE',
          responseLanguage: 'en',
          responseScript: 'Latn'
        },
        isWorkflowCompleted: false,
        workflowId: null
      });

      expect(result).not.toBeNull();
      expect(mockPrisma.lead.upsert).toHaveBeenCalledTimes(1);
    });

    it('creates lead when multilingual buy phrase is in userMessage', async () => {
      const result = await crmService.processTurnSignal({
        tenantId,
        accountId,
        customerId,
        isWorkflowCompleted: false,
        userMessage: 'بغيت نشري هادشي'
      });

      expect(result).not.toBeNull();
      expect(mockPrisma.lead.upsert).toHaveBeenCalledTimes(1);
    });
  });
});
