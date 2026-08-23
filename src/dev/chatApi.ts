import { Router, Request, Response } from 'express';
import { AsyncLocalStorage } from 'async_hooks';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { ChatbotDependencies } from '../bootstrap';
import multer from 'multer';
import { BusinessConfig, DEFAULT_BUSINESS_CONFIG } from '../domain/tenant/BusinessConfig';
import { isValidPdfBuffer } from '../domain/rag/PdfIngestionService';
import { ProductRepository } from '../domain/ecommerce/ProductRepository';
import { EcommerceIntentParser } from '../domain/ecommerce/EcommerceIntent';
import { createRouteProtectionMiddleware } from '../utils/rateLimiter';
import { CostSummaryReporter } from '../core/telemetry/CostSummaryReporter';
import { CostAnalyticsService } from '../core/telemetry/CostAnalyticsService';

export interface RequestDiagnosticContext {
  intent: string | null;
  classificationError: string | null;
  chunks: any[];
}

export const chatDiagnosticStorage = new AsyncLocalStorage<RequestDiagnosticContext>();

// Setup multer for in-memory file uploads (max 10MB default)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

export interface AuthenticatedPrincipal {
  tenantId: string;
  customerId?: string;
  role?: string;
}

export interface TokenPayload {
  tenantId: string;
  customerId?: string;
  role?: string;
  exp?: number;
}

declare global {
  namespace Express {
    interface Request {
      principal?: AuthenticatedPrincipal;
    }
  }
}

function getAuthSecret(): string {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  if (process.env.DEV_API_KEY) return process.env.DEV_API_KEY;
  if (process.env.NODE_ENV === 'test' || process.env.VITEST === 'true') {
    return 'test-hmac-auth-secret-key-32chars!';
  }
  if (process.env.NODE_ENV === 'development' && process.env.ENABLE_DEV_CONTROL_CENTER === 'true') {
    return 'dev-local-control-center-secret-key-32chars!';
  }
  return '';
}

/**
 * Creates an HMAC-SHA256 signed token for a tenant/customer principal.
 */
export function createSignedToken(payload: TokenPayload, secretKey?: string): string {
  const secret = secretKey || getAuthSecret();
  if (!secret) {
    throw new Error('Cannot create token: AUTH_SECRET or DEV_API_KEY is not configured.');
  }
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
  return `${payloadB64}.${signature}`;
}

/**
 * Verifies an HMAC-SHA256 signed token and returns the authenticated payload.
 * Rejects unsigned, forged, or tampered tokens.
 */
export function verifySignedToken(token: string, secretKey?: string): TokenPayload | null {
  const secret = secretKey || getAuthSecret();
  if (!secret || !token || !token.includes('.')) {
    return null;
  }

  const parts = token.split('.');
  if (parts.length !== 2) {
    return null;
  }

  const [payloadB64, signature] = parts;
  const expectedSig = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');

  // Constant-time signature comparison to prevent timing attacks
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const payloadJson = Buffer.from(payloadB64, 'base64url').toString('utf8');
    const payload: TokenPayload = JSON.parse(payloadJson);

    if (!payload || typeof payload.tenantId !== 'string' || !payload.tenantId.trim()) {
      return null;
    }

    if (payload.exp && Date.now() > payload.exp) {
      return null; // Expired token
    }

    return payload;
  } catch {
    return null;
  }
}

function timingSafeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function resolvePrincipal(req: Request): AuthenticatedPrincipal | null {
  const authHeader = req.headers['authorization'];
  const apiKeyHeader = req.headers['x-api-key'] as string;
  let bearerToken = '';

  if (authHeader && authHeader.startsWith('Bearer ')) {
    bearerToken = authHeader.substring(7).trim();
  }

  const apiKey = apiKeyHeader ? apiKeyHeader.trim() : '';

  // Get active admin secret from environment (strictly fail closed if not configured)
  const configuredAdminKey = process.env.DEV_API_KEY;

  // 1. Check Authorization: Bearer <token>
  if (bearerToken) {
    // Check if bearer token is the configured admin key
    if (configuredAdminKey && timingSafeCompare(bearerToken, configuredAdminKey)) {
      const targetTenant = (req.headers['x-tenant-id'] || req.body?.tenantId || req.query?.tenantId || 'dev-tenant') as string;
      const targetCustomer = (req.headers['x-customer-id'] || req.body?.customerId || req.query?.customerId) as string | undefined;
      return { tenantId: targetTenant, customerId: targetCustomer, role: 'admin' };
    }

    // Check if bearer token is a valid signed token
    const signedPayload = verifySignedToken(bearerToken);
    if (signedPayload) {
      return {
        tenantId: signedPayload.tenantId,
        customerId: signedPayload.customerId,
        role: signedPayload.role
      };
    }

    // In non-test or strict environments, invalid/unsigned Bearer tokens MUST fail
    return null;
  }

  // 2. Check X-API-Key header
  if (apiKey) {
    if (configuredAdminKey && timingSafeCompare(apiKey, configuredAdminKey)) {
      const targetTenant = (req.headers['x-tenant-id'] || req.body?.tenantId || req.query?.tenantId || 'dev-tenant') as string;
      const targetCustomer = (req.headers['x-customer-id'] || req.body?.customerId || req.query?.customerId) as string | undefined;
      return { tenantId: targetTenant, customerId: targetCustomer, role: 'admin' };
    }
    return null;
  }

  // 3. Backward-compatible test harness fallback ONLY when running legacy vitest tests without auth headers
  const isLegacyTest = (process.env.NODE_ENV === 'test' || process.env.VITEST === 'true') && process.env.STRICT_AUTH !== 'true';
  if (isLegacyTest) {
    const fallbackTenant = (req.headers['x-tenant-id'] || req.body?.tenantId || req.query?.tenantId) as string;
    const fallbackCustomer = (req.headers['x-customer-id'] || req.body?.customerId || req.query?.customerId) as string;
    if (fallbackTenant) {
      return { tenantId: fallbackTenant, customerId: fallbackCustomer };
    }
  }

  // 4. Explicit development mode fallback for local Control Center UI
  const isDevMode = process.env.NODE_ENV === 'development' && process.env.ENABLE_DEV_CONTROL_CENTER === 'true';
  if (isDevMode) {
    const devTenant = (req.headers['x-tenant-id'] || req.body?.tenantId || req.query?.tenantId || 'dev-tenant') as string;
    const devCustomer = (req.headers['x-customer-id'] || req.body?.customerId || req.query?.customerId) as string | undefined;
    return { tenantId: devTenant, customerId: devCustomer, role: 'admin' };
  }

  return null;
}

export function createDevChatRouter(deps: ChatbotDependencies): Router {
  const router = Router();

  // Route-Specific Rate Limiters & Concurrency Semaphores
  const chatProtection = createRouteProtectionMiddleware({
    keyPrefix: 'chat',
    perIpLimit: { max: 30, windowMs: 60000 },
    perTenantLimit: { max: 120, windowMs: 60000 },
    concurrencyLimit: 20
  });

  const uploadProtection = createRouteProtectionMiddleware({
    keyPrefix: 'upload',
    perIpLimit: { max: 5, windowMs: 60000 },
    perTenantLimit: { max: 20, windowMs: 60000 },
    concurrencyLimit: 4
  });

  const translateProtection = createRouteProtectionMiddleware({
    keyPrefix: 'translate',
    perIpLimit: { max: 10, windowMs: 60000 },
    perTenantLimit: { max: 30, windowMs: 60000 },
    concurrencyLimit: 5
  });

  const pilotChatProtection = createRouteProtectionMiddleware({
    keyPrefix: 'pilot_chat',
    perIpLimit: { max: 20, windowMs: 60000 },
    perTenantLimit: { max: 60, windowMs: 60000 },
    concurrencyLimit: 10
  });

  const resetProtection = createRouteProtectionMiddleware({
    keyPrefix: 'reset',
    perIpLimit: { max: 30, windowMs: 60000 },
    perTenantLimit: { max: 60, windowMs: 60000 }
  });

  // Wrap diagnostic interceptors once using AsyncLocalStorage so individual requests never mutate singleton dependencies
  if (deps?.conversationEngine) {
    const originalRag = (deps.conversationEngine as any)['ragService'];
    if (originalRag && !originalRag.__isDiagnosticProxy) {
      const interceptedRag = new Proxy(originalRag, {
        get(target: any, prop: string | symbol, receiver: any) {
          if (prop === '__isDiagnosticProxy') return true;
          if (prop === 'retrieveChunks') {
            return async (tenantId: string, q: string, config: any, accountId?: string | null) => {
              const chunks = await target.retrieveChunks(tenantId, q, config, accountId);
              const store = chatDiagnosticStorage.getStore();
              if (store) store.chunks = chunks;
              return target.formatContext(chunks, config.knowledge?.maxContextSize ?? 4000);
            };
          }
          if (prop === 'retrieve') {
            return async (tenantId: string, q: string, config: any, accountId?: string | null) => {
              const result = await target.retrieve(tenantId, q, config, accountId);
              const store = chatDiagnosticStorage.getStore();
              if (store) store.chunks = result.chunks || [];
              return result;
            };
          }
          const val = Reflect.get(target, prop, receiver);
          return typeof val === 'function' ? val.bind(target) : val;
        }
      });
      (deps.conversationEngine as any)['ragService'] = interceptedRag;
    }

    const originalFactory = (deps.conversationEngine as any)['llmFactory'];
    if (originalFactory && !originalFactory.__isDiagnosticProxy) {
      const interceptedFactory = {
        ...originalFactory,
        __isDiagnosticProxy: true,
        getProvider: (cfg: any) => {
          const resolved = originalFactory.getProvider(cfg);
          const originalProv = resolved.provider;
          const interceptedProv = {
            ...originalProv,
            classifyIntent: async (p: string, m: string, a: string[], opt: any) => {
              const store = chatDiagnosticStorage.getStore();
              try {
                const intent = await originalProv.classifyIntent(p, m, a, opt);
                if (store) store.intent = intent;
                return intent;
              } catch (error: any) {
                if (store) store.classificationError = error.message || String(error);
                throw error;
              }
            },
            extractField: (p: string, m: string, t: string, opt: any) => originalProv.extractField(p, m, t, opt),
            generateResponse: (p: string, h: any[], opt: any) => originalProv.generateResponse(p, h, opt)
          };
          return { provider: interceptedProv, options: resolved.options };
        }
      };
      (deps.conversationEngine as any)['llmFactory'] = interceptedFactory;
    }
  }

  // Global Authentication & Tenant Authorization Middleware
  router.use(async (req: Request, res: Response, next) => {
    if (req.path.startsWith('/pilot-harness/preset-image')) {
      return next();
    }

    // 1. Authenticate Principal
    const principal = resolvePrincipal(req);
    if (!principal) {
      return res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Authentication required. Please provide a valid signed Authorization Bearer token or configured x-api-key.'
      });
    }

    req.principal = principal;

    // 2. Authorize Tenant Scope
    const clientTenantId = (req.headers['x-tenant-id'] as string) || req.body?.tenantId || (req.query?.tenantId as string);
    if (clientTenantId && clientTenantId !== principal.tenantId && principal.role !== 'admin') {
      return res.status(403).json({
        error: 'FORBIDDEN',
        message: `Tenant authorization mismatch: Authenticated principal (${principal.tenantId}) cannot access target tenant (${clientTenantId}).`
      });
    }

    // 3. Verify Tenant Existence in Database (skip for /bootstrap)
    if (req.path === '/bootstrap') {
      return next();
    }

    try {
      const tenant = await deps.prisma.tenant.findUnique({ where: { id: principal.tenantId } });
      if (!tenant) {
        return res.status(404).json({ error: 'Tenant not found. Please bootstrap first.' });
      }
      next();
    } catch (e: any) {
      console.error("AUTH MIDDLEWARE ERROR:", e);
      return res.status(500).json({ error: e.message || String(e) });
    }
  });

  // Explicit bootstrap endpoint to create a dev tenant and seed default config
  router.post('/bootstrap', async (req: Request, res: Response) => {
    try {
      const tenantId = req.principal!.tenantId;
      let tenant = await deps.prisma.tenant.findUnique({ where: { id: tenantId } });
      if (!tenant) {
        tenant = await deps.prisma.tenant.create({ data: { id: tenantId, name: 'Development Tenant' } });
      }

      await deps.tenantConfigService.updateConfig(tenantId, DEFAULT_BUSINESS_CONFIG);

      res.json({ success: true, tenantId, message: 'Development environment bootstrapped.' });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET BusinessConfig
  router.get('/config', async (req: Request, res: Response) => {
    try {
      const tenantId = req.principal!.tenantId;
      const config = await deps.tenantConfigService.getConfig(tenantId);
      const record = await deps.prisma.tenantConfig.findUnique({
        where: { tenantId },
        select: { updatedAt: true }
      });
      if (record?.updatedAt) {
        res.setHeader('X-Config-Updated-At', record.updatedAt.toISOString());
        res.setHeader('Access-Control-Expose-Headers', 'X-Config-Updated-At');
      }
      res.json(config);
    } catch (e: any) {
      console.error("GET CONFIG ERROR:", e);
      res.status(500).json({ error: e.message });
    }
  });

  // Helper middleware to catch multer errors
  const parseUpload = (req: Request, res: Response, next: any) => {
    upload.single('document')(req, res, (err) => {
      if (err) {
        return res.status(400).json({
          error: 'PDF_UPLOAD_FAILED',
          message: 'Failed to process file upload',
          details: err.message
        });
      }
      next();
    });
  };

  router.post('/upload', uploadProtection.middleware, parseUpload, async (req: Request, res: Response) => {
    let currentStage = 'UPLOAD_START';
    let originalPrisma: any;
    let originalEmbeddingProvider: any;
    let originalKnowledgeRepository: any;

    try {
      const tenantId = req.principal!.tenantId;
      const file = req.file;
      
      if (process.env.NODE_ENV === 'development' && process.env.ENABLE_DEV_CONTROL_CENTER === 'true') {
        console.log(`\n--- TRACE START ---`);
        console.log(`[UPLOAD]\nfile received: ${file ? 'yes' : 'no'}\nfilename: ${file?.originalname || 'N/A'}\nmimetype: ${file?.mimetype || 'N/A'}\nsize: ${file?.size || 'N/A'}`);
      }

      if (!tenantId) {
        return res.status(400).json({ 
          error: 'PDF_UPLOAD_FAILED',
          stage: currentStage,
          message: 'tenantId is missing',
          details: 'Expected tenantId in multipart form data or query string'
        });
      }
      
      currentStage = 'TENANT_RESOLUTION';
      const tenant = await deps.prisma.tenant.findUnique({ where: { id: tenantId as string } });
      
      if (process.env.NODE_ENV === 'development' && process.env.ENABLE_DEV_CONTROL_CENTER === 'true') {
        console.log(`[TENANT]\ntenantId: ${tenantId}\ntenant found: ${tenant ? 'yes' : 'no'}`);
      }

      if (!tenant) {
        return res.status(404).json({ error: 'Tenant not found. Please bootstrap first.' });
      }

      if (!file) {
        return res.status(400).json({
          error: 'PDF_UPLOAD_FAILED',
          stage: currentStage,
          message: 'No PDF file was received',
          details: 'Expected multipart field: document'
        });
      }

      currentStage = 'FILE_VALIDATION';
      if (file.mimetype !== 'application/pdf') {
        return res.status(400).json({
          error: 'PDF_UPLOAD_FAILED',
          stage: currentStage,
          message: 'Invalid file type',
          details: `Expected application/pdf but received ${file.mimetype}`
        });
      }

      if (!isValidPdfBuffer(file.buffer)) {
        return res.status(400).json({
          error: 'PDF_UPLOAD_FAILED',
          stage: currentStage,
          message: 'Invalid file signature',
          details: 'Uploaded file does not start with a valid PDF magic header (%PDF-).'
        });
      }

      const config = await deps.tenantConfigService.getConfig(tenantId);
      
      currentStage = 'INGESTION_START';
      let embedCount = 0;
      let chunkCount = 0;

      // Safe Diagnostic Proxy Setup
      if (process.env.NODE_ENV === 'development' && process.env.ENABLE_DEV_CONTROL_CENTER === 'true') {
        originalPrisma = (deps.pdfIngestionService as any)['prisma'];
        originalEmbeddingProvider = (deps.pdfIngestionService as any)['embeddingProvider'];
        originalKnowledgeRepository = (deps.pdfIngestionService as any)['knowledgeRepository'];

        const proxyPrisma = {
          ...originalPrisma,
          knowledgeSource: {
            ...originalPrisma.knowledgeSource,
            create: async (args: any) => {
              console.log(`[INGESTION]\ningestion started: yes`);
              const record = await originalPrisma.knowledgeSource.create(args);
              console.log(`sourceId: ${record.id}`);
              return record;
            },
            findFirst: async (args: any) => originalPrisma.knowledgeSource.findFirst(args),
            update: async (args: any) => {
              if (args.data.status === 'PROCESSING') {
                currentStage = 'PDF_PARSING';
                console.log(`[PDF]\nparse started: yes`);
              } else if (args.data.status === 'COMPLETED') {
                console.log(`[CHUNKING]\nchunk count: ${chunkCount}`);
                console.log(`[EMBEDDING]\nembedding count: ${embedCount}`);
                console.log(`[DATABASE]\ncompleted: yes`);
                currentStage = 'COMPLETED';
              }
              return originalPrisma.knowledgeSource.update(args);
            }
          },
          knowledgeDocument: {
            ...originalPrisma.knowledgeDocument,
            create: async (args: any) => {
              console.log(`extracted text length: ${args.data.content?.length || 0}`);
              currentStage = 'CHUNKING';
              return originalPrisma.knowledgeDocument.create(args);
            }
          }
        };

        const proxyEmbeddingProvider = {
          ...originalEmbeddingProvider,
          embedText: async (text: string) => {
            if (embedCount === 0) {
              currentStage = 'EMBEDDING';
              console.log(`[EMBEDDING]\nembedding started: yes`);
            }
            embedCount++;
            return originalEmbeddingProvider.embedText(text);
          }
        };

        const proxyKnowledgeRepository = {
          ...originalKnowledgeRepository,
          insertChunk: async (tenantId: string, docId: string, chunk: string, embedding: number[]) => {
            if (chunkCount === 0) {
              currentStage = 'DATABASE_PERSISTENCE';
              console.log(`[DATABASE]\nsource/document persistence started: yes`);
            }
            chunkCount++;
            return originalKnowledgeRepository.insertChunk(tenantId, docId, chunk, embedding);
          }
        };

        (deps.pdfIngestionService as any)['prisma'] = proxyPrisma;
        (deps.pdfIngestionService as any)['embeddingProvider'] = proxyEmbeddingProvider;
        (deps.pdfIngestionService as any)['knowledgeRepository'] = proxyKnowledgeRepository;
      }

      const rawAccountId = (req.headers['x-account-id'] as string) || (req.query?.accountId as string) || req.body?.accountId;
      let normalizedAccountId: string | null = null;
      if (rawAccountId && typeof rawAccountId === 'string') {
        const trimmed = rawAccountId.trim();
        if (trimmed && trimmed.toLowerCase() !== 'null' && trimmed.toLowerCase() !== 'global' && trimmed.toLowerCase() !== 'undefined') {
          normalizedAccountId = trimmed;
        }
      }

      if (normalizedAccountId) {
        const account = await deps.prisma.account.findUnique({
          where: { id: normalizedAccountId }
        });
        if (!account || account.tenantId !== tenantId) {
          return res.status(404).json({
            error: 'ACCOUNT_NOT_FOUND',
            message: 'Account not found or access denied.'
          });
        }
        if (!account.enabled) {
          return res.status(400).json({
            error: 'ACCOUNT_DISABLED',
            message: `Account [${normalizedAccountId}] is disabled.`
          });
        }
      }

      const hash = crypto.createHash('sha256').update(file.buffer).digest('hex');
      const existingSource = await deps.prisma.knowledgeSource.findFirst({
        where: { tenantId, accountId: normalizedAccountId, hash, status: 'COMPLETED' }
      });
      const isReused = !!existingSource;

      let sourceId;
      try {
        sourceId = await deps.pdfIngestionService.ingestPdf(
          tenantId,
          file.buffer,
          file.originalname,
          config,
          normalizedAccountId
        );
      } catch (ingestError: any) {
        if (process.env.NODE_ENV === 'development' && process.env.ENABLE_DEV_CONTROL_CENTER === 'true') {
          console.error(`\n--- TRACE EXCEPTION AT STAGE: ${currentStage} ---`);
          console.error(ingestError);
        }
        return res.status(500).json({
          error: 'PDF_INGESTION_FAILED',
          stage: currentStage,
          message: 'Failed to ingest PDF into the knowledge base',
          details: ingestError.message
        });
      } finally {
        // Restore original dependencies
        if (originalPrisma) {
          (deps.pdfIngestionService as any)['prisma'] = originalPrisma;
          (deps.pdfIngestionService as any)['embeddingProvider'] = originalEmbeddingProvider;
          (deps.pdfIngestionService as any)['knowledgeRepository'] = originalKnowledgeRepository;
        }
      }

      // Ensure knowledge is enabled for this tenant if not already
      if (!config.knowledge?.enabled) {
        config.knowledge.enabled = true;
        await deps.tenantConfigService.updateConfig(tenantId, config);
      }

      res.json({ success: true, sourceId, accountId: normalizedAccountId, isReused });
    } catch (e: any) {
      if (process.env.NODE_ENV === 'development' && process.env.ENABLE_DEV_CONTROL_CENTER === 'true') {
        console.error(`\n--- UNEXPECTED EXCEPTION AT STAGE: ${currentStage} ---`);
        console.error(e);
      }
      res.status(500).json({ 
        error: 'UNEXPECTED_ERROR',
        stage: currentStage,
        details: e.message 
      });
    }
  });

  // POST (Update) BusinessConfig
  router.post('/config', async (req: Request, res: Response) => {
    try {
      const tenantId = req.principal!.tenantId;
      const newConfig: BusinessConfig = req.body.config;
      const clientUpdatedAt = req.body.updatedAt || req.headers['x-config-updated-at'];

      // Validate config structure loosely before persisting to prevent corruption
      if (!newConfig || !newConfig.identity || !newConfig.behavior || !newConfig.prompts) {
        return res.status(400).json({ error: 'Invalid configuration structure.' });
      }

      // Staleness guard: compare clientUpdatedAt with DB updatedAt
      if (clientUpdatedAt) {
        const existingRecord = await deps.prisma.tenantConfig.findUnique({
          where: { tenantId },
          select: { updatedAt: true }
        });
        if (existingRecord?.updatedAt && new Date(clientUpdatedAt as string).getTime() < new Date(existingRecord.updatedAt).getTime()) {
          return res.status(409).json({
            error: 'STALE_CONFIG',
            message: 'Config has changed since you loaded it — click Reload Config before saving.'
          });
        }
      }

      await deps.tenantConfigService.updateConfig(tenantId, newConfig);

      const updatedRecord = await deps.prisma.tenantConfig.findUnique({
        where: { tenantId },
        select: { updatedAt: true }
      });

      if (updatedRecord?.updatedAt) {
        res.setHeader('X-Config-Updated-At', updatedRecord.updatedAt.toISOString());
        res.setHeader('Access-Control-Expose-Headers', 'X-Config-Updated-At');
      }

      res.json({ success: true, updatedAt: updatedRecord?.updatedAt?.toISOString() });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/dev/faq/translate - Creation-time only translation helper
  router.post('/faq/translate', translateProtection.middleware, async (req: Request, res: Response) => {
    try {
      const { sourceLang, question, answer, keywords } = req.body;
      if (!question || !answer) {
        return res.status(400).json({ error: 'question and answer are required' });
      }

      const tenantId = req.principal!.tenantId;
      const config = await deps.tenantConfigService.getConfig(tenantId);
      const { provider: llm, options: llmOptions } = deps.llmFactory.getProvider(config.llm);

      const prompt = `You are an expert multilingual translator for customer support FAQs.
Given an FAQ entry in source language "${sourceLang || 'en'}", provide accurate translations/drafts for all 4 languages:
- "en": English
- "fr": French
- "ar": Modern Standard Arabic (Arabic script)
- "darija": Moroccan Darija in Latin script (Arabizi transliteration, e.g. "bghit n3rf", "dyalna")

Input:
Question: ${question}
Answer: ${answer}
Keywords: ${Array.isArray(keywords) ? keywords.join(', ') : (keywords || '')}

Respond ONLY with valid JSON (no markdown fences, no extra commentary) matching this exact structure:
{
  "questions": {
    "en": "...",
    "fr": "...",
    "ar": "...",
    "darija": "..."
  },
  "answers": {
    "en": "...",
    "fr": "...",
    "ar": "...",
    "darija": "..."
  },
  "keywords": {
    "en": ["..."],
    "fr": ["..."],
    "ar": ["..."],
    "darija": ["..."]
  }
}`;

      const rawResponse = await llm.generateResponse(prompt, [{ role: 'user', content: 'Generate translations JSON.' }], {
        ...llmOptions,
        temperature: 0.1,
        maxTokens: 1000
      });

      let parsed: any;
      try {
        const cleaned = rawResponse.trim().replace(/^```json\s*|```$/g, '').trim();
        parsed = JSON.parse(cleaned);
      } catch (err) {
        const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error(`Failed to parse translation JSON: ${rawResponse}`);
        }
      }

      res.json({ success: true, translation: parsed });
    } catch (e: any) {
      console.error('FAQ Translation Error:', e);
      res.status(500).json({ error: e.message || String(e) });
    }
  });

  // GET Uploaded Documents (Scoped to Global + Selected Account)
  router.get('/documents', async (req: Request, res: Response) => {
    try {
      const tenantId = req.principal!.tenantId;
      const rawAccountId = (req.headers['x-account-id'] as string) || (req.query?.accountId as string);
      let normalizedAccountId: string | null = null;
      if (rawAccountId && typeof rawAccountId === 'string') {
        const trimmed = rawAccountId.trim();
        if (trimmed && trimmed.toLowerCase() !== 'null' && trimmed.toLowerCase() !== 'global' && trimmed.toLowerCase() !== 'undefined') {
          normalizedAccountId = trimmed;
        }
      }

      const whereClause: any = { tenantId };
      if (normalizedAccountId) {
        whereClause.OR = [
          { accountId: null },
          { accountId: normalizedAccountId }
        ];
      } else {
        whereClause.accountId = null;
      }

      const sources = await deps.prisma.knowledgeSource.findMany({
        where: whereClause,
        include: { account: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' }
      });

      const docs = sources.map(s => ({
        id: s.id,
        sourceId: s.id,
        name: s.name,
        status: s.status,
        accountId: s.accountId,
        accountName: s.account?.name || null,
        scope: s.accountId ? 'account' : 'global',
        createdAt: s.createdAt,
        metadata: s.metadata
      }));

      res.json(docs);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // DELETE Document / Knowledge Source (cascades to KnowledgeDocument and KnowledgeChunk)
  router.delete('/documents/:sourceId', async (req: Request, res: Response) => {
    try {
      const tenantId = req.principal!.tenantId;
      const sourceId = Array.isArray(req.params.sourceId) ? req.params.sourceId[0] : req.params.sourceId;
      const rawAccountId = (req.headers['x-account-id'] as string) || (req.query?.accountId as string) || req.body?.accountId;

      let normalizedAccountId: string | null = null;
      if (rawAccountId && typeof rawAccountId === 'string') {
        const trimmed = rawAccountId.trim();
        if (trimmed && trimmed.toLowerCase() !== 'null' && trimmed.toLowerCase() !== 'global' && trimmed.toLowerCase() !== 'undefined') {
          normalizedAccountId = trimmed;
        }
      }

      // Check existence and verify strict tenant scoping
      const source = await deps.prisma.knowledgeSource.findFirst({
        where: { id: sourceId as string, tenantId }
      });

      if (!source) {
        return res.status(404).json({ error: 'Knowledge source not found or belongs to another tenant' });
      }

      // Scope authorization check:
      // If the document is account-private, verify that non-admin caller belongs to that account
      if (source.accountId && req.principal!.role !== 'admin') {
        if (normalizedAccountId && normalizedAccountId !== source.accountId) {
          return res.status(403).json({
            error: 'FORBIDDEN',
            message: 'Cannot delete a document belonging to another account.'
          });
        }
      }

      // Delete KnowledgeSource which cascades to KnowledgeDocument and KnowledgeChunk
      await deps.prisma.knowledgeSource.delete({
        where: { id: sourceId as string }
      });

      // Invalidate in-memory tenant config and knowledge caches
      deps.tenantConfigService.clearCache();

      res.json({
        success: true,
        message: `Knowledge source "${source.name}" deleted successfully.`,
        filename: source.name,
        sourceId: source.id
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST Chat with Proxy Diagnostics & Multi-modal Support
  router.post('/chat', chatProtection.middleware, async (req: Request, res: Response) => {
    const tenantId = req.principal!.tenantId;
    const { customerId, message, imageBase64, imageUrl, mimeType } = req.body;
    const accountId = (req.body.accountId as string) || (req.headers['x-account-id'] as string) || undefined;

    if (req.principal!.customerId && req.principal!.customerId !== customerId) {
      return res.status(403).json({
        error: 'FORBIDDEN',
        message: `Customer authorization mismatch: Principal is restricted to customer ${req.principal!.customerId}`
      });
    }

    if (!customerId || (!message && !imageBase64 && !imageUrl)) {
      return res.status(400).json({ error: 'customerId and message (or image payload) are required' });
    }

    const diagnosticContext: RequestDiagnosticContext = {
      intent: null,
      classificationError: null,
      chunks: []
    };

    try {
      await chatDiagnosticStorage.run(diagnosticContext, async () => {
        const start = Date.now();
        let responseText: string;
        if (imageBase64 || imageUrl) {
          responseText = await deps.conversationEngine.handleImageMessage(tenantId, customerId, {
            imageBase64,
            imageUrl,
            mimeType,
            textPrompt: message
          }, accountId);
        } else {
          responseText = await deps.conversationEngine.handleMessage(tenantId, customerId, message, accountId);
        }
        const latencyMs = Date.now() - start;

        if (!diagnosticContext.intent && message) {
          const ecomParsed = EcommerceIntentParser.parse(message);
          if (ecomParsed.intent !== 'UNKNOWN') {
            diagnosticContext.intent = ecomParsed.intent;
          }
        }

        // Fetch the conversation state for debugging purposes
        const customer = await deps.prisma.customer.findUnique({
          where: { tenantId_externalId: { tenantId, externalId: customerId } }
        });
        const conversation = customer ? await deps.prisma.conversation.findFirst({
          where: { tenantId, customerId: customer.id }
        }) : null;

        let activeWorkflowId: string | null = null;
        let activeStateId: string | null = null;
        let activeWorkflowState: string | null = null;
        let activeOptions: any[] | null = null;
        let activeSessionContext: any = {};
        let sessionCollectedData: any = {};

        if (conversation) {
          const latestSession = await deps.prisma.workflowSession.findFirst({
            where: { conversationId: conversation.id },
            orderBy: { createdAt: 'desc' }
          });

          if (latestSession) {
            activeSessionContext = latestSession.contextData || {};
            sessionCollectedData = latestSession.collectedData || {};

            if (latestSession.status === 'ACTIVE') {
              activeWorkflowId = latestSession.workflowId;
              activeStateId = latestSession.stateId;

              const tenantConfig = await deps.tenantConfigService.getConfig(tenantId);
              const wfConfig = tenantConfig.workflows?.[latestSession.workflowId];
              const stateConfig = wfConfig?.states?.[latestSession.stateId];

              if (stateConfig) {
                activeWorkflowState = stateConfig.type;
                if (stateConfig.type === 'choice' && stateConfig.options) {
                  activeOptions = stateConfig.options;
                } else if (stateConfig.type === 'confirm' || stateConfig.prompt === 'confirm') {
                  activeOptions = [
                    { label: 'Yes', next: '' },
                    { label: 'No', next: '' }
                  ];
                }
              }
            }
          }
        }

        let turnCost: any = null;
        let turnAlerts: any[] = [];
        if (deps.telemetryClient) {
          const turnEvents = deps.telemetryClient.getRecentEvents();
          if (turnEvents.length > 0) {
            const latestEvent = turnEvents[turnEvents.length - 1];
            if (latestEvent?.correlationId) {
              const latestTurnEvents = deps.telemetryClient.getRecentEvents(latestEvent.correlationId);
              const turnMetrics = CostSummaryReporter.calculateTurnMetrics(latestTurnEvents);
              turnCost = {
                llmCalls: turnMetrics.llmCalls,
                embeddingCalls: turnMetrics.embeddingCalls,
                inputTokens: turnMetrics.inputTokens,
                outputTokens: turnMetrics.outputTokens,
                retryAttempts: turnMetrics.retryAttempts,
                latencyMs: turnMetrics.totalLatencyMs || latencyMs
              };
              const report = CostAnalyticsService.generateReport(latestTurnEvents);
              turnAlerts = report.alerts;
            }
          }
        }

        res.json({
          conversationId: conversation?.id,
          message: responseText,
          workflow: activeWorkflowId || conversation?.currentWorkflowId || null,
          state: activeStateId || conversation?.currentStateId || null,
          context: {
            ...(conversation?.contextData as any || {}),
            ...activeSessionContext,
            _collectedData: sessionCollectedData
          },
          debug: {
            latencyMs,
            intent: diagnosticContext.intent,
            classificationError: diagnosticContext.classificationError,
            chunks: diagnosticContext.chunks,
            workflowState: activeWorkflowState,
            options: activeOptions,
            collectedData: sessionCollectedData,
            cost: turnCost,
            alerts: turnAlerts
          }
        });
      });
    } catch (error: any) {
      if (error.message && (error.message.includes('Concurrency Conflict') || error.message.includes('CONCURRENCY_CONFLICT'))) {
        return res.status(409).json({
          error: 'CONCURRENCY_CONFLICT',
          message: 'Our service is currently experiencing high demand. Please send your message again in a moment.',
          response: 'Our service is currently experiencing high demand. Please send your message again in a moment.'
        });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // POST Reset Conversation
  router.post('/reset', resetProtection.middleware, async (req: Request, res: Response) => {
    const tenantId = req.principal!.tenantId;
    const { customerId } = req.body;

    if (req.principal!.customerId && req.principal!.customerId !== customerId) {
      return res.status(403).json({
        error: 'FORBIDDEN',
        message: `Customer authorization mismatch: Principal is restricted to customer ${req.principal!.customerId}`
      });
    }

    try {
      const existing = await deps.prisma.conversation.findFirst({
        where: { tenantId, customerId, status: 'ACTIVE' }
      });
      
      if (existing) {
        await deps.prisma.conversation.update({
          where: { id: existing.id },
          data: {
            customerId: `${customerId}_archived_${Date.now()}`,
            status: 'COMPLETED'
          }
        });
      }
      res.json({ success: true, message: 'Conversation archived.' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // =========================================================================
  // ECOMMERCE & PRODUCT MANAGEMENT ENDPOINTS (ACCOUNT-SCOPED)
  // =========================================================================
  const productRepo = new ProductRepository(deps.prisma);

  // Helper to verify account belongs to tenant and check ecommerce capability
  async function resolveAccountScope(tenantId: string, accountId?: string | null): Promise<{ valid: boolean; account?: any; ecommerceEnabled: boolean; error?: string; status?: number }> {
    if (!accountId || typeof accountId !== 'string' || !accountId.trim()) {
      return { valid: false, ecommerceEnabled: false, error: 'accountId is required', status: 400 };
    }
    const trimmedId = accountId.trim();
    const account = await deps.prisma.account.findUnique({
      where: { id: trimmedId }
    });
    if (!account || account.tenantId !== tenantId) {
      return { valid: false, ecommerceEnabled: false, error: 'Account not found or access denied', status: 404 };
    }
    const capabilities = (account.config as any)?.capabilities;
    const ecommerceEnabled = capabilities && typeof capabilities.ecommerceEnabled === 'boolean' ? capabilities.ecommerceEnabled : true;
    return { valid: true, account, ecommerceEnabled };
  }

  // GET /api/dev/accounts - List all accounts for the authenticated tenant
  router.get('/accounts', async (req: Request, res: Response) => {
    try {
      const tenantId = req.principal!.tenantId;
      const accounts = await deps.prisma.account.findMany({
        where: { tenantId },
        orderBy: { name: 'asc' }
      });
      res.json({ accounts });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/dev/products - List products for an account
  router.get('/products', async (req: Request, res: Response) => {
    try {
      const tenantId = req.principal!.tenantId;
      const accountId = (req.query.accountId as string) || (req.headers['x-account-id'] as string);

      const check = await resolveAccountScope(tenantId, accountId);
      if (!check.valid) {
        return res.status(check.status || 400).json({ error: 'INVALID_ACCOUNT', message: check.error });
      }

      if (!check.ecommerceEnabled) {
        return res.status(403).json({
          error: 'ECOMMERCE_DISABLED',
          message: 'Ecommerce is disabled for this account.',
          ecommerceEnabled: false,
          products: []
        });
      }

      const query = req.query.query as string | undefined;
      const category = req.query.category as string | undefined;
      const activeOnly = req.query.activeOnly !== 'false';

      const products = await productRepo.search({
        tenantId,
        accountId: check.account.id,
        query,
        category,
        activeOnly,
        limit: 100
      });

      res.json({
        ecommerceEnabled: true,
        accountId: check.account.id,
        count: products.length,
        products
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/dev/products/:id - Get single product with variants
  router.get('/products/:id', async (req: Request, res: Response) => {
    try {
      const tenantId = req.principal!.tenantId;
      const accountId = (req.query.accountId as string) || (req.headers['x-account-id'] as string);
      const productId = req.params.id;

      const check = await resolveAccountScope(tenantId, accountId);
      if (!check.valid) {
        return res.status(check.status || 400).json({ error: 'INVALID_ACCOUNT', message: check.error });
      }

      if (!check.ecommerceEnabled) {
        return res.status(403).json({ error: 'ECOMMERCE_DISABLED', message: 'Ecommerce is disabled for this account.' });
      }

      const product = await productRepo.findById(tenantId, check.account.id, productId, false);
      if (!product) {
        return res.status(404).json({ error: 'NOT_FOUND', message: 'Product not found.' });
      }

      res.json({ product });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/dev/products - Create a new product
  router.post('/products', async (req: Request, res: Response) => {
    try {
      const tenantId = req.principal!.tenantId;
      const {
        accountId,
        name,
        sku,
        description,
        price,
        currency = 'USD',
        stock = 0,
        category,
        nameLocalized,
        descriptionLocalized,
        active = true
      } = req.body;

      const check = await resolveAccountScope(tenantId, accountId);
      if (!check.valid) {
        return res.status(check.status || 400).json({ error: 'INVALID_ACCOUNT', message: check.error });
      }

      if (!check.ecommerceEnabled) {
        return res.status(403).json({ error: 'ECOMMERCE_DISABLED', message: 'Ecommerce is disabled for this account.' });
      }

      if (!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Product name is required.' });
      }

      if (!sku || typeof sku !== 'string' || !sku.trim()) {
        return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Product SKU is required.' });
      }

      const numPrice = Number(price);
      if (isNaN(numPrice) || numPrice < 0) {
        return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Price must be a non-negative number.' });
      }

      const numStock = Number(stock);
      if (isNaN(numStock) || numStock < 0) {
        return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Stock must be a non-negative integer.' });
      }

      // Check duplicate SKU in this account
      const existing = await productRepo.findBySku(tenantId, check.account.id, sku);
      if (existing) {
        return res.status(409).json({ error: 'DUPLICATE_SKU', message: `A product with SKU '${sku}' already exists in this account.` });
      }

      const product = await productRepo.createProduct(tenantId, check.account.id, {
        name,
        sku,
        description,
        price: numPrice,
        currency,
        stock: Math.floor(numStock),
        category,
        nameLocalized,
        descriptionLocalized,
        active
      });

      res.status(201).json({ success: true, product });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // PATCH /api/dev/products/:id - Update product
  router.patch('/products/:id', async (req: Request, res: Response) => {
    try {
      const tenantId = req.principal!.tenantId;
      const productId = req.params.id;
      const {
        accountId,
        name,
        sku,
        description,
        price,
        currency,
        stock,
        category,
        nameLocalized,
        descriptionLocalized,
        active
      } = req.body;

      const check = await resolveAccountScope(tenantId, accountId);
      if (!check.valid) {
        return res.status(check.status || 400).json({ error: 'INVALID_ACCOUNT', message: check.error });
      }

      if (!check.ecommerceEnabled) {
        return res.status(403).json({ error: 'ECOMMERCE_DISABLED', message: 'Ecommerce is disabled for this account.' });
      }

      if (price !== undefined) {
        const numPrice = Number(price);
        if (isNaN(numPrice) || numPrice < 0) {
          return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Price must be non-negative.' });
        }
      }

      if (stock !== undefined) {
        const numStock = Number(stock);
        if (isNaN(numStock) || numStock < 0) {
          return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Stock must be non-negative.' });
        }
      }

      if (sku !== undefined) {
        const existing = await productRepo.findBySku(tenantId, check.account.id, sku);
        if (existing && existing.id !== productId) {
          return res.status(409).json({ error: 'DUPLICATE_SKU', message: `A product with SKU '${sku}' already exists in this account.` });
        }
      }

      const updated = await productRepo.updateProduct(tenantId, check.account.id, productId, {
        name,
        sku,
        description,
        price: price !== undefined ? Number(price) : undefined,
        currency,
        stock: stock !== undefined ? Math.floor(Number(stock)) : undefined,
        category,
        nameLocalized,
        descriptionLocalized,
        active
      });

      if (!updated) {
        return res.status(404).json({ error: 'NOT_FOUND', message: 'Product not found.' });
      }

      res.json({ success: true, product: updated });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // DELETE /api/dev/products/:id - Delete product
  router.delete('/products/:id', async (req: Request, res: Response) => {
    try {
      const tenantId = req.principal!.tenantId;
      const productId = req.params.id;
      const accountId = (req.query.accountId as string) || (req.body?.accountId as string);

      const check = await resolveAccountScope(tenantId, accountId);
      if (!check.valid) {
        return res.status(check.status || 400).json({ error: 'INVALID_ACCOUNT', message: check.error });
      }

      if (!check.ecommerceEnabled) {
        return res.status(403).json({ error: 'ECOMMERCE_DISABLED', message: 'Ecommerce is disabled for this account.' });
      }

      const deleted = await productRepo.deleteProduct(tenantId, check.account.id, productId);
      if (!deleted) {
        return res.status(404).json({ error: 'NOT_FOUND', message: 'Product not found.' });
      }

      res.json({ success: true, message: 'Product deleted.' });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/dev/products/:id/variants - Add variant to product
  router.post('/products/:id/variants', async (req: Request, res: Response) => {
    try {
      const tenantId = req.principal!.tenantId;
      const productId = req.params.id;
      const {
        accountId,
        sku,
        name,
        size,
        color,
        priceOverride,
        stock = 0,
        active = true
      } = req.body;

      const check = await resolveAccountScope(tenantId, accountId);
      if (!check.valid) {
        return res.status(check.status || 400).json({ error: 'INVALID_ACCOUNT', message: check.error });
      }

      if (!check.ecommerceEnabled) {
        return res.status(403).json({ error: 'ECOMMERCE_DISABLED', message: 'Ecommerce is disabled for this account.' });
      }

      if (!sku || typeof sku !== 'string' || !sku.trim()) {
        return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Variant SKU is required.' });
      }

      const numStock = Number(stock);
      if (isNaN(numStock) || numStock < 0) {
        return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Stock must be non-negative.' });
      }

      let numPriceOverride: number | null = null;
      if (priceOverride !== undefined && priceOverride !== null && priceOverride !== '') {
        numPriceOverride = Number(priceOverride);
        if (isNaN(numPriceOverride) || numPriceOverride < 0) {
          return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Price override must be non-negative.' });
        }
      }

      const variant = await productRepo.createVariant(tenantId, check.account.id, productId, {
        sku,
        name,
        size,
        color,
        priceOverride: numPriceOverride,
        stock: Math.floor(numStock),
        active
      });

      if (!variant) {
        return res.status(404).json({ error: 'NOT_FOUND', message: 'Parent product not found.' });
      }

      res.status(201).json({ success: true, variant });
    } catch (e: any) {
      if (e.code === 'P2002') {
        return res.status(409).json({ error: 'DUPLICATE_SKU', message: 'A variant with this SKU already exists.' });
      }
      res.status(500).json({ error: e.message });
    }
  });

  // PATCH /api/dev/products/:id/variants/:variantId - Update variant
  router.patch('/products/:id/variants/:variantId', async (req: Request, res: Response) => {
    try {
      const tenantId = req.principal!.tenantId;
      const { id: productId, variantId } = req.params;
      const {
        accountId,
        sku,
        name,
        size,
        color,
        priceOverride,
        stock,
        active
      } = req.body;

      const check = await resolveAccountScope(tenantId, accountId);
      if (!check.valid) {
        return res.status(check.status || 400).json({ error: 'INVALID_ACCOUNT', message: check.error });
      }

      if (!check.ecommerceEnabled) {
        return res.status(403).json({ error: 'ECOMMERCE_DISABLED', message: 'Ecommerce is disabled for this account.' });
      }

      let numPriceOverride: number | null | undefined = undefined;
      if (priceOverride !== undefined) {
        if (priceOverride === null || priceOverride === '') {
          numPriceOverride = null;
        } else {
          numPriceOverride = Number(priceOverride);
          if (isNaN(numPriceOverride) || numPriceOverride < 0) {
            return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Price override must be non-negative.' });
          }
        }
      }

      const variant = await productRepo.updateVariant(tenantId, check.account.id, productId, variantId, {
        sku,
        name,
        size,
        color,
        priceOverride: numPriceOverride,
        stock: stock !== undefined ? Math.floor(Number(stock)) : undefined,
        active
      });

      if (!variant) {
        return res.status(404).json({ error: 'NOT_FOUND', message: 'Product or variant not found.' });
      }

      res.json({ success: true, variant });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // DELETE /api/dev/products/:id/variants/:variantId - Delete variant
  router.delete('/products/:id/variants/:variantId', async (req: Request, res: Response) => {
    try {
      const tenantId = req.principal!.tenantId;
      const { id: productId, variantId } = req.params;
      const accountId = (req.query.accountId as string) || (req.body?.accountId as string);

      const check = await resolveAccountScope(tenantId, accountId);
      if (!check.valid) {
        return res.status(check.status || 400).json({ error: 'INVALID_ACCOUNT', message: check.error });
      }

      if (!check.ecommerceEnabled) {
        return res.status(403).json({ error: 'ECOMMERCE_DISABLED', message: 'Ecommerce is disabled for this account.' });
      }

      const deleted = await productRepo.deleteVariant(tenantId, check.account.id, productId, variantId);
      if (!deleted) {
        return res.status(404).json({ error: 'NOT_FOUND', message: 'Product or variant not found.' });
      }

      res.json({ success: true, message: 'Variant deleted.' });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // =========================================================================
  // PILOT AUTO REPAIR TEST HARNESS ENDPOINTS (STRICT TENANT LOCK)
  // =========================================================================

  // GET /api/dev/pilot-harness/kb - Live pull of pilot-auto-repair KB & FAQs
  router.get('/pilot-harness/kb', async (req: Request, res: Response) => {
    try {
      const tenantId = req.principal!.tenantId;
      if (tenantId !== 'pilot-auto-repair' && req.principal!.role !== 'admin') {
        return res.status(403).json({
          error: 'TENANT_LOCK_VIOLATION',
          message: `Tenant lock error: only 'pilot-auto-repair' is permitted. Attempted: '${tenantId}'`
        });
      }

      const tenantConfig = await deps.tenantConfigService.getConfig('pilot-auto-repair');
      const docs = await deps.prisma.knowledgeDocument.findMany({
        where: { tenantId: 'pilot-auto-repair' },
        include: { chunks: true }
      });

      res.json({
        tenantId: 'pilot-auto-repair',
        imageEnabled: tenantConfig.capabilities?.imageEnabled ?? false,
        faqs: tenantConfig.capabilities?.faq || [],
        documents: docs.map(d => ({
          id: d.id,
          title: d.title,
          content: d.content,
          chunkCount: d.chunks.length,
          chunks: d.chunks.map(c => ({ id: c.id, content: c.content }))
        }))
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/dev/pilot-harness/preset-image/:name
  router.get('/pilot-harness/preset-image/:name', (req: Request, res: Response) => {
    const name = req.params.name;
    const file = name === 'maf' ? 'maf_sensor.jpg' : 'worn_brake_pad.jpg';
    const filePath = path.join(process.cwd(), 'test/data/real-images', file);
    if (fs.existsSync(filePath)) {
      res.sendFile(filePath);
    } else {
      res.status(404).send('Preset image not found');
    }
  });

  // POST /api/dev/pilot-harness/chat - Execute real pipeline against pilot-auto-repair
  router.post('/pilot-harness/chat', pilotChatProtection.middleware, async (req: Request, res: Response) => {
    try {
      const tenantId = req.principal!.tenantId;
      if (tenantId !== 'pilot-auto-repair' && req.principal!.role !== 'admin') {
        return res.status(403).json({
          error: 'TENANT_LOCK_VIOLATION',
          message: `Tenant lock error: only 'pilot-auto-repair' is permitted. Attempted: '${tenantId}'`
        });
      }

      const { text, imageBase64, mimeType, customerId = `pilot_cust_${Date.now()}` } = req.body;

      const hasImage = Boolean(imageBase64);
      const hasText = Boolean(text && text.trim().length > 0);

      // Execute Image Capability Gateway analysis if image present
      let realAnalysis: any = null;
      let gatewayLatencyMs: number | null = null;
      let imageError: string | null = null;

      if (hasImage) {
        const gwStart = Date.now();
        try {
          realAnalysis = await deps.imageGateway.analyzeImage('pilot-auto-repair', {
            imageBase64,
            mimeType: mimeType || 'image/jpeg'
          });
          gatewayLatencyMs = Date.now() - gwStart;
        } catch (err: any) {
          imageError = err.message || String(err);
          gatewayLatencyMs = Date.now() - gwStart;
          realAnalysis = {
            success: false,
            error: imageError,
            model: 'unknown'
          };
        }
      }

      // Execute ConversationEngine real pipeline
      const pipelineStart = Date.now();
      let responseText: string;
      if (hasImage) {
        responseText = await deps.conversationEngine.handleImageMessage('pilot-auto-repair', customerId, {
          imageBase64,
          mimeType: mimeType || 'image/jpeg',
          textPrompt: hasText ? text : undefined,
          precomputedImageAnalysis: realAnalysis
        });
      } else {
        responseText = await deps.conversationEngine.handleMessage('pilot-auto-repair', customerId, text || '');
      }
      const totalLatencyMs = Date.now() - pipelineStart;

      // Classify message type strictly based on input payload
      const classificationType = hasText && hasImage ? 'TEXT_AND_IMAGE' : hasImage ? 'IMAGE' : 'TEXT';

      // Per-layer status evaluation
      const layerStatus = {
        imageReceived: hasImage ? 'PASS' : 'FAIL',
        imageAnalysis: hasImage ? (realAnalysis && !imageError ? 'PASS' : 'FAIL') : 'N/A',
        classification: (hasImage || hasText) ? 'PASS' : 'FAIL',
        classificationType,
        combinedQuery: 'NOT EXPOSED', // Internal engine variable not surfaced in public API
        faqRagMatch: 'NOT EXPOSED',    // Matched FAQ/RAG record not surfaced in public engine return
        finalAnswer: responseText ? 'PASS' : 'FAIL'
      };

      res.json({
        tenantId: 'pilot-auto-repair',
        customerId,
        input: {
          text: text || null,
          hasImage,
          mimeType: mimeType || null
        },
        response: responseText,
        imageAnalysis: realAnalysis,
        layerStatus,
        observability: {
          totalLatencyMs,
          gatewayLatencyMs,
          combinedQuery: 'Not available from current pipeline',
          matchedFaqOrRag: 'Not available from current pipeline',
          diagnosticReasoning: 'Not available from current pipeline'
        }
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET Cost Analytics & Budget Alerts
  router.get('/cost-analytics', async (req: Request, res: Response) => {
    try {
      const clientTenantId = (req.headers['x-tenant-id'] as string) || (req.query?.tenantId as string) || req.principal?.tenantId;
      const events = deps.telemetryClient ? deps.telemetryClient.getRecentEvents() : [];
      const tenantEvents = clientTenantId && req.principal?.role !== 'admin'
        ? events.filter(e => e.tenantId === clientTenantId)
        : events;

      const report = CostAnalyticsService.generateReport(tenantEvents);
      res.json(report);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}
