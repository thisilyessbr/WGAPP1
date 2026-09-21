import 'dotenv/config';
import { logger } from '../utils/logger';
import { initDatabase, validateProcessConfig, setupSignalHandlers } from './shared';
import { bootstrapWorkerDependencies, WorkerDependencies } from '../bootstrap';

export interface WorkerRuntimeInstance {
  deps: WorkerDependencies;
  shutdown: () => Promise<void>;
}

export async function startWorkerProcess(): Promise<WorkerRuntimeInstance> {
  validateProcessConfig('worker');

  const { pool, prisma } = await initDatabase({ processType: 'worker' });
  const concurrency = Number(process.env.WHATSAPP_QUEUE_WORKER_CONCURRENCY || 2);

  const deps = bootstrapWorkerDependencies(prisma, {
    workerConcurrency: concurrency,
    autoStartQueue: true
  });

  logger.info(`[WORKER] Relayqo WhatsApp Worker started (concurrency: ${concurrency})`);

  const shutdown = async () => {
    logger.info('[WORKER] Stopping queue worker and awaiting in-flight jobs...');
    if (deps.whatsAppMessageQueue) {
      await deps.whatsAppMessageQueue.shutdown();
    }
    if (deps.whatsAppOutboundQueue) {
      await deps.whatsAppOutboundQueue.shutdown();
    }
    if (deps.portalService) {
      deps.portalService.stop();
    }
    logger.info('[WORKER] Disconnecting database pool...');
    await prisma.$disconnect();
    await pool.end();
    logger.info('[WORKER] Worker runtime shutdown complete.');
  };

  setupSignalHandlers('WORKER', shutdown, 25000);

  return { deps, shutdown };
}

if (require.main === module && process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
  startWorkerProcess().catch((err) => {
    logger.error(`[WORKER] Fatal worker error: ${err.message || err}`, err);
    process.exit(1);
  });
}
