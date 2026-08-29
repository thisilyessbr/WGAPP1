import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from './config/env';
import { logger } from './utils/logger';
import { bootstrapChatbot } from './bootstrap';
import { createApiRouter } from './dev/chatApi';

export async function createApp(deps: ReturnType<typeof bootstrapChatbot>): Promise<express.Application> {
  const app = express();

  // Configure Express for 1-hop reverse proxy (Nginx, Caddy, Cloudflare, AWS ALB)
  app.set('trust proxy', 1);

  app.use(cors());
  app.use(express.json({ limit: '15mb' }));

  // Root-level health check endpoint
  app.get('/health', async (req, res) => {
    try {
      await deps.prisma.$queryRaw`SELECT 1`;
      res.json({
        status: 'healthy',
        service: 'chatbot-api',
        timestamp: new Date().toISOString()
      });
    } catch (err: any) {
      res.status(503).json({
        status: 'unhealthy',
        error: 'DATABASE_UNAVAILABLE',
        message: err.message || String(err)
      });
    }
  });

  const apiRouter = createApiRouter(deps);

  // Production API Routes (/api/v1 and /api)
  app.use('/api/v1', apiRouter);
  app.use('/api', apiRouter);

  // Development Control Center UI and dev endpoint alias
  if (process.env.NODE_ENV === 'development' && process.env.ENABLE_DEV_CONTROL_CENTER === 'true') {
    app.use('/api/dev', apiRouter);
    app.use('/', express.static(path.join(__dirname, 'dev/ui')));
    logger.info(`Developer Control Center available at http://localhost:${config.port}/`);
  } else {
    // Keep /api/dev aliased for backward compatibility with integration test scripts
    app.use('/api/dev', apiRouter);
    logger.info('Development Control Center UI is disabled.');
  }

  return app;
}

async function bootstrap() {
  try {
    let dbUrl = process.env.DATABASE_URL;
    if (dbUrl && dbUrl.startsWith('prisma+postgres://')) {
      const urlObj = new URL(dbUrl);
      const apiKey = urlObj.searchParams.get('api_key');
      if (apiKey) {
        const decoded = JSON.parse(Buffer.from(apiKey, 'base64').toString('utf8'));
        dbUrl = decoded.databaseUrl;
      }
    }

    const pool = new Pool({ connectionString: dbUrl });
    const adapter = new PrismaPg(pool);
    const prisma = new PrismaClient({ adapter });
    await prisma.$connect();
    logger.info('Database connected');

    const deps = bootstrapChatbot(prisma);
    const app = await createApp(deps);

    app.listen(config.port, () => {
      logger.info(`Server started on port ${config.port}`);
    });

    // Graceful shutdown
    const shutdown = async () => {
      logger.info('Shutting down gracefully.');
      await prisma.$disconnect();
      process.exit(0);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

  } catch (error) {
    logger.error('Error during bootstrap', error);
    process.exit(1);
  }
}

if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
  bootstrap();
}

