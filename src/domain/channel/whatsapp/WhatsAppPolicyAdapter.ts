import { OutboundTemplateRequest } from './WhatsAppOutboundAdapter';
import { logger } from '../../../utils/logger';

export type PolicyDecisionAction = 'SEND_TEXT' | 'SEND_TEMPLATE' | 'BLOCK' | 'DEFER';

export interface PolicyEvaluationContext {
  tenantId: string;
  accountId: string;
  phoneNumberId: string;
  recipientWaId: string;
  lastInboundTimestamp?: number | null; // Timestamp of customer's inbound message (ms)
  responseText?: string;
  metadata?: Record<string, unknown>;
  requestedTemplate?: OutboundTemplateRequest;
  approvedTemplates?: Record<string, OutboundTemplateRequest>;
}

export interface PolicyDecision {
  action: PolicyDecisionAction;
  reason?: string;
  isWithinCustomerServiceWindow: boolean;
  windowExpiresAt?: number | null;
  template?: OutboundTemplateRequest;
  text?: string;
}

export interface WhatsAppPolicyConfig {
  customerServiceWindowMs?: number; // Default: 24 * 3600 * 1000 (24 hours per official Meta Cloud API)
}

export class WhatsAppPolicyAdapter {
  private readonly customerServiceWindowMs: number;

  constructor(config: WhatsAppPolicyConfig = {}) {
    this.customerServiceWindowMs = config.customerServiceWindowMs ?? 24 * 3600 * 1000;
  }

  /**
   * Evaluates an outbound messaging request against Meta Cloud API policies:
   * 1. 24-hour Customer Service Window.
   * 2. Free-form text validity within active window.
   * 3. Template requirement outside window (preventing Meta Error 131047).
   * 4. Safe BLOCK/DEFER if window is closed and no approved template is available.
   * 5. ZERO AI/LLM invocation (pure deterministic policy logic).
   */
  evaluateOutbound(context: PolicyEvaluationContext): PolicyDecision {
    const { lastInboundTimestamp, responseText, requestedTemplate, approvedTemplates } = context;
    const now = Date.now();

    // 1. Calculate Customer Service Window
    let isWithinWindow = true;
    let windowExpiresAt: number | null = null;

    if (typeof lastInboundTimestamp === 'number' && lastInboundTimestamp > 0) {
      windowExpiresAt = lastInboundTimestamp + this.customerServiceWindowMs;
      isWithinWindow = now <= windowExpiresAt;
    }

    // 2. Explicit template requested (e.g. business-initiated notification)
    if (requestedTemplate) {
      return {
        action: 'SEND_TEMPLATE',
        reason: 'Explicit template requested for outbound message',
        isWithinCustomerServiceWindow: isWithinWindow,
        windowExpiresAt,
        template: requestedTemplate
      };
    }

    // 3. Inside 24-hour Customer Service Window -> Free-form text allowed
    if (isWithinWindow) {
      if (!responseText || !responseText.trim()) {
        return {
          action: 'BLOCK',
          reason: 'Empty response text body',
          isWithinCustomerServiceWindow: true,
          windowExpiresAt
        };
      }

      return {
        action: 'SEND_TEXT',
        reason: 'Within active 24-hour customer service window',
        isWithinCustomerServiceWindow: true,
        windowExpiresAt,
        text: responseText
      };
    }

    // 4. Outside 24-hour Customer Service Window -> Free-form text is prohibited by Meta
    // Check if an approved re-engagement / utility template is available
    if (approvedTemplates && Object.keys(approvedTemplates).length > 0) {
      const fallbackTemplateName = Object.keys(approvedTemplates)[0];
      const fallbackTemplate = approvedTemplates[fallbackTemplateName];
      logger.info(`WhatsAppPolicyAdapter: Window closed for user [${context.recipientWaId}], selecting fallback template [${fallbackTemplate.name}]`);
      return {
        action: 'SEND_TEMPLATE',
        reason: 'Customer service window expired (24h) - using approved template',
        isWithinCustomerServiceWindow: false,
        windowExpiresAt,
        template: fallbackTemplate
      };
    }

    // 5. Outside window and no approved template -> BLOCK outbound to prevent Meta 131047 error
    logger.warn(`WhatsAppPolicyAdapter: Outbound blocked for user [${context.recipientWaId}] - 24-hour window expired at [${new Date(windowExpiresAt || 0).toISOString()}] and no approved template provided`);
    return {
      action: 'BLOCK',
      reason: 'Customer service window (24h) expired and no template provided (Meta Error 131047 avoidance)',
      isWithinCustomerServiceWindow: false,
      windowExpiresAt
    };
  }
}
