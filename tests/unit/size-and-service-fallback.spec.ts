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
