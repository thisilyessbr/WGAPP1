import { describe, it, expect, beforeEach } from 'vitest';
import { LLMFactory } from '../../src/core/llm/LLMFactory';
import { GeminiLLMProvider } from '../../src/core/llm/GeminiLLMProvider';
import { DeepSeekProvider } from '../../src/core/llm/DeepSeekProvider';
import { LLMProviderError } from '../../src/core/llm/LLMProvider';

describe('LLMFactory & Error Normalization Integration Tests', () => {
  let factory: LLMFactory;

  beforeEach(() => {
    factory = new LLMFactory('test-deepseek-key', 'test-google-key');
  });

  describe('1. Lifecycle & Instance Caching', () => {
    it('caches provider instances strictly by (provider, model) and reuses instance across different temperatures/tenants', () => {
      const configTenantA = {
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        temperature: 0.1,
        maxTokens: 500,
        timeoutMs: 5000
      };

      const configTenantB = {
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        temperature: 0.9,
        maxTokens: 1500,
        timeoutMs: 20000
      };

      const resolvedA = factory.getProvider(configTenantA);
      const resolvedB = factory.getProvider(configTenantB);

      // Both tenants MUST share the exact same HTTP client provider instance
      expect(resolvedA.provider).toBe(resolvedB.provider);
      expect(resolvedA.provider).toBeInstanceOf(GeminiLLMProvider);
      expect(factory.getCachedCount()).toBe(1);

      // Per-call options must remain isolated per request
      expect(resolvedA.options.temperature).toBe(0.1);
      expect(resolvedA.options.maxTokens).toBe(500);
      expect(resolvedA.options.timeoutMs).toBe(5000);

      expect(resolvedB.options.temperature).toBe(0.9);
      expect(resolvedB.options.maxTokens).toBe(1500);
      expect(resolvedB.options.timeoutMs).toBe(20000);
    });

    it('creates separate cached instances for different providers or models', () => {
      const geminiConfig = {
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        temperature: 0.2,
        maxTokens: 1000,
        timeoutMs: 15000
      };

      const deepseekConfig = {
        provider: 'deepseek',
        model: 'deepseek-chat',
        temperature: 0.7,
        maxTokens: 1000,
        timeoutMs: 15000
      };

      const geminiProConfig = {
        provider: 'gemini',
        model: 'gemini-1.5-pro',
        temperature: 0.2,
        maxTokens: 1000,
        timeoutMs: 15000
      };

      const resolved1 = factory.getProvider(geminiConfig);
      const resolved2 = factory.getProvider(deepseekConfig);
      const resolved3 = factory.getProvider(geminiProConfig);

      expect(resolved1.provider).not.toBe(resolved2.provider);
      expect(resolved1.provider).not.toBe(resolved3.provider);
      expect(factory.getCachedCount()).toBe(3);
    });
  });

  describe('2. Error Normalization', () => {
    it('normalizes forced auth failure into LLMProviderError with type: "auth"', async () => {
      const invalidGemini = new GeminiLLMProvider('AIzaSyInvalidKeyFakeForTest123456');
      
      try {
        await invalidGemini.generateResponse('System prompt', [{ role: 'user', content: 'Hello' }]);
        expect.unreachable('Should have thrown an auth error');
      } catch (err: any) {
        expect(err).toBeInstanceOf(LLMProviderError);
        expect(err.type).toBe('auth');
        expect(err.provider).toBe('gemini');
        expect(err.statusCode).toBe(400); // Bad Request / API key invalid
      }
    });

    it('normalizes forced timeout into LLMProviderError with type: "timeout"', async () => {
      const gemini = new GeminiLLMProvider(process.env.GOOGLE_API_KEY || 'fake-key');
      
      try {
        // Force an impossibly short timeout of 1ms
        await gemini.generateResponse('System prompt', [{ role: 'user', content: 'Hello' }], { timeoutMs: 1 });
        expect.unreachable('Should have timed out');
      } catch (err: any) {
        expect(err).toBeInstanceOf(LLMProviderError);
        expect(err.type).toBe('timeout');
        expect(err.provider).toBe('gemini');
      }
    });

    it('normalizes DeepSeek forced timeout into LLMProviderError with type: "timeout"', async () => {
      const deepseek = new DeepSeekProvider('dummy-key');
      
      try {
        await deepseek.generateResponse('System prompt', [{ role: 'user', content: 'Hello' }], { timeoutMs: 1 });
        expect.unreachable('Should have timed out');
      } catch (err: any) {
        expect(err).toBeInstanceOf(LLMProviderError);
        expect(err.type).toBe('timeout');
        expect(err.provider).toBe('deepseek');
      }
    });
  });
});
