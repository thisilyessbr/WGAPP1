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
import { EmbeddingProvider, MockEmbeddingProvider, GeminiEmbeddingProvider, UnavailableEmbeddingProvider } from './core/rag/EmbeddingProvider';
import { KnowledgeRepository } from './domain/rag/KnowledgeRepository';
import { TenantConfigService } from './domain/tenant/TenantConfigService';
import { PdfIngestionService } from './domain/rag/PdfIngestionService';

import { ImageCapabilityGateway } from './core/gateway/ImageCapabilityGateway';
import { AccountConfigService } from './domain/tenant/AccountConfigService';
import { ProductRepository } from './domain/ecommerce/ProductRepository';
import { EcommerceService } from './domain/ecommerce/EcommerceService';
import { CRMService } from './domain/crm/CRMService';
import { WhatsAppNumberService } from './domain/channel/whatsapp/WhatsAppNumberService';
import { MessageQueue, PartitionedFifoQueue, PostgresMessageQueue, InboundQueueJob } from './domain/channel/whatsapp/MessageQueue';
import { IdempotencyStore, MemoryIdempotencyStore, PostgresIdempotencyStore } from './domain/channel/whatsapp/IdempotencyStore';
import { WhatsAppWorker } from './domain/channel/whatsapp/WhatsAppWorker';
import { WhatsAppOutboundAdapter } from './domain/channel/whatsapp/WhatsAppOutboundAdapter';
import { WhatsAppPolicyAdapter } from './domain/channel/whatsapp/WhatsAppPolicyAdapter';
import { WhatsAppOnboardingService } from './domain/channel/whatsapp/WhatsAppOnboardingService';
import { SecretBox } from './core/security/SecretBox';
import { ChannelRouter } from './domain/channel/routing/ChannelRouter';
import { MetaCloudTransport } from './domain/channel/routing/MetaCloudTransport';
import { ClientSafetyGuard } from './domain/channel/guard/ClientSafetyGuard';
import { QrSessionManager } from './domain/channel/routing/QrSessionManager';
import { QrWebTransport } from './domain/channel/routing/QrWebTransport';
import { TelemetryClient, telemetry } from './core/telemetry/TelemetryClient';
import { PortalService } from './portal/PortalService';
import { PortalDb } from './portal/types';
import { ConversationAutomationService } from './domain/conversation/ConversationAutomationService';
import { OutboundMessageQueue, PostgresOutboundQueue, MemoryOutboundQueue, WhatsAppOutboundWorker } from './domain/channel/whatsapp/WhatsAppOutboundQueue';

export interface WebDependencies {
  prisma: PrismaClient;
  portalService?: PortalService;
  tenantConfigService: TenantConfigService;
  accountConfigService: AccountConfigService;
  crmService: CRMService;
  ecommerceService: EcommerceService;
  whatsAppNumberService: WhatsAppNumberService;
  whatsAppMessageQueue: MessageQueue<InboundQueueJob>;
  whatsAppIdempotencyStore: IdempotencyStore;
  whatsAppOnboardingService: WhatsAppOnboardingService;
  secretBox: SecretBox;
  qrSessionManager?: QrSessionManager;
  telemetryClient: TelemetryClient;
  conversationAutomationService: ConversationAutomationService;
  whatsAppOutboundQueue: OutboundMessageQueue;
  clientSafetyGuard?: ClientSafetyGuard;
  conversationEngine?: undefined;
  ragService?: undefined;
  pdfIngestionService?: undefined;
  llmFactory?: undefined;
  imageGateway?: undefined;
  whatsAppWorker?: undefined;
}

export interface WorkerDependencies {
  prisma: PrismaClient;
  conversationEngine: ConversationEngine;
  conversationService: ConversationService;
  tenantConfigService: TenantConfigService;
  accountConfigService: AccountConfigService;
  ragService: RAGService;
  pdfIngestionService: PdfIngestionService;
  llmFactory: LLMFactory;
  imageGateway: ImageCapabilityGateway;
  ecommerceService: EcommerceService;
  crmService: CRMService;
  whatsAppNumberService: WhatsAppNumberService;
  whatsAppMessageQueue: MessageQueue<InboundQueueJob>;
  whatsAppIdempotencyStore: IdempotencyStore;
  whatsAppOutboundAdapter: WhatsAppOutboundAdapter;
  whatsAppPolicyAdapter: WhatsAppPolicyAdapter;
  whatsAppWorker: WhatsAppWorker;
  secretBox: SecretBox;
  channelRouter: ChannelRouter;
  clientSafetyGuard: ClientSafetyGuard;
  qrSessionManager: QrSessionManager;
  telemetryClient: TelemetryClient;
  portalService?: PortalService;
  conversationAutomationService: ConversationAutomationService;
  whatsAppOutboundQueue: OutboundMessageQueue;
  whatsAppOutboundWorker: WhatsAppOutboundWorker;
}

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
  crmService?: CRMService;
  whatsAppNumberService?: WhatsAppNumberService;
  whatsAppMessageQueue?: MessageQueue<InboundQueueJob>;
  whatsAppIdempotencyStore?: IdempotencyStore;
  whatsAppOutboundAdapter?: WhatsAppOutboundAdapter;
  whatsAppPolicyAdapter?: WhatsAppPolicyAdapter;
  whatsAppOnboardingService?: WhatsAppOnboardingService;
  whatsAppWorker?: WhatsAppWorker;
  secretBox?: SecretBox;
  channelRouter?: ChannelRouter;
  clientSafetyGuard?: ClientSafetyGuard;
  qrSessionManager?: QrSessionManager;
  telemetryClient?: TelemetryClient;
  portalService?: PortalService;
  conversationAutomationService?: ConversationAutomationService;
  whatsAppOutboundQueue?: OutboundMessageQueue;
  whatsAppOutboundWorker?: WhatsAppOutboundWorker;
}

export interface WebBootstrapOptions {
  useMemoryQueue?: boolean;
}

export interface WorkerBootstrapOptions {
  workerConcurrency?: number;
  autoStartQueue?: boolean;
  enableDocumentWorker?: boolean;
  useMemoryQueue?: boolean;
}

/**
 * Bootstraps dependencies strictly needed for the Web process.
 * Does NOT instantiate WhatsAppWorker, ConversationEngine, RAG, LLMFactory,
 * or background document processing loops.
 */
export function bootstrapWebDependencies(prisma: PrismaClient, options: WebBootstrapOptions = {}): WebDependencies {
  const isTestEnv = Boolean(process.env.VITEST || process.env.NODE_ENV === 'test');
  const isMemory = Boolean(options.useMemoryQueue);
  const tenantConfigService = new TenantConfigService(prisma);
  const accountConfigService = new AccountConfigService(prisma, tenantConfigService);
  const crmService = new CRMService(prisma);
  const productRepository = new ProductRepository(prisma);
  const ecommerceService = new EcommerceService(productRepository);
  const whatsAppNumberService = new WhatsAppNumberService(prisma);

  const encKey = process.env.ENCRYPTION_KEY || process.env.CREDENTIALS_ENCRYPTION_KEY || (isTestEnv ? 'test-encryption-key-32-bytes-long!' : '');
  if (!encKey) {
    throw new Error('SecretBox: ENCRYPTION_KEY or CREDENTIALS_ENCRYPTION_KEY environment variable is required (minimum 32 bytes).');
  }
  const secretBox = new SecretBox({ key: encKey });

  const whatsAppIdempotencyStore = isMemory
    ? new MemoryIdempotencyStore()
    : new PostgresIdempotencyStore(prisma);

  // Producer-only queue: autoStartWorker is false, disableWorker is true
  const whatsAppMessageQueue = isMemory
    ? new PartitionedFifoQueue<InboundQueueJob>()
    : new PostgresMessageQueue(prisma, { autoStartWorker: false, disableWorker: true });

  const whatsAppOnboardingService = new WhatsAppOnboardingService(prisma, whatsAppNumberService, {
    secretBox
  });

  const qrSessionManager = new QrSessionManager(
    prisma,
    whatsAppNumberService,
    whatsAppMessageQueue,
    secretBox
  );

  const conversationAutomationService = new ConversationAutomationService(prisma);
  const clientSafetyGuard = new ClientSafetyGuard(prisma, whatsAppNumberService, {}, conversationAutomationService);
  const whatsAppOutboundQueue: OutboundMessageQueue = isMemory
    ? new MemoryOutboundQueue(prisma)
    : new PostgresOutboundQueue(prisma, { autoStartWorker: false, disableWorker: true });

  const portalService = process.env.PORTAL_ENABLED === 'true' ? new PortalService(prisma as unknown as PortalDb) : undefined;
  if (portalService) {
    portalService.attach({
      prisma,
      tenantConfigService,
      accountConfigService,
      whatsAppNumberService,
      whatsAppOnboardingService,
      qrSessionManager,
      secretBox,
      conversationAutomationService,
      whatsAppOutboundQueue,
      clientSafetyGuard,
      pdfIngestionService: undefined as any
    } as any);
    // Explicitly stop document worker if it was started
    portalService.documents?.stop();
  }

  return {
    prisma,
    portalService,
    tenantConfigService,
    accountConfigService,
    crmService,
    ecommerceService,
    whatsAppNumberService,
    whatsAppMessageQueue,
    whatsAppIdempotencyStore,
    whatsAppOnboardingService,
    secretBox,
    qrSessionManager,
    conversationAutomationService,
    whatsAppOutboundQueue,
    clientSafetyGuard,
    telemetryClient: telemetry
  };
}

/**
 * Bootstraps dependencies strictly needed for the background Worker process.
 * Initializes full AI pipeline, ConversationEngine, WhatsAppWorker, and starts queue consumption.
 */
export function bootstrapWorkerDependencies(prisma: PrismaClient, options: WorkerBootstrapOptions = {}): WorkerDependencies {
  const isTestEnv = Boolean(process.env.VITEST || process.env.NODE_ENV === 'test');
  const useRealAi = process.env.USE_REAL_AI === 'true';

  const portalService = process.env.PORTAL_ENABLED === 'true' ? new PortalService(prisma as unknown as PortalDb) : undefined;
  const tenantConfigService = new TenantConfigService(prisma);
  const accountConfigService = new AccountConfigService(prisma, tenantConfigService);
  const conversationService = new ConversationService(prisma);
  const responseBuilder = new ResponseBuilder();
  const fieldValidator = new FieldValidator();

  // LLM Factory
  const llmFactory = new LLMFactory(
    process.env.DEEPSEEK_API_KEY,
    process.env.GOOGLE_API_KEY
  );

  // Workflow Components
  const evaluator = new WorkflowStateEvaluator();
  const workflowEngine = new WorkflowEngine(evaluator, undefined, responseBuilder, fieldValidator);

  // RAG Components
  let embeddingProvider: EmbeddingProvider;
  if (!isTestEnv || useRealAi) {
    if (process.env.GOOGLE_API_KEY) {
      logger.info('Using GeminiEmbeddingProvider for RAG embeddings in worker.');
      embeddingProvider = new GeminiEmbeddingProvider(process.env.GOOGLE_API_KEY);
    } else {
      logger.warn('GOOGLE_API_KEY missing. Knowledge retrieval and ingestion are unavailable in worker.');
      embeddingProvider = new UnavailableEmbeddingProvider();
    }
  } else {
    logger.info('Test environment detected without USE_REAL_AI=true. Using MockEmbeddingProvider in worker.');
    embeddingProvider = new MockEmbeddingProvider();
  }
  if (portalService) embeddingProvider = portalService.budget.wrapEmbeddings(embeddingProvider);
  const knowledgeRepo = new KnowledgeRepository(prisma);
  const ragService = new RAGService(embeddingProvider, knowledgeRepo);
  const pdfIngestionService = new PdfIngestionService(prisma, embeddingProvider, knowledgeRepo);

  const imageGateway = portalService ? portalService.budget.wrapImages(new ImageCapabilityGateway()) : new ImageCapabilityGateway();
  const productRepository = new ProductRepository(prisma);
  const ecommerceService = new EcommerceService(productRepository);
  const crmService = new CRMService(prisma);
  const whatsAppNumberService = new WhatsAppNumberService(prisma);

  const encKey = process.env.ENCRYPTION_KEY || process.env.CREDENTIALS_ENCRYPTION_KEY || (isTestEnv ? 'test-encryption-key-32-bytes-long!' : '');
  if (!encKey) {
    throw new Error('SecretBox: ENCRYPTION_KEY or CREDENTIALS_ENCRYPTION_KEY environment variable is required (minimum 32 bytes).');
  }
  const secretBox = new SecretBox({ key: encKey });

  const isMemory = Boolean(options.useMemoryQueue);
  const whatsAppIdempotencyStore = isMemory
    ? new MemoryIdempotencyStore()
    : new PostgresIdempotencyStore(prisma);

  // Consumer queue in worker: autoStartWorker is true by default
  const autoStart = options.autoStartQueue ?? true;
  const whatsAppMessageQueue = isMemory
    ? new PartitionedFifoQueue<InboundQueueJob>()
    : new PostgresMessageQueue(prisma, {
        autoStartWorker: autoStart,
        workerConcurrency: options.workerConcurrency
      });

  // Core Conversation Engine
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
    ecommerceService,
    crmService,
    portalService?.budget
  );

  const whatsAppOutboundAdapter = new WhatsAppOutboundAdapter({
    numberService: whatsAppNumberService,
    secretBox
  });

  const qrSessionManager = new QrSessionManager(
    prisma,
    whatsAppNumberService,
    whatsAppMessageQueue,
    secretBox
  );

  const channelRouter = new ChannelRouter(whatsAppNumberService, [
    new MetaCloudTransport(whatsAppOutboundAdapter),
    new QrWebTransport(qrSessionManager)
  ]);

  const conversationAutomationService = new ConversationAutomationService(prisma);
  const clientSafetyGuard = new ClientSafetyGuard(prisma, whatsAppNumberService, {}, conversationAutomationService);
  const whatsAppPolicyAdapter = new WhatsAppPolicyAdapter();

  const whatsAppOutboundQueue: OutboundMessageQueue = isMemory
    ? new MemoryOutboundQueue(prisma)
    : new PostgresOutboundQueue(prisma, {
        autoStartWorker: autoStart,
        disableWorker: false
      });
  const whatsAppOutboundWorker = new WhatsAppOutboundWorker(whatsAppOutboundQueue, whatsAppOutboundAdapter);

  const whatsAppWorker = new WhatsAppWorker(
    whatsAppMessageQueue,
    conversationEngine,
    whatsAppOutboundAdapter,
    whatsAppNumberService,
    whatsAppPolicyAdapter,
    channelRouter,
    clientSafetyGuard
  );

  if (portalService) {
    portalService.attach({
      prisma,
      conversationEngine,
      conversationService,
      tenantConfigService,
      ragService,
      pdfIngestionService,
      llmFactory,
      imageGateway,
      accountConfigService,
      ecommerceService,
      crmService,
      whatsAppNumberService,
      whatsAppMessageQueue,
      whatsAppIdempotencyStore,
      whatsAppOutboundAdapter,
      whatsAppPolicyAdapter,
      whatsAppWorker,
      secretBox,
      channelRouter,
      clientSafetyGuard,
      qrSessionManager,
      conversationAutomationService,
      whatsAppOutboundQueue,
      whatsAppOutboundWorker,
      telemetryClient: telemetry
    });

    const shouldStartDocs = options.enableDocumentWorker ?? (process.env.PORTAL_DOCUMENT_WORKER === 'true' && process.env.NODE_ENV !== 'test');
    if (shouldStartDocs) {
      portalService.documents.start();
      logger.info('Portal document ingestion worker started');
    }
  }

  return {
    prisma,
    portalService,
    conversationEngine,
    conversationService,
    tenantConfigService,
    accountConfigService,
    ragService,
    pdfIngestionService,
    llmFactory,
    imageGateway,
    ecommerceService,
    crmService,
    whatsAppNumberService,
    whatsAppMessageQueue,
    whatsAppIdempotencyStore,
    whatsAppOutboundAdapter,
    whatsAppPolicyAdapter,
    whatsAppWorker,
    secretBox,
    channelRouter,
    clientSafetyGuard,
    qrSessionManager,
    conversationAutomationService,
    whatsAppOutboundQueue,
    whatsAppOutboundWorker,
    telemetryClient: telemetry
  };
}

/**
 * Monolithic/Combined bootstrap for backward compatibility with existing tests.
 */
export function bootstrapChatbot(prisma: PrismaClient): ChatbotDependencies {
  const portalService = process.env.PORTAL_ENABLED === 'true' ? new PortalService(prisma as unknown as PortalDb) : undefined;
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
      logger.warn('GOOGLE_API_KEY missing. Knowledge retrieval and ingestion are unavailable.');
      embeddingProvider = new UnavailableEmbeddingProvider();
    }
  } else {
    logger.info('Test environment detected without USE_REAL_AI=true. Using MockEmbeddingProvider.');
    embeddingProvider = new MockEmbeddingProvider();
  }
  if (portalService) embeddingProvider = portalService.budget.wrapEmbeddings(embeddingProvider);
  const knowledgeRepo = new KnowledgeRepository(prisma);
  const ragService = new RAGService(embeddingProvider, knowledgeRepo);
  const pdfIngestionService = new PdfIngestionService(prisma, embeddingProvider, knowledgeRepo);

  const imageGateway = portalService ? portalService.budget.wrapImages(new ImageCapabilityGateway()) : new ImageCapabilityGateway();
  const accountConfigService = new AccountConfigService(prisma, tenantConfigService);
  const productRepository = new ProductRepository(prisma);
  const ecommerceService = new EcommerceService(productRepository);
  const crmService = new CRMService(prisma);
  const whatsAppNumberService = new WhatsAppNumberService(prisma);
  const whatsAppIdempotencyStore = isTestEnv
    ? new MemoryIdempotencyStore()
    : new PostgresIdempotencyStore(prisma);
  const whatsAppMessageQueue = isTestEnv
    ? new PartitionedFifoQueue<InboundQueueJob>()
    : new PostgresMessageQueue(prisma, { autoStartWorker: true });

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
    ecommerceService,
    crmService,
    portalService?.budget
  );

  // Initialize Security and Routing
  const encKey = process.env.ENCRYPTION_KEY || process.env.CREDENTIALS_ENCRYPTION_KEY || (isTestEnv ? 'test-encryption-key-32-bytes-long!' : '');
  if (!encKey) {
    throw new Error('SecretBox: ENCRYPTION_KEY or CREDENTIALS_ENCRYPTION_KEY environment variable is required (minimum 32 bytes).');
  }
  const secretBox = new SecretBox({ key: encKey });

  const whatsAppOutboundAdapter = new WhatsAppOutboundAdapter({
    numberService: whatsAppNumberService,
    secretBox
  });

  const qrSessionManager = new QrSessionManager(
    prisma,
    whatsAppNumberService,
    whatsAppMessageQueue,
    secretBox
  );

  const channelRouter = new ChannelRouter(whatsAppNumberService, [
    new MetaCloudTransport(whatsAppOutboundAdapter),
    new QrWebTransport(qrSessionManager)
  ]);

  const conversationAutomationService = new ConversationAutomationService(prisma);
  const clientSafetyGuard = new ClientSafetyGuard(prisma, whatsAppNumberService, {}, conversationAutomationService);

  const whatsAppOutboundQueue: OutboundMessageQueue = isTestEnv
    ? new MemoryOutboundQueue(prisma)
    : new PostgresOutboundQueue(prisma, { autoStartWorker: true });
  const whatsAppOutboundWorker = new WhatsAppOutboundWorker(whatsAppOutboundQueue, whatsAppOutboundAdapter);

  const whatsAppOnboardingService = new WhatsAppOnboardingService(prisma, whatsAppNumberService, {
    secretBox
  });

  const whatsAppPolicyAdapter = new WhatsAppPolicyAdapter();

  const whatsAppWorker = new WhatsAppWorker(
    whatsAppMessageQueue,
    conversationEngine,
    whatsAppOutboundAdapter,
    whatsAppNumberService,
    whatsAppPolicyAdapter,
    channelRouter,
    clientSafetyGuard
  );

  const dependencies: ChatbotDependencies = {
    prisma,
    portalService,
    conversationEngine,
    conversationService,
    tenantConfigService,
    ragService,
    pdfIngestionService,
    llmFactory,
    imageGateway,
    accountConfigService,
    ecommerceService,
    crmService,
    whatsAppNumberService,
    whatsAppMessageQueue,
    whatsAppIdempotencyStore,
    whatsAppOutboundAdapter,
    whatsAppPolicyAdapter,
    whatsAppOnboardingService,
    whatsAppWorker,
    secretBox,
    channelRouter,
    clientSafetyGuard,
    qrSessionManager,
    conversationAutomationService,
    whatsAppOutboundQueue,
    whatsAppOutboundWorker,
    telemetryClient: telemetry
  };
  portalService?.attach(dependencies);
  return dependencies;
}
