import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { ImageProviderAdapter } from '../adapters/ProviderAdapter';
import {
  ImageUnderstandingRequest,
  ImageUnderstandingResult,
  validateImageRequest,
  ALLOWED_MIME_TYPES,
  MAX_IMAGE_SIZE_BYTES
} from '../../../../packages/shared/contracts/image.contract';

export class ImageUnderstandingService {
  constructor(private adapter: ImageProviderAdapter) {}

  async processImage(req: ImageUnderstandingRequest): Promise<ImageUnderstandingResult> {
    const startTime = Date.now();

    // 1. Contract validation
    const validation = validateImageRequest(req);
    if (!validation.valid) {
      return {
        success: false,
        description: null,
        objects: [],
        visibleText: null,
        category: null,
        confidence: 0,
        provider: this.adapter.name,
        model: this.adapter.modelName,
        latencyMs: Date.now() - startTime,
        error: validation.error || 'Invalid image request parameters.'
      };
    }

    let tempFilePath: string | null = null;

    try {
      let imageBuffer: Buffer;
      let detectedMime = req.mimeType || 'image/jpeg';

      if (req.imageBase64) {
        // Extract mime type if header included: data:image/png;base64,...
        const match = req.imageBase64.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
        let rawBase64 = req.imageBase64;
        if (match) {
          detectedMime = match[1];
          rawBase64 = match[2];
        }
        imageBuffer = Buffer.from(rawBase64, 'base64');
      } else if (req.imageUrl) {
        const fetchRes = await fetch(req.imageUrl);
        if (!fetchRes.ok) {
          return {
            success: false,
            description: null,
            objects: [],
            visibleText: null,
            category: null,
            confidence: 0,
            provider: this.adapter.name,
            model: this.adapter.modelName,
            latencyMs: Date.now() - startTime,
            error: `Failed to fetch image from URL: HTTP ${fetchRes.status}`
          };
        }
        const contentType = fetchRes.headers.get('content-type');
        if (contentType && contentType.startsWith('image/')) {
          detectedMime = contentType.split(';')[0];
        }
        const arrayBuf = await fetchRes.arrayBuffer();
        imageBuffer = Buffer.from(arrayBuf);
      } else {
        throw new Error('No image payload found.');
      }

      // Check image size
      if (imageBuffer.length > MAX_IMAGE_SIZE_BYTES) {
        return {
          success: false,
          description: null,
          objects: [],
          visibleText: null,
          category: null,
          confidence: 0,
          provider: this.adapter.name,
          model: this.adapter.modelName,
          latencyMs: Date.now() - startTime,
          error: `Image exceeds maximum allowed size of 5MB (${(imageBuffer.length / (1024 * 1024)).toFixed(2)}MB).`
        };
      }

      // Optional temporary local disk file for processing (strictly deleted in finally)
      const tempFileName = `temp_img_${crypto.randomUUID()}.${detectedMime.split('/')[1] || 'jpg'}`;
      tempFilePath = path.join(os.tmpdir(), tempFileName);
      fs.writeFileSync(tempFilePath, imageBuffer);

      // Invoke provider adapter
      const result = await this.adapter.analyze(req, imageBuffer, detectedMime);
      return result;

    } catch (err: any) {
      return {
        success: false,
        description: null,
        objects: [],
        visibleText: null,
        category: null,
        confidence: 0,
        provider: this.adapter.name,
        model: this.adapter.modelName,
        latencyMs: Date.now() - startTime,
        error: `Image processing failure: ${err.message || err}`
      };
    } finally {
      // 0 permanent image storage — delete temp media immediately on both success and failure
      if (tempFilePath && fs.existsSync(tempFilePath)) {
        try {
          fs.unlinkSync(tempFilePath);
        } catch (cleanupErr) {
          // Ignore cleanup errors
        }
      }
    }
  }
}
