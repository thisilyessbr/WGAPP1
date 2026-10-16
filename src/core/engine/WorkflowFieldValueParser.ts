import { WorkflowFieldConfig } from '../../domain/tenant/BusinessConfig';
import { SourceSpan, normalizeSpanText } from './WorkflowTurnInterpreter';

export type ParsedWorkflowValue = { rawSpan: SourceSpan; value: unknown };

/** Converts verified customer evidence into canonical values without AI. */
export class WorkflowFieldValueParser {
  static parse(span: SourceSpan, config: WorkflowFieldConfig, now = new Date()): ParsedWorkflowValue | null {
    const raw = span.text.trim();
    if (!raw) return null;
    switch (config.type) {
      case 'string':
      case 'email':
        return { rawSpan: span, value: raw };
      case 'phone': {
        const plus = raw.trim().startsWith('+');
        const digits = raw.replace(/\D/gu, '');
        return digits.length >= 7 && digits.length <= 15
          ? { rawSpan: span, value: `${plus ? '+' : ''}${digits}` } : null;
      }
      case 'number': {
        const normalized = raw.replace(',', '.').replace(/[^\d.+-]/gu, '');
        const value = Number(normalized);
        return Number.isFinite(value) ? { rawSpan: span, value } : null;
      }
      case 'boolean': {
        const normalized = normalizeSpanText(raw);
        if (/^(?:yes|oui|ok|okay|wakha|iyeh|نعم|ايه|إيه)$/u.test(normalized)) return { rawSpan: span, value: true };
        if (/^(?:no|non|la|لا)$/u.test(normalized)) return { rawSpan: span, value: false };
        return null;
      }
      case 'enum': {
        const option = config.options?.find(item => normalizeSpanText(item) === normalizeSpanText(raw));
        return option ? { rawSpan: span, value: option } : null;
      }
      case 'time': {
        const match = /(?:^|\s)(\d{1,2})(?::([0-5]\d))?\s*(am|pm|ص|م)?(?:\s|$)/iu.exec(raw);
        if (!match) return null;
        let hour = Number(match[1]);
        const minute = Number(match[2] || 0);
        const meridiem = (match[3] || '').toLocaleLowerCase();
        if ((meridiem === 'pm' || meridiem === 'م') && hour < 12) hour += 12;
        if ((meridiem === 'am' || meridiem === 'ص') && hour === 12) hour = 0;
        if (hour > 23) return null;
        return { rawSpan: span, value: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}` };
      }
      case 'date':
      case 'datetime': {
        const normalized = normalizeSpanText(raw);
        const date = new Date(now);
        if (/\b(?:tomorrow|ghda|غدا|غداً)\b/u.test(normalized)) date.setDate(date.getDate() + 1);
        else if (/\b(?:today|lyoum|اليوم)\b/u.test(normalized)) { /* same day */ }
        else {
          const parsed = new Date(raw);
          if (Number.isNaN(parsed.getTime())) return null;
          date.setTime(parsed.getTime());
        }
        if (config.type === 'date') return { rawSpan: span, value: date.toISOString().slice(0, 10) };
        const time = this.parse(span, { ...config, type: 'time' });
        if (time && typeof time.value === 'string') {
          const [hours, minutes] = time.value.split(':').map(Number);
          date.setHours(hours, minutes, 0, 0);
        }
        return { rawSpan: span, value: date.toISOString() };
      }
    }
  }
}
