import 'dotenv/config';
import express, { Request, Response } from 'express';
import cors from 'cors';
import { GeminiAdapter } from './adapters/GeminiAdapter';
import { ImageUnderstandingService } from './service/ImageUnderstandingService';
import { ImageUnderstandingRequest } from '../../../packages/shared/contracts/image.contract';

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const port = process.env.IMAGE_SERVICE_PORT ? parseInt(process.env.IMAGE_SERVICE_PORT, 10) : 4002;
const apiKey = process.env.GOOGLE_API_KEY || '';

const adapter = new GeminiAdapter(apiKey);
const service = new ImageUnderstandingService(adapter);

// Per-tenant rate limiter tracker (simple in-memory sliding window)
const tenantRequestMap = new Map<string, number[]>();
const RATE_LIMIT_MAX_PER_MINUTE = 30;

function checkRateLimit(tenantId: string): boolean {
  const now = Date.now();
  const windowStart = now - 60000;
  let timestamps = tenantRequestMap.get(tenantId) || [];
  timestamps = timestamps.filter(t => t > windowStart);
  if (timestamps.length >= RATE_LIMIT_MAX_PER_MINUTE) {
    tenantRequestMap.set(tenantId, timestamps);
    return false;
  }
  timestamps.push(now);
  tenantRequestMap.set(tenantId, timestamps);
  return true;
}

// 1. Health check endpoint (independent health check)
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    service: 'image-service',
    version: '1.0.0',
    provider: adapter.name,
    model: adapter.modelName,
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

// 2. Main Capability Gateway endpoint
app.post('/analyze-image', async (req: Request, res: Response) => {
  const payload = req.body as ImageUnderstandingRequest;
  const tenantId = payload.tenantId || req.headers['x-tenant-id'] as string || 'default';

  // Per-tenant rate limiting
  if (!checkRateLimit(tenantId)) {
    return res.status(429).json({
      success: false,
      description: null,
      objects: [],
      visibleText: null,
      category: null,
      confidence: 0,
      provider: adapter.name,
      model: adapter.modelName,
      latencyMs: 0,
      error: `Rate limit exceeded for tenant [${tenantId}] (max ${RATE_LIMIT_MAX_PER_MINUTE} req/min).`
    });
  }

  const result = await service.processImage(payload);

  // Production logging: Log metadata only, NEVER raw Gemini response prose
  const logMeta = {
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
  console.log(`[image-service] Invocation: ${JSON.stringify(logMeta)}`);

  return res.json(result);
});

// 3. Ephemeral test inspection endpoint (strictly for test harness verification)
app.get('/test/last-raw-response', (req: Request, res: Response) => {
  res.json({
    rawResponse: GeminiAdapter.lastRawResponseForTesting,
    invocationCount: GeminiAdapter.invocationCountForTesting
  });
});

export function startImageService(overridePort?: number) {
  const p = overridePort || port;
  const server = app.listen(p, () => {
    console.log(`[image-service] Running independently on http://localhost:${p}`);
  });
  return server;
}

if (require.main === module) {
  startImageService();
}

export { app, service, adapter };
