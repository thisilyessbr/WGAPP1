import { describe, it, expect } from 'vitest';
import { TurnDecisionResolver } from '../../src/domain/conversation/TurnDecision';
import { ConversationEngine } from '../../src/domain/conversation/ConversationEngine';
import { BusinessConfig, DEFAULT_BUSINESS_CONFIG } from '../../src/domain/tenant/BusinessConfig';

describe('Phase FIX-PROBLEM-1: Ecommerce Intent Gating', () => {
  const consultationConfig: BusinessConfig = {
    ...DEFAULT_BUSINESS_CONFIG,
    capabilities: {
      ecommerceEnabled: false,
      imageEnabled: false,
      intents: [
        {
          id: 'book_consultation',
          description: 'Book consultation appointment',
          workflowId: 'consultation_booking',
          keywords: ['بغيت نحجز', 'أريد حجز استشارة', 'حجز استشارة']
        }
      ]
    },
    workflows: {
      consultation_booking: {
        id: 'consultation_booking',
        name: 'Consultation Booking',
        description: 'Booking flow',
        initialState: 'collect_name',
        states: {
          collect_name: {
            type: 'collect',
            field: { name: 'name', type: 'string', required: true },
            prompt: 'Please enter your name:',
            next: 'end'
          },
          end: {
            type: 'end',
            prompt: 'Done'
          }
        },
        activation: {
          mode: 'explicit_intent',
          intents: ['book_consultation'],
          allowManualStart: true
        }
      }
    }
  };

  it('A. ecommerceEnabled=false + "بغيت نحجز" -> NOT PRODUCT_SEARCH', () => {
    const decision = TurnDecisionResolver.resolve({
      text: 'بغيت نحجز',
      language: 'darija',
      isEcommerceEnabled: false
    });

    expect(decision.domain).not.toBe('ECOMMERCE');
    expect(decision.intent).not.toBe('PRODUCT_SEARCH');
  });

  it('B. ecommerceEnabled=false + "أريد حجز استشارة" -> NOT PRODUCT_SEARCH', () => {
    const decision = TurnDecisionResolver.resolve({
      text: 'أريد حجز استشارة',
      language: 'ar',
      isEcommerceEnabled: false
    });

    expect(decision.domain).not.toBe('ECOMMERCE');
    expect(decision.intent).not.toBe('PRODUCT_SEARCH');
  });

  it('C. ecommerceEnabled=false + "شحال الثمن؟" -> NOT ECOMMERCE PRICE', () => {
    const decision = TurnDecisionResolver.resolve({
      text: 'شحال الثمن؟',
      language: 'darija',
      isEcommerceEnabled: false
    });

    expect(decision.domain).not.toBe('ECOMMERCE');
    expect(decision.intent).not.toBe('PRICE');
  });

  it('D. ecommerceEnabled=true + product price query -> existing ecommerce path unchanged', () => {
    const decision = TurnDecisionResolver.resolve({
      text: 'how much is the red hoodie?',
      language: 'en',
      isEcommerceEnabled: true
    });

    expect(decision.domain).toBe('ECOMMERCE');
    expect(decision.intent).toBe('PRICE');
  });

  it('E. ecommerceEnabled=true + product search -> existing ecommerce path unchanged', () => {
    const decision = TurnDecisionResolver.resolve({
      text: 'show me hoodies',
      language: 'en',
      isEcommerceEnabled: true
    });

    expect(decision.domain).toBe('ECOMMERCE');
    expect(decision.intent).toBe('PRODUCT_SEARCH');
  });

  it('F. consultation workflow with configured explicit intent evaluates without ecommerce collision', () => {
    const engine = new ConversationEngine({} as any, {} as any, {} as any, {} as any, {} as any);

    // Resolve turn decision with isEcommerceEnabled = false
    const turnDecision = TurnDecisionResolver.resolve({
      text: 'بغيت نحجز',
      language: 'darija',
      isEcommerceEnabled: false
    });

    // Workflow activation resolution
    const trigger = (engine as any).resolveWorkflowTrigger('بغيت نحجز', consultationConfig, turnDecision);

    expect(trigger).not.toBeNull();
    expect(trigger?.workflowId).toBe('consultation_booking');
  });
});
