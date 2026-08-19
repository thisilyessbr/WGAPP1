import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import { Server } from 'http';
import { monitoringConfig } from './config';
import { TelemetryStorage } from './storage/TelemetryStorage';
import { IngestionService } from './ingestion/IngestionService';
import { TraceQueryService } from './traces/TraceQueryService';
import { requireAdminAuth } from './admin/auth';
import { AdminQueryService } from './admin/AdminQueryService';
import { getAdminUiHtml } from './admin/ui';

export function createMonitoringApp(
  storage: TelemetryStorage,
  ingestionService: IngestionService,
  traceService: TraceQueryService,
  adminService?: AdminQueryService
): Express {
  const app = express();
  const adminQueryService = adminService || new AdminQueryService(storage);

  app.use(cors());
  app.use(express.json({ limit: '2mb' }));

  // 1. Health Endpoint (Observation only, independent of chatbot services)
  app.get('/api/monitoring/health', async (req: Request, res: Response) => {
    const dbHealthy = await storage.checkHealth();
    res.json({
      status: dbHealthy ? 'healthy' : 'degraded',
      service: 'monitoring-service',
      version: '1.0.0',
      database: dbHealthy ? 'connected' : 'disconnected',
      poolMax: monitoringConfig.databasePoolMax,
      retentionDays: monitoringConfig.retentionDays,
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString()
    });
  });

  // 2. Telemetry Ingestion Endpoint
  app.post('/api/telemetry/ingest', async (req: Request, res: Response) => {
    try {
      const result = await ingestionService.processPayload(req.body);
      if (!result.success && (result.errors?.length || 0) > 0 && result.accepted === 0) {
        return res.status(400).json(result);
      }
      return res.status(result.accepted > 0 ? 200 : 202).json(result);
    } catch (err: any) {
      console.error('[monitoring-service] Ingestion unhandled error:', err.message || err);
      return res.status(500).json({
        success: false,
        error: 'INGESTION_FAILED',
        message: err.message || String(err)
      });
    }
  });

  // 3. Trace Query Endpoints (Internal / Private Interface)
  // GET /api/monitoring/traces/:correlationId
  app.get('/api/monitoring/traces/:correlationId', async (req: Request, res: Response) => {
    try {
      const { correlationId } = req.params;
      const result = await traceService.getTraceByCorrelationId(correlationId);
      return res.json(result);
    } catch (err: any) {
      console.error('[monitoring-service] Trace query error:', err.message || err);
      return res.status(500).json({
        success: false,
        error: 'TRACE_QUERY_FAILED',
        message: err.message || String(err)
      });
    }
  });

  // GET /api/monitoring/traces?tenantId=<tenantId>&limit=<limit>
  app.get('/api/monitoring/traces', async (req: Request, res: Response) => {
    try {
      const tenantId = req.query.tenantId as string;
      if (!tenantId) {
        return res.status(400).json({
          success: false,
          error: 'MISSING_TENANT_ID',
          message: 'Query parameter tenantId is required'
        });
      }
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
      const result = await traceService.getTracesByTenantId(tenantId, limit);
      return res.json(result);
    } catch (err: any) {
      console.error('[monitoring-service] Tenant traces query error:', err.message || err);
      return res.status(500).json({
        success: false,
        error: 'TENANT_TRACES_FAILED',
        message: err.message || String(err)
      });
    }
  });

  // 4. Admin API Endpoints (Protected by requireAdminAuth)

  // --- Phase 5C: Turn-Centric Admin Endpoints ---
  // IMPORTANT: These must be registered BEFORE the generic :correlationId routes
  // to avoid path parameter capture.

  // GET /api/admin/turns?tenantId=<tenantId>&limit=<limit>&outcome=&stage=&primaryFailure=&responseSource=
  app.get('/api/admin/turns', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const tenantId = req.query.tenantId as string;
      if (!tenantId || !tenantId.trim()) {
        return res.status(400).json({
          error: 'MISSING_TENANT_ID',
          message: 'Query parameter tenantId is required'
        });
      }
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
      const filters = {
        outcome: req.query.outcome as string | undefined,
        stage: req.query.stage as string | undefined,
        primaryFailure: req.query.primaryFailure as string | undefined,
        responseSource: req.query.responseSource as string | undefined,
      };
      const result = await adminQueryService.getTurnsByTenantId(tenantId.trim(), limit, filters);
      return res.json(result);
    } catch (err: any) {
      console.error('[monitoring-service] Admin tenant turns error:', err.message || err);
      return res.status(500).json({
        error: 'ADMIN_QUERY_FAILED',
        message: 'Failed to retrieve tenant turns'
      });
    }
  });

  // GET /api/admin/turns/:correlationId — Full drill-down for a single turn
  app.get('/api/admin/turns/:correlationId', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { correlationId } = req.params;
      const result = await adminQueryService.getTurnDetailByCorrelationId(correlationId);
      return res.json(result);
    } catch (err: any) {
      console.error('[monitoring-service] Admin turn detail error:', err.message || err);
      return res.status(500).json({
        error: 'ADMIN_QUERY_FAILED',
        message: 'Failed to retrieve turn detail'
      });
    }
  });

  // GET /api/admin/conversations/:conversationId/turns — Turn-centric conversation view
  app.get('/api/admin/conversations/:conversationId/turns', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { conversationId } = req.params;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
      const filters = {
        outcome: req.query.outcome as string | undefined,
        stage: req.query.stage as string | undefined,
        primaryFailure: req.query.primaryFailure as string | undefined,
        responseSource: req.query.responseSource as string | undefined,
      };
      const result = await adminQueryService.getTurnsByConversationId(conversationId, limit, filters);
      return res.json(result);
    } catch (err: any) {
      console.error('[monitoring-service] Admin conversation turns error:', err.message || err);
      return res.status(500).json({
        error: 'ADMIN_QUERY_FAILED',
        message: 'Failed to retrieve conversation turns'
      });
    }
  });

  // GET /api/admin/conversations/:conversationId/messages — Safe Admin transcript retrieval bridge
  app.get('/api/admin/conversations/:conversationId/messages', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { conversationId } = req.params;
      const tenantId = req.query.tenantId as string;
      if (!tenantId || !tenantId.trim()) {
        return res.status(400).json({
          error: 'MISSING_TENANT_ID',
          message: 'Query parameter tenantId is required'
        });
      }
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
      const result = await adminQueryService.getConversationMessages(tenantId.trim(), conversationId, limit);
      return res.json(result);
    } catch (err: any) {
      console.error('[monitoring-service] Admin conversation messages error:', err.message || err);
      return res.status(500).json({
        error: 'ADMIN_QUERY_FAILED',
        message: 'Failed to retrieve conversation messages'
      });
    }
  });

  // --- Existing Admin Trace Endpoints ---

  // GET /api/admin/traces/:correlationId/diagnosis
  app.get('/api/admin/traces/:correlationId/diagnosis', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { correlationId } = req.params;
      const result = await adminQueryService.getDiagnosisByCorrelationId(correlationId);
      return res.json(result);
    } catch (err: any) {
      console.error('[monitoring-service] Admin correlation diagnosis error:', err.message || err);
      return res.status(500).json({
        error: 'ADMIN_QUERY_FAILED',
        message: 'Failed to retrieve correlation diagnosis'
      });
    }
  });

  // GET /api/admin/traces/:correlationId
  app.get('/api/admin/traces/:correlationId', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { correlationId } = req.params;
      const result = await adminQueryService.getTraceByCorrelationId(correlationId);
      return res.json(result);
    } catch (err: any) {
      console.error('[monitoring-service] Admin correlation trace error:', err.message || err);
      return res.status(500).json({
        error: 'ADMIN_QUERY_FAILED',
        message: 'Failed to retrieve correlation trace'
      });
    }
  });

  // GET /api/admin/traces?tenantId=<tenantId>&limit=<limit>
  app.get('/api/admin/traces', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const tenantId = req.query.tenantId as string;
      if (!tenantId || !tenantId.trim()) {
        return res.status(400).json({
          error: 'MISSING_TENANT_ID',
          message: 'Query parameter tenantId is required'
        });
      }
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
      const result = await adminQueryService.getTracesByTenantId(tenantId.trim(), limit);
      return res.json(result);
    } catch (err: any) {
      console.error('[monitoring-service] Admin tenant traces error:', err.message || err);
      return res.status(500).json({
        error: 'ADMIN_QUERY_FAILED',
        message: 'Failed to retrieve tenant traces'
      });
    }
  });

  // GET /api/admin/conversations/:conversationId
  app.get('/api/admin/conversations/:conversationId', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { conversationId } = req.params;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
      const result = await adminQueryService.getEventsByConversationId(conversationId, limit);
      return res.json(result);
    } catch (err: any) {
      console.error('[monitoring-service] Admin conversation trace error:', err.message || err);
      return res.status(500).json({
        error: 'ADMIN_QUERY_FAILED',
        message: 'Failed to retrieve conversation traces'
      });
    }
  });

  // 5. Minimal Admin Trace UI
  const serveAdminUi = (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(getAdminUiHtml());
  };

  app.get('/admin', serveAdminUi);
  app.get('/admin/traces', serveAdminUi);
  app.get('/admin/turns', serveAdminUi);
  app.get('/admin/conversations', serveAdminUi);

  return app;
}

export async function startMonitoringServer(overridePort?: number, overrideHost?: string): Promise<{ server: Server; storage: TelemetryStorage }> {
  const storage = new TelemetryStorage();
  await storage.init();

  const ingestionService = new IngestionService(storage);
  const traceService = new TraceQueryService(storage);
  const adminService = new AdminQueryService(storage);
  const app = createMonitoringApp(storage, ingestionService, traceService, adminService);

  const port = overridePort || monitoringConfig.port;
  const host = overrideHost || monitoringConfig.host;

  return new Promise((resolve) => {
    const server = app.listen(port, host, () => {
      console.log(`[monitoring-service] Running independently on http://${host}:${port}`);
      resolve({ server, storage });
    });
  });
}
