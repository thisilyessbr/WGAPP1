import { PrismaClient, Lead, Customer } from '@prisma/client';
import { TurnDecision } from '../conversation/TurnDecision';
import { logger } from '../../utils/logger';

export const VALID_LEAD_STATUSES = ['NEW', 'CONTACTED', 'QUALIFIED', 'WON', 'LOST'] as const;
export type LeadStatus = typeof VALID_LEAD_STATUSES[number];

export interface LeadWithCustomer extends Lead {
  customer: Customer;
}

export interface TurnSignalParams {
  tenantId: string;
  accountId?: string | null;
  customerId: string;
  conversationId?: string;
  turnDecision?: TurnDecision | null;
  isWorkflowCompleted?: boolean;
  workflowId?: string | null;
  workflowConfig?: any | null;
  terminalStateId?: string | null;
  workflowIntents?: string[] | null;
  userMessage?: string;
}

export class CRMService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Deterministically classifies whether a completed workflow is sales/booking/lead-generating.
   * UNKNOWN defaults safely to false (NO LEAD).
   * 0 LLM calls, 0 embeddings, 0 extra DB queries.
   */
  private isLeadGeneratingWorkflow(params: {
    workflowId: string;
    workflowConfig?: any | null;
    terminalStateId?: string | null;
    workflowIntents?: string[] | null;
  }): boolean {
    const { workflowId, workflowConfig, terminalStateId, workflowIntents } = params;

    const normalizedWfId = (workflowId || '').toLowerCase().trim();
    if (!normalizedWfId) return false;

    // Collect all associated intent identifiers
    const intents: string[] = [];
    if (workflowIntents && Array.isArray(workflowIntents)) {
      intents.push(...workflowIntents);
    }
    if (workflowConfig?.activation?.intents && Array.isArray(workflowConfig.activation.intents)) {
      intents.push(...workflowConfig.activation.intents);
    }

    const normalizedIntents = intents.map(i => (i || '').toLowerCase().trim()).filter(Boolean);

    // 1. Operational Intent Disqualification (Highest Precedence)
    // If workflow explicitly declares operational/support/feedback intents and no sales intent
    const OPERATIONAL_INTENTS = ['support', 'support_request', 'request_support', 'tracking', 'order_tracking', 'returns', 'return', 'return_request', 'feedback', 'survey', 'help', 'issue', 'ticket', 'faq'];
    const hasExplicitOperationalIntent = normalizedIntents.some(i => OPERATIONAL_INTENTS.includes(i) || OPERATIONAL_INTENTS.some(op => i.includes(op)));

    // 2. Explicit Sales / Booking Intent Linkage (STRONG)
    const SALES_INTENTS = ['booking', 'book_consultation', 'consultation_booking', 'consultation', 'fitness_consultation', 'interior_consultation', 'lead', 'quote', 'appointment', 'service_selector', 'tutor_session', 'order', 'checkout', 'pricing'];
    const hasExplicitSalesIntent = normalizedIntents.some(i => SALES_INTENTS.includes(i) || SALES_INTENTS.some(s => i.includes(s)));

    if (hasExplicitSalesIntent && !hasExplicitOperationalIntent) {
      return true;
    }
    if (hasExplicitOperationalIntent && !hasExplicitSalesIntent) {
      return false;
    }

    // 3. Triage / Path-dependent Branch Analysis
    if (normalizedWfId.includes('triage')) {
      if (terminalStateId) {
        const termLower = terminalStateId.toLowerCase().trim();
        const terminalStateConfig = workflowConfig?.states ? workflowConfig.states[terminalStateId] : null;
        const promptText = typeof terminalStateConfig?.prompt === 'string' ? terminalStateConfig.prompt.toLowerCase() : '';

        // Only sales branches (e.g. plans, pricing, sales) qualify as lead
        if (['plans', 'pricing', 'sales', 'quote', 'buy'].includes(termLower) || promptText.includes('plan') || promptText.includes('pricing')) {
          return true;
        }
        // Support, refund, or other triage branches do not qualify
        return false;
      }
      return false;
    }

    // 4. Workflow ID Semantic Conventions (Secondary Support)
    const SALES_WF_PATTERNS = /(?:consultation|booking|lead_capture|leadcapture|quote|appointment|service_selector|tutor_session)/i;
    const OPERATIONAL_WF_PATTERNS = /(?:support|tracking|return|feedback|survey|issue|ticket|help)/i;

    if (SALES_WF_PATTERNS.test(normalizedWfId) && !OPERATIONAL_WF_PATTERNS.test(normalizedWfId)) {
      return true;
    }
    if (OPERATIONAL_WF_PATTERNS.test(normalizedWfId)) {
      return false;
    }

    // 5. Default Safety Rule: UNKNOWN = FALSE
    return false;
  }

  /**
   * Upserts a minimal Lead record for a customer in a specific account.
   * Idempotent per (tenantId, accountId, customerId).
   */
  async upsertLead(tenantId: string, accountId: string, customerId: string, status: LeadStatus = 'NEW'): Promise<Lead> {
    if (!tenantId || !accountId || !customerId) {
      throw new Error('CRMService: tenantId, accountId, and customerId are required for upsertLead');
    }

    if (!VALID_LEAD_STATUSES.includes(status)) {
      throw new Error(`CRMService: Invalid lead status "${status}". Allowed values: ${VALID_LEAD_STATUSES.join(', ')}`);
    }

    return this.prisma.lead.upsert({
      where: {
        tenantId_accountId_customerId: {
          tenantId,
          accountId,
          customerId
        }
      },
      create: {
        tenantId,
        accountId,
        customerId,
        status
      },
      update: {
        // If lead already exists, touch updatedAt without overwriting advanced pipeline status unless specified
      }
    });
  }

  /**
   * Updates the pipeline status of an existing lead.
   * Strictly scoped to tenantId and accountId.
   */
  async updateLeadStatus(tenantId: string, accountId: string, leadId: string, status: string): Promise<Lead> {
    if (!VALID_LEAD_STATUSES.includes(status as LeadStatus)) {
      throw new Error(`CRMService: Invalid lead status "${status}". Allowed values: ${VALID_LEAD_STATUSES.join(', ')}`);
    }

    // Verify lead existence and ownership
    const existing = await this.prisma.lead.findFirst({
      where: {
        id: leadId,
        tenantId,
        accountId
      }
    });

    if (!existing) {
      throw new Error(`CRMService: Lead [${leadId}] not found for tenant [${tenantId}] and account [${accountId}]`);
    }

    return this.prisma.lead.update({
      where: { id: leadId },
      data: { status }
    });
  }

  /**
   * Retrieves a single lead with customer information dynamically resolved from Customer table.
   */
  async getLead(tenantId: string, accountId: string, leadId: string): Promise<LeadWithCustomer | null> {
    return this.prisma.lead.findFirst({
      where: {
        id: leadId,
        tenantId,
        accountId
      },
      include: {
        customer: true
      }
    });
  }

  /**
   * Lists leads for an account with optional status filter.
   */
  async listLeads(tenantId: string, accountId: string, status?: string): Promise<LeadWithCustomer[]> {
    const where: any = {
      tenantId,
      accountId
    };

    if (status && VALID_LEAD_STATUSES.includes(status as LeadStatus)) {
      where.status = status;
    }

    return this.prisma.lead.findMany({
      where,
      include: {
        customer: true
      },
      orderBy: {
        updatedAt: 'desc'
      }
    });
  }

  /**
   * Analyzes in-memory turn decision signals post-turn.
   * Strong purchase/booking signals create or update a Lead.
   * 0 LLM calls, 0 embeddings, 0 vector queries.
   */
  async processTurnSignal(params: TurnSignalParams): Promise<Lead | null> {
    const {
      tenantId,
      accountId,
      customerId,
      turnDecision,
      isWorkflowCompleted,
      workflowId,
      workflowConfig,
      terminalStateId,
      workflowIntents,
      userMessage
    } = params;

    if (!tenantId || !accountId || !customerId) {
      return null;
    }

    let isStrongSignal = false;

    // 1. Workflow completed (sales/booking workflows only)
    if (isWorkflowCompleted && workflowId) {
      if (this.isLeadGeneratingWorkflow({ workflowId, workflowConfig, terminalStateId, workflowIntents })) {
        isStrongSignal = true;
      }
    }

    // 2. Turn decision contains explicit sales intent
    if (turnDecision) {
      const intentUpper = (turnDecision.intent || '').toUpperCase();
      if (['BUY_INTENT', 'BOOKING_INTENT', 'ORDER_INTENT', 'PURCHASE'].includes(intentUpper)) {
        isStrongSignal = true;
      }
    }

    // 3. User message keywords check for explicit buy/order phrases in Arabic/Darija/French/English
    if (!isStrongSignal && userMessage) {
      const lower = userMessage.toLowerCase().trim();
      const buyPhrases = [
        'i want to buy', 'i want to order', 'how to buy', 'place order',
        'bghit nchri', 'bghit ncommandi', 'kifash nchri', 'kifesh nechri',
        'je veux acheter', 'je veux commander', 'comment acheter', 'passer commande',
        'أريد الشراء', 'أريد الطلب', 'كيفية الشراء', 'بغيت نشري', 'بغيت نكوموندي'
      ];
      if (buyPhrases.some(phrase => lower.includes(phrase))) {
        isStrongSignal = true;
      }
    }

    if (isStrongSignal) {
      logger.info(`CRMService: Strong sales signal detected for customer [${customerId}] in account [${accountId}]. Upserting lead.`);
      return this.upsertLead(tenantId, accountId, customerId, 'NEW');
    }

    return null;
  }
}
