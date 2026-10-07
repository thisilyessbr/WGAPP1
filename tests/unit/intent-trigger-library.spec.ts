import { describe, expect, it } from 'vitest';
import { IntentTriggerLibrary } from '../../src/domain/conversation/IntentTriggerLibrary';

describe('IntentTriggerLibrary', () => {
  it.each([
    'bghit ncommandi',
    'bghit ncommandi wa7d',
    'bghit nkomandi wahed',
    'bghit nchri wa7d chat bot',
    'بغيت نكوموندي واحد',
    'بغيت نشري شات بوت',
    'je veux commander un chatbot',
    'I want to order one chatbot',
    'kifash nchri',
    'كيفية الشراء',
    'comment acheter',
    'place an order'
  ])('recognizes multilingual purchase wording: %s', phrase => {
    expect(IntentTriggerLibrary.has(phrase, 'PURCHASE')).toBe(true);
  });

  it.each([
    'bghit demo',
    'بغيت ناخد ديمو',
    'je veux une démo',
    'I want a demo'
  ])('recognizes multilingual demo wording: %s', phrase => {
    expect(IntentTriggerLibrary.has(phrase, 'DEMO')).toBe(true);
  });

  it.each([
    'ma bghitch ncommandi',
    'مابغيتش نشري',
    'je ne veux pas commander',
    "I don't want to order",
    'fin wslat commande dyali',
    'where is my order'
  ])('does not turn a negation or order-status question into a new purchase: %s', phrase => {
    expect(IntentTriggerLibrary.has(phrase, 'PURCHASE')).toBe(false);
  });
});
