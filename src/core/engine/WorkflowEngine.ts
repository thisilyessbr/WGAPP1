import { WorkflowSession } from '@prisma/client';
import { BusinessConfig, WorkflowConfig, WorkflowStateConfig, WorkflowChoiceOption, resolveLocalizedPrompt } from '../../domain/tenant/BusinessConfig';
import { WorkflowStateEvaluator } from './WorkflowStateEvaluator';
import { LLMProvider, LLMRequestOptions } from '../llm/LLMProvider';
import { ResponseBuilder, DEFAULT_WORKFLOW_MESSAGES } from '../../domain/conversation/ResponseBuilder';
import { FieldValidator } from './FieldValidator';
import { FaqMatcher, LanguageDetector } from '../../domain/faq/FaqMatcher';
import { RAGService } from '../../domain/rag/RAGService';
import { logger } from '../../utils/logger';
import { telemetry } from '../telemetry/TelemetryClient';

export interface WorkflowResult {
  updatedContext: Record<string, any>;
  nextStateId: string | null;
  response: string;
  isComplete: boolean;
  updatedStateHistory?: string[];
  updatedCollectedData?: Record<string, any>;
}

export class WorkflowCancellationDetector {
  private static readonly DIRECT_CANCEL_TOKENS = new Set([
    // English
    'cancel',
    'stop',
    'quit',
    'exit',
    'abort',
    // French
    'annuler',
    'arreter',
    'quitter',
    // Arabic (normalized)
    'الغاء',
    'الغي',
    'وقف',
    'اوقف',
    'حبس',
    'انهاء',
    'انهي',
    'توقف',
    'بطل',
    // Moroccan Darija (Arabic script normalized)
    'سافي',
    'صافي',
    'لغيه',
    'نلغي',
    'بغيت نحبس',
    'بغيت نلغي',
    'حبس هادشي',
    'صافي حبس',
    'صافي حبسي',
    'باراكا',
    // Darija / Arabizi (Latin normalized)
    'safi',
    'nlghi',
    'bghit nlghi',
    'bghit n7bes',
    'bghit nhbes',
    'baraka',
    'hbess',
    'hbes'
  ]);

  /**
   * Normalizes input for deterministic cancellation detection.
   * Strips tashkeel, tatweel, alef variants, and surrounding punctuation.
   */
  static normalize(input: string): string {
    if (!input || typeof input !== 'string') return '';
    let text = input.trim().toLowerCase();

    // Remove Arabic diacritics / tashkeel
    text = text.replace(/[\u064B-\u065F\u0670]/g, '');

    // Remove Arabic tatweel (ـ)
    text = text.replace(/\u0640/g, '');

    // Normalize Arabic alef variants (أ, إ, آ, ٱ -> ا)
    text = text.replace(/[أإآٱ]/g, 'ا');

    // Normalize teh marbuta (ة -> ه)
    text = text.replace(/ة/g, 'ه');

    // Strip leading/trailing and repeated punctuation (including Arabic punctuation ؟ ، ؛)
    text = text.replace(/^[\s!?.,;:_\-()[\]"'/؟،؛…]+|[\s!?.,;:_\-()[\]"'/؟،؛…]+$/g, '');

    // Collapse multiple internal spaces
    text = text.replace(/\s+/g, ' ').trim();

    return text;
  }

  /**
   * Evaluates whether the user input is a direct cancellation command.
   * Excludes normal business questions (e.g. "How do I cancel my subscription?").
   */
  static isCancellation(input: string): boolean {
    const normalized = this.normalize(input);
    if (!normalized) return false;

    // Check exact normalized token/phrase
    if (this.DIRECT_CANCEL_TOKENS.has(normalized)) {
      return true;
    }

    // Check bounded direct cancellation phrases (all in normalized form)
    const directPhrases = [
      'cancel please',
      'please cancel',
      'stop please',
      'please stop',
      'safi baraka',
      'safi khoya',
      'safi khti',
      'صافي باراكا',
      'صافي شكرا',
      'الغاء الطلب',
      'الغاء العمليه',
      'الغاء العملية'
    ];
    if (directPhrases.some(p => this.normalize(p) === normalized)) {
      return true;
    }

    return false;
  }
}

export const DEFAULT_WORKFLOW_STEP_LIMIT_MESSAGES = {
  en: "This workflow has reached its maximum number of steps. Please start a new request.",
  fr: "Ce processus a atteint son nombre maximal d'étapes. Veuillez démarrer une nouvelle demande.",
  ar: "لقد وصل هذا المسار إلى الحد الأقصى من الخطوات. يرجى بدء طلب جديد.",
  darija: "هاد العملية وصلات للحد الأقصى ديال الخطوات. عافاك بدا طلب جديد."
};

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
    if (!isNaN(num) && num >= 1 && num <= options.length && String(num) === trimmed) {
      return options[num - 1];
    }

    // 2. Exact or normalized label match
    for (const opt of options) {
      const optLower = opt.label.trim().toLowerCase();
      if (lower === optLower) {
        return opt;
      }
    }

    // 3. Whole-word / token boundary containment match
    const words = lower.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
    for (const opt of options) {
      const optLower = opt.label.trim().toLowerCase();
      const optWords = optLower.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);

      if (optWords.length > 1) {
        if (` ${lower} `.includes(` ${optLower} `)) {
          return opt;
        }
      } else if (optWords.length === 1) {
        if (words.includes(optWords[0])) {
          return opt;
        }
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
    ragService?: RAGService,
    correlationId?: string
  ): Promise<WorkflowResult> {
    const startTime = Date.now();
    const currentStateId = session.stateId;
    const stateConfig = workflowConfig.states[currentStateId];

    if (!stateConfig) {
      const err = new Error(`Invalid state configuration: ${currentStateId}`);
      telemetry.emit({
        eventType: 'workflow_failed',
        tenantId: session.tenantId,
        conversationId: session.conversationId,
        correlationId: correlationId || session.conversationId || 'unknown',
        stage: 'workflow',
        status: 'FAILURE',
        latencyMs: Date.now() - startTime,
        errorCode: err.message,
        metadata: {
          workflowId: workflowConfig?.id || session.workflowId,
          stateId: currentStateId
        }
      });
      throw err;
    }

    try {
      const llm = llmOverride || this.defaultLlm;
      let currentContext = { ...(session.contextData as Record<string, any>) };
      let collectedData: Record<string, any> = { ...((session as any).collectedData as Record<string, any> || {}) };
      let nextStateId: string | null = currentStateId;
      let response = '';
      let isComplete = false;
      let validationError: string | null = null;
      const history = [...(session.stateHistory || [])];

      // Detect / resolve session language
      const detectedLang = LanguageDetector.detect(message);
      const isShortCommand = message.trim().length <= 5;
      const lang = (currentContext['_lang'] && (isShortCommand || detectedLang === 'en'))
        ? currentContext['_lang']
        : (detectedLang !== 'en' ? detectedLang : (currentContext['_lang'] || businessConfig.identity?.language || 'en'));
      currentContext['_lang'] = lang;

      const isInitialEntry = !currentContext['_started'];
      currentContext['_started'] = true;

      const finishAndReturn = (result: WorkflowResult): WorkflowResult => {
        const latencyMs = Date.now() - startTime;
        if (isInitialEntry) {
          telemetry.emit({
            eventType: 'workflow_started',
            tenantId: session.tenantId,
            conversationId: session.conversationId,
            correlationId: correlationId || session.conversationId || 'unknown',
            stage: 'workflow',
            status: 'SUCCESS',
            latencyMs,
            metadata: {
              workflowId: workflowConfig.id || session.workflowId,
              initialStateId: currentStateId,
              stateId: currentStateId
            }
          });
        } else {
          // Transition occurs when state advances or when workflow completes
          const isTransition = (result.nextStateId !== undefined && result.nextStateId !== currentStateId) || result.isComplete;
          if (isTransition) {
            telemetry.emit({
              eventType: 'workflow_transition',
              tenantId: session.tenantId,
              conversationId: session.conversationId,
              correlationId: correlationId || session.conversationId || 'unknown',
              stage: 'workflow',
              status: 'SUCCESS',
              latencyMs,
              metadata: {
                workflowId: workflowConfig.id || session.workflowId,
                previousStateId: currentStateId,
                nextStateId: result.nextStateId || currentStateId,
                isComplete: result.isComplete
              }
            });
          }
        }

        if (result.isComplete) {
          telemetry.emit({
            eventType: 'workflow_completed',
            tenantId: session.tenantId,
            conversationId: session.conversationId,
            correlationId: correlationId || session.conversationId || 'unknown',
            stage: 'workflow',
            status: 'SUCCESS',
            latencyMs,
            metadata: {
              workflowId: workflowConfig.id || session.workflowId,
              terminalStateId: result.nextStateId || currentStateId,
              isComplete: true
            }
          });
        }

        return result;
      };

      // Monotonic step limit enforcement (NEW-06)
      const rawMaxSteps = businessConfig.limits?.maxWorkflowSteps;
      const maxSteps = (typeof rawMaxSteps === 'number' && Number.isFinite(rawMaxSteps) && rawMaxSteps > 0)
        ? Math.floor(rawMaxSteps)
        : (typeof (rawMaxSteps as any) === 'string' && !isNaN(Number(rawMaxSteps)) && Number(rawMaxSteps) > 0
            ? Math.floor(Number(rawMaxSteps))
            : 10);

      const currentStepCount = (typeof currentContext['_stepCount'] === 'number') ? currentContext['_stepCount'] : 0;
      if (!isInitialEntry) {
        const nextStepCount = currentStepCount + 1;
        currentContext['_stepCount'] = nextStepCount;
        if (nextStepCount > maxSteps) {
          logger.warn(`WorkflowEngine: Session [${session.id}] exceeded maxWorkflowSteps limit (${nextStepCount} > ${maxSteps}). Terminating workflow.`);
          const defaultMsg = DEFAULT_WORKFLOW_STEP_LIMIT_MESSAGES[lang as keyof typeof DEFAULT_WORKFLOW_STEP_LIMIT_MESSAGES] || DEFAULT_WORKFLOW_STEP_LIMIT_MESSAGES.en;
          const promptToUse = (businessConfig.prompts as any)?.workflowStepLimitExceeded;
          const defaultVals = Object.values(DEFAULT_WORKFLOW_STEP_LIMIT_MESSAGES);
          const limitResponse = promptToUse && (!defaultVals.includes(promptToUse) || typeof promptToUse === 'object')
            ? resolveLocalizedPrompt(promptToUse, lang, defaultMsg)
            : defaultMsg;

          return finishAndReturn({
            updatedContext: currentContext,
            nextStateId: currentStateId,
            response: limitResponse,
            isComplete: true,
            updatedStateHistory: history,
            updatedCollectedData: collectedData
          });
        }
      } else {
        if (currentContext['_stepCount'] === undefined) {
          currentContext['_stepCount'] = 0;
        }
      }

      if (isInitialEntry) {
        if (stateConfig.type === 'choice') {
          response = this.responseBuilder.buildChoiceResponse(stateConfig, lang);
          return finishAndReturn({
            updatedContext: currentContext,
            nextStateId: currentStateId,
            response,
            isComplete: false,
            updatedStateHistory: history,
            updatedCollectedData: collectedData
          });
        } else if (stateConfig.type === 'collect') {
          response = this.responseBuilder.buildMissingFieldResponse(stateConfig, businessConfig, lang);
          return finishAndReturn({
            updatedContext: currentContext,
            nextStateId: currentStateId,
            response,
            isComplete: false,
            updatedStateHistory: history,
            updatedCollectedData: collectedData
          });
        } else if (stateConfig.type === 'confirm' || stateConfig.prompt === 'confirm') {
          response = this.responseBuilder.buildConfirmationResponse(currentContext, businessConfig, stateConfig, lang);
          return finishAndReturn({
            updatedContext: currentContext,
            nextStateId: currentStateId,
            response,
            isComplete: false,
            updatedStateHistory: history,
            updatedCollectedData: collectedData
          });
        } else if (stateConfig.type === 'end') {
          response = this.responseBuilder.buildGenericResponse(stateConfig, businessConfig, lang);
          return finishAndReturn({
            updatedContext: currentContext,
            nextStateId: null,
            response,
            isComplete: true,
            updatedStateHistory: history,
            updatedCollectedData: collectedData
          });
        }
      }

      // Handle 'back' command (P0 §3 - No LLM call)
      const lowerMsg = message.trim().toLowerCase();
      const isBack = ['back', 'previous', 'retour', 'رجوع', 'ارجع', 'rje3', 'arja3'].includes(lowerMsg);
      if (isBack) {
        if (history.length > 0) {
          const previousStateId = history.pop()!;
          const previousStateConfig = workflowConfig.states[previousStateId];
          if (previousStateConfig) {
            logger.info(`WorkflowEngine: 'back' command popped history to [${previousStateId}]`);
            const backPrompt = previousStateConfig.type === 'choice'
              ? this.responseBuilder.buildChoiceResponse(previousStateConfig, lang)
              : (previousStateConfig.type === 'collect'
                  ? this.responseBuilder.buildMissingFieldResponse(previousStateConfig, businessConfig, lang)
                  : this.responseBuilder.buildGenericResponse(previousStateConfig, businessConfig, lang));
            return finishAndReturn({
              updatedContext: currentContext,
              nextStateId: previousStateId,
              response: backPrompt,
              isComplete: false,
              updatedStateHistory: history,
              updatedCollectedData: collectedData
            });
          }
        }
        // No-op if empty history: re-send current prompt
        logger.info(`WorkflowEngine: 'back' command with empty history -> re-sending current prompt [${currentStateId}]`);
        const currentPrompt = stateConfig.type === 'choice'
          ? this.responseBuilder.buildChoiceResponse(stateConfig, lang)
          : (stateConfig.type === 'collect'
              ? this.responseBuilder.buildMissingFieldResponse(stateConfig, businessConfig, lang)
              : this.responseBuilder.buildGenericResponse(stateConfig, businessConfig, lang));
        return finishAndReturn({
          updatedContext: currentContext,
          nextStateId: currentStateId,
          response: currentPrompt,
          isComplete: false,
          updatedStateHistory: history,
          updatedCollectedData: collectedData
        });
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
            const defaultCompletion = DEFAULT_WORKFLOW_MESSAGES.completion[lang as keyof typeof DEFAULT_WORKFLOW_MESSAGES.completion] || DEFAULT_WORKFLOW_MESSAGES.completion.en;
            const defaultVals = Object.values(DEFAULT_WORKFLOW_MESSAGES.completion);
            response = nextStateConfig.prompt && (!defaultVals.includes(nextStateConfig.prompt) || typeof nextStateConfig.prompt === 'object')
              ? resolveLocalizedPrompt(nextStateConfig.prompt, lang, defaultCompletion)
              : defaultCompletion;
          } else if (nextStateConfig.type === 'choice') {
            response = this.responseBuilder.buildChoiceResponse(nextStateConfig, lang);
          } else if (nextStateConfig.type === 'collect') {
            response = this.responseBuilder.buildMissingFieldResponse(nextStateConfig, businessConfig, lang);
          } else if (nextStateConfig.type === 'confirm' || nextStateConfig.prompt === 'confirm') {
            response = this.responseBuilder.buildConfirmationResponse(currentContext, businessConfig, nextStateConfig, lang);
          } else {
            response = this.responseBuilder.buildGenericResponse(nextStateConfig, businessConfig, lang);
          }

          return finishAndReturn({
            updatedContext: currentContext,
            nextStateId,
            response,
            isComplete,
            updatedStateHistory: newHistory,
            updatedCollectedData: collectedData
          });
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

          const choicePrompt = this.responseBuilder.buildChoiceResponse(stateConfig, lang);

          if (matchedAnswer) {
            // Layer 2/3 Hit: Prepend answer, separator, and return distinct concise reprompt without repeating initial welcome greeting
            const reprompt = this.responseBuilder.buildChoiceReprompt(stateConfig, undefined, lang);
            response = `${matchedAnswer}\n\n---\n${reprompt}`;
            return finishAndReturn({
              updatedContext: currentContext,
              nextStateId: currentStateId,
              response,
              isComplete: false,
              updatedStateHistory: history,
              updatedCollectedData: collectedData
            });
          }

          // Layer 4: Fallback redirect message
          currentContext['_consecutiveUnmatched'] = consecutive + 1;
          const defaultRedirect = DEFAULT_WORKFLOW_MESSAGES.choiceRedirect[lang as keyof typeof DEFAULT_WORKFLOW_MESSAGES.choiceRedirect] || DEFAULT_WORKFLOW_MESSAGES.choiceRedirect.en;
          const defaultRedirectVals = Object.values(DEFAULT_WORKFLOW_MESSAGES.choiceRedirect);
          const rawRedirect = (businessConfig.prompts as any)?.choiceRedirect;
          const redirectLine = rawRedirect && (!defaultRedirectVals.includes(rawRedirect) || typeof rawRedirect === 'object')
            ? resolveLocalizedPrompt(rawRedirect, lang, defaultRedirect)
            : defaultRedirect;
          response = this.responseBuilder.buildChoiceReprompt(stateConfig, redirectLine, lang);

          return finishAndReturn({
            updatedContext: currentContext,
            nextStateId: currentStateId,
            response,
            isComplete: false,
            updatedStateHistory: history,
            updatedCollectedData: collectedData
          });
        }
      }

      // 1. Process Collect State (Free-text intake)
      if (stateConfig.type === 'collect') {
        const fieldName = typeof stateConfig.field === 'string'
          ? stateConfig.field
          : (stateConfig.field?.name || currentStateId);

        const trimmedMsg = message.trim();
        const currentCollectPrompt = this.responseBuilder.buildMissingFieldResponse(stateConfig, businessConfig, lang);

        // 1. Empty / whitespace message validation: reject, reprompt same step, don't store, don't advance
        if (!trimmedMsg) {
          return finishAndReturn({
            updatedContext: currentContext,
            nextStateId: currentStateId,
            response: currentCollectPrompt,
            isComplete: false,
            updatedStateHistory: history,
            updatedCollectedData: collectedData
          });
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
          return finishAndReturn({
            updatedContext: currentContext,
            nextStateId: currentStateId,
            response,
            isComplete: false,
            updatedStateHistory: history,
            updatedCollectedData: collectedData
          });
        }

        const isQuestionIntent = trimmedMsg.endsWith('?') || /^(what|how|why|when|where|who|is|are|can|could|do|does|will|would|tell me)\b/i.test(trimmedMsg);

        if (isQuestionIntent) {
          // Off-script question with no high-confidence FAQ/RAG match -> return clean fallback redirect, keep state and collectedData unchanged
          currentContext['_consecutiveUnmatched'] = consecutive + 1;
          const defaultCollectFallback = DEFAULT_WORKFLOW_MESSAGES.collectFallback[lang as keyof typeof DEFAULT_WORKFLOW_MESSAGES.collectFallback] || DEFAULT_WORKFLOW_MESSAGES.collectFallback.en;
          const defaultCollectVals = Object.values(DEFAULT_WORKFLOW_MESSAGES.collectFallback);
          const rawCollectFallback = (businessConfig.prompts as any)?.collectFallback;
          const fallbackMsg = rawCollectFallback && (!defaultCollectVals.includes(rawCollectFallback) || typeof rawCollectFallback === 'object')
            ? resolveLocalizedPrompt(rawCollectFallback, lang, defaultCollectFallback)
            : defaultCollectFallback;
          response = `${fallbackMsg}\n\n${currentCollectPrompt}`;
          return finishAndReturn({
            updatedContext: currentContext,
            nextStateId: currentStateId,
            response,
            isComplete: false,
            updatedStateHistory: history,
            updatedCollectedData: collectedData
          });
        }

        // 3. Field schema validation (if field configuration object is provided)
        if (stateConfig.field && typeof stateConfig.field === 'object') {
          const validationErr = this.fieldValidator.validate(trimmedMsg, stateConfig.field);
          if (validationErr) {
            return finishAndReturn({
              updatedContext: currentContext,
              nextStateId: currentStateId,
              response: `${validationErr}\n\n${currentCollectPrompt}`,
              isComplete: false,
              updatedStateHistory: history,
              updatedCollectedData: collectedData
            });
          }
        }

        // 4. Valid non-empty user message -> store text into collectedData (no LLM call)
        collectedData[fieldName] = trimmedMsg;
        currentContext[fieldName] = trimmedMsg;
        currentContext['_consecutiveUnmatched'] = 0;

        const newHistory = [...history, currentStateId];
        nextStateId = stateConfig.next || stateConfig.transitions?.[0]?.target || null;

        if (!nextStateId) {
          isComplete = true;
          const defaultCompletion = DEFAULT_WORKFLOW_MESSAGES.completion[lang as keyof typeof DEFAULT_WORKFLOW_MESSAGES.completion] || DEFAULT_WORKFLOW_MESSAGES.completion.en;
          response = defaultCompletion;
        } else {
          const nextStateConfig = workflowConfig.states[nextStateId];
          if (!nextStateConfig) {
            throw new Error(`Unauthorized or missing target state: ${nextStateId}`);
          }

          if (nextStateConfig.type === 'end') {
            isComplete = true;
            const defaultCompletion = DEFAULT_WORKFLOW_MESSAGES.completion[lang as keyof typeof DEFAULT_WORKFLOW_MESSAGES.completion] || DEFAULT_WORKFLOW_MESSAGES.completion.en;
            const defaultVals = Object.values(DEFAULT_WORKFLOW_MESSAGES.completion);
            response = nextStateConfig.prompt && (!defaultVals.includes(nextStateConfig.prompt) || typeof nextStateConfig.prompt === 'object')
              ? resolveLocalizedPrompt(nextStateConfig.prompt, lang, defaultCompletion)
              : defaultCompletion;
          } else if (nextStateConfig.type === 'choice') {
            response = this.responseBuilder.buildChoiceResponse(nextStateConfig, lang);
          } else if (nextStateConfig.type === 'collect') {
            response = this.responseBuilder.buildMissingFieldResponse(nextStateConfig, businessConfig, lang);
          } else if (nextStateConfig.type === 'confirm' || nextStateConfig.prompt === 'confirm') {
            response = this.responseBuilder.buildConfirmationResponse(currentContext, businessConfig, nextStateConfig, lang);
          } else {
            response = this.responseBuilder.buildGenericResponse(nextStateConfig, businessConfig, lang);
          }
        }

        return finishAndReturn({
          updatedContext: currentContext,
          nextStateId,
          response,
          isComplete,
          updatedStateHistory: newHistory,
          updatedCollectedData: collectedData
        });
      }

      // 2. Process Confirmation State (type: 'confirm' or legacy prompt: 'confirm')
      const isExplicitConfirm = stateConfig.type === 'confirm';
      const isLegacyConfirm = !stateConfig.type || ((stateConfig.type as any) === 'collect' && !stateConfig.field && stateConfig.prompt === 'confirm');

      if (isExplicitConfirm || isLegacyConfirm) {
        if (isLegacyConfirm && !isExplicitConfirm) {
          logger.warn(`[DEPRECATION] Workflow state "${currentStateId}" in workflow "${workflowConfig.id}" for tenant "${session.tenantId}" uses legacy prompt === 'confirm'. Please migrate to state type: 'confirm'.`);
        }

        const lowerMsg = message.trim().toLowerCase();
        const confirmKeywords = (stateConfig.confirmKeywords || ['yes', 'confirm', 'oui', 'نعم', 'واخا', 'iyih', 'wah', 'wakha', 'ok']).map(k => k.trim().toLowerCase());
        const cancelKeywords = (stateConfig.cancelKeywords || ['no', 'cancel', 'non', 'لا', 'la', 'lla', 'annuler', 'stop']).map(k => k.trim().toLowerCase());
        const isConfirmCancel = cancelKeywords.includes(lowerMsg) || WorkflowCancellationDetector.isCancellation(message);

        if (confirmKeywords.includes(lowerMsg)) {
          // Confirmation confirmed -> proceed to next state transition
          nextStateId = stateConfig.next || (stateConfig.transitions && stateConfig.transitions[0] ? stateConfig.transitions[0].target : null);
          if (!nextStateId) {
            isComplete = true;
            const defaultCompletion = DEFAULT_WORKFLOW_MESSAGES.completion[lang as keyof typeof DEFAULT_WORKFLOW_MESSAGES.completion] || DEFAULT_WORKFLOW_MESSAGES.completion.en;
            const defaultVals = Object.values(DEFAULT_WORKFLOW_MESSAGES.completion);
            response = stateConfig.prompt && (!defaultVals.includes(stateConfig.prompt) || typeof stateConfig.prompt === 'object')
              ? resolveLocalizedPrompt(stateConfig.prompt, lang, defaultCompletion)
              : defaultCompletion;
            return finishAndReturn({ updatedContext: currentContext, nextStateId: null, response, isComplete: true });
          }
        } else if (isConfirmCancel) {
          const defaultCancelled = DEFAULT_WORKFLOW_MESSAGES.workflowCancelled[lang as keyof typeof DEFAULT_WORKFLOW_MESSAGES.workflowCancelled] || DEFAULT_WORKFLOW_MESSAGES.workflowCancelled.en;
          const defaultVals = Object.values(DEFAULT_WORKFLOW_MESSAGES.workflowCancelled);
          const promptToUse = stateConfig.cancellationPrompt || businessConfig.prompts?.workflowCancelled;
          response = promptToUse && (!defaultVals.includes(promptToUse) || typeof promptToUse === 'object')
            ? resolveLocalizedPrompt(promptToUse, lang, defaultCancelled)
            : defaultCancelled;
          return finishAndReturn({ updatedContext: currentContext, nextStateId: null, response, isComplete: true });
        } else {
          response = this.responseBuilder.buildConfirmationResponse(currentContext, businessConfig, stateConfig, lang);
          return finishAndReturn({ updatedContext: currentContext, nextStateId, response, isComplete });
        }
      }

      // 3. Evaluate Next State transition (if not already resolved by confirmation)
      if (!nextStateId || nextStateId === currentStateId) {
        nextStateId = await this.evaluator.evaluateNextState(stateConfig, message, businessConfig, llm, llmOptions);
      }

      // If no next state but we just completed a step, we might hit the end
      if (!nextStateId) {
        isComplete = true;
        const defaultFallback = DEFAULT_WORKFLOW_MESSAGES.fallback[lang as keyof typeof DEFAULT_WORKFLOW_MESSAGES.fallback] || DEFAULT_WORKFLOW_MESSAGES.fallback.en;
        response = response || resolveLocalizedPrompt(businessConfig.prompts?.fallback, lang, defaultFallback);
      } else {
        const nextStateConfig = workflowConfig.states[nextStateId];
        if (!nextStateConfig) {
          throw new Error(`Unauthorized or missing target state: ${nextStateId}`);
        }
        
        if (nextStateConfig.type === 'end') {
          isComplete = true;
          const defaultCompletion = DEFAULT_WORKFLOW_MESSAGES.completion[lang as keyof typeof DEFAULT_WORKFLOW_MESSAGES.completion] || DEFAULT_WORKFLOW_MESSAGES.completion.en;
          const defaultVals = Object.values(DEFAULT_WORKFLOW_MESSAGES.completion);
          response = nextStateConfig.prompt && (!defaultVals.includes(nextStateConfig.prompt) || typeof nextStateConfig.prompt === 'object')
            ? resolveLocalizedPrompt(nextStateConfig.prompt, lang, defaultCompletion)
            : defaultCompletion;
        } else if (nextStateConfig.type === 'choice') {
          response = this.responseBuilder.buildChoiceResponse(nextStateConfig, lang);
        } else if (nextStateConfig.type === 'collect' && nextStateConfig.field) {
          // Proactively ask for the next field
          const fieldKey = typeof nextStateConfig.field === 'string' ? nextStateConfig.field : nextStateConfig.field.name;
          if (!currentContext[fieldKey]) {
            response = this.responseBuilder.buildMissingFieldResponse(nextStateConfig, businessConfig, lang);
          }
        } else if (nextStateConfig.type === 'confirm' || nextStateConfig.prompt === 'confirm') {
          response = this.responseBuilder.buildConfirmationResponse(currentContext, businessConfig, nextStateConfig, lang);
        } else {
          response = this.responseBuilder.buildGenericResponse(nextStateConfig, businessConfig, lang);
        }
      }

      return finishAndReturn({
        updatedContext: currentContext,
        nextStateId,
        response,
        isComplete
      });
    } catch (err: any) {
      telemetry.emit({
        eventType: 'workflow_failed',
        tenantId: session.tenantId,
        conversationId: session.conversationId,
        correlationId: correlationId || session.conversationId || 'unknown',
        stage: 'workflow',
        status: 'FAILURE',
        latencyMs: Date.now() - startTime,
        errorCode: err.message || String(err),
        metadata: {
          workflowId: workflowConfig?.id || session.workflowId,
          stateId: session.stateId
        }
      });
      throw err;
    }
  }
}
