import { LLMProvider, LLMRequestOptions, LLMMockProvider, LLMProviderError } from './LLMProvider';
import { DeepSeekProvider } from './DeepSeekProvider';
import { GeminiLLMProvider, DEFAULT_GEMINI_MODEL } from './GeminiLLMProvider';
import { LlmConfig } from '../../domain/tenant/BusinessConfig';
import { logger } from '../../utils/logger';

export interface ResolvedLLM {
  provider: LLMProvider;
  options: LLMRequestOptions;
}

export class LLMFactory {
  // Provider cache keyed strictly by `provider:model`
  private providerCache = new Map<string, LLMProvider>();

  constructor(
    private deepseekApiKey?: string,
    private googleApiKey?: string
  ) {}

  /**
   * Resolves an LLM provider and per-request execution options for a tenant's LlmConfig.
   * Provider instances are cached and reused strictly by (provider, model).
   */
  getProvider(config: LlmConfig): ResolvedLLM {
    const providerName = (config.provider || 'deepseek').toLowerCase();
    const model = config.model || (providerName === 'gemini' ? DEFAULT_GEMINI_MODEL : 'deepseek-chat');
    const cacheKey = `${providerName}:${model}`;

    let provider = this.providerCache.get(cacheKey);

    if (!provider) {
      if (providerName === 'gemini') {
        const apiKey = this.googleApiKey || process.env.GOOGLE_API_KEY;
        if (!apiKey) {
          throw new LLMProviderError({
            message: 'GOOGLE_API_KEY is not configured for Gemini LLM provider.',
            type: 'auth',
            provider: 'gemini'
          });
        }
        logger.info(`Instantiating new GeminiLLMProvider for cache key: "${cacheKey}"`);
        provider = new GeminiLLMProvider(apiKey, model);
      } else if (providerName === 'deepseek') {
        const apiKey = this.deepseekApiKey || process.env.DEEPSEEK_API_KEY;
        if (!apiKey || apiKey === 'dummy-key') {
          logger.warn(`DEEPSEEK_API_KEY is missing or dummy. Falling back to LLMMockProvider for "${cacheKey}".`);
          provider = new LLMMockProvider();
        } else {
          logger.info(`Instantiating new DeepSeekProvider for cache key: "${cacheKey}"`);
          provider = new DeepSeekProvider(apiKey, model);
        }
      } else if (providerName === 'mock') {
        provider = new LLMMockProvider();
      } else {
        throw new LLMProviderError({
          message: `Unsupported LLM provider requested: "${config.provider}"`,
          type: 'invalid_response',
          provider: providerName
        });
      }

      this.providerCache.set(cacheKey, provider);
    }

    const options: LLMRequestOptions = {
      model,
      temperature: config.temperature,
      maxTokens: config.maxTokens,
      timeoutMs: config.timeoutMs
    };

    return { provider, options };
  }

  /**
   * Manually register or mock a provider for testing.
   */
  registerProvider(providerName: string, model: string, instance: LLMProvider): void {
    const cacheKey = `${providerName.toLowerCase()}:${model}`;
    this.providerCache.set(cacheKey, instance);
  }

  /**
   * Clears the cached provider instances.
   */
  clearCache(): void {
    this.providerCache.clear();
  }

  /**
   * Returns the count of cached provider instances (for test assertion).
   */
  getCachedCount(): number {
    return this.providerCache.size;
  }
}
