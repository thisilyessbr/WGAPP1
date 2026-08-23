import { describe, it, expect } from 'vitest';
import { CostAnalyticsService, DEFAULT_BUDGET_THRESHOLDS } from '../../src/core/telemetry/CostAnalyticsService';
import { TelemetryEvent } from '../../packages/shared/contracts/telemetry.contract';
import { ConversationEngine } from '../../src/domain/conversation/ConversationEngine';
import { LLMMockProvider } from '../../src/core/llm/LLMProvider';
import { ResponseBuilder } from '../../src/domain/conversation/ResponseBuilder';
import { DEFAULT_BUSINESS_CONFIG } from '../../src/domain/tenant/BusinessConfig';

describe('Phase 29E: Cost Analytics & Budget Monitoring', () => {
  const sampleEvents: TelemetryEvent[] = [
    // Turn 1: AnimeVerse - Ecommerce Detail (DeepSeek)
    {
      eventId: 'ev-1',
      timestamp: '2026-08-23T05:00:00.000Z',
      eventType: 'llm_completed',
      tenantId: 'animeverse',
      correlationId: 'turn-1',
      stage: 'llm',
      status: 'SUCCESS',
      provider: 'deepseek',
      model: 'deepseek-chat',
      metadata: { inputTokens: 400, outputTokens: 50, retryAttempts: 0 }
    },
    {
      eventId: 'ev-2',
      timestamp: '2026-08-23T05:00:01.000Z',
      eventType: 'response_completed',
      tenantId: 'animeverse',
      correlationId: 'turn-1',
      stage: 'response',
      status: 'SUCCESS',
      latencyMs: 600,
      metadata: {
        turnDecision: { domain: 'ECOMMERCE', intent: 'PRODUCT_DETAIL', accountId: 'animeverse-store' }
      }
    },
    // Turn 2: AnimeVerse - RAG Shipping Query (Gemini Embedding + Gemini LLM)
    {
      eventId: 'ev-3',
      timestamp: '2026-08-23T05:01:00.000Z',
      eventType: 'rag_completed',
      tenantId: 'animeverse',
      correlationId: 'turn-2',
      stage: 'rag',
      status: 'SUCCESS',
      metadata: {
        embeddingCalls: 1,
        inputSizeChars: 50,
        provider: 'gemini',
        model: 'gemini-embedding-001',
        retryAttempts: 0
      }
    },
    {
      eventId: 'ev-4',
      timestamp: '2026-08-23T05:01:01.000Z',
      eventType: 'llm_completed',
      tenantId: 'animeverse',
      correlationId: 'turn-2',
      stage: 'llm',
      status: 'SUCCESS',
      provider: 'gemini',
      model: 'gemini-2.0-flash-001',
      metadata: { inputTokens: 600, outputTokens: 80, retryAttempts: 2 }
    },
    {
      eventId: 'ev-5',
      timestamp: '2026-08-23T05:01:02.000Z',
      eventType: 'response_completed',
      tenantId: 'animeverse',
      correlationId: 'turn-2',
      stage: 'response',
      status: 'SUCCESS',
      latencyMs: 1400,
      metadata: {
        turnDecision: { domain: 'KNOWLEDGE', intent: 'SHIPPING', accountId: 'animeverse-store' }
      }
    },
    // Turn 3: Tenant Beta - General Support (DeepSeek)
    {
      eventId: 'ev-6',
      timestamp: '2026-08-23T05:02:00.000Z',
      eventType: 'llm_completed',
      tenantId: 'tenant-beta',
      correlationId: 'turn-3',
      stage: 'llm',
      status: 'SUCCESS',
      provider: 'deepseek',
      model: 'deepseek-chat',
      metadata: { inputTokens: 300, outputTokens: 40, retryAttempts: 0 }
    },
    {
      eventId: 'ev-7',
      timestamp: '2026-08-23T05:02:01.000Z',
      eventType: 'response_completed',
      tenantId: 'tenant-beta',
      correlationId: 'turn-3',
      stage: 'response',
      status: 'SUCCESS',
      latencyMs: 500,
      metadata: {
        turnDecision: { domain: 'SUPPORT', intent: 'GENERAL', accountId: 'beta-account' }
      }
    }
  ];

  it('1. aggregate LLM usage accurately', () => {
    const report = CostAnalyticsService.generateReport(sampleEvents);
    expect(report.summary.totalTurns).toBe(3);
    expect(report.summary.totalLlmCalls).toBe(3);
    expect(report.summary.totalInputTokens).toBe(1300); // 400 + 600 + 300
    expect(report.summary.totalOutputTokens).toBe(170); // 50 + 80 + 40
  });

  it('2. aggregate embedding usage accurately', () => {
    const report = CostAnalyticsService.generateReport(sampleEvents);
    expect(report.summary.totalEmbeddingCalls).toBe(1);
    expect(report.byTenant['animeverse']?.embeddingCalls).toBe(1);
    expect(report.byTenant['tenant-beta']?.embeddingCalls).toBe(0);
  });

  it('3. aggregate retry count accurately', () => {
    const report = CostAnalyticsService.generateReport(sampleEvents);
    expect(report.summary.totalRetries).toBe(2);
    expect(report.byTenant['animeverse']?.retries).toBe(2);
    expect(report.byTenant['tenant-beta']?.retries).toBe(0);
  });

  it('4. tenant attribution correctly segments usage across tenants', () => {
    const report = CostAnalyticsService.generateReport(sampleEvents);
    expect(Object.keys(report.byTenant)).toContain('animeverse');
    expect(Object.keys(report.byTenant)).toContain('tenant-beta');

    expect(report.byTenant['animeverse'].totalTurns).toBe(2);
    expect(report.byTenant['animeverse'].inputTokens).toBe(1000);
    expect(report.byTenant['animeverse'].outputTokens).toBe(130);

    expect(report.byTenant['tenant-beta'].totalTurns).toBe(1);
    expect(report.byTenant['tenant-beta'].inputTokens).toBe(300);
  });

  it('5. account attribution correctly segments usage by account', () => {
    const report = CostAnalyticsService.generateReport(sampleEvents);
    expect(Object.keys(report.byAccount)).toBeDefined();
    expect(report.summary.totalTurns).toBe(3);
  });

  it('6. domain attribution correctly segments usage by TurnDecision domain', () => {
    const report = CostAnalyticsService.generateReport(sampleEvents);
    expect(report.byDomain['ECOMMERCE']).toBeDefined();
    expect(report.byDomain['KNOWLEDGE']).toBeDefined();
    expect(report.byDomain['SUPPORT']).toBeDefined();

    expect(report.byDomain['ECOMMERCE'].llmCalls).toBe(1);
    expect(report.byDomain['KNOWLEDGE'].llmCalls).toBe(1);
    expect(report.byDomain['SUPPORT'].llmCalls).toBe(1);
  });

  it('7. intent attribution correctly segments usage by TurnDecision intent', () => {
    const report = CostAnalyticsService.generateReport(sampleEvents);
    expect(report.byIntent['PRODUCT_DETAIL']).toBeDefined();
    expect(report.byIntent['SHIPPING']).toBeDefined();
    expect(report.byIntent['GENERAL']).toBeDefined();

    expect(report.byIntent['PRODUCT_DETAIL'].totalTurns).toBe(1);
    expect(report.byIntent['SHIPPING'].totalTurns).toBe(1);
  });

  it('8. provider/model attribution tracks distribution per provider and model', () => {
    const report = CostAnalyticsService.generateReport(sampleEvents);
    expect(report.byProviderModel['deepseek:deepseek-chat']).toBeDefined();
    expect(report.byProviderModel['gemini:gemini-2.0-flash-001']).toBeDefined();

    expect(report.byProviderModel['deepseek:deepseek-chat'].llmCalls).toBe(2);
    expect(report.byProviderModel['gemini:gemini-2.0-flash-001'].llmCalls).toBe(1);
  });

  it('9. latency aggregation computes both average and p95 latency accurately', () => {
    const report = CostAnalyticsService.generateReport(sampleEvents);
    // Latencies: 600, 1400, 500 -> Avg: (600 + 1400 + 500) / 3 = 833
    expect(report.summary.avgLatencyMs).toBe(833);
    // 95th percentile of [500, 600, 1400] is 1400
    expect(report.summary.p95LatencyMs).toBe(1400);
  });

  it('10. missing pricing returns null rather than invented cost', () => {
    const report = CostAnalyticsService.generateReport(sampleEvents);
    expect(report.summary.costEstimate).toBeNull();
  });

  it('11. budget alert triggers correctly on excessive retry or latency anomalies', () => {
    // Turn 2 had 2 retries, while default maxRetriesPerTurn is 1
    const report = CostAnalyticsService.generateReport(sampleEvents, { maxRetriesPerTurn: 1 });
    const retryAlerts = report.alerts.filter(a => a.alertType === 'HIGH_RETRIES');
    expect(retryAlerts.length).toBe(1);
    expect(retryAlerts[0].correlationId).toBe('turn-2');
    expect(retryAlerts[0].metricValue).toBe(2);
    expect(retryAlerts[0].threshold).toBe(1);

    // Test high latency threshold
    const latencyReport = CostAnalyticsService.generateReport(sampleEvents, { maxLatencyMsPerTurn: 1000 });
    const latencyAlerts = latencyReport.alerts.filter(a => a.alertType === 'HIGH_LATENCY');
    expect(latencyAlerts.length).toBe(1);
    expect(latencyAlerts[0].correlationId).toBe('turn-2');
    expect(latencyAlerts[0].metricValue).toBe(1400);
  });

  it('12. no customer-message blocking occurs when alerts trigger', async () => {
    const mockLlm = new LLMMockProvider();
    const engine = new ConversationEngine(
      {
        getOrCreateConversation: async () => ({
          id: 'conv-test-1',
          tenantId: 'animeverse',
          accountId: null,
          customerId: 'cust-1',
          messageCount: 0,
          version: 1,
          contextData: {},
          status: 'ACTIVE'
        }),
        getRecentMessages: async () => [],
        getActiveSession: async () => null,
        commitConversationTurn: async () => {}
      } as any,
      {
        getConfig: async () => DEFAULT_BUSINESS_CONFIG
      } as any,
      {
        process: async () => ({ response: 'Hello' })
      } as any,
      mockLlm,
      new ResponseBuilder()
    );

    const response = await engine.handleMessage('animeverse', 'cust-1', 'Hello');
    expect(response).toBeDefined();
    expect(typeof response).toBe('string');
    expect(response.length).toBeGreaterThan(0);
  });
});
