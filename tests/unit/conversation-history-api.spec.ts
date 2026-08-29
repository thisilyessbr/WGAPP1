import { describe, it, expect, beforeEach } from 'vitest';
import { ConversationService } from '../../src/domain/conversation/ConversationService';

describe('Phase CRM-C-FIX-02 — Conversation History Service Contract', () => {
  let mockPrisma: any;
  let conversationService: ConversationService;

  const tenantId = 'tech-haven';
  const accountId = 'tech-haven-flagship';
  const customerExternalId = 'manual-customer-A';
  const customerInternalId = 'cust-uuid-1';

  let mockCustomer: any;
  let mockConversations: any[];
  let mockMessages: any[];

  beforeEach(() => {
    mockCustomer = {
      id: customerInternalId,
      tenantId,
      externalId: customerExternalId
    };

    mockConversations = [];
    mockMessages = [];

    mockPrisma = {
      customer: {
        findFirst: async ({ where }: any) => {
          if (where.tenantId !== tenantId) return null;
          const matchOr = (where.OR || []).some((clause: any) =>
            clause.externalId === mockCustomer.externalId || clause.id === mockCustomer.id
          );
          return matchOr ? mockCustomer : null;
        }
      },
      conversation: {
        findFirst: async ({ where, orderBy, include }: any) => {
          if (where.tenantId !== tenantId) return null;
          if (where.customerId !== mockCustomer.id) return null;
          if (where.accountId && where.accountId !== accountId) return null;

          let filtered = mockConversations.filter(c => {
            if (c.tenantId !== where.tenantId || c.customerId !== where.customerId) return false;
            if (where.accountId && c.accountId !== where.accountId) return false;
            if (where.status) {
              if (typeof where.status === 'string') {
                return c.status === where.status;
              }
              if (where.status.in && Array.isArray(where.status.in)) {
                return where.status.in.includes(c.status);
              }
            }
            return true;
          });

          if (orderBy?.createdAt === 'desc') {
            filtered.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
          }

          const matched = filtered[0];
          if (!matched) return null;

          if (include?.messages) {
            let convMsgs = mockMessages.filter(m => m.conversationId === matched.id);
            if (include.messages.orderBy?.createdAt === 'asc') {
              convMsgs.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
            }
            return { ...matched, messages: convMsgs };
          }

          return matched;
        }
      }
    };

    conversationService = new ConversationService(mockPrisma);
  });

  it('A. retrieves existing active conversation with messages in chronological order (createdAt ASC)', async () => {
    const activeConv = {
      id: 'conv-active-1',
      tenantId,
      accountId,
      customerId: customerInternalId,
      status: 'ACTIVE',
      createdAt: new Date('2026-08-28T10:00:00Z'),
      updatedAt: new Date('2026-08-28T10:05:00Z')
    };
    mockConversations.push(activeConv);

    mockMessages.push(
      { id: 'm2', conversationId: 'conv-active-1', role: 'assistant', content: 'Here is the hoodie: 399 MAD', createdAt: new Date('2026-08-28T10:00:05Z') },
      { id: 'm1', conversationId: 'conv-active-1', role: 'user', content: 'Show me the hoodie', createdAt: new Date('2026-08-28T10:00:00Z') },
      { id: 'm3', conversationId: 'conv-active-1', role: 'user', content: 'I want to buy this', createdAt: new Date('2026-08-28T10:01:00Z') },
      { id: 'm4', conversationId: 'conv-active-1', role: 'assistant', content: 'Great choice! To order...', createdAt: new Date('2026-08-28T10:01:05Z') }
    );

    const result = await conversationService.getLatestConversation(tenantId, customerExternalId, accountId);

    expect(result).not.toBeNull();
    expect(result?.id).toBe('conv-active-1');
    expect(result?.status).toBe('ACTIVE');
    expect(result?.messages.length).toBe(4);

    // Verify chronological order (createdAt ASC)
    expect(result?.messages[0].id).toBe('m1');
    expect(result?.messages[1].id).toBe('m2');
    expect(result?.messages[2].id).toBe('m3');
    expect(result?.messages[3].id).toBe('m4');
  });

  it('B. prioritizes ACTIVE conversation over newer ARCHIVED conversations', async () => {
    const archivedConv = {
      id: 'conv-archived-1',
      tenantId,
      accountId,
      customerId: customerInternalId,
      status: 'ARCHIVED',
      createdAt: new Date('2026-08-28T10:10:00Z'),
      updatedAt: new Date('2026-08-28T10:15:00Z')
    };
    const activeConv = {
      id: 'conv-active-1',
      tenantId,
      accountId,
      customerId: customerInternalId,
      status: 'ACTIVE',
      createdAt: new Date('2026-08-28T10:00:00Z'),
      updatedAt: new Date('2026-08-28T10:05:00Z')
    };
    mockConversations.push(archivedConv, activeConv);

    const result = await conversationService.getLatestConversation(tenantId, customerExternalId, accountId);
    expect(result?.id).toBe('conv-active-1');
    expect(result?.status).toBe('ACTIVE');
  });

  it('C. returns latest ARCHIVED conversation if no active conversation exists', async () => {
    const archivedConv = {
      id: 'conv-archived-old',
      tenantId,
      accountId,
      customerId: customerInternalId,
      status: 'ARCHIVED',
      createdAt: new Date('2026-08-28T09:00:00Z'),
      updatedAt: new Date('2026-08-28T09:05:00Z')
    };
    mockConversations.push(archivedConv);

    const result = await conversationService.getLatestConversation(tenantId, customerExternalId, accountId);
    expect(result?.id).toBe('conv-archived-old');
    expect(result?.status).toBe('ARCHIVED');
  });

  it('D. returns null if customer has no conversations', async () => {
    const result = await conversationService.getLatestConversation(tenantId, customerExternalId, accountId);
    expect(result).toBeNull();
  });

  it('E. returns null for unknown customer', async () => {
    const result = await conversationService.getLatestConversation(tenantId, 'non-existent-cust', accountId);
    expect(result).toBeNull();
  });

  it('F. enforces tenant and account isolation', async () => {
    const convOtherAccount = {
      id: 'conv-other-store',
      tenantId,
      accountId: 'other-store-id',
      customerId: customerInternalId,
      status: 'ACTIVE',
      createdAt: new Date(),
      updatedAt: new Date()
    };
    mockConversations.push(convOtherAccount);

    // Mismatched account query returns null
    const resultMismatchedAccount = await conversationService.getLatestConversation(tenantId, customerExternalId, accountId);
    expect(resultMismatchedAccount).toBeNull();

    // Mismatched tenant query returns null
    const resultMismatchedTenant = await conversationService.getLatestConversation('other-tenant', customerExternalId, 'other-store-id');
    expect(resultMismatchedTenant).toBeNull();
  });

  it('G. is purely read-only and never modifies conversation status', async () => {
    const activeConv = {
      id: 'conv-active-1',
      tenantId,
      accountId,
      customerId: customerInternalId,
      status: 'ACTIVE',
      createdAt: new Date(),
      updatedAt: new Date()
    };
    mockConversations.push(activeConv);

    const result = await conversationService.getLatestConversation(tenantId, customerExternalId, accountId);
    expect(result?.status).toBe('ACTIVE');
    expect(mockConversations[0].status).toBe('ACTIVE');
  });
});
