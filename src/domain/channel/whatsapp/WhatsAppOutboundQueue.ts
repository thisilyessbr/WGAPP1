import { PrismaClient } from '@prisma/client';
import { logger } from '../../../utils/logger';
import { WhatsAppOutboundAdapter } from './WhatsAppOutboundAdapter';
import { WhatsAppDeliveryReceiptProcessor } from './WhatsAppDeliveryReceiptProcessor';

export interface OutboundQueueJob {
  id: string;
  dedupeKey: string;
  tenantId: string;
  accountId: string;
  conversationId: string;
  messageId: string;
  phoneNumberId: string;
  recipientWaId: string;
  text: string;
  attempts?: number;
  createdAt?: Date;
}

export type OutboundJobHandler = (job: OutboundQueueJob) => Promise<void>;

export interface OutboundMessageQueue {
  readonly durable?: boolean;
  enqueue(job: Omit<OutboundQueueJob, 'id' | 'attempts' | 'createdAt'>): Promise<{ success: boolean; job: OutboundQueueJob }>;
  claimNextJob?(): Promise<OutboundQueueJob | null>;
  completeJob?(jobId: string, providerMessageId: string): Promise<void>;
  failJob?(jobId: string, error: string, isRetryable?: boolean, errorCode?: string | number | null): Promise<void>;
  registerHandler?(handler: OutboundJobHandler): void;
  startWorker?(): void;
  shutdown(): Promise<void>;
}

export interface PostgresOutboundQueueOptions {
  workerId?: string;
  pollIntervalMs?: number;
  leaseSeconds?: number;
  autoStartWorker?: boolean;
  disableWorker?: boolean;
  deliveryReceiptProcessor?: WhatsAppDeliveryReceiptProcessor;
}

/**
 * Durable PostgreSQL-backed Queue for Manual Merchant Outbound WhatsApp Messages.
 */
export class PostgresOutboundQueue implements OutboundMessageQueue {
  readonly durable = true;
  private readonly workerId: string;
  private readonly pollIntervalMs: number;
  private readonly leaseSeconds: number;
  private readonly disableWorker: boolean;
  private readonly deliveryReceiptProcessor?: WhatsAppDeliveryReceiptProcessor;
  private handler: OutboundJobHandler | null = null;
  private isShuttingDown = false;
  private pollTimer?: NodeJS.Timeout;
  private activeJobs = 0;

  constructor(
    private prisma: PrismaClient,
    options: PostgresOutboundQueueOptions = {}
  ) {
    this.workerId = options.workerId ?? `outbound-worker-${Math.random().toString(36).substring(2, 9)}`;
    this.pollIntervalMs = options.pollIntervalMs ?? 500;
    this.leaseSeconds = options.leaseSeconds ?? 60;
    this.disableWorker = Boolean(options.disableWorker);
    this.deliveryReceiptProcessor = options.deliveryReceiptProcessor ?? new WhatsAppDeliveryReceiptProcessor(this.prisma);

    if (options.autoStartWorker && !this.disableWorker) {
      this.startWorker();
    }
  }

  registerHandler(handler: OutboundJobHandler): void {
    if (this.disableWorker) {
      throw new Error('PostgresOutboundQueue: Cannot register handler on producer-only queue');
    }
    this.handler = handler;
  }

  async enqueue(data: Omit<OutboundQueueJob, 'id' | 'attempts' | 'createdAt'>): Promise<{ success: boolean; job: OutboundQueueJob }> {
    if (this.isShuttingDown) {
      throw new Error('PostgresOutboundQueue: Cannot enqueue job during shutdown');
    }

    try {
      const created = await this.prisma.whatsAppOutboundJob.create({
        data: {
          dedupeKey: data.dedupeKey.trim(),
          tenantId: data.tenantId.trim(),
          accountId: data.accountId.trim(),
          conversationId: data.conversationId.trim(),
          messageId: data.messageId.trim(),
          phoneNumberId: data.phoneNumberId.trim(),
          recipientWaId: data.recipientWaId.trim(),
          text: data.text,
          status: 'PENDING'
        }
      });

      this.pulseWorker();
      return {
        success: true,
        job: {
          id: created.id,
          dedupeKey: created.dedupeKey,
          tenantId: created.tenantId,
          accountId: created.accountId,
          conversationId: created.conversationId,
          messageId: created.messageId,
          phoneNumberId: created.phoneNumberId,
          recipientWaId: created.recipientWaId,
          text: created.text,
          attempts: created.attempts,
          createdAt: created.createdAt
        }
      };
    } catch (err: any) {
      if (err.code === 'P2002' || err.message?.includes('Unique constraint')) {
        logger.info(`PostgresOutboundQueue: Deduplicated existing outbound job with key [${data.dedupeKey}]`);
        const existing = await this.prisma.whatsAppOutboundJob.findUnique({
          where: { dedupeKey: data.dedupeKey.trim() }
        });
        if (existing) {
          return {
            success: true,
            job: {
              id: existing.id,
              dedupeKey: existing.dedupeKey,
              tenantId: existing.tenantId,
              accountId: existing.accountId,
              conversationId: existing.conversationId,
              messageId: existing.messageId,
              phoneNumberId: existing.phoneNumberId,
              recipientWaId: existing.recipientWaId,
              text: existing.text,
              attempts: existing.attempts,
              createdAt: existing.createdAt
            }
          };
        }
      }
      logger.error(`PostgresOutboundQueue: Enqueue failed: ${err.message || err}`);
      throw err;
    }
  }

  async claimNextJob(): Promise<OutboundQueueJob | null> {
    const claimed = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<any[]>`
        WITH candidate AS (
          SELECT id
          FROM "WhatsAppOutboundJob"
          WHERE (
            status = 'PENDING'
            OR
            (status = 'PROCESSING' AND "lockedAt" <= NOW() - (${this.leaseSeconds} * INTERVAL '1 second'))
          )
          ORDER BY "createdAt" ASC, id ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        )
        UPDATE "WhatsAppOutboundJob" j
        SET status = 'PROCESSING',
            "lockedAt" = NOW(),
            "lockedBy" = ${this.workerId},
            attempts = j.attempts + 1,
            "updatedAt" = NOW()
        FROM candidate
        WHERE j.id = candidate.id
        RETURNING j.*
      `;
      return rows;
    });

    if (!claimed || claimed.length === 0) {
      return null;
    }

    const row = claimed[0];
    return {
      id: row.id,
      dedupeKey: row.dedupeKey,
      tenantId: row.tenantId,
      accountId: row.accountId,
      conversationId: row.conversationId,
      messageId: row.messageId,
      phoneNumberId: row.phoneNumberId,
      recipientWaId: row.recipientWaId,
      text: row.text,
      attempts: row.attempts,
      createdAt: row.createdAt
    };
  }

  async completeJob(jobId: string, providerMessageId: string): Promise<void> {
    let completedTenantId: string | undefined;

    await this.prisma.$transaction(async (tx) => {
      const job = await tx.whatsAppOutboundJob.update({
        where: { id: jobId },
        data: {
          status: 'COMPLETED',
          providerMessageId,
          completedAt: new Date(),
          lockedAt: null,
          lockedBy: null
        }
      });
      completedTenantId = job.tenantId;

      // Update associated Message record
      const message = await tx.message.findUnique({
        where: { id: job.messageId }
      });

      if (message) {
        const metadata = (message.metadata && typeof message.metadata === 'object' && !Array.isArray(message.metadata))
          ? { ...message.metadata }
          : {};
        metadata.deliveryStatus = 'SENT';
        metadata.sentAt = Date.now();
        metadata.providerMessageId = providerMessageId;

        await tx.message.update({
          where: { id: message.id },
          data: {
            externalId: providerMessageId,
            metadata
          }
        });
      }

      await tx.channelAuditEvent.create({
        data: {
          tenantId: job.tenantId,
          accountId: job.accountId,
          conversationId: job.conversationId,
          action: 'HUMAN_MESSAGE_SENT',
          metadata: { providerMessageId, messageId: job.messageId }
        }
      });
    });

    logger.info(`PostgresOutboundQueue: Outbound job [${jobId}] completed with Meta ID [${providerMessageId}]`);

    // Reconcile early delivery receipts that arrived before this job completed
    if (this.deliveryReceiptProcessor && completedTenantId) {
      try {
        await this.deliveryReceiptProcessor.reconcileReceiptsForProviderId(completedTenantId, providerMessageId);
      } catch (err: any) {
        logger.error(`PostgresOutboundQueue: Failed to reconcile receipts for [${providerMessageId}]: ${err.message || err}`);
      }
    }
  }

  async failJob(jobId: string, error: string, isRetryable: boolean = false, errorCode?: string | number | null): Promise<void> {
    const isUnknown = errorCode === 'DELIVERY_UNKNOWN' || error.includes('Delivery outcome unknown') || error.includes('DELIVERY_UNKNOWN');
    const effectivelyRetryable = isUnknown ? false : isRetryable;

    await this.prisma.$transaction(async (tx) => {
      const job = await tx.whatsAppOutboundJob.findUnique({
        where: { id: jobId }
      });

      if (!job) return;

      const shouldRetry = effectivelyRetryable && job.attempts < job.maxAttempts;

      await tx.whatsAppOutboundJob.update({
        where: { id: jobId },
        data: {
          status: shouldRetry ? 'PENDING' : 'FAILED',
          lastError: error,
          completedAt: shouldRetry ? null : new Date(),
          lockedAt: null,
          lockedBy: null
        }
      });

      if (!shouldRetry) {
        const message = await tx.message.findUnique({
          where: { id: job.messageId }
        });

        if (message) {
          const metadata = (message.metadata && typeof message.metadata === 'object' && !Array.isArray(message.metadata))
            ? { ...message.metadata }
            : {};
          metadata.deliveryStatus = isUnknown ? 'DELIVERY_UNKNOWN' : 'FAILED';
          metadata.error = error;
          if (errorCode) {
            metadata.errorCode = errorCode;
          } else if (isUnknown) {
            metadata.errorCode = 'DELIVERY_UNKNOWN';
          }

          await tx.message.update({
            where: { id: message.id },
            data: { metadata }
          });
        }

        await tx.channelAuditEvent.create({
          data: {
            tenantId: job.tenantId,
            accountId: job.accountId,
            conversationId: job.conversationId,
            action: isUnknown ? 'HUMAN_MESSAGE_DELIVERY_UNKNOWN' : 'HUMAN_MESSAGE_FAILED',
            metadata: { error, errorCode: errorCode ?? (isUnknown ? 'DELIVERY_UNKNOWN' : undefined), messageId: job.messageId }
          }
        });
      }
    });
    logger.warn(`PostgresOutboundQueue: Outbound job [${jobId}] failed: ${error} (retryable: ${effectivelyRetryable}, code: ${errorCode})`);
  }

  startWorker(): void {
    if (this.disableWorker) return;
    if (this.pollTimer) return;

    this.pollTimer = setInterval(async () => {
      if (this.isShuttingDown || !this.handler) return;
      try {
        const job = await this.claimNextJob();
        if (job) {
          this.activeJobs++;
          try {
            await this.handler(job);
          } finally {
            this.activeJobs--;
          }
        }
      } catch (err: any) {
        logger.error(`PostgresOutboundQueue: Error during worker poll: ${err.message || err}`);
      }
    }, this.pollIntervalMs);
  }

  private pulseWorker(): void {
    if (this.disableWorker || !this.handler || this.isShuttingDown) return;
    const handler = this.handler;
    setImmediate(async () => {
      try {
        const job = await this.claimNextJob();
        if (job) {
          this.activeJobs++;
          try {
            await handler(job);
          } finally {
            this.activeJobs--;
          }
        }
      } catch {}
    });
  }

  async shutdown(): Promise<void> {
    this.isShuttingDown = true;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
    while (this.activeJobs > 0) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}

/**
 * In-Memory Outbound Queue for testing and local dev.
 */
export class MemoryOutboundQueue implements OutboundMessageQueue {
  private jobs = new Map<string, OutboundQueueJob>();
  private dedupeMap = new Map<string, string>();
  private handler: OutboundJobHandler | null = null;
  private isShuttingDown = false;
  private activeJobs = 0;

  constructor(private prisma?: PrismaClient) {}

  registerHandler(handler: OutboundJobHandler): void {
    this.handler = handler;
  }

  async enqueue(data: Omit<OutboundQueueJob, 'id' | 'attempts' | 'createdAt'>): Promise<{ success: boolean; job: OutboundQueueJob }> {
    const existingId = this.dedupeMap.get(data.dedupeKey);
    if (existingId) {
      const existing = this.jobs.get(existingId)!;
      return { success: true, job: existing };
    }

    const job: OutboundQueueJob = {
      ...data,
      id: `mem-job-${Math.random().toString(36).substring(2, 9)}`,
      attempts: 0,
      createdAt: new Date()
    };

    this.jobs.set(job.id, job);
    this.dedupeMap.set(data.dedupeKey, job.id);

    if (this.handler && !this.isShuttingDown) {
      setImmediate(async () => {
        this.activeJobs++;
        try {
          await this.handler!(job);
        } finally {
          this.activeJobs--;
        }
      });
    }

    return { success: true, job };
  }

  async completeJob(jobId: string, providerMessageId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (job && this.prisma) {
      const message = await this.prisma.message.findUnique({ where: { id: job.messageId } });
      if (message) {
        const metadata = (message.metadata && typeof message.metadata === 'object' && !Array.isArray(message.metadata))
          ? { ...message.metadata }
          : {};
        metadata.deliveryStatus = 'SENT';
        metadata.sentAt = Date.now();
        metadata.providerMessageId = providerMessageId;
        await this.prisma.message.update({
          where: { id: message.id },
          data: { externalId: providerMessageId, metadata }
        });
      }
      try {
        const processor = new WhatsAppDeliveryReceiptProcessor(this.prisma);
        await processor.reconcileReceiptsForProviderId(job.tenantId, providerMessageId);
      } catch {}
    }
  }

  async failJob(jobId: string, error: string, isRetryable: boolean = false, errorCode?: string | number | null): Promise<void> {
    const job = this.jobs.get(jobId);
    if (job && this.prisma) {
      const isUnknown = errorCode === 'DELIVERY_UNKNOWN' || error.includes('Delivery outcome unknown') || error.includes('DELIVERY_UNKNOWN');
      const message = await this.prisma.message.findUnique({ where: { id: job.messageId } });
      if (message) {
        const metadata = (message.metadata && typeof message.metadata === 'object' && !Array.isArray(message.metadata))
          ? { ...message.metadata }
          : {};
        metadata.deliveryStatus = isUnknown ? 'DELIVERY_UNKNOWN' : 'FAILED';
        metadata.error = error;
        if (errorCode) {
          metadata.errorCode = errorCode;
        } else if (isUnknown) {
          metadata.errorCode = 'DELIVERY_UNKNOWN';
        }
        await this.prisma.message.update({
          where: { id: message.id },
          data: { metadata }
        });
      }
    }
  }

  async shutdown(): Promise<void> {
    this.isShuttingDown = true;
    while (this.activeJobs > 0) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    this.jobs.clear();
    this.dedupeMap.clear();
  }
}

/**
 * Worker component that executes outbound delivery for manual human messages.
 */
export class WhatsAppOutboundWorker {
  constructor(
    private queue: OutboundMessageQueue,
    private outboundAdapter: WhatsAppOutboundAdapter
  ) {
    if (this.queue.registerHandler) {
      this.queue.registerHandler(this.processJob.bind(this));
    }
  }

  async processJob(job: OutboundQueueJob): Promise<void> {
    try {
      logger.info(`WhatsAppOutboundWorker: Dispatching message for job [${job.id}] to [${job.recipientWaId}]`);
      const result = await this.outboundAdapter.sendTextMessage({
        phoneNumberId: job.phoneNumberId,
        to: job.recipientWaId,
        text: job.text
      });

      if (result.success && result.providerMessageId) {
        if (this.queue.completeJob) {
          await this.queue.completeJob(job.id, result.providerMessageId);
        }
      } else {
        if (this.queue.failJob) {
          await this.queue.failJob(
            job.id,
            result.error || 'Outbound delivery failed',
            Boolean(result.isRetryable),
            result.errorCode
          );
        }
      }
    } catch (err: any) {
      logger.error(`WhatsAppOutboundWorker: Unexpected delivery error for job [${job.id}]: ${err.message || err}`);
      if (this.queue.failJob) {
        await this.queue.failJob(job.id, err.message || 'Internal dispatch error', false);
      }
    }
  }
}
