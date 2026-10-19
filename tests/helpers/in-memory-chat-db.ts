import { vi } from 'vitest';

/**
 * In-memory stand-in for the Prisma calls the conversation engine makes (customers,
 * conversations, workflow sessions, messages, leads), for end-to-end chat tests
 * without a database. Extracted from the workflow execution-limit suite.
 */
export function inMemoryChatDb(tenantId: string) {
  const customers: any[] = [];
  const conversations: any[] = [];
  const sessions: any[] = [];
  const messages: any[] = [];
  const leads: any[] = [];
const mockPrisma: any = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    $transaction: async (arg: any) => {
      if (typeof arg === 'function') {
        return arg(mockPrisma);
      }
      if (Array.isArray(arg)) {
        return Promise.all(arg);
      }
      return arg;
    },
    customer: {
      findUnique: async ({ where }: any) => {
        if (where.tenantId_externalId) {
          return customers.find(c => c.tenantId === where.tenantId_externalId.tenantId && c.externalId === where.tenantId_externalId.externalId) || null;
        }
        return null;
      },
      findFirst: async ({ where }: any) => {
        return customers.find(c => {
          if (c.tenantId !== where.tenantId) return false;
          if (where.OR) {
            return where.OR.some((clause: any) => clause.externalId === c.externalId || clause.id === c.id);
          }
          return true;
        }) || null;
      },
      upsert: async ({ where, create }: any) => {
        let existing = customers.find(c => c.tenantId === where.tenantId_externalId.tenantId && c.externalId === where.tenantId_externalId.externalId);
        if (!existing) {
          existing = { id: `cust-${Date.now()}-${Math.random()}`, tenantId: create.tenantId, externalId: create.externalId, createdAt: new Date() };
          customers.push(existing);
        }
        return existing;
      }
    },
    account: {
      findUnique: async ({ where }: any) => {
        if (where.id === 'account-tenant-2') {
          return { id: 'account-tenant-2', tenantId: 'other-tenant', name: 'Other Store' };
        }
        return { id: where.id, tenantId, name: 'Main Store' };
      }
    },
    conversation: {
      findFirst: async ({ where, orderBy }: any) => {
        let matches = conversations.filter(c => {
          if (c.tenantId !== where.tenantId) return false;
          if (where.customerId && c.customerId !== where.customerId) return false;
          if (where.accountId !== undefined && c.accountId !== where.accountId) return false;
          if (where.status) {
            if (typeof where.status === 'string') return c.status === where.status;
            if (where.status.in) return where.status.in.includes(c.status);
          }
          if (where.automationCapped !== undefined && c.automationCapped !== where.automationCapped) return false;
          return true;
        });
        if (orderBy?.createdAt === 'desc') {
          matches.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        }
        return matches[0] || null;
      },
      findMany: async ({ where }: any) => {
        return conversations.filter(c => {
          if (c.tenantId !== where.tenantId) return false;
          if (where.customerId && c.customerId !== where.customerId) return false;
          if (where.accountId !== undefined && c.accountId !== where.accountId) return false;
          if (where.status?.in) return where.status.in.includes(c.status);
          return true;
        });
      },
      create: async ({ data }: any) => {
        const conv = {
          id: `conv-${Date.now()}-${Math.random()}`,
          tenantId: data.tenantId,
          customerId: data.customerId,
          accountId: data.accountId || null,
          status: data.status || 'ACTIVE',
          contextData: data.contextData || {},
          version: 1,
          messageCount: 0,
          postCompletionQuestionCount: 0,
          automationCapped: false,
          postCompletionCapped: false,
          createdAt: new Date(),
          updatedAt: new Date()
        };
        conversations.push(conv);
        return conv;
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const c of conversations) {
          if (where.id && (where.id === c.id || (where.id.in && where.id.in.includes(c.id)))) {
            if (where.version !== undefined && c.version !== where.version) continue;
            if (data.status) c.status = data.status;
            if (data.contextData !== undefined) c.contextData = data.contextData;
            if (data.version?.increment) c.version += data.version.increment;
            if (data.messageCount?.increment) c.messageCount += data.messageCount.increment;
            c.updatedAt = new Date();
            count++;
          }
        }
        return { count };
      },
      update: async ({ where, data }: any) => {
        const c = conversations.find(x => x.id === where.id);
        if (c) {
          Object.assign(c, data);
          c.updatedAt = new Date();
          return c;
        }
        throw new Error('Conversation not found');
      }
    },
    workflowSession: {
      findFirst: async ({ where, orderBy }: any) => {
        let matches = sessions.filter(s => {
          if (where.tenantId && s.tenantId !== where.tenantId) return false;
          if (where.conversationId && s.conversationId !== where.conversationId) return false;
          if (where.status && s.status !== where.status) return false;
          return true;
        });
        if (orderBy?.createdAt === 'desc') {
          matches.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        }
        return matches[0] || null;
      },
      count: async ({ where }: any) => {
        return sessions.filter(s => {
          if (where.tenantId && s.tenantId !== where.tenantId) return false;
          if (where.workflowId && s.workflowId !== where.workflowId) return false;
          if (where.status && s.status !== where.status) return false;
          if (where.conversation) {
            const conv = conversations.find(c => c.id === s.conversationId);
            if (!conv) return false;
            if (where.conversation.tenantId && conv.tenantId !== where.conversation.tenantId) return false;
            if (where.conversation.customerId && conv.customerId !== where.conversation.customerId) return false;
            if (where.conversation.accountId !== undefined && conv.accountId !== where.conversation.accountId) return false;
          }
          return true;
        }).length;
      },
      create: async ({ data }: any) => {
        const sess = {
          id: data.id || `sess-${Date.now()}-${Math.random()}`,
          tenantId: data.tenantId,
          conversationId: data.conversationId,
          workflowId: data.workflowId,
          stateId: data.stateId,
          stateHistory: data.stateHistory || [],
          collectedData: data.collectedData || {},
          contextData: data.contextData || {},
          status: data.status || 'ACTIVE',
          createdAt: new Date(),
          updatedAt: new Date()
        };
        sessions.push(sess);
        return sess;
      },
      update: async ({ where, data }: any) => {
        const sess = sessions.find(s => s.id === where.id);
        if (sess) {
          Object.assign(sess, data);
          sess.updatedAt = new Date();
          return sess;
        }
        throw new Error('Session not found');
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const s of sessions) {
          if (where.conversationId?.in && where.conversationId.in.includes(s.conversationId)) {
            if (where.status && s.status !== where.status) continue;
            Object.assign(s, data);
            s.updatedAt = new Date();
            count++;
          }
        }
        return { count };
      }
    },
    message: {
      create: async ({ data }: any) => {
        const msg = {
          id: `msg-${Date.now()}-${Math.random()}`,
          ...data,
          createdAt: new Date()
        };
        messages.push(msg);
        return msg;
      },
      count: async () => messages.length,
      findMany: async () => messages
    },
    lead: {
      findUnique: async ({ where }: any) => leads.find(x =>
        x.tenantId === where.tenantId_accountId_customerId?.tenantId
        && x.accountId === where.tenantId_accountId_customerId?.accountId
        && x.customerId === where.tenantId_accountId_customerId?.customerId
      ) || null,
      upsert: async ({ where, create, update }: any) => {
        let l = leads.find(x => x.tenantId === where.tenantId_accountId_customerId?.tenantId && x.accountId === where.tenantId_accountId_customerId?.accountId && x.customerId === where.tenantId_accountId_customerId?.customerId);
        if (!l) {
          l = { id: `lead-${Date.now()}`, ...create, createdAt: new Date(), updatedAt: new Date() };
          leads.push(l);
        } else {
          Object.assign(l, update);
          l.updatedAt = new Date();
        }
        return l;
      },
      findMany: async () => leads
    }
  };
  return { prisma: mockPrisma, customers, conversations, sessions, messages, leads };
}
