import dotenv from 'dotenv';
import { logger } from '../utils/logger';

// Load environment variables from .env file
dotenv.config();

export const config = {
  port: process.env.PORT || 3000,
  databaseUrl: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/chatbot?schema=public',
  authSecret: process.env.AUTH_SECRET || '',
  deepseekApiKey: process.env.DEEPSEEK_API_KEY || '',
  googleApiKey: process.env.GOOGLE_API_KEY || '',
  logLevel: process.env.LOG_LEVEL || 'info',
  encryptionKey: process.env.ENCRYPTION_KEY || process.env.CREDENTIALS_ENCRYPTION_KEY || '',
  whatsappAppSecret: process.env.WHATSAPP_APP_SECRET || process.env.META_APP_SECRET || '',
  whatsappWebhookVerifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || '',
  metaAppId: process.env.META_APP_ID || '',
  metaAppSecret: process.env.META_APP_SECRET || '',
  signupStateSecret: process.env.SIGNUP_STATE_SECRET || '',
};

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

/**
 * Validates required environment variables for production execution.
 * Throws ConfigurationError with a sanitized description (no secret values exposed).
 */
export function validateProductionConfig(cfg: typeof config = config, env: string | undefined = process.env.NODE_ENV): void {
  if (env !== 'production') {
    return;
  }

  if (!cfg.databaseUrl || cfg.databaseUrl.includes('localhost:5432/chatbot')) {
    logger.error('CRITICAL: DATABASE_URL must be configured with a valid database connection string in production.');
    throw new ConfigurationError('DATABASE_URL must be configured with a valid database connection string in production.');
  }

  if (!cfg.authSecret || cfg.authSecret.trim().length < 32) {
    logger.error('CRITICAL: AUTH_SECRET must be set in production environment variables and be at least 32 bytes.');
    throw new ConfigurationError('AUTH_SECRET must be set in production environment variables and be at least 32 bytes.');
  }

  if (!cfg.encryptionKey || cfg.encryptionKey.trim().length < 32) {
    logger.error('CRITICAL: ENCRYPTION_KEY must be set in production environment variables and be at least 32 bytes.');
    throw new ConfigurationError('ENCRYPTION_KEY must be set in production environment variables and be at least 32 bytes.');
  }

  if (!cfg.whatsappAppSecret || !cfg.whatsappAppSecret.trim()) {
    logger.error('CRITICAL: WHATSAPP_APP_SECRET or META_APP_SECRET must be set in production environment variables for webhook signature verification.');
    throw new ConfigurationError('WHATSAPP_APP_SECRET or META_APP_SECRET must be set in production environment variables.');
  }

  if (!cfg.whatsappWebhookVerifyToken || !cfg.whatsappWebhookVerifyToken.trim()) {
    logger.error('CRITICAL: WHATSAPP_WEBHOOK_VERIFY_TOKEN must be set in production environment variables.');
    throw new ConfigurationError('WHATSAPP_WEBHOOK_VERIFY_TOKEN must be set in production environment variables.');
  }

  if (!cfg.metaAppId || !cfg.metaAppSecret || !cfg.signupStateSecret) {
    logger.error('CRITICAL: META_APP_ID, META_APP_SECRET, and SIGNUP_STATE_SECRET are required for secure Embedded Signup in production.');
    throw new ConfigurationError('META_APP_ID, META_APP_SECRET, and SIGNUP_STATE_SECRET are required for secure Embedded Signup in production.');
  }

  if (!cfg.deepseekApiKey && !cfg.googleApiKey) {
    logger.error('CRITICAL: At least one production LLM key (DEEPSEEK_API_KEY or GOOGLE_API_KEY) must be configured.');
    throw new ConfigurationError('At least one production LLM key (DEEPSEEK_API_KEY or GOOGLE_API_KEY) must be configured.');
  }
}

// Basic validation for any environment
if (!config.databaseUrl) {
  logger.error('DATABASE_URL is not set in environment variables');
  process.exit(1);
}

if (!config.deepseekApiKey && process.env.NODE_ENV !== 'production') {
  logger.warn('DEEPSEEK_API_KEY is not set. DeepSeek-backed tenants will fail clearly.');
}

// Enforce production validation at startup (only when not running inside test suite)
if (process.env.NODE_ENV === 'production' && !process.env.VITEST) {
  try {
    validateProductionConfig();
  } catch (err: any) {
    logger.error(`Application startup aborted due to configuration error: ${err.message}`);
    process.exit(1);
  }
}
