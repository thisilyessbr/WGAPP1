import { ConversationEngine } from '../conversation/ConversationEngine';
import { MessageQueue, InboundQueueJob } from './MessageQueue';
import { WhatsAppOutboundAdapter, OutboundSendResult } from './WhatsAppOutboundAdapter';
import { WhatsAppPolicyAdapter, PolicyDecision } from './WhatsAppPolicyAdapter';
import { WhatsAppNumberService } from './WhatsAppNumberService';
import { logger } from '../../../utils/logger';

export interface WhatsAppWorkerResult {
  jobId: string;
  wamid: string;
  tenantId: string;
  accountId: string;
  waId: string;
  phoneNumberId: string;
  response: string;
  policyDecision?: PolicyDecision;
  outboundResult?: OutboundSendResult;
  processedAt: number;
}

export class WhatsAppWorker {
  constructor(
    private queue: MessageQueue<InboundQueueJob>,
    private conversationEngine: ConversationEngine,
    private outboundAdapter: WhatsAppOutboundAdapter = new WhatsAppOutboundAdapter(),
    private numberService?: WhatsAppNumberService,
    private policyAdapter: WhatsAppPolicyAdapter = new WhatsAppPolicyAdapter()
  ) {
    this.registerHandler();
  }

  private registerHandler(): void {
    this.queue.registerHandler(async (job: InboundQueueJob) => {
      return await this.processJob(job);
    });
  }

  /**
   * Processes a single durable inbound WhatsApp job:
   * 1. Calls ConversationEngine.handleMessage with externalMessageId: job.wamid.
   * 2. Evaluates Meta policy via WhatsAppPolicyAdapter (24h customer care window, text vs template).
   * 3. Sends the assistant response via WhatsAppOutboundAdapter to the exact originating phoneNumberId.
   * 4. Enforces failure isolation: If Meta outbound send fails or is blocked by policy, the committed turn remains intact
   *    and any retry returns the persisted turn without re-running ConversationEngine.
   */
  async processJob(job: InboundQueueJob): Promise<WhatsAppWorkerResult> {
    logger.info(`WhatsAppWorker: Processing job [${job.wamid}] for user [${job.waId}] on account [${job.accountId}]`);

    // Verify originating phone number is registered and enabled if numberService is configured
    if (this.numberService) {
      const mapping = await this.numberService.resolveAccountByPhoneNumberId(job.phoneNumberId, { requireEnabled: true });
      if (!mapping || mapping.tenantId !== job.tenantId || mapping.accountId !== job.accountId) {
        logger.error(`WhatsAppWorker: Outbound blocked - phoneNumberId [${job.phoneNumberId}] is unknown or disabled for tenant [${job.tenantId}]`);
        return {
          jobId: job.id,
          wamid: job.wamid,
          tenantId: job.tenantId,
          accountId: job.accountId,
          waId: job.waId,
          phoneNumberId: job.phoneNumberId,
          response: '',
          outboundResult: {
            success: false,
            error: `Originating phoneNumberId [${job.phoneNumberId}] is unknown or disabled`,
            isRetryable: false
          },
          processedAt: Date.now()
        };
      }
    }

    // 1. Execute ConversationEngine turn (with turn idempotency)
    const response = await this.conversationEngine.handleMessage(
      job.tenantId,
      job.waId,
      job.message,
      job.accountId,
      { externalMessageId: job.wamid }
    );

    // 2. Evaluate Outbound Policy (Customer Service Window, text vs template)
    const inboundTimestamp = typeof job.timestamp === 'bigint' ? Number(job.timestamp) : (Number(job.timestamp) || job.enqueuedAt);
    const policyDecision = this.policyAdapter.evaluateOutbound({
      tenantId: job.tenantId,
      accountId: job.accountId,
      phoneNumberId: job.phoneNumberId,
      recipientWaId: job.waId,
      lastInboundTimestamp: inboundTimestamp,
      responseText: response
    });

    let outboundResult: OutboundSendResult;

    // 3. Failure-isolated outbound delivery based on policy decision
    if (policyDecision.action === 'SEND_TEXT') {
      outboundResult = await this.outboundAdapter.sendTextMessage({
        phoneNumberId: job.phoneNumberId,
        to: job.waId,
        text: policyDecision.text || response
      });
    } else if (policyDecision.action === 'SEND_TEMPLATE' && policyDecision.template) {
      outboundResult = await this.outboundAdapter.sendTemplateMessage({
        phoneNumberId: job.phoneNumberId,
        to: job.waId,
        template: policyDecision.template
      });
    } else {
      // Policy Blocked (e.g. window expired and no template)
      logger.warn(`WhatsAppWorker: Outbound blocked by policy for job [${job.wamid}]: ${policyDecision.reason}`);
      outboundResult = {
        success: false,
        error: policyDecision.reason || 'Blocked by WhatsApp policy',
        isRetryable: false
      };
    }

    const result: WhatsAppWorkerResult = {
      jobId: job.id,
      wamid: job.wamid,
      tenantId: job.tenantId,
      accountId: job.accountId,
      waId: job.waId,
      phoneNumberId: job.phoneNumberId,
      response,
      policyDecision,
      outboundResult,
      processedAt: Date.now()
    };

    logger.info(`WhatsAppWorker: Finished processing job [${job.wamid}], policy: ${policyDecision.action}, outbound success: ${outboundResult.success} (Meta ID: ${outboundResult.providerMessageId || 'N/A'})`);
    return result;
  }
}
