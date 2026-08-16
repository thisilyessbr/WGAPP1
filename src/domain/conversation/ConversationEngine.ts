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
import { logger } from '../../utils/logger';

export class ConversationEngine {
  private llmFactory?: LLMFactory;
  private defaultLlm?: LLMProvider;

  constructor(
    private conversationService: ConversationService,
    private configService: TenantConfigService,
    private workflowEngine: WorkflowEngine,
    llmOrFactory: LLMProvider | LLMFactory,
    private responseBuilder: ResponseBuilder,
    private ragService?: RAGService
  ) {
    if (llmOrFactory instanceof LLMFactory) {
      this.llmFactory = llmOrFactory;
    } else {
      this.defaultLlm = llmOrFactory;
    }
  }

  async handleMessage(tenantId: string, customerExternalId: string, content: string): Promise<string> {
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
      return '';
    }

    // Exact rule §9: message #1..#50 processed normally; message #51 is rejected with cap message
    if (conversation.messageCount >= 50) {
      await this.conversationService.setAutomationCapped(tenantId, conversation.id, true);
      const capMsg = config.prompts.limitExceeded || 'Conversation has reached the maximum allowed length. Please start a new conversation.';
      await this.conversationService.persistMessage(tenantId, conversation.id, 'ASSISTANT', capMsg);
      logger.info(`ConversationEngine: Conversation [${conversation.id}] reached 50-message cap -> automationCapped set to true.`);
      return capMsg;
    }

    // Concurrency Lock & Message Count Increment (Atomic)
    const lockAcquired = await this.conversationService.acquireLockAndIncrementMessage(tenantId, conversation.id, conversation.version);
    if (!lockAcquired) {
      throw new Error('Concurrency Conflict: Conversation is currently being processed by another request.');
    }

    // 3. Save incoming message
    await this.conversationService.persistMessage(tenantId, conversation.id, 'USER', content);

    // 4. Retrieve active workflow session
    const activeSession = await this.conversationService.getActiveSession(tenantId, conversation.id);

    let response = '';
    const normalizedInput = content.trim().toLowerCase();

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
        return cancelMsg;
      }

      // Continue existing workflow
      const workflowConfig = config.workflows[activeSession.workflowId];
      if (!workflowConfig) {
        response = config.prompts.workflowUnavailable || 'This workflow is no longer available.';
        await this.conversationService.updateSessionState(tenantId, activeSession.id, activeSession.stateId, {}, 'ERROR');
      } else {
        const result = await this.workflowEngine.process(activeSession, content, workflowConfig, config, llm, llmOptions, this.ragService);
        
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
            logger.info(`ConversationEngine: Post-completion FAQ match [${faqMatch.entry.id}]`);
          }
        }

        // Try PDF/RAG if FAQ didn't match
        if (!answered && config.knowledge?.enabled && this.ragService) {
          try {
            const ragResult = await this.ragService.retrieve(tenantId, content, config);
            const topChunk = ragResult.chunks?.[0];
            const highConfidenceThreshold = Math.max(config.knowledge.minSimilarityScore || 0.52, 0.70);
            if (topChunk && topChunk.similarity >= highConfidenceThreshold && topChunk.content) {
              answered = true;
              answerText = topChunk.content.trim();
              logger.info(`ConversationEngine: Post-completion RAG match (score: ${topChunk.similarity})`);
            }
          } catch (e: any) {
            logger.warn(`ConversationEngine: Post-completion RAG retrieval failed: ${e.message || e}`);
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
          // P0.1 / P0.2: Post-completion unmatched message -> static canned response (0 LLM calls)
          logger.info(`ConversationEngine: Post-completion unmatched message "${content}" -> returning static canned response (0 LLM calls).`);
          response = (config.prompts as any)?.postCompletionFallback || "I can help with questions related to your request. Our support team will follow up with you shortly.";
        }
      } else if (hasWorkflowsConfigured) {
        // P0 §1 / P0.2 §2: Tenant WITH workflow -> default workflow entry path directly (no FAQ intercept before it)
        const defaultWorkflowId = (config as any).defaultWorkflowId
          || (config.workflows['workflow_1'] ? 'workflow_1' : Object.keys(config.workflows)[0]);

        const workflowConfig = config.workflows[defaultWorkflowId];
        logger.info(`ConversationEngine: Starting default workflow [${defaultWorkflowId}] directly for fresh conversation [${conversation.id}]`);
        
        const session = await this.conversationService.createSession(tenantId, conversation.id, defaultWorkflowId, workflowConfig.initialState);
        const result = await this.workflowEngine.process(session, content, workflowConfig, config, llm, llmOptions, this.ragService);
        
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
        // Workflow-less tenant routing: Question? -> Known Greeting? -> UNKNOWN? -> FAQ/RAG -> Fallback
        logger.info(`ConversationEngine: Handling message for workflow-less tenant [${tenantId}]`);
        let answered = false;
        let answerText = '';

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
          } else if (GreetingRouter.isUnknownCandidate(content, normalizedContent)) {
            // UNKNOWN candidate -> check if tenant has LLM configured before attempting classifier
            const hasLlmConfigured = Boolean(config.llm?.provider && (this.llmFactory || this.defaultLlm));
            if (hasLlmConfigured) {
              const classification = await GreetingRouter.classifyGreetingWithLlm(llm, tenantId, content);
              if (classification === 'GREETING') {
                answered = true;
                answerText = resolveLocalizedPrompt(config.prompts?.greeting, detectedLang, 'Hello! How can I help you today?');
              }
            }
          }
        }

        // Step 2: FAQ Check (if not already answered as greeting)
        if (!answered && config.capabilities?.faq && config.capabilities.faq.length > 0) {
          const faqMatch = FaqMatcher.match(content, config.capabilities.faq, detectedLang);
          if (faqMatch && faqMatch.answer && (!faqMatch.confidence || faqMatch.confidence >= 0.75)) {
            answered = true;
            answerText = faqMatch.answer;
            logger.info(`ConversationEngine: Workflow-less FAQ match [${faqMatch.entry.id}]`);
          }
        }

        // Step 3: PDF/RAG check (if FAQ missed and knowledge enabled)
        if (!answered && config.knowledge?.enabled && this.ragService) {
          try {
            logger.info(`ConversationEngine: Workflow-less calling RAGService.retrieve for query "${content}"`);
            const ragResult = await this.ragService.retrieve(tenantId, content, config);
            const topChunk = ragResult.chunks?.[0];
            const highConfidenceThreshold = Math.max(config.knowledge.minSimilarityScore || 0.52, 0.70);
            if (topChunk && topChunk.similarity >= highConfidenceThreshold && topChunk.content) {
              answered = true;
              answerText = topChunk.content.trim();
              logger.info(`ConversationEngine: Workflow-less RAG match (score: ${topChunk.similarity})`);
            }
          } catch (e: any) {
            logger.warn(`ConversationEngine: Workflow-less RAG retrieval failed: ${e.message || e}`);
          }
        }

        if (answered) {
          response = answerText;
        } else {
          // Static fallback ONLY with detected language localization. Zero LLM calls.
          logger.info(`ConversationEngine: Workflow-less unmatched message "${content}" -> returning localized static fallback (lang: ${detectedLang}, 0 LLM calls).`);
          response = resolveLocalizedPrompt(config.prompts?.fallback, detectedLang, "I did not understand that. Could you rephrase?");
        }
      }
    }

    // 6. Persist response
    if (response) {
      await this.conversationService.persistMessage(tenantId, conversation.id, 'ASSISTANT', response);
    }
    
    return response;
  }
}
