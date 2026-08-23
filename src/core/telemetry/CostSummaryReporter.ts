import { TelemetryEvent } from '../../../packages/shared/contracts/telemetry.contract';

export interface TurnCostMetrics {
  correlationId: string;
  tenantId: string;
  accountId: string | null;
  domain: string | null;
  intent: string | null;
  provider: string | null;
  model: string | null;
  llmCalls: number;
  embeddingCalls: number;
  inputTokens: number;
  outputTokens: number;
  retryAttempts: number;
  totalLatencyMs: number;
}

export interface GroupUsageMetrics {
  groupKey: string;
  tenantId: string;
  accountId: string | null;
  provider: string;
  model: string;
  domain: string;
  intent: string;
  turnCount: number;
  totalLlmCalls: number;
  totalEmbeddingCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalRetryAttempts: number;
  avgLatencyMs: number;
}

export interface AggregatedUsageReport {
  totalTurns: number;
  totalLlmCalls: number;
  totalEmbeddingCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalRetryAttempts: number;
  byGroup: GroupUsageMetrics[];
}

export class CostSummaryReporter {
  /**
   * Calculates per-turn resource and token metrics for a single correlationId.
   */
  public static calculateTurnMetrics(events: TelemetryEvent[]): TurnCostMetrics {
    if (!events || events.length === 0) {
      return {
        correlationId: 'unknown',
        tenantId: 'unknown',
        accountId: null,
        domain: null,
        intent: null,
        provider: null,
        model: null,
        llmCalls: 0,
        embeddingCalls: 0,
        inputTokens: 0,
        outputTokens: 0,
        retryAttempts: 0,
        totalLatencyMs: 0
      };
    }

    const firstEvent = events[0];
    const correlationId = firstEvent.correlationId || 'unknown';
    const tenantId = firstEvent.tenantId || 'unknown';

    let accountId: string | null = null;
    let domain: string | null = null;
    let intent: string | null = null;
    let provider: string | null = null;
    let model: string | null = null;

    let llmCalls = 0;
    let embeddingCalls = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let retryAttempts = 0;
    let totalLatencyMs = 0;

    for (const e of events) {
      // Extract accountId if available
      if ((e as any).accountId) {
        accountId = (e as any).accountId;
      }

      // Extract provider and model if present
      if (e.provider) provider = e.provider;
      if (e.model) model = e.model;

      // Extract turn decision domain & intent from response_completed
      if (e.eventType === 'response_completed') {
        totalLatencyMs = e.latencyMs || totalLatencyMs;
        const meta = e.metadata as Record<string, any> | undefined;
        if (meta?.turnDecision) {
          domain = meta.turnDecision.domain || domain;
          intent = meta.turnDecision.intent || intent;
        }
      }

      // Track LLM calls and token metrics
      if (e.eventType === 'llm_completed' || e.eventType === 'llm_failed') {
        llmCalls++;
        if (e.provider) provider = e.provider;
        if (e.model) model = e.model;
        const meta = e.metadata as Record<string, any> | undefined;
        if (typeof meta?.inputTokens === 'number') {
          inputTokens += meta.inputTokens;
        }
        if (typeof meta?.outputTokens === 'number') {
          outputTokens += meta.outputTokens;
        }
        if (typeof meta?.retryAttempts === 'number') {
          retryAttempts += meta.retryAttempts;
        }
      }

      // Track embedding calls
      if (e.eventType === 'rag_completed' || e.eventType === 'rag_failed') {
        const meta = e.metadata as Record<string, any> | undefined;
        const calls = typeof meta?.embeddingCalls === 'number' ? meta.embeddingCalls : 1;
        embeddingCalls += calls;
        if (meta?.provider && !provider) provider = String(meta.provider);
        if (meta?.model && !model) model = String(meta.model);
        if (typeof meta?.retryAttempts === 'number') {
          retryAttempts += meta.retryAttempts;
        }
      }
    }

    return {
      correlationId,
      tenantId,
      accountId,
      domain,
      intent,
      provider,
      model,
      llmCalls,
      embeddingCalls,
      inputTokens,
      outputTokens,
      retryAttempts,
      totalLatencyMs
    };
  }

  /**
   * Aggregates usage metrics across turns grouped by tenantId, accountId, provider, model, domain, and intent.
   */
  public static aggregateUsage(events: TelemetryEvent[]): AggregatedUsageReport {
    if (!events || events.length === 0) {
      return {
        totalTurns: 0,
        totalLlmCalls: 0,
        totalEmbeddingCalls: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalRetryAttempts: 0,
        byGroup: []
      };
    }

    // Group events by correlationId first
    const eventsByTurn = new Map<string, TelemetryEvent[]>();
    for (const e of events) {
      const cid = e.correlationId || 'unknown';
      if (!eventsByTurn.has(cid)) {
        eventsByTurn.set(cid, []);
      }
      eventsByTurn.get(cid)!.push(e);
    }

    const turns: TurnCostMetrics[] = [];
    for (const [, turnEvents] of eventsByTurn.entries()) {
      turns.push(this.calculateTurnMetrics(turnEvents));
    }

    const groupMap = new Map<string, {
      metrics: GroupUsageMetrics;
      latencies: number[];
    }>();

    let totalLlmCalls = 0;
    let totalEmbeddingCalls = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalRetryAttempts = 0;

    for (const t of turns) {
      totalLlmCalls += t.llmCalls;
      totalEmbeddingCalls += t.embeddingCalls;
      totalInputTokens += t.inputTokens;
      totalOutputTokens += t.outputTokens;
      totalRetryAttempts += t.retryAttempts;

      const groupTenant = t.tenantId || 'unknown';
      const groupAccount = t.accountId || 'none';
      const groupProvider = t.provider || 'none';
      const groupModel = t.model || 'none';
      const groupDomain = t.domain || 'none';
      const groupIntent = t.intent || 'none';

      const key = `${groupTenant}:${groupAccount}:${groupProvider}:${groupModel}:${groupDomain}:${groupIntent}`;

      if (!groupMap.has(key)) {
        groupMap.set(key, {
          metrics: {
            groupKey: key,
            tenantId: groupTenant,
            accountId: t.accountId,
            provider: groupProvider,
            model: groupModel,
            domain: groupDomain,
            intent: groupIntent,
            turnCount: 0,
            totalLlmCalls: 0,
            totalEmbeddingCalls: 0,
            totalInputTokens: 0,
            totalOutputTokens: 0,
            totalRetryAttempts: 0,
            avgLatencyMs: 0
          },
          latencies: []
        });
      }

      const g = groupMap.get(key)!;
      g.metrics.turnCount++;
      g.metrics.totalLlmCalls += t.llmCalls;
      g.metrics.totalEmbeddingCalls += t.embeddingCalls;
      g.metrics.totalInputTokens += t.inputTokens;
      g.metrics.totalOutputTokens += t.outputTokens;
      g.metrics.totalRetryAttempts += t.retryAttempts;
      if (t.totalLatencyMs > 0) {
        g.latencies.push(t.totalLatencyMs);
      }
    }

    const byGroup: GroupUsageMetrics[] = [];
    for (const [, entry] of groupMap.entries()) {
      const avg = entry.latencies.length > 0
        ? Math.round(entry.latencies.reduce((a, b) => a + b, 0) / entry.latencies.length)
        : 0;
      entry.metrics.avgLatencyMs = avg;
      byGroup.push(entry.metrics);
    }

    return {
      totalTurns: turns.length,
      totalLlmCalls,
      totalEmbeddingCalls,
      totalInputTokens,
      totalOutputTokens,
      totalRetryAttempts,
      byGroup
    };
  }
}
