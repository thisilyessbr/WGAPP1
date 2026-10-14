import { GroundedAnswerGuard } from './GroundedAnswerGuard';
import { GroundedPromptBuilder } from './GroundedPromptBuilder';

/** Appends the tenant's configured hours to a reply that answered another
 * requested fact first, without exceeding the response length limit. */
export class BusinessHoursClause {
  private static readonly QUESTION = /\b(?:katseddo|katsedou|katsedo|katsdo|katsdou|kat7ello|kat7elo|kat7lo|kat7lou|kathllo|kathlo|closing\s+time|opening\s+hours|what\s+time\s+(?:do\s+you\s+)?(?:close|open))\b|كتسدو|كتحلو/iu;

  static isRequested(question: string): boolean {
    return this.QUESTION.test(question);
  }

  /** True when every configured time (in any 9:00 / 09h00 / 9h variant) is
   * already in the reply, or the configured text itself is when it has none. */
  static alreadyStated(response: string, businessHours: string): boolean {
    const configured = GroundedAnswerGuard.extractTimes(businessHours);
    if (configured.length === 0) {
      return response.toLocaleLowerCase().includes(businessHours.trim().toLocaleLowerCase());
    }
    // "We close at 21:00" answers "when do you close?"; a time that is not
    // configured ("18:00" for 09:00–19:00) still gets the real hours.
    const stated = GroundedAnswerGuard.extractTimes(response);
    return stated.length > 0 && stated.every(time => configured.includes(time));
  }

  static append(response: string, businessHours: string, label: string, maxResponseLength?: number | string): string {
    const hours = businessHours.trim().replace(/[.。]+$/u, '');
    const suffix = `\n${label}${hours}.`;
    const configuredLimit = Number(maxResponseLength);
    const limit = Number.isFinite(configuredLimit) && configuredLimit > 0 ? Math.floor(configuredLimit) : 500;
    const base = response.trim();
    if (base.length + suffix.length <= limit) return `${base}${suffix}`;
    // Shorten the first answer at a sentence boundary so the final limiter
    // never cuts the hours clause in the middle.
    // (Reserve 3 characters for the limiter's word-boundary ellipsis.)
    const budget = limit - suffix.length - 3;
    if (budget < 20) return base;
    return `${GroundedPromptBuilder.applyResponseLimit(base, budget).trim()}${suffix}`;
  }
}
