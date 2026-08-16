import { WorkflowSession } from '@prisma/client';
import { BusinessConfig, WorkflowConfig, WorkflowStateConfig, WorkflowChoiceOption } from '../../domain/tenant/BusinessConfig';
import { WorkflowStateEvaluator } from './WorkflowStateEvaluator';
import { LLMProvider, LLMRequestOptions } from '../llm/LLMProvider';
import { ResponseBuilder } from '../../domain/conversation/ResponseBuilder';
import { FieldValidator } from './FieldValidator';
import { FaqMatcher } from '../../domain/faq/FaqMatcher';
import { RAGService } from '../../domain/rag/RAGService';
import { logger } from '../../utils/logger';

export interface WorkflowResult {
  updatedContext: Record<string, any>;
  nextStateId: string | null;
  response: string;
  isComplete: boolean;
  updatedStateHistory?: string[];
  updatedCollectedData?: Record<string, any>;
}

export class WorkflowEngine {
  constructor(
    private evaluator: WorkflowStateEvaluator,
    private defaultLlm?: LLMProvider,
    private responseBuilder: ResponseBuilder = new ResponseBuilder(),
    private fieldValidator: FieldValidator = new FieldValidator()
  ) {}

  private matchChoiceOption(message: string, options: WorkflowChoiceOption[]): WorkflowChoiceOption | null {
    if (!options || options.length === 0) return null;
    const trimmed = message.trim();
    const lower = trimmed.toLowerCase();
    
    // 1. Number matching (1-based index)
    const num = parseInt(trimmed, 10);
    if (!isNaN(num) && num >= 1 && num <= options.length) {
      return options[num - 1];
    }

    // 2. Exact or normalized label match
    for (const opt of options) {
      const optLower = opt.label.trim().toLowerCase();
      if (lower === optLower) {
        return opt;
      }
    }

    // 3. Substring / containment match
    for (const opt of options) {
      const optLower = opt.label.trim().toLowerCase();
      if (lower.includes(optLower) || (optLower.length >= 4 && optLower.includes(lower))) {
        return opt;
      }
    }

    return null;
  }

  async process(
    session: WorkflowSession,
    message: string,
    workflowConfig: WorkflowConfig,
    businessConfig: BusinessConfig,
    llmOverride?: LLMProvider,
    llmOptions?: LLMRequestOptions,
    ragService?: RAGService
  ): Promise<WorkflowResult> {
    const currentStateId = session.stateId;
    const stateConfig = workflowConfig.states[currentStateId];

    if (!stateConfig) {
      throw new Error(`Invalid state configuration: ${currentStateId}`);
    }

    const llm = llmOverride || this.defaultLlm;
    let currentContext = { ...(session.contextData as Record<string, any>) };
    let collectedData: Record<string, any> = { ...((session as any).collectedData as Record<string, any> || {}) };
    let nextStateId: string | null = currentStateId;
    let response = '';
    let isComplete = false;
    let validationError: string | null = null;
    const history = [...(session.stateHistory || [])];

    const isInitialEntry = !currentContext['_started'];
    currentContext['_started'] = true;

    if (isInitialEntry) {
      if (stateConfig.type === 'choice') {
        response = this.responseBuilder.buildChoiceResponse(stateConfig);
        return {
          updatedContext: currentContext,
          nextStateId: currentStateId,
          response,
          isComplete: false,
          updatedStateHistory: history,
          updatedCollectedData: collectedData
        };
      } else if (stateConfig.type === 'collect') {
        response = stateConfig.prompt || (typeof stateConfig.field === 'string' ? `Please provide: ${stateConfig.field}` : this.responseBuilder.buildMissingFieldResponse(stateConfig, businessConfig));
        return {
          updatedContext: currentContext,
          nextStateId: currentStateId,
          response,
          isComplete: false,
          updatedStateHistory: history,
          updatedCollectedData: collectedData
        };
      } else if (stateConfig.type === 'confirm' || stateConfig.prompt === 'confirm') {
        response = this.responseBuilder.buildConfirmationResponse(currentContext, businessConfig, stateConfig);
        return {
          updatedContext: currentContext,
          nextStateId: currentStateId,
          response,
          isComplete: false,
          updatedStateHistory: history,
          updatedCollectedData: collectedData
        };
      } else if (stateConfig.type === 'end') {
        response = this.responseBuilder.buildGenericResponse(stateConfig, businessConfig);
        return {
          updatedContext: currentContext,
          nextStateId: null,
          response,
          isComplete: true,
          updatedStateHistory: history,
          updatedCollectedData: collectedData
        };
      }
    }

    // Handle 'back' command (P0 §3 - No LLM call)
    const lowerMsg = message.trim().toLowerCase();
    const isBack = ['back', 'previous', 'retour'].includes(lowerMsg);
    if (isBack) {
      if (history.length > 0) {
        const previousStateId = history.pop()!;
        const previousStateConfig = workflowConfig.states[previousStateId];
        if (previousStateConfig) {
          logger.info(`WorkflowEngine: 'back' command popped history to [${previousStateId}]`);
          const backPrompt = previousStateConfig.type === 'choice'
            ? this.responseBuilder.buildChoiceResponse(previousStateConfig)
            : (previousStateConfig.type === 'collect'
                ? (previousStateConfig.prompt || (typeof previousStateConfig.field === 'string' ? `Please provide: ${previousStateConfig.field}` : this.responseBuilder.buildMissingFieldResponse(previousStateConfig, businessConfig)))
                : this.responseBuilder.buildGenericResponse(previousStateConfig, businessConfig));
          return {
            updatedContext: currentContext,
            nextStateId: previousStateId,
            response: backPrompt,
            isComplete: false,
            updatedStateHistory: history,
            updatedCollectedData: collectedData
          };
        }
      }
      // No-op if empty history: re-send current prompt
      logger.info(`WorkflowEngine: 'back' command with empty history -> re-sending current prompt [${currentStateId}]`);
      const currentPrompt = stateConfig.type === 'choice'
        ? this.responseBuilder.buildChoiceResponse(stateConfig)
        : (stateConfig.type === 'collect'
            ? (stateConfig.prompt || (typeof stateConfig.field === 'string' ? `Please provide: ${stateConfig.field}` : this.responseBuilder.buildMissingFieldResponse(stateConfig, businessConfig)))
            : this.responseBuilder.buildGenericResponse(stateConfig, businessConfig));
      return {
        updatedContext: currentContext,
        nextStateId: currentStateId,
        response: currentPrompt,
        isComplete: false,
        updatedStateHistory: history,
        updatedCollectedData: collectedData
      };
    }

    // 0. Process Choice State
    if (stateConfig.type === 'choice') {
      const matchedOption = this.matchChoiceOption(message, stateConfig.options || []);

      if (matchedOption) {
        // Layer 1: Deterministic option matched! Push currentStateId to history and advance
        const newHistory = [...history, currentStateId];
        currentContext[currentStateId] = matchedOption.label;
        currentContext['_consecutiveUnmatched'] = 0; // Reset cost guard counter
        nextStateId = matchedOption.next;
        const nextStateConfig = workflowConfig.states[nextStateId];

        if (!nextStateConfig) {
          throw new Error(`Unauthorized or missing target state: ${nextStateId}`);
        }

        if (nextStateConfig.type === 'end') {
          isComplete = true;
          response = nextStateConfig.prompt || 'Thank you — a member of our team will contact you shortly.';
        } else if (nextStateConfig.type === 'choice') {
          response = this.responseBuilder.buildChoiceResponse(nextStateConfig);
        } else if (nextStateConfig.type === 'collect') {
          response = nextStateConfig.prompt || (typeof nextStateConfig.field === 'string' ? `Please provide: ${nextStateConfig.field}` : this.responseBuilder.buildMissingFieldResponse(nextStateConfig, businessConfig));
        } else if (nextStateConfig.type === 'confirm' || nextStateConfig.prompt === 'confirm') {
          response = this.responseBuilder.buildConfirmationResponse(currentContext, businessConfig, nextStateConfig);
        } else {
          response = this.responseBuilder.buildGenericResponse(nextStateConfig, businessConfig);
        }

        return {
          updatedContext: currentContext,
          nextStateId,
          response,
          isComplete,
          updatedStateHistory: newHistory,
          updatedCollectedData: collectedData
        };
      } else {
        const consecutive = currentContext['_consecutiveUnmatched'] || 0;
        let matchedAnswer: string | null = null;

        // P0 §10 Cost Guard: Only allow FAQ/RAG for first 1–2 unmatched messages
        if (consecutive < 2) {
          logger.info(`WorkflowEngine: [Cost Guard] Evaluating FAQ/RAG for unmatched message (attempt ${consecutive + 1}/2)`);
          
          // Layer 2: High-confidence FAQ match check (cheap-first in-memory, 0 LLM calls, 0 network API calls)
          if (businessConfig.capabilities?.faq && businessConfig.capabilities.faq.length > 0) {
            const faqMatch = FaqMatcher.match(message, businessConfig.capabilities.faq);
            if (faqMatch && faqMatch.answer && (!faqMatch.confidence || faqMatch.confidence >= 0.75)) {
              matchedAnswer = faqMatch.answer;
              logger.info(`WorkflowEngine: Mid-workflow FAQ match [${faqMatch.entry.id}] (${faqMatch.matchType} confidence: ${faqMatch.confidence}) in state [${currentStateId}]`);
            }
          }

          // Layer 3: High-confidence RAG context check (only if Layer 2 missed and RAG is enabled; makes embedding vector API call)
          if (!matchedAnswer && businessConfig.knowledge?.enabled && ragService) {
            try {
              logger.info(`WorkflowEngine: [Cost Guard] Calling RAGService embedding vector search for query: "${message}"`);
              const ragResult = await ragService.retrieve(session.tenantId, message, businessConfig);
              const topChunk = ragResult.chunks?.[0];
              const highConfidenceThreshold = Math.max(businessConfig.knowledge.minSimilarityScore || 0.52, 0.70);
              if (topChunk && topChunk.similarity >= highConfidenceThreshold && topChunk.content) {
                matchedAnswer = topChunk.content.trim();
                logger.info(`WorkflowEngine: Mid-workflow RAG match (score: ${topChunk.similarity}) in state [${currentStateId}]`);
              }
            } catch (err: any) {
              logger.warn(`WorkflowEngine: Mid-workflow RAG retrieval error: ${err.message || err}`);
            }
          }
        } else {
          logger.info(`WorkflowEngine: [Cost Guard] consecutiveUnmatched=${consecutive} >= 2 -> Skipping FAQ/RAG checks (0 API calls)`);
        }

        const choicePrompt = this.responseBuilder.buildChoiceResponse(stateConfig);

        if (matchedAnswer) {
          // Layer 2/3 Hit: Prepend answer, separator, and return distinct concise reprompt without repeating initial welcome greeting
          const reprompt = this.responseBuilder.buildChoiceReprompt(stateConfig);
          response = `${matchedAnswer}\n\n---\n${reprompt}`;
          return {
            updatedContext: currentContext,
            nextStateId: currentStateId,
            response,
            isComplete: false,
            updatedStateHistory: history,
            updatedCollectedData: collectedData
          };
        }

        // Layer 4: Fallback redirect message
        currentContext['_consecutiveUnmatched'] = consecutive + 1;
        const redirectLine = "Let's finish this first — please choose one of the options below:";
        response = this.responseBuilder.buildChoiceReprompt(stateConfig, redirectLine);

        return {
          updatedContext: currentContext,
          nextStateId: currentStateId,
          response,
          isComplete: false,
          updatedStateHistory: history,
          updatedCollectedData: collectedData
        };
      }
    }

    // 1. Process Collect State (Free-text intake)
    if (stateConfig.type === 'collect') {
      const fieldName = typeof stateConfig.field === 'string'
        ? stateConfig.field
        : (stateConfig.field?.name || currentStateId);

      const trimmedMsg = message.trim();
      const currentCollectPrompt = stateConfig.prompt || (typeof stateConfig.field === 'string' ? `Please provide: ${stateConfig.field}` : this.responseBuilder.buildMissingFieldResponse(stateConfig, businessConfig));

      // 1. Empty / whitespace message validation: reject, reprompt same step, don't store, don't advance
      if (!trimmedMsg) {
        return {
          updatedContext: currentContext,
          nextStateId: currentStateId,
          response: currentCollectPrompt,
          isComplete: false,
          updatedStateHistory: history,
          updatedCollectedData: collectedData
        };
      }

      // 2. Off-script FAQ / PDF / RAG check side-path
      const consecutive = currentContext['_consecutiveUnmatched'] || 0;
      let matchedAnswer: string | null = null;

      if (consecutive < 2) {
        // Layer 2: FAQ match
        if (businessConfig.capabilities?.faq && businessConfig.capabilities.faq.length > 0) {
          const faqMatch = FaqMatcher.match(message, businessConfig.capabilities.faq);
          if (faqMatch && faqMatch.answer && (!faqMatch.confidence || faqMatch.confidence >= 0.75)) {
            matchedAnswer = faqMatch.answer;
            logger.info(`WorkflowEngine: Mid-workflow FAQ match [${faqMatch.entry.id}] during collect step [${currentStateId}]`);
          }
        }

        // Layer 3: PDF / RAG match
        if (!matchedAnswer && businessConfig.knowledge?.enabled && ragService) {
          try {
            logger.info(`WorkflowEngine: Calling RAGService search during collect step for query: "${message}"`);
            const ragResult = await ragService.retrieve(session.tenantId, message, businessConfig);
            const topChunk = ragResult.chunks?.[0];
            const highConfidenceThreshold = Math.max(businessConfig.knowledge.minSimilarityScore || 0.52, 0.70);
            if (topChunk && topChunk.similarity >= highConfidenceThreshold && topChunk.content) {
              matchedAnswer = topChunk.content.trim();
              logger.info(`WorkflowEngine: Mid-workflow RAG match (score: ${topChunk.similarity}) during collect step [${currentStateId}]`);
            }
          } catch (err: any) {
            logger.warn(`WorkflowEngine: Mid-collect RAG retrieval error: ${err.message || err}`);
          }
        }
      }

      if (matchedAnswer) {
        // Answer off-script question, keep stateId and collectedData unchanged, reprompt collect step
        response = `${matchedAnswer}\n\n---\n${currentCollectPrompt}`;
        return {
          updatedContext: currentContext,
          nextStateId: currentStateId,
          response,
          isComplete: false,
          updatedStateHistory: history,
          updatedCollectedData: collectedData
        };
      }

      const isQuestionIntent = trimmedMsg.endsWith('?') || /^(what|how|why|when|where|who|is|are|can|could|do|does|will|would|tell me)\b/i.test(trimmedMsg);

      if (isQuestionIntent) {
        // Off-script question with no high-confidence FAQ/RAG match -> return clean fallback redirect, keep state and collectedData unchanged
        currentContext['_consecutiveUnmatched'] = consecutive + 1;
        const fallbackMsg = (businessConfig.prompts as any)?.collectFallback || "I can help with questions related to your request. Let's finish this first:";
        response = `${fallbackMsg}\n\n${currentCollectPrompt}`;
        return {
          updatedContext: currentContext,
          nextStateId: currentStateId,
          response,
          isComplete: false,
          updatedStateHistory: history,
          updatedCollectedData: collectedData
        };
      }

      // 3. Valid non-empty user message -> store raw text into collectedData (no LLM call)
      collectedData[fieldName] = trimmedMsg;
      currentContext[fieldName] = trimmedMsg;
      currentContext['_consecutiveUnmatched'] = 0;

      const newHistory = [...history, currentStateId];
      nextStateId = stateConfig.next || stateConfig.transitions?.[0]?.target || null;

      if (!nextStateId) {
        isComplete = true;
        response = 'Thank you — a member of our team will contact you shortly.';
      } else {
        const nextStateConfig = workflowConfig.states[nextStateId];
        if (!nextStateConfig) {
          throw new Error(`Unauthorized or missing target state: ${nextStateId}`);
        }

        if (nextStateConfig.type === 'end') {
          isComplete = true;
          response = nextStateConfig.prompt || 'Thank you — a member of our team will contact you shortly.';
        } else if (nextStateConfig.type === 'choice') {
          response = this.responseBuilder.buildChoiceResponse(nextStateConfig);
        } else if (nextStateConfig.type === 'collect') {
          response = nextStateConfig.prompt || (typeof nextStateConfig.field === 'string' ? `Please provide: ${nextStateConfig.field}` : this.responseBuilder.buildMissingFieldResponse(nextStateConfig, businessConfig));
        } else if (nextStateConfig.type === 'confirm' || nextStateConfig.prompt === 'confirm') {
          response = this.responseBuilder.buildConfirmationResponse(currentContext, businessConfig, nextStateConfig);
        } else {
          response = this.responseBuilder.buildGenericResponse(nextStateConfig, businessConfig);
        }
      }

      return {
        updatedContext: currentContext,
        nextStateId,
        response,
        isComplete,
        updatedStateHistory: newHistory,
        updatedCollectedData: collectedData
      };
    }

    // 2. Process Confirmation State (type: 'confirm' or legacy prompt: 'confirm')
    const isExplicitConfirm = stateConfig.type === 'confirm';
    const isLegacyConfirm = !stateConfig.type || (stateConfig.type === 'collect' && !stateConfig.field && stateConfig.prompt === 'confirm');

    if (isExplicitConfirm || isLegacyConfirm) {
      if (isLegacyConfirm && !isExplicitConfirm) {
        logger.warn(`[DEPRECATION] Workflow state "${currentStateId}" in workflow "${workflowConfig.id}" for tenant "${session.tenantId}" uses legacy prompt === 'confirm'. Please migrate to state type: 'confirm'.`);
      }

      const lowerMsg = message.trim().toLowerCase();
      const confirmKeywords = (stateConfig.confirmKeywords || ['yes', 'confirm']).map(k => k.trim().toLowerCase());
      const cancelKeywords = (stateConfig.cancelKeywords || ['no', 'cancel']).map(k => k.trim().toLowerCase());

      if (confirmKeywords.includes(lowerMsg)) {
        // Confirmation confirmed -> proceed to next state transition
      } else if (cancelKeywords.includes(lowerMsg)) {
        response = stateConfig.cancellationPrompt || businessConfig.prompts.workflowCancelled || 'Workflow cancelled.';
        return { updatedContext: currentContext, nextStateId: null, response, isComplete: true };
      } else {
        response = this.responseBuilder.buildConfirmationResponse(currentContext, businessConfig, stateConfig);
        return { updatedContext: currentContext, nextStateId, response, isComplete };
      }
    }

    // 3. Evaluate Next State transition
    nextStateId = await this.evaluator.evaluateNextState(stateConfig, message, businessConfig, llm, llmOptions);

    // If no next state but we just completed a step, we might hit the end
    if (!nextStateId) {
      isComplete = true;
      response = response || (typeof businessConfig.prompts.fallback === 'string' ? businessConfig.prompts.fallback : (businessConfig.prompts.fallback?.en || 'I did not understand that. Could you rephrase?'));
    } else {
      const nextStateConfig = workflowConfig.states[nextStateId];
      if (!nextStateConfig) {
         throw new Error(`Unauthorized or missing target state: ${nextStateId}`);
      }
      
      if (nextStateConfig.type === 'end') {
        isComplete = true;
        response = this.responseBuilder.buildGenericResponse(nextStateConfig, businessConfig);
      } else if (nextStateConfig.type === 'choice') {
        response = this.responseBuilder.buildChoiceResponse(nextStateConfig);
      } else if (nextStateConfig.type === 'collect' && nextStateConfig.field) {
        // Proactively ask for the next field
        if (!currentContext[nextStateConfig.field.name]) {
           response = this.responseBuilder.buildMissingFieldResponse(nextStateConfig, businessConfig);
        }
      } else if (nextStateConfig.type === 'confirm' || nextStateConfig.prompt === 'confirm') {
         response = this.responseBuilder.buildConfirmationResponse(currentContext, businessConfig, nextStateConfig);
      } else {
         response = this.responseBuilder.buildGenericResponse(nextStateConfig, businessConfig);
      }
    }

    return {
      updatedContext: currentContext,
      nextStateId,
      response,
      isComplete
    };
  }
}
