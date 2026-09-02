import { PrismaClient, Conversation, WorkflowSession, Message } from '@prisma/client';
import { ConversationContext, buildConversationContext } from './ConversationContext';
import { logger } from '../../utils/logger';

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
      ...(trimmedAccountId ? { accountId: trimmedAccountId } : {})
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

  async getOrCreateConversation(tenantId: string, externalId: string, accountId?: string | null): Promise<Conversation> {
    const customer = await this.prisma.customer.upsert({
      where: { tenantId_externalId: { tenantId, externalId } },
      create: { tenantId, externalId },
      update: {},
    });

    const trimmedAccountId = accountId && typeof accountId === 'string' && accountId.trim() ? accountId.trim() : null;

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
          ...(trimmedAccountId ? { accountId: trimmedAccountId } : {})
        },
        orderBy: { createdAt: 'desc' }
      });

      if (!conversation) {
        conversation = await tx.conversation.create({
          data: {
            tenantId,
            customerId: customer.id,
            ...(trimmedAccountId ? { accountId: trimmedAccountId } : {})
          }
        });
      }
      return conversation;
    });
  }

  async requestHandoff(tenantId: string, conversationId: string): Promise<Conversation> {
    return this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        status: 'HANDOFF_REQUESTED',
        humanRequested: true,
        humanRequestedAt: new Date()
      }
    });
  }

  async takeOverByHuman(tenantId: string, conversationId: string): Promise<Conversation> {
    return this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        status: 'HUMAN_ACTIVE',
        humanRequested: true
      }
    });
  }

  async resolveHandoff(tenantId: string, conversationId: string): Promise<Conversation> {
    return this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        status: 'ACTIVE',
        humanRequested: false,
        humanRequestedAt: null,
        automationCapped: false,
        postCompletionCapped: false
      }
    });
  }

  async persistMessage(tenantId: string, conversationId: string, role: string, content: string): Promise<Message> {
    return this.prisma.message.create({
      data: { tenantId, conversationId, role, content }
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
    return this.prisma.workflowSession.create({
      data: {
        tenantId,
        conversationId,
        workflowId,
        stateId,
        stateHistory: [],
        collectedData: {},
        humanRequested: false,
        status: 'ACTIVE',
        contextData: {}
      }
    });
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
    return this.prisma.conversation.update({
      where: { id: conversationId },
      data: { humanRequested: true, humanRequestedAt: new Date() }
    });
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

    const assistantMsg = await this.prisma.message.findFirst({
      where: {
        tenantId,
        conversationId: userMsg.conversationId,
        role: 'ASSISTANT',
        createdAt: { gte: userMsg.createdAt }
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
    contextData?: Record<string, any> | null;
    sessionUpdate?: {
      sessionId: string;
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
  }): Promise<{
    success: boolean;
    userMessage?: Message;
    assistantMessage?: Message;
  }> {
    const maxRetries = 2; // Total 3 attempts
    let currentVersion = params.expectedVersion;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          // 1. Optimistic locking on Conversation
          const convUpdate = await tx.conversation.updateMany({
            where: { id: params.conversationId, tenantId: params.tenantId, version: currentVersion },
            data: {
              version: { increment: 1 },
              messageCount: { increment: 1 },
              ...(params.contextData !== undefined ? { contextData: params.contextData } : (params.sessionUpdate?.contextData !== undefined ? { contextData: params.sessionUpdate.contextData } : {})),
              ...(params.newStatus ? { status: params.newStatus } : (params.closeConversation ? { status: 'COMPLETED' } : {})),
              ...(params.flagHumanRequested ? { humanRequested: true, humanRequestedAt: new Date() } : {}),
              ...(params.setAutomationCapped !== undefined ? { automationCapped: params.setAutomationCapped } : {}),
              ...(params.incrementPostCompletionCount ? { postCompletionQuestionCount: { increment: 1 } } : {}),
              ...(params.setPostCompletionCapped !== undefined ? { postCompletionCapped: params.setPostCompletionCapped } : {})
            }
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
              externalId: params.externalMessageId?.trim() || null
            }
          });

          // 3. Update WorkflowSession if provided
          if (params.sessionUpdate) {
            await tx.workflowSession.update({
              where: { id: params.sessionUpdate.sessionId },
              data: {
                stateId: params.sessionUpdate.stateId,
                contextData: params.sessionUpdate.contextData,
                status: params.sessionUpdate.status || 'ACTIVE',
                ...(params.sessionUpdate.stateHistory !== undefined ? { stateHistory: params.sessionUpdate.stateHistory } : {}),
                ...(params.sessionUpdate.collectedData !== undefined ? { collectedData: params.sessionUpdate.collectedData } : {}),
                ...(params.sessionUpdate.humanRequested !== undefined ? { humanRequested: params.sessionUpdate.humanRequested } : {}),
                ...(params.sessionUpdate.humanRequestedAt !== undefined ? { humanRequestedAt: params.sessionUpdate.humanRequestedAt } : {})
              }
            });
          }

          // 4. Persist ASSISTANT message if provided
          let assistantMsg: Message | undefined;
          if (params.assistantMessage) {
            assistantMsg = await tx.message.create({
              data: {
                tenantId: params.tenantId,
                conversationId: params.conversationId,
                role: 'ASSISTANT',
                content: params.assistantMessage
              }
            });
          }

          return {
            success: true,
            userMessage: userMsg,
            assistantMessage: assistantMsg
          };
        });
      } catch (err: any) {
        const isConflict = err?.message && (
          err.message.includes('Concurrency Conflict') ||
          err.message.includes('CONCURRENCY_CONFLICT')
        );

        if (isConflict && attempt < maxRetries) {
          logger.warn(`ConversationService: Optimistic lock conflict on conversation ${params.conversationId} (attempt ${attempt + 1}/${maxRetries + 1}), re-fetching latest version and retrying...`);
          const latestConv = await this.prisma.conversation.findUnique({
            where: { id: params.conversationId },
            select: { version: true }
          });
          if (latestConv) {
            currentVersion = latestConv.version;
            continue;
          }
        }

        throw err;
      }
    }

    throw new Error('Concurrency Conflict: Conversation is currently being processed by another request.');
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
      activeSession,
      recentMessages,
      totalMessageCount: conversation.messageCount,
      contextData: conversation.contextData as any
    });
  }
}

