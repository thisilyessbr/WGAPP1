import { PrismaClient, Conversation, WorkflowSession, Message } from '@prisma/client';

export class ConversationService {
  constructor(private prisma: PrismaClient) {}

  async getOrCreateConversation(tenantId: string, externalId: string): Promise<Conversation> {
    const customer = await this.prisma.customer.upsert({
      where: { tenantId_externalId: { tenantId, externalId } },
      create: { tenantId, externalId },
      update: {},
    });

    // Find active conversation
    let conversation = await this.prisma.conversation.findFirst({
      where: { tenantId, customerId: customer.id, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' }
    });

    if (!conversation) {
      conversation = await this.prisma.conversation.create({
        data: { tenantId, customerId: customer.id }
      });
    }
    return conversation;
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

  async commitConversationTurn(params: {
    tenantId: string;
    conversationId: string;
    expectedVersion: number;
    userMessage: string;
    assistantMessage?: string | null;
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
  }): Promise<{
    success: boolean;
    userMessage?: Message;
    assistantMessage?: Message;
  }> {
    return this.prisma.$transaction(async (tx) => {
      // 1. Optimistic locking on Conversation
      const convUpdate = await tx.conversation.updateMany({
        where: { id: params.conversationId, tenantId: params.tenantId, version: params.expectedVersion },
        data: {
          version: { increment: 1 },
          messageCount: { increment: 1 },
          ...(params.flagHumanRequested ? { humanRequested: true, humanRequestedAt: new Date() } : {}),
          ...(params.setAutomationCapped !== undefined ? { automationCapped: params.setAutomationCapped } : {}),
          ...(params.incrementPostCompletionCount ? { postCompletionQuestionCount: { increment: 1 } } : {}),
          ...(params.setPostCompletionCapped !== undefined ? { postCompletionCapped: params.setPostCompletionCapped } : {})
        }
      });

      if (convUpdate.count === 0) {
        throw new Error('Concurrency Conflict: Conversation is currently being processed by another request.');
      }

      // 2. Persist USER message
      const userMsg = await tx.message.create({
        data: {
          tenantId: params.tenantId,
          conversationId: params.conversationId,
          role: 'USER',
          content: params.userMessage
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
  }
}
