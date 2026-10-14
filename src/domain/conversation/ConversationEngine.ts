import { generateResponseWithDeadline } from '../../core/llm/ResponseDeadline';
import { MeteredLLMProvider } from '../../core/llm/MeteredLLMProvider';
import { ConversationService } from './ConversationService';
import { TenantConfigService } from '../tenant/TenantConfigService';
import { WorkflowEngine, WorkflowCancellationDetector } from '../../core/engine/WorkflowEngine';
import { LLMProvider, LLMRequestOptions } from '../../core/llm/LLMProvider';
import { LLMFactory } from '../../core/llm/LLMFactory';
import { ResponseBuilder, DEFAULT_WORKFLOW_MESSAGES } from './ResponseBuilder';
import { RAGChunk, RAGService } from '../rag/RAGService';
import { DirectRagGuard, SupportedScript } from '../rag/DirectRagGuard';
import { QuestionReformulator } from '../rag/QuestionReformulator';
import { PolicyEvidence } from '../rag/PolicyEvidence';
import { PolicyEvidenceReuse } from '../rag/PolicyEvidenceReuse';
import { ContentSafetyGuard } from '../safety/ContentSafetyGuard';
import { LanguageDetector } from '../faq/FaqMatcher';
import { FaqAnswerPolicy } from '../faq/FaqAnswerPolicy';
import { BusinessConfig, WorkflowConfig, resolveLocalizedPrompt, DEFAULT_POST_COMPLETION_MESSAGES, DEFAULT_LIMIT_EXCEEDED_MESSAGES, DEFAULT_IMAGE_FALLBACK_MESSAGES, DEFAULT_EXECUTION_LIMIT_MESSAGES } from '../tenant/BusinessConfig';
import { AccountConfigService } from '../tenant/AccountConfigService';
import { GreetingRouter } from './GreetingRouter';
import { ImageCapabilityGateway } from '../../core/gateway/ImageCapabilityGateway';
import { CapabilityRouter, IncomingMessagePayload } from './CapabilityRouter';
import { ConversationContext, buildConversationContext, ConversationCapability } from './ConversationContext';
import { EcommerceService } from '../ecommerce/EcommerceService';
import { HandoffService } from './HandoffService';
import { TurnDecision, TurnDecisionResolver } from './TurnDecision';
import { AnswerComposer, outboundMediaContext } from './AnswerComposer';
import { CRMService } from '../crm/CRMService';
import { OutcomeTrackingService } from '../outcome/OutcomeTrackingService';
import { logger } from '../../utils/logger';
import { telemetry, TelemetryClient } from '../../core/telemetry/TelemetryClient';
import { PortalBudget } from '../../portal/PortalBudget';
import { portalBusinessEvidence } from '../../portal/BusinessFacts';
import { BusinessQuestionScope } from './BusinessQuestionScope';
import { GroundedAnswerGuard } from './GroundedAnswerGuard';
import { BusinessHoursClause } from './BusinessHoursClause';
import { GroundedPromptBuilder } from './GroundedPromptBuilder';
import { WorkflowTriggerResolver } from './WorkflowTriggerResolver';
import { EcommerceIntentHandler } from './EcommerceIntentHandler';
import { AmbiguousGreetingResolver } from './AmbiguousGreetingResolver';
import { RagRetrievalPlanner } from './RagRetrievalPlanner';

export class ConversationEngine {
  private llmFactory?: LLMFactory;
  private defaultLlm?: LLMProvider;
  private imageGateway: ImageCapabilityGateway;
  private capabilityRouter: CapabilityRouter;
  private accountConfigService?: AccountConfigService;
  private ecommerceService?: EcommerceService;
  private crmService?: CRMService;
  private readonly inFlightExternalTurns = new Map<string, Promise<string>>();
  private readonly conversationTurns = new Map<string, Promise<string>>();

  /** Save human-mode input without invoking routing or generation. */
  async recordInboundMessage(tenantId: string, customerId: string, content: string, accountId: string, externalMessageId: string): Promise<void> {
    const conversation = await this.conversationService.getOrCreateConversation(tenantId, customerId, accountId);
    await this.conversationService.persistMessage(tenantId, conversation.id, 'USER', content, externalMessageId);
  }

  getConversationService(): ConversationService {
    return this.conversationService;
  }
  async getOutboundProductImage(tenantId: string, accountId: string, inboundExternalId: string): Promise<string | null> {
    return this.conversationService.getOutboundProductImage(tenantId, accountId, inboundExternalId);
  }

  /** Persist provider message ID (wamid) onto the committed AI assistant message */
  async recordOutboundAssistantMessage(tenantId: string, inboundExternalId: string, providerMessageId: string): Promise<void> {
    if (this.conversationService?.updateOutboundAssistantMessage) {
      await this.conversationService.updateOutboundAssistantMessage({
        tenantId,
        inboundExternalId,
        providerMessageId,
        deliveryStatus: 'SENT'
      });
    }
  }

  private serializeTurn(key: string, run: () => Promise<string>): Promise<string> {
    const previous = this.conversationTurns.get(key);
    const pending = (previous ? previous.catch(() => undefined) : Promise.resolve()).then(run);
    this.conversationTurns.set(key, pending);
    const cleanup = () => { if (this.conversationTurns.get(key) === pending) this.conversationTurns.delete(key); };
    void pending.then(cleanup, cleanup);
    return pending;
  }

  constructor(
    private conversationService: ConversationService,
    private configService: TenantConfigService,
    private workflowEngine: WorkflowEngine,
    llmOrFactory: LLMProvider | LLMFactory,
    private responseBuilder: ResponseBuilder,
    private ragService?: RAGService,
    imageGateway?: ImageCapabilityGateway,
    capabilityRouter?: CapabilityRouter,
    accountConfigService?: AccountConfigService,
    ecommerceService?: EcommerceService,
    crmService?: CRMService,
    private portalBudget?: PortalBudget,
    private outcomeService?: OutcomeTrackingService
  ) {
    if (llmOrFactory && typeof llmOrFactory === 'object' && 'getProvider' in llmOrFactory) {
      this.llmFactory = llmOrFactory as LLMFactory;
    } else if (llmOrFactory) {
      this.defaultLlm = llmOrFactory as LLMProvider;
    }
    this.imageGateway = imageGateway || new ImageCapabilityGateway();
    this.capabilityRouter = capabilityRouter || new CapabilityRouter(this.imageGateway);
    this.accountConfigService = accountConfigService;
    this.ecommerceService = ecommerceService;
    this.crmService = crmService;
  }

  setOutcomeService(outcomeService: OutcomeTrackingService): void {
    this.outcomeService = outcomeService;
  }

  /**
   * Central response limiter enforcing BusinessConfig.limits.maxResponseLength.
   * Delegates to GroundedPromptBuilder; kept as a public method here because
   * callers outside this class (and tests) invoke it on a ConversationEngine instance.
   */
  /** Reply in the customer's own script: Arabizi users must not get Arabic script. */
  static unconfirmedInternationalShipping(lang: string, script: SupportedScript): string {
    if (script === 'arabizi' || (lang === 'darija' && script === 'latin')) {
      return 'Ma3endich ma3loumat m2akkda 3la tawsil l had lblasa barra lblad. Lfari9 dyalna y9der yt2akked lik.';
    }
    if (lang === 'fr') {
      return "Je n'ai pas d'information confirmée pour cette destination internationale. Notre équipe peut vérifier la livraison pour vous.";
    }
    if ((lang === 'darija' || lang === 'ar') && script === 'arabic') {
      return 'ما عنديش معلومات مؤكدة على التوصيل لهاد الوجهة خارج البلاد. الفريق يقدر يتأكد ليك.';
    }
    return 'I do not have confirmed shipping information for that international destination. Our team can check it for you.';
  }

  public applyResponseLimit(response: string, maxResponseLength?: number): string {
    return GroundedPromptBuilder.applyResponseLimit(response, maxResponseLength);
  }

  /** Reuse a catalog-verified product from an explicit purchase request, never an unverified phrase. */
  private async createWorkflowSessionForTurn(
    tenantId: string,
    conversationId: string,
    workflowId: string,
    workflowConfig: WorkflowConfig,
    turnDecision: TurnDecision | null | undefined,
    productContext: ConversationContext['productContext'],
    accountId: string | null | undefined,
    language: 'en' | 'fr' | 'ar' | 'darija'
  ) {
    const initial = workflowConfig.states[workflowConfig.initialState];
    const fieldName = typeof initial?.field === 'string' ? initial.field : initial?.field?.name;
    const isProductField = /^(?:product|productName|item|itemName|produit|produitNom|المنتوج|المنتج)$/iu.test(fieldName || '');
    if (turnDecision?.domain === 'ECOMMERCE' && turnDecision.intent === 'BUY_INTENT'
      && this.ecommerceService && accountId && initial?.type === 'collect'
      && isProductField && initial.next && workflowConfig.states[initial.next]) {
      try {
        const requestedSize = turnDecision.size || productContext?.selectedSize || undefined;
        const requestedColor = turnDecision.color && turnDecision.color !== 'ALL'
          ? turnDecision.color : productContext?.selectedColor || undefined;
        const selectedId = turnDecision.catalogProductId
          || (!turnDecision.category && !turnDecision.productName && !turnDecision.sku
            ? productContext?.selectedProductId || undefined : undefined);
        let fact = selectedId
          ? await this.ecommerceService.getProductFact(tenantId, accountId, { id: selectedId, size: requestedSize, color: requestedColor }, language)
          : null;
        if (!fact && turnDecision.productName && !turnDecision.category) {
          fact = await this.ecommerceService.getProductFact(tenantId, accountId, {
            name: turnDecision.productName, size: requestedSize, color: requestedColor
          }, language);
        }
        if (!fact && turnDecision.category) {
          const candidates = await this.ecommerceService.searchProducts(
            tenantId, accountId, undefined, language, { category: turnDecision.category, limit: 2 }
          );
          if (candidates.length === 1) {
            fact = await this.ecommerceService.getProductFact(tenantId, accountId, {
              id: candidates[0].product.id, size: requestedSize, color: requestedColor
            }, language);
          }
        }
        if (fact?.inStock && (!(requestedSize || requestedColor) || fact.selectedVariant)) {
          const variant = [fact.selectedVariant?.color, fact.selectedVariant?.size].filter(Boolean).join(', ');
          const product = variant ? `${fact.displayName} (${variant})` : fact.displayName;
          const seed = {
            stateHistory: [workflowConfig.initialState],
            collectedData: { [fieldName!]: product },
            contextData: { [fieldName!]: product }
          };
          return this.conversationService.createSession(tenantId, conversationId, workflowId, initial.next, seed);
        }
      } catch (error: any) {
        logger.warn(`ConversationEngine: Catalog prefill unavailable; retaining product question: ${error?.message || error}`);
      }
    }
    return this.conversationService.createSession(tenantId, conversationId, workflowId, workflowConfig.initialState);
  }

  /**
   * Executes an administrator preview with an explicit, request-scoped config.
   * Preview turns keep their own conversation context and bypass the client's
   * commercial allowance. The portal excludes preview identities from statistics.
   */
  async previewMessage(
    tenantId: string,
    accountId: string,
    previewSessionId: string,
    content: string,
    config: BusinessConfig
  ): Promise<string> {
    if (!this.accountConfigService) {
      throw new Error('Account configuration service is required for chatbot previews.');
    }
    const customerId = `portal-preview:${previewSessionId}`;
    const run = () => this.accountConfigService!.runWithConfigOverride(tenantId, accountId, config, () =>
      this.serializeTurn(JSON.stringify([tenantId, accountId, customerId]), () =>
        this.handleMessageInternal(tenantId, customerId, content, accountId)
      )
    );
    if (!this.portalBudget) return run();
    const profile = (await this.portalBudget.getPreviewProfile(tenantId, accountId));
    return this.portalBudget.runPreview(profile, run);
  }

  async handleMessage(
    tenantId: string,
    customerExternalId: string,
    contentInput: string | IncomingMessagePayload,
    accountId?: string | null,
    options?: {
      externalMessageId?: string | null;
    }
  ): Promise<string> {
    const externalMessageId = options?.externalMessageId?.trim();
    if (!externalMessageId) {
      return this.serializeTurn(JSON.stringify([tenantId, accountId, customerExternalId]), () => this.handleManagedMessage(tenantId, customerExternalId, contentInput, accountId, options));
    }

    const turnKey = `${tenantId}:${externalMessageId}`;
    const existingTurn = this.inFlightExternalTurns.get(turnKey);
    if (existingTurn) {
      return existingTurn;
    }

    const pendingTurn = this.serializeTurn(JSON.stringify([tenantId, accountId, customerExternalId]), () => this.handleManagedMessage(
      tenantId,
      customerExternalId,
      contentInput,
      accountId,
      { ...options, externalMessageId }
    ));
    this.inFlightExternalTurns.set(turnKey, pendingTurn);

    try {
      return await pendingTurn;
    } finally {
      if (this.inFlightExternalTurns.get(turnKey) === pendingTurn) {
        this.inFlightExternalTurns.delete(turnKey);
      }
    }
  }

  private async handleManagedMessage(
    tenantId: string, customerExternalId: string, contentInput: string | IncomingMessagePayload,
    accountId?: string | null, options?: { externalMessageId?: string | null }
  ): Promise<string> {
    if (!this.portalBudget) return this.handleMessageInternal(tenantId, customerExternalId, contentInput, accountId, options);
    return this.portalBudget.runTurn(tenantId, accountId, options?.externalMessageId, () => this.handleMessageInternal(tenantId, customerExternalId, contentInput, accountId, options), '');
  }

  private async handleMessageInternal(
    tenantId: string,
    customerExternalId: string,
    contentInput: string | IncomingMessagePayload,
    accountId?: string | null,
    options?: {
      externalMessageId?: string | null;
    }
  ): Promise<string> {
    const turnStartTime = Date.now();
    const correlationId = TelemetryClient.createCorrelationId();
    let responseSource: 'FAQ' | 'SERVICE' | 'RAG' | 'LLM' | 'WORKFLOW' | 'IMAGE' | 'FALLBACK' | 'GREETING' | 'CAP' | 'ECOMMERCE' | 'HANDOFF' | 'HUMAN_AGENT' | 'SAFETY_GUARD' = 'FALLBACK';
    let contextDataUpdate: Record<string, any> | null = null;

    // 0. Capability Routing & Multi-modal payload resolution
    const payload: IncomingMessagePayload = typeof contentInput === 'string' ? { text: contentInput } : contentInput;

    telemetry.emit({
      eventType: 'message_received',
      tenantId,
      accountId: accountId || null,
      correlationId,
      stage: 'entry',
      status: 'SUCCESS',
      metadata: {
        inputLength: (payload.text || '').length,
        isImage: Boolean(payload.imageBase64 || payload.imageUrl)
      }
    });

    // Normalize accountId parameter whether passed as string or options object
    const resolvedParamAccountId = typeof accountId === 'string'
      ? accountId
      : (accountId && typeof (accountId as any).accountId === 'string' ? (accountId as any).accountId : null);

    // 1. Load conversation session securely via tenant mapping (and accountId if provided)
    const conversation = await this.conversationService.getOrCreateConversation(tenantId, customerExternalId, resolvedParamAccountId);

    // 1.1 Channel-neutral turn idempotency check: bypass all expensive processing if external turn was already committed
    const externalMessageId = options?.externalMessageId?.trim() || null;
    if (externalMessageId) {
      const existingResponse = await this.conversationService.findExistingTurnResponse(
        tenantId,
        externalMessageId,
        conversation.id
      );
      if (existingResponse !== null) {
        logger.info(`ConversationEngine: Idempotent turn return for externalMessageId [${externalMessageId}] in conversation [${conversation.id}] (0 LLM, 0 RAG, 0 Workflow, 0 CRM).`);
        return existingResponse;
      }
    }

    // 2. Load configuration (account-aware if accountId or conversation.accountId provided, otherwise base tenant config)
    const effectiveAccountId = resolvedParamAccountId || conversation.accountId;
    const config = (effectiveAccountId && this.accountConfigService)
      ? await this.accountConfigService.getEffectiveConfig(tenantId, effectiveAccountId)
      : await this.configService.getConfig(tenantId);

    // Resolve LLM Provider and options for this tenant
    let llm: LLMProvider;
    let llmOptions: LLMRequestOptions = {};

    if (this.llmFactory) {
      const resolved = this.llmFactory.getProvider(config.llm);
      llm = resolved.provider;
      llmOptions = resolved.options;
    } else if (this.defaultLlm) {
      llm = this.defaultLlm;
      llmOptions = {
        model: config.llm?.model,
        temperature: config.llm?.temperature,
        maxTokens: config.llm?.maxTokens,
        timeoutMs: config.llm?.timeoutMs
      };
    } else {
      throw new Error('No LLM Provider or LLMFactory configured in ConversationEngine.');
    }

    // Standard chat replies are short by design. Cap legacy per-account values
    // so existing tenants receive the same low-cost behavior as new tenants.
    if (config.capabilities?.ecommerceEnabled !== true) {
      const requestedTokens = llmOptions.maxTokens ?? config.llm?.maxTokens ?? 300;
      llmOptions = { ...llmOptions, maxTokens: Math.min(requestedTokens, 300) };
    }

    if (this.portalBudget) llm = this.portalBudget.wrapLLM(llm, { provider: config.llm?.provider || 'deepseek', model: llmOptions.model || config.llm?.model || 'deepseek-flash' });
    llm = new MeteredLLMProvider(llm, {
      provider: config.llm?.provider || 'unknown', model: llmOptions.model || config.llm?.model || 'unknown'
    }, usage => telemetry.emit({
      eventType: 'llm_usage', tenantId, accountId: effectiveAccountId,
      conversationId: conversation.id, correlationId, stage: 'llm',
      status: usage.success ? 'SUCCESS' : 'FAILURE', latencyMs: usage.latencyMs,
      provider: usage.provider, model: usage.model, metadata: { ...usage }
    }));

    // If conversation is in HUMAN_ACTIVE mode, human agent is handling it -> pause bot automation
    let isHumanHandling = conversation.status === 'HUMAN_ACTIVE' || Boolean(conversation.humanRequested);
    if (!isHumanHandling) {
      // Keep the engine compatible with lightweight service implementations used by
      // integrations that do not expose the optional automation-state capability.
      const getAutomationState = (this.conversationService as Partial<ConversationService>).getAutomationState;
      const autoState = typeof getAutomationState === 'function'
        ? await getAutomationState.call(this.conversationService, tenantId, conversation.id)
        : null;
      if (autoState) {
        if (autoState.humanTakeover || !autoState.botEnabled) {
          isHumanHandling = true;
        } else if (autoState.pausedUntil && autoState.pausedUntil > new Date()) {
          isHumanHandling = true;
        }
      }
    }

    if (isHumanHandling) {
      logger.info(`ConversationEngine: Conversation [${conversation.id}] is in human takeover or bot automation paused. Pausing bot automation.`);
      await this.conversationService.persistMessage(tenantId, conversation.id, 'USER', payload.text || 'Image uploaded', externalMessageId);
      telemetry.emit({
        eventType: 'response_completed',
        tenantId,
        conversationId: conversation.id,
        correlationId,
        stage: 'response',
        status: 'SUCCESS',
        latencyMs: Date.now() - turnStartTime,
        metadata: {
          responseSource: 'HUMAN_AGENT',
          outputLength: 0
        }
      });
      return '';
    }

    // P0 §8 & §9: Cap Checks
    // If conversation is already capped (by 50-message cap or 10-post-completion question cap), go fully silent
    if (conversation.automationCapped || conversation.postCompletionCapped) {
      logger.info(`ConversationEngine: Conversation [${conversation.id}] is capped (automationCapped: ${conversation.automationCapped}, postCompletionCapped: ${conversation.postCompletionCapped}). Going fully silent.`);
      telemetry.emit({
        eventType: 'response_completed',
        tenantId,
        conversationId: conversation.id,
        correlationId,
        stage: 'response',
        status: 'SUCCESS',
        latencyMs: Date.now() - turnStartTime,
        metadata: {
          responseSource: 'CAP',
          outputLength: 0
        }
      });
      return '';
    }

    // Exact rule §9: messages 1..maxAutomationTurns processed normally; next message is rejected with cap message and conversation is closed
    // Keep the engine compatible with lightweight adapters used by previews and
    // older integrations. The persisted counter is still authoritative in the
    // production service, while the conversation counter is a safe fallback.
    const getMessageCount = (this.conversationService as any).getMessageCount;
    const totalStoredMessages = typeof getMessageCount === 'function'
      ? await getMessageCount.call(this.conversationService, tenantId, conversation.id)
      : Number(conversation.messageCount || 0);
    const maxHistoryLimit = config.limits?.maxConversationHistory;
    const maxTurnsLimit = config.limits?.maxAutomationTurns ?? 500;
    if ((maxHistoryLimit !== undefined && maxHistoryLimit < 20 && totalStoredMessages >= maxHistoryLimit) || conversation.messageCount >= maxTurnsLimit) {
      const incomingText = (payload.text || '').trim();
      const detectedLang = incomingText ? LanguageDetector.detect(incomingText) : (config.identity?.language || 'en');
      const capScript = DirectRagGuard.detectScript(incomingText, detectedLang as any);
      const defaultLimitMsg = detectedLang === 'darija' && capScript === 'arabic' ? 'هاد المحادثة وصلات للحد ديالها. عفاك بدا محادثة جديدة.'
        : DEFAULT_LIMIT_EXCEEDED_MESSAGES[detectedLang as keyof typeof DEFAULT_LIMIT_EXCEEDED_MESSAGES] || DEFAULT_LIMIT_EXCEEDED_MESSAGES.en;
      const rawCapMsg = resolveLocalizedPrompt(config.prompts?.limitExceeded, detectedLang, defaultLimitMsg, capScript);
      const capMsg = this.applyResponseLimit(rawCapMsg, config.limits?.maxResponseLength);
      await this.conversationService.commitConversationTurn({
        tenantId,
        conversationId: conversation.id,
        expectedVersion: conversation.version,
        userMessage: payload.text || 'Image uploaded',
        assistantMessage: capMsg,
        externalMessageId: options?.externalMessageId,
        setAutomationCapped: true,
        closeConversation: true
      });
      logger.info(`ConversationEngine: Conversation [${conversation.id}] reached turn cap -> set status: COMPLETED, automationCapped: true.`);
      telemetry.emit({
        eventType: 'response_completed',
        tenantId,
        conversationId: conversation.id,
        correlationId,
        stage: 'response',
        status: 'SUCCESS',
        latencyMs: Date.now() - turnStartTime,
        metadata: {
          responseSource: 'CAP',
          outputLength: capMsg.length
        }
      });
      return capMsg;
    }

    if (payload.unsupportedMediaType) {
      const lang = payload.text ? LanguageDetector.detect(payload.text) : config.identity?.language || 'en';
      const mediaScript = DirectRagGuard.detectScript(payload.text || '', lang as any);
      const fallback = this.applyResponseLimit(lang === 'darija' && mediaScript === 'arabic'
        ? 'ما نقدرش نقرا هاد الملف دابا. عفاك كتب ليا الطلب ديالك.' : {
        en: "I can't process this attachment right now. Please send your request as text.",
        fr: "Je ne peux pas traiter cette pièce jointe pour le moment. Envoyez votre demande par écrit.",
        ar: 'لا يمكنني معالجة هذا المرفق حالياً. يرجى إرسال طلبك كنص.',
        darija: 'Ma n9derch n9ra had l-fichier daba. 3afak kteb lia talab dyalek.'
      }[lang] || "I can't process this attachment right now. Please send your request as text.", config.limits?.maxResponseLength);
      await this.conversationService.commitConversationTurn({
        tenantId, conversationId: conversation.id, expectedVersion: conversation.version,
        userMessage: `[Attachment: ${payload.unsupportedMediaType}] ${payload.text || ''}`.trim(),
        assistantMessage: fallback, externalMessageId, responseType: 'UNSUPPORTED_MEDIA'
      });
      return fallback;
    }

    const routed = await this.capabilityRouter.route(tenantId, payload, config, correlationId);

    telemetry.emit({
      eventType: 'routing_decided',
      tenantId,
      conversationId: conversation.id,
      correlationId,
      stage: 'routing',
      status: routed.allowed ? 'SUCCESS' : 'FAILURE',
      metadata: {
        routedType: routed.type,
        allowed: routed.allowed
      }
    });

    if (!routed.allowed) {
      const incomingText = (payload.text || '').trim();
      const detectedLang = incomingText ? LanguageDetector.detect(incomingText) : (config.identity?.language || 'en');
      const imageScript = incomingText ? DirectRagGuard.detectScript(incomingText, detectedLang as any) : (conversation.contextData as any)?._script;
      const defaultFallback = detectedLang === 'darija' && imageScript === 'arabizi' ? 'Ma n9derch n9ra tswira daba. 3afak wsef lia chno bghiti.'
        : DEFAULT_IMAGE_FALLBACK_MESSAGES[detectedLang as keyof typeof DEFAULT_IMAGE_FALLBACK_MESSAGES] || DEFAULT_IMAGE_FALLBACK_MESSAGES.en;
      const promptToUse = config.prompts?.imageFallback;
      const rawFallback = resolveLocalizedPrompt(promptToUse, detectedLang, defaultFallback, imageScript);
      const fallback = this.applyResponseLimit(rawFallback, config.limits?.maxResponseLength);

      await this.conversationService.commitConversationTurn({
        tenantId,
        conversationId: conversation.id,
        expectedVersion: conversation.version,
        userMessage: routed.userDisplayContent,
        assistantMessage: fallback,
        externalMessageId: options?.externalMessageId
      });
      telemetry.emit({
        eventType: 'response_completed',
        tenantId,
        conversationId: conversation.id,
        correlationId,
        stage: 'response',
        status: 'SUCCESS',
        latencyMs: Date.now() - turnStartTime,
        metadata: {
          responseSource: 'IMAGE',
          outputLength: fallback.length
        }
      });
      return fallback;
    }

    // 4. Retrieve active workflow session
    const activeSession = await this.conversationService.getActiveSession(tenantId, conversation.id);

    let response = '';
    let sessionUpdatePayload: {
      sessionId: string;
      stateId: string;
      contextData: Record<string, any>;
      status?: string;
      stateHistory?: string[];
      collectedData?: Record<string, any>;
      humanRequested?: boolean;
      humanRequestedAt?: Date | null;
    } | null = null;
    let flagHumanRequested = false;
    let incrementPostCompletionCount = false;
    let setPostCompletionCapped = false;
    let ragResult: any = null;
    let groundingEvidence = '';
    let turnDecision: TurnDecision;
    let catalogCategories: string[] | undefined = undefined;
    let customCategoryAliases: Record<string, string[]> | undefined = undefined;
    let customAttributeAliases: Record<string, string[]> | undefined = undefined;
    let completedWorkflowId: string | null = null;
    let completedWorkflowConfig: any = null;
    let completedTerminalStateId: string | null = null;
    let completedWorkflowIntents: string[] | null = null;

    const content = routed.effectiveContent;
    const normalizedInput = (payload.text || content).trim().toLowerCase();

    // 3.5 Content Safety Guard: Check before GreetingRouter, FAQ, Workflow, RAG, and LLM
    const detectedLang = LanguageDetector.detect(content);
    const safetyResult = ContentSafetyGuard.evaluate(content, detectedLang);

    // Build canonical ConversationContext foundation for the current turn (bounded max 4 recent turns)
    const recentMessages = await this.conversationService.getRecentMessages(tenantId, conversation.id, 4);
    const conversationContext: ConversationContext = buildConversationContext({
      tenantId,
      accountId: conversation.accountId,
      customerId: conversation.customerId,
      conversationId: conversation.id,
      language: detectedLang,
      accountLanguage: config.identity?.language,
      currentMessageText: content,
      activeSession: activeSession
        ? {
            workflowId: activeSession.workflowId,
            stateId: activeSession.stateId,
            collectedData: activeSession.collectedData && typeof activeSession.collectedData === 'object' && !Array.isArray(activeSession.collectedData)
              ? activeSession.collectedData as Record<string, any>
              : {}
          }
        : null,
      recentMessages,
      totalMessageCount: conversation.messageCount,
      contextData: conversation.contextData as any,
      safetyState: safetyResult.allowed ? { status: 'NORMAL', reason: null } : { status: 'RESTRICTED', reason: safetyResult.reason }
    });

    const effectiveLang = conversationContext.effectiveLanguage;
    const effectiveScript = conversationContext.effectiveScript || DirectRagGuard.detectScript(content, effectiveLang);
    // Customers name products in Darija/Arabic/Arabizi while catalogs are
    // usually French or English; resolve the named product against the live
    // catalog before routing so the turn reaches the product facts.
    let catalogProductId: string | null = null;
    if (config.capabilities?.ecommerceEnabled === true && !activeSession && this.ecommerceService && conversation.accountId) {
      try {
        catalogProductId = (await this.ecommerceService.matchProductFromText(tenantId, conversation.accountId, content))?.id || null;
      } catch (error: any) {
        logger.warn(`ConversationEngine: catalog match unavailable: ${error?.message || error}`);
      }
    }
    turnDecision = TurnDecisionResolver.resolve({
      text: content,
      language: effectiveLang,
      script: effectiveScript,
      productContext: conversationContext.productContext,
      activePolicyEvidence: conversationContext.activePolicyEvidence,
      isEcommerceEnabled: Boolean(config.capabilities?.ecommerceEnabled),
      isGreeting: false,
      isHandoff: false,
      isWorkflow: Boolean(activeSession),
      catalogProductId
    });

    if (!safetyResult.allowed) {
      conversationContext.activeCapability = 'FALLBACK';
      logger.warn(`ConversationEngine: Safety violation detected [${safetyResult.category}] on conversation [${conversation.id}]: ${safetyResult.reason}`);
      telemetry.emit({
        eventType: 'safety_violation',
        tenantId,
        conversationId: conversation.id,
        correlationId,
        stage: 'safety',
        status: 'FAILURE',
        metadata: {
          category: safetyResult.category,
          reason: safetyResult.reason
        }
      });
      const safetyLang = safetyResult.matchedLang || detectedLang;
      const safetyScript = DirectRagGuard.detectScript(content, safetyLang);
      const rawSafetyRefusal = ContentSafetyGuard.getSafetyRefusal(safetyLang, safetyScript);
      const safetyRefusal = AnswerComposer.finalizeResponse(rawSafetyRefusal, {
        domain: 'FALLBACK',
        intent: 'FALLBACK',
        source: 'DETERMINISTIC',
        confidence: 1,
        responseLanguage: safetyLang,
        responseScript: safetyScript
      }, config);
      await this.conversationService.commitConversationTurn({
        tenantId,
        conversationId: conversation.id,
        expectedVersion: conversation.version,
        userMessage: routed.userDisplayContent,
        assistantMessage: safetyRefusal,
        externalMessageId: options?.externalMessageId
      });
      telemetry.emit({
        eventType: 'response_completed',
        tenantId,
        conversationId: conversation.id,
        correlationId,
        stage: 'response',
        status: 'SUCCESS',
        latencyMs: Date.now() - turnStartTime,
        metadata: {
          responseSource: 'SAFETY_GUARD',
          outputLength: safetyRefusal.length
        }
      });
      return safetyRefusal;
    }

    // Universal Human Handoff Keyword Flagging & Response
    const isHandoff = HandoffService.isHandoffRequested(content) ||
      (config.behavior?.allowHumanHandoff && normalizedInput === 'human');

    if (isHandoff) {
      logger.info(`ConversationEngine: Human handoff requested on conversation [${conversation.id}].`);
      flagHumanRequested = true;
      conversation.humanRequested = true;
      const handoffRequestedAt = new Date();

      const turnDecHandoff = TurnDecisionResolver.resolve({
        text: content,
        language: effectiveLang,
        script: effectiveScript,
        productContext: conversationContext.productContext,
        isEcommerceEnabled: Boolean(config.capabilities?.ecommerceEnabled),
        isHandoff: true
      });
      const rawHandoff = AnswerComposer.composeHandoff({
        turnDecision: turnDecHandoff,
        responseLanguage: turnDecHandoff.responseLanguage,
        responseScript: turnDecHandoff.responseScript,
        config
      });
      const handoffMsg = this.applyResponseLimit(rawHandoff, config.limits?.maxResponseLength);

      if (activeSession) {
        sessionUpdatePayload = {
          sessionId: activeSession.id,
          stateId: activeSession.stateId,
          contextData: activeSession.contextData as any,
          humanRequested: true,
          humanRequestedAt: handoffRequestedAt
        };
      }

      await this.conversationService.commitConversationTurn({
        tenantId,
        conversationId: conversation.id,
        expectedVersion: conversation.version,
        userMessage: routed.userDisplayContent,
        assistantMessage: handoffMsg,
        externalMessageId: options?.externalMessageId,
        flagHumanRequested: true,
        newStatus: 'HANDOFF_REQUESTED',
        responseType: 'HANDOFF',
        sessionUpdate: sessionUpdatePayload || undefined
      });

      if (this.outcomeService && effectiveAccountId && !customerExternalId.startsWith('portal-preview:')) {
        try {
          await this.outcomeService.recordEvent({
            tenantId,
            accountId: effectiveAccountId,
            conversationId: conversation.id,
            customerId: conversation.customerId,
            type: 'HANDOFF_REQUESTED',
            source: 'HANDOFF',
            occurredAt: handoffRequestedAt,
            idempotencyKey: `handoff:requested:${conversation.id}:${options?.externalMessageId || conversation.version}`,
            metadata: { reason: 'customer_request' }
          });
        } catch (outcomeErr) {
          logger.warn('ConversationEngine: Non-blocking outcome tracking error (handoff request)', { error: outcomeErr });
        }
      }

      telemetry.emit({
        eventType: 'response_completed',
        tenantId,
        conversationId: conversation.id,
        correlationId,
        stage: 'response',
        status: 'SUCCESS',
        latencyMs: Date.now() - turnStartTime,
        metadata: {
          responseSource: 'HANDOFF',
          outputLength: handoffMsg.length
        }
      });
      return handoffMsg;
    }

    const hasWorkflowsConfigured = Boolean(config.workflows && Object.keys(config.workflows).length > 0);

    if (activeSession) {
      // P0 §5: "cancel" command (Deterministic keyword match, no LLM)
      if (WorkflowCancellationDetector.isCancellation(content)) {
        logger.info(`ConversationEngine: Mid-workflow 'cancel' command triggered in session [${activeSession.id}]`);
        sessionUpdatePayload = {
          sessionId: activeSession.id,
          stateId: activeSession.stateId,
          contextData: activeSession.contextData as any,
          status: 'CANCELLED'
        };
        const defaultCancel = effectiveLang === 'darija' && effectiveScript === 'arabic'
          ? 'تلغى الطلب ديالك.' : DEFAULT_WORKFLOW_MESSAGES.workflowCancelled[effectiveLang as keyof typeof DEFAULT_WORKFLOW_MESSAGES.workflowCancelled] || DEFAULT_WORKFLOW_MESSAGES.workflowCancelled.en;
        const defaultVals = Object.values(DEFAULT_WORKFLOW_MESSAGES.workflowCancelled);
        const promptToUse = config.prompts?.workflowCancelled;
        const rawCancelMsg = promptToUse && (!defaultVals.includes(promptToUse) || typeof promptToUse === 'object')
          ? resolveLocalizedPrompt(promptToUse, effectiveLang, defaultCancel, effectiveScript)
          : defaultCancel;
        response = this.applyResponseLimit(rawCancelMsg, config.limits?.maxResponseLength);
        responseSource = 'WORKFLOW';
      } else {
        // Continue existing workflow
        responseSource = 'WORKFLOW';
        const workflowConfig = config.workflows[activeSession.workflowId];
        if (!workflowConfig) {
          response = config.prompts.workflowUnavailable || 'This workflow is no longer available.';
          sessionUpdatePayload = {
            sessionId: activeSession.id,
            stateId: activeSession.stateId,
            contextData: {},
            status: 'ERROR'
          };
        } else {
          const result = await this.workflowEngine.process(activeSession, content, workflowConfig, config, llm, llmOptions, this.ragService, correlationId, effectiveLang, effectiveScript);
          const newStatus = result.isComplete ? 'COMPLETED' : 'ACTIVE';
          if (result.isComplete) {
            completedWorkflowId = activeSession.workflowId;
            completedWorkflowConfig = workflowConfig;
            completedTerminalStateId = result.nextStateId || activeSession.stateId;
            completedWorkflowIntents = [
              ...(workflowConfig?.activation?.intents || []),
              ...(config.capabilities?.intents?.filter(i => i.workflowId === activeSession.workflowId || (!i.workflowId && i.id === activeSession.workflowId)).map(i => i.id) || [])
            ];
          }
          sessionUpdatePayload = {
            sessionId: activeSession.id,
            stateId: result.nextStateId || activeSession.stateId,
            contextData: result.updatedContext,
            status: newStatus,
            stateHistory: result.updatedStateHistory !== undefined ? result.updatedStateHistory : activeSession.stateHistory,
            collectedData: result.updatedCollectedData !== undefined ? result.updatedCollectedData : (activeSession as any).collectedData
          };
          response = result.response;
        }
      }
    } else {
      // Check if conversation has completed a workflow before (P0 §6 & §8 Post-Completion Mode)
      const previousCompletedSession = hasWorkflowsConfigured
        ? await this.conversationService.getLatestCompletedSession(tenantId, conversation.id)
        : null;

      // Evaluate whether the current message explicitly triggers a new workflow (e.g. re-booking or new workflow)
      let postCompletionWorkflowTrigger = null;
      if (previousCompletedSession && hasWorkflowsConfigured) {
        turnDecision = TurnDecisionResolver.resolve({
          text: content,
          language: effectiveLang,
          script: effectiveScript,
          productContext: conversationContext.productContext,
          activePolicyEvidence: conversationContext.activePolicyEvidence,
          isEcommerceEnabled: Boolean(config.capabilities?.ecommerceEnabled),
          isGreeting: false,
          isHandoff: false,
          isWorkflow: false,
          catalogProductId
        });
        const isDeterministicEcommercePurchase = turnDecision?.domain === 'ECOMMERCE' && turnDecision?.intent === 'BUY_INTENT';

        postCompletionWorkflowTrigger = WorkflowTriggerResolver.resolve(content, config, turnDecision);

        if (!postCompletionWorkflowTrigger && !isDeterministicEcommercePurchase && config.behavior?.useLlmIntentClassification !== false && config.capabilities?.intents && config.capabilities.intents.length > 0 && config.workflows && Object.keys(config.workflows).length > 0) {
          const intentWfMap = new Map<string, string>();
          for (const item of config.capabilities.intents) {
            const targetWfId = item.workflowId || (config.workflows[item.id] ? item.id : undefined);
            if (targetWfId && config.workflows[targetWfId]) {
              intentWfMap.set(item.id, targetWfId);
            }
          }
          for (const [wfId, wf] of Object.entries(config.workflows)) {
            if (wf.activation?.intents && Array.isArray(wf.activation.intents)) {
              for (const intentId of wf.activation.intents) {
                if (intentId) intentWfMap.set(intentId, wfId);
              }
            }
          }

          if (intentWfMap.size > 0) {
            const allowedIntents = Array.from(intentWfMap.keys());
            const intentPrompt = WorkflowTriggerResolver.buildIntentClassificationPrompt(config, allowedIntents, intentWfMap);

            try {
              const classifiedIntent = await llm.classifyIntent(intentPrompt, content, allowedIntents, llmOptions);
              if (classifiedIntent && intentWfMap.has(classifiedIntent)) {
                const targetWfId = intentWfMap.get(classifiedIntent)!;
                postCompletionWorkflowTrigger = { workflowId: targetWfId, workflowConfig: config.workflows[targetWfId] };
              }
            } catch (e: any) {
              logger.warn(`ConversationEngine: Post-completion workflow intent classification failed: ${e.message || e}`);
            }
          }
        }
      }

      if (postCompletionWorkflowTrigger) {
        const { workflowId, workflowConfig } = postCompletionWorkflowTrigger;
        const limitCheck = await this.checkWorkflowExecutionLimit(
          tenantId,
          conversation.customerId,
          workflowId,
          workflowConfig,
          effectiveAccountId,
          effectiveLang
        );

        if (!limitCheck.allowed) {
          logger.info(`ConversationEngine: Workflow [${workflowId}] execution limit reached for customer [${conversation.customerId}] (post-completion re-trigger blocked).`);
          response = this.applyResponseLimit(limitCheck.limitMessage || 'You have already completed this request.', config.limits?.maxResponseLength);
          responseSource = 'WORKFLOW';
        } else {
          responseSource = 'WORKFLOW';
          logger.info(`ConversationEngine: Starting workflow [${workflowId}] for conversation [${conversation.id}] (post-completion re-trigger)`);

          const session = await this.createWorkflowSessionForTurn(
            tenantId, conversation.id, workflowId, workflowConfig, turnDecision,
            conversationContext.productContext, effectiveAccountId, effectiveLang
          );
          const result = await this.workflowEngine.process(session, content, workflowConfig, config, llm, llmOptions, this.ragService, correlationId, effectiveLang, effectiveScript);

          if (result.isComplete) {
            completedWorkflowId = workflowId;
            completedWorkflowConfig = workflowConfig;
            completedTerminalStateId = result.nextStateId || workflowConfig.initialState;
            completedWorkflowIntents = [
              ...(workflowConfig?.activation?.intents || []),
              ...(config.capabilities?.intents?.filter(i => i.workflowId === workflowId || (!i.workflowId && i.id === workflowId)).map(i => i.id) || [])
            ];
          }

          sessionUpdatePayload = {
            sessionId: session.id,
            stateId: result.nextStateId || session.stateId,
            contextData: result.updatedContext,
            status: result.isComplete ? 'COMPLETED' : 'ACTIVE',
            stateHistory: result.updatedStateHistory !== undefined ? result.updatedStateHistory : session.stateHistory,
            collectedData: result.updatedCollectedData !== undefined ? result.updatedCollectedData : {}
          };
          response = result.response;
        }
      } else if (previousCompletedSession) {
        // P0.1 / P0.2 §7: Post-completion mode — FAQ -> PDF/RAG -> static canned fallback. 0 LLM calls.
        logger.info(`ConversationEngine: Conversation [${conversation.id}] in post-completion mode (questions answered: ${conversation.postCompletionQuestionCount}/10)`);
        
        let answered = false;
        let answerText = '';

        // Try FAQ
        if (config.capabilities?.faq && config.capabilities.faq.length > 0) {
          const faqMatch = FaqAnswerPolicy.match(content, config, effectiveLang, turnDecision);
          if (faqMatch && faqMatch.answer && (!faqMatch.confidence || faqMatch.confidence >= 0.75)) {
            answered = true;
            answerText = faqMatch.answer;
            responseSource = 'FAQ';
            logger.info(`ConversationEngine: Post-completion FAQ match [${faqMatch.entry.id}]`);
            telemetry.emit({
              eventType: 'faq_match',
              tenantId,
              conversationId: conversation.id,
              correlationId,
              stage: 'faq',
              status: 'SUCCESS',
              metadata: {
                faqId: faqMatch.entry.id,
                matchType: faqMatch.matchType,
                confidence: faqMatch.confidence
              }
            });
          } else {
            telemetry.emit({
              eventType: 'faq_miss',
              tenantId,
              conversationId: conversation.id,
              correlationId,
              stage: 'faq',
              status: 'SKIPPED',
              metadata: {
                confidence: faqMatch?.confidence || 0
              }
            });
          }
        }

        // Try PDF/RAG if FAQ didn't match
        ragResult = null;
        if (!answered && config.knowledge?.enabled && this.ragService) {
          const ragStartTime = Date.now();
          try {
            let retrievalQuery = content;
            if (QuestionReformulator.isAmbiguous(content, conversationContext.memory)) {
              const reformResult = await QuestionReformulator.reformulate(content, conversationContext.memory, llm, { timeoutMs: 3000 });
              retrievalQuery = reformResult.retrievalQuery;
            }
            ragResult = await this.ragService.retrieve(tenantId, retrievalQuery, config, conversation.accountId);
            const ragLatencyMs = Date.now() - ragStartTime;
            const topChunk = ragResult.chunks?.[0];
            const highConfidenceThreshold = Math.max(config.knowledge.minSimilarityScore || 0.52, 0.70);
            const rawDirectMatch = Boolean(topChunk && topChunk.similarity >= highConfidenceThreshold && topChunk.content);
            const guardResult = rawDirectMatch ? DirectRagGuard.evaluate(content, topChunk.content) : null;
            const isDirectMatch = Boolean(rawDirectMatch && guardResult?.isSafe && !turnDecision?.isMultiPolicy && (config.knowledge as any)?.directAnswer !== false);
            if (isDirectMatch) {
              answered = true;
              answerText = AnswerComposer.formatDirectKnowledgeAnswer(topChunk.content);
              responseSource = 'RAG';
              logger.info(`ConversationEngine: Post-completion RAG match (score: ${topChunk.similarity})`);
            }
            telemetry.emit({
              eventType: 'rag_completed',
              tenantId,
              conversationId: conversation.id,
              correlationId,
              stage: 'rag',
              status: 'SUCCESS',
              latencyMs: ragLatencyMs,
              metadata: {
                chunkCount: ragResult.chunks?.length || 0,
                topSimilarity: topChunk?.similarity || 0,
                threshold: highConfidenceThreshold,
                directAnswer: isDirectMatch,
                embeddingCalls: 1,
                retryAttempts: 0,
                provider: config.knowledge?.embeddingProvider || 'gemini',
                model: config.knowledge?.embeddingModel || 'gemini-embedding-001',
                inputSizeChars: content.length
              }
            });
          } catch (e: any) {
            const ragLatencyMs = Date.now() - ragStartTime;
            logger.warn(`ConversationEngine: Post-completion RAG retrieval failed: ${e.message || e}`);
            telemetry.emit({
              eventType: 'rag_failed',
              tenantId,
              conversationId: conversation.id,
              correlationId,
              stage: 'rag',
              status: 'FAILURE',
              latencyMs: ragLatencyMs,
              errorCode: e.message || String(e),
              metadata: {
                embeddingCalls: 1,
                retryAttempts: 0,
                provider: config.knowledge?.embeddingProvider || 'gemini',
                model: config.knowledge?.embeddingModel || 'gemini-embedding-001',
                inputSizeChars: content.length
              }
            });
          }
        }

        // Try LLM safety-net answer if FAQ and high-confidence RAG missed
        if (!answered) {
          const hasLlmConfigured = Boolean(config.llm?.provider && (this.llmFactory || this.defaultLlm));
          if (hasLlmConfigured) {
            const startTime = Date.now();
            const prepared = GroundedPromptBuilder.prepareGroundedAnswer({
              config, turnDecision, ragResult, content, language: effectiveLang,
              recentTurns: conversationContext.recentTurns
            });
            groundingEvidence = prepared.groundingEvidence;
            const { systemPrompt, userPromptContent } = prepared;

            try {
              const timeoutMs = config.llm?.timeoutMs ?? 10000;
              const rawResponse = await generateResponseWithDeadline(llm, systemPrompt, [{ role: 'user', content: userPromptContent }], {
                temperature: config.llm?.temperature ?? 0.2,
                maxTokens: llmOptions.maxTokens ?? config.llm?.maxTokens ?? 300,
                timeoutMs
              });
              const latencyMs = Date.now() - startTime;
              const trimmed = (rawResponse || '').trim();

              const inputTokensEst = Math.ceil((systemPrompt.length + userPromptContent.length) / 4);
              const outputTokensEst = Math.ceil((trimmed || '').length / 4);

              if (trimmed && trimmed !== 'UNANSWERABLE' && !trimmed.startsWith('UNANSWERABLE')) {
                answered = true;
                answerText = trimmed;
                responseSource = 'LLM';
                logger.info(`ConversationEngine: Post-completion LLM answer generated`, {
                  event: 'post_completion_llm_answered',
                  tenantId,
                  latencyMs,
                  failureReason: null,
                  inputLength: content.length
                });
                telemetry.emit({
                  eventType: 'llm_completed',
                  tenantId,
                  conversationId: conversation.id,
                  correlationId,
                  stage: 'llm',
                  status: 'SUCCESS',
                  latencyMs,
                  provider: config.llm?.provider || 'unknown',
                  model: config.llm?.model || 'unknown',
                  metadata: {
                    purpose: 'post_completion_grounded_answer',
                    inputLength: content.length,
                    inputTokens: inputTokensEst,
                    outputTokens: outputTokensEst,
                    retryAttempts: 0
                  }
                });
              } else {
                logger.info(`ConversationEngine: Post-completion LLM marked query UNANSWERABLE`, {
                  event: 'post_completion_llm_unanswerable',
                  tenantId,
                  latencyMs,
                  failureReason: null,
                  inputLength: content.length
                });
                telemetry.emit({
                  eventType: 'llm_completed',
                  tenantId,
                  conversationId: conversation.id,
                  correlationId,
                  stage: 'llm',
                  status: 'UNANSWERABLE',
                  latencyMs,
                  provider: config.llm?.provider || 'unknown',
                  model: config.llm?.model || 'unknown',
                  metadata: {
                    purpose: 'post_completion_grounded_answer',
                    inputLength: content.length,
                    inputTokens: inputTokensEst,
                    outputTokens: outputTokensEst,
                    retryAttempts: 0
                  }
                });
              }
            } catch (err: any) {
              const latencyMs = Date.now() - startTime;
              const failureReason = err.message === 'TIMEOUT' ? 'timeout' : (err.status === 429 ? 'rate_limit' : 'error');
              logger.warn(`ConversationEngine: Post-completion LLM fallback failed (${failureReason})`, {
                event: 'post_completion_llm_failed',
                tenantId,
                latencyMs,
                failureReason,
                inputLength: content.length
              });
              telemetry.emit({
                eventType: 'llm_failed',
                tenantId,
                conversationId: conversation.id,
                correlationId,
                stage: 'llm',
                status: 'FAILURE',
                latencyMs,
                provider: config.llm?.provider || 'unknown',
                model: config.llm?.model || 'unknown',
                errorCode: failureReason,
                metadata: {
                  purpose: 'post_completion_grounded_answer',
                  inputLength: content.length
                }
              });
            }
          }
        }

        if (answered) {
          const currentCount = conversation.postCompletionQuestionCount + 1;
          incrementPostCompletionCount = true;

          if (currentCount >= 10) {
            // 10th answered question: send answer + closing line, then cap
            setPostCompletionCapped = true;
            const defaultClosing = effectiveLang === 'darija' && effectiveScript === 'arabic' ? 'نكملو المتابعة ديال الطلب ديالك مع الفريق.'
              : DEFAULT_POST_COMPLETION_MESSAGES.closing[effectiveLang as keyof typeof DEFAULT_POST_COMPLETION_MESSAGES.closing] || DEFAULT_POST_COMPLETION_MESSAGES.closing.en;
            const closingLine = resolveLocalizedPrompt(config.prompts?.postCompletionClosing, effectiveLang, defaultClosing, effectiveScript);
            response = `${answerText}\n\n${closingLine}`;
            logger.info(`ConversationEngine: Reached 10th post-completion question -> postCompletionCapped set to true.`);
          } else {
            response = answerText;
          }
        } else {
          // Post-completion unmatched message -> static canned response
          responseSource = 'FALLBACK';
          logger.info(`ConversationEngine: Post-completion unmatched message "${content}" -> returning static canned response.`);
          const defaultFallback = effectiveLang === 'darija' && effectiveScript === 'arabic' ? 'نقدر نعاونك فالأسئلة اللي عندها علاقة بالطلب ديالك.'
            : DEFAULT_POST_COMPLETION_MESSAGES.fallback[effectiveLang as keyof typeof DEFAULT_POST_COMPLETION_MESSAGES.fallback] || DEFAULT_POST_COMPLETION_MESSAGES.fallback.en;
          response = resolveLocalizedPrompt(config.prompts?.postCompletionFallback, effectiveLang, defaultFallback, effectiveScript);
        }
      } else {
        // Standard conversational routing (Greeting -> FAQ -> Workflow Trigger -> TurnDecision -> Ecommerce -> Policy -> RAG -> Grounded LLM -> Fallback)
        let answered = false;
        let answerText = '';
        let groundedLlmAttempted = false;
        let groundedLlmUnanswerable = false;

        const normalizedContent = GreetingRouter.normalize(content);
        const hasQuestion = GreetingRouter.hasQuestionIndicator(content, normalizedContent);

        // Step 1: Deterministic Known Greeting & Polite Acknowledgment Check (0 LLM calls)
        if (!hasQuestion && GreetingRouter.isKnownGreeting(normalizedContent)) {
          logger.info(`ConversationEngine: Deterministic greeting match for "${content}" (lang: ${effectiveLang}, 0 LLM calls)`);
          answered = true;
          answerText = AnswerComposer.composeGreeting({ turnDecision, responseLanguage: effectiveLang, responseScript: effectiveScript, config });
          responseSource = 'GREETING';
        }

        // Step 1.7: Resolve TurnDecision for authoritative routing (0 extra LLM calls)
        const isEcommerceEnabled = Boolean(config.capabilities?.ecommerceEnabled);
        const targetAccountId = conversation.accountId || effectiveAccountId;

        if (isEcommerceEnabled && this.ecommerceService && targetAccountId) {
          try {
            catalogCategories = await this.ecommerceService.getDistinctCategories(tenantId, targetAccountId);
          } catch {
            // Non-fatal fallback for catalog category lookup
          }
        }

        customCategoryAliases = (config.capabilities as any)?.ecommerceTaxonomy?.categories
          || (config.capabilities as any)?.ecommerceCategories
          || (config as any)?.ecommerce?.categories;

        customAttributeAliases = (config.capabilities as any)?.ecommerceTaxonomy?.attributes
          || (config.capabilities as any)?.ecommerceAttributes
          || (config as any)?.ecommerce?.attributes;

        if (!answered) {
          turnDecision = TurnDecisionResolver.resolve({
            text: content,
            language: effectiveLang,
            script: effectiveScript,
            productContext: conversationContext.productContext,
            activePolicyEvidence: conversationContext.activePolicyEvidence,
            catalogCategories,
            customCategoryAliases,
            customAttributeAliases,
            shippingScope: config.capabilities?.shippingScope,
            domesticCountry: config.identity?.country,
            isEcommerceEnabled,
            isGreeting: false,
            isHandoff: false,
            isWorkflow: false,
            catalogProductId
          });
        }

        // Resolve an explicit customer action before considering a static FAQ.
        // A curated answer may share wording with a demo/order trigger, but it
        // must not swallow the request to start that workflow.
        const explicitWorkflowTrigger = !answered
          ? WorkflowTriggerResolver.resolve(content, config, turnDecision)
          : null;

        // Stable, reviewed FAQs can answer a narrow question without a model
        // call. The shared policy also runs inside active workflows.
        if (!answered && !explicitWorkflowTrigger && config.capabilities?.faq?.length) {
          const faqMatch = FaqAnswerPolicy.match(content, config, effectiveLang, turnDecision);
          if (faqMatch) {
            answered = true;
            answerText = faqMatch.answer.trim();
            responseSource = 'FAQ';
            const policyIntent = PolicyEvidenceReuse.isCanonicalPolicy(turnDecision.intent)
              ? turnDecision.intent
              : (faqMatch.entry.category || '').toUpperCase();
            if (PolicyEvidenceReuse.isCanonicalPolicy(policyIntent)) {
              const updatedEvidenceMap = { ...(conversationContext.activePolicyEvidence || {}) };
              updatedEvidenceMap[policyIntent] = [{
                intent: policyIntent,
                sourceDocumentId: `faq-${faqMatch.entry.id}`,
                sourceChunkId: `faq-chunk-${faqMatch.entry.id}`,
                factualContent: answerText,
                confidence: faqMatch.confidence || 0.95,
                chunkType: 'FACTUAL_POLICY',
                provenance: {
                  documentTitle: `FAQ — ${policyIntent}`,
                  tenantId,
                  accountId: conversation.accountId
                }
              }];
              conversationContext.activePolicyEvidence = updatedEvidenceMap;
              contextDataUpdate = {
                ...((conversation.contextData as Record<string, unknown>) || {}),
                ...(contextDataUpdate || {}),
                activePolicyEvidence: updatedEvidenceMap
              };
            }
            logger.info(`ConversationEngine: Curated FAQ match [${faqMatch.entry.id}] before service fallback.`);
          }
        }

        // A workflow that owns this turn (explicit trigger now, or an active
        // collecting session) must not be pre-empted by a deterministic fact.
        const workflowOwnsTurn = Boolean(explicitWorkflowTrigger) || Boolean(activeSession);

        // The merchant's own address is authoritative account data. Answering
        // this narrow question directly avoids a model occasionally saying it
        // does not know the address despite the configured location.
        if (!answered && !workflowOwnsTurn && BusinessQuestionScope.requestedTopicCount(content) <= 1
          && /\b(?:fin\s+kaynin|fin\s+kay(?:n|nin)|where\s+are\s+you|your\s+address|votre\s+adresse|ou\s+etes\s+vous|fin\s+jat|fin\s+jaya|fin\s+kayna|where\s+is\s+(?:your|the)\s+(?:shop|store|boutique)|physical\s+(?:store|shop)|o[uù]\s+se\s+trouve)\b|فين\s+كاينين|فين\s+جات|فين\s+جاين|أين\s+يوجد\s+متجركم|فين\s+كائنين|العنوان\s+ديالكم/iu.test(content)
          && !/\b(?:katseddo|katsedou|kat7ello|kathllo|closing\s+time|opening\s+hours|what\s+time\s+(?:do\s+you\s+)?close)\b|كتسدو|كتحلو/iu.test(content)
          && config.identity?.locations?.length) {
          const location = config.identity.locations[0];
          const prefix = effectiveScript === 'arabizi' ? 'Kaynin f '
            : effectiveLang === 'fr' ? 'Nous sommes à '
            : effectiveLang === 'ar' || effectiveLang === 'darija' ? 'العنوان ديالنا: '
            : 'We are at ';
          answered = true;
          answerText = `${prefix}${location}.`;
          responseSource = 'SERVICE';
        }

        if (!answered && !workflowOwnsTurn && config.capabilities?.ecommerceEnabled !== true
          && BusinessQuestionScope.requestedTopicCount(content) === 1
          && /\b(?:price|cost|prix|tarif\w*|combien\s+co[uû]te|how\s+much\s+(?:is|does|for)|bch[7h]al|ch[7h]al)\b|ثمن|سعر|شحال/iu.test(content)) {
          const servicePrice = AnswerComposer.composeServicePrice({ turnDecision, userMessage: content, responseLanguage: effectiveLang, responseScript: effectiveScript, config });
          if (servicePrice) {
            answered = true;
            answerText = servicePrice;
            responseSource = 'SERVICE';
          }
        }

        // Step 1.8: Check explicit workflow trigger (intents[].workflowId or activation config)
        let triggeredWorkflow = !answered ? explicitWorkflowTrigger : null;
        const isDeterministicEcommercePurchase = turnDecision?.domain === 'ECOMMERCE' && turnDecision?.intent === 'BUY_INTENT';

        // If not deterministically triggered and not an explicit BUY_INTENT purchase, check declared intents mapped to workflows via LLM classification
        if (!answered && !triggeredWorkflow && !isDeterministicEcommercePurchase && config.behavior?.useLlmIntentClassification !== false && config.capabilities?.intents && config.capabilities.intents.length > 0 && config.workflows && Object.keys(config.workflows).length > 0) {
          const intentWfMap = new Map<string, string>();
          for (const item of config.capabilities.intents) {
            const targetWfId = item.workflowId || (config.workflows[item.id] ? item.id : undefined);
            if (targetWfId && config.workflows[targetWfId]) {
              intentWfMap.set(item.id, targetWfId);
            }
          }
          for (const [wfId, wf] of Object.entries(config.workflows)) {
            if (wf.activation?.intents && Array.isArray(wf.activation.intents)) {
              for (const intentId of wf.activation.intents) {
                if (intentId) intentWfMap.set(intentId, wfId);
              }
            }
          }

          if (intentWfMap.size > 0) {
            const allowedIntents = Array.from(intentWfMap.keys());
            const intentPrompt = WorkflowTriggerResolver.buildIntentClassificationPrompt(config, allowedIntents, intentWfMap);

            try {
              const classifiedIntent = await llm.classifyIntent(intentPrompt, content, allowedIntents, llmOptions);
              if (classifiedIntent && intentWfMap.has(classifiedIntent)) {
                const targetWfId = intentWfMap.get(classifiedIntent)!;
                triggeredWorkflow = { workflowId: targetWfId, workflowConfig: config.workflows[targetWfId] };
              }
            } catch (e: any) {
              logger.warn(`ConversationEngine: Workflow intent classification failed: ${e.message || e}`);
            }
          }
        }

        if (!answered && triggeredWorkflow) {
          const { workflowId, workflowConfig } = triggeredWorkflow;
          const limitCheck = await this.checkWorkflowExecutionLimit(
            tenantId,
            conversation.customerId,
            workflowId,
            workflowConfig,
            effectiveAccountId,
            effectiveLang
          );

          if (!limitCheck.allowed) {
            logger.info(`ConversationEngine: Workflow [${workflowId}] execution limit reached for customer [${conversation.customerId}].`);
            response = this.applyResponseLimit(limitCheck.limitMessage || 'You have already completed this request.', config.limits?.maxResponseLength);
            answerText = response;
            responseSource = 'WORKFLOW';
            answered = true;
          } else {
            responseSource = 'WORKFLOW';
            logger.info(`ConversationEngine: Starting workflow [${workflowId}] for fresh conversation [${conversation.id}]`);

            const session = await this.createWorkflowSessionForTurn(
              tenantId, conversation.id, workflowId, workflowConfig, turnDecision,
              conversationContext.productContext, targetAccountId, effectiveLang
            );
            const result = await this.workflowEngine.process(session, content, workflowConfig, config, llm, llmOptions, this.ragService, correlationId, effectiveLang, effectiveScript);

            if (result.isComplete) {
              completedWorkflowId = workflowId;
              completedWorkflowConfig = workflowConfig;
              completedTerminalStateId = result.nextStateId || workflowConfig.initialState;
              completedWorkflowIntents = [
                ...(workflowConfig?.activation?.intents || []),
                ...(config.capabilities?.intents?.filter(i => i.workflowId === workflowId || (!i.workflowId && i.id === workflowId)).map(i => i.id) || [])
              ];
            }

            sessionUpdatePayload = {
              sessionId: session.id,
              stateId: result.nextStateId || session.stateId,
              contextData: result.updatedContext,
              status: result.isComplete ? 'COMPLETED' : 'ACTIVE',
              stateHistory: result.updatedStateHistory !== undefined ? result.updatedStateHistory : session.stateHistory,
              collectedData: result.updatedCollectedData !== undefined ? result.updatedCollectedData : {}
            };
            response = result.response;
            answerText = result.response;
            answered = true;
          }
        }

        // Step 2.5: Conversational Ecommerce Engine (Strong Domain Execution if ecommerceEnabled and accountId is present)
        if (!answered && isEcommerceEnabled && this.ecommerceService && targetAccountId) {
          if (turnDecision.domain === 'ECOMMERCE') {
            const ecommerceResult = await EcommerceIntentHandler.handle({
              turnDecision,
              tenantId,
              targetAccountId,
              effectiveLang,
              content,
              conversation,
              conversationContext,
              correlationId,
              config,
              ecommerceService: this.ecommerceService
            });
            if (ecommerceResult.handled) {
              answered = true;
              responseSource = ecommerceResult.responseSource!;
              answerText = ecommerceResult.answerText!;
              if (ecommerceResult.productContextUpdate !== undefined) {
                conversationContext.productContext = ecommerceResult.productContextUpdate;
              }
              if (ecommerceResult.contextDataUpdate !== undefined) {
                contextDataUpdate = ecommerceResult.contextDataUpdate;
              }
            }
          }
        }

        // Step 2.8: Deterministic High-Confidence FAQ Fast-Path (0 embedding calls, 0 LLM calls)
        if (
          !answered &&
          turnDecision.domain !== 'ECOMMERCE' &&
          turnDecision.intent !== 'COMPARE' &&
          !turnDecision.isMultiPolicy &&
          !turnDecision.isScopeExpansion &&
          config.capabilities?.faq &&
          config.capabilities.faq.length > 0
        ) {
          const faqMatch = FaqAnswerPolicy.match(content, config, effectiveLang, turnDecision);
          if (faqMatch && faqMatch.answer && (!faqMatch.confidence || faqMatch.confidence >= 0.75)) {
            // Phase 38C: Intent-category parity guard — when TurnDecision has a specific
            // policy intent, verify the FAQ category is compatible before accepting.
            // Non-specific intents (GENERAL_CONVERSATION, UNKNOWN, KNOWLEDGE_RETRIEVAL) trust FaqMatcher.
            const specificIntent = turnDecision.intent
              && turnDecision.intent !== 'UNKNOWN'
              && turnDecision.intent !== 'GENERAL_CONVERSATION'
              && turnDecision.intent !== 'KNOWLEDGE_RETRIEVAL';
            const faqCategory = (faqMatch.entry.category || '').toUpperCase();
            const isScriptMismatch = turnDecision.responseScript === 'arabizi' && /[\u0600-\u06FF]/.test(faqMatch.answer);
            const intentCategoryCompatible = (!specificIntent || FaqAnswerPolicy.isCategoryCompatible(turnDecision.intent, faqCategory)) && !isScriptMismatch;

            if (!intentCategoryCompatible) {
              logger.info(`ConversationEngine: FAQ fast-path rejected [${faqMatch.entry.id}] — intent/category or script mismatch (intent=${turnDecision.intent}, faqCategory=${faqCategory}, isScriptMismatch=${isScriptMismatch}). Falling through to RAG.`);
            } else {
            answered = true;
            answerText = AnswerComposer.finalizeResponse(faqMatch.answer.trim(), turnDecision, config);
            responseSource = 'FAQ';
            logger.info(`ConversationEngine: Workflow-less FAQ fast-path match [${faqMatch.entry.id}] (confidence: ${faqMatch.confidence}, 0 embedding calls, 0 LLM calls).`);
            telemetry.emit({
              eventType: 'faq_match',
              tenantId,
              conversationId: conversation.id,
              correlationId,
              stage: 'faq',
              status: 'SUCCESS',
              metadata: {
                faqId: faqMatch.entry.id,
                matchType: faqMatch.matchType,
                confidence: faqMatch.confidence,
                fastPath: true
              }
            });

            // Populate session activePolicyEvidence cache with authoritative FAQ answer
            const policyIntent = (turnDecision.intent && turnDecision.intent !== 'UNKNOWN' && turnDecision.intent !== 'GENERAL_CONVERSATION')
              ? turnDecision.intent
              : (faqMatch.entry.category ? faqMatch.entry.category.toUpperCase() : 'STORE_INFO');

            if (PolicyEvidenceReuse.isCanonicalPolicy(policyIntent)) {
              const currentContextData = (conversation.contextData as Record<string, any>) || {};
              let updatedEvidenceMap = { ...(conversationContext.activePolicyEvidence || {}) };
              const faqEvidence: PolicyEvidence = {
                intent: policyIntent,
                sourceDocumentId: `faq-${faqMatch.entry.id}`,
                sourceChunkId: `faq-chunk-${faqMatch.entry.id}`,
                factualContent: faqMatch.answer,
                confidence: faqMatch.confidence || 0.95,
                chunkType: 'FACTUAL_POLICY',
                provenance: {
                  documentTitle: `FAQ — ${policyIntent}`,
                  tenantId,
                  accountId: conversation.accountId
                }
              };
              updatedEvidenceMap[policyIntent] = [faqEvidence];
              conversationContext.activePolicyEvidence = updatedEvidenceMap;
              currentContextData.activePolicyEvidence = updatedEvidenceMap;
              contextDataUpdate = currentContextData;
            }
            } // end intent-category parity else
          }
        }

        // Step 3: Unified Knowledge / RAG check (if not answered by Greeting or Ecommerce and knowledge enabled)
        ragResult = null;
        if (!answered && (turnDecision.domain === 'KNOWLEDGE' || config.knowledge?.enabled) && this.ragService) {
          const ragStartTime = Date.now();
          let retrievalQuery = content;
          try {
            const activeEvidenceMap = conversationContext.activePolicyEvidence || {};

            const canBypassReformulator = RagRetrievalPlanner.canBypassReformulator({
              decision: turnDecision, content, config, evidence: activeEvidenceMap,
              productContext: conversationContext.productContext
            });

            if (!canBypassReformulator && QuestionReformulator.isAmbiguous(content, conversationContext.memory)) {
              const reformResult = await QuestionReformulator.reformulate(content, conversationContext.memory, llm, { timeoutMs: 2000 });
              retrievalQuery = reformResult.retrievalQuery;
            }

            const effectiveKnowledgeConfig = RagRetrievalPlanner.knowledgeConfigForTurn(config, turnDecision);

            const cachedPlan = RagRetrievalPlanner.planCachedEvidence({
              decision: turnDecision, content, config, evidence: activeEvidenceMap
            });
            const isReusedSingleEvidence = cachedPlan.reusedSingle;
            const isReusedMultiEvidence = cachedPlan.reusedMulti;
            const multiMissingIntents = cachedPlan.missingIntents;
            const multiCachedChunks = cachedPlan.cachedChunks;
            ragResult = cachedPlan.result;
            if (isReusedSingleEvidence) {
              logger.info(`ConversationEngine: Reusing session PolicyEvidence for intent [${turnDecision.intent}] (${ragResult!.chunks.length} chunks, 0 embedding calls).`);
            } else if (isReusedMultiEvidence) {
              logger.info(`ConversationEngine: Reusing session multi-policy PolicyEvidence for [${turnDecision.policyIntents!.join(', ')}] (${multiCachedChunks.length} chunks, 0 embedding calls).`);
            }

            let multiResultEvidence: PolicyEvidence[] | null = null;

            // Execution: If not fully satisfied by session cache, perform targeted RAG retrieval
            if (!isReusedSingleEvidence && !isReusedMultiEvidence) {
              if (
                turnDecision.isMultiPolicy &&
                turnDecision.policyIntents &&
                turnDecision.policyIntents.length > 1 &&
                typeof (this.ragService as any).retrieveMultiPolicy === 'function'
              ) {
                const targetIntents = multiMissingIntents.length > 0 ? multiMissingIntents : turnDecision.policyIntents;
                const multiResult = await this.ragService.retrieveMultiPolicy(
                  tenantId,
                  targetIntents,
                  effectiveKnowledgeConfig,
                  conversation.accountId,
                  effectiveLang,
                  turnDecision.productName
                );
                multiResultEvidence = multiResult.evidence || null;

                const mergedChunks = [...multiCachedChunks, ...multiResult.chunks];
                ragResult = {
                  context: mergedChunks.map(c => c.content).join('\n---\n'),
                  chunks: mergedChunks
                };

                // Phase 46L: Deterministic Multi-Policy Direct Answer Evaluation
                const targetPolicies = turnDecision.policyIntents && turnDecision.policyIntents.length > 1
                  ? turnDecision.policyIntents
                  : targetIntents;

                let isDirectMultiMatch = false;

                if (
                  turnDecision.isMultiPolicy &&
                  !turnDecision.isComparative &&
                  turnDecision.source !== 'HYBRID' &&
                  targetPolicies.length > 1 &&
                  mergedChunks.length >= targetPolicies.length
                ) {
                  const multiMatch = PolicyEvidenceReuse.findDeterministicMultiMatch(targetPolicies, mergedChunks, content, effectiveLang, turnDecision.responseScript);

                  if (multiMatch.matched) {
                    isDirectMultiMatch = true;
                    answered = true;
                    const composedText = AnswerComposer.composeMultiPolicyDeterministic(multiMatch.selectedPolicyItems, effectiveLang, turnDecision.responseScript);
                    answerText = AnswerComposer.finalizeResponse(composedText, turnDecision, config);
                    responseSource = 'RAG';
                    AnswerComposer.attachMediaToContext(AnswerComposer.extractMedia({
                      chunks: mergedChunks,
                      userMessage: content,
                      intent: turnDecision.intent
                    }));
                    logger.info(`ConversationEngine: Deterministic multi-policy RAG match for [${targetPolicies.join(', ')}] (0 LLM calls).`);
                  }
                }

                const ragLatencyMs = Date.now() - ragStartTime;
                telemetry.emit({
                  eventType: 'rag_completed',
                  tenantId,
                  conversationId: conversation.id,
                  correlationId,
                  stage: 'rag',
                  status: 'SUCCESS',
                  latencyMs: ragLatencyMs,
                  metadata: {
                    isMultiPolicy: true,
                    chunkCount: mergedChunks.length,
                    topSimilarity: mergedChunks[0]?.similarity || 0,
                    threshold: config.knowledge?.minSimilarityScore || 0.52,
                    directAnswer: isDirectMultiMatch,
                    embeddingCalls: multiResult.telemetry.embeddingCalls,
                    retryAttempts: 0,
                    provider: config.knowledge?.embeddingProvider || 'gemini',
                    model: config.knowledge?.embeddingModel || 'gemini-embedding-001',
                    inputSizeChars: retrievalQuery.length,
                    policySubqueries: multiResult.telemetry.policySubqueries,
                    retrievedCandidates: multiResult.telemetry.retrievedCandidates,
                    filteredInternalChunks: multiResult.telemetry.filteredInternalChunks,
                    finalEvidenceChunks: multiResult.telemetry.finalEvidenceChunks,
                    missingPolicyIntents: multiResult.telemetry.missingPolicyIntents
                  }
                });
              } else {
                ragResult = await this.ragService.retrieve(tenantId, retrievalQuery, effectiveKnowledgeConfig,
                  conversation.accountId, PolicyEvidenceReuse.isCanonicalPolicy(turnDecision.intent) ? turnDecision.intent : undefined);
                const ragLatencyMs = Date.now() - ragStartTime;
                const topChunk = ragResult.chunks?.[0];
                const highConfidenceThreshold = Math.max(config.knowledge.minSimilarityScore || 0.52, 0.70);
                const canDirectReturnPolicy = turnDecision.source !== 'HYBRID'
                  || (PolicyEvidenceReuse.isCanonicalPolicy(turnDecision.intent) && !turnDecision.isMultiPolicy);
                const directChunk = canDirectReturnPolicy
                  ? ragResult.chunks?.find((ch: RAGChunk) => ch.content && ch.similarity >= highConfidenceThreshold
                    && DirectRagGuard.evaluate(content, ch.content, effectiveLang, turnDecision.responseScript).isSafe
                    && (!turnDecision.isScopeExpansion || PolicyEvidenceReuse.isSufficient(
                      'SHIPPING', content, [{ factualContent: ch.content } as PolicyEvidence], config
                    ).isSufficient))
                  : undefined;
                const isDirectMatch = Boolean(directChunk && (config.knowledge as any)?.directAnswer !== false);
                if (isDirectMatch) {
                  answered = true;
                  answerText = AnswerComposer.finalizeResponse(AnswerComposer.formatDirectKnowledgeAnswer(directChunk!.content), turnDecision, config);
                  responseSource = 'RAG';
                  AnswerComposer.attachMediaToContext(AnswerComposer.extractMedia({
                    chunks: ragResult.chunks,
                    userMessage: content,
                    intent: turnDecision.intent
                  }));
                  // Only the verified passage may become reusable policy evidence.
                  // Nearby vector matches can concern a different policy entirely.
                  ragResult = { ...ragResult, context: directChunk!.content, chunks: [directChunk!] };
                  logger.info(`ConversationEngine: Workflow-less RAG match (score: ${directChunk!.similarity})`);
                }
                telemetry.emit({
                  eventType: 'rag_completed',
                  tenantId,
                  conversationId: conversation.id,
                  correlationId,
                  stage: 'rag',
                  status: 'SUCCESS',
                  latencyMs: ragLatencyMs,
                  metadata: {
                    chunkCount: ragResult.chunks?.length || 0,
                    topSimilarity: topChunk?.similarity || 0,
                    threshold: highConfidenceThreshold,
                    directAnswer: isDirectMatch,
                    embeddingCalls: 1,
                    retryAttempts: 0,
                    provider: config.knowledge?.embeddingProvider || 'gemini',
                    model: config.knowledge?.embeddingModel || 'gemini-embedding-001',
                    inputSizeChars: retrievalQuery.length
                  }
                });
              }
            } else {
              // Direct match check on reused single policy evidence
              const topChunk = ragResult.chunks?.[0];
              const highConfidenceThreshold = Math.max(config.knowledge.minSimilarityScore || 0.52, 0.70);

              let isDirectMatch = false;

              if (
                turnDecision.isMultiPolicy &&
                !turnDecision.isComparative &&
                turnDecision.source !== 'HYBRID' &&
                isReusedMultiEvidence
              ) {
                const targetPolicies = turnDecision.policyIntents || [];
                const multiMatch = PolicyEvidenceReuse.findDeterministicMultiMatch(targetPolicies, ragResult.chunks, content, effectiveLang, turnDecision.responseScript);

                if (multiMatch.matched) {
                  isDirectMatch = true;
                  answered = true;
                  const composedText = AnswerComposer.composeMultiPolicyDeterministic(multiMatch.selectedPolicyItems, effectiveLang, turnDecision.responseScript);
                  answerText = AnswerComposer.finalizeResponse(composedText, turnDecision, config);
                  responseSource = 'RAG';
                  AnswerComposer.attachMediaToContext(AnswerComposer.extractMedia({
                    chunks: ragResult.chunks,
                    userMessage: content,
                    intent: turnDecision.intent
                  }));
                  logger.info(`ConversationEngine: Session-reused deterministic multi-policy RAG match for [${targetPolicies.join(', ')}] (0 LLM calls).`);
                }
              } else if (!turnDecision.isMultiPolicy) {
                // Phase 39B: Reused single policy evidence already verified by PolicyEvidenceReuse.isSufficient()
                // requires only topChunk.content to proceed to DirectRagGuard evaluation
                const rawDirectMatch = Boolean(topChunk && (isReusedSingleEvidence || topChunk.similarity >= highConfidenceThreshold) && topChunk.content);
                const guardResult = (rawDirectMatch && (turnDecision.source !== 'HYBRID'
                  || PolicyEvidenceReuse.isCanonicalPolicy(turnDecision.intent)))
                  ? DirectRagGuard.evaluate(content, topChunk.content, effectiveLang, turnDecision.responseScript)
                  : null;
                isDirectMatch = Boolean(rawDirectMatch && guardResult?.isSafe && (config.knowledge as any)?.directAnswer !== false);
                if (isDirectMatch) {
                  answered = true;
                  answerText = AnswerComposer.finalizeResponse(AnswerComposer.formatDirectKnowledgeAnswer(topChunk.content), turnDecision, config);
                  responseSource = 'RAG';
                  AnswerComposer.attachMediaToContext(AnswerComposer.extractMedia({
                    chunks: ragResult.chunks,
                    userMessage: content,
                    intent: turnDecision.intent
                  }));
                  logger.info(`ConversationEngine: Workflow-less session-reused RAG match (score: ${topChunk.similarity})`);
                }
              }
              telemetry.emit({
                eventType: 'rag_completed',
                tenantId,
                conversationId: conversation.id,
                correlationId,
                stage: 'rag',
                status: 'SUCCESS',
                latencyMs: 0,
                metadata: {
                  isPolicyEvidenceReused: true,
                  isMultiPolicy: Boolean(isReusedMultiEvidence),
                  chunkCount: ragResult.chunks?.length || 0,
                  topSimilarity: topChunk?.similarity || 0,
                  threshold: highConfidenceThreshold,
                  directAnswer: isDirectMatch,
                  embeddingCalls: 0,
                  retryAttempts: 0
                }
              });
            }

            // Phase 37E: 3. Update session activePolicyEvidence cache with authoritative retrieved chunks
            if (ragResult?.chunks && ragResult.chunks.length > 0 && turnDecision.domain === 'KNOWLEDGE'
              && (turnDecision.isMultiPolicy || answered)) {
              let updatedEvidenceMap = { ...(conversationContext.activePolicyEvidence || {}) };
              const targetIntents = turnDecision.isMultiPolicy && turnDecision.policyIntents && turnDecision.policyIntents.length > 0
                ? turnDecision.policyIntents
                : [turnDecision.intent];

              for (const pol of targetIntents) {
                if (PolicyEvidenceReuse.isCanonicalPolicy(pol)) {
                  const newEvidenceItems: PolicyEvidence[] = turnDecision.isMultiPolicy
                    ? (multiResultEvidence || []).filter(ev => ev.intent === pol)
                    : ragResult.chunks.map((ch: RAGChunk) => ({
                    intent: pol,
                    sourceDocumentId: ch.documentId,
                    sourceChunkId: ch.id,
                    factualContent: ch.content,
                    confidence: ch.similarity || 0.8,
                    chunkType: (ch as any).chunkType || 'FACTUAL_POLICY',
                    provenance: {
                      documentTitle: ch.documentTitle,
                      tenantId,
                      accountId: conversation.accountId
                    }
                  }));
                  if (newEvidenceItems.length > 0) {
                    updatedEvidenceMap = PolicyEvidenceReuse.mergeEvidence(updatedEvidenceMap, pol, newEvidenceItems);
                  }
                }
              }
              conversationContext.activePolicyEvidence = updatedEvidenceMap;
              contextDataUpdate = {
                ...(conversation.contextData as any || {}),
                ...(contextDataUpdate || {}),
                activePolicyEvidence: updatedEvidenceMap
              };
            }
          } catch (e: any) {
            const ragLatencyMs = Date.now() - ragStartTime;
            logger.warn(`ConversationEngine: Workflow-less RAG retrieval failed: ${e.message || e}`);
            telemetry.emit({
              eventType: 'rag_failed',
              tenantId,
              conversationId: conversation.id,
              correlationId,
              stage: 'rag',
              status: 'FAILURE',
              latencyMs: ragLatencyMs,
              errorCode: e.message || String(e),
              metadata: {
                embeddingCalls: 1,
                retryAttempts: 0,
                provider: config.knowledge?.embeddingProvider || 'gemini',
                model: config.knowledge?.embeddingModel || 'gemini-embedding-001',
                inputSizeChars: retrievalQuery.length
              }
            });
          }
        }

        if (!answered && turnDecision.intent === 'SHIPPING' && turnDecision.isScopeExpansion) {
          // A domestic policy must not be presented as an answer for a new
          // destination. Leave availability to the team unless grounded facts
          // for that destination passed the guard above.
          answered = true;
          answerText = ConversationEngine.unconfirmedInternationalShipping(effectiveLang, effectiveScript);
          responseSource = 'SERVICE';
        }

        // Step 4: Ambiguous Greeting Check (only if still unanswered and candidate is short unknown non-question)
        if (!answered && !hasQuestion) {
          const greetingResult = await AmbiguousGreetingResolver.resolve({
            content,
            normalizedContent,
            hasLlmConfigured: Boolean(config.llm?.provider && (this.llmFactory || this.defaultLlm)),
            llm,
            tenantId,
            conversationId: conversation.id,
            correlationId,
            turnDecision,
            effectiveLang,
            effectiveScript,
            config
          });
          if (greetingResult.handled) {
            answered = true;
            answerText = greetingResult.answerText!;
            responseSource = 'GREETING';
          }
        }

        // Step 5: Grounded LLM safety-net answer if FAQ and high-confidence RAG missed (max 1 generation call, non-image only)
        if (!answered && !groundedLlmAttempted && routed.type !== 'IMAGE') {
          const hasLlmConfigured = Boolean(config.llm?.provider && (this.llmFactory || this.defaultLlm));
          if (hasLlmConfigured) {
            groundedLlmAttempted = true;
            let productContextInfo = '';
            if (config.capabilities?.ecommerceEnabled === true && conversation.accountId && this.ecommerceService) {
              const namedProductId = turnDecision.catalogProductId || turnDecision.productId;
              const targetProdId = namedProductId || turnDecision.sku || turnDecision.productName;
              if (targetProdId) {
                const prodFact = await this.ecommerceService.getProductFact(
                  tenantId,
                  conversation.accountId,
                  {
                    id: namedProductId || undefined,
                    sku: turnDecision.sku || undefined,
                    name: turnDecision.productName || undefined,
                    color: turnDecision.color || undefined,
                    size: turnDecision.size || undefined
                  },
                  effectiveLang
                );
                if (prodFact) {
                  productContextInfo = `\n\nLive Store Catalog Fact:\nProduct: ${prodFact.displayName}\nPrice: ${prodFact.effectivePrice} ${prodFact.currency}\nStock: ${prodFact.inStock ? `In stock (${prodFact.availableStock})` : 'Out of stock'}\nDescription: ${prodFact.displayDescription}`;
                }
              }
            }

            const prepared = GroundedPromptBuilder.prepareGroundedAnswer({
              config, turnDecision, ragResult, content, language: effectiveLang,
              recentTurns: conversationContext.recentTurns, productContextInfo,
              useRawMultiPolicyContext: true
            });
            groundingEvidence = prepared.groundingEvidence;
            const { systemPrompt, userPromptContent } = prepared;

            const startTime = Date.now();
            try {
              const timeoutMs = config.llm?.timeoutMs ?? 10000;
              const rawResponse = await generateResponseWithDeadline(llm, systemPrompt, [{ role: 'user', content: userPromptContent }], {
                temperature: config.llm?.temperature ?? 0.2,
                maxTokens: llmOptions.maxTokens ?? config.llm?.maxTokens ?? 300,
                timeoutMs
              });
              const latencyMs = Date.now() - startTime;
              const trimmed = (rawResponse || '').trim();

              const inputTokensEst = Math.ceil((systemPrompt.length + userPromptContent.length) / 4);
              const outputTokensEst = Math.ceil((trimmed || '').length / 4);

              if (trimmed && trimmed !== 'UNANSWERABLE' && !trimmed.startsWith('UNANSWERABLE')) {
                answered = true;
                answerText = trimmed;
                responseSource = 'LLM';
                logger.info(`ConversationEngine: Workflow-less LLM answer generated`, {
                  event: 'workflowless_llm_answered',
                  tenantId,
                  latencyMs,
                  failureReason: null,
                  inputLength: content.length
                });
                telemetry.emit({
                  eventType: 'llm_completed',
                  tenantId,
                  conversationId: conversation.id,
                  correlationId,
                  stage: 'llm',
                  status: 'SUCCESS',
                  latencyMs,
                  provider: config.llm?.provider || 'unknown',
                  model: config.llm?.model || 'unknown',
                  metadata: {
                    purpose: 'workflowless_grounded_answer',
                    inputLength: content.length,
                    inputTokens: inputTokensEst,
                    outputTokens: outputTokensEst,
                    retryAttempts: 0
                  }
                });
              } else {
                groundedLlmUnanswerable = true;
                logger.info(`ConversationEngine: Workflow-less LLM marked query UNANSWERABLE`, {
                  event: 'workflowless_llm_unanswerable',
                  tenantId,
                  latencyMs,
                  failureReason: null,
                  inputLength: content.length
                });
                telemetry.emit({
                  eventType: 'llm_completed',
                  tenantId,
                  conversationId: conversation.id,
                  correlationId,
                  stage: 'llm',
                  status: 'UNANSWERABLE',
                  latencyMs,
                  provider: config.llm?.provider || 'unknown',
                  model: config.llm?.model || 'unknown',
                  metadata: {
                    purpose: 'workflowless_grounded_answer',
                    inputLength: content.length,
                    inputTokens: inputTokensEst,
                    outputTokens: outputTokensEst,
                    retryAttempts: 0
                  }
                });
              }
            } catch (err: any) {
              const latencyMs = Date.now() - startTime;
              const failureReason = err.message === 'TIMEOUT' ? 'timeout' : (err.status === 429 ? 'rate_limit' : 'error');
              const inputTokensEst = Math.ceil((systemPrompt.length + userPromptContent.length) / 4);
              logger.warn(`ConversationEngine: Workflow-less LLM fallback failed (${failureReason})`, {
                event: 'workflowless_llm_failed',
                tenantId,
                latencyMs,
                failureReason,
                inputLength: content.length
              });
              telemetry.emit({
                eventType: 'llm_failed',
                tenantId,
                conversationId: conversation.id,
                correlationId,
                stage: 'llm',
                status: 'FAILURE',
                latencyMs,
                provider: config.llm?.provider || 'unknown',
                model: config.llm?.model || 'unknown',
                errorCode: failureReason,
                metadata: {
                  purpose: 'workflowless_grounded_answer',
                  inputLength: content.length,
                  inputTokens: inputTokensEst,
                  outputTokens: 0,
                  retryAttempts: 0
                }
              });
            }
          }
        }

        if (answered) {
          response = answerText;
        } else if (groundedLlmUnanswerable) {
          responseSource = 'FALLBACK';
          response = AnswerComposer.composeUnknownAnswer({ turnDecision, responseLanguage: effectiveLang, responseScript: effectiveScript, config });
        } else if (turnDecision.domain === 'KNOWLEDGE') {
          // Authoritative Knowledge turn with no matching RAG info / UNANSWERABLE:
          responseSource = 'FALLBACK';
          logger.info(`ConversationEngine: Authoritative Knowledge turn unanswered -> returning localized fallback (lang: ${effectiveLang}, 0 LLM calls).`);
          response = AnswerComposer.composeUnknownAnswer({
            turnDecision,
            responseLanguage: turnDecision.responseLanguage,
            responseScript: turnDecision.responseScript,
            config
          });
        } else if (routed.type === 'IMAGE' && routed.imageAnalysis) {
          responseSource = 'IMAGE';
          const analysis = routed.imageAnalysis;
          if (analysis.category) {
            response = `I identified a product in the ${analysis.category} category (${analysis.description || analysis.objects.join(', ')}). How can I assist you with this item?`;
          } else if (analysis.visibleText) {
            response = `I detected the following text in your image: "${analysis.visibleText}". How can I help you with this?`;
          } else if (analysis.description) {
            response = `I see: ${analysis.description}. How can I assist you with this?`;
          } else {
            response = "I've analyzed your image. How can I help you with it?";
          }
        } else {
          // Static fallback ONLY with detected language localization. Zero LLM calls.
          responseSource = 'FALLBACK';
          logger.info(`ConversationEngine: Workflow-less unmatched message "${content}" -> returning localized static fallback (lang: ${effectiveLang}, 0 LLM calls).`);
          response = AnswerComposer.composeUnknownAnswer({
            turnDecision,
            responseLanguage: turnDecision.responseLanguage,
            responseScript: turnDecision.responseScript,
            config
          });
        }
      }
    }

    if (responseSource === 'LLM' || responseSource === 'RAG') {
      const currentEvidence = groundingEvidence || [
        ...(ragResult?.chunks || []).map((chunk: { content?: string }) => chunk.content || ''),
        portalBusinessEvidence(config, content)
      ].join('\n');
      const claimCheck = GroundedAnswerGuard.evaluate(response, currentEvidence, {
        question: content,
        services: config.portalFacts?.services,
        businessHours: config.identity?.businessHours
      });
      if (!claimCheck.safe) {
        logger.warn('ConversationEngine: Rejected unsupported generated business claim', { reason: claimCheck.reason, tenantId, accountId: effectiveAccountId });
        responseSource = 'FALLBACK';
        response = AnswerComposer.composeUnknownAnswer({ turnDecision, responseLanguage: effectiveLang, responseScript: effectiveScript, config });
      }
    }

    // A catalog price can be answered deterministically before the store-hours
    // clause is considered. Preserve both requested facts in a single reply.
    // The clause comes from account configuration (already past the grounded
    // claim guard above) and is sized so the final limiter cannot cut it.
    if (['ECOMMERCE', 'SERVICE', 'LLM', 'RAG'].includes(responseSource) && config.identity?.businessHours
      && BusinessHoursClause.isRequested(content)
      && !BusinessHoursClause.alreadyStated(response, config.identity.businessHours)) {
      const label = effectiveScript === 'arabizi' ? 'L-wa9t: '
        : effectiveLang === 'fr' ? 'Horaires : '
        : effectiveLang === 'ar' || effectiveLang === 'darija' ? 'ساعات العمل: '
        : 'Hours: ';
      response = BusinessHoursClause.append(response, config.identity.businessHours, label, config.limits?.maxResponseLength);
    }

    // 5. Apply central final response boundary enforcing content trust, script invariants, and limits
    response = AnswerComposer.finalizeResponse(response, turnDecision, config,
      { preserveTrailingWorkflowPrompt: responseSource === 'WORKFLOW' });

    const totalTurnLatencyMs = Date.now() - turnStartTime;

    // Construct normalized TurnDecision object for the turn (Phase 26B global decision layer)
    turnDecision = TurnDecisionResolver.resolve({
      text: content,
      language: effectiveLang,
      script: effectiveScript,
      productContext: conversationContext.productContext,
      catalogCategories,
      customCategoryAliases,
      customAttributeAliases,
      shippingScope: config.capabilities?.shippingScope,
      domesticCountry: config.identity?.country,
      isEcommerceEnabled: Boolean(config.capabilities?.ecommerceEnabled),
      responseSource,
      isSafetyViolation: !safetyResult.allowed,
      isHandoff: isHandoff,
      isWorkflow: responseSource === 'WORKFLOW',
      ragChunks: ragResult?.chunks,
      matchedFaqId: responseSource === 'FAQ' ? 'faq_match' : null
    });

    if (config.capabilities?.ecommerceEnabled === true && turnDecision.secondaryIntents?.includes('BUY_INTENT')) {
      const purchaseFollowup = turnDecision.responseScript === 'arabizi'
        ? 'Bghiti tkemmel chra? 2ekked lia smit l-produit.'
        : ({ en: 'To continue with your purchase, please confirm the product.',
             fr: 'Pour continuer votre achat, confirmez le produit, s’il vous plaît.',
             ar: 'لمتابعة الشراء، يرجى تأكيد المنتج الذي تريده.',
             darija: 'باش تكمل الشراء، أكد ليا اسم المنتوج اللي بغيتي.' }[effectiveLang] || 'To continue with your purchase, please confirm the product.');
      response = AnswerComposer.finalizeResponse(`${response}\n\n${purchaseFollowup}`, turnDecision, config);
      contextDataUpdate = {
        ...(contextDataUpdate || conversation.contextData as Record<string, any> || {}),
        pendingPurchaseRequest: { text: content.slice(0, 4096), requestedAt: new Date().toISOString() }
      };
    }

    logger.debug(`ConversationEngine: Turn Decision resolved [${turnDecision.domain}:${turnDecision.intent}] (source: ${turnDecision.source}, lang: ${turnDecision.responseLanguage}, script: ${turnDecision.responseScript})`);

    // Response constructed and ready to return from ConversationEngine (Observation only; does not imply external delivery)
    telemetry.emit({
      eventType: 'response_completed',
      tenantId,
      conversationId: conversation.id,
      correlationId,
      stage: 'response',
      status: 'SUCCESS',
      latencyMs: totalTurnLatencyMs,
      metadata: {
        responseSource,
        outputLength: response.length,
        turnDecision: {
          domain: turnDecision.domain,
          intent: turnDecision.intent,
          secondaryIntents: turnDecision.secondaryIntents || [],
          source: turnDecision.source,
          productId: turnDecision.productId || null,
          variantId: turnDecision.variantId || null,
          color: turnDecision.color || null,
          size: turnDecision.size || null,
          responseLanguage: turnDecision.responseLanguage,
          responseScript: turnDecision.responseScript
        }
      }
    });

    // 6. Atomically persist entire conversation turn (optimistic version check, USER message, session update, ASSISTANT message)
    try {
      await this.conversationService.commitConversationTurn({
        tenantId,
        conversationId: conversation.id,
        expectedVersion: conversation.version,
        userMessage: routed.userDisplayContent,
        assistantMessage: response || null,
        outboundMedia: outboundMediaContext.getStore()?.media || [],
        externalMessageId: options?.externalMessageId,
        contextData: { ...(contextDataUpdate || sessionUpdatePayload?.contextData || conversation.contextData as Record<string, any> || {}), _lang: effectiveLang, _script: effectiveScript },
        sessionUpdate: sessionUpdatePayload,
        flagHumanRequested,
        incrementPostCompletionCount,
        setPostCompletionCapped
      });
    } catch (commitErr: any) {
      if (externalMessageId) {
        const existingTurnResp = await this.conversationService.findExistingTurnResponse(
          tenantId,
          externalMessageId,
          conversation.id
        );
        if (existingTurnResp !== null) {
          logger.info(`ConversationEngine: Recovered from concurrent turn insert for externalMessageId [${externalMessageId}] in conversation [${conversation.id}].`);
          return existingTurnResp;
        }
      }
      throw commitErr;
    }

    // 7. Non-blocking CRM lead signal processing (Phase CRM-B & CRM-WORKFLOW-FIX-04)
    if (this.crmService && effectiveAccountId && !customerExternalId.startsWith('portal-preview:')) {
      try {
        const isWorkflowCompleted = Boolean(sessionUpdatePayload?.status === 'COMPLETED');
        await this.crmService.processTurnSignal({
          tenantId,
          accountId: effectiveAccountId,
          customerId: conversation.customerId,
          conversationId: conversation.id,
          turnDecision,
          isWorkflowCompleted,
          workflowId: isWorkflowCompleted ? completedWorkflowId : null,
          workflowConfig: isWorkflowCompleted ? completedWorkflowConfig : null,
          terminalStateId: isWorkflowCompleted ? completedTerminalStateId : null,
          workflowIntents: isWorkflowCompleted ? completedWorkflowIntents : null,
          userMessage: routed.userDisplayContent
        });
      } catch (crmErr) {
        logger.warn('ConversationEngine: Non-blocking CRM turn processing error', { error: crmErr });
      }
    }

    // 8. Non-blocking Outcome Tracking (Relayqo Outcome Tracking MVP)
    if (this.outcomeService && effectiveAccountId && !customerExternalId.startsWith('portal-preview:')) {
      // 8a. Missed Question tracking at canonical fallback decision point
      if (responseSource === 'FALLBACK') {
        try {
          const idempotencyKey = `question_missed:${conversation.id}:${options?.externalMessageId || conversation.version}`;
          await this.outcomeService.recordEvent({
            tenantId,
            accountId: effectiveAccountId,
            type: 'QUESTION_MISSED',
            source: 'CHATBOT_SIGNAL',
            conversationId: conversation.id,
            customerId: conversation.customerId,
            idempotencyKey,
            metadata: {
              messageId: options?.externalMessageId,
              question: (routed.userDisplayContent || '').slice(0, 200),
              language: effectiveLang,
              script: effectiveScript,
              reason: 'NO_SUPPORTED_ANSWER'
            }
          });
        } catch (outcomeErr) {
          logger.warn('ConversationEngine: Non-blocking outcome tracking error (missed question)', { error: outcomeErr });
        }
      }

      // 8b. Workflow Outcome tracking (Confirmed Bookings & Orders)
      if (sessionUpdatePayload?.status === 'COMPLETED' && completedWorkflowConfig) {
        try {
          let outcomeConfig: any = null;
          if (completedTerminalStateId && completedWorkflowConfig.states?.[completedTerminalStateId]?.outcome !== undefined) {
            const termOutcome = completedWorkflowConfig.states[completedTerminalStateId].outcome;
            if (termOutcome && termOutcome.type !== 'none') {
              outcomeConfig = termOutcome;
            } else {
              outcomeConfig = null; // Explicitly suppressed by terminal state override
            }
          } else if (completedWorkflowConfig.outcome && completedWorkflowConfig.outcome.type !== 'none') {
            outcomeConfig = completedWorkflowConfig.outcome;
          }

          if (outcomeConfig?.type === 'BOOKING_CONFIRMED') {
            const idempotencyKey = `booking_confirmed:${conversation.id}:${sessionUpdatePayload.sessionId}`;
            await this.outcomeService.recordEvent({
              tenantId,
              accountId: effectiveAccountId,
              type: 'BOOKING_CONFIRMED',
              source: 'WORKFLOW',
              conversationId: conversation.id,
              customerId: conversation.customerId,
              idempotencyKey,
              metadata: {
                workflowId: completedWorkflowId,
                terminalStateId: completedTerminalStateId
              }
            });
          } else if (outcomeConfig?.type === 'ORDER_CONFIRMED') {
            let orderValue: number | null = null;
            if (outcomeConfig.valueField) {
              const rawVal = sessionUpdatePayload.contextData?.[outcomeConfig.valueField];
              if (rawVal !== undefined && rawVal !== null) {
                const parsed = typeof rawVal === 'number' ? rawVal : parseFloat(String(rawVal));
                if (!isNaN(parsed) && parsed > 0) {
                  orderValue = parsed;
                }
              }
            }

            let orderCurrency: string | null = null;
            if (outcomeConfig.currencyField) {
              const rawCurr = sessionUpdatePayload.contextData?.[outcomeConfig.currencyField];
              if (typeof rawCurr === 'string' && /^[A-Z]{3}$/i.test(rawCurr.trim())) {
                orderCurrency = rawCurr.trim().toUpperCase();
              }
            }
            if (!orderCurrency) {
              orderCurrency = config.identity?.currency || 'USD';
            }

            const idempotencyKey = `order_confirmed:${conversation.id}:${sessionUpdatePayload.sessionId}`;
            await this.outcomeService.recordEvent({
              tenantId,
              accountId: effectiveAccountId,
              type: 'ORDER_CONFIRMED',
              source: 'WORKFLOW',
              conversationId: conversation.id,
              customerId: conversation.customerId,
              value: orderValue,
              currency: orderCurrency,
              idempotencyKey,
              metadata: {
                workflowId: completedWorkflowId,
                terminalStateId: completedTerminalStateId,
                valueField: outcomeConfig.valueField,
                currencyField: outcomeConfig.currencyField
              }
            });
          }
        } catch (outcomeErr) {
          logger.warn('ConversationEngine: Non-blocking outcome tracking error (workflow outcome)', { error: outcomeErr });
        }
      }
    }
    
    return response;
  }

  /**
   * Additive image message handler.
   * Delegates cleanly to unified handleMessage via CapabilityRouter.
   * Gemini's raw prose text NEVER crosses the boundary into customer response.
   */
  async handleImageMessage(
    tenantId: string,
    customerExternalId: string,
    imageInput: {
      imageBase64?: string | null;
      imageUrl?: string | null;
      mimeType?: string | null;
      textPrompt?: string;
      precomputedImageAnalysis?: any;
    },
    accountId?: string | null
  ): Promise<string> {
    return this.handleMessage(
      tenantId,
      customerExternalId,
      {
        imageBase64: imageInput.imageBase64,
        imageUrl: imageInput.imageUrl,
        mimeType: imageInput.mimeType,
        text: imageInput.textPrompt,
        precomputedImageAnalysis: imageInput.precomputedImageAnalysis
      },
      accountId
    );
  }

  async getConversationContext(
    tenantId: string,
    conversationId: string,
    language?: string
  ): Promise<ConversationContext | null> {
    return this.conversationService.getConversationContext(tenantId, conversationId, language);
  }

  resolveTurnDecision(
    content: string,
    productContext?: any,
    language?: string
  ): TurnDecision {
    return TurnDecisionResolver.resolve({
      text: content,
      productContext,
      language
    });
  }

  private async checkWorkflowExecutionLimit(
    tenantId: string,
    customerId: string,
    workflowId: string,
    workflowConfig: WorkflowConfig,
    accountId?: string | null,
    effectiveLang: string = 'en'
  ): Promise<{ allowed: boolean; limitMessage?: string }> {
    const limitConfig = workflowConfig.executionLimit;
    if (!limitConfig || limitConfig.mode === 'unlimited') {
      return { allowed: true };
    }

    let maxExecutions = Infinity;
    if (limitConfig.mode === 'once') {
      maxExecutions = 1;
    } else if (limitConfig.mode === 'custom') {
      const parsed = Number(limitConfig.maxExecutions);
      if (!Number.isNaN(parsed) && parsed >= 1) {
        maxExecutions = Math.floor(parsed);
      } else {
        // Fall back safely to unlimited if invalid custom value
        return { allowed: true };
      }
    } else {
      return { allowed: true };
    }

    const completedCount = await this.conversationService.countCompletedWorkflowSessions(
      tenantId,
      customerId,
      workflowId,
      accountId
    );

    if (completedCount >= maxExecutions) {
      const defaultMsg = DEFAULT_EXECUTION_LIMIT_MESSAGES[effectiveLang as keyof typeof DEFAULT_EXECUTION_LIMIT_MESSAGES] || DEFAULT_EXECUTION_LIMIT_MESSAGES.en;
      const limitReachedMessage = limitConfig.limitReachedMessage
        ? resolveLocalizedPrompt(limitConfig.limitReachedMessage, effectiveLang, defaultMsg)
        : defaultMsg;

      return { allowed: false, limitMessage: limitReachedMessage };
    }

    return { allowed: true };
  }
}
