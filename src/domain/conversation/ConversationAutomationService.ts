import { PrismaClient, Conversation, ConversationAutomationState } from '@prisma/client';
import { logger } from '../../utils/logger';
import { OutcomeTrackingService } from '../outcome/OutcomeTrackingService';
import { RecordOutcomeParams } from '../outcome/types';

export type AutomationOwnershipState = 'AI_ACTIVE' | 'HUMAN_REQUIRED' | 'HUMAN_ACTIVE' | 'RESOLVED';

export interface TransitionParams {
  tenantId: string;
  conversationId: string;
  actorId?: string;
  reason?: string;
  accountId?: string;
}

export class ConversationAutomationService {
  constructor(
    private prisma: PrismaClient,
    private outcomeService?: OutcomeTrackingService
  ) {}

  private async recordOutcomeAfterCommit(params?: RecordOutcomeParams): Promise<void> {
    if (!params || !this.outcomeService) return;
    try {
      await this.outcomeService.recordEvent(params);
    } catch (error) {
      // Outcome telemetry must never undo a completed ownership transition.
      logger.warn('ConversationAutomationService: Outcome tracking failed after ownership transition', { error });
    }
  }

  /**
   * Authoritatively computes the ownership state of a conversation.
   * State priority:
   * 1. HUMAN_ACTIVE if human takeover is true or status is HUMAN_ACTIVE
   * 2. HUMAN_REQUIRED if handoff is requested or humanRequested is true
   * 3. RESOLVED if status is RESOLVED
   * 4. AI_ACTIVE if status is ACTIVE and bot is enabled
   */
  async getOwnershipState(tenantId: string, conversationId: string): Promise<AutomationOwnershipState> {
    const [conv, autoState] = await Promise.all([
      this.prisma.conversation.findUnique({
        where: { id: conversationId }
      }),
      this.prisma.conversationAutomationState.findUnique({
        where: { conversationId }
      })
    ]);

    if (!conv || conv.tenantId !== tenantId) {
      throw new Error(`Conversation [${conversationId}] not found for tenant [${tenantId}]`);
    }

    if (autoState?.humanTakeover || conv.status === 'HUMAN_ACTIVE') {
      return 'HUMAN_ACTIVE';
    }

    if (conv.status === 'HANDOFF_REQUESTED' || conv.humanRequested) {
      return 'HUMAN_REQUIRED';
    }

    if (conv.status === 'RESOLVED') {
      return 'RESOLVED';
    }

    return 'AI_ACTIVE';
  }

  /**
   * Single authoritative answer to: "May automated AI assistant reply right now?"
   * Strictly returns true ONLY when ownership is AI_ACTIVE and bot is not paused.
   */
  async mayAutomatedAssistantReply(tenantId: string, conversationId: string): Promise<boolean> {
    const [conv, autoState] = await Promise.all([
      this.prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { tenantId: true, status: true, humanRequested: true }
      }),
      this.prisma.conversationAutomationState.findUnique({
        where: { conversationId },
        select: { botEnabled: true, humanTakeover: true, pausedUntil: true }
      })
    ]);

    if (!conv || conv.tenantId !== tenantId) {
      return false;
    }

    // If human takeover is active, bot must NEVER reply
    if (autoState?.humanTakeover || conv.status === 'HUMAN_ACTIVE') {
      return false;
    }

    // If human handoff is requested, bot must not reply (suppress all regular bot turns)
    if (conv.humanRequested || conv.status === 'HANDOFF_REQUESTED') {
      return false;
    }

    // If paused until future time
    if (autoState?.pausedUntil && autoState.pausedUntil > new Date()) {
      return false;
    }

    // If explicitly disabled
    if (autoState && !autoState.botEnabled) {
      return false;
    }

    // If resolved, bot remains inactive until customer starts new turn or merchant reopens
    if (conv.status === 'RESOLVED') {
      return false;
    }

    return conv.status === 'ACTIVE';
  }

  /**
   * Transition: AI_ACTIVE -> HUMAN_REQUIRED
   * Triggered when customer requests a human agent or keyword detection fires.
   */
  async requestHandoff(params: TransitionParams): Promise<Conversation> {
    const { tenantId, conversationId, actorId, reason } = params;

    const result = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<any[]>`
        SELECT c.id, c."accountId", c."customerId", c.status, c."humanRequested", c."humanRequestedAt", c."contextData",
               customer."externalId" AS "customerExternalId"
        FROM "Conversation" c
        JOIN "Customer" customer ON customer.id = c."customerId"
        WHERE c.id = ${conversationId} AND c."tenantId" = ${tenantId}
        FOR UPDATE OF c
      `;
      const conv = rows[0];
      if (!conv) {
        throw new Error(`Conversation [${conversationId}] not found for tenant [${tenantId}]`);
      }

      // If already in HUMAN_ACTIVE, do not downgrade back to HUMAN_REQUIRED
      if (conv.status === 'HUMAN_ACTIVE') {
        return { conversation: conv as Conversation };
      }

      const requestedAt = conv.humanRequestedAt ? new Date(conv.humanRequestedAt) : new Date();

      const updatedConv = await tx.conversation.update({
        where: { id: conversationId },
        data: {
          status: 'HANDOFF_REQUESTED',
          humanRequested: true,
          humanRequestedAt: requestedAt,
          updatedAt: new Date()
        }
      });

      await tx.conversationAutomationState.upsert({
        where: { conversationId },
        create: {
          tenantId,
          accountId: conv.accountId,
          conversationId,
          humanTakeover: false,
          botEnabled: false,
          pauseReason: reason || 'HANDOFF_REQUESTED',
          updatedBy: actorId || 'system'
        },
        update: {
          humanTakeover: false,
          botEnabled: false,
          pauseReason: reason || 'HANDOFF_REQUESTED',
          updatedBy: actorId || 'system'
        }
      });

      await this.recordAuditEvent(tx, {
        tenantId,
        accountId: conv.accountId,
        conversationId,
        actorId,
        action: 'HANDOFF_REQUESTED',
        metadata: { reason: reason || 'keyword_trigger' }
      });

      const outcome = conv.status !== 'HANDOFF_REQUESTED' && !conv.humanRequested && this.outcomeService && conv.accountId && !conv.customerExternalId?.startsWith('portal-preview:') ? {
          tenantId,
          accountId: conv.accountId,
          conversationId,
          customerId: conv.customerId,
          type: 'HANDOFF_REQUESTED' as const,
          source: 'HANDOFF' as const,
          occurredAt: requestedAt,
          idempotencyKey: `handoff:requested:${conversationId}:${requestedAt.getTime()}`,
          metadata: { reason: reason || 'keyword_trigger' }
        } : undefined;

      logger.info(`ConversationAutomationService: Handoff requested for conversation [${conversationId}]`);
      return { conversation: updatedConv, outcome };
    });

    await this.recordOutcomeAfterCommit(result.outcome);
    return result.conversation;
  }

  /**
   * Transition: HUMAN_REQUIRED -> HUMAN_ACTIVE or AI_ACTIVE -> HUMAN_ACTIVE
   * Triggered when a merchant explicitly claims or takes over the conversation.
   * Atomic & idempotent.
   */
  async takeover(params: TransitionParams): Promise<Conversation> {
    const { tenantId, conversationId, actorId } = params;
    const actor = actorId || 'merchant';

    const result = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<any[]>`
        SELECT c.id, c."accountId", c."customerId", c.status, c."humanRequested", c."humanRequestedAt", c."contextData",
               customer."externalId" AS "customerExternalId"
        FROM "Conversation" c
        JOIN "Customer" customer ON customer.id = c."customerId"
        WHERE c.id = ${conversationId} AND c."tenantId" = ${tenantId}
        FOR UPDATE OF c
      `;
      const conv = rows[0];
      if (!conv) {
        throw new Error(`Conversation [${conversationId}] not found for tenant [${tenantId}]`);
      }

      const existingContext = conv.contextData && typeof conv.contextData === 'object' && !Array.isArray(conv.contextData)
        ? conv.contextData
        : {};

      const claimedAt = existingContext._portalHandoff?.claimedAt || new Date().toISOString();
      const updatedContext = {
        ...existingContext,
        _portalHandoff: {
          ownerId: actor,
          claimedAt
        }
      };

      const updatedConv = await tx.conversation.update({
        where: { id: conversationId },
        data: {
          status: 'HUMAN_ACTIVE',
          humanRequested: true,
          humanRequestedAt: conv.humanRequestedAt || new Date(),
          contextData: updatedContext,
          updatedAt: new Date()
        }
      });

      await tx.conversationAutomationState.upsert({
        where: { conversationId },
        create: {
          tenantId,
          accountId: conv.accountId,
          conversationId,
          humanTakeover: true,
          botEnabled: false,
          updatedBy: actor
        },
        update: {
          humanTakeover: true,
          botEnabled: false,
          updatedBy: actor
        }
      });

      await this.recordAuditEvent(tx, {
        tenantId,
        accountId: conv.accountId,
        conversationId,
        actorId: actor,
        action: 'HUMAN_TAKEOVER_ACTIVATED',
        metadata: { claimedBy: actor }
      });

      let outcome: RecordOutcomeParams | undefined;
      if (conv.status !== 'HUMAN_ACTIVE' && this.outcomeService && conv.accountId && !conv.customerExternalId?.startsWith('portal-preview:')) {
        const claimTime = new Date(claimedAt).getTime();
        const requestTime = conv.humanRequestedAt ? new Date(conv.humanRequestedAt).getTime() : claimTime;
        const timeFromRequestToClaimMs = Math.max(0, claimTime - requestTime);

        outcome = {
          tenantId,
          accountId: conv.accountId,
          conversationId,
          customerId: conv.customerId,
          type: 'HANDOFF_CLAIMED',
          source: 'MERCHANT',
          occurredAt: new Date(claimedAt),
          idempotencyKey: `handoff:claimed:${conversationId}:${claimedAt}`,
          metadata: {
            claimedBy: actor,
            timeFromRequestToClaimMs
          }
        };
      }

      logger.info(`ConversationAutomationService: Human takeover activated on conversation [${conversationId}] by [${actor}]`);
      return { conversation: updatedConv, outcome };
    });

    await this.recordOutcomeAfterCommit(result.outcome);
    return result.conversation;
  }

  /**
   * Transition: HUMAN_ACTIVE -> RESOLVED or HUMAN_REQUIRED -> RESOLVED
   * Triggered when merchant marks the conversation as resolved.
   * Atomic & idempotent.
   */
  async resolve(params: TransitionParams): Promise<Conversation> {
    const { tenantId, conversationId, actorId } = params;
    const actor = actorId || 'merchant';

    const result = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<any[]>`
        SELECT c.id, c."accountId", c."customerId", c.status, c."humanRequested", c."humanRequestedAt", c."contextData",
               customer."externalId" AS "customerExternalId"
        FROM "Conversation" c
        JOIN "Customer" customer ON customer.id = c."customerId"
        WHERE c.id = ${conversationId} AND c."tenantId" = ${tenantId}
        FOR UPDATE OF c
      `;
      const conv = rows[0];
      if (!conv) {
        throw new Error(`Conversation [${conversationId}] not found for tenant [${tenantId}]`);
      }

      const existingContext = conv.contextData && typeof conv.contextData === 'object' && !Array.isArray(conv.contextData)
        ? { ...conv.contextData }
        : {};
      delete existingContext._portalHandoff;

      const updatedConv = await tx.conversation.update({
        where: { id: conversationId },
        data: {
          status: 'RESOLVED',
          humanRequested: false,
          humanRequestedAt: null,
          contextData: existingContext,
          updatedAt: new Date()
        }
      });

      await tx.conversationAutomationState.upsert({
        where: { conversationId },
        create: {
          tenantId,
          accountId: conv.accountId,
          conversationId,
          humanTakeover: false,
          botEnabled: true,
          pauseReason: null,
          pausedUntil: null,
          updatedBy: actor
        },
        update: {
          humanTakeover: false,
          botEnabled: true,
          pauseReason: null,
          pausedUntil: null,
          updatedBy: actor
        }
      });

      await this.recordAuditEvent(tx, {
        tenantId,
        accountId: conv.accountId,
        conversationId,
        actorId: actor,
        action: 'HANDOFF_RESOLVED',
        metadata: { resolvedBy: actor }
      });

      let outcome: RecordOutcomeParams | undefined;
      if (conv.status !== 'RESOLVED' && this.outcomeService && conv.accountId && !conv.customerExternalId?.startsWith('portal-preview:')) {
        const resolvedAt = new Date();
        const resolveTime = resolvedAt.getTime();
        const requestTime = conv.humanRequestedAt ? new Date(conv.humanRequestedAt).getTime() : undefined;
        const claimTime = conv.contextData?._portalHandoff?.claimedAt ? new Date(conv.contextData._portalHandoff.claimedAt).getTime() : undefined;

        const timeFromRequestToClaimMs = (requestTime && claimTime) ? Math.max(0, claimTime - requestTime) : undefined;
        const timeFromClaimToResolutionMs = claimTime ? Math.max(0, resolveTime - claimTime) : undefined;
        const totalResolutionTimeMs = requestTime ? Math.max(0, resolveTime - requestTime) : undefined;

        outcome = {
          tenantId,
          accountId: conv.accountId,
          conversationId,
          customerId: conv.customerId,
          type: 'HANDOFF_RESOLVED',
          source: 'MERCHANT',
          occurredAt: resolvedAt,
          idempotencyKey: `handoff:resolved:${conversationId}:${requestTime || claimTime || resolveTime}`,
          metadata: {
            resolvedBy: actor,
            timeFromRequestToClaimMs,
            timeFromClaimToResolutionMs,
            totalResolutionTimeMs
          }
        };
      }

      logger.info(`ConversationAutomationService: Conversation [${conversationId}] marked RESOLVED by [${actor}]`);
      return { conversation: updatedConv, outcome };
    });

    await this.recordOutcomeAfterCommit(result.outcome);
    return result.conversation;
  }

  /**
   * Transition: RESOLVED -> AI_ACTIVE or HUMAN_ACTIVE -> AI_ACTIVE
   * Triggered when merchant releases conversation back to bot or reopens automation.
   * Atomic & idempotent.
   */
  async reopen(params: TransitionParams): Promise<Conversation> {
    const { tenantId, conversationId, actorId } = params;
    const actor = actorId || 'merchant';

    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<any[]>`
        SELECT id, "accountId", status, "humanRequested", "humanRequestedAt", "contextData"
        FROM "Conversation"
        WHERE id = ${conversationId} AND "tenantId" = ${tenantId}
        FOR UPDATE
      `;
      const conv = rows[0];
      if (!conv) {
        throw new Error(`Conversation [${conversationId}] not found for tenant [${tenantId}]`);
      }

      const existingContext = conv.contextData && typeof conv.contextData === 'object' && !Array.isArray(conv.contextData)
        ? { ...conv.contextData }
        : {};
      delete existingContext._portalHandoff;

      const updatedConv = await tx.conversation.update({
        where: { id: conversationId },
        data: {
          status: 'ACTIVE',
          humanRequested: false,
          humanRequestedAt: null,
          contextData: existingContext,
          updatedAt: new Date()
        }
      });

      await tx.conversationAutomationState.upsert({
        where: { conversationId },
        create: {
          tenantId,
          accountId: conv.accountId,
          conversationId,
          humanTakeover: false,
          botEnabled: true,
          pauseReason: null,
          pausedUntil: null,
          updatedBy: actor
        },
        update: {
          humanTakeover: false,
          botEnabled: true,
          pauseReason: null,
          pausedUntil: null,
          updatedBy: actor
        }
      });

      await this.recordAuditEvent(tx, {
        tenantId,
        accountId: conv.accountId,
        conversationId,
        actorId: actor,
        action: 'BOT_AUTOMATION_RESUMED',
        metadata: { resumedBy: actor }
      });

      logger.info(`ConversationAutomationService: Conversation [${conversationId}] reopened to AI_ACTIVE by [${actor}]`);
      return updatedConv;
    });
  }

  private async recordAuditEvent(
    tx: any,
    params: {
      tenantId: string;
      accountId?: string | null;
      conversationId?: string | null;
      actorId?: string;
      action: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<void> {
    try {
      await tx.channelAuditEvent.create({
        data: {
          tenantId: params.tenantId,
          accountId: params.accountId ?? null,
          conversationId: params.conversationId ?? null,
          actorId: params.actorId ?? 'system',
          action: params.action,
          metadata: params.metadata ?? {}
        }
      });
    } catch (err: any) {
      logger.warn(`ConversationAutomationService: Failed to record audit event: ${err.message || err}`);
    }
  }
}
