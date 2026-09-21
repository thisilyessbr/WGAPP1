import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { config, ConfigurationError } from '../config/env';
import { logger } from '../utils/logger';

export interface DatabaseContext {
  pool: Pool;
  prisma: PrismaClient;
}

export interface DatabaseInitOptions {
  processType: 'web' | 'worker';
  poolSize?: number;
  connectionString?: string;
}

/**
 * Resolves and parses DATABASE_URL, unwrapping base64 api_key from prisma+postgres:// if present.
 */
export function parseDatabaseUrl(rawUrl?: string): string {
  let dbUrl = rawUrl || process.env.DATABASE_URL || '';
  if (dbUrl && dbUrl.startsWith('prisma+postgres://')) {
    try {
      const urlObj = new URL(dbUrl);
      const apiKey = urlObj.searchParams.get('api_key');
      if (apiKey) {
        const decoded = JSON.parse(Buffer.from(apiKey, 'base64').toString('utf8'));
        if (decoded && decoded.databaseUrl) {
          dbUrl = decoded.databaseUrl;
        }
      }
    } catch (e: any) {
      logger.warn(`Failed to parse prisma+postgres:// URL: ${e.message}`);
    }
  }
  return dbUrl;
}

/**
 * Initializes an isolated PostgreSQL connection pool and PrismaClient for the given runtime process.
 */
export async function initDatabase(options: DatabaseInitOptions): Promise<DatabaseContext> {
  const dbUrl = parseDatabaseUrl(options.connectionString);
  if (!dbUrl) {
    throw new ConfigurationError('DATABASE_URL is not set or empty.');
  }

  const defaultPoolMax = options.processType === 'web'
    ? Number(process.env.WEB_DB_POOL_MAX || 15)
    : Number(process.env.WORKER_DB_POOL_MAX || 6);

  const max = options.poolSize ?? defaultPoolMax;

  const pool = new Pool({
    connectionString: dbUrl,
    max,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: options.processType === 'web' ? 5000 : 10000
  });

  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  await prisma.$connect();
  logger.info(`[${options.processType.toUpperCase()}] Database connected (pool max: ${max})`);

  return { pool, prisma };
}

/**
 * Validates required configuration specifically for the given runtime process type.
 * Enforces fail-closed rules in production without exposing sensitive secret values.
 */
export function validateProcessConfig(runtime: 'web' | 'worker', env: string | undefined = process.env.NODE_ENV): void {
  if (env !== 'production') {
    return;
  }

  const dbUrl = config.databaseUrl || '';
  if (!dbUrl || dbUrl.includes('localhost:5432/chatbot')) {
    logger.error(`[${runtime.toUpperCase()}] CRITICAL: DATABASE_URL must be configured with a valid database connection string in production.`);
    throw new ConfigurationError('DATABASE_URL must be configured with a valid database connection string in production.');
  }

  const encKey = config.encryptionKey || '';
  if (!encKey || encKey.trim().length < 32) {
    logger.error(`[${runtime.toUpperCase()}] CRITICAL: ENCRYPTION_KEY must be set in production and be at least 32 bytes.`);
    throw new ConfigurationError('ENCRYPTION_KEY must be set in production environment variables and be at least 32 bytes.');
  }

  if (runtime === 'web') {
    if (!config.authSecret || config.authSecret.trim().length < 32) {
      logger.error('[WEB] CRITICAL: AUTH_SECRET must be set in production environment variables and be at least 32 bytes.');
      throw new ConfigurationError('AUTH_SECRET must be set in production environment variables and be at least 32 bytes.');
    }

    if (!config.whatsappAppSecret || !config.whatsappAppSecret.trim()) {
      logger.error('[WEB] CRITICAL: WHATSAPP_APP_SECRET or META_APP_SECRET must be set in production for webhook signature verification.');
      throw new ConfigurationError('WHATSAPP_APP_SECRET or META_APP_SECRET must be set in production environment variables.');
    }

    if (!config.whatsappWebhookVerifyToken || !config.whatsappWebhookVerifyToken.trim()) {
      logger.error('[WEB] CRITICAL: WHATSAPP_WEBHOOK_VERIFY_TOKEN must be set in production environment variables.');
      throw new ConfigurationError('WHATSAPP_WEBHOOK_VERIFY_TOKEN must be set in production environment variables.');
    }

    if (!config.metaAppId || !config.metaAppSecret || !config.signupStateSecret) {
      logger.error('[WEB] CRITICAL: META_APP_ID, META_APP_SECRET, and SIGNUP_STATE_SECRET are required for secure Embedded Signup in production.');
      throw new ConfigurationError('META_APP_ID, META_APP_SECRET, and SIGNUP_STATE_SECRET are required for secure Embedded Signup in production.');
    }
  }

  if (runtime === 'worker') {
    if (!config.deepseekApiKey && !config.googleApiKey) {
      logger.error('[WORKER] CRITICAL: At least one production LLM key (DEEPSEEK_API_KEY or GOOGLE_API_KEY) must be configured for the worker.');
      throw new ConfigurationError('At least one production LLM key (DEEPSEEK_API_KEY or GOOGLE_API_KEY) must be configured.');
    }
  }
}

/**
 * Installs uniform SIGTERM and SIGINT signal handlers with a force-exit safety timeout.
 */
export function setupSignalHandlers(
  processName: string,
  onShutdown: () => Promise<void>,
  timeoutMs = 15000
): void {
  let isShuttingDown = false;

  const handleSignal = async (signal: string) => {
    if (isShuttingDown) {
      logger.warn(`[${processName}] Already shutting down, ignoring duplicate ${signal}`);
      return;
    }
    isShuttingDown = true;
    logger.info(`[${processName}] Received ${signal}. Starting graceful shutdown...`);

    const forceTimer = setTimeout(() => {
      logger.error(`[${processName}] Graceful shutdown timed out after ${timeoutMs}ms. Forcing exit.`);
      process.exit(1);
    }, timeoutMs);
    forceTimer.unref();

    try {
      await onShutdown();
      logger.info(`[${processName}] Graceful shutdown completed cleanly.`);
      process.exit(0);
    } catch (err: any) {
      logger.error(`[${processName}] Error during graceful shutdown: ${err.message || err}`);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => { void handleSignal('SIGTERM'); });
  process.on('SIGINT', () => { void handleSignal('SIGINT'); });
}
