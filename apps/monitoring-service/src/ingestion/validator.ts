import { TelemetryEvent, TelemetryStatus } from '../../../../packages/shared/contracts/telemetry.contract';

const VALID_STATUSES: Set<TelemetryStatus> = new Set(['SUCCESS', 'FAILURE', 'SKIPPED', 'UNANSWERABLE']);

// Forbidden keys that must never be accepted or persisted by default (Privacy & Security boundary)
const FORBIDDEN_KEYS = new Set([
  'rawmessage',
  'prompt',
  'response',
  'rawresponse',
  'rawprompt',
  'rawchunk',
  'content',
  'base64',
  'imagebase64',
  'imagebuffer',
  'password',
  'apikey',
  'token',
  'authorization',
  'secret',
  'email',
  'phone',
  'ssn'
]);

export interface ValidationResult {
  isValid: boolean;
  event?: TelemetryEvent;
  errors?: string[];
}

export function validateAndSanitizeEvent(raw: any): ValidationResult {
  const errors: string[] = [];

  if (!raw || typeof raw !== 'object') {
    return { isValid: false, errors: ['Event must be a non-null object'] };
  }

  // 1. Validate required fields
  if (!raw.eventId || typeof raw.eventId !== 'string' || !raw.eventId.trim()) {
    errors.push('Missing or invalid required field: eventId');
  }

  if (!raw.timestamp || typeof raw.timestamp !== 'string') {
    errors.push('Missing or invalid required field: timestamp');
  } else {
    const parsedDate = Date.parse(raw.timestamp);
    if (isNaN(parsedDate)) {
      errors.push('Field timestamp must be a valid ISO 8601 string');
    }
  }

  if (!raw.eventType || typeof raw.eventType !== 'string' || !raw.eventType.trim()) {
    errors.push('Missing or invalid required field: eventType');
  }

  if (!raw.tenantId || typeof raw.tenantId !== 'string' || !raw.tenantId.trim()) {
    errors.push('Missing or invalid required field: tenantId');
  }

  if (!raw.correlationId || typeof raw.correlationId !== 'string' || !raw.correlationId.trim()) {
    errors.push('Missing or invalid required field: correlationId');
  }

  if (!raw.stage || typeof raw.stage !== 'string' || !raw.stage.trim()) {
    errors.push('Missing or invalid required field: stage');
  }

  if (!raw.status || typeof raw.status !== 'string' || !VALID_STATUSES.has(raw.status as TelemetryStatus)) {
    errors.push(`Field status must be one of: ${Array.from(VALID_STATUSES).join(', ')}`);
  }

  if (errors.length > 0) {
    return { isValid: false, errors };
  }

  // 2. Sanitize and build clean event
  const sanitizedMetadata: Record<string, unknown> = {};
  if (raw.metadata && typeof raw.metadata === 'object' && !Array.isArray(raw.metadata)) {
    for (const [key, value] of Object.entries(raw.metadata)) {
      const lowerKey = key.toLowerCase();
      if (!FORBIDDEN_KEYS.has(lowerKey)) {
        // Only allow primitive types or simple arrays/objects in metadata
        if (typeof value !== 'function' && typeof value !== 'symbol') {
          sanitizedMetadata[key] = value;
        }
      }
    }
  }

  const cleanEvent: TelemetryEvent = {
    eventId: String(raw.eventId).trim(),
    timestamp: new Date(raw.timestamp).toISOString(),
    eventType: String(raw.eventType).trim(),
    tenantId: String(raw.tenantId).trim(),
    conversationId: raw.conversationId ? String(raw.conversationId).trim() : undefined,
    messageId: raw.messageId ? String(raw.messageId).trim() : undefined,
    correlationId: String(raw.correlationId).trim(),
    stage: String(raw.stage).trim(),
    status: raw.status as TelemetryStatus,
    latencyMs: typeof raw.latencyMs === 'number' && !isNaN(raw.latencyMs) ? Math.max(0, Math.floor(raw.latencyMs)) : undefined,
    provider: raw.provider ? String(raw.provider).trim() : undefined,
    model: raw.model ? String(raw.model).trim() : undefined,
    errorCode: raw.errorCode ? String(raw.errorCode).trim() : undefined,
    metadata: sanitizedMetadata
  };

  return { isValid: true, event: cleanEvent };
}
