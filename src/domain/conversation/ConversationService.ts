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
}
