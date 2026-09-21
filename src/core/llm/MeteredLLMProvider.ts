import { LLMProvider, LLMRequestOptions, LLMUsage } from './LLMProvider';

export interface LLMCallRecord extends LLMUsage {
  purpose: string;
  success: boolean;
  latencyMs: number;
  retryAttempts: number;
}

/** Per-turn wrapper: no request state is kept on the shared provider instance. */
export class MeteredLLMProvider implements LLMProvider {
  constructor(
    private inner: LLMProvider,
    private defaults: { provider: string; model: string },
    private record: (usage: LLMCallRecord) => void
  ) {}

  classifyIntent(prompt: string, message: string, allowed: string[], options?: LLMRequestOptions) {
    if (!allowed.length) return Promise.resolve(null);
    return this.measure('intent_classification', options, opt => this.inner.classifyIntent(prompt, message, allowed, opt));
  }

  extractField(prompt: string, message: string, type: string, options?: LLMRequestOptions) {
    return this.measure('field_extraction', options, opt => this.inner.extractField(prompt, message, type, opt));
  }

  generateResponse(prompt: string, history: { role: string; content: string }[], options?: LLMRequestOptions) {
    return this.measure('generation', options, opt => this.inner.generateResponse(prompt, history, opt));
  }

  private async measure<T>(purpose: string, options: LLMRequestOptions | undefined, call: (opt: LLMRequestOptions) => Promise<T>): Promise<T> {
    const started = Date.now();
    let usage: LLMUsage = { ...this.defaults, model: options?.model || this.defaults.model, attempts: 1, tokenSource: 'unknown' };
    let success = false;
    try {
      const result = await call({ ...options, onUsage: value => {
        usage = value;
        try { options?.onUsage?.(value); } catch { /* Observability must not cause a repeat request. */ }
      } });
      success = true;
      return result;
    } finally {
      try {
        this.record({ ...usage, purpose, success, latencyMs: Date.now() - started, retryAttempts: Math.max(0, usage.attempts - 1) });
      } catch { /* Telemetry cannot change customer processing. */ }
    }
  }
}
