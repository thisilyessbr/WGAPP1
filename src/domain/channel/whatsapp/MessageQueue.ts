import { PrismaClient } from '@prisma/client';
import { logger } from '../../../utils/logger';

export interface InboundQueueJob {
  id: string; // wamid or unique job ID
  partitionKey: string; // tenantId:accountId:wa_id
  tenantId: string;
  accountId: string;
  phoneNumberId: string;
  waId: string;
  wamid: string;
  message: string;
  timestamp: number;
  contactName?: string;
  rawType: string;
  enqueuedAt: number;
}

export type JobHandler<T> = (job: T) => Promise<void>;

export interface MessageQueue<T = InboundQueueJob> {
  enqueue(job: T, partitionKey: string): Promise<boolean>;
  registerHandler(handler: JobHandler<T>): void;
  getPendingCount(partitionKey?: string): Promise<number> | number;
  getActiveCount(): Promise<number> | number;
  startWorker?(): void;
  shutdown(): Promise<void>;
}

/**
 * In-memory Partitioned FIFO Queue (for unit tests / local dev)
 */
export class PartitionedFifoQueue<T = InboundQueueJob> implements MessageQueue<T> {
  private partitionQueues = new Map<string, T[]>();
  private activePartitions = new Set<string>();
  private handler: JobHandler<T> | null = null;
  private isShuttingDown = false;

  constructor(private options: { maxPendingPerPartition?: number } = {}) {}

  registerHandler(handler: JobHandler<T>): void {
    this.handler = handler;
  }

  async enqueue(job: T, partitionKey: string): Promise<boolean> {
    if (this.isShuttingDown) {
      logger.warn(`PartitionedFifoQueue: Cannot enqueue job during shutdown`);
      return false;
    }

    if (!partitionKey) {
      logger.error(`PartitionedFifoQueue: partitionKey is required`);
      return false;
    }

    let queue = this.partitionQueues.get(partitionKey);
    if (!queue) {
      queue = [];
      this.partitionQueues.set(partitionKey, queue);
    }

    const maxPending = this.options.maxPendingPerPartition ?? 1000;
    if (queue.length >= maxPending) {
      logger.error(`PartitionedFifoQueue: Partition [${partitionKey}] exceeded maxPending limit (${maxPending})`);
      return false;
    }

    queue.push(job);

    if (!this.activePartitions.has(partitionKey)) {
      this.triggerPartitionWorker(partitionKey);
    }

    return true;
  }

  private triggerPartitionWorker(partitionKey: string): void {
    this.activePartitions.add(partitionKey);
    setImmediate(async () => {
      await this.processPartition(partitionKey);
    });
  }

  private async processPartition(partitionKey: string): Promise<void> {
    const queue = this.partitionQueues.get(partitionKey);
    if (!queue) {
      this.activePartitions.delete(partitionKey);
      return;
    }

    while (queue.length > 0 && !this.isShuttingDown) {
      const job = queue.shift()!;
      try {
        if (this.handler) {
          await this.handler(job);
        }
      } catch (err: any) {
        logger.error(`PartitionedFifoQueue: Error processing job on partition [${partitionKey}]: ${err.message || err}`);
      }
    }

    if (queue.length === 0) {
      this.partitionQueues.delete(partitionKey);
    }
    this.activePartitions.delete(partitionKey);
  }

  getPendingCount(partitionKey?: string): number {
    if (partitionKey) {
      return this.partitionQueues.get(partitionKey)?.length ?? 0;
    }
    let total = 0;
    for (const queue of this.partitionQueues.values()) {
      total += queue.length;
    }
    return total;
  }

  getActiveCount(): number {
    return this.activePartitions.size;
  }

  async shutdown(): Promise<void> {
    this.isShuttingDown = true;
    while (this.activePartitions.size > 0) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    this.partitionQueues.clear();
  }
}

export interface PostgresMessageQueueOptions {
  workerConcurrency?: number;
  pollIntervalMs?: number;
  leaseSeconds?: number;
  workerId?: string;
  autoStartWorker?: boolean;
}

/**
 * Durable PostgreSQL-backed Message Queue:
 * - Persists all jobs in WhatsAppMessageJob table with wamid uniqueness
 * - Guarantees strict FIFO per partitionKey (tenantId:accountId:wa_id)
 * - Allows full concurrency across different partitionKeys
 * - Uses atomic SELECT FOR UPDATE SKIP LOCKED for multi-instance distributed safety
 * - Never holds database transactions open while jobs execute
 * - Recovers crashed/stuck worker jobs automatically after lease expiration
 */
export class PostgresMessageQueue implements MessageQueue<InboundQueueJob> {
  private handler: JobHandler<InboundQueueJob> | null = null;
  private isShuttingDown = false;
  private activeWorkers = 0;
  private pollTimer?: NodeJS.Timeout;
  private readonly workerId: string;
  private readonly concurrency: number;
  private readonly pollIntervalMs: number;
  private readonly leaseSeconds: number;

  constructor(
    private prisma: PrismaClient,
    options: PostgresMessageQueueOptions = {}
  ) {
    this.workerId = options.workerId ?? `worker-${Math.random().toString(36).substring(2, 9)}`;
    this.concurrency = options.workerConcurrency ?? 5;
    this.pollIntervalMs = options.pollIntervalMs ?? 500;
    this.leaseSeconds = options.leaseSeconds ?? 60;

    if (options.autoStartWorker) {
      this.startWorker();
    }
  }

  registerHandler(handler: JobHandler<InboundQueueJob>): void {
    this.handler = handler;
  }

  /**
   * Durably enqueues a job into PostgreSQL.
   * Atomic wamid uniqueness constraint prevents duplicate job creation.
   */
  async enqueue(job: InboundQueueJob, partitionKey: string): Promise<boolean> {
    if (this.isShuttingDown) {
      logger.warn(`PostgresMessageQueue: Cannot enqueue job during shutdown`);
      return false;
    }

    try {
      await this.prisma.whatsAppMessageJob.create({
        data: {
          wamid: job.wamid.trim(),
          partitionKey: partitionKey.trim(),
          tenantId: job.tenantId.trim(),
          accountId: job.accountId.trim(),
          phoneNumberId: job.phoneNumberId.trim(),
          waId: job.waId.trim(),
          message: job.message,
          timestamp: BigInt(job.timestamp),
          contactName: job.contactName ?? null,
          rawType: job.rawType || 'text',
          status: 'PENDING'
        }
      });

      // Trigger immediate worker pulse
      this.pulseWorkers();
      return true;
    } catch (err: any) {
      if (err.code === 'P2002' || err.message?.includes('Unique constraint')) {
        logger.info(`PostgresMessageQueue: Skipped duplicate enqueue for wamid [${job.wamid}]`);
        return false;
      }
      logger.error(`PostgresMessageQueue: Enqueue failed for wamid [${job.wamid}]: ${err.message || err}`);
      throw err;
    }
  }

  /**
   * Atomically claims the next eligible FIFO job using PostgreSQL FOR UPDATE SKIP LOCKED.
   * Guarantees that:
   * 1. No earlier pending job exists for the same partition.
   * 2. No other active/unexpired PROCESSING job exists for the same partition.
   * 3. Two workers never claim the same job.
   */
  async claimNextJob(): Promise<InboundQueueJob | null> {
    const claimed = await this.prisma.$queryRawUnsafe<any[]>(`
      WITH candidate AS (
        SELECT j.id
        FROM "WhatsAppMessageJob" j
        WHERE (
          (j.status = 'PENDING' AND j."availableAt" <= NOW())
          OR
          (j.status = 'PROCESSING' AND j."lockedAt" <= NOW() - INTERVAL '${this.leaseSeconds} seconds')
        )
          AND NOT EXISTS (
            SELECT 1 FROM "WhatsAppMessageJob" earlier
            WHERE earlier."partitionKey" = j."partitionKey"
              AND earlier.status = 'PENDING'
              AND earlier."createdAt" < j."createdAt"
          )
          AND NOT EXISTS (
            SELECT 1 FROM "WhatsAppMessageJob" active
            WHERE active."partitionKey" = j."partitionKey"
              AND active.status = 'PROCESSING'
              AND active.id != j.id
              AND active."lockedAt" > NOW() - INTERVAL '${this.leaseSeconds} seconds'
          )
        ORDER BY j."createdAt" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      UPDATE "WhatsAppMessageJob" j
      SET status = 'PROCESSING',
          "lockedAt" = NOW(),
          "lockedBy" = '${this.workerId}',
          attempts = j.attempts + 1,
          "updatedAt" = NOW()
      FROM candidate
      WHERE j.id = candidate.id
      RETURNING j.*;
    `);

    if (!claimed || claimed.length === 0) {
      return null;
    }

    const row = claimed[0];
    return {
      id: row.id,
      partitionKey: row.partitionKey,
      tenantId: row.tenantId,
      accountId: row.accountId,
      phoneNumberId: row.phoneNumberId,
      waId: row.waId,
      wamid: row.wamid,
      message: row.message,
      timestamp: Number(row.timestamp),
      contactName: row.contactName ?? undefined,
      rawType: row.rawType,
      enqueuedAt: new Date(row.createdAt).getTime()
    };
  }

  async completeJob(
    jobId: string,
    options?: string | { response?: string; outboundStatus?: string; outboundMessageId?: string; outboundError?: string }
  ): Promise<void> {
    const opts = typeof options === 'string' ? { response: options } : (options || {});
    await this.prisma.whatsAppMessageJob.update({
      where: { id: jobId },
      data: {
        status: 'COMPLETED',
        response: opts.response ?? null,
        outboundStatus: opts.outboundStatus ?? 'SENT',
        outboundMessageId: opts.outboundMessageId ?? null,
        outboundError: opts.outboundError ?? null,
        completedAt: new Date()
      }
    }).catch((err) => logger.error(`PostgresMessageQueue: Error completing job [${jobId}]: ${err}`));
  }

  async failJob(jobId: string, error: Error | string, backoffSeconds = 5): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const job = await this.prisma.whatsAppMessageJob.findUnique({ where: { id: jobId } });
    if (!job) return;

    if (job.attempts >= job.maxAttempts) {
      await this.prisma.whatsAppMessageJob.update({
        where: { id: jobId },
        data: {
          status: 'FAILED',
          lastError: errorMessage
        }
      }).catch(() => {});
    } else {
      await this.prisma.whatsAppMessageJob.update({
        where: { id: jobId },
        data: {
          status: 'PENDING',
          availableAt: new Date(Date.now() + backoffSeconds * 1000),
          lockedAt: null,
          lockedBy: null,
          lastError: errorMessage
        }
      }).catch(() => {});
    }
  }

  startWorker(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      this.pulseWorkers();
    }, this.pollIntervalMs);
    this.pulseWorkers();
  }

  private pulseWorkers(): void {
    if (this.isShuttingDown || !this.handler) return;

    while (this.activeWorkers < this.concurrency && !this.isShuttingDown) {
      this.activeWorkers++;
      setImmediate(async () => {
        try {
          await this.workerLoop();
        } finally {
          this.activeWorkers--;
        }
      });
    }
  }

  private async workerLoop(): Promise<void> {
    while (!this.isShuttingDown && this.handler) {
      let job: InboundQueueJob | null = null;
      try {
        job = await this.claimNextJob();
      } catch (err: any) {
        logger.error(`PostgresMessageQueue: Error claiming next job: ${err.message || err}`);
        break;
      }

      if (!job) {
        // No pending work eligible to claim
        break;
      }

      try {
        // Execute handler (Note: NO DB transaction is held during execution)
        const result: any = await this.handler(job);
        const responseText = typeof result === 'string' ? result : (result && typeof result.response === 'string' ? result.response : undefined);
        const outboundStatus = result?.outboundResult?.success ? 'SENT' : (result?.outboundResult ? 'FAILED' : 'SENT');
        const outboundMessageId = result?.outboundResult?.providerMessageId || null;
        const outboundError = result?.outboundResult?.error || null;

        await this.completeJob(job.id, {
          response: responseText,
          outboundStatus,
          outboundMessageId,
          outboundError
        });
      } catch (err: any) {
        logger.error(`PostgresMessageQueue: Error processing job [${job.wamid}]: ${err.message || err}`);
        await this.failJob(job.id, err);
      }
    }
  }

  async getPendingCount(partitionKey?: string): Promise<number> {
    if (partitionKey) {
      return this.prisma.whatsAppMessageJob.count({
        where: { partitionKey, status: 'PENDING' }
      });
    }
    return this.prisma.whatsAppMessageJob.count({
      where: { status: 'PENDING' }
    });
  }

  async getActiveCount(): Promise<number> {
    return this.prisma.whatsAppMessageJob.count({
      where: { status: 'PROCESSING' }
    });
  }

  async shutdown(): Promise<void> {
    this.isShuttingDown = true;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
    while (this.activeWorkers > 0) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}
