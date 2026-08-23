import { TelemetryEvent } from '../../../packages/shared/contracts/telemetry.contract';

export interface TurnTraceSummary {
  correlationId: string;
  tenantId: string;
  accountId?: string | null;
  conversationId?: string;
  primaryCapability?: string;
  totalLatencyMs?: number;
  stages: {
    stage: string;
    status: string;
    latencyMs?: number;
    metadata?: Record<string, unknown>;
  }[];
  isSuccess: boolean;
  errorCode?: string;
}

export class ConversationTrace {
  /**
   * Summarizes all telemetry events associated with a single correlationId.
   */
  static summarize(events: TelemetryEvent[]): TurnTraceSummary | null {
    if (!events || events.length === 0) return null;

    const first = events[0];
    const completedEvent = events.find(e => e.eventType === 'response_completed');
    const primaryCapability = (completedEvent?.metadata?.responseSource as string) || 'UNKNOWN';

    const stages = events.map(e => ({
      stage: e.stage,
      status: e.status,
      latencyMs: e.latencyMs,
      metadata: e.metadata
    }));

    const totalLatencyMs = completedEvent?.latencyMs ?? events.reduce((acc, e) => acc + (e.latencyMs || 0), 0);
    const hasFailure = events.some(e => e.status === 'FAILURE');
    const failedEvent = events.find(e => e.status === 'FAILURE');

    return {
      correlationId: first.correlationId,
      tenantId: first.tenantId,
      accountId: (first.metadata?.accountId as string) || null,
      conversationId: first.conversationId,
      primaryCapability,
      totalLatencyMs,
      stages,
      isSuccess: !hasFailure,
      errorCode: failedEvent?.errorCode
    };
  }
}
