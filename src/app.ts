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

    const app = express();
    app.use(cors());
    app.use(express.json({ limit: '15mb' }));

    // Development-only Control Center
    if (process.env.NODE_ENV === 'development' && process.env.ENABLE_DEV_CONTROL_CENTER === 'true') {
      const { createDevChatRouter } = require('./dev/chatApi');
      const devRouter = createDevChatRouter(deps);
      app.use('/api/dev', devRouter);
      app.use('/api', (req, res) => {
        res.status(404).json({ error: 'NOT_FOUND', message: `Route not found: ${req.method} ${req.originalUrl}` });
      });
      app.use('/', express.static(path.join(__dirname, 'dev/ui')));
      logger.info(`Developer Control Center available at http://localhost:${config.port}/`);
    } else {
      logger.info('Development Control Center is disabled.');
    }

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

bootstrap();
