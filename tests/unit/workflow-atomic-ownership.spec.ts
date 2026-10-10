import { describe, expect, it, vi } from 'vitest';
import { ConversationService } from '../../src/domain/conversation/ConversationService';
import { ConversationAutomationService } from '../../src/domain/conversation/ConversationAutomationService';

describe('workflow persistence and ownership boundaries', () => {
  it('stores the originating WhatsApp number on both messages and the atomic CRM request', async () => {
    const messageCreate=vi.fn().mockResolvedValue({id:'message-1'}),leadCreate=vi.fn().mockResolvedValue({});
    const tx:any={
      conversation:{updateMany:vi.fn().mockResolvedValue({count:1})},
      message:{create:messageCreate},
      customer:{findFirst:vi.fn().mockResolvedValue({id:'customer'})},
      account:{findFirst:vi.fn().mockResolvedValue({id:'account'})},
      lead:{findFirst:vi.fn().mockResolvedValue(null),create:leadCreate}
    };
    const service=new ConversationService({$transaction:(fn:any)=>fn(tx)} as any);
    await service.commitConversationTurn({tenantId:'tenant',conversationId:'conversation',expectedVersion:0,
      userMessage:'Bghit demo',assistantMessage:'Marhba',externalMessageId:'wamid-1',phoneNumberId:'qr:number-1',
      leadRequest:{accountId:'account',customerId:'customer',workflowSessionId:'session'}});
    expect(messageCreate).toHaveBeenCalledTimes(2);
    for(const call of messageCreate.mock.calls)expect(call[0].data.phoneNumberId).toBe('qr:number-1');
    expect(leadCreate).toHaveBeenCalledWith({data:expect.objectContaining({sourcePhoneNumberId:'qr:number-1'})});
  });

  it('prepares a new session without making it active until the turn commits', async () => {
    const sessionCreate = vi.fn().mockResolvedValue({});
    const tx: any = {
      conversation: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      message: { create: vi.fn().mockResolvedValue({ id: 'message-1' }) },
      workflowSession: { create: sessionCreate, update: vi.fn() }
    };
    const db: any = { $transaction: (fn: any) => fn(tx), workflowSession: { create: vi.fn() } };
    const service = new ConversationService(db);
    const prepared = await service.createSession('tenant', 'conversation', 'demo', 'ask_name');
    expect(db.workflowSession.create).not.toHaveBeenCalled();
    expect(sessionCreate).not.toHaveBeenCalled();

    await service.commitConversationTurn({
      tenantId: 'tenant', conversationId: 'conversation', expectedVersion: 0,
      userMessage: 'Bghit demo', assistantMessage: 'شنو سميتك؟',
      sessionUpdate: { sessionId: prepared.id, newWorkflowId: prepared.workflowId,
        stateId: prepared.stateId, contextData: {}, status: 'ACTIVE' }
    });
    expect(sessionCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      id: prepared.id, tenantId: 'tenant', conversationId: 'conversation', workflowId: 'demo', status: 'ACTIVE'
    }) });
    expect(tx.workflowSession.update).not.toHaveBeenCalled();
  });

  it('does not create a session when a stale turn is rejected', async () => {
    const create = vi.fn();
    const tx: any = {
      conversation: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      message: { create: vi.fn() }, workflowSession: { create }
    };
    const service = new ConversationService({ $transaction: (fn: any) => fn(tx) } as any);
    await expect(service.commitConversationTurn({
      tenantId: 'tenant', conversationId: 'conversation', expectedVersion: 0, userMessage: 'hello',
      sessionUpdate: { sessionId: 'pending', newWorkflowId: 'demo', stateId: 'ask_name', contextData: {} }
    })).rejects.toThrow('Concurrency Conflict');
    expect(create).not.toHaveBeenCalled();
    expect(tx.message.create).not.toHaveBeenCalled();
  });

  it('never resumes the bot when a human changed ownership before timer expiry', async () => {
    const state = { tenantId: 'tenant', humanTakeover: false, pausedUntil: new Date('2026-01-01'), pauseReason: 'WORKFLOW_HANDOFF' };
    const updateState = vi.fn();
    const tx: any = {
      conversationAutomationState: { findUnique: vi.fn().mockResolvedValue(state), update: updateState },
      conversation: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) }
    };
    const service = new ConversationAutomationService({ $transaction: (fn: any) => fn(tx) } as any);
    expect(await service.releaseExpiredWorkflowPause('tenant', 'conversation', new Date('2026-01-02'))).toBe(false);
    expect(updateState).not.toHaveBeenCalled();
  });
});
