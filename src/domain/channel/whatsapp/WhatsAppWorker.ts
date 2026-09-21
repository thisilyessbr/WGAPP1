import { ConversationEngine } from '../../conversation/ConversationEngine';
import { MessageQueue, InboundQueueJob } from './MessageQueue';
import { WhatsAppOutboundAdapter, OutboundSendResult } from './WhatsAppOutboundAdapter';
import { WhatsAppPolicyAdapter, PolicyDecision } from './WhatsAppPolicyAdapter';
import { WhatsAppNumberService } from './WhatsAppNumberService';
import { ChannelRouter } from '../routing/ChannelRouter';
import { MetaCloudTransport } from '../routing/MetaCloudTransport';
import { ClientSafetyGuard } from '../guard/ClientSafetyGuard';
import { logger } from '../../../utils/logger';
import { IncomingMessagePayload } from '../../conversation/CapabilityRouter';

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
  private channelRouter: ChannelRouter;

  constructor(
    private queue: MessageQueue<InboundQueueJob>,
    private conversationEngine: ConversationEngine,
    private outboundAdapter: WhatsAppOutboundAdapter = new WhatsAppOutboundAdapter(),
    private numberService?: WhatsAppNumberService,
    private policyAdapter: WhatsAppPolicyAdapter = new WhatsAppPolicyAdapter(),
    channelRouter?: ChannelRouter,
    private safetyGuard?: ClientSafetyGuard
  ) {
    if (channelRouter) {
      this.channelRouter = channelRouter;
    } else if (this.numberService) {
      this.channelRouter = new ChannelRouter(this.numberService, [
        new MetaCloudTransport(this.outboundAdapter)
      ]);
    } else {
      this.channelRouter = new ChannelRouter(null as any, [
        new MetaCloudTransport(this.outboundAdapter)
      ]);
    }

    this.registerHandler();
  }

  private registerHandler(): void {
    this.queue.registerHandler(async (job: InboundQueueJob) => {
      return await this.processJob(job);
    });
  }

  /**
   * Processes a single durable inbound WhatsApp job:
   * 1. Evaluates SafetyGuard (tenant boundary, number status, tenant paused, human takeover, rate limit, circuit breaker).
   * 2. Calls ConversationEngine.handleMessage with externalMessageId: job.wamid.
   * 3. Evaluates Meta policy via WhatsAppPolicyAdapter (24h customer care window, text vs template).
   * 4. Routes outbound delivery via ChannelRouter strictly to the originating channel/number.
   * 5. Enforces failure isolation: If outbound delivery fails, turn state remains intact.
   * 6. Persists providerMessageId to ASSISTANT Message upon successful transmission.
   */
  async processJob(job: InboundQueueJob): Promise<WhatsAppWorkerResult> {
    logger.info(`WhatsAppWorker: Processing job [${job.wamid}] for user [${job.waId}] on account [${job.accountId}]`);

    // Only media jobs use an envelope; a customer's text is never parsed as commands.
    let media: { mediaId?: string; caption?: string; unsupportedMediaType?: string } | null = null;
    if (job.rawType && !['text', 'button'].includes(job.rawType)) {
      try {
        const parsed = JSON.parse(job.message);
        if (parsed && typeof parsed === 'object' && (parsed.mediaId || parsed.unsupportedMediaType)) media = parsed;
      } catch { /* Interactive reply titles are plain text. */ }
    }
    const displayContent = media ? `[Attachment: ${job.rawType}] ${media.caption || ''}`.trim() : job.message;

    // 1. Client Safety Guard Check
    if (this.safetyGuard) {
      const safetyCheck = await this.safetyGuard.evaluateOutbound({
        tenantId: job.tenantId,
        accountId: job.accountId,
        phoneNumberId: job.phoneNumberId,
        recipientWaId: job.waId,
        handoffAcknowledgmentFor: job.wamid
      });

      if (!safetyCheck.allowed) {
        if (safetyCheck.code === 'HUMAN_TAKEOVER' && this.conversationEngine.recordInboundMessage) {
          await this.conversationEngine.recordInboundMessage(job.tenantId, job.waId, displayContent, job.accountId, job.wamid);
        }
        logger.warn(`WhatsAppWorker: Safety guard suppressed processing for job [${job.wamid}]: ${safetyCheck.reason}`);
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
            error: safetyCheck.reason || 'Blocked by Client Safety Guard',
            retryAfterSeconds: safetyCheck.retryAfterSeconds,
            isRetryable: safetyCheck.code === 'CIRCUIT_BREAKER_OPEN' || safetyCheck.code === 'RATE_LIMIT_EXCEEDED'
          },
          processedAt: Date.now()
        };
      }
    } else if (this.numberService) {
      // Fallback number resolution check if safetyGuard not injected
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

    let contentInput: string | IncomingMessagePayload = job.message;
    if (media) {
      contentInput = { text: media.caption || '', unsupportedMediaType: media.unsupportedMediaType || job.rawType || 'image' };
      if (job.rawType === 'image' && media.mediaId) {
        try {
          const image = await this.outboundAdapter.downloadInboundImage(job.phoneNumberId, media.mediaId);
          contentInput = { ...image, text: media.caption || '' };
        } catch {
          logger.warn('WhatsAppWorker: Inbound image unavailable; returning a text-request fallback.');
        }
      }
    }

    // 2. Execute ConversationEngine turn (with turn idempotency)
    const response = await this.conversationEngine.handleMessage(
      job.tenantId,
      job.waId,
      contentInput,
      job.accountId,
      { externalMessageId: job.wamid }
    );

    // If response is empty (e.g. human active, automation capped, or suppressed), go silent
    if (!response || !response.trim()) {
      return {
        jobId: job.id,
        wamid: job.wamid,
        tenantId: job.tenantId,
        accountId: job.accountId,
        waId: job.waId,
        phoneNumberId: job.phoneNumberId,
        response: '',
        policyDecision: {
          action: 'BLOCK',
          reason: 'Empty chatbot response (human active or bot suppressed)',
          isWithinCustomerServiceWindow: true
        },
        outboundResult: {
          success: true,
          isRetryable: false
        },
        processedAt: Date.now()
      };
    }

    // 2.1 Post-LLM Client Safety Guard Re-check (prevents TOCTOU race during LLM generation)
    if (this.safetyGuard) {
      const postLlmSafetyCheck = await this.safetyGuard.evaluateOutbound({
        tenantId: job.tenantId,
        accountId: job.accountId,
        phoneNumberId: job.phoneNumberId,
        recipientWaId: job.waId,
        consumeRateLimit: false,
        handoffAcknowledgmentFor: job.wamid
      });

      if (!postLlmSafetyCheck.allowed) {
        logger.warn(`WhatsAppWorker: Post-LLM safety guard suppressed outbound delivery for job [${job.wamid}]: ${postLlmSafetyCheck.reason}`);
        return {
          jobId: job.id,
          wamid: job.wamid,
          tenantId: job.tenantId,
          accountId: job.accountId,
          waId: job.waId,
          phoneNumberId: job.phoneNumberId,
          response,
          outboundResult: {
            success: false,
            error: postLlmSafetyCheck.reason || 'Blocked by post-LLM Client Safety Guard',
            retryAfterSeconds: postLlmSafetyCheck.retryAfterSeconds,
            isRetryable: postLlmSafetyCheck.code === 'CIRCUIT_BREAKER_OPEN' || postLlmSafetyCheck.code === 'RATE_LIMIT_EXCEEDED'
          },
          processedAt: Date.now()
        };
      }
    }

    // 3. Evaluate Outbound Policy (Customer Service Window, text vs template)
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
    let providerAttempted = false;

    // 4. Failure-isolated outbound delivery strictly via ChannelRouter (no direct Meta bypass)
    if (this.channelRouter && this.numberService) {
      if (policyDecision.action === 'SEND_TEXT') {
        await job.beforeDelivery?.();
        providerAttempted = true;
        outboundResult = await this.channelRouter.routeOutbound({
          tenantId: job.tenantId,
          accountId: job.accountId,
          phoneNumberId: job.phoneNumberId,
          to: job.waId,
          text: policyDecision.text || response
        });
      } else if (policyDecision.action === 'SEND_TEMPLATE' && policyDecision.template) {
        await job.beforeDelivery?.();
        providerAttempted = true;
        outboundResult = await this.channelRouter.routeOutbound({
          tenantId: job.tenantId,
          accountId: job.accountId,
          phoneNumberId: job.phoneNumberId,
          to: job.waId,
          text: policyDecision.text || response,
          template: policyDecision.template
        });
      } else {
        logger.warn(`WhatsAppWorker: Outbound blocked by policy for job [${job.wamid}]: ${policyDecision.reason}`);
        outboundResult = {
          success: false,
          error: policyDecision.reason || 'Blocked by WhatsApp policy',
          isRetryable: false
        };
      }
    } else {
      // Fail closed: Missing routing configuration cannot bypass to direct Meta API
      logger.error(`WhatsAppWorker: Outbound blocked for job [${job.wamid}] - ChannelRouter or WhatsAppNumberService is not configured`);
      outboundResult = {
        success: false,
        error: 'Outbound blocked: Missing WhatsAppNumberService or ChannelRouter configuration',
        isRetryable: false
      };
    }

    // Update circuit breaker status in SafetyGuard
    if (this.safetyGuard && providerAttempted) {
      if (outboundResult.success) {
        this.safetyGuard.recordProviderSuccess(job.phoneNumberId);
      } else {
        this.safetyGuard.recordProviderFailure(job.phoneNumberId);
      }
    }

    // Persist providerMessageId to ASSISTANT Message record upon successful delivery
    if (outboundResult.success && outboundResult.providerMessageId && this.conversationEngine.recordOutboundAssistantMessage) {
      try {
        await this.conversationEngine.recordOutboundAssistantMessage(
          job.tenantId,
          job.wamid,
          outboundResult.providerMessageId
        );
      } catch (err: any) {
        logger.error(`WhatsAppWorker: Failed to persist assistant providerMessageId for job [${job.wamid}]: ${err.message || err}`);
      }
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

    logger.info(`WhatsAppWorker: Finished processing job [${job.wamid}], policy: ${policyDecision.action}, outbound success: ${outboundResult.success} (Provider ID: ${outboundResult.providerMessageId || 'N/A'})`);
    return result;
  }
}
