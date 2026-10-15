import { WorkflowFieldConfig } from '../../domain/tenant/BusinessConfig';

/** A literal customer-provided time, never a generated or confirmed appointment. */
export class OpeningTemporalPreference {
  static isField(field: string | WorkflowFieldConfig | undefined, stateId: string): boolean {
    const name = typeof field === 'string' ? field : field?.name || stateId;
    const type = typeof field === 'object' ? field.type : undefined;
    return type === 'date' || type === 'time' || type === 'datetime' ||
      /(?:preferred|requested|desired).*(?:date|time)|(?:date|time).*(?:preferred|requested|desired)/i.test(name);
  }

  static extract(message: string): string | null {
    // Only declarative clauses can supply a preference. A question about opening
    // hours or availability must not silently become the customer's chosen slot.
    const clauses = message.split(/[.!?؟\n]+/u).map(value => value.trim()).filter(Boolean);
    for (const clause of clauses) {
      if (/^(?:(?:does|do|can|could|is|are|when|what|which|wach|wqch|est-ce|vous)\b|(?:هل|واش|فاش|متى)(?:\s|$))/iu.test(clause)) continue;
      const date = /\b(?:tomorrow|today|demain|aujourd'hui|ghda|gheda|ghedwa)\b|(?:غدا|غداً|غدوة|اليوم)|\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/iu.exec(clause);
      if (!date) continue;
      const candidate = clause.slice(date.index).trim().replace(/[,،;؛]+$/u, '').trim();
      // Preserve the original wording, but reject long clauses and attached
      // questions. This is only a candidate until the configured workflow
      // reaches its normal confirmation or completion path.
      if (candidate.length > 60 || /[?؟]/u.test(candidate)) continue;
      if (/\b(?:does|do|can|could|is|are|when|what|which|wach|wqch)\b|واش|هل/iu.test(candidate)) continue;
      return candidate;
    }
    return null;
  }
}
