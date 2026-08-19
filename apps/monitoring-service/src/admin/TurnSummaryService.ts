import { AdminTraceEvent } from './AdminQueryService';
import { TraceDiagnosisService, TraceDiagnosis } from './TraceDiagnosisService';

export type CustomerTurnOutcome = 'ANSWERED' | 'FAILED' | 'INCONCLUSIVE';

export interface CustomerTurnSummary {
  correlationId: string;
  tenantId: string;
  conversationId?: string;

  startTime: string;
  endTime?: string;

  totalLatencyMs?: number;

  eventCount: number;

  outcome: CustomerTurnOutcome;

  primaryResolution?: string;
  primaryFailure?: string;
  primaryReason?: string;

  finalResponseSource?: string;

  stages: string[];

  summaryExplanation?: string;

  possiblyTruncated: boolean;
}

export interface TurnListResponse {
  success: boolean;
  tenantId?: string;
  conversationId?: string;
  count: number;
  turns: CustomerTurnSummary[];
}

/** Terminal milestone event types that indicate a turn is complete. */
const TERMINAL_EVENT_TYPES = new Set([
  'response_completed',
]);

/** Failure event types that are also terminal when no further processing is expected. */
const TERMINAL_FAILURE_TYPES = new Set([
  'workflow_failed',
  'image_failed',
  'llm_failed',
  'rag_failed',
]);

export class TurnSummaryService {
  constructor(private diagnosisService: TraceDiagnosisService) {}

  /**
   * Groups a bounded set of events by correlationId and produces CustomerTurnSummary entries.
   * Events at the boundary of the fetched window that lack a terminal milestone are flagged
   * as possiblyTruncated.
   *
   * This service delegates ALL diagnostic semantics to TraceDiagnosisService.
   */
  buildTurnSummaries(events: AdminTraceEvent[]): CustomerTurnSummary[] {
    if (!events || events.length === 0) return [];

    // Group events by correlationId
    const groupMap = new Map<string, AdminTraceEvent[]>();
    for (const evt of events) {
      const cid = evt.correlationId;
      if (!groupMap.has(cid)) {
        groupMap.set(cid, []);
      }
      groupMap.get(cid)!.push(evt);
    }

    // Determine boundary correlationIds: those whose events touch the
    // first or last event in the overall window (by timestamp).
    // These are candidates for truncation if they lack terminal milestones.
    const sorted = [...events].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
    const firstEvent = sorted[0];
    const lastEvent = sorted[sorted.length - 1];
    const firstCorrelationId = firstEvent.correlationId;
    const lastCorrelationId = lastEvent.correlationId;

    // Build summaries ordered by most recent turn first (DESC by startTime)
    const summaries: CustomerTurnSummary[] = [];

    for (const [correlationId, turnEvents] of groupMap) {
      const turnSorted = [...turnEvents].sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );

      const startTime = turnSorted[0].timestamp;
      const endTime = turnSorted.length > 1 ? turnSorted[turnSorted.length - 1].timestamp : undefined;
      const eventCount = turnSorted.length;

      // Calculate total latency
      let totalLatencyMs: number | undefined;
      if (endTime) {
        totalLatencyMs = Math.max(0, new Date(endTime).getTime() - new Date(startTime).getTime());
      }

      // Collect unique ordered stages
      const stagesSeen = new Set<string>();
      const stages: string[] = [];
      for (const evt of turnSorted) {
        const s = evt.stage.toUpperCase();
        if (!stagesSeen.has(s)) {
          stagesSeen.add(s);
          stages.push(s);
        }
      }

      // Determine if this turn has a terminal milestone
      const hasTerminalMilestone = turnSorted.some(
        e => TERMINAL_EVENT_TYPES.has(e.eventType) ||
             (e.status === 'FAILURE' && TERMINAL_FAILURE_TYPES.has(e.eventType))
      );

      // A turn is possiblyTruncated if:
      // 1. It touches the boundary of the fetched window, AND
      // 2. It lacks a terminal milestone.
      const touchesBoundary =
        correlationId === firstCorrelationId ||
        correlationId === lastCorrelationId;
      const possiblyTruncated = touchesBoundary && !hasTerminalMilestone;

      // Build the summary
      const tenantId = turnSorted[0].tenantId;
      const conversationId = turnSorted[0].conversationId;

      let outcome: CustomerTurnOutcome;
      let primaryResolution: string | undefined;
      let primaryFailure: string | undefined;
      let primaryReason: string | undefined;
      let finalResponseSource: string | undefined;
      let summaryExplanation: string | undefined;

      if (possiblyTruncated) {
        // Do NOT run definitive diagnosis on a potentially incomplete event set
        outcome = 'INCONCLUSIVE';
        primaryReason = 'POSSIBLY_TRUNCATED';
        summaryExplanation = `Turn may be incomplete — observed ${eventCount} event(s) within the bounded query window. Open the full trace for a definitive diagnosis.`;
      } else {
        // Delegate to TraceDiagnosisService for complete turns
        const diagnosis = this.diagnosisService.diagnoseTrace(correlationId, turnSorted);
        outcome = diagnosis.outcome;
        primaryResolution = diagnosis.primaryResolution;
        primaryFailure = diagnosis.primaryFailure;
        primaryReason = diagnosis.primaryReason;
        finalResponseSource = diagnosis.finalResponseSource;
        summaryExplanation = diagnosis.summaryExplanation;
      }

      summaries.push({
        correlationId,
        tenantId,
        conversationId,
        startTime,
        endTime,
        totalLatencyMs,
        eventCount,
        outcome,
        primaryResolution,
        primaryFailure,
        primaryReason,
        finalResponseSource,
        stages,
        summaryExplanation,
        possiblyTruncated,
      });
    }

    // Sort by startTime DESC (newest first)
    summaries.sort(
      (a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
    );

    return summaries;
  }

  /**
   * Apply client-side filters on turn summaries.
   * Filters operate at the turn level, not the event level.
   */
  filterTurns(
    turns: CustomerTurnSummary[],
    filters: {
      outcome?: string;
      stage?: string;
      primaryFailure?: string;
      responseSource?: string;
    }
  ): CustomerTurnSummary[] {
    let result = turns;

    if (filters.outcome) {
      const v = filters.outcome.toUpperCase();
      result = result.filter(t => t.outcome === v);
    }

    if (filters.stage) {
      const v = filters.stage.toUpperCase();
      result = result.filter(t => t.stages.includes(v));
    }

    if (filters.primaryFailure) {
      const v = filters.primaryFailure.toUpperCase();
      result = result.filter(t => t.primaryFailure === v);
    }

    if (filters.responseSource) {
      const v = filters.responseSource.toUpperCase();
      result = result.filter(t => t.finalResponseSource === v);
    }

    return result;
  }
}
