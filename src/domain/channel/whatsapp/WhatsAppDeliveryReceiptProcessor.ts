import { PrismaClient } from '@prisma/client';
import { logger } from '../../../utils/logger';
import {
  canTransitionDeliveryStatus,
  normalizeProviderStatus,
  DeliveryStatus
} from './WhatsAppDeliveryStateMachine';

export interface DeliveryReceiptRow {
  id?: string;
  dedupeKey?: string;
  tenantId: string;
  accountId?: string | null;
  phoneNumberId?: string;
  providerMessageId: string;
  recipientWaId?: string;
  status: string;
  providerTimestamp?: Date;
  errorCode?: number | null;
  errorMessage?: string | null;
  correlated?: boolean;
  createdAt?: Date;
}

export class WhatsAppDeliveryReceiptProcessor {
  private reconcileCursor: { createdAt: Date; id: string } | null = null;

  constructor(private prisma: PrismaClient) {}

  /**
   * Applies an incoming receipt to the correlated Message record.
   *
   * Enforces:
   * 1. Monotonic status progression via canTransitionDeliveryStatus.
   * 2. CRITICAL (User Directive 1): DELIVERED or READ must NEVER regress to FAILED.
   * 3. Two-way reconciliation: Unmatched receipts remain correlated = false.
   */
  async applyReceipt(receipt: DeliveryReceiptRow): Promise<{
    correlated: boolean;
    applied: boolean;
    reason?: string;
  }> {
    const targetStatus = normalizeProviderStatus(receipt.status);
    if (!targetStatus) {
      logger.warn(`WhatsAppDeliveryReceiptProcessor: Unknown provider status [${receipt.status}] for receipt [${receipt.id}]`);
      return { correlated: false, applied: false, reason: 'UNKNOWN_STATUS' };
    }

    return this.prisma.$transaction(async (tx) => {
      // Lock the message before reading its status. A second receipt must make
      // its transition decision from the first receipt's committed status.
      const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "Message"
        WHERE "tenantId"=${receipt.tenantId} AND "externalId"=${receipt.providerMessageId} FOR UPDATE`;
      if (!locked.length) {
        logger.info(`WhatsAppDeliveryReceiptProcessor: Unmatched receipt [${receipt.id}] for wamid [${receipt.providerMessageId}]. Retaining for reconciliation.`);
        return { correlated: false, applied: false, reason: 'MESSAGE_NOT_YET_COMMITTED' };
      }

      const message = await tx.message.findUniqueOrThrow({ where: { id: locked[0].id } });
      const existingMeta = (message.metadata && typeof message.metadata === 'object' && !Array.isArray(message.metadata))
        ? { ...(message.metadata as Record<string, any>) }
        : {};
      const currentStatus: DeliveryStatus = (existingMeta.deliveryStatus as DeliveryStatus) || 'PENDING';
      if (!canTransitionDeliveryStatus(currentStatus, targetStatus)) {
        logger.info(`WhatsAppDeliveryReceiptProcessor: Suppressed status transition from [${currentStatus}] to [${targetStatus}] for message [${message.id}]`);
        if (receipt.id) {
          await tx.whatsAppDeliveryReceipt.update({ where: { id: receipt.id }, data: { correlated: true } });
        }
        return { correlated: true, applied: false, reason: `TRANSITION_PROHIBITED_${currentStatus}_TO_${targetStatus}` };
      }

      const timestampMs = receipt.providerTimestamp ? receipt.providerTimestamp.getTime() : Date.now();
      existingMeta.deliveryStatus = targetStatus;
      if (targetStatus === 'SENT') {
        existingMeta.sentAt = timestampMs;
      } else if (targetStatus === 'DELIVERED') {
        existingMeta.deliveredAt = timestampMs;
        if (!existingMeta.sentAt) existingMeta.sentAt = timestampMs;
      } else if (targetStatus === 'READ') {
        existingMeta.readAt = timestampMs;
        if (!existingMeta.deliveredAt) existingMeta.deliveredAt = timestampMs;
        if (!existingMeta.sentAt) existingMeta.sentAt = timestampMs;
      } else if (targetStatus === 'FAILED') {
        existingMeta.failedAt = timestampMs;
        if (receipt.errorCode) existingMeta.providerErrorCode = receipt.errorCode;
        if (receipt.errorMessage) existingMeta.providerErrorMessage = receipt.errorMessage;
        existingMeta.error = receipt.errorMessage || `WhatsApp delivery failed (code: ${receipt.errorCode ?? 'unknown'})`;
      }

      await tx.message.update({ where: { id: message.id }, data: { metadata: existingMeta } });
      if (receipt.id) {
        await tx.whatsAppDeliveryReceipt.update({ where: { id: receipt.id }, data: { correlated: true } });
      }
      logger.info(`WhatsAppDeliveryReceiptProcessor: Applied status [${targetStatus}] to message [${message.id}] (Meta wamid: [${receipt.providerMessageId}])`);
      return { correlated: true, applied: true };
    });
  }

  /**
   * Immediately reconciles any pending receipts buffered for a newly committed providerMessageId (wamid).
   * Resolves Race 1 (Webhook arriving before DB commit completes).
   */
  async reconcileReceiptsForProviderId(tenantId: string, providerMessageId: string): Promise<number> {
    if (!tenantId || !providerMessageId) return 0;

    const pendingReceipts = await this.prisma.whatsAppDeliveryReceipt.findMany({
      where: {
        tenantId,
        providerMessageId,
        correlated: false
      },
      orderBy: { providerTimestamp: 'asc' }
    });

    let appliedCount = 0;
    for (const receipt of pendingReceipts) {
      const res = await this.applyReceipt(receipt as DeliveryReceiptRow);
      if (res.applied) appliedCount++;
    }

    return appliedCount;
  }

  /**
   * Background sweep reconciling straggler receipts created within the last 2 hours.
   */
  async reconcilePendingReceipts(limit = 100): Promise<number> {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    // Keyset cursor across sweeps: each sweep resumes after the last receipt the
    // previous sweep inspected, so a backlog of permanently unmatched receipts
    // can never pin the window to the same oldest `limit` rows. The cursor
    // wraps to the start once a sweep reaches the end of the window.
    const cursor = this.reconcileCursor && this.reconcileCursor.createdAt >= twoHoursAgo ? this.reconcileCursor : null;

    const pending = await this.prisma.whatsAppDeliveryReceipt.findMany({
      where: {
        correlated: false,
        createdAt: { gte: twoHoursAgo },
        ...(cursor ? {
          OR: [
            { createdAt: { gt: cursor.createdAt } },
            { createdAt: cursor.createdAt, id: { gt: cursor.id } }
          ]
        } : {})
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit
    });

    const last = pending[pending.length - 1];
    this.reconcileCursor = pending.length < limit || !last ? null : { createdAt: last.createdAt, id: last.id };

    let reconciledCount = 0;
    for (const receipt of pending) {
      const res = await this.applyReceipt(receipt as DeliveryReceiptRow);
      if (res.correlated) reconciledCount++;
    }

    return reconciledCount;
  }
}
