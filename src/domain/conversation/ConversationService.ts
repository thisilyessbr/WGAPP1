import { PrismaClient, Conversation, WorkflowSession, Message } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { ConversationContext, buildConversationContext } from './ConversationContext';
import { logger } from '../../utils/logger';
import { WhatsAppDeliveryReceiptProcessor } from '../channel/whatsapp/WhatsAppDeliveryReceiptProcessor';
import { ConversationAutomationService } from './ConversationAutomationService';

export interface ConversationWithMessages extends Conversation {
  messages: Message[];
}

export class ConversationService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Retrieves the latest conversation for a customer within a tenant and optional account.
   * Priority:
   * 1. ACTIVE / HANDOFF_REQUESTED / HUMAN_ACTIVE (newest first)
   * 2. Latest ARCHIVED (newest first)
   * 3. null if no conversation exists.
   * Messages are included in chronological order (createdAt ASC).
   */
  async getLatestConversation(
    tenantId: string,
    customerId: string,
    accountId?: string | null
  ): Promise<ConversationWithMessages | null> {
    if (!tenantId || !customerId) return null;

    // 1. Resolve Customer by tenantId + externalId (or id)
    const customer = await this.prisma.customer.findFirst({
      where: {
        tenantId,
        OR: [
          { externalId: customerId },
          { id: customerId }
        ]
      }
    });

    if (!customer) return null;

    const trimmedAccountId = accountId && typeof accountId === 'string' && accountId.trim() ? accountId.trim() : null;

    const baseWhere: any = {
      tenantId,
      customerId: customer.id,
      accountId: trimmedAccountId
    };

    // 2. Check for active/handoff conversations first
    let conversation = await this.prisma.conversation.findFirst({
      where: {
        ...baseWhere,
        status: { in: ['ACTIVE', 'HANDOFF_REQUESTED', 'HUMAN_ACTIVE'] }
      },
      orderBy: { createdAt: 'desc' },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' }
        }
      }
    });

    // 3. If no active conversation, look for the latest archived conversation
    if (!conversation) {
      conversation = await this.prisma.conversation.findFirst({
        where: {
          ...baseWhere,
          status: 'ARCHIVED'
        },
        orderBy: { createdAt: 'desc' },
        include: {
          messages: {
            orderBy: { createdAt: 'asc' }
          }
        }
      });
    }

    return conversation as ConversationWithMessages | null;
  }

  async getOrCreateConversation(tenantId: string, externalId: string, accountId?: string | null, phoneNumberId?: string | null): Promise<Conversation> {
    const customer = await this.prisma.customer.upsert({
      where: { tenantId_externalId: { tenantId, externalId } },
      create: { tenantId, externalId },
      update: {},
    });

    const trimmedAccountId = accountId && typeof accountId === 'string' && accountId.trim() ? accountId.trim() : null;
    const sourcePhoneNumberId = phoneNumberId?.trim() || null;

    if (trimmedAccountId) {
      // Verify account exists and belongs to tenant
      const account = await this.prisma.account.findUnique({
        where: { id: trimmedAccountId }
      });
      if (!account || account.tenantId !== tenantId) {
        throw new Error(`Account [${trimmedAccountId}] not found for tenant [${tenantId}]`);
      }
    }

    return this.prisma.$transaction(async (tx) => {
      // Row-level lock on Customer to prevent concurrent creation race conditions
      await tx.$executeRaw`SELECT id FROM "Customer" WHERE id = ${customer.id} FOR UPDATE`;

      // Find active or handoff conversation that is not capped
      let conversation = await tx.conversation.findFirst({
        where: {
          tenantId,
          customerId: customer.id,
          status: { in: ['ACTIVE', 'HANDOFF_REQUESTED', 'HUMAN_ACTIVE'] },
          automationCapped: false,
          accountId: trimmedAccountId,
          sourcePhoneNumberId
        },
        orderBy: { createdAt: 'desc' }
      });

      if (!conversation) {
        conversation = await tx.conversation.create({
          data: {
            tenantId,
            customerId: customer.id,
            sourcePhoneNumberId,
            ...(trimmedAccountId ? { accountId: trimmedAccountId } : {})
          }
        });
      }
      return conversation;
    });
  }

  async requestHandoff(tenantId: string, conversationId: string): Promise<Conversation> {
    return new ConversationAutomationService(this.prisma).requestHandoff({ tenantId, conversationId });
  }

  async takeOverByHuman(tenantId: string, conversationId: string): Promise<Conversation> {
    return new ConversationAutomationService(this.prisma).takeover({ tenantId, conversationId });
  }

  async resolveHandoff(tenantId: string, conversationId: string): Promise<Conversation> {
    return new ConversationAutomationService(this.prisma).reopen({ tenantId, conversationId });
  }

  async persistMessage(tenantId: string, conversationId: string, role: string, content: string, externalId?: string | null, phoneNumberId?: string | null): Promise<Message> {
    if (externalId) {
      return this.prisma.message.upsert({
        where: { tenantId_externalId: { tenantId, externalId } },
        create: { tenantId, conversationId, role, content, externalId, phoneNumberId: phoneNumberId || null, metadata: { turnCommitted: true, responseExpected: false } },
        update: {}
      });
    }
    return this.prisma.message.create({
      data: { tenantId, conversationId, role, content, phoneNumberId: phoneNumberId || null }
    });
  }

  async getMessageCount(tenantId: string, conversationId: string): Promise<number> {
    return this.prisma.message.count({ where: { tenantId, conversationId } });
  }

  async getRecentMessages(tenantId: string, conversationId: string, limit: number): Promise<Message[]> {
    return this.prisma.message.findMany({
      where: { tenantId, conversationId },
      orderBy: { createdAt: 'desc' },
      take: limit
    });
  }

  async getActiveSession(tenantId: string, conversationId: string): Promise<WorkflowSession | null> {
    return this.prisma.workflowSession.findFirst({
      where: { tenantId, conversationId, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' }
    });
  }

  async getLatestCompletedSession(tenantId: string, conversationId: string): Promise<WorkflowSession | null> {
    return this.prisma.workflowSession.findFirst({
      where: { tenantId, conversationId, status: 'COMPLETED' },
      orderBy: { createdAt: 'desc' }
    });
  }

  async countCompletedWorkflowSessions(
    tenantId: string,
    customerId: string,
    workflowId: string,
    accountId?: string | null
  ): Promise<number> {
    if (!tenantId || !customerId || !workflowId) return 0;
    const trimmedAccountId = accountId && typeof accountId === 'string' && accountId.trim() ? accountId.trim() : null;

    const customer = await this.prisma.customer.findFirst({
      where: {
        tenantId,
        OR: [
          { externalId: customerId },
          { id: customerId }
        ]
      }
    });

    if (!customer) return 0;

    return this.prisma.workflowSession.count({
      where: {
        tenantId,
        workflowId,
        status: 'COMPLETED',
        conversation: {
          tenantId,
          customerId: customer.id,
          ...(trimmedAccountId ? { accountId: trimmedAccountId } : {})
        }
      }
    });
  }

  async createSession(tenantId: string, conversationId: string, workflowId: string, stateId: string): Promise<WorkflowSession> {
    // A new workflow is only made visible when its first conversation turn commits.
    // Do not write an ACTIVE session before the response and lead are ready.
    const now = new Date();
    return {
      id: randomUUID(), tenantId, conversationId, workflowId, stateId,
      stateHistory: [], collectedData: {}, humanRequested: false,
      humanRequestedAt: null, status: 'ACTIVE', contextData: {},
      createdAt: now, updatedAt: now
    };
  }

  async updateSessionState(
    tenantId: string,
    sessionId: string,
    stateId: string,
    contextData: Record<string, any>,
    status: string = 'ACTIVE',
    extra: { stateHistory?: string[]; collectedData?: Record<string, any>; humanRequested?: boolean; humanRequestedAt?: Date | null } = {}
  ): Promise<WorkflowSession> {
    return this.prisma.workflowSession.update({
      where: { id: sessionId },
      data: {
        stateId,
        contextData,
        status,
        ...(extra.stateHistory !== undefined ? { stateHistory: extra.stateHistory } : {}),
        ...(extra.collectedData !== undefined ? { collectedData: extra.collectedData } : {}),
        ...(extra.humanRequested !== undefined ? { humanRequested: extra.humanRequested } : {}),
        ...(extra.humanRequestedAt !== undefined ? { humanRequestedAt: extra.humanRequestedAt } : {})
      }
    });
  }

  async completeSession(tenantId: string, sessionId: string): Promise<void> {
    await this.prisma.workflowSession.update({
      where: { id: sessionId },
      data: { status: 'COMPLETED' }
    });
  }

  async flagHumanRequested(tenantId: string, conversationId: string): Promise<Conversation> {
    return new ConversationAutomationService(this.prisma).requestHandoff({ tenantId, conversationId });
  }

  async getAutomationState(tenantId: string, conversationId: string): Promise<{
    humanTakeover: boolean;
    botEnabled: boolean;
    pausedUntil?: Date | null;
  } | null> {
    // Lightweight integrations may not implement automation state; an actual
    // failed read is different and must propagate as unavailable safety state.
    if (!this.prisma.conversationAutomationState?.findUnique) return null;
    try {
      return await this.prisma.conversationAutomationState.findUnique({
        where: { conversationId }
      });
    } catch {
      throw new Error('SAFETY_STATE_UNAVAILABLE');
    }
  }

  async releaseExpiredWorkflowPause(tenantId: string, conversationId: string, now: Date = new Date()): Promise<boolean> {
    if (!this.prisma.conversationAutomationState?.findUnique) return false;
    return new ConversationAutomationService(this.prisma).releaseExpiredWorkflowPause(tenantId, conversationId, now);
  }

  /**
   * Returns true when this customer already has an unfinished CRM request created
   * by the same workflow. This survives bot pause/reopen and process restarts.
   */
  async hasOpenWorkflowRequest(
    tenantId: string,
    customerId: string,
    workflowId: string,
    accountId?: string | null
  ): Promise<boolean> {
    if (!tenantId || !customerId || !workflowId || !accountId?.trim()) return false;

    const customer = await this.prisma.customer.findFirst({
      where: {
        tenantId,
        OR: [{ externalId: customerId }, { id: customerId }]
      },
      select: { id: true }
    });
    if (!customer) return false;

    const openRequests = await this.prisma.lead.findMany({
      where: {
        tenantId,
        accountId: accountId.trim(),
        customerId: customer.id,
        status: { in: ['NEW', 'CONTACTED', 'QUALIFIED'] },
        sourceWorkflowSessionId: { not: null }
      },
      select: { sourceWorkflowSessionId: true },
      orderBy: { createdAt: 'desc' },
      take: 50
    });
    const sessionIds = openRequests
      .map(request => request.sourceWorkflowSessionId)
      .filter((id): id is string => Boolean(id));
    if (!sessionIds.length) return false;

    return (await this.prisma.workflowSession.count({
      where: {
        id: { in: sessionIds },
        tenantId,
        workflowId,
        status: 'COMPLETED'
      }
    })) > 0;
  }

  async incrementMessageCount(tenantId: string, conversationId: string): Promise<Conversation> {
    return this.prisma.conversation.update({
      where: { id: conversationId },
      data: { messageCount: { increment: 1 } }
    });
  }

  async setAutomationCapped(tenantId: string, conversationId: string, capped: boolean = true): Promise<Conversation> {
    return this.prisma.conversation.update({
      where: { id: conversationId },
      data: { automationCapped: capped }
    });
  }

  async incrementPostCompletionQuestionCount(tenantId: string, conversationId: string): Promise<Conversation> {
    return this.prisma.conversation.update({
      where: { id: conversationId },
      data: { postCompletionQuestionCount: { increment: 1 } }
    });
  }

  async setPostCompletionCapped(tenantId: string, conversationId: string, capped: boolean = true): Promise<Conversation> {
    return this.prisma.conversation.update({
      where: { id: conversationId },
      data: { postCompletionCapped: capped }
    });
  }

  async acquireLockAndIncrementMessage(tenantId: string, conversationId: string, expectedVersion: number): Promise<boolean> {
    const result = await this.prisma.conversation.updateMany({
      where: { id: conversationId, tenantId, version: expectedVersion },
      data: {
        version: { increment: 1 },
        messageCount: { increment: 1 }
      }
    });
    return result.count > 0;
  }

  async incrementConversationVersion(tenantId: string, conversationId: string, expectedVersion: number): Promise<boolean> {
    const result = await this.prisma.conversation.updateMany({
      where: { id: conversationId, tenantId, version: expectedVersion },
      data: { version: { increment: 1 } }
    });
    return result.count > 0;
  }

  async findExistingTurnResponse(tenantId: string, externalMessageId: string, conversationId?: string): Promise<string | null> {
    const trimmed = externalMessageId?.trim();
    if (!tenantId || !trimmed) return null;

    const userMsg = await this.prisma.message.findFirst({
      where: {
        tenantId,
        externalId: trimmed,
        ...(conversationId ? { conversationId } : {})
      }
    });

    if (!userMsg) return null;

    const turnMetadata = userMsg.metadata as Record<string, any> | null;
    if (turnMetadata?.turnCommitted && turnMetadata.responseExpected === false) return '';

    const assistantMsg = await this.prisma.message.findFirst({
      where: {
        tenantId,
        conversationId: userMsg.conversationId,
        role: 'ASSISTANT',
        ...(turnMetadata?.turnCommitted
          ? { metadata: { path: ['replyToMessageId'], equals: userMsg.id } }
          : { createdAt: { gte: userMsg.createdAt } })
      },
      orderBy: { createdAt: 'asc' }
    });

    return assistantMsg ? assistantMsg.content : null;
  }

  async commitConversationTurn(params: {
    tenantId: string;
    conversationId: string;
    expectedVersion: number;
    userMessage: string;
    assistantMessage?: string | null;
    externalMessageId?: string | null;
    phoneNumberId?: string | null;
    contextData?: Record<string, any> | null;
    sessionUpdate?: {
      sessionId: string;
      newWorkflowId?: string;
      stateId: string;
      contextData: Record<string, any>;
      status?: string;
      stateHistory?: string[];
      collectedData?: Record<string, any>;
      humanRequested?: boolean;
      humanRequestedAt?: Date | null;
    } | null;
    flagHumanRequested?: boolean;
    setAutomationCapped?: boolean;
    incrementPostCompletionCount?: boolean;
    setPostCompletionCapped?: boolean;
    newStatus?: string;
    closeConversation?: boolean;
    responseType?: string;
    pauseBotUntil?: Date | null;
    leadRequest?: {
      accountId: string;
      customerId: string;
      workflowSessionId: string;
      interest?: string | null;
      reason?: string;
      details?: Record<string, any>;
    } | null;
  }): Promise<{
    success: boolean;
    userMessage?: Message;
    assistantMessage?: Message;
  }> {
    // A stale decision must never be committed by substituting a newer version.
    // The caller/queue may retry the complete turn from fresh state.
    return await this.prisma.$transaction(async (tx) => {
      // 1. Optimistic locking on Conversation
      const convUpdate = await tx.conversation.updateMany({
        where: { id: params.conversationId, tenantId: params.tenantId, version: params.expectedVersion },
        data: {
          version: { increment: 1 },
          messageCount: { increment: 1 },
          ...(params.contextData !== undefined ? { contextData: params.contextData } : (params.sessionUpdate?.contextData !== undefined ? { contextData: params.sessionUpdate.contextData } : {})),
          ...(params.newStatus ? { status: params.newStatus } : (params.closeConversation ? { status: 'COMPLETED' } : {})),
          ...(params.flagHumanRequested ? { humanRequested: true, humanRequestedAt: new Date() } : {}),
          ...(params.setAutomationCapped !== undefined ? { automationCapped: params.setAutomationCapped } : {}),
          ...(params.incrementPostCompletionCount ? { postCompletionQuestionCount: { increment: 1 } } : {}),
          ...(params.setPostCompletionCapped !== undefined ? { postCompletionCapped: params.setPostCompletionCapped } : {})
        } as any
      });

      if (convUpdate.count === 0) {
        throw new Error('Concurrency Conflict: Conversation is currently being processed by another request.');
      }

      // 2. Persist USER message with optional externalId (channel-neutral)
      const userMsg = await tx.message.create({
        data: {
          tenantId: params.tenantId,
          conversationId: params.conversationId,
          role: 'USER',
          content: params.userMessage,
          externalId: params.externalMessageId?.trim() || null,
          phoneNumberId: params.phoneNumberId || null,
          metadata: { turnCommitted: true, responseExpected: Boolean(params.assistantMessage) }
        }
      });

      // 3. Update WorkflowSession if provided
      if (params.sessionUpdate) {
        const sessionData = {
            stateId: params.sessionUpdate.stateId,
            contextData: params.sessionUpdate.contextData,
            status: params.sessionUpdate.status || 'ACTIVE',
            ...(params.sessionUpdate.stateHistory !== undefined ? { stateHistory: params.sessionUpdate.stateHistory } : {}),
            ...(params.sessionUpdate.collectedData !== undefined ? { collectedData: params.sessionUpdate.collectedData } : {}),
            ...(params.sessionUpdate.humanRequested !== undefined ? { humanRequested: params.sessionUpdate.humanRequested } : {}),
            ...(params.sessionUpdate.humanRequestedAt !== undefined ? { humanRequestedAt: params.sessionUpdate.humanRequestedAt } : {})
        };
        if (params.sessionUpdate.newWorkflowId) {
          await tx.workflowSession.create({ data: {
            id: params.sessionUpdate.sessionId,
            tenantId: params.tenantId,
            conversationId: params.conversationId,
            workflowId: params.sessionUpdate.newWorkflowId,
            ...sessionData
          } });
        } else {
          await tx.workflowSession.update({
            where: { id: params.sessionUpdate.sessionId },
            data: sessionData
          });
        }
      }


      if (params.flagHumanRequested && params.pauseBotUntil) {
        const conversation = await tx.conversation.findUnique({ where: { id: params.conversationId }, select: { accountId: true } });
        await tx.conversationAutomationState.upsert({
          where: { conversationId: params.conversationId },
          create: { tenantId: params.tenantId, accountId: conversation?.accountId || null, conversationId: params.conversationId, botEnabled: false, humanTakeover: false, pausedUntil: params.pauseBotUntil, pauseReason: 'WORKFLOW_HANDOFF', updatedBy: 'system:workflow' },
          update: { botEnabled: false, humanTakeover: false, pausedUntil: params.pauseBotUntil, pauseReason: 'WORKFLOW_HANDOFF', updatedBy: 'system:workflow' }
        });
      }

      // The completed request and its workflow data are committed in the same
      // transaction. A saved conversation can therefore never be missing from CRM.
      if (params.leadRequest) {
        const request = params.leadRequest;
        const ownership = await tx.customer.findFirst({
          where: { id: request.customerId, tenantId: params.tenantId },
          select: { id: true }
        });
        const account = await tx.account.findFirst({
          where: { id: request.accountId, tenantId: params.tenantId },
          select: { id: true }
        });
        if (!ownership || !account) throw new Error('CRM_ACCOUNT_CUSTOMER_MISMATCH');
        const existingLead = await tx.lead.findFirst({
          where: {
            tenantId: params.tenantId,
            accountId: request.accountId,
            customerId: request.customerId,
            sourceWorkflowSessionId: request.workflowSessionId
          }
        });
        if (!existingLead) {
          await tx.lead.create({ data: {
            tenantId: params.tenantId,
            accountId: request.accountId,
            customerId: request.customerId,
            status: 'NEW',
            interest: request.interest?.slice(0, 280) || null,
            signalReason: request.reason || 'COMPLETED_WORKFLOW',
            sourceConversationId: params.conversationId,
            sourcePhoneNumberId: params.phoneNumberId || null,
            sourceWorkflowSessionId: request.workflowSessionId,
            details: request.details || {}
          } });
        }
      }

      // 4. Persist ASSISTANT message if provided
      let assistantMsg: Message | undefined;
      if (params.assistantMessage) {
        assistantMsg = await tx.message.create({
          data: {
            tenantId: params.tenantId,
            conversationId: params.conversationId,
            role: 'ASSISTANT',
            content: params.assistantMessage,
            phoneNumberId: params.phoneNumberId || null,
            metadata: { replyToMessageId: userMsg.id, externalMessageId: params.externalMessageId || null, responseType: params.responseType || null }
          }
        });
      }

      return {
        success: true,
        userMessage: userMsg,
        assistantMessage: assistantMsg
      };
    });
  }

  async getConversationContext(
    tenantId: string,
    conversationId: string,
    language?: string
  ): Promise<ConversationContext | null> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId }
    });
    if (!conversation || conversation.tenantId !== tenantId) {
      return null;
    }

    const [activeSession, recentMessages] = await Promise.all([
      this.getActiveSession(tenantId, conversationId),
      this.getRecentMessages(tenantId, conversationId, 4)
    ]);

    return buildConversationContext({
      tenantId,
      accountId: conversation.accountId,
      customerId: conversation.customerId,
      conversationId: conversation.id,
      language,
      activeSession: activeSession ? {
        workflowId: activeSession.workflowId,
        stateId: activeSession.stateId,
        collectedData: activeSession.collectedData && typeof activeSession.collectedData === 'object' && !Array.isArray(activeSession.collectedData)
          ? activeSession.collectedData as Record<string, any>
          : null
      } : null,
      recentMessages,
      totalMessageCount: conversation.messageCount,
      contextData: conversation.contextData as any
    });
  }

  /**
   * Updates an assistant message committed for an external inbound turn with its Meta provider message ID (wamid).
   * Persists providerMessageId to Message.externalId and sets initial deliveryStatus to SENT.
   */
  async updateOutboundAssistantMessage(params: {
    tenantId: string;
    inboundExternalId: string;
    providerMessageId: string;
    deliveryStatus?: 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';
  }): Promise<Message | null> {
    const { tenantId, inboundExternalId, providerMessageId, deliveryStatus = 'SENT' } = params;
    if (!tenantId || !inboundExternalId || !providerMessageId) return null;

    const message = await this.prisma.message.findFirst({
      where: {
        tenantId,
        role: 'ASSISTANT',
        metadata: {
          path: ['externalMessageId'],
          equals: inboundExternalId
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    if (!message) return null;

    const existingMeta = (message.metadata && typeof message.metadata === 'object' && !Array.isArray(message.metadata))
      ? { ...(message.metadata as Record<string, any>) }
      : {};

    const updated = await this.prisma.message.update({
      where: { id: message.id },
      data: {
        externalId: providerMessageId,
        metadata: {
          ...existingMeta,
          deliveryStatus,
          sentAt: Date.now(),
          providerMessageId
        }
      }
    });

    try {
      const processor = new WhatsAppDeliveryReceiptProcessor(this.prisma);
      await processor.reconcileReceiptsForProviderId(tenantId, providerMessageId);
    } catch (err: any) {
      logger.error(`ConversationService: Failed to reconcile receipts for [${providerMessageId}]: ${err.message || err}`);
    }

    return updated;
  }
}
