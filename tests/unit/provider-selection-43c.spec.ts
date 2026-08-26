import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LLMFactory } from '../../src/core/llm/LLMFactory';
import { LLMMockProvider } from '../../src/core/llm/LLMProvider';
import { MockEmbeddingProvider, GeminiEmbeddingProvider } from '../../src/core/rag/EmbeddingProvider';
import { bootstrapChatbot } from '../../src/bootstrap';
import { prisma } from '../../src/tests/testDb';

describe('PHASE DEV-COST-FIX-43C: Provider Selection & Mock-by-Default Infrastructure', () => {
  const originalUseRealAi = process.env.USE_REAL_AI;
  const originalGoogleKey = process.env.GOOGLE_API_KEY;
  const originalDeepseekKey = process.env.DEEPSEEK_API_KEY;

  beforeEach(() => {
    delete process.env.USE_REAL_AI;
    process.env.GOOGLE_API_KEY = 'test-fake-google-key';
    process.env.DEEPSEEK_API_KEY = 'test-fake-deepseek-key';
  });

  afterEach(() => {
    if (originalUseRealAi !== undefined) {
      process.env.USE_REAL_AI = originalUseRealAi;
    } else {
      delete process.env.USE_REAL_AI;
    }
    process.env.GOOGLE_API_KEY = originalGoogleKey;
    process.env.DEEPSEEK_API_KEY = originalDeepseekKey;
  });

  it('1. Test environment resolves LLMMockProvider by default despite active API keys in env', () => {
    const factory = new LLMFactory(process.env.DEEPSEEK_API_KEY, process.env.GOOGLE_API_KEY);
    const resolved = factory.getProvider({ provider: 'deepseek', model: 'deepseek-chat' });

    expect(resolved.provider).toBeInstanceOf(LLMMockProvider);
  });

  it('2. Test environment resolves MockEmbeddingProvider by default in bootstrapChatbot', () => {
    const deps = bootstrapChatbot(prisma);

    expect((deps.ragService as any).embeddingProvider).toBeInstanceOf(MockEmbeddingProvider);
  });

  it('3. Explicit USE_REAL_AI="true" opts into live provider instantiation', () => {
    process.env.USE_REAL_AI = 'true';

    const factory = new LLMFactory(process.env.DEEPSEEK_API_KEY, process.env.GOOGLE_API_KEY);
    const resolved = factory.getProvider({ provider: 'deepseek', model: 'deepseek-chat' });

    // Should instantiate real DeepSeekProvider when USE_REAL_AI=true
    expect(resolved.provider).not.toBeInstanceOf(LLMMockProvider);
    expect(resolved.provider.constructor.name).toBe('DeepSeekProvider');
  });

  it('4. MockEmbeddingProvider generates valid normalized embedding vectors matching provider contract', async () => {
    const mock = new MockEmbeddingProvider();
    const vec1 = await mock.embedText('Shipping policy details for Morocco');
    const vec2 = await mock.embedText('Return policy 14 days');

    expect(Array.isArray(vec1)).toBe(true);
    expect(vec1.length).toBe(3072);
    expect(Array.isArray(vec2)).toBe(true);
    expect(vec2.length).toBe(3072);

    // Magnitude should be normalized to ~1.0
    const mag = Math.sqrt(vec1.reduce((sum, v) => sum + v * v, 0));
    expect(mag).toBeCloseTo(1.0, 4);

    // Custom dimension contract
    const customMock = new MockEmbeddingProvider(1536);
    const customVec = await customMock.embedText('Custom dimension test');
    expect(customVec.length).toBe(1536);
  });

  it('5. LLMMockProvider tracks call count and supports custom response resolvers', async () => {
    const mock = new LLMMockProvider();
    mock.responseResolver = (systemPrompt, history) => `Resolved for ${history[0].content}`;

    const res = await mock.generateResponse('sys', [{ role: 'user', content: 'test message' }]);
    expect(res).toBe('Resolved for test message');
    expect(mock.callCount).toBe(1);
  });
});
