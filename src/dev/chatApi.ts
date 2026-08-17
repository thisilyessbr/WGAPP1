import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { ChatbotDependencies } from '../bootstrap';
import multer from 'multer';
import { BusinessConfig, DEFAULT_BUSINESS_CONFIG } from '../domain/tenant/BusinessConfig';

// Setup multer for in-memory file uploads (max 10MB default)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

export function createDevChatRouter(deps: ChatbotDependencies): Router {
  const router = Router();

  // Explicit bootstrap endpoint to create a dev tenant and seed default config
  router.post('/bootstrap', async (req: Request, res: Response) => {
    try {
      const tenantId = 'dev-tenant';
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

  // Tenant Validation Middleware
  router.use(async (req: Request, res: Response, next) => {
    if (req.path === '/upload' || req.path.startsWith('/pilot-harness')) {
      return next(); // Handled by route-specific validators
    }
    const tenantId = req.body?.tenantId || req.query?.tenantId;
    if (!tenantId) {
      return res.status(400).json({ error: 'tenantId is required' });
    }
    try {
      const tenant = await deps.prisma.tenant.findUnique({ where: { id: tenantId as string } });
      if (!tenant) {
        return res.status(404).json({ error: 'Tenant not found. Please bootstrap first.' });
      }
      next();
    } catch (e: any) {
      console.error("MIDDLEWARE ERROR:", e);
      return res.status(500).json({ error: e.message || String(e) });
    }
  });

  // GET BusinessConfig
  router.get('/config', async (req: Request, res: Response) => {
    try {
      const tenantId = req.query.tenantId as string;
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

  // Move /upload BEFORE the global tenant validation middleware, 
  // so multer parses the body FIRST, then we manually validate tenantId.
  router.post('/upload', parseUpload, async (req: Request, res: Response) => {
    let currentStage = 'UPLOAD_START';
    let originalPrisma: any;
    let originalEmbeddingProvider: any;
    let originalKnowledgeRepository: any;

    try {
      const tenantId = req.body?.tenantId || req.query?.tenantId;
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

      let sourceId;
      try {
        sourceId = await deps.pdfIngestionService.ingestPdf(
          tenantId,
          file.buffer,
          file.originalname,
          config
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

      res.json({ success: true, sourceId });
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
      const tenantId = req.body.tenantId;
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
  router.post('/faq/translate', async (req: Request, res: Response) => {
    try {
      const { sourceLang, question, answer, keywords } = req.body;
      if (!question || !answer) {
        return res.status(400).json({ error: 'question and answer are required' });
      }

      const tenantId = (req.body?.tenantId || req.query?.tenantId || 'dev-tenant') as string;
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

  // GET Uploaded Documents
  router.get('/documents', async (req: Request, res: Response) => {
    try {
      const tenantId = req.query.tenantId as string;
      const sources = await deps.prisma.knowledgeSource.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' }
      });

      const docs = sources.map(s => ({
        id: s.id,
        sourceId: s.id,
        name: s.name,
        status: s.status,
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
      const tenantId = (req.body?.tenantId || req.query?.tenantId) as string;
      const { sourceId } = req.params;

      if (!tenantId) {
        return res.status(400).json({ error: 'tenantId is required' });
      }

      // Check existence and verify strict tenant scoping
      const source = await deps.prisma.knowledgeSource.findUnique({
        where: { id: sourceId }
      });

      if (!source || source.tenantId !== tenantId) {
        return res.status(404).json({ error: 'Knowledge source not found or belongs to another tenant' });
      }

      // Delete KnowledgeSource which cascades to KnowledgeDocument and KnowledgeChunk
      await deps.prisma.knowledgeSource.delete({
        where: { id: sourceId }
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
  router.post('/chat', async (req: Request, res: Response) => {
    const { tenantId, customerId, message, imageBase64, imageUrl, mimeType } = req.body;

    if (!customerId || (!message && !imageBase64 && !imageUrl)) {
      return res.status(400).json({ error: 'customerId and message (or image payload) are required' });
    }

    try {
      // Diagnostic Interceptors
      let interceptedIntent: string | null = null;
      let interceptedClassificationError: string | null = null;
      let interceptedChunks: any[] = [];

      // Intercept LLM via LLMFactory
      const originalFactory = (deps.conversationEngine as any)['llmFactory'];
      const originalLlm = (deps.conversationEngine as any)['defaultLlm'];
      const originalRag = (deps.conversationEngine as any)['ragService'];

      if (originalFactory) {
        const interceptedFactory = {
          ...originalFactory,
          getProvider: (cfg: any) => {
            const resolved = originalFactory.getProvider(cfg);
            const originalProv = resolved.provider;
            const interceptedProv = {
              ...originalProv,
              classifyIntent: async (p: string, m: string, a: string[], opt: any) => {
                try {
                  const intent = await originalProv.classifyIntent(p, m, a, opt);
                  interceptedIntent = intent;
                  return intent;
                } catch (error: any) {
                  interceptedClassificationError = error.message || String(error);
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

      // Proxy RAG to intercept retrieved chunks as structured array while preserving all prototype methods
      const interceptedRag = new Proxy(originalRag, {
        get(target: any, prop: string | symbol, receiver: any) {
          if (prop === 'retrieveChunks') {
            return async (tenantId: string, q: string, config: any) => {
              const chunks = await target.retrieveChunks(tenantId, q, config);
              interceptedChunks = chunks;
              return chunks;
            };
          }
          if (prop === 'retrieveContext') {
            return async (tenantId: string, q: string, config: any) => {
              const chunks = await target.retrieveChunks(tenantId, q, config);
              interceptedChunks = chunks;
              return target.formatContext(chunks, config.knowledge.maxContextSize);
            };
          }
          if (prop === 'retrieve') {
            return async (tenantId: string, q: string, config: any) => {
              const result = await target.retrieve(tenantId, q, config);
              interceptedChunks = result.chunks || [];
              return result;
            };
          }
          const val = Reflect.get(target, prop, receiver);
          return typeof val === 'function' ? val.bind(target) : val;
        }
      });
      
      (deps.conversationEngine as any)['ragService'] = interceptedRag;

      const start = Date.now();
      let responseText: string;
      if (imageBase64 || imageUrl) {
        responseText = await deps.conversationEngine.handleImageMessage(tenantId, customerId, {
          imageBase64,
          imageUrl,
          mimeType,
          textPrompt: message
        });
      } else {
        responseText = await deps.conversationEngine.handleMessage(tenantId, customerId, message);
      }
      const latencyMs = Date.now() - start;

      // Restore original dependencies
      if (originalFactory) {
        (deps.conversationEngine as any)['llmFactory'] = originalFactory;
      }
      (deps.conversationEngine as any)['ragService'] = originalRag;

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
          intent: interceptedIntent,
          classificationError: interceptedClassificationError,
          chunks: interceptedChunks,
          workflowState: activeWorkflowState,
          options: activeOptions,
          collectedData: sessionCollectedData
        }
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST Reset Conversation
  router.post('/reset', async (req: Request, res: Response) => {
    const { tenantId, customerId } = req.body;
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
  // PILOT AUTO REPAIR TEST HARNESS ENDPOINTS (STRICT TENANT LOCK)
  // =========================================================================

  // GET /api/dev/pilot-harness/kb - Live pull of pilot-auto-repair KB & FAQs
  router.get('/pilot-harness/kb', async (req: Request, res: Response) => {
    try {
      const requestedTenant = (req.query.tenantId as string) || 'pilot-auto-repair';
      if (requestedTenant !== 'pilot-auto-repair') {
        return res.status(400).json({
          error: 'TENANT_LOCK_VIOLATION',
          message: `Tenant lock error: only 'pilot-auto-repair' is permitted. Attempted: '${requestedTenant}'`
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
  router.post('/pilot-harness/chat', async (req: Request, res: Response) => {
    try {
      const requestedTenant = req.body?.tenantId || 'pilot-auto-repair';
      if (requestedTenant !== 'pilot-auto-repair') {
        return res.status(400).json({
          error: 'TENANT_LOCK_VIOLATION',
          message: `Tenant lock error: only 'pilot-auto-repair' is permitted. Attempted: '${requestedTenant}'`
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
        }
      }

      // Execute ConversationEngine real pipeline
      const pipelineStart = Date.now();
      let responseText: string;
      if (hasImage) {
        responseText = await deps.conversationEngine.handleImageMessage('pilot-auto-repair', customerId, {
          imageBase64,
          mimeType: mimeType || 'image/jpeg',
          textPrompt: hasText ? text : undefined
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

  return router;
}
