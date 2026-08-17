export type ImageTask = 'describe_product' | 'ocr' | 'general';

export interface ImageUnderstandingRequest {
  tenantId?: string;
  imageUrl?: string | null;
  imageBase64?: string | null;
  mimeType?: string | null;
  task?: ImageTask;
}

export interface ImageUnderstandingMetadata {
  inputTokens?: number;
  outputTokens?: number;
  estimatedCostUsd?: number;
}

export interface ImageUnderstandingResult {
  success: boolean;
  description: string | null;
  objects: string[];
  visibleText: string | null;
  category: string | null;
  confidence: number;
  provider: string;
  model: string;
  latencyMs: number;
  error: string | null;
  metadata?: ImageUnderstandingMetadata;
}

export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB limit
export const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export function validateImageRequest(req: ImageUnderstandingRequest): { valid: boolean; error?: string } {
  const hasUrl = typeof req.imageUrl === 'string' && req.imageUrl.trim().length > 0;
  const hasBase64 = typeof req.imageBase64 === 'string' && req.imageBase64.trim().length > 0;

  if (!hasUrl && !hasBase64) {
    return { valid: false, error: 'Invalid request: Exactly one of imageUrl or imageBase64 must be provided (neither provided).' };
  }

  if (hasUrl && hasBase64) {
    return { valid: false, error: 'Invalid request: Exactly one of imageUrl or imageBase64 must be provided (both provided).' };
  }

  if (hasBase64) {
    // Basic base64 size check
    const base64Data = req.imageBase64!.replace(/^data:image\/[a-zA-Z]+;base64,/, '');
    const approxBytes = (base64Data.length * 3) / 4;
    if (approxBytes > MAX_IMAGE_SIZE_BYTES) {
      return { valid: false, error: `Image exceeds maximum allowed size of 5MB (${(approxBytes / (1024 * 1024)).toFixed(2)}MB).` };
    }
  }

  return { valid: true };
}
