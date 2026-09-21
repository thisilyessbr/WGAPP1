import { EmbeddingProvider } from './EmbeddingProvider';

export class GeminiEmbeddingProvider implements EmbeddingProvider {
  private apiKey: string;
  private model: string;
  private baseUrl: string;

  constructor(apiKey?: string, model: string = 'gemini-embedding-001', private timeoutMs: number = 8000) {
    this.apiKey = apiKey || process.env.GOOGLE_API_KEY || '';
    if (!this.apiKey) {
      throw new Error('GOOGLE_API_KEY is not configured in environment or constructor.');
    }
    this.model = model;
    this.baseUrl = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:embedContent`;
  }

  async embedText(text: string): Promise<number[]> {
    if (!text || text.trim() === '') {
      throw new Error('Text to embed cannot be empty.');
    }

    const url = `${this.baseUrl}?key=${this.apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: `models/${this.model}`,
        content: {
          parts: [{ text }]
        }
      }),
      signal: AbortSignal.timeout(this.timeoutMs)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini Embedding API Error (HTTP ${response.status}): ${errorText}`);
    }

    const data: any = await response.json();
    if (!data.embedding || !Array.isArray(data.embedding.values) || data.embedding.values.length === 0 || !data.embedding.values.every((v: unknown) => typeof v === 'number' && Number.isFinite(v))) {
      throw new Error(`Unexpected Gemini embedding API response format: ${JSON.stringify(data)}`);
    }

    return data.embedding.values;
  }
}
