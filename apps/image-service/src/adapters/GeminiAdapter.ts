import { ImageProviderAdapter } from './ProviderAdapter';
import { ImageUnderstandingRequest, ImageUnderstandingResult } from '../../../../packages/shared/contracts/image.contract';

export class GeminiAdapter implements ImageProviderAdapter {
  public name = 'gemini';
  public modelName: string;
  private apiKey: string;
  private baseUrl = 'https://generativelanguage.googleapis.com/v1beta/models';

  // Ephemeral in-memory hook for testing to verify raw response isolation
  public static lastRawResponseForTesting: string | null = null;
  public static invocationCountForTesting: number = 0;

  constructor(apiKey?: string, modelName?: string) {
    this.apiKey = apiKey || process.env.GOOGLE_API_KEY || '';
    if (!this.apiKey) {
      throw new Error('GeminiAdapter: GOOGLE_API_KEY is not configured.');
    }
    // Default to gemini-2.5-flash as specified
    this.modelName = modelName || process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash';
  }

  async analyze(
    req: ImageUnderstandingRequest,
    imageBuffer: Buffer,
    mimeType: string
  ): Promise<ImageUnderstandingResult> {
    const startTime = Date.now();
    GeminiAdapter.invocationCountForTesting++;

    const base64Image = imageBuffer.toString('base64');
    const task = req.task || 'general';

    let taskInstruction = 'Analyze the provided image and extract structured information.';
    if (task === 'describe_product') {
      taskInstruction = 'Analyze this product image. Identify the product name, visual features, color, brand, and high-level product category. If it is not a product, set category to null.';
    } else if (task === 'ocr') {
      taskInstruction = 'Extract all visible text, labels, brand names, numbers, and packaging writing in the image accurately.';
    }

    const promptText = `
${taskInstruction}

You must return ONLY a valid JSON object strictly matching this schema with NO markdown code fences and NO surrounding text:
{
  "description": "Clear 1-2 sentence description of the image content",
  "objects": ["list", "of", "detected", "objects"],
  "visibleText": "All OCR text clearly visible on labels/packaging/signs, or null if none",
  "category": "High-level category (e.g. Footwear, Electronics, Apparel, Home & Kitchen, Cosmetics, Books, Documents) or null if not a product",
  "confidence": 0.95
}

Note:
- If the image is not a product (e.g. landscape, animal, abstract, scenery, random photo), "category" MUST be null.
- "confidence" must be a float between 0.0 and 1.0 representing model-assessed visual clarity/certainty.
`;

    const requestBody = {
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType: mimeType,
                data: base64Image
              }
            },
            {
              text: promptText
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 500,
        responseMimeType: 'application/json'
      }
    };

    let modelToCall = this.modelName;
    let url = `${this.baseUrl}/${modelToCall}:generateContent?key=${this.apiKey}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second internal timeout

    let response: globalThis.Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });

      // If Google deprecated gemini-2.5-flash upstream for new keys, fallback gracefully to active Flash endpoint
      if (response.status === 404 && modelToCall.includes('2.5-flash')) {
        modelToCall = 'gemini-3.1-flash-lite';
        url = `${this.baseUrl}/${modelToCall}:generateContent?key=${this.apiKey}`;
        response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
          signal: controller.signal
        });
      }
    } catch (fetchErr: any) {
      clearTimeout(timeoutId);
      const latencyMs = Date.now() - startTime;
      if (fetchErr.name === 'AbortError' || fetchErr.message?.includes('aborted')) {
        return {
          success: false,
          description: null,
          objects: [],
          visibleText: null,
          category: null,
          confidence: 0,
          provider: this.name,
          model: this.modelName,
          latencyMs,
          error: 'Gemini image processing timed out.'
        };
      }
      return {
        success: false,
        description: null,
        objects: [],
        visibleText: null,
        category: null,
        confidence: 0,
        provider: this.name,
        model: this.modelName,
        latencyMs,
        error: `Gemini network error: ${fetchErr.message || fetchErr}`
      };
    } finally {
      clearTimeout(timeoutId);
    }

    const latencyMs = Date.now() - startTime;

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      return {
        success: false,
        description: null,
        objects: [],
        visibleText: null,
        category: null,
        confidence: 0,
        provider: this.name,
        model: this.modelName,
        latencyMs,
        error: `Gemini API error (HTTP ${response.status}): ${errText.substring(0, 200)}`
      };
    }

    const jsonResponse: any = await response.json();
    const candidate = jsonResponse.candidates?.[0];
    const rawText = candidate?.content?.parts?.[0]?.text || '';

    // Ephemeral capture strictly for testing verification
    GeminiAdapter.lastRawResponseForTesting = rawText;

    if (!rawText) {
      return {
        success: false,
        description: null,
        objects: [],
        visibleText: null,
        category: null,
        confidence: 0,
        provider: this.name,
        model: this.modelName,
        latencyMs,
        error: 'Empty response candidate received from Gemini.'
      };
    }

    // Token usage metadata & Cost estimation
    const usage = jsonResponse.usageMetadata;
    const inputTokens = usage?.promptTokenCount || 0;
    const outputTokens = usage?.candidatesTokenCount || 0;
    // Gemini 2.5/2.0 Flash pricing: $0.075 / 1M input tokens, $0.30 / 1M output tokens
    const estimatedCostUsd = (inputTokens * 0.000000075) + (outputTokens * 0.0000003);

    try {
      const cleanJson = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleanJson);

      return {
        success: true,
        description: typeof parsed.description === 'string' ? parsed.description : null,
        objects: Array.isArray(parsed.objects) ? parsed.objects.map(String) : [],
        visibleText: typeof parsed.visibleText === 'string' && parsed.visibleText.trim() ? parsed.visibleText.trim() : null,
        category: typeof parsed.category === 'string' && parsed.category.trim() && parsed.category.toLowerCase() !== 'null' ? parsed.category.trim() : null,
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.85,
        provider: this.name,
        model: this.modelName,
        latencyMs,
        error: null,
        metadata: {
          inputTokens,
          outputTokens,
          estimatedCostUsd: Number(estimatedCostUsd.toFixed(8))
        }
      };
    } catch (parseErr: any) {
      return {
        success: false,
        description: null,
        objects: [],
        visibleText: null,
        category: null,
        confidence: 0,
        provider: this.name,
        model: this.modelName,
        latencyMs,
        error: `Failed to parse structured JSON from model: ${parseErr.message}`
      };
    }
  }
}
