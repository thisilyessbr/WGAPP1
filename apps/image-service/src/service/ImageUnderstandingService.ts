import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import * as dns from 'dns';
import { ImageProviderAdapter } from '../adapters/ProviderAdapter';
import {
  ImageUnderstandingRequest,
  ImageUnderstandingResult,
  validateImageRequest,
  validateImageUrlSync,
  isPrivateOrBlockedIp,
  ALLOWED_MIME_TYPES,
  MAX_IMAGE_SIZE_BYTES
} from '../../../../packages/shared/contracts/image.contract';

export interface SafeFetchResult {
  buffer: Buffer;
  mimeType: string;
}

export async function resolveAndValidateDns(hostname: string): Promise<void> {
  let ipToCheck = hostname.toLowerCase().trim();
  if (ipToCheck.startsWith('[') && ipToCheck.endsWith(']')) {
    ipToCheck = ipToCheck.slice(1, -1);
  }

  // If already a literal IP
  if (isPrivateOrBlockedIp(ipToCheck)) {
    throw new Error('Access to private, loopback, or cloud metadata IP addresses is prohibited.');
  }

  // If literal public IP, no DNS lookup needed
  const isIpv4 = /^(\d{1,3}\.){3}\d{1,3}$/.test(ipToCheck);
  if (isIpv4) return;

  try {
    const addresses = await dns.promises.lookup(hostname, { all: true });
    if (!addresses || addresses.length === 0) {
      throw new Error(`DNS resolution failed for hostname '${hostname}'.`);
    }

    for (const addr of addresses) {
      if (isPrivateOrBlockedIp(addr.address)) {
        throw new Error('Access to private, loopback, or cloud metadata IP addresses is prohibited.');
      }
    }
  } catch (err: any) {
    if (err.message?.includes('prohibited')) throw err;
    throw new Error(`DNS resolution failure: ${err.message || String(err)}`);
  }
}

export async function safeFetchImage(initialUrl: string, timeoutMs: number = 5000): Promise<SafeFetchResult> {
  let currentUrl = initialUrl;
  let redirectCount = 0;
  const maxRedirects = 3;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    while (true) {
      // 1. Static URL validation
      const urlCheck = validateImageUrlSync(currentUrl);
      if (!urlCheck.valid || !urlCheck.parsedUrl) {
        throw new Error(urlCheck.error || 'Invalid image URL format.');
      }

      // 2. DNS validation & IP rebinding protection
      await resolveAndValidateDns(urlCheck.parsedUrl.hostname);

      // 3. Outbound fetch with manual redirect
      const res = await fetch(currentUrl, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': 'ImageUnderstandingService/1.0',
          'Accept': ALLOWED_MIME_TYPES.join(', ') + ', image/*'
        }
      });

      // 4. Handle redirects
      if ([301, 302, 303, 307, 308].includes(res.status)) {
        redirectCount++;
        if (redirectCount > maxRedirects) {
          throw new Error('Too many redirects while fetching image.');
        }

        const location = res.headers.get('location');
        if (!location) {
          throw new Error('Redirect location missing.');
        }

        // Resolve redirect relative URL
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }

      // 5. Verify HTTP Status
      if (!res.ok) {
        throw new Error(`Failed to fetch image from URL: HTTP ${res.status}`);
      }

      // 6. Content-Type check
      const rawContentType = res.headers.get('content-type') || '';
      const mime = rawContentType.split(';')[0].trim().toLowerCase();
      if (!mime.startsWith('image/')) {
        throw new Error(`Invalid content type '${mime || 'unknown'}'. Only image content types are accepted.`);
      }

      // 7. Content-Length check
      const contentLengthHeader = res.headers.get('content-length');
      if (contentLengthHeader) {
        const contentLength = parseInt(contentLengthHeader, 10);
        if (!isNaN(contentLength) && contentLength > MAX_IMAGE_SIZE_BYTES) {
          throw new Error(`Image exceeds maximum allowed size of 5MB (${(contentLength / (1024 * 1024)).toFixed(2)}MB).`);
        }
      }

      // 8. Stream response body with strict byte counter
      const chunks: Buffer[] = [];
      let totalBytes = 0;

      if (res.body) {
        const reader = res.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            totalBytes += value.length;
            if (totalBytes > MAX_IMAGE_SIZE_BYTES) {
              await reader.cancel();
              throw new Error(`Image exceeds maximum allowed size of 5MB.`);
            }
            chunks.push(Buffer.from(value));
          }
        }
      }

      const buffer = Buffer.concat(chunks);
      if (buffer.length === 0) {
        throw new Error('Received empty image payload.');
      }

      return {
        buffer,
        mimeType: mime
      };
    }
  } finally {
    clearTimeout(timeoutId);
  }
}

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
        const fetchResult = await safeFetchImage(req.imageUrl);
        imageBuffer = fetchResult.buffer;
        detectedMime = fetchResult.mimeType || detectedMime;
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
      const isTimeout = err.name === 'AbortError' || err.message?.includes('aborted');
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
        error: isTimeout
          ? 'Image request timed out after 5000ms'
          : `Image processing failure: ${err.message || err}`
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
