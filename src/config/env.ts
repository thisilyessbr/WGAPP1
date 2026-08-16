import dotenv from 'dotenv';
import { logger } from '../utils/logger';

// Load environment variables from .env file
dotenv.config();

export const config = {
  port: process.env.PORT || 3000,
  databaseUrl: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/chatbot?schema=public',
  deepseekApiKey: process.env.DEEPSEEK_API_KEY || '',
  logLevel: process.env.LOG_LEVEL || 'info',
};

// Basic validation
if (!config.databaseUrl) {
  logger.error('DATABASE_URL is not set in environment variables');
  process.exit(1);
}

if (!config.deepseekApiKey) {
  logger.warn('DEEPSEEK_API_KEY is not set. LLM features will fail.');
}
