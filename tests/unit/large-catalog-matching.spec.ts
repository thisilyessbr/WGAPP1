import { describe, expect, it } from 'vitest';
import { CatalogMatcher } from '../../src/domain/ecommerce/CatalogMatcher';
import { EcommerceIntentParser } from '../../src/domain/ecommerce/EcommerceIntent';
import { LanguageDetector } from '../../src/domain/faq/FaqMatcher';

const catalog = [
  { id: 'runner', name: 'Basket Runner Atlas', category: 'Chaussures' },
  { id: 'sport', name: 'Lunettes de soleil Sport Atlas', category: 'Accessoires' },
  { id: 'phone', name: 'Smartphone Atlas A3 64 Go', category: 'Électronique' },
  { id: 'mini-casque', name: 'Casque Enfant Mini', category: 'Électronique' },
  { id: 'mini-sac', name: 'Pochette Cuir Mini', category: 'Sacs' },
  { id: 'watch', name: 'Montre connectée Ifrane', category: 'Électronique' },
  { id: 'trail', name: 'Basket Trail Ifrane', category: 'Chaussures' }
];

describe('large catalog matching', () => {
  it('prefers the product whose name the customer wrote exactly over a synonym match', () => {
    for (const text of ['I want to order the Runner Atlas', 'واش كاينة Runner Atlas حمرا نمرة 42؟', 'And the Runner Atlas in black size 43?']) {
      expect(CatalogMatcher.best(text, catalog)?.id).toBe('runner');
    }
  });
  it('still refuses an ambiguous shared word', () => {
    expect(CatalogMatcher.best('Atlas', catalog)).toBeNull();
  });
  it('does not match a short product word inside a longer word', () => {
    expect(CatalogMatcher.rank('headphones in a minimalist style', catalog).map(m => m.product.id)).not.toContain('mini-sac');
  });
  it('knows smartwatch and headphone words', () => {
    expect(CatalogMatcher.best('Is the Ifrane smartwatch available?', catalog)?.id).toBe('watch');
    expect(CatalogMatcher.rank('wach 3ndkom kask?', catalog)[0]?.product.id).toBe('mini-casque');
  });
  it('does not treat iPhone as any phone', () => {
    expect(CatalogMatcher.rank('Do you sell the iPhone 15?', catalog)).toHaveLength(0);
  });
});

describe('Darija colours and words', () => {
  it.each([['حمرا', 'Red'], ['7mra', 'Red'], ['k7la', 'Black'], ['كحلة', 'Black'], ['byda', 'White'], ['noire', 'Black'], ['zr9a', 'Blue']])(
    '%s is %s', (word, colour) => expect(EcommerceIntentParser.canonicalColor(word)).toBe(colour));
  it('detects Arabizi size questions and photo follow-ups', () => {
    expect(LanguageDetector.detect('rjli fiha 26.7 cm, chmn nmra nakhod f Runner Atlas?')).toBe('darija');
    expect(LanguageDetector.detect('sift lia tswirto')).toBe('darija');
  });
});
