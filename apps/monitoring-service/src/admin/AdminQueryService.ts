import { Pool } from 'pg';
import { getMonitoringPool } from '../storage/db';
import { TelemetryStorage } from '../storage/TelemetryStorage';
import { TraceDiagnosisService, TraceDiagnosis } from './TraceDiagnosisService';
import { TurnSummaryService, CustomerTurnSummary, TurnListResponse } from './TurnSummaryService';

export interface SanitizedTranscriptMessage {
  messageId: string;
  conversationId: string;
  role: string;
  content: string;
  createdAt: string;
}

export interface AdminTranscriptResponse {
  conversationId: string;
  count: number;
  limit: number;
  hasMore: boolean;
  messages: SanitizedTranscriptMessage[];
}

export interface AdminTraceEvent {
  eventId: string;
  timestamp: string;
  eventType: string;
  tenantId: string;
  conversationId?: string;
  messageId?: string;
  correlationId: string;
  stage: string;
  status: string;
  latencyMs?: number;
  provider?: string;
  model?: string;
  errorCode?: string;
  metadata?: Record<string, unknown>;
}

export interface AdminTraceResponse {
  success: boolean;
  correlationId?: string;
  tenantId?: string;
  conversationId?: string;
  count: number;
  events: AdminTraceEvent[];
}

export interface AdminDiagnosisResponse {
  success: boolean;
  correlationId?: string;
  diagnosis: TraceDiagnosis | null;
  count: number;
  events: AdminTraceEvent[];
}

export interface AdminTurnDetailResponse {
  success: boolean;
  correlationId: string;
  turn: CustomerTurnSummary | null;
  diagnosis: TraceDiagnosis | null;
  count: number;
  events: AdminTraceEvent[];
}

export class AdminQueryService {
  private diagnosisService: TraceDiagnosisService;
  private turnSummaryService: TurnSummaryService;
  private pool: Pool;

  constructor(private storage: TelemetryStorage, diagnosisService?: TraceDiagnosisService, pool?: Pool) {
    this.diagnosisService = diagnosisService || new TraceDiagnosisService();
    this.turnSummaryService = new TurnSummaryService(this.diagnosisService);
    this.pool = pool || getMonitoringPool();
  }

  private mapToAdminEvent(e: any): AdminTraceEvent {
    return {
      eventId: e.eventId,
      timestamp: e.timestamp,
      eventType: e.eventType,
      tenantId: e.tenantId,
      conversationId: e.conversationId,
      messageId: e.messageId,
      correlationId: e.correlationId,
      stage: e.stage,
      status: e.status,
      latencyMs: e.latencyMs,
      provider: e.provider,
      model: e.model,
      errorCode: e.errorCode,
      metadata: e.metadata || {}
    };
  }

  async getTraceByCorrelationId(correlationId: string): Promise<AdminTraceResponse> {
    if (!correlationId || typeof correlationId !== 'string' || !correlationId.trim()) {
      return { success: true, correlationId, count: 0, events: [] };
    }

    const events = await this.storage.getTraceByCorrelationId(correlationId.trim());
    return {
      success: true,
      correlationId: correlationId.trim(),
      count: events.length,
      events: events.map(e => this.mapToAdminEvent(e))
    };
  }

  async getDiagnosisByCorrelationId(correlationId: string): Promise<AdminDiagnosisResponse> {
    if (!correlationId || typeof correlationId !== 'string' || !correlationId.trim()) {
      return { success: true, correlationId, diagnosis: null, count: 0, events: [] };
    }

    const events = await this.storage.getTraceByCorrelationId(correlationId.trim());
    if (events.length === 0) {
      return { success: true, correlationId: correlationId.trim(), diagnosis: null, count: 0, events: [] };
    }

    const adminEvents = events.map(e => this.mapToAdminEvent(e));
    const diagnosis = this.diagnosisService.diagnoseTrace(correlationId.trim(), adminEvents);

    return {
      success: true,
      correlationId: correlationId.trim(),
      diagnosis,
      count: adminEvents.length,
      events: adminEvents
    };
  }

  async getTracesByTenantId(tenantId: string, limit?: number): Promise<AdminTraceResponse> {
    if (!tenantId || typeof tenantId !== 'string' || !tenantId.trim()) {
      return { success: true, tenantId, count: 0, events: [] };
    }

    const safeLimit = Math.min(Math.max(1, limit || 50), 200);
    const events = await this.storage.getTracesByTenantId(tenantId.trim(), safeLimit);
    return {
      success: true,
      tenantId: tenantId.trim(),
      count: events.length,
      events: events.map(e => this.mapToAdminEvent(e))
    };
  }

  async getEventsByConversationId(conversationId: string, limit?: number): Promise<AdminTraceResponse> {
    if (!conversationId || typeof conversationId !== 'string' || !conversationId.trim()) {
      return { success: true, conversationId, count: 0, events: [] };
    }

    const safeLimit = Math.min(Math.max(1, limit || 50), 200);
    const events = await this.storage.getEventsByConversationId(conversationId.trim(), safeLimit);
    return {
      success: true,
      conversationId: conversationId.trim(),
      count: events.length,
      events: events.map(e => this.mapToAdminEvent(e))
    };
  }

  // ============================================================================
  // Phase 5C: Turn-Centric Queries
  // ============================================================================

  /**
   * Returns turns grouped by correlationId for a given tenant.
   * Supports filters: outcome, stage, primaryFailure, responseSource.
   */
  async getTurnsByTenantId(
    tenantId: string,
    limit?: number,
    filters?: { outcome?: string; stage?: string; primaryFailure?: string; responseSource?: string }
  ): Promise<TurnListResponse> {
    if (!tenantId || typeof tenantId !== 'string' || !tenantId.trim()) {
      return { success: true, tenantId, count: 0, turns: [] };
    }

    const safeLimit = Math.min(Math.max(1, limit || 50), 200);
    const events = await this.storage.getTracesByTenantId(tenantId.trim(), safeLimit);
    const adminEvents = events.map(e => this.mapToAdminEvent(e));

    let turns = this.turnSummaryService.buildTurnSummaries(adminEvents);

    if (filters) {
      turns = this.turnSummaryService.filterTurns(turns, filters);
    }

    return {
      success: true,
      tenantId: tenantId.trim(),
      count: turns.length,
      turns
    };
  }

  /**
   * Returns turns grouped by correlationId for a given conversation.
   * Supports filters: outcome, stage, primaryFailure, responseSource.
   */
  async getTurnsByConversationId(
    conversationId: string,
    limit?: number,
    filters?: { outcome?: string; stage?: string; primaryFailure?: string; responseSource?: string }
  ): Promise<TurnListResponse> {
    if (!conversationId || typeof conversationId !== 'string' || !conversationId.trim()) {
      return { success: true, conversationId, count: 0, turns: [] };
    }

    const safeLimit = Math.min(Math.max(1, limit || 50), 200);
    const events = await this.storage.getEventsByConversationId(conversationId.trim(), safeLimit);
    const adminEvents = events.map(e => this.mapToAdminEvent(e));

    let turns = this.turnSummaryService.buildTurnSummaries(adminEvents);

    if (filters) {
      turns = this.turnSummaryService.filterTurns(turns, filters);
    }

    return {
      success: true,
      conversationId: conversationId.trim(),
      count: turns.length,
      turns
    };
  }

  /**
   * Full correlation drill-down: retrieves ALL events for a single correlationId,
   * builds a complete turn summary (possiblyTruncated = false when terminal milestone present),
   * and includes the full TraceDiagnosis.
   *
   * This replaces the truncated turn summary with a definitive one.
   */
  async getTurnDetailByCorrelationId(correlationId: string): Promise<AdminTurnDetailResponse> {
    if (!correlationId || typeof correlationId !== 'string' || !correlationId.trim()) {
      return { success: true, correlationId: correlationId || '', turn: null, diagnosis: null, count: 0, events: [] };
    }

    const cid = correlationId.trim();
    const events = await this.storage.getTraceByCorrelationId(cid);
    if (events.length === 0) {
      return { success: true, correlationId: cid, turn: null, diagnosis: null, count: 0, events: [] };
    }

    const adminEvents = events.map(e => this.mapToAdminEvent(e));

    // Full correlation retrieval: build a non-boundary turn summary
    // Since we fetched ALL events for this single correlationId, the turn is complete
    // and should never be flagged as truncated (unless truly missing terminal milestone).
    const diagnosis = this.diagnosisService.diagnoseTrace(cid, adminEvents);

    const sorted = [...adminEvents].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    const startTime = sorted[0].timestamp;
    const endTime = sorted.length > 1 ? sorted[sorted.length - 1].timestamp : undefined;
    const totalLatencyMs = endTime
      ? Math.max(0, new Date(endTime).getTime() - new Date(startTime).getTime())
      : undefined;

    const stagesSeen = new Set<string>();
    const stages: string[] = [];
    for (const evt of sorted) {
      const s = evt.stage.toUpperCase();
      if (!stagesSeen.has(s)) {
        stagesSeen.add(s);
        stages.push(s);
      }
    }

    const turn: CustomerTurnSummary = {
      correlationId: cid,
      tenantId: sorted[0].tenantId,
      conversationId: sorted[0].conversationId,
      startTime,
      endTime,
      totalLatencyMs,
      eventCount: sorted.length,
      outcome: diagnosis.outcome,
      primaryResolution: diagnosis.primaryResolution,
      primaryFailure: diagnosis.primaryFailure,
      primaryReason: diagnosis.primaryReason,
      finalResponseSource: diagnosis.finalResponseSource,
      stages,
      summaryExplanation: diagnosis.summaryExplanation,
      possiblyTruncated: false, // Full retrieval — never truncated
    };

    return {
      success: true,
      correlationId: cid,
      turn,
      diagnosis,
      count: adminEvents.length,
      events: adminEvents
    };
  }

  /**
   * Safe Admin transcript retrieval bridge:
   * Constrains strictly on BOTH tenantId AND conversationId.
   * Returns sanitized message records ordered by createdAt ASC.
   * Enforces default limit 50, capped at 200.
   */
  async getConversationMessages(
    tenantId: string,
    conversationId: string,
    limit?: number
  ): Promise<AdminTranscriptResponse> {
    if (!tenantId || typeof tenantId !== 'string' || !tenantId.trim()) {
      return { conversationId: conversationId || '', count: 0, limit: 50, hasMore: false, messages: [] };
    }
    if (!conversationId || typeof conversationId !== 'string' || !conversationId.trim()) {
      return { conversationId: '', count: 0, limit: 50, hasMore: false, messages: [] };
    }

    const tId = tenantId.trim();
    const cId = conversationId.trim();
    const safeLimit = Math.min(Math.max(1, limit || 50), 200);

    const query = `
      SELECT 
        id AS "messageId",
        "conversationId",
        role,
        content,
        "createdAt"
      FROM "Message"
      WHERE "tenantId" = $1 AND "conversationId" = $2
      ORDER BY "createdAt" ASC
      LIMIT $3;
    `;

    const res = await this.pool.query(query, [tId, cId, safeLimit + 1]);
    const rows = res.rows || [];
    const hasMore = rows.length > safeLimit;
    const messages: SanitizedTranscriptMessage[] = rows.slice(0, safeLimit).map((row: any) => ({
      messageId: String(row.messageId),
      conversationId: String(row.conversationId),
      role: String(row.role),
      content: String(row.content),
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    }));

    return {
      conversationId: cId,
      count: messages.length,
      limit: safeLimit,
      hasMore,
      messages
    };
  }
}
