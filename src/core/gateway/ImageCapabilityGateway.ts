import {
  ImageUnderstandingRequest,
  ImageUnderstandingResult,
  validateImageRequest
} from '../../../packages/shared/contracts/image.contract';
import { logger } from '../../utils/logger';
import { telemetry } from '../telemetry/TelemetryClient';

export interface ImageCapabilityGatewayOptions {
  serviceUrl?: string;
  overallTimeoutMs?: number;
  connectionTimeoutMs?: number;
}

export class ImageCapabilityGateway {
  private serviceUrl: string;
  private overallTimeoutMs: number;
  private connectionTimeoutMs: number;

  constructor(options?: ImageCapabilityGatewayOptions) {
    this.serviceUrl = options?.serviceUrl || process.env.IMAGE_SERVICE_URL || 'http://localhost:4002';
    this.overallTimeoutMs = options?.overallTimeoutMs || 15000; // 15 second overall timeout
    this.connectionTimeoutMs = options?.connectionTimeoutMs || 2500; // 2.5 second connection timeout
  }

  /**
   * Health check to confirm if image-service is reachable
   */
  async checkHealth(): Promise<{ ok: boolean; details?: any }> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.connectionTimeoutMs);

    try {
      const res = await fetch(`${this.serviceUrl}/health`, {
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      if (res.ok) {
        const data = await res.json();
        return { ok: true, details: data };
      }
      return { ok: false };
    } catch (err) {
      clearTimeout(timeoutId);
      return { ok: false };
    }
  }

  /**
   * Analyzes an image via the external Image Understanding Microservice.
   * Never throws unhandled errors up the chain.
   */
  async analyzeImage(
    tenantId: string,
    req: ImageUnderstandingRequest,
    correlationId?: string
  ): Promise<ImageUnderstandingResult> {
    const startTime = Date.now();

    telemetry.emit({
      eventType: 'image_started',
      tenantId,
      correlationId: correlationId || 'unknown',
      stage: 'image',
      status: 'SUCCESS',
      metadata: {
        mimeType: req.mimeType || 'unknown'
      }
    });

    // 1. Contract validation on caller side
    const validation = validateImageRequest(req);
    if (!validation.valid) {
      const result: ImageUnderstandingResult = {
        success: false,
        description: null,
        objects: [],
        visibleText: null,
        category: null,
        confidence: 0,
        provider: 'gateway',
        model: 'validator',
        latencyMs: Date.now() - startTime,
        error: validation.error || 'Invalid image request parameters.'
      };
      this.logInvocation(tenantId, result, correlationId);
      return result;
    }

    const payload: ImageUnderstandingRequest = {
      ...req,
      tenantId
    };

    // 2. Abort controller enforcing overall timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.overallTimeoutMs);

    try {
      const res = await fetch(`${this.serviceUrl}/analyze-image`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-tenant-id': tenantId
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        const errorJson: any = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        const result: ImageUnderstandingResult = {
          success: false,
          description: null,
          objects: [],
          visibleText: null,
          category: null,
          confidence: 0,
          provider: errorJson.provider || 'gateway',
          model: errorJson.model || 'unknown',
          latencyMs: Date.now() - startTime,
          error: errorJson.error || `Image service error (HTTP ${res.status})`
        };
        this.logInvocation(tenantId, result, correlationId);
        return result;
      }

      const result: ImageUnderstandingResult = await res.json();
      this.logInvocation(tenantId, result, correlationId);
      return result;

    } catch (err: any) {
      clearTimeout(timeoutId);
      const isTimeout = err.name === 'AbortError' || err.message?.includes('aborted');
      const result: ImageUnderstandingResult = {
        success: false,
        description: null,
        objects: [],
        visibleText: null,
        category: null,
        confidence: 0,
        provider: 'gateway',
        model: 'unknown',
        latencyMs: Date.now() - startTime,
        error: isTimeout
          ? `Image service request timed out after ${this.overallTimeoutMs}ms`
          : `Image service unreachable: ${err.message || err}`
      };
      this.logInvocation(tenantId, result, correlationId);
      return result;
    }
  }

  private logInvocation(tenantId: string, result: ImageUnderstandingResult, correlationId?: string) {
    // Telemetry emission: exactly ONE terminal event (image_completed or image_failed)
    if (result.success) {
      telemetry.emit({
        eventType: 'image_completed',
        tenantId,
        correlationId: correlationId || 'unknown',
        stage: 'image',
        status: 'SUCCESS',
        latencyMs: result.latencyMs,
        provider: result.provider || 'unknown',
        model: result.model || 'unknown',
        metadata: {
          category: result.category,
          confidence: result.confidence,
          inputTokens: result.metadata?.inputTokens,
          outputTokens: result.metadata?.outputTokens
        }
      });
    } else {
      telemetry.emit({
        eventType: 'image_failed',
        tenantId,
        correlationId: correlationId || 'unknown',
        stage: 'image',
        status: 'FAILURE',
        latencyMs: result.latencyMs,
        provider: result.provider || 'gateway',
        model: result.model || 'unknown',
        errorCode: result.error || 'Unknown image error',
        metadata: {
          error: result.error
        }
      });
    }

    // Production logging: strictly metadata, no raw Gemini response text
    const meta = {
      tenantId,
      provider: result.provider,
      model: result.model,
      latencyMs: result.latencyMs,
      success: result.success,
      category: result.category,
      confidence: result.confidence,
      inputTokens: result.metadata?.inputTokens,
      outputTokens: result.metadata?.outputTokens,
      estimatedCostUsd: result.metadata?.estimatedCostUsd,
      error: result.error
    };
    logger.info(`[ImageCapabilityGateway] Invocation: ${JSON.stringify(meta)}`);
  }
}
