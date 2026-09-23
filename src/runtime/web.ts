import 'dotenv/config';
import { config } from '../config/env';
import { logger } from '../utils/logger';
import { initDatabase, validateProcessConfig, setupSignalHandlers } from './shared';
import { bootstrapWebDependencies, bootstrapWorkerDependencies, WebDependencies, WorkerDependencies } from '../bootstrap';
import { createApp } from '../app';
import type { Server } from 'http';
import type express from 'express';

export interface WebRuntimeInstance {
  app: express.Application;
  server: Server;
  deps: WebDependencies;
  workerDeps?: WorkerDependencies;
  shutdown: () => Promise<void>;
}

export async function startWebServer(): Promise<WebRuntimeInstance> {
  validateProcessConfig('web');

  const { pool, prisma } = await initDatabase({ processType: 'web' });
  const deps = bootstrapWebDependencies(prisma);
  const workerDeps = process.env.RUN_WORKER_IN_WEB === 'true'
    ? bootstrapWorkerDependencies(prisma, {
        workerConcurrency: Number(process.env.WHATSAPP_QUEUE_WORKER_CONCURRENCY || 2),
        autoStartQueue: true,
        enableDocumentWorker: process.env.PORTAL_DOCUMENT_WORKER === 'true'
      })
    : undefined;
  const app = await createApp(deps);

  const host = process.env.HOST || '0.0.0.0';
  const port = Number(process.env.PORT || config.port || 3000);

  const server = app.listen(port, host, () => {
    logger.info(`[WEB] Relayqo Web service running on http://${host}:${port}`);
    if (workerDeps) logger.info('[WEB] In-process WhatsApp worker enabled');
  });

  const shutdown = async () => {
    logger.info('[WEB] Closing HTTP server and draining connections...');
    await new Promise<void>((resolve) => {
      server.close((err) => {
        if (err) logger.warn(`[WEB] Server close warning: ${err.message}`);
        resolve();
      });
    });

    if (workerDeps?.whatsAppMessageQueue) {
      await workerDeps.whatsAppMessageQueue.shutdown();
    }
    if (workerDeps?.whatsAppOutboundQueue) {
      await workerDeps.whatsAppOutboundQueue.shutdown();
    }
    if (workerDeps?.portalService) {
      workerDeps.portalService.stop();
    }
    if (deps.whatsAppOutboundQueue) {
      await deps.whatsAppOutboundQueue.shutdown();
    }

    if (deps.portalService) {
      deps.portalService.stop();
    }

    logger.info('[WEB] Disconnecting database pool...');
    await prisma.$disconnect();
    await pool.end();
    logger.info('[WEB] Web runtime shutdown complete.');
  };

  setupSignalHandlers('WEB', shutdown, 15000);

  return { app, server, deps, workerDeps, shutdown };
}

if (require.main === module && process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
  startWebServer().catch((err) => {
    logger.error(`[WEB] Fatal startup error: ${err.message || err}`, err);
    process.exit(1);
  });
}
