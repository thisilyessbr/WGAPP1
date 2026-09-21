import { PrismaClient, Conversation, ConversationAutomationState } from '@prisma/client';
import { logger } from '../../utils/logger';

export type AutomationOwnershipState = 'AI_ACTIVE' | 'HUMAN_REQUIRED' | 'HUMAN_ACTIVE' | 'RESOLVED';

export interface TransitionParams {
  tenantId: string;
  conversationId: string;
  actorId?: string;
  reason?: string;
  accountId?: string;
}

export class ConversationAutomationService {
  constructor(private prisma: PrismaClient) {}

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

      // If already in HUMAN_ACTIVE, do not downgrade back to HUMAN_REQUIRED
      if (conv.status === 'HUMAN_ACTIVE') {
        return conv as Conversation;
      }

      const updatedConv = await tx.conversation.update({
        where: { id: conversationId },
        data: {
          status: 'HANDOFF_REQUESTED',
          humanRequested: true,
          humanRequestedAt: conv.humanRequestedAt || new Date(),
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

      logger.info(`ConversationAutomationService: Handoff requested for conversation [${conversationId}]`);
      return updatedConv;
    });
  }

  /**
   * Transition: HUMAN_REQUIRED -> HUMAN_ACTIVE or AI_ACTIVE -> HUMAN_ACTIVE
   * Triggered when a merchant explicitly claims or takes over the conversation.
   * Atomic & idempotent.
   */
  async takeover(params: TransitionParams): Promise<Conversation> {
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
        ? conv.contextData
        : {};

      const updatedContext = {
        ...existingContext,
        _portalHandoff: {
          ownerId: actor,
          claimedAt: existingContext._portalHandoff?.claimedAt || new Date().toISOString()
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

      logger.info(`ConversationAutomationService: Human takeover activated on conversation [${conversationId}] by [${actor}]`);
      return updatedConv;
    });
  }

  /**
   * Transition: HUMAN_ACTIVE -> RESOLVED or HUMAN_REQUIRED -> RESOLVED
   * Triggered when merchant marks the conversation as resolved.
   * Atomic & idempotent.
   */
  async resolve(params: TransitionParams): Promise<Conversation> {
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

      logger.info(`ConversationAutomationService: Conversation [${conversationId}] marked RESOLVED by [${actor}]`);
      return updatedConv;
    });
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
