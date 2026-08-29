import { LLMProvider, LLMProviderError, LLMRequestOptions } from './LLMProvider';
import { logger } from '../../utils/logger';

export class DeepSeekProvider implements LLMProvider {
  private apiKey: string;
  private defaultModel: string;
  private baseUrl: string = 'https://api.deepseek.com/v1';

  constructor(apiKey: string, defaultModel: string = 'deepseek-chat') {
    if (!apiKey) {
      logger.warn('DeepSeekProvider initialized without API key');
    }
    this.apiKey = apiKey;
    this.defaultModel = defaultModel;
  }

  async classifyIntent(systemPrompt: string, message: string, allowedIntents: string[], options?: LLMRequestOptions): Promise<string | null> {
    if (!allowedIntents || allowedIntents.length === 0) return null;
    
    const temperature = options?.temperature ?? 0.1;
    const maxTokens = options?.maxTokens ?? 10;
    const timeoutMs = options?.timeoutMs ?? 10000;
    const model = options?.model || this.defaultModel;

    try {
      const response = await this.callApi(systemPrompt, message, temperature, maxTokens, 3, timeoutMs, model);
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
    const maxTokens = options?.maxTokens ?? 50;
    const timeoutMs = options?.timeoutMs ?? 10000;
    const model = options?.model || this.defaultModel;

    try {
      const responseText = await this.callApi(systemPrompt, message, temperature, maxTokens, 3, timeoutMs, model);
      
      try {
        const parsed = JSON.parse(responseText);
        if (parsed && parsed.value !== undefined) {
          return parsed.value;
        }
      } catch (e) {
        logger.warn('Failed to parse LLM JSON extraction', { responseText });
      }
      return null;
    } catch (err: any) {
      if (err instanceof LLMProviderError) throw err;
      throw this.normalizeError(err);
    }
  }

  async generateResponse(systemPrompt: string, history: {role: string, content: string}[], options?: LLMRequestOptions): Promise<string> {
    const temperature = options?.temperature ?? 0.7;
    const maxTokens = options?.maxTokens ?? 500;
    const timeoutMs = options?.timeoutMs ?? 15000;
    const model = options?.model || this.defaultModel;

    const formattedHistory = history.map(h => ({
      role: h.role === 'ASSISTANT' || h.role === 'assistant' ? 'assistant' : 'user',
      content: h.content
    }));
    
    try {
      return await this.callApi(systemPrompt, formattedHistory, temperature, maxTokens, 3, timeoutMs, model);
    } catch (err: any) {
      if (err instanceof LLMProviderError) throw err;
      throw this.normalizeError(err);
    }
  }

  private async callApi(
    systemPrompt: string,
    userMessageOrHistory: string | any[],
    temperature: number,
    maxTokens: number,
    maxRetries: number,
    timeoutMs: number,
    model: string
  ): Promise<string> {
    const messages = [{ role: 'system', content: systemPrompt }];
    
    if (typeof userMessageOrHistory === 'string') {
      messages.push({ role: 'user', content: userMessageOrHistory });
    } else {
      messages.push(...userMessageOrHistory);
    }

    let attempt = 0;
    while (attempt < maxRetries) {
      attempt++;
      try {
        const response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`
          },
          body: JSON.stringify({
            model,
            messages,
            temperature,
            max_tokens: maxTokens
          }),
          signal: AbortSignal.timeout(timeoutMs)
        });

        if (!response.ok) {
          let errorText = '';
          if (typeof response.text === 'function') {
            try { errorText = await response.text(); } catch (_) {}
          }
          const statusCode = response.status;
          
          if (statusCode === 401 || statusCode === 403) {
            throw new LLMProviderError({
              message: `DeepSeek authentication failed (${statusCode}): ${errorText}`,
              type: 'auth',
              provider: 'deepseek',
              statusCode
            });
          }

          if (statusCode === 429) {
            logger.warn('DeepSeek rate limit reached', { attempt });
            if (attempt >= maxRetries) {
              throw new LLMProviderError({
                message: `DeepSeek rate limit reached (${statusCode}): ${errorText}`,
                type: 'rate_limit',
                provider: 'deepseek',
                statusCode
              });
            }
            await this.delay(1000 * attempt);
            continue;
          }

          const statusSuffix = response.statusText ? ` ${response.statusText}` : '';
          throw new LLMProviderError({
            message: `DeepSeek API error: ${statusCode}${statusSuffix}`,
            type: 'unknown',
            provider: 'deepseek',
            statusCode
          });
        }

        const data: any = await response.json();
        
        if (!data.choices || data.choices.length === 0 || !data.choices[0].message) {
          throw new LLMProviderError({
            message: `Malformed DeepSeek API response: ${JSON.stringify(data)}`,
            type: 'invalid_response',
            provider: 'deepseek',
            originalError: data
          });
        }

        return data.choices[0].message.content;
      } catch (error: any) {
        if (error instanceof LLMProviderError) {
          if (error.type === 'auth') throw error;
        }

        const isTimeout = error.name === 'TimeoutError' || (error.message && (error.message.includes('timeout') || error.message.includes('fetch failed')));
        if (isTimeout) {
          logger.warn(`DeepSeek API connection timed out (Attempt ${attempt})`, { message: error.message });
          if (attempt >= maxRetries) {
            throw new LLMProviderError({
              message: `DeepSeek API Timeout or Network Failure (timed out after ${timeoutMs}ms)`,
              type: 'timeout',
              provider: 'deepseek',
              originalError: error
            });
          }
          await this.delay(1000 * attempt);
          continue;
        }
        
        if (attempt >= maxRetries) {
          logger.error('DeepSeek API max retries exhausted');
          throw this.normalizeError(error);
        }
        await this.delay(1000 * attempt);
      }
    }
    
    throw new LLMProviderError({
      message: 'DeepSeek API unreachable',
      type: 'unknown',
      provider: 'deepseek'
    });
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

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
