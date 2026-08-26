import { describe, it, expect } from 'vitest';
import { ConversationEngine } from '../../src/domain/conversation/ConversationEngine';
import { BusinessConfig, DEFAULT_BUSINESS_CONFIG, WorkflowConfig } from '../../src/domain/tenant/BusinessConfig';
import { TurnDecision } from '../../src/domain/conversation/TurnDecision';

describe('Phase 45K: Strict Workflow Activation Trigger Semantics', () => {
  // Helper to access private resolveWorkflowTrigger
  function resolveTrigger(engine: any, content: string, config: BusinessConfig, turnDecision?: any) {
    return engine.resolveWorkflowTrigger(content, config, turnDecision);
  }

  const engine = new ConversationEngine(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any
  );

  const sampleWorkflow: WorkflowConfig = {
    id: 'consultation_booking',
    name: 'Consultation Booking',
    description: 'Booking workflow for consultations',
    initialState: 'collect_name',
    states: {
      collect_name: {
        type: 'collect',
        field: { name: 'name', type: 'string', required: true },
        prompt: 'What is your name?',
        next: 'step_end'
      },
      step_end: {
        type: 'end',
        prompt: 'Done'
      }
    },
    activation: {
      mode: 'explicit_intent',
      intents: ['book_consultation'],
      allowManualStart: true
    }
  };

  const baseConfig: BusinessConfig = {
    ...DEFAULT_BUSINESS_CONFIG,
    capabilities: {
      ecommerceEnabled: false,
      imageEnabled: false,
      intents: [
        {
          id: 'book_consultation',
          description: 'User wants services consultation booking and schedule appointment',
          workflowId: 'consultation_booking',
          keywords: ['book appointment', 'حجز استشارة', 'بغيت نحجز']
        }
      ]
    },
    workflows: {
      consultation_booking: sampleWorkflow
    }
  };

  it('1. intent = null, message = "شنو الخدمات اللي كتقدمو؟" -> NO workflow', () => {
    const td: TurnDecision = { domain: 'GENERAL', intent: null as any, source: 'LLM' } as any;
    const res = resolveTrigger(engine, 'شنو الخدمات اللي كتقدمو؟', baseConfig, td);
    expect(res).toBeNull();
  });

  it('2. intent = GENERAL_CONVERSATION, message = "what services do you offer?" -> NO workflow', () => {
    const td: TurnDecision = { domain: 'GENERAL', intent: 'GENERAL_CONVERSATION', source: 'LLM' } as any;
    const res = resolveTrigger(engine, 'what services do you offer?', baseConfig, td);
    expect(res).toBeNull();
  });

  it('3. intent = PRICE, message = "how much?" -> NO booking workflow', () => {
    const td: TurnDecision = { domain: 'KNOWLEDGE', intent: 'PRICE', source: 'RAG' } as any;
    const res = resolveTrigger(engine, 'how much?', baseConfig, td);
    expect(res).toBeNull();
  });

  it('4. Explicit booking intent in TurnDecision -> booking workflow starts', () => {
    const td: TurnDecision = { domain: 'WORKFLOW', intent: 'book_consultation', source: 'DETERMINISTIC' } as any;
    const res = resolveTrigger(engine, 'I need to schedule', baseConfig, td);
    expect(res).not.toBeNull();
    expect(res?.workflowId).toBe('consultation_booking');
  });

  it('5. Explicit configured keyword -> booking workflow starts', () => {
    const td: TurnDecision = { domain: 'GENERAL', intent: 'GENERAL_CONVERSATION', source: 'LLM' } as any;
    const res = resolveTrigger(engine, 'بغيت نحجز عافاك', baseConfig, td);
    expect(res).not.toBeNull();
    expect(res?.workflowId).toBe('consultation_booking');
  });

  it('6. Exact workflow ID with allowManualStart=true -> workflow starts', () => {
    const td: TurnDecision = { domain: 'GENERAL', intent: 'GENERAL_CONVERSATION', source: 'LLM' } as any;
    const res = resolveTrigger(engine, 'consultation_booking', baseConfig, td);
    expect(res).not.toBeNull();
    expect(res?.workflowId).toBe('consultation_booking');
  });

  it('7. Same exact workflow ID with allowManualStart=false -> NO workflow', () => {
    const disabledManualConfig: BusinessConfig = {
      ...baseConfig,
      workflows: {
        consultation_booking: {
          ...sampleWorkflow,
          activation: {
            mode: 'explicit_intent',
            intents: ['book_consultation'],
            allowManualStart: false
          }
        }
      }
    };
    const td: TurnDecision = { domain: 'GENERAL', intent: 'GENERAL_CONVERSATION', source: 'LLM' } as any;
    const res = resolveTrigger(engine, 'consultation_booking', disabledManualConfig, td);
    expect(res).toBeNull();
  });

  it('8. auto_start mode -> workflow starts automatically', () => {
    const autoStartConfig: BusinessConfig = {
      ...baseConfig,
      workflows: {
        consultation_booking: {
          ...sampleWorkflow,
          activation: {
            mode: 'auto_start',
            allowManualStart: true
          }
        }
      }
    };
    const td: TurnDecision = { domain: 'GENERAL', intent: 'GENERAL_CONVERSATION', source: 'LLM' } as any;
    const res = resolveTrigger(engine, 'random text asking anything', autoStartConfig, td);
    expect(res).not.toBeNull();
    expect(res?.workflowId).toBe('consultation_booking');
  });

  it('9. Intent description contains "services consultation booking" but user asks "شنو الخدمات اللي كتقدمو؟" -> NO workflow', () => {
    const td: TurnDecision = { domain: 'GENERAL', intent: 'GENERAL_CONVERSATION', source: 'LLM' } as any;
    const res = resolveTrigger(engine, 'شنو الخدمات اللي كتقدمو؟', baseConfig, td);
    expect(res).toBeNull();
  });

  it('10. Existing ecommerce workflow behavior unchanged (custom order intent triggers, catalog query does not)', () => {
    const ecomConfig: BusinessConfig = {
      ...DEFAULT_BUSINESS_CONFIG,
      capabilities: {
        ecommerceEnabled: true,
        imageEnabled: false,
        intents: [
          { id: 'custom_order', description: 'Place a custom commission order', workflowId: 'custom_order_wf', keywords: ['custom order'] }
        ]
      },
      workflows: {
        custom_order_wf: {
          id: 'custom_order_wf',
          name: 'Custom Order',
          description: 'Custom order flow',
          initialState: 'start',
          states: { start: { type: 'end', prompt: 'Done' } }
        }
      }
    };

    // A. Product query does NOT trigger custom order workflow
    const tdProd: TurnDecision = { domain: 'ECOMMERCE', intent: 'PRODUCT_SEARCH', source: 'ECOMMERCE' } as any;
    const resProd = resolveTrigger(engine, 'do you sell red hoodies?', ecomConfig, tdProd);
    expect(resProd).toBeNull();

    // B. Explicit custom order keyword DOES trigger workflow
    const resCustom = resolveTrigger(engine, 'I want to make a custom order', ecomConfig, tdProd);
    expect(resCustom).not.toBeNull();
    expect(resCustom?.workflowId).toBe('custom_order_wf');
  });
});
