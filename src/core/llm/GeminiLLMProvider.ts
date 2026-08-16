import { LLMProvider, LLMProviderError, LLMRequestOptions } from './LLMProvider';
import { logger } from '../../utils/logger';

/**
 * Pinned default Gemini model version.
 * '-latest' aliases can silently repoint to a different underlying model with a different
 * (and possibly much lower) quota, as happened with gemini-flash-latest silently becoming
 * gemini-3.7-flash (which has a 20 req/day free-tier cap).
 * An environment override remains available via process.env.LLM_MODEL.
 */
export const DEFAULT_GEMINI_MODEL = process.env.LLM_MODEL || 'gemini-2.0-flash-001';

export class GeminiLLMProvider implements LLMProvider {
  private apiKey: string;
  private defaultModel: string;
  private baseUrl: string = 'https://generativelanguage.googleapis.com/v1beta/models';

  constructor(apiKey: string, defaultModel?: string) {
    if (!apiKey) {
      throw new LLMProviderError({
        message: 'Gemini API key is required.',
        type: 'auth',
        provider: 'gemini'
      });
    }
    this.apiKey = apiKey;
    this.defaultModel = defaultModel || DEFAULT_GEMINI_MODEL;
  }

  async classifyIntent(systemPrompt: string, message: string, allowedIntents: string[], options?: LLMRequestOptions): Promise<string | null> {
    if (!allowedIntents || allowedIntents.length === 0) return null;

    const temperature = options?.temperature ?? 0.1;
    const maxTokens = options?.maxTokens ?? 30;
    const timeoutMs = options?.timeoutMs ?? 10000;
    const model = options?.model || this.defaultModel;

    try {
      const responseText = await this.callApiWithRetry({
        systemPrompt,
        contents: [{ role: 'user', parts: [{ text: message }] }],
        model,
        temperature,
        maxTokens,
        timeoutMs
      });

      const intent = responseText.trim().replace(/^["']|["']$/g, '');
      if (allowedIntents.includes(intent)) {
        return intent;
      }
      return null;
    } catch (err: any) {
      if (err instanceof LLMProviderError) throw err;
      throw this.normalizeError(err);
    }
  }

  async extractField(systemPrompt: string, message: string, fieldType: string, options?: LLMRequestOptions): Promise<any | null> {
    const temperature = options?.temperature ?? 0.1;
    const maxTokens = options?.maxTokens ?? 150;
    const timeoutMs = options?.timeoutMs ?? 10000;
    const model = options?.model || this.defaultModel;

    try {
      const responseText = await this.callApiWithRetry({
        systemPrompt,
        contents: [{ role: 'user', parts: [{ text: message }] }],
        model,
        temperature,
        maxTokens,
        timeoutMs,
        responseMimeType: 'application/json'
      });

      try {
        const parsed = JSON.parse(responseText);
        if (parsed && parsed.value !== undefined) {
          return parsed.value;
        }
      } catch (jsonErr) {
        logger.warn('Failed to parse Gemini JSON extraction', { responseText });
      }
      return null;
    } catch (err: any) {
      if (err instanceof LLMProviderError) throw err;
      throw this.normalizeError(err);
    }
  }

  async generateResponse(systemPrompt: string, history: { role: string; content: string }[], options?: LLMRequestOptions): Promise<string> {
    const temperature = options?.temperature ?? 0.7;
    const maxTokens = options?.maxTokens ?? 1000;
    const timeoutMs = options?.timeoutMs ?? 15000;
    const model = options?.model || this.defaultModel;

    const contents = history.map(h => ({
      role: h.role === 'ASSISTANT' || h.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: h.content }]
    }));

    try {
      return await this.callApiWithRetry({
        systemPrompt,
        contents,
        model,
        temperature,
        maxTokens,
        timeoutMs
      });
    } catch (err: any) {
      if (err instanceof LLMProviderError) throw err;
      throw this.normalizeError(err);
    }
  }

  private async callApiWithRetry(params: {
    systemPrompt: string;
    contents: any[];
    model: string;
    temperature: number;
    maxTokens: number;
    timeoutMs: number;
    responseMimeType?: string;
  }): Promise<string> {
    const maxRetries = 3;
    let attempt = 0;

    while (attempt < maxRetries) {
      attempt++;
      try {
        return await this.callApi(params);
      } catch (err: any) {
        if (err instanceof LLMProviderError && (err.type === 'auth' || err.statusCode === 404)) {
          throw err; // Non-retryable
        }

        const isTransient = err.type === 'rate_limit' || err.type === 'timeout' || err.statusCode === 503 || err.statusCode === 500;
        if (isTransient && attempt < maxRetries) {
          logger.warn(`Gemini API transient failure (Attempt ${attempt}/${maxRetries}): ${err.message}. Retrying...`);
          await new Promise(r => setTimeout(r, 1000 * attempt));
          continue;
        }

        throw err;
      }
    }

    throw new LLMProviderError({
      message: 'Gemini API max retries exhausted',
      type: 'unknown',
      provider: 'gemini'
    });
  }

  private async callApi(params: {
    systemPrompt: string;
    contents: any[];
    model: string;
    temperature: number;
    maxTokens: number;
    timeoutMs: number;
    responseMimeType?: string;
  }): Promise<string> {
    const url = `${this.baseUrl}/${params.model}:generateContent?key=${this.apiKey}`;
    
    const body: any = {
      contents: params.contents,
      generationConfig: {
        temperature: params.temperature,
        maxOutputTokens: params.maxTokens
      }
    };

    if (params.systemPrompt) {
      body.system_instruction = {
        parts: [{ text: params.systemPrompt }]
      };
    }

    if (params.responseMimeType) {
      body.generationConfig.responseMimeType = params.responseMimeType;
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(params.timeoutMs)
      });
    } catch (fetchErr: any) {
      if (fetchErr.name === 'TimeoutError' || (fetchErr.message && fetchErr.message.includes('timeout'))) {
        throw new LLMProviderError({
          message: `Gemini API request timed out after ${params.timeoutMs}ms`,
          type: 'timeout',
          provider: 'gemini',
          originalError: fetchErr
        });
      }
      throw new LLMProviderError({
        message: `Gemini API network connection failed: ${fetchErr.message}`,
        type: 'unknown',
        provider: 'gemini',
        originalError: fetchErr
      });
    }

    if (!response.ok) {
      const errorText = await response.text();
      let errorData: any = {};
      try { errorData = JSON.parse(errorText); } catch (_) {}

      const statusCode = response.status;
      if (
        statusCode === 401 ||
        statusCode === 403 ||
        errorText.includes('API_KEY_INVALID') ||
        errorText.includes('PERMISSION_DENIED') ||
        errorText.toLowerCase().includes('api key') ||
        errorText.includes('INVALID_ARGUMENT')
      ) {
        throw new LLMProviderError({
          message: `Gemini API authentication failed (${statusCode}): ${errorText}`,
          type: 'auth',
          provider: 'gemini',
          statusCode,
          originalError: errorData
        });
      }

      if (statusCode === 429 || errorText.includes('RESOURCE_EXHAUSTED')) {
        throw new LLMProviderError({
          message: `Gemini API rate limit exceeded (${statusCode}): ${errorText}`,
          type: 'rate_limit',
          provider: 'gemini',
          statusCode,
          originalError: errorData
        });
      }

      throw new LLMProviderError({
        message: `Gemini API error (${statusCode}): ${errorText}`,
        type: 'unknown',
        provider: 'gemini',
        statusCode,
        originalError: errorData
      });
    }

    const data: any = await response.json();
    const candidate = data.candidates?.[0];
    const textPart = candidate?.content?.parts?.[0]?.text;

    if (textPart === undefined || textPart === null) {
      throw new LLMProviderError({
        message: `Malformed Gemini response: no text returned in candidate parts (${JSON.stringify(data)})`,
        type: 'invalid_response',
        provider: 'gemini',
        originalError: data
      });
    }

    return textPart;
  }

  private normalizeError(err: any): LLMProviderError {
    if (err instanceof LLMProviderError) return err;
    return new LLMProviderError({
      message: err?.message || String(err),
      type: 'unknown',
      provider: 'gemini',
      originalError: err
    });
  }
}
