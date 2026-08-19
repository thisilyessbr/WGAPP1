import { ConversationService } from './ConversationService';
import { TenantConfigService } from '../tenant/TenantConfigService';
import { WorkflowEngine } from '../../core/engine/WorkflowEngine';
import { LLMProvider, LLMProviderError, LLMRequestOptions } from '../../core/llm/LLMProvider';
import { LLMFactory } from '../../core/llm/LLMFactory';
import { ResponseBuilder } from './ResponseBuilder';
import { RAGService } from '../rag/RAGService';
import { FaqMatcher, LanguageDetector } from '../faq/FaqMatcher';
import { resolveLocalizedPrompt } from '../tenant/BusinessConfig';
import { GreetingRouter } from './GreetingRouter';
import { ImageCapabilityGateway } from '../../core/gateway/ImageCapabilityGateway';
import { CapabilityRouter, IncomingMessagePayload } from './CapabilityRouter';
import { logger } from '../../utils/logger';
import { telemetry, TelemetryClient } from '../../core/telemetry/TelemetryClient';

export class ConversationEngine {
  private llmFactory?: LLMFactory;
  private defaultLlm?: LLMProvider;
  private imageGateway: ImageCapabilityGateway;
  private capabilityRouter: CapabilityRouter;

  constructor(
    private conversationService: ConversationService,
    private configService: TenantConfigService,
    private workflowEngine: WorkflowEngine,
    llmOrFactory: LLMProvider | LLMFactory,
    private responseBuilder: ResponseBuilder,
    private ragService?: RAGService,
    imageGateway?: ImageCapabilityGateway,
    capabilityRouter?: CapabilityRouter
  ) {
    if (llmOrFactory instanceof LLMFactory) {
      this.llmFactory = llmOrFactory;
    } else {
      this.defaultLlm = llmOrFactory;
    }
    this.imageGateway = imageGateway || new ImageCapabilityGateway();
    this.capabilityRouter = capabilityRouter || new CapabilityRouter(this.imageGateway);
  }

  async handleMessage(
    tenantId: string,
    customerExternalId: string,
    contentInput: string | IncomingMessagePayload
  ): Promise<string> {
    const turnStartTime = Date.now();
    const correlationId = TelemetryClient.createCorrelationId();
    let responseSource: 'FAQ' | 'RAG' | 'LLM' | 'WORKFLOW' | 'IMAGE' | 'FALLBACK' | 'GREETING' | 'CAP' = 'FALLBACK';

    // 0. Capability Routing & Multi-modal payload resolution
    const payload: IncomingMessagePayload = typeof contentInput === 'string' ? { text: contentInput } : contentInput;

    telemetry.emit({
      eventType: 'message_received',
      tenantId,
      correlationId,
      stage: 'entry',
      status: 'SUCCESS',
      metadata: {
        inputLength: (payload.text || '').length,
        isImage: Boolean(payload.imageBase64 || payload.imageUrl)
      }
    });

    // 1. Load generic configuration
    const config = await this.configService.getConfig(tenantId);

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

    // 2. Load conversation session securely via tenant mapping
    const conversation = await this.conversationService.getOrCreateConversation(tenantId, customerExternalId);

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

    // Exact rule §9: message #1..#50 processed normally; message #51 is rejected with cap message
    if (conversation.messageCount >= 50) {
      await this.conversationService.setAutomationCapped(tenantId, conversation.id, true);
      const capMsg = config.prompts.limitExceeded || 'Conversation has reached the maximum allowed length. Please start a new conversation.';
      await this.conversationService.persistMessage(tenantId, conversation.id, 'ASSISTANT', capMsg);
      logger.info(`ConversationEngine: Conversation [${conversation.id}] reached 50-message cap -> automationCapped set to true.`);
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

    // Concurrency Lock & Message Count Increment (Atomic)
    const lockAcquired = await this.conversationService.acquireLockAndIncrementMessage(tenantId, conversation.id, conversation.version);
    if (!lockAcquired) {
      throw new Error('Concurrency Conflict: Conversation is currently being processed by another request.');
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
      const fallback = routed.fallbackMessage || "I can't process images right now — could you describe what you're looking for?";
      await this.conversationService.persistMessage(tenantId, conversation.id, 'USER', routed.userDisplayContent);
      await this.conversationService.persistMessage(tenantId, conversation.id, 'ASSISTANT', fallback);
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

    // 3. Save incoming message
    await this.conversationService.persistMessage(tenantId, conversation.id, 'USER', routed.userDisplayContent);

    // 4. Retrieve active workflow session
    const activeSession = await this.conversationService.getActiveSession(tenantId, conversation.id);

    let response = '';
    const content = routed.effectiveContent;
    const normalizedInput = (payload.text || content).trim().toLowerCase();

    // Universal Human Handoff Keyword Flagging (applies across workflow, post-completion, and workflow-less modes)
    const humanKeywords = ['talk to a human', 'human', 'agent', 'speak to agent', 'representative', 'customer service', 'support human', 'real person', 'talk to someone'];
    if (humanKeywords.includes(normalizedInput) || (config.behavior?.allowHumanHandoff && normalizedInput === 'human')) {
      logger.info(`ConversationEngine: 'talk to a human' flagged on conversation [${conversation.id}]. Continuing silently.`);
      await this.conversationService.flagHumanRequested(tenantId, conversation.id);
      conversation.humanRequested = true;
    }

    const hasWorkflowsConfigured = Boolean(config.workflows && Object.keys(config.workflows).length > 0);

    if (activeSession) {
      // P0 §5: "cancel" command (Deterministic keyword match, no LLM)
      const cancelKeywords = ['cancel', 'stop', 'quit', 'annuler'];
      if (cancelKeywords.includes(normalizedInput)) {
        logger.info(`ConversationEngine: Mid-workflow 'cancel' command triggered in session [${activeSession.id}]`);
        await this.conversationService.updateSessionState(tenantId, activeSession.id, activeSession.stateId, activeSession.contextData as any, 'CANCELLED');
        const cancelMsg = config.prompts.workflowCancelled || 'Workflow cancelled.';
        await this.conversationService.persistMessage(tenantId, conversation.id, 'ASSISTANT', cancelMsg);
        telemetry.emit({
          eventType: 'response_completed',
          tenantId,
          conversationId: conversation.id,
          correlationId,
          stage: 'response',
          status: 'SUCCESS',
          latencyMs: Date.now() - turnStartTime,
          metadata: {
            responseSource: 'WORKFLOW',
            outputLength: cancelMsg.length
          }
        });
        return cancelMsg;
      }

      // Continue existing workflow
      responseSource = 'WORKFLOW';
      const workflowConfig = config.workflows[activeSession.workflowId];
      if (!workflowConfig) {
        response = config.prompts.workflowUnavailable || 'This workflow is no longer available.';
        await this.conversationService.updateSessionState(tenantId, activeSession.id, activeSession.stateId, {}, 'ERROR');
      } else {
        const result = await this.workflowEngine.process(activeSession, content, workflowConfig, config, llm, llmOptions, this.ragService, correlationId);
        
        const newStatus = result.isComplete ? 'COMPLETED' : 'ACTIVE';
        await this.conversationService.updateSessionState(
          tenantId,
          activeSession.id,
          result.nextStateId || activeSession.stateId,
          result.updatedContext,
          newStatus,
          {
            stateHistory: result.updatedStateHistory !== undefined ? result.updatedStateHistory : activeSession.stateHistory,
            collectedData: result.updatedCollectedData !== undefined ? result.updatedCollectedData : (activeSession as any).collectedData
          }
        );
        response = result.response;
      }
    } else {
      // Check if conversation has completed a workflow before (P0 §6 & §8 Post-Completion Mode)
      const previousCompletedSession = hasWorkflowsConfigured
        ? await this.conversationService.getLatestCompletedSession(tenantId, conversation.id)
        : null;

      if (previousCompletedSession) {
        // P0.1 / P0.2 §7: Post-completion mode — FAQ -> PDF/RAG -> static canned fallback. 0 LLM calls.
        logger.info(`ConversationEngine: Conversation [${conversation.id}] in post-completion mode (questions answered: ${conversation.postCompletionQuestionCount}/10)`);
        
        let answered = false;
        let answerText = '';

        // Try FAQ
        if (config.capabilities?.faq && config.capabilities.faq.length > 0) {
          const faqMatch = FaqMatcher.match(content, config.capabilities.faq);
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
        let ragResult: any = null;
        if (!answered && config.knowledge?.enabled && this.ragService) {
          const ragStartTime = Date.now();
          try {
            ragResult = await this.ragService.retrieve(tenantId, content, config);
            const ragLatencyMs = Date.now() - ragStartTime;
            const topChunk = ragResult.chunks?.[0];
            const highConfidenceThreshold = Math.max(config.knowledge.minSimilarityScore || 0.52, 0.70);
            const isDirectMatch = Boolean(topChunk && topChunk.similarity >= highConfidenceThreshold && topChunk.content);
            if (isDirectMatch) {
              answered = true;
              answerText = topChunk.content.trim();
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
                directAnswer: isDirectMatch
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
              errorCode: e.message || String(e)
            });
          }
        }

        // Try LLM safety-net answer if FAQ and high-confidence RAG missed
        if (!answered) {
          const hasLlmConfigured = Boolean(config.llm?.provider && (this.llmFactory || this.defaultLlm));
          if (hasLlmConfigured) {
            const startTime = Date.now();
            const topChunks = (ragResult?.chunks || []).slice(0, 3);
            const contextText = topChunks.length > 0
              ? topChunks.map((c: any, i: number) => `[Evidence ${i + 1} (Score: ${c.similarity})]:\n${c.content}`).join('\n\n')
              : 'No knowledge base context available.';

            const systemPrompt = `You are a helpful customer support assistant for ${config.identity?.botName || 'our service'}.
Answer the user's question accurately and politely.
IMPORTANT INSTRUCTIONS:
1. Similarity scores on evidence reflect retrieval quality, not proof of relevance — you must independently judge whether the evidence actually answers the question.
2. Answer ONLY using the supplied context chunks. Never use outside knowledge to fill gaps.
3. If the context does not contain enough information to answer confidently, respond with exactly the literal string UNANSWERABLE and nothing else.

Context:
${contextText}`;

            try {
              const timeoutMs = config.llm?.timeoutMs ?? 10000;
              const responsePromise = llm.generateResponse(systemPrompt, [{ role: 'user', content }], {
                temperature: config.llm?.temperature ?? 0.2,
                maxTokens: config.llm?.maxTokens ?? 500,
                timeoutMs
              });
              const timeoutPromise = new Promise<string>((_, reject) =>
                setTimeout(() => reject(new Error('TIMEOUT')), timeoutMs)
              );

              const rawResponse = await Promise.race([responsePromise, timeoutPromise]);
              const latencyMs = Date.now() - startTime;
              const trimmed = (rawResponse || '').trim();

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
                    inputLength: content.length
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
                    inputLength: content.length
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
          await this.conversationService.incrementPostCompletionQuestionCount(tenantId, conversation.id);

          if (currentCount >= 10) {
            // 10th answered question: send answer + closing line, then cap
            await this.conversationService.setPostCompletionCapped(tenantId, conversation.id, true);
            const closingLine = "I'll let our support team take it from here — they'll follow up with you shortly.";
            response = `${answerText}\n\n${closingLine}`;
            logger.info(`ConversationEngine: Reached 10th post-completion question -> postCompletionCapped set to true.`);
          } else {
            response = answerText;
          }
        } else {
          // Post-completion unmatched message -> static canned response
          responseSource = 'FALLBACK';
          logger.info(`ConversationEngine: Post-completion unmatched message "${content}" -> returning static canned response.`);
          response = (config.prompts as any)?.postCompletionFallback || "I can help with questions related to your request. Our support team will follow up with you shortly.";
        }
      } else if (hasWorkflowsConfigured) {
        // P0 §1 / P0.2 §2: Tenant WITH workflow -> default workflow entry path directly (no FAQ intercept before it)
        responseSource = 'WORKFLOW';
        const defaultWorkflowId = (config as any).defaultWorkflowId
          || (config.workflows['workflow_1'] ? 'workflow_1' : Object.keys(config.workflows)[0]);

        const workflowConfig = config.workflows[defaultWorkflowId];
        logger.info(`ConversationEngine: Starting default workflow [${defaultWorkflowId}] directly for fresh conversation [${conversation.id}]`);
        
        const session = await this.conversationService.createSession(tenantId, conversation.id, defaultWorkflowId, workflowConfig.initialState);
        const result = await this.workflowEngine.process(session, content, workflowConfig, config, llm, llmOptions, this.ragService, correlationId);
        
        await this.conversationService.updateSessionState(
          tenantId,
          session.id,
          result.nextStateId || session.stateId,
          result.updatedContext,
          result.isComplete ? 'COMPLETED' : 'ACTIVE',
          {
            stateHistory: result.updatedStateHistory !== undefined ? result.updatedStateHistory : session.stateHistory,
            collectedData: result.updatedCollectedData !== undefined ? result.updatedCollectedData : {}
          }
        );
        response = result.response;
      } else {
        // Workflow-less tenant routing: Question? -> Known Greeting? -> UNKNOWN? -> FAQ/RAG -> Grounded LLM -> Fallback
        logger.info(`ConversationEngine: Handling message for workflow-less tenant [${tenantId}]`);
        let answered = false;
        let answerText = '';
        let llmCallAttempted = false;

        const normalizedContent = GreetingRouter.normalize(content);
        const hasQuestion = GreetingRouter.hasQuestionIndicator(content, normalizedContent);
        const detectedLang = LanguageDetector.detect(content);

        // Step 1: Question check runs BEFORE greeting check
        if (!hasQuestion) {
          if (GreetingRouter.isKnownGreeting(normalizedContent)) {
            // Known greeting alias -> return localized configured greeting directly (0 LLM calls)
            logger.info(`ConversationEngine: Deterministic greeting match for "${content}" (lang: ${detectedLang}, 0 LLM calls)`);
            answered = true;
            answerText = resolveLocalizedPrompt(config.prompts?.greeting, detectedLang, 'Hello! How can I help you today?');
            responseSource = 'GREETING';
          } else if (GreetingRouter.isUnknownCandidate(content, normalizedContent)) {
            // UNKNOWN candidate -> check if tenant has LLM configured before attempting classifier
            const hasLlmConfigured = Boolean(config.llm?.provider && (this.llmFactory || this.defaultLlm));
            if (hasLlmConfigured) {
              llmCallAttempted = true;
              const classifierStart = Date.now();
              const classification = await GreetingRouter.classifyGreetingWithLlm(llm, tenantId, content);
              const classifierLatencyMs = Date.now() - classifierStart;
              if (classification === 'GREETING') {
                answered = true;
                answerText = resolveLocalizedPrompt(config.prompts?.greeting, detectedLang, 'Hello! How can I help you today?');
                responseSource = 'GREETING';
              }
              telemetry.emit({
                eventType: 'llm_completed',
                tenantId,
                conversationId: conversation.id,
                correlationId,
                stage: 'llm',
                status: 'SUCCESS',
                latencyMs: classifierLatencyMs,
                provider: config.llm?.provider || 'unknown',
                model: config.llm?.model || 'unknown',
                metadata: {
                  purpose: 'greeting_classifier',
                  classification
                }
              });
            }
          }
        }

        // Step 2: FAQ Check (if not already answered as greeting)
        if (!answered && config.capabilities?.faq && config.capabilities.faq.length > 0) {
          const faqMatch = FaqMatcher.match(content, config.capabilities.faq, detectedLang);
          if (faqMatch && faqMatch.answer && (!faqMatch.confidence || faqMatch.confidence >= 0.75)) {
            answered = true;
            answerText = faqMatch.answer;
            responseSource = 'FAQ';
            logger.info(`ConversationEngine: Workflow-less FAQ match [${faqMatch.entry.id}]`);
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

        // Step 3: PDF/RAG check (if FAQ missed and knowledge enabled)
        let ragResult: any = null;
        if (!answered && config.knowledge?.enabled && this.ragService) {
          const ragStartTime = Date.now();
          try {
            logger.info(`ConversationEngine: Workflow-less calling RAGService.retrieve for query "${content}"`);
            ragResult = await this.ragService.retrieve(tenantId, content, config);
            const ragLatencyMs = Date.now() - ragStartTime;
            const topChunk = ragResult.chunks?.[0];
            const highConfidenceThreshold = Math.max(config.knowledge.minSimilarityScore || 0.52, 0.70);
            const isDirectMatch = Boolean(topChunk && topChunk.similarity >= highConfidenceThreshold && topChunk.content);
            if (isDirectMatch) {
              answered = true;
              answerText = topChunk.content.trim();
              responseSource = 'RAG';
              logger.info(`ConversationEngine: Workflow-less RAG match (score: ${topChunk.similarity})`);
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
                directAnswer: isDirectMatch
              }
            });
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
              errorCode: e.message || String(e)
            });
          }
        }

        // Step 4: Grounded LLM safety-net answer if FAQ and high-confidence RAG missed (max 1 LLM call per request, non-image only)
        if (!answered && !llmCallAttempted && routed.type !== 'IMAGE') {
          const hasLlmConfigured = Boolean(config.llm?.provider && (this.llmFactory || this.defaultLlm));
          if (hasLlmConfigured) {
            llmCallAttempted = true;
            const startTime = Date.now();
            const topChunks = (ragResult?.chunks || []).slice(0, 3);
            const contextText = topChunks.length > 0
              ? topChunks.map((c: any, i: number) => `[Evidence ${i + 1} (Score: ${c.similarity})]:\n${c.content}`).join('\n\n')
              : 'No knowledge base context available.';

            const systemPrompt = `You are a helpful customer support assistant for ${config.identity?.botName || 'our service'}.
Answer the user's question accurately and politely.
IMPORTANT INSTRUCTIONS:
1. Similarity scores on evidence reflect retrieval quality, not proof of relevance — you must independently judge whether the evidence actually answers the question.
2. Answer ONLY using the supplied context chunks. Never use outside knowledge to fill gaps.
3. If the context does not contain enough information to answer confidently, respond with exactly the literal string UNANSWERABLE and nothing else.

Context:
${contextText}`;

            try {
              const timeoutMs = config.llm?.timeoutMs ?? 10000;
              const responsePromise = llm.generateResponse(systemPrompt, [{ role: 'user', content }], {
                temperature: config.llm?.temperature ?? 0.2,
                maxTokens: config.llm?.maxTokens ?? 500,
                timeoutMs
              });
              const timeoutPromise = new Promise<string>((_, reject) =>
                setTimeout(() => reject(new Error('TIMEOUT')), timeoutMs)
              );

              const rawResponse = await Promise.race([responsePromise, timeoutPromise]);
              const latencyMs = Date.now() - startTime;
              const trimmed = (rawResponse || '').trim();

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
                    inputLength: content.length
                  }
                });
              } else {
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
                    inputLength: content.length
                  }
                });
              }
            } catch (err: any) {
              const latencyMs = Date.now() - startTime;
              const failureReason = err.message === 'TIMEOUT' ? 'timeout' : (err.status === 429 ? 'rate_limit' : 'error');
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
                  inputLength: content.length
                }
              });
            }
          }
        }

        if (answered) {
          response = answerText;
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
          logger.info(`ConversationEngine: Workflow-less unmatched message "${content}" -> returning localized static fallback (lang: ${detectedLang}, 0 LLM calls).`);
          response = resolveLocalizedPrompt(config.prompts?.fallback, detectedLang, "I did not understand that. Could you rephrase?");
        }
      }
    }

    const totalTurnLatencyMs = Date.now() - turnStartTime;
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
        outputLength: response.length
      }
    });

    // 6. Persist response
    if (response) {
      await this.conversationService.persistMessage(tenantId, conversation.id, 'ASSISTANT', response);
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
    }
  ): Promise<string> {
    return this.handleMessage(tenantId, customerExternalId, {
      imageBase64: imageInput.imageBase64,
      imageUrl: imageInput.imageUrl,
      mimeType: imageInput.mimeType,
      text: imageInput.textPrompt
    });
  }
}
