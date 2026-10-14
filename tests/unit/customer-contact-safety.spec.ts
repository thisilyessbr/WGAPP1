import { describe, expect, it } from 'vitest';
import { AnswerComposer } from '../../src/domain/conversation/AnswerComposer';

describe('customer-visible contact safety', () => {
  it('does not send a customer to a reserved demo inbox', () => {
    const reply = AnswerComposer.finalizeResponse('Email our team at normal-chatbot@relayqo.test for a booking.', {
      domain: 'KNOWLEDGE', intent: 'BOOKING_INTENT', source: 'LLM', confidence: 0.8,
      responseLanguage: 'darija', responseScript: 'arabizi'
    } as any);
    expect(reply).not.toContain('relayqo.test');
    expect(reply).toContain('hna');
  });

  it('preserves a real business contact address', () => {
    const reply = AnswerComposer.finalizeResponse('Contact us at hello@business.ma.', {
      domain: 'KNOWLEDGE', intent: 'CONTACT', source: 'LLM', confidence: 0.8,
      responseLanguage: 'en', responseScript: 'latin'
    } as any);
    expect(reply).toContain('hello@business.ma');
  });
});
