import 'dotenv/config';
import { config } from '../config/env';
import { logger } from '../utils/logger';
import { initDatabase, validateProcessConfig, setupSignalHandlers } from './shared';
import { bootstrapWebDependencies, WebDependencies } from '../bootstrap';
import { createApp } from '../app';
import type { Server } from 'http';
import type express from 'express';

export interface WebRuntimeInstance {
  app: express.Application;
  server: Server;
  deps: WebDependencies;
  shutdown: () => Promise<void>;
}

export async function startWebServer(): Promise<WebRuntimeInstance> {
  validateProcessConfig('web');

  const { pool, prisma } = await initDatabase({ processType: 'web' });
  const deps = bootstrapWebDependencies(prisma);
  const app = await createApp(deps);

  const host = process.env.HOST || '0.0.0.0';
  const port = Number(process.env.PORT || config.port || 3000);

  const server = app.listen(port, host, () => {
    logger.info(`[WEB] Relayqo Web service running on http://${host}:${port}`);
  });

  const shutdown = async () => {
    logger.info('[WEB] Closing HTTP server and draining connections...');
    await new Promise<void>((resolve) => {
      server.close((err) => {
        if (err) logger.warn(`[WEB] Server close warning: ${err.message}`);
        resolve();
      });
    });

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

  return { app, server, deps, shutdown };
}

if (require.main === module && process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
  startWebServer().catch((err) => {
    logger.error(`[WEB] Fatal startup error: ${err.message || err}`, err);
    process.exit(1);
  });
}
