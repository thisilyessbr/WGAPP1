import { describe, expect, it } from 'vitest';
import { EcommerceIntentParser } from '../../src/domain/ecommerce/EcommerceIntent';
import { AnswerComposer } from '../../src/domain/conversation/AnswerComposer';
import { GroundedPromptBuilder } from '../../src/domain/conversation/GroundedPromptBuilder';

describe('large clothing sizes', () => {
  it.each([
    ['هل يوجد بمقاس 54؟', '54'],
    ['wach kayn f 56?', '56'],
    ['Avez-vous la taille 52 ?', '52'],
    ['واش كاين فالمقاس 58؟', '58'],
    ['do you have it in 4XL?', '4XL']
  ])('reads the size in %s', (text, size) => {
    expect(EcommerceIntentParser.parse(text).size).toBe(size);
  });

  it.each(['بغيت 50 درهم', 'is it 50 dirhams?', 'bghit b 60 dh'])('never reads an amount as a size: %s', text => {
    expect(EcommerceIntentParser.parse(text).size).toBeUndefined();
  });
});

describe('menu service price', () => {
  it('uses the menu price with or without its currency', () => {
    expect(AnswerComposer.namedServicePrice('Hammam traditionnel', '150 MAD', 'MAD', 'darija', 'arabizi')).toBe('Taman dyal Hammam traditionnel howa 150 MAD.');
    expect(AnswerComposer.namedServicePrice('Manucure', 100, 'MAD', 'fr')).toBe('Le prix de Manucure est de 100 MAD.');
    expect(AnswerComposer.namedServicePrice('Manucure', 'sur devis', 'MAD', 'en')).toBeNull();
  });
});

describe('follow-up questions', () => {
  it.each(['Et ça dure combien de temps ?', 'وشحال كياخد ديال الوقت؟', 'And how long does it take?', 'w ch7al?'])('%s is a follow-up', text => {
    expect(GroundedPromptBuilder.isFollowupQuestion(text)).toBe(true);
  });
  it.each(['شحال ثمن تنقية الوجه؟', 'Combien coûte le soin du visage ?'])('%s is a new question', text => {
    expect(GroundedPromptBuilder.isFollowupQuestion(text)).toBe(false);
  });
});

describe('next step versus completed booking', () => {
  it('lets "the team will confirm your appointment" through', async () => {
    const { GroundedAnswerGuard } = await import('../../src/domain/conversation/GroundedAnswerGuard');
    expect(GroundedAnswerGuard.claimsCompletedAction('صيفطي لينا رسالة فواتساب والفرقة تأكد ليك الموعد.')).toBe(false);
    expect(GroundedAnswerGuard.claimsCompletedAction('راه تأكد الحجز ديالك')).toBe(true);
    expect(GroundedAnswerGuard.claimsCompletedAction('الحجز ديالك تأكد')).toBe(true);
  });
});

describe('order details without a form', () => {
  it('recognises contact details, not questions', async () => {
    const { HandoffService } = await import('../../src/domain/conversation/HandoffService');
    expect(HandoffService.isContactDetailsMessage('My name is Salma Bennani, 15 Avenue Hassan II Rabat, 0612345678')).toBe(true);
    expect(HandoffService.isContactDetailsMessage('سميتي سلمى بناني، 15 شارع الحسن الثاني الرباط، +212 6 12 34 56 78')).toBe(true);
    expect(HandoffService.isContactDetailsMessage('Can I call 0612345678 to order?')).toBe(false);
    expect(HandoffService.isContactDetailsMessage('Price of the 2024 model')).toBe(false);
  });
  it('uses the owner handoff text when it was changed, the order text otherwise', async () => {
    const { DEFAULT_HANDOFF_MESSAGES } = await import('../../src/domain/tenant/BusinessConfig');
    const ctx = (handoff?: unknown) => ({ responseLanguage: 'fr', responseScript: 'latin', config: { prompts: handoff ? { handoff } : {} } } as any);
    expect(AnswerComposer.composeDetailsHandoff(ctx(), 'order')).toContain('notre équipe');
    expect(AnswerComposer.composeDetailsHandoff(ctx(DEFAULT_HANDOFF_MESSAGES), 'order')).toContain('notre équipe');
    expect(AnswerComposer.composeDetailsHandoff(ctx({ fr: 'Karim vous rappelle.' }), 'order')).toBe('Karim vous rappelle.');
  });
});
