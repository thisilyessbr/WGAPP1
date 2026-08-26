import { PrismaClient } from '@prisma/client';
import { logger } from './utils/logger';
import { ConversationService } from './domain/conversation/ConversationService';
import { ConversationEngine } from './domain/conversation/ConversationEngine';
import { WorkflowEngine } from './core/engine/WorkflowEngine';
import { WorkflowStateEvaluator } from './core/engine/WorkflowStateEvaluator';
import { FieldValidator } from './core/engine/FieldValidator';
import { ResponseBuilder } from './domain/conversation/ResponseBuilder';
import { LLMFactory } from './core/llm/LLMFactory';
import { RAGService } from './domain/rag/RAGService';
import { EmbeddingProvider, MockEmbeddingProvider, GeminiEmbeddingProvider } from './core/rag/EmbeddingProvider';
import { KnowledgeRepository } from './domain/rag/KnowledgeRepository';
import { TenantConfigService } from './domain/tenant/TenantConfigService';
import { PdfIngestionService } from './domain/rag/PdfIngestionService';

import { ImageCapabilityGateway } from './core/gateway/ImageCapabilityGateway';
import { AccountConfigService } from './domain/tenant/AccountConfigService';
import { ProductRepository } from './domain/ecommerce/ProductRepository';
import { EcommerceService } from './domain/ecommerce/EcommerceService';

export interface ChatbotDependencies {
  prisma: PrismaClient;
  conversationEngine: ConversationEngine;
  conversationService: ConversationService;
  tenantConfigService: TenantConfigService;
  ragService: RAGService;
  pdfIngestionService: PdfIngestionService;
  llmFactory: LLMFactory;
  imageGateway: ImageCapabilityGateway;
  accountConfigService?: AccountConfigService;
  ecommerceService?: EcommerceService;
}

export function bootstrapChatbot(prisma: PrismaClient): ChatbotDependencies {
  const tenantConfigService = new TenantConfigService(prisma);
  const conversationService = new ConversationService(prisma);
  const responseBuilder = new ResponseBuilder();
  const fieldValidator = new FieldValidator();

  // LLM Factory (dynamically resolves providers per-tenant: DeepSeek, Gemini, Mock)
  const llmFactory = new LLMFactory(
    process.env.DEEPSEEK_API_KEY,
    process.env.GOOGLE_API_KEY
  );

  // Workflow Components
  const evaluator = new WorkflowStateEvaluator();
  const workflowEngine = new WorkflowEngine(evaluator, undefined, responseBuilder, fieldValidator);

  // RAG Components
  const isTestEnv = Boolean(process.env.VITEST || process.env.NODE_ENV === 'test');
  const useRealAi = process.env.USE_REAL_AI === 'true';

  let embeddingProvider: EmbeddingProvider;
  if (!isTestEnv || useRealAi) {
    if (process.env.GOOGLE_API_KEY) {
      logger.info('Using GeminiEmbeddingProvider for RAG embeddings.');
      embeddingProvider = new GeminiEmbeddingProvider(process.env.GOOGLE_API_KEY);
    } else {
      logger.warn('GOOGLE_API_KEY missing. Using MockEmbeddingProvider.');
      embeddingProvider = new MockEmbeddingProvider();
    }
  } else {
    logger.info('Test environment detected without USE_REAL_AI=true. Using MockEmbeddingProvider.');
    embeddingProvider = new MockEmbeddingProvider();
  }
  const knowledgeRepo = new KnowledgeRepository(prisma);
  const ragService = new RAGService(embeddingProvider, knowledgeRepo);
  const pdfIngestionService = new PdfIngestionService(prisma, embeddingProvider, knowledgeRepo);

  const imageGateway = new ImageCapabilityGateway();
  const accountConfigService = new AccountConfigService(prisma, tenantConfigService);
  const productRepository = new ProductRepository(prisma);
  const ecommerceService = new EcommerceService(productRepository);

  // Core Engine
  const conversationEngine = new ConversationEngine(
    conversationService,
    tenantConfigService,
    workflowEngine,
    llmFactory,
    responseBuilder,
    ragService,
    imageGateway,
    undefined,
    accountConfigService,
    ecommerceService
  );

  return {
    prisma,
    conversationEngine,
    conversationService,
    tenantConfigService,
    ragService,
    pdfIngestionService,
    llmFactory,
    imageGateway,
    accountConfigService,
    ecommerceService
  };
}
