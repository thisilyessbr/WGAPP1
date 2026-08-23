import { TelemetryEvent } from '../../../packages/shared/contracts/telemetry.contract';
import { CostSummaryReporter, TurnCostMetrics } from './CostSummaryReporter';

export interface BudgetThresholds {
  maxLlmCallsPerTurn?: number;
  maxEmbeddingCallsPerTurn?: number;
  maxRetriesPerTurn?: number;
  maxInputTokensPerTurn?: number;
  maxLatencyMsPerTurn?: number;
}

export interface BudgetAlert {
  alertType: 'HIGH_LLM_CALLS' | 'HIGH_EMBEDDING_CALLS' | 'HIGH_RETRIES' | 'HIGH_INPUT_TOKENS' | 'HIGH_LATENCY';
  severity: 'WARNING' | 'CRITICAL';
  correlationId: string;
  tenantId: string;
  accountId?: string | null;
  message: string;
  metricValue: number;
  threshold: number;
  timestamp: string;
}

export interface DimensionUsage {
  totalTurns: number;
  llmCalls: number;
  embeddingCalls: number;
  inputTokens: number;
  outputTokens: number;
  retries: number;
  avgLatencyMs: number;
}

export interface CostAnalyticsReport {
  summary: {
    totalTurns: number;
    totalLlmCalls: number;
    totalEmbeddingCalls: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalRetries: number;
    avgLatencyMs: number;
    p95LatencyMs: number;
    costEstimate: null;
  };
  byTenant: Record<string, DimensionUsage>;
  byAccount: Record<string, DimensionUsage>;
  byDomain: Record<string, DimensionUsage>;
  byIntent: Record<string, DimensionUsage>;
  byProviderModel: Record<string, DimensionUsage>;
  alerts: BudgetAlert[];
}

export const DEFAULT_BUDGET_THRESHOLDS: Required<BudgetThresholds> = {
  maxLlmCallsPerTurn: 2,
  maxEmbeddingCallsPerTurn: 1,
  maxRetriesPerTurn: 1,
  maxInputTokensPerTurn: 2500,
  maxLatencyMsPerTurn: 5000
};

export class CostAnalyticsService {
  /**
   * Generates a comprehensive cost and usage analytics report from telemetry events.
   * Never exposes private customer messages, secrets, or prompts.
   * Returns costEstimate as null (does not invent pricing).
   */
  public static generateReport(
    events: TelemetryEvent[],
    customThresholds?: BudgetThresholds
  ): CostAnalyticsReport {
    if (!events || events.length === 0) {
      return {
        summary: {
          totalTurns: 0,
          totalLlmCalls: 0,
          totalEmbeddingCalls: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalRetries: 0,
          avgLatencyMs: 0,
          p95LatencyMs: 0,
          costEstimate: null
        },
        byTenant: {},
        byAccount: {},
        byDomain: {},
        byIntent: {},
        byProviderModel: {},
        alerts: []
      };
    }

    // Group events by correlationId
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
      turns.push(CostSummaryReporter.calculateTurnMetrics(turnEvents));
    }

    const thresholds = { ...DEFAULT_BUDGET_THRESHOLDS, ...customThresholds };
    const alerts: BudgetAlert[] = [];

    const byTenant: Record<string, { metrics: DimensionUsage; latencies: number[] }> = {};
    const byAccount: Record<string, { metrics: DimensionUsage; latencies: number[] }> = {};
    const byDomain: Record<string, { metrics: DimensionUsage; latencies: number[] }> = {};
    const byIntent: Record<string, { metrics: DimensionUsage; latencies: number[] }> = {};
    const byProviderModel: Record<string, { metrics: DimensionUsage; latencies: number[] }> = {};

    let totalLlmCalls = 0;
    let totalEmbeddingCalls = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalRetries = 0;
    const allLatencies: number[] = [];

    for (const t of turns) {
      totalLlmCalls += t.llmCalls;
      totalEmbeddingCalls += t.embeddingCalls;
      totalInputTokens += t.inputTokens;
      totalOutputTokens += t.outputTokens;
      totalRetries += t.retryAttempts;
      if (t.totalLatencyMs > 0) {
        allLatencies.push(t.totalLatencyMs);
      }

      // Check budget alerts per turn
      const nowIso = new Date().toISOString();

      if (t.llmCalls > thresholds.maxLlmCallsPerTurn) {
        alerts.push({
          alertType: 'HIGH_LLM_CALLS',
          severity: 'WARNING',
          correlationId: t.correlationId,
          tenantId: t.tenantId,
          accountId: t.accountId,
          message: `Turn exceeded max LLM calls budget: ${t.llmCalls} > ${thresholds.maxLlmCallsPerTurn}`,
          metricValue: t.llmCalls,
          threshold: thresholds.maxLlmCallsPerTurn,
          timestamp: nowIso
        });
      }

      if (t.embeddingCalls > thresholds.maxEmbeddingCallsPerTurn) {
        alerts.push({
          alertType: 'HIGH_EMBEDDING_CALLS',
          severity: 'WARNING',
          correlationId: t.correlationId,
          tenantId: t.tenantId,
          accountId: t.accountId,
          message: `Turn exceeded max embedding calls budget: ${t.embeddingCalls} > ${thresholds.maxEmbeddingCallsPerTurn}`,
          metricValue: t.embeddingCalls,
          threshold: thresholds.maxEmbeddingCallsPerTurn,
          timestamp: nowIso
        });
      }

      if (t.retryAttempts > thresholds.maxRetriesPerTurn) {
        alerts.push({
          alertType: 'HIGH_RETRIES',
          severity: 'WARNING',
          correlationId: t.correlationId,
          tenantId: t.tenantId,
          accountId: t.accountId,
          message: `Turn experienced excessive provider retries: ${t.retryAttempts} > ${thresholds.maxRetriesPerTurn}`,
          metricValue: t.retryAttempts,
          threshold: thresholds.maxRetriesPerTurn,
          timestamp: nowIso
        });
      }

      if (t.inputTokens > thresholds.maxInputTokensPerTurn) {
        alerts.push({
          alertType: 'HIGH_INPUT_TOKENS',
          severity: 'WARNING',
          correlationId: t.correlationId,
          tenantId: t.tenantId,
          accountId: t.accountId,
          message: `Turn exceeded max input tokens budget: ${t.inputTokens} > ${thresholds.maxInputTokensPerTurn}`,
          metricValue: t.inputTokens,
          threshold: thresholds.maxInputTokensPerTurn,
          timestamp: nowIso
        });
      }

      if (t.totalLatencyMs > thresholds.maxLatencyMsPerTurn) {
        alerts.push({
          alertType: 'HIGH_LATENCY',
          severity: 'WARNING',
          correlationId: t.correlationId,
          tenantId: t.tenantId,
          accountId: t.accountId,
          message: `Turn exceeded latency threshold: ${t.totalLatencyMs}ms > ${thresholds.maxLatencyMsPerTurn}ms`,
          metricValue: t.totalLatencyMs,
          threshold: thresholds.maxLatencyMsPerTurn,
          timestamp: nowIso
        });
      }

      // Group by Tenant
      this.accumulateDimension(byTenant, t.tenantId || 'unknown', t);

      // Group by Account
      this.accumulateDimension(byAccount, t.accountId || 'unassigned', t);

      // Group by Domain
      this.accumulateDimension(byDomain, t.domain || 'UNKNOWN', t);

      // Group by Intent
      this.accumulateDimension(byIntent, t.intent || 'UNKNOWN', t);

      // Group by Provider/Model
      const provModelKey = `${t.provider || 'unknown'}:${t.model || 'unknown'}`;
      this.accumulateDimension(byProviderModel, provModelKey, t);
    }

    const avgLatencyMs = allLatencies.length > 0
      ? Math.round(allLatencies.reduce((a, b) => a + b, 0) / allLatencies.length)
      : 0;

    const p95LatencyMs = this.calculatePercentile(allLatencies, 95);

    return {
      summary: {
        totalTurns: turns.length,
        totalLlmCalls,
        totalEmbeddingCalls,
        totalInputTokens,
        totalOutputTokens,
        totalRetries,
        avgLatencyMs,
        p95LatencyMs,
        costEstimate: null
      },
      byTenant: this.finalizeDimensions(byTenant),
      byAccount: this.finalizeDimensions(byAccount),
      byDomain: this.finalizeDimensions(byDomain),
      byIntent: this.finalizeDimensions(byIntent),
      byProviderModel: this.finalizeDimensions(byProviderModel),
      alerts
    };
  }

  private static accumulateDimension(
    map: Record<string, { metrics: DimensionUsage; latencies: number[] }>,
    key: string,
    t: TurnCostMetrics
  ): void {
    if (!map[key]) {
      map[key] = {
        metrics: {
          totalTurns: 0,
          llmCalls: 0,
          embeddingCalls: 0,
          inputTokens: 0,
          outputTokens: 0,
          retries: 0,
          avgLatencyMs: 0
        },
        latencies: []
      };
    }
    const item = map[key];
    item.metrics.totalTurns++;
    item.metrics.llmCalls += t.llmCalls;
    item.metrics.embeddingCalls += t.embeddingCalls;
    item.metrics.inputTokens += t.inputTokens;
    item.metrics.outputTokens += t.outputTokens;
    item.metrics.retries += t.retryAttempts;
    if (t.totalLatencyMs > 0) {
      item.latencies.push(t.totalLatencyMs);
    }
  }

  private static finalizeDimensions(
    map: Record<string, { metrics: DimensionUsage; latencies: number[] }>
  ): Record<string, DimensionUsage> {
    const result: Record<string, DimensionUsage> = {};
    for (const [k, v] of Object.entries(map)) {
      const avg = v.latencies.length > 0
        ? Math.round(v.latencies.reduce((a, b) => a + b, 0) / v.latencies.length)
        : 0;
      result[k] = {
        ...v.metrics,
        avgLatencyMs: avg
      };
    }
    return result;
  }

  private static calculatePercentile(values: number[], percentile: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
  }
}
