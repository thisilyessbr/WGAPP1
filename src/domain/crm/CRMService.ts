import { PrismaClient, Lead, Customer } from '@prisma/client';
import { TurnDecision } from '../conversation/TurnDecision';
import { logger } from '../../utils/logger';
import { isActionNegated } from '../conversation/IntentLanguage';
import { IntentTriggerLibrary, TriggerUseCase } from '../conversation/IntentTriggerLibrary';

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
  phoneNumberId?: string | null;
  workflowSessionId?: string | null;
  turnDecision?: TurnDecision | null;
  isWorkflowCompleted?: boolean;
  workflowId?: string | null;
  workflowConfig?: any | null;
  terminalStateId?: string | null;
  workflowIntents?: string[] | null;
  userMessage?: string;
  /** Use the conversation router's interpretation instead of parsing the text again. */
  recognizedUseCases?: TriggerUseCase[];
  leadMode?: 'NONE' | 'SERVICE' | 'COMMERCE' | 'BOTH';
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
    // A cancelled COD confirmation also ends the workflow. Only the actual end step is a lead.
    if (/(?:checkout|cash_on_delivery|cod_order)/i.test(normalizedWfId)
      && (!terminalStateId || workflowConfig?.states?.[terminalStateId]?.type !== 'end')) return false;

    // Published workflow outcomes are authoritative. Legacy name-based
    // classification remains only for older configurations without this field.
    if (typeof workflowConfig?.outcome?.createLead === 'boolean') {
      return workflowConfig.outcome.createLead;
    }

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
    const SALES_INTENTS = ['booking', 'book_consultation', 'consultation_booking', 'consultation', 'fitness_consultation', 'interior_consultation', 'lead', 'quote', 'appointment', 'service_selector', 'tutor_session', 'demo', 'product_demo', 'request_demo', 'order', 'checkout', 'pricing'];
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
    const SALES_WF_PATTERNS = /(?:consultation|booking|lead_capture|leadcapture|quote|appointment|service_selector|tutor_session|demo|product_demo|request_demo|checkout|cash_on_delivery|cod_order)/i;
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

  /** Reuse an open request, but retain closed requests when the customer returns. */
  async upsertLead(tenantId: string, accountId: string, customerId: string, status: LeadStatus = 'NEW', signal?: { interest?: string; reason?: string; conversationId?: string; workflowSessionId?: string | null; phoneNumberId?: string | null }): Promise<Lead> {
    if (!tenantId || !accountId || !customerId) {
      throw new Error('CRMService: tenantId, accountId, and customerId are required for upsertLead');
    }

    if (!VALID_LEAD_STATUSES.includes(status)) {
      throw new Error(`CRMService: Invalid lead status "${status}". Allowed values: ${VALID_LEAD_STATUSES.join(', ')}`);
    }

    return this.prisma.$transaction(async tx => {
      // Serialize requests from the same customer before inspecting the open lead.
      const ownership = await tx.$queryRaw<any[]>`SELECT c.id FROM "Customer" c JOIN "Account" a ON a."tenantId"=c."tenantId"
        WHERE c.id=${customerId} AND c."tenantId"=${tenantId} AND a.id=${accountId} FOR UPDATE OF c`;
      if (!ownership.length) throw new Error('CRM_ACCOUNT_CUSTOMER_MISMATCH');
      const scope = { tenantId, accountId, customerId };
      if (signal?.workflowSessionId) {
        const matching = await tx.lead.findFirst({ where: { ...scope, sourceWorkflowSessionId: signal.workflowSessionId } });
        if (matching) return matching;
        const pending = await tx.lead.findFirst({
          where: { ...scope, sourceConversationId: signal.conversationId || null,
            sourceWorkflowSessionId: null, status: { in: ['NEW', 'CONTACTED', 'QUALIFIED'] } },
          orderBy: { createdAt: 'desc' }
        });
        if (pending) return tx.lead.update({ where: { id: pending.id }, data: {
          sourceWorkflowSessionId: signal.workflowSessionId, signalReason: signal.reason || pending.signalReason
        } });
      } else {
        const open = await tx.lead.findFirst({
          where: { ...scope, status: { in: ['NEW', 'CONTACTED', 'QUALIFIED'] } },
          orderBy: { createdAt: 'desc' }
        });
        if (open) return open;
      }
      return tx.lead.create({ data: {
        tenantId, accountId, customerId, status,
        interest: signal?.interest?.slice(0, 280) || null,
        signalReason: signal?.reason || null,
        sourceConversationId: signal?.conversationId || null,
        sourcePhoneNumberId: signal?.phoneNumberId || null,
        sourceWorkflowSessionId: signal?.workflowSessionId || null
      } });
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
      conversationId,
      phoneNumberId,
      turnDecision,
      isWorkflowCompleted,
      workflowId,
      workflowConfig,
      terminalStateId,
      workflowIntents,
      userMessage,
      recognizedUseCases,
      workflowSessionId,
      leadMode = 'BOTH'
    } = params;

    if (!tenantId || !accountId || !customerId || leadMode === 'NONE') {
      return null;
    }

    // A completed workflow with an explicit no-lead outcome must not be
    // reclassified by generic turn keywords on that same customer message.
    if (isWorkflowCompleted && workflowConfig?.outcome?.createLead === false) {
      return null;
    }

    let isStrongSignal = false;
    let signalReason = '';

    // 1. Workflow completed (sales/booking workflows only)
    if (isWorkflowCompleted && workflowId) {
      const workflowText = `${workflowId} ${(workflowIntents || []).join(' ')}`.toLowerCase();
      const wrongMode = (leadMode === 'SERVICE' && /checkout|cash_on_delivery|cod_order|purchase|product_order/.test(workflowText))
        || (leadMode === 'COMMERCE' && /booking|appointment|consultation|tutor_session|service_selector/.test(workflowText));
      if (!wrongMode && this.isLeadGeneratingWorkflow({ workflowId, workflowConfig, terminalStateId, workflowIntents })) {
        isStrongSignal = true;
        signalReason = 'COMPLETED_SALES_WORKFLOW';
      }
    }

    // 2. Turn decision contains explicit sales intent
    if (!isStrongSignal && turnDecision) {
      const intentUpper = (turnDecision.intent || '').toUpperCase();
      if ((leadMode !== 'SERVICE' && (['BUY_INTENT', 'ORDER_INTENT', 'PURCHASE'].includes(intentUpper) || turnDecision.secondaryIntents?.includes('BUY_INTENT')))
        || (leadMode !== 'COMMERCE' && intentUpper === 'BOOKING_INTENT')) {
        isStrongSignal = true;
        signalReason = 'EXPLICIT_SALES_INTENT';
      }
    }

    // 3. User message keywords check for explicit buy/order phrases in Arabic/Darija/French/English
    if (!isStrongSignal && userMessage) {
      const useCases = recognizedUseCases || IntentTriggerLibrary.match(userMessage).map(match => match.useCase);
      if (leadMode !== 'SERVICE' && useCases.includes('PURCHASE')) {
        isStrongSignal = true;
        signalReason = 'EXPLICIT_PURCHASE_MESSAGE';
      }
      // Booking without a configured workflow can still enter CRM, but uses the
      // same recognized use case as the conversation router.
      if (leadMode !== 'COMMERCE' && !isStrongSignal && useCases.includes('BOOKING') && !isActionNegated(userMessage, 'booking')) {
        isStrongSignal = true;
        signalReason = 'EXPLICIT_BOOKING_OR_QUOTE';
      }
    }

    if (isStrongSignal && !isActionNegated(userMessage || '', 'purchase')) {
      logger.info(`CRMService: Strong sales signal detected for customer [${customerId}] in account [${accountId}]. Upserting lead.`);
      return this.upsertLead(tenantId, accountId, customerId, 'NEW', {
        interest: userMessage?.trim(), reason: signalReason, conversationId,
        phoneNumberId,
        workflowSessionId: signalReason === 'COMPLETED_SALES_WORKFLOW' ? workflowSessionId : null
      });
    }

    return null;
  }
}
