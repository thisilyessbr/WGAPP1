import { LLMProvider } from '../../core/llm/LLMProvider';
import { BusinessConfig } from '../tenant/BusinessConfig';
import { TurnDecision } from './TurnDecision';
import { GreetingRouter } from './GreetingRouter';
import { AnswerComposer } from './AnswerComposer';
import { SupportedScript } from '../rag/DirectRagGuard';
import { SupportedLanguage } from '../faq/FaqMatcher';
import { telemetry } from '../../core/telemetry/TelemetryClient';

export interface AmbiguousGreetingParams {
  content: string;
  normalizedContent: string;
  hasLlmConfigured: boolean;
  llm: LLMProvider;
  tenantId: string;
  conversationId: string;
  correlationId: string;
  turnDecision: TurnDecision;
  effectiveLang: SupportedLanguage;
  effectiveScript: SupportedScript;
  config: BusinessConfig;
}

/**
 * Resolves whether a short, unknown-but-not-a-question candidate message is
 * actually a greeting (e.g. an unrecognized dialect/slang hello), via a single
 * fast, low-token LLM classification call. Only invoked when deterministic
 * greeting/question detection couldn't already decide.
 */
export class AmbiguousGreetingResolver {
  static async resolve(params: AmbiguousGreetingParams): Promise<{ handled: boolean; answerText?: string }> {
    const { content, normalizedContent, hasLlmConfigured, llm, tenantId, conversationId, correlationId, turnDecision, effectiveLang, effectiveScript, config } = params;

    if (!GreetingRouter.isUnknownCandidate(content, normalizedContent) || !hasLlmConfigured) {
      return { handled: false };
    }

    const classifierStart = Date.now();
    const classification = await GreetingRouter.classifyGreetingWithLlm(llm, tenantId, content);
    const classifierLatencyMs = Date.now() - classifierStart;

    let handled = false;
    let answerText: string | undefined;
    if (classification === 'GREETING') {
      handled = true;
      answerText = AnswerComposer.composeGreeting({ turnDecision, responseLanguage: effectiveLang, responseScript: effectiveScript, config });
    }

    telemetry.emit({
      eventType: 'llm_completed',
      tenantId,
      conversationId,
      correlationId,
      stage: 'llm',
      status: 'SUCCESS',
      latencyMs: classifierLatencyMs,
      provider: config.llm?.provider || 'unknown',
      model: config.llm?.model || 'unknown',
      metadata: {
        purpose: 'greeting_classifier',
        classification,
        inputTokens: Math.ceil((content.length + 150) / 4),
        outputTokens: 2,
        retryAttempts: 0
      }
    });

    return { handled, answerText };
  }
}
