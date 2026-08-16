import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DeepSeekProvider } from '../core/llm/DeepSeekProvider';

describe('DeepSeek LLM Provider', () => {
  let provider: DeepSeekProvider;
  beforeEach(() => {
    provider = new DeepSeekProvider('test-api-key');
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });
  it('1. Successful generation', async () => {
    const mockResponse = {
      choices: [{ message: { content: 'Hello, I am DeepSeek.' } }]
    };
    // Typecast to any to allow mocking fetch properties
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse
    });
    const response = await provider.generateResponse('System', [{role: 'user', content: 'Hi'}]);
    expect(response).toBe('Hello, I am DeepSeek.');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
  it('2. Successful field extraction (Valid JSON)', async () => {
    const mockResponse = {
      choices: [{ message: { content: '{"value": "John Doe"}' } }]
    };
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse
    });
    const val = await provider.extractField('System', 'My name is John Doe', 'string');
    expect(val).toBe('John Doe');
  });
  it('3. Malformed LLM output during extraction', async () => {
    const mockResponse = {
      // The LLM output bad JSON string
      choices: [{ message: { content: '{value: "Missing quotes"}' } }]
    };
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse
    });
    // Should return null safely instead of throwing
    const val = await provider.extractField('System', 'Hello', 'string');
    expect(val).toBeNull();
  });
  it('4. Missing extracted field (Valid JSON but null value)', async () => {
    const mockResponse = {
      choices: [{ message: { content: '{"value": null}' } }]
    };
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse
    });
    const val = await provider.extractField('System', 'Hello', 'string');
    expect(val).toBeNull();
  });
  it('5. Timeout handling (Fetch failed)', async () => {
    // Mock fetch to simulate a timeout error
    (global.fetch as any).mockRejectedValue(new Error('fetch failed due to timeout'));
    // Should exhaust retries and eventually throw
    await expect(provider.generateResponse('System', [])).rejects.toThrow(/DeepSeek API Timeout or Network Failure/);
    // Default retries is 3
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });
  it('6. Rate limit handling (HTTP 429)', async () => {
    // First two calls return 429, third call succeeds
    (global.fetch as any)
      .mockResolvedValueOnce({ ok: false, status: 429, statusText: 'Too Many Requests' })
      .mockResolvedValueOnce({ ok: false, status: 429, statusText: 'Too Many Requests' })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'Recovered' } }] })
      });
    const response = await provider.generateResponse('System', []);
    expect(response).toBe('Recovered');
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });
  it('7. Provider error (HTTP 500)', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error'
    });
    await expect(provider.generateResponse('System', [])).rejects.toThrow(/DeepSeek API error: 500/);
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });
  it('8. Malformed provider API response structure', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      // API returns something entirely different
      json: async () => ({ error: 'Something went wrong on their end' })
    });
    await expect(provider.generateResponse('System', [])).rejects.toThrow(/Malformed DeepSeek API response/);
  });
});
