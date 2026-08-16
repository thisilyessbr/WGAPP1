import { WorkflowStateConfig, BusinessConfig } from '../../domain/tenant/BusinessConfig';
import { LLMProvider, LLMRequestOptions } from '../llm/LLMProvider';

export class WorkflowStateEvaluator {
  constructor(private defaultLlm?: LLMProvider) {}

  /**
   * Evaluates the transitions of the current state and returns the target state ID.
   * Uses intent classification if a transition requires an intent.
   */
  async evaluateNextState(
    state: WorkflowStateConfig,
    message: string,
    config: BusinessConfig,
    llmOverride?: LLMProvider,
    options?: LLMRequestOptions
  ): Promise<string | null> {
    if (!state.transitions || state.transitions.length === 0) {
      return null;
    }

    const llm = llmOverride || this.defaultLlm;

    // Fast path: if there is only one transition and it has no intent, take it unconditionally
    if (state.transitions.length === 1 && !state.transitions[0].intent && !state.transitions[0].condition) {
      return state.transitions[0].target;
    }

    // Fast path: explicit default
    if (state.transitions.length === 1 && state.transitions[0].default) {
      return state.transitions[0].target;
    }

    // Collect allowed intents from transitions
    const allowedIntents = state.transitions
      .map(t => t.intent)
      .filter((i): i is string => !!i);

    let detectedIntent: string | null = null;
    
    // If we have intent-based transitions, call LLM to classify
    if (allowedIntents.length > 0 && llm) {
      try {
        const systemPrompt = config.prompts.intentClassification.replace('{{intents}}', allowedIntents.join(', '));
        detectedIntent = await llm.classifyIntent(systemPrompt, message, allowedIntents, options);
      } catch (e) {
        // Safe LLM failure: default to null intent
        detectedIntent = null;
      }
    }

    for (const transition of state.transitions) {
      if (transition.intent && transition.intent === detectedIntent) {
        return transition.target;
      }
      
      // Generic conditions (e.g. "variable_exists") could be implemented here
      if (transition.condition === 'always') {
        return transition.target;
      }
    }

    // Fallback to default transition if one exists
    const defaultTransition = state.transitions.find(t => t.default);
    return defaultTransition ? defaultTransition.target : null;
  }
}
