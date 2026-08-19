import { TraceQueryResponse } from '../../../../packages/shared/contracts/telemetry.contract';
import { TelemetryStorage } from '../storage/TelemetryStorage';

export class TraceQueryService {
  constructor(private storage: TelemetryStorage) {}

  async getTraceByCorrelationId(correlationId: string): Promise<TraceQueryResponse> {
    if (!correlationId || typeof correlationId !== 'string' || !correlationId.trim()) {
      return { success: false, correlationId, count: 0, events: [] };
    }

    const events = await this.storage.getTraceByCorrelationId(correlationId.trim());
    return {
      success: true,
      correlationId: correlationId.trim(),
      count: events.length,
      events
    };
  }

  async getTracesByTenantId(tenantId: string, limit = 100): Promise<TraceQueryResponse> {
    if (!tenantId || typeof tenantId !== 'string' || !tenantId.trim()) {
      return { success: false, tenantId, count: 0, events: [] };
    }

    const events = await this.storage.getTracesByTenantId(tenantId.trim(), limit);
    return {
      success: true,
      tenantId: tenantId.trim(),
      count: events.length,
      events
    };
  }
}
