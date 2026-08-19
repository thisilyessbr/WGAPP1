import { AdminTraceEvent } from './AdminQueryService';

export type DiagnosticOutcome = 'ANSWERED' | 'FAILED' | 'INCONCLUSIVE';

export type DiagnosticSubsystem =
  | 'FAQ'
  | 'RAG'
  | 'LLM'
  | 'WORKFLOW'
  | 'IMAGE'
  | 'GREETING';

export interface DiagnosticFailureItem {
  subsystem: DiagnosticSubsystem;
  reason: string;
  stage: string;
  timestamp: string;
}

export interface TraceDiagnosis {
  correlationId: string;
  outcome: DiagnosticOutcome;
  primaryResolution?: DiagnosticSubsystem;
  primaryFailure?: DiagnosticSubsystem;
  primaryReason?: string;
  secondaryFailures?: DiagnosticFailureItem[];
  finalResponseSource?: string;
  summaryExplanation?: string;
}

export class TraceDiagnosisService {
  /**
   * Deterministically classifies a chronological sequence of telemetry events for a single turn.
   */
  diagnoseTrace(correlationId: string, events: AdminTraceEvent[]): TraceDiagnosis {
    if (!events || events.length === 0) {
      return {
        correlationId,
        outcome: 'INCONCLUSIVE',
        primaryReason: 'INSUFFICIENT_TELEMETRY',
        summaryExplanation: 'Trace incomplete — insufficient telemetry to determine the exact outcome.'
      };
    }

    // Ensure chronological order
    const sorted = [...events].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    // Extract key milestone events
    const responseCompleted = sorted.find(e => e.eventType === 'response_completed');
    const finalResponseSource = (responseCompleted?.metadata?.responseSource as string) || undefined;

    // Collect all explicit FAILURE events
    const failureEvents = sorted.filter(e => e.status === 'FAILURE');

    // Check for explicit LLM UNANSWERABLE
    const unanswerableLlmEvent = sorted.find(e => e.eventType === 'llm_completed' && e.status === 'UNANSWERABLE');

    // ------------------------------------------------------------------------
    // Rule Priority 1: Explicit FAILURE event(s)
    // ------------------------------------------------------------------------
    if (failureEvents.length > 0) {
      const firstFailure = failureEvents[0];
      const primarySubsystem = this.mapStageToSubsystem(firstFailure.stage, firstFailure.eventType);
      const primaryReason = firstFailure.errorCode || (firstFailure.metadata?.error as string) || 'UNKNOWN_ERROR';

      const secondaryFailures: DiagnosticFailureItem[] = failureEvents.slice(1).map(f => ({
        subsystem: this.mapStageToSubsystem(f.stage, f.eventType),
        reason: f.errorCode || (f.metadata?.error as string) || 'UNKNOWN_ERROR',
        stage: f.stage,
        timestamp: f.timestamp
      }));

      // Include UNANSWERABLE as secondary signal if present after an explicit failure
      if (unanswerableLlmEvent && !secondaryFailures.some(s => s.subsystem === 'LLM')) {
        secondaryFailures.push({
          subsystem: 'LLM',
          reason: 'UNANSWERABLE',
          stage: unanswerableLlmEvent.stage,
          timestamp: unanswerableLlmEvent.timestamp
        });
      }

      let summaryExplanation = `Failed during ${primarySubsystem} processing with error: ${primaryReason}.`;
      if (primarySubsystem === 'IMAGE') {
        summaryExplanation = `Image analysis failed with ${primaryReason}.`;
      } else if (primarySubsystem === 'WORKFLOW') {
        summaryExplanation = `Workflow processing failed at ${firstFailure.stage} state: ${primaryReason}.`;
      } else if (primarySubsystem === 'LLM') {
        summaryExplanation = `LLM request failed with ${primaryReason} and the final response used ${finalResponseSource || 'fallback'}.`;
      } else if (primarySubsystem === 'RAG') {
        summaryExplanation = `RAG retrieval failed and the request could not be resolved downstream.`;
      }

      return {
        correlationId,
        outcome: 'FAILED',
        primaryFailure: primarySubsystem,
        primaryReason,
        secondaryFailures: secondaryFailures.length > 0 ? secondaryFailures : undefined,
        finalResponseSource,
        summaryExplanation
      };
    }

    // ------------------------------------------------------------------------
    // Rule Priority 2: Explicit LLM UNANSWERABLE (with fallback response)
    // ------------------------------------------------------------------------
    if (unanswerableLlmEvent) {
      return {
        correlationId,
        outcome: 'FAILED',
        primaryFailure: 'LLM',
        primaryReason: 'UNANSWERABLE',
        finalResponseSource: finalResponseSource || 'FALLBACK',
        summaryExplanation: 'LLM could not produce a grounded answer and the final response used fallback.'
      };
    }

    // ------------------------------------------------------------------------
    // Rule Priority 3: Successful Resolution
    // ------------------------------------------------------------------------
    // Check FAQ match
    const faqMatch = sorted.find(e => e.eventType === 'faq_match' || (e.stage === 'faq' && e.status === 'SUCCESS' && e.eventType !== 'faq_miss'));
    if (faqMatch && finalResponseSource === 'FAQ') {
      return {
        correlationId,
        outcome: 'ANSWERED',
        primaryResolution: 'FAQ',
        finalResponseSource,
        summaryExplanation: 'Answered directly via high-confidence FAQ match.'
      };
    }

    // Check Direct RAG
    const ragCompleted = sorted.find(e => e.eventType === 'rag_completed');
    if (ragCompleted && ragCompleted.metadata?.directAnswer === true && finalResponseSource === 'RAG') {
      return {
        correlationId,
        outcome: 'ANSWERED',
        primaryResolution: 'RAG',
        finalResponseSource,
        summaryExplanation: 'Answered directly via high-confidence knowledge base retrieval.'
      };
    }

    // Check Grounded LLM
    const llmCompleted = sorted.find(e => e.eventType === 'llm_completed' && e.status === 'SUCCESS');
    if (llmCompleted && finalResponseSource !== 'FALLBACK') {
      const isGreeting = (llmCompleted.metadata?.purpose === 'greeting_response') || (finalResponseSource === 'GREETING');
      if (isGreeting) {
        return {
          correlationId,
          outcome: 'ANSWERED',
          primaryResolution: 'GREETING',
          finalResponseSource: finalResponseSource || 'GREETING',
          summaryExplanation: 'Answered directly as standard conversational greeting.'
        };
      }
      return {
        correlationId,
        outcome: 'ANSWERED',
        primaryResolution: 'LLM',
        finalResponseSource: finalResponseSource || 'LLM',
        summaryExplanation: 'Answered successfully through grounded LLM after no direct FAQ/RAG answer.'
      };
    }

    // Check Workflow Completion / Step
    const workflowCompleted = sorted.find(e => e.eventType === 'workflow_completed' && e.status === 'SUCCESS');
    const workflowTransition = sorted.find(e => e.eventType === 'workflow_transition' && e.status === 'SUCCESS');
    const workflowStarted = sorted.find(e => e.eventType === 'workflow_started' && e.status === 'SUCCESS');
    if ((workflowCompleted || workflowTransition || workflowStarted) && finalResponseSource === 'WORKFLOW') {
      return {
        correlationId,
        outcome: 'ANSWERED',
        primaryResolution: 'WORKFLOW',
        finalResponseSource,
        summaryExplanation: workflowCompleted
          ? 'Completed successfully through automated guided workflow.'
          : 'Processed guided workflow step successfully.'
      };
    }

    // Check Image Understanding Completion
    const imageCompleted = sorted.find(e => e.eventType === 'image_completed' && e.status === 'SUCCESS');
    if (imageCompleted && (finalResponseSource === 'IMAGE' || finalResponseSource === 'TEXT_AND_IMAGE' || !finalResponseSource || finalResponseSource !== 'FALLBACK')) {
      return {
        correlationId,
        outcome: 'ANSWERED',
        primaryResolution: 'IMAGE',
        finalResponseSource: finalResponseSource || 'IMAGE',
        summaryExplanation: 'Analyzed and answered successfully through image understanding.'
      };
    }

    // Check direct FAQ match fallback if finalResponseSource is not explicitly set
    if (faqMatch) {
      return {
        correlationId,
        outcome: 'ANSWERED',
        primaryResolution: 'FAQ',
        finalResponseSource: finalResponseSource || 'FAQ',
        summaryExplanation: 'Answered directly via high-confidence FAQ match.'
      };
    }

    // ------------------------------------------------------------------------
    // Rule Priority 4: Fallback without explicit failure evidence
    // ------------------------------------------------------------------------
    if (finalResponseSource === 'FALLBACK' || (responseCompleted && responseCompleted.metadata?.responseSource === 'FALLBACK')) {
      return {
        correlationId,
        outcome: 'INCONCLUSIVE',
        primaryReason: 'FALLBACK_WITHOUT_EXPLICIT_FAILURE',
        finalResponseSource: 'FALLBACK',
        summaryExplanation: 'Fallback was returned, but telemetry contains insufficient evidence to identify an upstream failure.'
      };
    }

    // ------------------------------------------------------------------------
    // Rule Priority 5: Incomplete / Insufficient Telemetry
    // ------------------------------------------------------------------------
    return {
      correlationId,
      outcome: 'INCONCLUSIVE',
      primaryReason: 'INSUFFICIENT_TELEMETRY',
      finalResponseSource,
      summaryExplanation: 'Trace incomplete — insufficient telemetry to determine the exact outcome.'
    };
  }

  private mapStageToSubsystem(stage: string, eventType: string): DiagnosticSubsystem {
    const s = (stage || '').toLowerCase();
    const e = (eventType || '').toLowerCase();

    if (s.includes('faq') || e.includes('faq')) return 'FAQ';
    if (s.includes('rag') || e.includes('rag')) return 'RAG';
    if (s.includes('image') || e.includes('image')) return 'IMAGE';
    if (s.includes('workflow') || e.includes('workflow')) return 'WORKFLOW';
    if (s.includes('llm') || e.includes('llm')) return 'LLM';
    if (s.includes('greeting') || e.includes('greeting')) return 'GREETING';

    return 'LLM';
  }
}
