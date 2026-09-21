import { LLMProvider, LLMProviderError, LLMRequestOptions, LLMUsage } from './LLMProvider';
import { logger } from '../../utils/logger';

export const DEFAULT_DEEPSEEK_MODEL = 'deepseek-flash';

/** Keep stored non-thinking chat configurations working after the legacy alias retirement. */
export function resolveDeepSeekModel(model?: string): string {
  const requested = model?.trim();
  return !requested || requested === 'deepseek-chat' || requested === 'deepseek-v4-flash'
    ? DEFAULT_DEEPSEEK_MODEL : requested;
}

export class DeepSeekProvider implements LLMProvider {
  private apiKey: string;
  private defaultModel: string;
  private baseUrl: string = 'https://api.deepseek.com/v1';

  constructor(apiKey: string, defaultModel: string = DEFAULT_DEEPSEEK_MODEL) {
    if (!apiKey) {
      logger.warn('DeepSeekProvider initialized without API key');
    }
    this.apiKey = apiKey;
    this.defaultModel = resolveDeepSeekModel(defaultModel);
  }

  async classifyIntent(systemPrompt: string, message: string, allowedIntents: string[], options?: LLMRequestOptions): Promise<string | null> {
    if (!allowedIntents || allowedIntents.length === 0) return null;
    
    const temperature = options?.temperature ?? 0.1;
    const maxTokens = this.tokenLimit(options?.maxTokens, 32, 64);
    const timeoutMs = options?.timeoutMs ?? 10000;
    const model = resolveDeepSeekModel(options?.model || this.defaultModel);

    try {
      const response = await this.callApi(systemPrompt, message, temperature, maxTokens, timeoutMs, model, options);
      const intent = response.trim().replace(/^["']|["']$/g, '').replace(/[.,;:\n\r]+$/, '').trim();

      if (allowedIntents.includes(intent)) {
        return intent;
      }
      const match = allowedIntents.find(i => i.toLowerCase() === intent.toLowerCase());
      if (match) {
        return match;
      }
      return null;
    } catch (err: any) {
      if (err instanceof LLMProviderError) throw err;
      throw this.normalizeError(err);
    }
  }

  async extractField(systemPrompt: string, message: string, fieldType: string, options?: LLMRequestOptions): Promise<any | null> {
    const temperature = options?.temperature ?? 0.1;
    const maxTokens = this.tokenLimit(options?.maxTokens, 128, 256);
    const timeoutMs = options?.timeoutMs ?? 10000;
    const model = resolveDeepSeekModel(options?.model || this.defaultModel);

    try {
      const responseText = await this.callApi(systemPrompt, message, temperature, maxTokens, timeoutMs, model, options);
      
      try {
        const parsed = JSON.parse(responseText);
        if (parsed && parsed.value !== undefined) {
          return parsed.value;
        }
      } catch (e) {
        logger.warn('Failed to parse LLM JSON extraction');
      }
      return null;
    } catch (err: any) {
      if (err instanceof LLMProviderError) throw err;
      throw this.normalizeError(err);
    }
  }

  async generateResponse(systemPrompt: string, history: {role: string, content: string}[], options?: LLMRequestOptions): Promise<string> {
    const temperature = options?.temperature ?? 0.7;
    const maxTokens = this.tokenLimit(options?.maxTokens, 500, 2048);
    const timeoutMs = options?.timeoutMs ?? 15000;
    const model = resolveDeepSeekModel(options?.model || this.defaultModel);

    const formattedHistory = history.map(h => ({
      role: h.role === 'ASSISTANT' || h.role === 'assistant' ? 'assistant' : 'user',
      content: h.content
    }));
    
    try {
      return await this.callApi(systemPrompt, formattedHistory, temperature, maxTokens, timeoutMs, model, options);
    } catch (err: any) {
      if (err instanceof LLMProviderError) throw err;
      throw this.normalizeError(err);
    }
  }

  private tokenLimit(value: number | undefined, fallback: number, ceiling: number): number {
    return Number.isFinite(value) && value! > 0 ? Math.min(Math.floor(value!), ceiling) || 1 : fallback;
  }

  private async callApi(
    systemPrompt: string,
    userMessageOrHistory: string | { role: string; content: string }[],
    temperature: number,
    maxTokens: number,
    requestedTimeoutMs: number,
    model: string,
    options?: LLMRequestOptions
  ): Promise<string> {
    const messages = [{ role: 'system', content: systemPrompt },
      ...(typeof userMessageOrHistory === 'string'
        ? [{ role: 'user', content: userMessageOrHistory }] : userMessageOrHistory)];
    const timeoutMs = this.tokenLimit(requestedTimeoutMs, 15000, 30000);
    const controller = new AbortController();
    const timeoutError = () => new LLMProviderError({
      message: 'DeepSeek API Timeout or Network Failure', type: 'timeout', provider: 'deepseek'
    });
    const abort = () => controller.abort(options?.signal?.reason ?? timeoutError());
    if (options?.signal?.aborted) abort();
    options?.signal?.addEventListener('abort', abort, { once: true });
    const deadlineAt = Date.now() + timeoutMs;
    const timer = setTimeout(() => controller.abort(timeoutError()), timeoutMs);
    let usage: LLMUsage = { provider: 'deepseek', model, attempts: 0, tokenSource: 'unknown' };

    try {
      // Bound complete prompt size without truncating facts or corrupting Arabic text.
      if (messages.reduce((size, message) => size + Buffer.byteLength(message.content, 'utf8'), 0) > 65536) {
        throw new LLMProviderError({ message: 'DeepSeek request exceeds the 64 KiB input budget', type: 'invalid_response', provider: 'deepseek' });
      }
      for (let attempt = 1; attempt <= 2; attempt++) {
        if (controller.signal.aborted) throw timeoutError();
        usage.attempts = attempt;
        const response = await fetch(this.baseUrl + '/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + this.apiKey },
          body: JSON.stringify({
            model, messages, temperature, max_tokens: maxTokens,
            // Customer support classification and short grounded answers do not need
            // the current API's default high-effort thinking mode.
            thinking: { type: 'disabled' }
          }),
          signal: controller.signal
        });
        if (!response.ok) {
          const statusCode = response.status;
          // Release the body/connection before a bounded retry. Never log provider text.
          try { await response.body?.cancel(); } catch {}
          const error = new LLMProviderError({
            message: 'DeepSeek API error: ' + statusCode,
            type: statusCode === 401 || statusCode === 403 ? 'auth' : statusCode === 429 ? 'rate_limit' : 'unknown',
            provider: 'deepseek', statusCode
          });
          const retryable = [429, 500, 502, 503, 504].includes(statusCode);
          if (!retryable || attempt === 2) throw error;
          const retryAfter = response.headers?.get('retry-after');
          const parsedDelay = retryAfter
            ? (/^\d+(\.\d+)?$/.test(retryAfter) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now())
            : 1000;
          const delayMs = Number.isFinite(parsedDelay) ? Math.max(1000, parsedDelay) : 1000;
          if (delayMs + 250 >= deadlineAt - Date.now()) throw error;
          await this.delay(delayMs, controller.signal);
          continue;
        }
        const data: any = await response.json();
        const count = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
        if (count(data?.usage?.prompt_tokens) && count(data?.usage?.completion_tokens)) {
          usage = { ...usage,
            model: typeof data.model === 'string' ? data.model : model,
            tokenSource: 'provider', inputTokens: data.usage.prompt_tokens,
            outputTokens: data.usage.completion_tokens,
            cacheHitTokens: count(data.usage.prompt_cache_hit_tokens) ? data.usage.prompt_cache_hit_tokens : undefined,
            cacheMissTokens: count(data.usage.prompt_cache_miss_tokens) ? data.usage.prompt_cache_miss_tokens : undefined,
            reasoningTokens: count(data.usage.completion_tokens_details?.reasoning_tokens) ? data.usage.completion_tokens_details.reasoning_tokens : undefined
          };
        }
        if (controller.signal.aborted) throw timeoutError();
        const content = data?.choices?.[0]?.message?.content;
        if (typeof content !== 'string' || !content.trim()) {
          // A completed but unusable answer may already be billed; do not buy it again.
          throw new LLMProviderError({ message: 'Malformed DeepSeek API response: no answer content', type: 'invalid_response', provider: 'deepseek' });
        }
        return content;
      }
      throw new LLMProviderError({ message: 'DeepSeek API unreachable', type: 'unknown', provider: 'deepseek' });
    } catch (error: any) {
      // A timeout/network failure can occur after the provider has accepted work.
      // Avoid an automatic second paid generation when its billing status is unknown.
      if (controller.signal.aborted || error?.name === 'TimeoutError' || error?.name === 'AbortError' || /timeout|timed out|fetch failed/i.test(error?.message || '')) {
        throw timeoutError();
      }
      throw this.normalizeError(error);
    } finally {
      clearTimeout(timer);
      options?.signal?.removeEventListener('abort', abort);
      try { options?.onUsage?.(usage); } catch { /* Never retry due to metrics failures. */ }
    }
  }

  private normalizeError(err: any): LLMProviderError {
    if (err instanceof LLMProviderError) return err;
    return new LLMProviderError({
      message: err?.message || String(err),
      type: 'unknown',
      provider: 'deepseek',
      originalError: err
    });
  }

  private delay(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) { reject(signal.reason); return; }
      const onAbort = () => { clearTimeout(timer); reject(signal.reason); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, ms);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }
}
