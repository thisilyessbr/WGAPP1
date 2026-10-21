import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeminiAdapter } from '../../apps/image-service/src/adapters/GeminiAdapter';
import { imageUsageMicros } from '../../packages/shared/contracts/image.contract';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const answer = JSON.stringify({ description: 'A shoe', objects: ['shoe'], visibleText: null, category: 'Footwear', confidence: 0.9 });

describe('image usage pricing', () => {
  it('prices known receipts and returns null or zero for the fallbacks', () => {
    expect(imageUsageMicros({ inputTokens: 1500, outputTokens: 200, thoughtsTokens: 300, billedModel: 'gemini-2.5-flash', tokenSource: 'provider' })).toBe(1700);
    expect(imageUsageMicros({ inputTokens: 1000, outputTokens: 100, billedModel: 'gemini-3.1-flash-lite', tokenSource: 'provider' })).toBe(400);
    // Unlisted models are priced at the highest listed rate.
    expect(imageUsageMicros({ inputTokens: 1000, outputTokens: 100, billedModel: 'gemini-9-ultra', tokenSource: 'provider' })).toBe(550);
    expect(imageUsageMicros(undefined)).toBeNull();
    expect(imageUsageMicros({ inputTokens: 10 })).toBeNull();
    expect(imageUsageMicros({ inputTokens: Number.NaN, outputTokens: 1, tokenSource: 'provider' })).toBeNull();
    expect(imageUsageMicros({ providerBilled: false })).toBe(0);
  });
});

describe('GeminiAdapter usage receipt', () => {
  afterEach(() => vi.unstubAllGlobals());
  const run = () => new GeminiAdapter('test-key', 'gemini-2.5-flash').analyze({ imageBase64: 'aGk=' }, Buffer.from('hi'), 'image/png');

  it('reports provider token counts and the model that answered after a fallback', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(json(404, {}))
      .mockResolvedValueOnce(json(200, { candidates: [{ content: { parts: [{ text: answer }] } }],
        usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 100, thoughtsTokenCount: 50 } })));
    const result = await run();
    expect(result.success).toBe(true);
    expect(result.metadata).toEqual({ inputTokens: 1000, outputTokens: 100, thoughtsTokens: 50, billedModel: 'gemini-3.1-flash-lite', tokenSource: 'provider', estimatedCostUsd: 0.000475 });
  });
  it('keeps the receipt when a billed response cannot be parsed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json(200, { candidates: [{ content: { parts: [{ text: 'not json' }] } }],
      usageMetadata: { promptTokenCount: 800, candidatesTokenCount: 20 } })));
    const result = await run();
    expect(result.success).toBe(false); expect(result.metadata).toMatchObject({ tokenSource: 'provider', inputTokens: 800 });
  });
  it('marks HTTP rejections as unbilled', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(400, { error: 'bad image' })));
    expect((await run()).metadata).toEqual({ providerBilled: false });
  });
});
