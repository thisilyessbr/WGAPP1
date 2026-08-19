import { IngestResponse, TelemetryEvent } from '../../../../packages/shared/contracts/telemetry.contract';
import { TelemetryStorage } from '../storage/TelemetryStorage';
import { validateAndSanitizeEvent } from './validator';

export class IngestionService {
  constructor(private storage: TelemetryStorage) {}

  async processPayload(payload: any): Promise<IngestResponse> {
    if (!payload) {
      return { success: false, accepted: 0, rejected: 1, errors: ['Empty payload'] };
    }

    const items: any[] = Array.isArray(payload) ? payload : (payload.events && Array.isArray(payload.events) ? payload.events : [payload]);
    
    let accepted = 0;
    let rejected = 0;
    const errors: string[] = [];
    const validEvents: TelemetryEvent[] = [];

    for (let i = 0; i < items.length; i++) {
      const validation = validateAndSanitizeEvent(items[i]);
      if (validation.isValid && validation.event) {
        validEvents.push(validation.event);
        this.storage.enqueue(validation.event);
        accepted++;
      } else {
        rejected++;
        errors.push(`Item [${i}]: ${(validation.errors || []).join(', ')}`);
      }
    }

    return {
      success: accepted > 0 || (items.length === 0 && rejected === 0),
      accepted,
      rejected,
      errors: errors.length > 0 ? errors : undefined
    };
  }
}
