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
import { createWhatsAppWebhookRouter } from './domain/channel/whatsapp/WhatsAppWebhookRouter';
import { createWhatsAppOnboardingRouter } from './domain/channel/whatsapp/WhatsAppOnboardingRouter';

export async function createApp(deps: ReturnType<typeof bootstrapChatbot>): Promise<express.Application> {
  const app = express();

  // Configure Express for 1-hop reverse proxy (Nginx, Caddy, Cloudflare, AWS ALB)
  app.set('trust proxy', 1);

  app.use(cors());
  app.use(express.json({
    limit: '15mb',
    verify: (req, _res, buf) => {
      (req as any).rawBody = buf;
    }
  }));

  // Root-level health check endpoint
  app.get('/health', async (req, res) => {
    try {
      await deps.prisma.$queryRawUnsafe('SELECT 1');
      res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        database: 'connected'
      });
    } catch (err: any) {
      logger.error('Health check failed: database unreachable', err);
      res.status(503).json({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: 'DATABASE_UNAVAILABLE',
        message: err.message || String(err)
      });
    }
  });

  // Mount WhatsApp Webhook Endpoint
  if (deps.whatsAppNumberService) {
    const whatsAppWebhookRouter = createWhatsAppWebhookRouter(
      deps.whatsAppNumberService,
      {},
      deps.whatsAppIdempotencyStore,
      deps.whatsAppMessageQueue
    );
    app.use('/api/v1/webhook/whatsapp', whatsAppWebhookRouter);
    app.use('/api/webhook/whatsapp', whatsAppWebhookRouter);
  }

  // Mount WhatsApp Onboarding & Embedded Signup Router
  if (deps.whatsAppOnboardingService && deps.whatsAppNumberService) {
    const onboardingRouter = createWhatsAppOnboardingRouter(
      deps.whatsAppOnboardingService,
      deps.whatsAppNumberService
    );
    app.use('/api/v1/whatsapp/embedded-signup', onboardingRouter);
    app.use('/api/whatsapp/embedded-signup', onboardingRouter);
    app.use('/api/whatsapp', onboardingRouter);
  }

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
    const host = process.env.HOST || '0.0.0.0';
    app.listen(Number(config.port), host, () => {
      logger.info(`Server started on port ${config.port} (host: ${host})`);
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

