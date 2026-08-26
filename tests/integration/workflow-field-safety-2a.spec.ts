import { describe, it, expect } from 'vitest';
import { WorkflowEngine } from '../../src/core/engine/WorkflowEngine';
import { BusinessConfig, DEFAULT_BUSINESS_CONFIG, WorkflowConfig } from '../../src/domain/tenant/BusinessConfig';
import { WorkflowSession } from '@prisma/client';

describe('Phase FIX-PROBLEM-2A: Safe Typed Workflow Field Collection', () => {
  const engine = new WorkflowEngine();

  const testWorkflow: WorkflowConfig = {
    id: 'test_safety_wf',
    name: 'Field Safety Workflow',
    description: 'Testing safe field intake',
    initialState: 'collect_name',
    states: {
      collect_name: {
        type: 'collect',
        field: { name: 'name', type: 'string', required: true, minLength: 2 },
        prompt: 'Please enter your full name:',
        next: 'collect_phone'
      },
      collect_phone: {
        type: 'collect',
        field: { name: 'phone', type: 'phone', required: true },
        prompt: 'Please enter your phone number:',
        next: 'collect_email'
      },
      collect_email: {
        type: 'collect',
        field: { name: 'email', type: 'email', required: true },
        prompt: 'Please enter your email:',
        next: 'collect_date'
      },
      collect_date: {
        type: 'collect',
        field: { name: 'appointment_date', type: 'date', required: true },
        prompt: 'Please enter appointment date (YYYY-MM-DD):',
        next: 'end_step'
      },
      end_step: {
        type: 'end',
        prompt: 'All fields received.'
      }
    }
  };

  const testConfig: BusinessConfig = {
    ...DEFAULT_BUSINESS_CONFIG,
    capabilities: {
      ecommerceEnabled: false,
      imageEnabled: false,
      intents: [
        {
          id: 'book_consultation',
          description: 'Book consultation',
          workflowId: 'test_safety_wf',
          keywords: ['bghit n7jez', 'book consultation', 'حجز استشارة', 'بغيت نحجز']
        }
      ],
      faq: [
        {
          id: 'faq_price',
          questions: {
            ar: 'كم تبلغ تكلفة الاستشارة؟',
            darija: 'شحال الثمن؟',
            en: 'How much is it?'
          },
          answers: {
            ar: 'سعر الاستشارة 500 درهم.',
            darija: 'Taman howa 500 DH.',
            en: 'The fee is 500 MAD.'
          }
        }
      ]
    },
    workflows: {
      test_safety_wf: testWorkflow
    }
  };

  function createMockSession(stateId: string, collectedData: Record<string, any> = {}): WorkflowSession {
    return {
      id: `sess-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      tenantId: 'test-tenant',
      conversationId: 'test-conv',
      workflowId: 'test_safety_wf',
      stateId,
      status: 'ACTIVE',
      contextData: { _started: true, _lang: 'en' },
      stateHistory: [],
      collectedData,
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }

  it('A. string field + valid normal name -> save and advance', async () => {
    const session = createMockSession('collect_name');
    const res = await engine.process(session, 'John Doe', testWorkflow, testConfig);

    expect(res.nextStateId).toBe('collect_phone');
    expect(res.updatedCollectedData?.name).toBe('John Doe');
  });

  it('B. string field + configured workflow intent -> no mutation, reprompts same step', async () => {
    const session = createMockSession('collect_name');
    const res = await engine.process(session, 'bghit n7jez', testWorkflow, testConfig);

    expect(res.nextStateId).toBe('collect_name');
    expect(res.updatedCollectedData?.name).toBeUndefined();
    expect(res.response).toContain('Please enter your full name:');
  });

  it('C. string field + greeting ("hello" / "سلام") -> no mutation, reprompts same step', async () => {
    const session = createMockSession('collect_name');
    const res1 = await engine.process(session, 'hello', testWorkflow, testConfig);
    expect(res1.nextStateId).toBe('collect_name');
    expect(res1.updatedCollectedData?.name).toBeUndefined();

    const res2 = await engine.process(session, 'سلام', testWorkflow, testConfig);
    expect(res2.nextStateId).toBe('collect_name');
    expect(res2.updatedCollectedData?.name).toBeUndefined();
  });

  it('D. string field + side question -> answers question + reprompts without mutating field', async () => {
    const session = createMockSession('collect_name');
    const res = await engine.process(session, 'How much is it?', testWorkflow, testConfig);

    expect(res.nextStateId).toBe('collect_name');
    expect(res.updatedCollectedData?.name).toBeUndefined();
    expect(res.response).toContain('The fee is 500 MAD.');
    expect(res.response).toContain('Please enter your full name:');
  });

  it('E. phone field + valid number -> save and advance', async () => {
    const session = createMockSession('collect_phone', { name: 'John Doe' });
    const res = await engine.process(session, '+212 600-000000', testWorkflow, testConfig);

    expect(res.nextStateId).toBe('collect_email');
    expect(res.updatedCollectedData?.phone).toBe('+212 600-000000');
  });

  it('F. phone field + booking/workflow intent -> no mutation', async () => {
    const session = createMockSession('collect_phone', { name: 'John Doe' });
    const res = await engine.process(session, 'book consultation', testWorkflow, testConfig);

    expect(res.nextStateId).toBe('collect_phone');
    expect(res.updatedCollectedData?.phone).toBeUndefined();
  });

  it('G. phone field + invalid text -> no mutation, validation error', async () => {
    const session = createMockSession('collect_phone', { name: 'John Doe' });
    const res = await engine.process(session, 'not-a-phone-number', testWorkflow, testConfig);

    expect(res.nextStateId).toBe('collect_phone');
    expect(res.updatedCollectedData?.phone).toBeUndefined();
    expect(res.response).toContain('Value must be a valid phone number.');
  });

  it('H. email field + valid email -> save and advance', async () => {
    const session = createMockSession('collect_email', { name: 'John Doe', phone: '0600000000' });
    const res = await engine.process(session, 'john.doe@example.com', testWorkflow, testConfig);

    expect(res.nextStateId).toBe('collect_date');
    expect(res.updatedCollectedData?.email).toBe('john.doe@example.com');
  });

  it('I. email field + invalid text -> no mutation, validation error', async () => {
    const session = createMockSession('collect_email', { name: 'John Doe', phone: '0600000000' });
    const res = await engine.process(session, 'invalid-email-address', testWorkflow, testConfig);

    expect(res.nextStateId).toBe('collect_email');
    expect(res.updatedCollectedData?.email).toBeUndefined();
    expect(res.response).toContain('Value must be a valid email address.');
  });

  it('J. date field + invalid text -> no mutation, validation error', async () => {
    const session = createMockSession('collect_date', { name: 'John Doe' });
    const res = await engine.process(session, 'tomorrow maybe', testWorkflow, testConfig);

    expect(res.nextStateId).toBe('collect_date');
    expect(res.updatedCollectedData?.appointment_date).toBeUndefined();
    expect(res.response).toContain('Value must be a valid date.');
  });

  it('K. valid field values in Arabic, Darija, English, French are accepted by string validator', async () => {
    const names = ['محمد الصابر', 'Mehdi Bennani', 'Jean Dupont', 'John Doe'];

    for (const n of names) {
      const session = createMockSession('collect_name');
      const res = await engine.process(session, n, testWorkflow, testConfig);
      expect(res.nextStateId).toBe('collect_phone');
      expect(res.updatedCollectedData?.name).toBe(n);
    }
  });
});
