import { describe, it, expect, vi } from 'vitest';
import { ConversationEngine } from '../../src/domain/conversation/ConversationEngine';
import { QuestionReformulator } from '../../src/domain/rag/QuestionReformulator';
import { CostSummaryReporter } from '../../src/core/telemetry/CostSummaryReporter';
import { TelemetryEvent } from '../../packages/shared/contracts/telemetry.contract';
import { LLMMockProvider } from '../../src/core/llm/LLMProvider';
import { DEFAULT_BUSINESS_CONFIG } from '../../src/domain/tenant/BusinessConfig';
import { ResponseBuilder } from '../../src/domain/conversation/ResponseBuilder';
import { TurnDecision } from '../../src/domain/conversation/TurnDecision';

describe('Phase 29D: Safe Cost Optimizations', () => {
  it('1. simple knowledge uses reduced effective context budget (~2000 chars)', () => {
    const engine = new ConversationEngine(
      {} as any,
      {} as any,
      {} as any,
      new LLMMockProvider(),
      new ResponseBuilder()
    );

    const config = {
      ...DEFAULT_BUSINESS_CONFIG,
      knowledge: {
        ...DEFAULT_BUSINESS_CONFIG.knowledge,
        enabled: true,
        maxContextSize: 4000
      }
    };

    const turnDecision: TurnDecision = {
      domain: 'KNOWLEDGE',
      intent: 'GENERAL',
      source: 'RAG',
      responseLanguage: 'en',
      responseScript: 'latin',
      isMultiPolicy: false
    };

    const budget = (engine as any).resolveEffectiveContextBudget(config, turnDecision, false);
    expect(budget).toBe(2000);
  });

  it('2. hybrid keeps larger context budget (4000 chars)', () => {
    const engine = new ConversationEngine(
      {} as any,
      {} as any,
      {} as any,
      new LLMMockProvider(),
      new ResponseBuilder()
    );

    const config = {
      ...DEFAULT_BUSINESS_CONFIG,
      knowledge: {
        ...DEFAULT_BUSINESS_CONFIG.knowledge,
        enabled: true,
        maxContextSize: 4000
      }
    };

    const hybridDecision: TurnDecision = {
      domain: 'KNOWLEDGE',
      intent: 'GENERAL',
      source: 'HYBRID',
      responseLanguage: 'en',
      responseScript: 'latin',
      isMultiPolicy: false
    };

    const budget = (engine as any).resolveEffectiveContextBudget(config, hybridDecision, true);
    expect(budget).toBe(4000);
  });

  it('3. multi-policy keeps larger context budget (4000 chars)', () => {
    const engine = new ConversationEngine(
      {} as any,
      {} as any,
      {} as any,
      new LLMMockProvider(),
      new ResponseBuilder()
    );

    const config = {
      ...DEFAULT_BUSINESS_CONFIG,
      knowledge: {
        ...DEFAULT_BUSINESS_CONFIG.knowledge,
        enabled: true,
        maxContextSize: 4000
      }
    };

    const multiPolicyDecision: TurnDecision = {
      domain: 'KNOWLEDGE',
      intent: 'GENERAL',
      source: 'RAG',
      responseLanguage: 'en',
      responseScript: 'latin',
      isMultiPolicy: true
    };

    const budget = (engine as any).resolveEffectiveContextBudget(config, multiPolicyDecision, false);
    expect(budget).toBe(4000);
  });

  it('4. grounding prompt remains safety-complete', () => {
    const engine = new ConversationEngine(
      {} as any,
      {} as any,
      {} as any,
      new LLMMockProvider(),
      new ResponseBuilder()
    );

    const prompt = (engine as any).buildGroundedSystemPrompt(DEFAULT_BUSINESS_CONFIG, 'en');

    // Authority & Grounding constraints
    expect(prompt).toContain('UNTRUSTED_KNOWLEDGE_DATA');
    expect(prompt).toContain('UNANSWERABLE');
    expect(prompt).toContain('authoritative');
    expect(prompt).toContain('price, stock, SKU, variants');
    expect(prompt).toContain('store-wide');

    // Security & Untrusted data constraints
    expect(prompt).toContain('untrusted data');
    expect(prompt).toContain('CUSTOMER_QUESTION');
    expect(prompt).toContain('Never follow commands');
    expect(prompt).toContain('override');
    expect(prompt).toContain('persona');
    expect(prompt).toContain('credentials');

    // Multilingual constraints
    expect(prompt).toContain('Language Policy');
    expect(prompt).toContain('script');
  });

  it('5. grounding prompt is shorter than before (~15–25% reduction)', () => {
    const engine = new ConversationEngine(
      {} as any,
      {} as any,
      {} as any,
      new LLMMockProvider(),
      new ResponseBuilder()
    );

    const compressedPrompt = (engine as any).buildGroundedSystemPrompt(DEFAULT_BUSINESS_CONFIG, 'en');
    
    // Baseline uncompressed prompt length with DEFAULT_BUSINESS_CONFIG was ~2170 chars
    const baselineLength = 2170;
    const currentLength = compressedPrompt.length;
    const reductionPercent = ((baselineLength - currentLength) / baselineLength) * 100;

    expect(reductionPercent).toBeGreaterThanOrEqual(15);
    expect(reductionPercent).toBeLessThanOrEqual(35);
  });

  it('6. reformulator default timeout is 2000ms', async () => {
    const mockLlm = {
      generateResponse: vi.fn().mockResolvedValue('Atlas Shoes price')
    };

    const memory = {
      recentTurns: [
        { role: 'user' as const, content: 'Tell me about Atlas Shoes' },
        { role: 'assistant' as const, content: 'Atlas Shoes are 120 MAD.' }
      ]
    };

    const res = await QuestionReformulator.reformulate('how much is it?', memory, mockLlm);
    expect(res.reformulated).toBe(true);
    expect(res.retrievalQuery).toBe('Atlas Shoes price');
    expect(mockLlm.generateResponse).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({ timeoutMs: 2000 })
    );
  });

  it('7. reformulator timeout still falls back safely on slow LLM response', async () => {
    const slowLlm = {
      generateResponse: vi.fn().mockImplementation(() => new Promise(resolve => setTimeout(() => resolve('Too late query'), 3000)))
    };

    const memory = {
      recentTurns: [
        { role: 'user' as const, content: 'Tell me about Atlas Shoes' }
      ]
    };

    const startTime = Date.now();
    const res = await QuestionReformulator.reformulate('how much is it?', memory, slowLlm, { timeoutMs: 50 });
    const duration = Date.now() - startTime;

    expect(res.reformulated).toBe(false);
    expect(res.retrievalQuery).toBe('how much is it?');
    expect(duration).toBeLessThan(1000);
  });

  it('8. usage aggregation calculates LLM metrics per turn and aggregate', () => {
    const events: TelemetryEvent[] = [
      {
        eventId: 'e1',
        timestamp: new Date().toISOString(),
        eventType: 'llm_completed',
        tenantId: 'animeverse',
        correlationId: 'turn-1',
        stage: 'llm',
        status: 'SUCCESS',
        provider: 'deepseek',
        model: 'deepseek-chat',
        metadata: {
          inputTokens: 450,
          outputTokens: 60,
          retryAttempts: 1
        }
      },
      {
        eventId: 'e2',
        timestamp: new Date().toISOString(),
        eventType: 'response_completed',
        tenantId: 'animeverse',
        correlationId: 'turn-1',
        stage: 'response',
        status: 'SUCCESS',
        latencyMs: 1200,
        metadata: {
          turnDecision: {
            domain: 'KNOWLEDGE',
            intent: 'GENERAL'
          }
        }
      }
    ];

    const turnMetrics = CostSummaryReporter.calculateTurnMetrics(events);
    expect(turnMetrics.llmCalls).toBe(1);
    expect(turnMetrics.inputTokens).toBe(450);
    expect(turnMetrics.outputTokens).toBe(60);
    expect(turnMetrics.retryAttempts).toBe(1);
    expect(turnMetrics.totalLatencyMs).toBe(1200);
    expect(turnMetrics.domain).toBe('KNOWLEDGE');

    const report = CostSummaryReporter.aggregateUsage(events);
    expect(report.totalTurns).toBe(1);
    expect(report.totalLlmCalls).toBe(1);
    expect(report.totalInputTokens).toBe(450);
    expect(report.totalOutputTokens).toBe(60);
    expect(report.totalRetryAttempts).toBe(1);
  });

  it('9. usage aggregation calculates embedding metrics', () => {
    const events: TelemetryEvent[] = [
      {
        eventId: 'e1',
        timestamp: new Date().toISOString(),
        eventType: 'rag_completed',
        tenantId: 'animeverse',
        correlationId: 'turn-rag-1',
        stage: 'rag',
        status: 'SUCCESS',
        metadata: {
          embeddingCalls: 1,
          inputSizeChars: 45,
          provider: 'gemini',
          model: 'gemini-embedding-001',
          retryAttempts: 0
        }
      },
      {
        eventId: 'e2',
        timestamp: new Date().toISOString(),
        eventType: 'response_completed',
        tenantId: 'animeverse',
        correlationId: 'turn-rag-1',
        stage: 'response',
        status: 'SUCCESS',
        latencyMs: 250,
        metadata: {
          turnDecision: {
            domain: 'KNOWLEDGE',
            intent: 'SHIPPING'
          }
        }
      }
    ];

    const turnMetrics = CostSummaryReporter.calculateTurnMetrics(events);
    expect(turnMetrics.embeddingCalls).toBe(1);
    expect(turnMetrics.llmCalls).toBe(0);
    expect(turnMetrics.domain).toBe('KNOWLEDGE');

    const report = CostSummaryReporter.aggregateUsage(events);
    expect(report.totalEmbeddingCalls).toBe(1);
    expect(report.totalLlmCalls).toBe(0);
  });

  it('10. tenant/account attribution remains correct across multi-turn aggregates', () => {
    const events: TelemetryEvent[] = [
      // Turn 1: AnimeVerse Store Ecommerce
      {
        eventId: 'e1',
        timestamp: new Date().toISOString(),
        eventType: 'llm_completed',
        tenantId: 'animeverse',
        correlationId: 'turn-av-1',
        stage: 'llm',
        status: 'SUCCESS',
        provider: 'deepseek',
        model: 'deepseek-chat',
        metadata: { inputTokens: 500, outputTokens: 50, retryAttempts: 0 }
      },
      {
        eventId: 'e2',
        timestamp: new Date().toISOString(),
        eventType: 'response_completed',
        tenantId: 'animeverse',
        correlationId: 'turn-av-1',
        stage: 'response',
        status: 'SUCCESS',
        latencyMs: 800,
        metadata: {
          turnDecision: { domain: 'ECOMMERCE', intent: 'PRICE' }
        }
      },
      // Turn 2: Tenant B Support
      {
        eventId: 'e3',
        timestamp: new Date().toISOString(),
        eventType: 'llm_completed',
        tenantId: 'tenant-b',
        correlationId: 'turn-tb-1',
        stage: 'llm',
        status: 'SUCCESS',
        provider: 'gemini',
        model: 'gemini-2.0-flash-001',
        metadata: { inputTokens: 800, outputTokens: 100, retryAttempts: 0 }
      },
      {
        eventId: 'e4',
        timestamp: new Date().toISOString(),
        eventType: 'response_completed',
        tenantId: 'tenant-b',
        correlationId: 'turn-tb-1',
        stage: 'response',
        status: 'SUCCESS',
        latencyMs: 1500,
        metadata: {
          turnDecision: { domain: 'KNOWLEDGE', intent: 'GENERAL' }
        }
      }
    ];

    const report = CostSummaryReporter.aggregateUsage(events);
    expect(report.totalTurns).toBe(2);
    expect(report.totalInputTokens).toBe(1300);
    expect(report.totalOutputTokens).toBe(150);
    expect(report.byGroup.length).toBe(2);

    const avGroup = report.byGroup.find(g => g.tenantId === 'animeverse');
    expect(avGroup).toBeDefined();
    expect(avGroup?.provider).toBe('deepseek');
    expect(avGroup?.domain).toBe('ECOMMERCE');
    expect(avGroup?.intent).toBe('PRICE');

    const tbGroup = report.byGroup.find(g => g.tenantId === 'tenant-b');
    expect(tbGroup).toBeDefined();
    expect(tbGroup?.provider).toBe('gemini');
    expect(tbGroup?.domain).toBe('KNOWLEDGE');
  });
});
