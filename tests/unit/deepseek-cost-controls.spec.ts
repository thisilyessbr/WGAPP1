import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeepSeekProvider } from '../../src/core/llm/DeepSeekProvider';
import { LLMMockProvider, LLMUsage } from '../../src/core/llm/LLMProvider';
import { MeteredLLMProvider, LLMCallRecord } from '../../src/core/llm/MeteredLLMProvider';
import { generateResponseWithDeadline } from '../../src/core/llm/ResponseDeadline';
import { GreetingRouter } from '../../src/domain/conversation/GreetingRouter';
import { QuestionReformulator } from '../../src/domain/rag/QuestionReformulator';
import { CostSummaryReporter } from '../../src/core/telemetry/CostSummaryReporter';
import { TelemetryClient } from '../../src/core/telemetry/TelemetryClient';

const success = (content = 'مرحبا! كيفاش نقدر نعاونك؟', usage?: object) => new Response(JSON.stringify({
  model: 'deepseek-flash', choices: [{ message: { content } }], usage
}), { status: 200 });
const actualUsage = { prompt_tokens: 1200, completion_tokens: 100, prompt_cache_hit_tokens: 900,
  prompt_cache_miss_tokens: 300, completion_tokens_details: { reasoning_tokens: 0 } };

describe('DeepSeek cost controls (no external requests)', () => {
  let provider: DeepSeekProvider;
  beforeEach(() => {
    provider = new DeepSeekProvider('test-only-key');
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => success()));
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
  const body = () => JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body));

  it('uses current Flash with thinking disabled, preserving Arabic output', async () => {
    expect(await provider.generateResponse('Answer in Darija', [])).toBe('مرحبا! كيفاش نقدر نعاونك؟');
    expect(body()).toMatchObject({ model: 'deepseek-flash', thinking: { type: 'disabled' }, max_tokens: 500 });
  });
  it('preserves an explicit tenant model choice', async () => {
    await provider.generateResponse('Test', [], { model: 'deepseek-v4-pro' });
    expect(body().model).toBe('deepseek-v4-pro');
  });
  it.each(['deepseek-chat', 'deepseek-v4-flash'])('resolves stored non-thinking alias %s to the current model', async model => {
    await provider.generateResponse('Test', [], { model });
    expect(body().model).toBe('deepseek-flash');
  });
  it('limits classification separately from the tenant reply budget', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(success('ORDER_TRACKING'));
    expect(await provider.classifyIntent('Classify', 'fin wsl commande?', ['ORDER_TRACKING'], { maxTokens: 1000 })).toBe('ORDER_TRACKING');
    expect(body().max_tokens).toBe(64);
  });
  it('limits structured extraction while retaining full Arabic values', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(success('{"value":"الدار البيضاء"}'));
    expect(await provider.extractField('Extract', 'Casablanca', 'city', { maxTokens: 1000 })).toBe('الدار البيضاء');
    expect(body().max_tokens).toBe(256);
  });
  it.each([1000000, Infinity, NaN, -1, 0])('bounds invalid/huge reply token settings: %s', async maxTokens => {
    await provider.generateResponse('Test', [], { maxTokens });
    expect(body().max_tokens).toBeGreaterThan(0);
    expect(body().max_tokens).toBeLessThanOrEqual(2048);
  });
  it('preserves a smaller configured reply budget', async () => {
    await provider.generateResponse('Test', [], { maxTokens: 120 });
    expect(body().max_tokens).toBe(120);
  });
  it.each([400, 401, 402, 403, 404, 422])('does not retry permanent HTTP %s errors', async status => {
    vi.mocked(fetch).mockResolvedValue(new Response('{}', { status }));
    await expect(provider.generateResponse('Test', [])).rejects.toMatchObject({ statusCode: status });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([new DOMException('Request timed out', 'TimeoutError'), new Error('fetch failed')])('does not repeat requests with unknown billing status', async error => {
    vi.mocked(fetch).mockRejectedValue(error);
    await expect(provider.generateResponse('Test', [])).rejects.toMatchObject({ type: 'timeout' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('allows one transient retry and reports its real usage', async () => {
    const onUsage = vi.fn();
    vi.mocked(fetch).mockResolvedValueOnce(new Response('{}', { status: 503 })).mockResolvedValueOnce(success('Recovered', actualUsage));
    expect(await provider.generateResponse('Test', [], { onUsage })).toBe('Recovered');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(onUsage).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ attempts: 2, inputTokens: 1200, outputTokens: 100, tokenSource: 'provider' }));
  });
  it('caps persistent transient failures at two attempts', async () => {
    vi.mocked(fetch).mockImplementation(async () => new Response('{}', { status: 500 }));
    await expect(provider.generateResponse('Test', [])).rejects.toMatchObject({ statusCode: 500 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('does not retry before a long Retry-After expires', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 429, headers: { 'Retry-After': '60' } }));
    await expect(provider.generateResponse('Test', [], { timeoutMs: 2000 })).rejects.toMatchObject({ type: 'rate_limit' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('does not buy malformed output again and still records billed tokens', async () => {
    const onUsage = vi.fn();
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: null } }], usage: actualUsage }), { status: 200 }));
    await expect(provider.generateResponse('Test', [], { onUsage })).rejects.toMatchObject({ type: 'invalid_response' });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(onUsage).toHaveBeenCalledWith(expect.objectContaining({ outputTokens: 100 }));
  });
  it('rejects oversized input before spending; no partial Arabic truncation', async () => {
    const onUsage = vi.fn();
    await expect(provider.generateResponse('ش'.repeat(33000), [], { onUsage })).rejects.toThrow('64 KiB');
    expect(fetch).not.toHaveBeenCalled();
    expect(onUsage).toHaveBeenCalledWith(expect.objectContaining({ attempts: 0, tokenSource: 'unknown' }));
  });
  it('does not fabricate zero billed tokens if usage is absent', async () => {
    const onUsage = vi.fn();
    await provider.generateResponse('Test', [], { onUsage });
    expect(onUsage.mock.calls[0][0]).toMatchObject({ tokenSource: 'unknown', attempts: 1 });
    expect(onUsage.mock.calls[0][0].inputTokens).toBeUndefined();
  });
  it('does not retry when telemetry fails', async () => {
    await expect(provider.generateResponse('Test', [], { onUsage: () => { throw Error('metrics offline'); } })).resolves.toContain('مرحبا');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('cancels a pre-aborted request without calling the API', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(generateResponseWithDeadline(provider, 'Test', [], { signal: controller.signal })).rejects.toMatchObject({ type: 'timeout' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('aborts transport at the caller deadline without background retries', async () => {
    let signal: AbortSignal | undefined;
    vi.mocked(fetch).mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      signal = init?.signal as AbortSignal;
      signal.addEventListener('abort', () => reject(signal?.reason), { once: true });
    }));
    await expect(generateResponseWithDeadline(provider, 'Test', [], { timeoutMs: 25 })).rejects.toMatchObject({ type: 'timeout' });
    expect(signal?.aborted).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('cancels the retry backoff when the caller cancels', async () => {
    const controller = new AbortController();
    vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 503 }));
    const result = provider.generateResponse('Test', [], { signal: controller.signal });
    const expected = expect(result).rejects.toMatchObject({ type: 'timeout' });
    setTimeout(() => controller.abort(), 25);
    await expected;
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('clears timers after a fast successful response', async () => {
    vi.useFakeTimers();
    await generateResponseWithDeadline(provider, 'Test', [], { timeoutMs: 3000 });
    expect(vi.getTimerCount()).toBe(0);
  });
  it('forwards greeting and reformulation deadlines to the paid provider', async () => {
    const mock = new LLMMockProvider();
    mock.generatedResponseMock = 'GREETING';
    await GreetingRouter.classifyGreetingWithLlm(mock, 'tenant', 'heyyy', 750);
    expect(mock.lastOptions).toMatchObject({ timeoutMs: 750, signal: expect.any(AbortSignal) });
    const memory = { recentTurns: [{ role: 'user', content: 'Tell me about delivery' }] } as any;
    await QuestionReformulator.reformulate('how long?', memory, mock, { timeoutMs: 800 });
    expect(mock.lastOptions).toMatchObject({ timeoutMs: 800, signal: expect.any(AbortSignal) });
  });
  it('meters classification, extraction and generation with no double counting of legacy events', async () => {
    const telemetry = new TelemetryClient({ monitoringServiceUrl: '' });
    const records: LLMCallRecord[] = [];
    const metered = new MeteredLLMProvider(provider, { provider: 'deepseek', model: 'deepseek-flash' }, usage => {
      records.push(usage);
      telemetry.emit({ eventType: 'llm_usage', tenantId: 'tenant-a', accountId: 'account-a', correlationId: 'turn-a',
        stage: 'llm', provider: usage.provider, model: usage.model,
        status: usage.success ? 'SUCCESS' : 'FAILURE', metadata: { ...usage } });
    });
    vi.mocked(fetch).mockImplementation(async () => success('GREETING', actualUsage));
    await metered.classifyIntent('Test', 'salam', ['GREETING']);
    await metered.extractField('Test', 'salam', 'name');
    await metered.generateResponse('Test', []);
    telemetry.emit({ eventType: 'llm_completed', tenantId: 'tenant-a', correlationId: 'turn-a', stage: 'llm', status: 'SUCCESS', model: 'deepseek-chat',
      metadata: { inputTokens: 999999, outputTokens: 99999 } });
    const metrics = CostSummaryReporter.calculateTurnMetrics(telemetry.getRecentEvents());
    expect(metrics).toMatchObject({ llmCalls: 3, inputTokens: 3600, outputTokens: 300, accountId: 'account-a', unknownTokenCalls: 0, model: 'deepseek-flash' });
    expect(records[0]).toMatchObject({ cacheHitTokens: 900, cacheMissTokens: 300, reasoningTokens: 0 });
    expect(records.map(r => r.purpose)).toEqual(['intent_classification', 'field_extraction', 'generation']);
  });
  it('keeps overlapping tenants usage separate on a shared provider', async () => {
    const a: LLMUsage[] = [], b: LLMUsage[] = [];
    vi.mocked(fetch).mockImplementation(async (_url, init) => {
      const model = JSON.parse(String(init?.body)).model;
      return success('ok', { prompt_tokens: model === 'model-a' ? 10 : 20, completion_tokens: 1 });
    });
    await Promise.all([
      provider.generateResponse('A', [], { model: 'model-a', onUsage: u => a.push(u) }),
      provider.generateResponse('B', [], { model: 'model-b', onUsage: u => b.push(u) })
    ]);
    expect(a[0].inputTokens).toBe(10); expect(b[0].inputTokens).toBe(20);
  });
});
