import { describe, it, expect, beforeAll } from 'vitest';
import { bootstrapChatbot } from '../../src/bootstrap';
import { prisma } from '../../src/tests/testDb';
import { LLMMockProvider } from '../../src/core/llm/LLMProvider';
import { MockEmbeddingProvider } from '../../src/core/rag/EmbeddingProvider';
import { FaqKnowledgeAdapter } from '../../src/domain/rag/FaqKnowledgeAdapter';

describe('PHASE DEV-COST-FIX-43C: Live AI Opt-In Smoke Test (USE_REAL_AI=true)', () => {
  const tenantId = 'animeverse';
  const accountId = 'animeverse-store';
  let deps: ReturnType<typeof bootstrapChatbot>;

  beforeAll(async () => {
    process.env.USE_REAL_AI = 'true';
    deps = bootstrapChatbot(prisma);
    const config = await deps.tenantConfigService.getConfig(tenantId);
    if (config.capabilities?.faq && config.capabilities.faq.length > 0) {
      await FaqKnowledgeAdapter.syncTenantFaqs(
        tenantId, null, config.capabilities.faq,
        deps.knowledgeRepository,
        (deps.ragService as any).embeddingProvider,
        prisma
      );
    }
  }, 30000);

  it('1. Verifies live LLM provider is active when USE_REAL_AI=true', () => {
    const resolved = deps.llmFactory.getProvider({ provider: 'deepseek', model: 'deepseek-chat' });

    expect(resolved.provider).not.toBeInstanceOf(LLMMockProvider);
    expect(resolved.provider.constructor.name).toBe('DeepSeekProvider');
  });

  it('2. Verifies live Gemini Embedding Provider is active when USE_REAL_AI=true', () => {
    expect((deps.ragService as any).embeddingProvider).not.toBeInstanceOf(MockEmbeddingProvider);
    expect((deps.ragService as any).embeddingProvider.constructor.name).toBe('GeminiEmbeddingProvider');
  });

  it('3. End-to-end live question answering succeeds with real provider when opted in', async () => {
    const cid = `43c-smoke-${Date.now()}`;
    const resp = await deps.conversationEngine.handleMessage(tenantId, cid, 'How much is shipping in Morocco?', accountId);

    expect(resp).toMatch(/30/);
  }, 20000);
});
