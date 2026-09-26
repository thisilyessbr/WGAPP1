import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from './config/env';
import { logger } from './utils/logger';
import { bootstrapChatbot, ChatbotDependencies, WebDependencies } from './bootstrap';
import { createApiRouter } from './dev/chatApi';
import { createWhatsAppWebhookRouter } from './domain/channel/whatsapp/WhatsAppWebhookRouter';
import { createClientOwnedMetaWebhookRouter } from './domain/channel/whatsapp/ClientOwnedMetaWebhookRouter';
import { createWhatsAppOnboardingRouter } from './domain/channel/whatsapp/WhatsAppOnboardingRouter';
import { createPortalRouter } from './portal/PortalRouter';
import { createChannelManagementRouter } from './domain/channel/guard/ChannelManagementRouter';

export async function createApp(deps: ChatbotDependencies | WebDependencies): Promise<express.Application> {
  const app = express();

  // Configure Express for 1-hop reverse proxy (Nginx, Caddy, Cloudflare, AWS ALB)
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });

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
      { rejectClientOwned: true },
      deps.whatsAppIdempotencyStore,
      deps.whatsAppMessageQueue,
      deps.prisma
    );
    app.use('/api/v1/webhook/whatsapp', whatsAppWebhookRouter);
    app.use('/api/webhook/whatsapp', whatsAppWebhookRouter);
    app.use('/api/webhook/whatsapp/client', createClientOwnedMetaWebhookRouter(
      deps.prisma, deps.whatsAppNumberService, deps.whatsAppIdempotencyStore, deps.whatsAppMessageQueue
    ));
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

  // Mount Channel Management & Safety Guard Router
  if ((deps as any).clientSafetyGuard && deps.whatsAppNumberService) {
    const channelManagementRouter = createChannelManagementRouter(
      deps.prisma,
      deps.whatsAppNumberService,
      (deps as any).clientSafetyGuard,
      deps.secretBox,
      deps.qrSessionManager
    );
    app.use('/api/v1', channelManagementRouter);
    app.use('/api', channelManagementRouter);
  }

  // Mount Client / Admin Portal Router and Assets if enabled
  if ((deps as any).portalService) {
    app.use('/api', createPortalRouter((deps as any).portalService, deps as any));
    app.use('/portal-assets', express.static(path.join(__dirname, 'portal/ui')));
    app.use(['/signup', '/login', '/forgot-password', '/reset-password', '/verify-email', '/admin-confirm', '/app', '/admin'], (req, res) => {
      if (process.env.NODE_ENV === 'production' && req.hostname === 'relayqo-backend.onrender.com') {
        res.redirect(302, new URL(req.originalUrl, process.env.PORTAL_PUBLIC_URL).toString());
        return;
      }
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' https://connect.facebook.net; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://www.facebook.com https://graph.facebook.com; frame-src https://www.facebook.com; base-uri 'none'; form-action 'self'");
      res.sendFile(path.join(__dirname, 'portal/ui/index.html'));
    });
  }

  const apiRouter = createApiRouter(deps as any);

  // In production, disable /api/dev legacy endpoint alias completely
  if (process.env.NODE_ENV === 'production') {
    app.use('/api/dev', (_req, res) => {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Not found' });
    });
  } else if (process.env.NODE_ENV === 'development' && process.env.ENABLE_DEV_CONTROL_CENTER === 'true') {
    app.use('/api/dev', apiRouter);
    app.use('/', express.static(path.join(__dirname, 'dev/ui')));
    logger.info(`Developer Control Center available at http://localhost:${config.port}/`);
  } else {
    // Non-production test environments mount /api/dev
    app.use('/api/dev', apiRouter);
    logger.info('Development Control Center UI is disabled.');
  }

  // Production API Routes (/api/v1 and /api)
  app.use('/api/v1', apiRouter);
  app.use('/api', apiRouter);

  return app;
}

async function bootstrap() {
  try {
    const runtime = process.env.RELAYQO_RUNTIME || 'web';
    if (runtime === 'worker') {
      const { startWorkerProcess } = await import('./runtime/worker.js');
      await startWorkerProcess();
    } else {
      const { startWebServer } = await import('./runtime/web.js');
      await startWebServer();
    }
  } catch (error) {
    logger.error('Error during bootstrap', error);
    process.exit(1);
  }
}

if (require.main === module && process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
  bootstrap();
}

