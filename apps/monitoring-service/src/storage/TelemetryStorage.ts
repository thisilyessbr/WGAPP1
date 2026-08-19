import { Pool } from 'pg';
import { TelemetryEvent } from '../../../../packages/shared/contracts/telemetry.contract';
import { getMonitoringPool } from './db';

export class TelemetryStorage {
  private pool: Pool;
  private isInitialized = false;
  private batchBuffer: TelemetryEvent[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private isFlushing = false;
  private readonly maxBufferSize = 500;
  private readonly flushIntervalMs = 500;

  constructor(pool?: Pool) {
    this.pool = pool || getMonitoringPool();
  }

  async init(): Promise<void> {
    if (this.isInitialized) return;

    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS telemetry_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        event_id VARCHAR(100) NOT NULL UNIQUE,
        timestamp TIMESTAMPTZ NOT NULL,
        event_type VARCHAR(100) NOT NULL,
        tenant_id VARCHAR(100) NOT NULL,
        conversation_id VARCHAR(100),
        message_id VARCHAR(100),
        correlation_id VARCHAR(100) NOT NULL,
        stage VARCHAR(50) NOT NULL,
        status VARCHAR(50) NOT NULL,
        latency_ms INT,
        provider VARCHAR(50),
        model VARCHAR(100),
        error_code VARCHAR(100),
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_telemetry_correlation_time 
        ON telemetry_events (correlation_id, timestamp ASC);

      CREATE INDEX IF NOT EXISTS idx_telemetry_tenant_time 
        ON telemetry_events (tenant_id, timestamp DESC);

      CREATE INDEX IF NOT EXISTS idx_telemetry_conversation_time 
        ON telemetry_events (conversation_id, timestamp ASC);
    `;

    try {
      await this.pool.query(createTableQuery);
      this.isInitialized = true;
      this.startFlushTimer();
    } catch (err: any) {
      console.error('[monitoring-storage] Failed to initialize telemetry_events table:', err.message || err);
      throw err;
    }
  }

  private startFlushTimer(): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => {
      this.flush().catch((err) => {
        console.error('[monitoring-storage] Background batch flush error:', err.message || err);
      });
    }, this.flushIntervalMs);
  }

  enqueue(event: TelemetryEvent): void {
    if (this.batchBuffer.length >= this.maxBufferSize) {
      // Buffer overflow policy: drop oldest event to avoid memory growth and protect the service
      this.batchBuffer.shift();
    }
    this.batchBuffer.push(event);

    // If buffer reaches 25 items, trigger immediate background flush
    if (this.batchBuffer.length >= 25 && !this.isFlushing) {
      setImmediate(() => {
        this.flush().catch((err) => {
          console.error('[monitoring-storage] Eager batch flush error:', err.message || err);
        });
      });
    }
  }

  async flush(): Promise<number> {
    if (this.isFlushing || this.batchBuffer.length === 0) return 0;
    this.isFlushing = true;

    const toWrite = this.batchBuffer.splice(0, 50);
    try {
      await this.insertBatch(toWrite);
      return toWrite.length;
    } catch (err: any) {
      console.error('[monitoring-storage] Failed to persist telemetry batch:', err.message || err);
      return 0;
    } finally {
      this.isFlushing = false;
    }
  }

  async insertBatch(events: TelemetryEvent[]): Promise<void> {
    if (!events || events.length === 0) return;

    if (!this.isInitialized) {
      await this.init();
    }

    const valueRows: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    for (const e of events) {
      valueRows.push(`(
        $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++},
        $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++},
        $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++},
        $${paramIndex++}, $${paramIndex++}
      )`);

      params.push(
        e.eventId,
        new Date(e.timestamp),
        e.eventType,
        e.tenantId,
        e.conversationId || null,
        e.messageId || null,
        e.correlationId,
        e.stage,
        e.status,
        e.latencyMs ?? null,
        e.provider || null,
        e.model || null,
        e.errorCode || null,
        JSON.stringify(e.metadata || {})
      );
    }

    const query = `
      INSERT INTO telemetry_events (
        event_id, timestamp, event_type, tenant_id,
        conversation_id, message_id, correlation_id, stage,
        status, latency_ms, provider, model,
        error_code, metadata
      )
      VALUES ${valueRows.join(', ')}
      ON CONFLICT (event_id) DO NOTHING;
    `;

    await this.pool.query(query, params);
  }

  async getTraceByCorrelationId(correlationId: string): Promise<TelemetryEvent[]> {
    if (!this.isInitialized) {
      await this.init();
    }

    // Flush any pending events in memory first so query returns real-time data
    await this.flush();

    const query = `
      SELECT 
        event_id as "eventId",
        timestamp,
        event_type as "eventType",
        tenant_id as "tenantId",
        conversation_id as "conversationId",
        message_id as "messageId",
        correlation_id as "correlationId",
        stage,
        status,
        latency_ms as "latencyMs",
        provider,
        model,
        error_code as "errorCode",
        metadata
      FROM telemetry_events
      WHERE correlation_id = $1
      ORDER BY timestamp ASC;
    `;

    const res = await this.pool.query(query, [correlationId]);
    return res.rows.map(this.formatRow);
  }

  async getTracesByTenantId(tenantId: string, limit = 100): Promise<TelemetryEvent[]> {
    if (!this.isInitialized) {
      await this.init();
    }

    // Flush any pending events in memory first
    await this.flush();

    const safeLimit = Math.min(Math.max(1, limit), 500);
    const query = `
      SELECT 
        event_id as "eventId",
        timestamp,
        event_type as "eventType",
        tenant_id as "tenantId",
        conversation_id as "conversationId",
        message_id as "messageId",
        correlation_id as "correlationId",
        stage,
        status,
        latency_ms as "latencyMs",
        provider,
        model,
        error_code as "errorCode",
        metadata
      FROM telemetry_events
      WHERE tenant_id = $1
      ORDER BY timestamp DESC
      LIMIT $2;
    `;

    const res = await this.pool.query(query, [tenantId, safeLimit]);
    return res.rows.map(this.formatRow);
  }

  async getEventsByConversationId(conversationId: string, limit = 100): Promise<TelemetryEvent[]> {
    if (!this.isInitialized) {
      await this.init();
    }

    // Flush any pending events in memory first
    await this.flush();

    const safeLimit = Math.min(Math.max(1, limit), 200);
    const query = `
      SELECT 
        event_id as "eventId",
        timestamp,
        event_type as "eventType",
        tenant_id as "tenantId",
        conversation_id as "conversationId",
        message_id as "messageId",
        correlation_id as "correlationId",
        stage,
        status,
        latency_ms as "latencyMs",
        provider,
        model,
        error_code as "errorCode",
        metadata
      FROM telemetry_events
      WHERE conversation_id = $1
      ORDER BY timestamp ASC
      LIMIT $2;
    `;

    const res = await this.pool.query(query, [conversationId, safeLimit]);
    return res.rows.map(this.formatRow);
  }

  async checkHealth(): Promise<boolean> {
    try {
      const res = await this.pool.query('SELECT 1 as healthy;');
      return res.rows?.[0]?.healthy === 1;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
  }

  private formatRow(row: any): TelemetryEvent {
    return {
      eventId: row.eventId,
      timestamp: row.timestamp instanceof Date ? row.timestamp.toISOString() : String(row.timestamp),
      eventType: row.eventType,
      tenantId: row.tenantId,
      conversationId: row.conversationId || undefined,
      messageId: row.messageId || undefined,
      correlationId: row.correlationId,
      stage: row.stage,
      status: row.status,
      latencyMs: row.latencyMs !== null && row.latencyMs !== undefined ? Number(row.latencyMs) : undefined,
      provider: row.provider || undefined,
      model: row.model || undefined,
      errorCode: row.errorCode || undefined,
      metadata: row.metadata || {}
    };
  }
}
