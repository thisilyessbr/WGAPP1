import { describe, expect, it } from 'vitest';
import { GroundedAnswerGuard } from '../../src/domain/conversation/GroundedAnswerGuard';
import { DirectRagGuard } from '../../src/domain/rag/DirectRagGuard';
import { BusinessQuestionScope } from '../../src/domain/conversation/BusinessQuestionScope';
import { EcommerceIntentParser } from '../../src/domain/ecommerce/EcommerceIntent';

describe('answer evidence gates', () => {
  it('rejects a related PDF that lacks the requested return policy', () => {
    expect(DirectRagGuard.evaluate('Can I return the Atlas shirt?', 'Atlas shirt care guide\nWash at 30 degrees Celsius.', 'en', 'latin'))
      .toMatchObject({ isSafe: false, reason: 'QUESTION_NOT_ANSWERED' });
  });

  it('does not paste multiple size recommendations as the exact size answer', () => {
    expect(DirectRagGuard.evaluate('What chest fits size M?', 'Size M fits 96–101 cm. Size L fits 102–107 cm.', 'en', 'latin'))
      .toMatchObject({ isSafe: false, reason: 'QUESTION_NOT_ANSWERED' });
  });

  it('rejects a partial single-topic FAQ', () => {
    expect(BusinessQuestionScope.isCovered('What is your warranty?', 'Our store is in Rabat.')).toBe(false);
  });

  it('treats Darija “شحال كتدوم” as duration rather than a price request', () => {
    expect(BusinessQuestionScope.isCovered('شحال كتدوم الاستشارة؟', 'كل جلسة كتدوم 45 دقيقة.')).toBe(true);
    expect(BusinessQuestionScope.isCovered('شحال الثمن ديال الاستشارة؟', 'كل جلسة كتدوم 45 دقيقة.')).toBe(false);
  });

  it('rejects invented prices and false completed actions in generated text', () => {
    expect(GroundedAnswerGuard.evaluate('It costs 170 MAD.', 'Service price: 120 MAD.')).toMatchObject({ safe: false, reason: 'UNSUPPORTED_PRICE' });
    expect(GroundedAnswerGuard.evaluate('Your appointment is confirmed.', 'Opening hours: 9:00 to 18:00.')).toMatchObject({ safe: false, reason: 'FALSE_ACTION' });
  });

  it('allows a supported amount and a request that still needs staff confirmation', () => {
    expect(GroundedAnswerGuard.evaluate('The service costs 120 MAD. Staff must confirm your request.', 'Service price: 120 MAD.'))
      .toMatchObject({ safe: true });
  });

  it('prefers the configured service price and hours over stale document numbers', () => {
    const context = { question: 'What does brushing cost and when do you close?', services: [{ name: 'brushing', price: 80 }], businessHours: '9:00–18:00' };
    const evidence = 'Old brochure says 70 MAD and 20:00. Current service: brushing 80 MAD. Hours: 9:00–18:00.';
    expect(GroundedAnswerGuard.evaluate('Brushing costs 70 MAD.', evidence, context)).toMatchObject({ safe: false, reason: 'CONFLICTING_PRICE' });
    expect(GroundedAnswerGuard.evaluate('Brushing costs 80 MAD. We close at 20:00.', evidence, context)).toMatchObject({ safe: false, reason: 'CONFLICTING_HOURS' });
  });

  it('does not infer that an unlisted discount is unavailable', () => {
    expect(GroundedAnswerGuard.evaluate("We don't offer student discounts.", 'Brushing costs 80 MAD.', { question: 'Do you have a student discount?' }))
      .toMatchObject({ safe: false, reason: 'UNSUPPORTED_DISCOUNT' });
    expect(GroundedAnswerGuard.evaluate('No student discount is listed in the current information.', 'Brushing costs 80 MAD.', { question: 'Do you have a student discount?' }))
      .toMatchObject({ safe: true });
  });

  it('treats a price question about a cotton shirt as price, not fabric details', () => {
    expect(EcommerceIntentParser.parse('How much is Atlas cotton shirt?').intent).toBe('PRICE');
  });
});
