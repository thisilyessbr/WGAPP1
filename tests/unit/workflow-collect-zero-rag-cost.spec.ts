import { describe, it, expect, vi } from 'vitest';
import { WorkflowEngine } from '../../src/core/engine/WorkflowEngine';
import { WorkflowConfig, BusinessConfig, DEFAULT_BUSINESS_CONFIG } from '../../src/domain/tenant/BusinessConfig';
import { WorkflowSession } from '@prisma/client';
import { RAGService } from '../../src/domain/rag/RAGService';

describe('Phase COST-FIX-46C: Zero-RAG Valid Workflow Field Path', () => {
  const engine = new WorkflowEngine();

  const mockWorkflow: WorkflowConfig = {
    id: 'test_collect_cost',
    name: 'Collect Cost Test',
    description: 'Test workflow for RAG cost verification',
    initialState: 'collect_name',
    states: {
      collect_name: {
        type: 'collect',
        field: { name: 'name', type: 'string', required: true, minLength: 2 },
        prompt: 'Please provide your full name:',
        next: 'collect_phone'
      },
      collect_phone: {
        type: 'collect',
        field: { name: 'phone', type: 'string', required: true, pattern: '^[0-9+() -]{8,20}$' },
        prompt: 'Please provide your phone number:',
        next: 'collect_email'
      },
      collect_email: {
        type: 'collect',
        field: { name: 'email', type: 'string', required: true, pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$' },
        prompt: 'Please provide your email address:',
        next: 'collect_topic'
      },
      collect_topic: {
        type: 'collect',
        field: { name: 'topic', type: 'string', required: true, minLength: 3 },
        prompt: 'Please provide your consultation topic:',
        next: 'collect_date'
      },
      collect_date: {
        type: 'collect',
        field: { name: 'preferred_date', type: 'string', required: true, minLength: 4 },
        prompt: 'Please provide your preferred date:',
        next: 'collect_time'
      },
      collect_time: {
        type: 'collect',
        field: { name: 'preferred_time', type: 'string', required: true, pattern: '^[0-9]{2}:[0-9]{2}$' },
        prompt: 'Please provide your preferred time (HH:MM):',
        next: 'end'
      },
      end: {
        type: 'end',
        prompt: 'Thank you {name}, your booking is complete!'
      }
    }
  };

  const testConfig: BusinessConfig = {
    ...DEFAULT_BUSINESS_CONFIG,
    capabilities: {
      ecommerceEnabled: false,
      imageEnabled: false,
      faq: [
        {
          id: 'faq_pricing',
          questions: { en: 'How much does it cost?' },
          answers: { en: 'Our standard consultation fee is 750 MAD.' }
        }
      ]
    },
    knowledge: {
      ...DEFAULT_BUSINESS_CONFIG.knowledge,
      enabled: true
    },
    workflows: {
      test_collect_cost: mockWorkflow
    }
  };

  function createMockRagService(): RAGService {
    return {
      retrieve: vi.fn().mockResolvedValue({
        chunks: [
          {
            id: 'chunk-1',
            documentId: 'doc-1',
            content: 'Refunds are available within 30 days of purchase upon written notice.',
            similarity: 0.85
          }
        ],
        directAnswer: null,
        confidence: 'HIGH'
      }),
      retrieveContext: vi.fn(),
      retrieveMultiPolicy: vi.fn()
    } as unknown as RAGService;
  }

  function createSession(stateId: string, collectedData: Record<string, any> = {}): WorkflowSession {
    return {
      id: 'sess-123',
      tenantId: 'tenant-test',
      conversationId: 'conv-123',
      workflowId: 'test_collect_cost',
      stateId,
      status: 'ACTIVE',
      contextData: { _started: true, _lang: 'en', ...collectedData },
      stateHistory: [],
      collectedData,
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }

  it('1. Valid name -> 0 RAG calls, advances to collect_phone', async () => {
    const mockRag = createMockRagService();
    const session = createSession('collect_name');
    const res = await engine.process(session, 'John Doe', mockWorkflow, testConfig, undefined, undefined, mockRag);

    expect(mockRag.retrieve).not.toHaveBeenCalled();
    expect(res.nextStateId).toBe('collect_phone');
    expect(res.updatedCollectedData?.name).toBe('John Doe');
  });

  it('2. Valid phone -> 0 RAG calls, advances to collect_email', async () => {
    const mockRag = createMockRagService();
    const session = createSession('collect_phone');
    const res = await engine.process(session, '0600000000', mockWorkflow, testConfig, undefined, undefined, mockRag);

    expect(mockRag.retrieve).not.toHaveBeenCalled();
    expect(res.nextStateId).toBe('collect_email');
    expect(res.updatedCollectedData?.phone).toBe('0600000000');
  });

  it('3. Valid email -> 0 RAG calls, advances to collect_topic', async () => {
    const mockRag = createMockRagService();
    const session = createSession('collect_email');
    const res = await engine.process(session, 'john@example.com', mockWorkflow, testConfig, undefined, undefined, mockRag);

    expect(mockRag.retrieve).not.toHaveBeenCalled();
    expect(res.nextStateId).toBe('collect_topic');
    expect(res.updatedCollectedData?.email).toBe('john@example.com');
  });

  it('4. Valid topic -> 0 RAG calls, advances to collect_date', async () => {
    const mockRag = createMockRagService();
    const session = createSession('collect_topic');
    const res = await engine.process(session, 'Marketing strategy', mockWorkflow, testConfig, undefined, undefined, mockRag);

    expect(mockRag.retrieve).not.toHaveBeenCalled();
    expect(res.nextStateId).toBe('collect_date');
    expect(res.updatedCollectedData?.topic).toBe('Marketing strategy');
  });

  it('5. Valid date -> 0 RAG calls, advances to collect_time', async () => {
    const mockRag = createMockRagService();
    const session = createSession('collect_date');
    const res = await engine.process(session, '2026-08-28', mockWorkflow, testConfig, undefined, undefined, mockRag);

    expect(mockRag.retrieve).not.toHaveBeenCalled();
    expect(res.nextStateId).toBe('collect_time');
    expect(res.updatedCollectedData?.preferred_date).toBe('2026-08-28');
  });

  it('6. Valid time -> 0 RAG calls, reaches end state with interpolated name', async () => {
    const mockRag = createMockRagService();
    const session = createSession('collect_time', { name: 'John Doe' });
    const res = await engine.process(session, '09:00', mockWorkflow, testConfig, undefined, undefined, mockRag);

    expect(mockRag.retrieve).not.toHaveBeenCalled();
    expect(res.isComplete).toBe(true);
    expect(res.response).toBe('Thank you John Doe, your booking is complete!');
    expect(res.updatedCollectedData?.preferred_time).toBe('09:00');
  });

  it('7. Arabic valid field -> 0 RAG calls', async () => {
    const mockRag = createMockRagService();
    const session = createSession('collect_name');
    const res = await engine.process(session, 'محمد الصابر', mockWorkflow, testConfig, undefined, undefined, mockRag);

    expect(mockRag.retrieve).not.toHaveBeenCalled();
    expect(res.nextStateId).toBe('collect_phone');
    expect(res.updatedCollectedData?.name).toBe('محمد الصابر');
  });

  it('8. FAQ side question -> 0 RAG calls, answers via FAQ and reprompts', async () => {
    const mockRag = createMockRagService();
    const session = createSession('collect_phone');
    const res = await engine.process(session, 'How much does it cost?', mockWorkflow, testConfig, undefined, undefined, mockRag);

    expect(mockRag.retrieve).not.toHaveBeenCalled();
    expect(res.nextStateId).toBe('collect_phone');
    expect(res.response).toContain('750 MAD');
    expect(res.response).toContain('Please provide your phone number:');
  });

  it('9. FAQ-miss question -> RAG allowed (1 call) and answers via RAG', async () => {
    const mockRag = createMockRagService();
    const session = createSession('collect_phone');
    const res = await engine.process(session, 'Can you explain the refund policy in detail?', mockWorkflow, testConfig, undefined, undefined, mockRag);

    expect(mockRag.retrieve).toHaveBeenCalledTimes(1);
    expect(res.nextStateId).toBe('collect_phone');
    expect(res.response).toContain('Refunds are available within 30 days');
    expect(res.response).toContain('Please provide your phone number:');
  });

  it('10. Invalid field -> no mutation, no RAG called for non-question syntax errors', async () => {
    const mockRag = createMockRagService();
    const session = createSession('collect_email');
    const res = await engine.process(session, 'not-an-email', mockWorkflow, testConfig, undefined, undefined, mockRag);

    expect(mockRag.retrieve).not.toHaveBeenCalled();
    expect(res.nextStateId).toBe('collect_email');
    expect(res.updatedCollectedData?.email).toBeUndefined();
    expect(res.response).toContain('Please provide your email address:');
  });
});
