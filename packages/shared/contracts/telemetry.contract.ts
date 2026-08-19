export type TelemetryStatus = 'SUCCESS' | 'FAILURE' | 'SKIPPED' | 'UNANSWERABLE';

export interface TelemetryEvent {
  eventId: string;
  timestamp: string;
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

export interface IngestResponse {
  success: boolean;
  accepted: number;
  rejected?: number;
  errors?: string[];
}

export interface TraceQueryResponse {
  success: boolean;
  correlationId?: string;
  tenantId?: string;
  count: number;
  events: TelemetryEvent[];
}
