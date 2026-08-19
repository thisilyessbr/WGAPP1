import crypto from 'crypto';
import { TelemetryEvent, TelemetryStatus } from '../../../packages/shared/contracts/telemetry.contract';

export interface TelemetryEventInput {
  eventId?: string;
  timestamp?: string;
  eventType: string;
  tenantId: string;
  conversationId?: string;
  messageId?: string;
  correlationId: string;
  stage: string;
  status: TelemetryStatus;
  latencyMs?: number;
  provider?: string;
  model?: string;
  errorCode?: string;
  metadata?: Record<string, unknown>;
}

export interface TelemetryClientOptions {
  monitoringServiceUrl?: string;
  queueCapacity?: number;
  timeoutMs?: number;
  flushIntervalMs?: number;
  batchSize?: number;
}

const FORBIDDEN_METADATA_KEYS = new Set([
  'prompt',
  'rawprompt',
  'response',
  'rawresponse',
  'rawchunk',
  'content',
  'rawmessage',
  'email',
  'phone',
  'ssn',
  'apikey',
  'token',
  'authorization',
  'secret',
  'imagebase64',
  'imagebuffer',
  'base64',
  'password'
]);

export class TelemetryClient {
  private monitoringServiceUrl: string;
  private queueCapacity: number;
  private timeoutMs: number;
  private flushIntervalMs: number;
  private batchSize: number;

  private queue: TelemetryEvent[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private isFlushing = false;
  private isEnabled: boolean;

  constructor(options: TelemetryClientOptions = {}) {
    this.monitoringServiceUrl = (options.monitoringServiceUrl ?? process.env.MONITORING_SERVICE_URL ?? '').trim();
    this.queueCapacity = options.queueCapacity ?? 500;
    this.timeoutMs = options.timeoutMs ?? 500;
    this.flushIntervalMs = options.flushIntervalMs ?? 500;
    this.batchSize = options.batchSize ?? 25;
    this.isEnabled = Boolean(this.monitoringServiceUrl);

    if (this.isEnabled) {
      this.startFlushTimer();
    }
  }

  /**
   * Helper to generate a single correlation ID for a customer message turn.
   */
  static createCorrelationId(): string {
    return crypto.randomUUID();
  }

  /**
   * Best-effort, non-blocking telemetry emitter.
   * Never throws, never blocks customer processing.
   */
  emit(input: TelemetryEventInput): void {
    if (!this.isEnabled) {
      return;
    }

    try {
      if (!input || typeof input !== 'object') {
        return;
      }

      // Enforce strict privacy sanitization on metadata before entering queue
      const cleanMetadata: Record<string, unknown> = {};
      if (input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata)) {
        for (const [key, val] of Object.entries(input.metadata)) {
          if (!FORBIDDEN_METADATA_KEYS.has(key.toLowerCase())) {
            if (typeof val !== 'function' && typeof val !== 'symbol') {
              cleanMetadata[key] = val;
            }
          }
        }
      }

      const event: TelemetryEvent = {
        eventId: input.eventId || crypto.randomUUID(),
        timestamp: input.timestamp || new Date().toISOString(),
        eventType: String(input.eventType || 'unknown'),
        tenantId: String(input.tenantId || 'unknown'),
        conversationId: input.conversationId ? String(input.conversationId) : undefined,
        messageId: input.messageId ? String(input.messageId) : undefined,
        correlationId: String(input.correlationId || crypto.randomUUID()),
        stage: String(input.stage || 'unknown'),
        status: input.status,
        latencyMs: typeof input.latencyMs === 'number' && !isNaN(input.latencyMs) ? Math.max(0, Math.floor(input.latencyMs)) : undefined,
        provider: input.provider ? String(input.provider) : undefined,
        model: input.model ? String(input.model) : undefined,
        errorCode: input.errorCode ? String(input.errorCode) : undefined,
        metadata: cleanMetadata
      };

      // Bounded queue: drop oldest event if at capacity
      if (this.queue.length >= this.queueCapacity) {
        this.queue.shift();
      }

      this.queue.push(event);

      // Trigger immediate background flush if batch size reached
      if (this.queue.length >= this.batchSize && !this.isFlushing) {
        setImmediate(() => {
          this.flush().catch(() => {});
        });
      }
    } catch {
      // Swallowed locally: zero exceptions propagate to caller
    }
  }

  /**
   * Internal asynchronous background flush.
   * Makes one single bounded attempt. Swallows all errors.
   */
  async flush(): Promise<void> {
    if (!this.isEnabled || this.isFlushing || this.queue.length === 0) {
      return;
    }

    this.isFlushing = true;
    const batch = this.queue.splice(0, this.batchSize);

    try {
      const endpoint = `${this.monitoringServiceUrl.replace(/\/+$/, '')}/api/telemetry/ingest`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(batch),
        signal: AbortSignal.timeout(this.timeoutMs)
      });

      // No retries on failure; failed batch is discarded safely
      if (!response.ok) {
        // Discarded
      }
    } catch {
      // Single attempt failed or timed out: discarded safely, zero retry, zero propagation
    } finally {
      this.isFlushing = false;
    }
  }

  /**
   * Inspection helper for focused test verification only.
   */
  getQueueLengthForTesting(): number {
    return this.queue.length;
  }

  /**
   * Graceful cleanup.
   */
  async close(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush().catch(() => {});
  }

  private startFlushTimer(): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => {
      this.flush().catch(() => {});
    }, this.flushIntervalMs);
  }
}

// Default singleton instance
export const telemetry = new TelemetryClient();
