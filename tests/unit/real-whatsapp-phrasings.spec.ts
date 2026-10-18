import { describe, expect, it } from 'vitest';
import { normalizeSpellingVariants } from '../../src/domain/understanding/MoroccanLexicon';
import { LanguageDetector } from '../../src/domain/faq/FaqMatcher';
import { EcommerceIntentParser } from '../../src/domain/ecommerce/EcommerceIntent';
import { CatalogMatcher } from '../../src/domain/ecommerce/CatalogMatcher';
import { ConversationEngine } from '../../src/domain/conversation/ConversationEngine';

// Phrasings taken from real (redacted) WhatsApp messages to a Moroccan T-shirt / hoodie shop.
const SHOP = [
  { id: 'hn', name: 'Hoodie Naruto', category: 'Hoodies', description: 'Sweat à capuche anime Naruto' },
  { id: 'tn', name: 'T-shirt Naruto Oversize', category: 'T-shirts', description: 'T-shirt oversize anime' },
  { id: 'ho', name: 'Hoodie One Piece', category: 'Hoodies', description: 'Sweat à capuche anime One Piece' }
];
const understand = (text: string) => normalizeSpellingVariants(text);
const intentOf = (text: string) => EcommerceIntentParser.parse(understand(text), null, LanguageDetector.detect(understand(text))).intent;

describe('real WhatsApp phrasings', () => {
  it('reads "4" as gh and "x" as ch in known Darija words only', () => {
    expect(understand('B4it wahd l9obiya')).toBe('Bghit wahd l9obiya');
    expect(understand('Bx7al')).toBe('Bch7al');
    expect(understand('Safi xokran')).toBe('Safi choukran');
    expect(understand('شحل تمن')).toBe('شحال ثمن');
    // Names, numbers and French words stay as written.
    expect(understand('Xavier, 4 pièces, prix deux')).toBe('Xavier, 4 pièces, prix deux');
  });

  it('detects Darija in short real messages instead of English or MSA', () => {
    expect(LanguageDetector.detect('Jwb')).toBe('darija');
    expect(LanguageDetector.detect(understand('B4it wahd l9obiya'))).toBe('darija');
    expect(LanguageDetector.detect('معرفتشي هدك t-shirt wa7d')).toBe('darija');
  });

  it('recognises price and product questions written the way customers write them', () => {
    expect(intentOf('Bx7al')).toBe('PRICE');
    expect(intentOf('شحل تمن')).toBe('PRICE');
    expect(intentOf('NARUTO T-SHIRT OVERSIZE Prix')).toBe('PRICE');
    expect(intentOf('B4it wahd l9obiya')).toBe('PRODUCT_SEARCH');
  });

  it('matches "9obiya" to hoodies and ignores filler words', () => {
    expect(CatalogMatcher.rank('B4it wahd l9obiya', SHOP).map(m => m.product.id).sort()).toEqual(['hn', 'ho']);
    expect(CatalogMatcher.best(understand('B4it 9obiya naruto bx7al'), SHOP)?.id).toBe('hn');
    expect(CatalogMatcher.best('NARUTO T-SHIRT OVERSIZE Prix', SHOP)?.id).toBe('tn');
    expect(CatalogMatcher.best('معرفتشي هدك t-shirt wa7d', SHOP)?.id).toBe('tn');
    for (const filler of ['Safi xokran', 'Jwb', 'Cc', 'Oky']) expect(CatalogMatcher.queryTokens(filler)).toEqual([]);
  });
});

describe('customer photos', () => {
  it('asks the implicit question of a caption-less photo in the customer language', () => {
    expect(ConversationEngine.implicitPhotoQuestion('fr', 'latin', true)).toBe('Vous avez ça ?');
    expect(ConversationEngine.implicitPhotoQuestion('darija', 'arabizi', true)).toBe('wach 3ndkom hadi?');
    expect(ConversationEngine.implicitPhotoQuestion('ar', 'arabic', false)).toBe('هل يمكنكم مساعدتي في هذا؟');
    expect(ConversationEngine.implicitPhotoQuestion('en', 'latin', false)).toBe('Can you help me with this?');
  });

  it('matches the object words the vision model uses to catalog products', () => {
    const catalog = [
      { id: 'w', name: 'Montre connectée Ifrane', category: 'Électronique' },
      { id: 'l', name: 'Rouge à lèvres Rose Medina', category: 'Beauté' },
      { id: 'b', name: 'Babouches Medina', category: 'Chaussures' },
      { id: 's', name: 'Sac à main Fès Cuir', category: 'Sacs' }
    ];
    expect(CatalogMatcher.best('Do you have this? (photo: wristwatch, clock)', catalog)?.id).toBe('w');
    expect(CatalogMatcher.best('How much is this? (photo: lipstick)', catalog)?.id).toBe('l');
    expect(CatalogMatcher.best('Vous avez ça ? (photo: slippers)', catalog)?.id).toBe('b');
    expect(CatalogMatcher.best('Vous avez ça ? (photo: purse)', catalog)?.id).toBe('s');
  });
});
