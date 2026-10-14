import { describe, expect, it } from 'vitest';
import { CatalogMatcher, skeleton, normalizeToken } from '../../src/domain/ecommerce/CatalogMatcher';
import { TurnDecisionResolver } from '../../src/domain/conversation/TurnDecision';
import { LanguageDetector } from '../../src/domain/faq/FaqMatcher';
import { ResponseBuilder } from '../../src/domain/conversation/ResponseBuilder';
import { DEFAULT_BUSINESS_CONFIG } from '../../src/domain/tenant/BusinessConfig';
import { GroundedAnswerGuard } from '../../src/domain/conversation/GroundedAnswerGuard';
import { EcommerceIntentParser } from '../../src/domain/ecommerce/EcommerceIntent';

const catalog = [
  { id: 'caftan', name: 'Caftan Yasmine', description: 'Caftan brodé main en satin.', category: 'Caftans', sku: 'AM-CAF' },
  { id: 'djellaba', name: 'Djellaba Nour', description: 'Djellaba femme en crêpe.', category: 'Djellabas', sku: 'AM-DJL' },
  { id: 'jean', name: 'Jean Slim Atlas', description: 'Jean slim stretch en denim.', category: 'Jeans', sku: 'AM-JEA' },
  { id: 'sneakers', name: 'Baskets Rif Runner', description: 'Baskets légères en mesh.', category: 'Chaussures', sku: 'AM-SNK' },
  { id: 'babouche', name: 'Babouches Marrakech', description: 'Babouches traditionnelles en cuir.', category: 'Chaussures', sku: 'AM-BAB' },
  { id: 'bag', name: 'Sac Fès Cuir', description: 'Sac à main en cuir fabriqué à Fès.', category: 'Sacs', sku: 'AM-BAG' },
  { id: 'abaya', name: 'Abaya Salma', description: 'Abaya noire fluide.', category: 'Abayas', sku: 'AM-ABY' },
  { id: 'tshirt', name: 'T-shirt Casablanca', description: 'T-shirt 100% coton.', category: 'T-shirts', sku: 'AM-TSH' },
  { id: 'watch', name: 'Montre Sahara', description: 'Montre en acier.', category: 'Accessoires', sku: 'AM-WAT' },
  { id: 'hoodie', name: 'Hoodie Ultras', description: 'Hoodie molletonné avec capuche.', category: 'Hoodies', sku: 'AM-HOD' }
];

describe('catalog matching for Moroccan customers (French catalog, multilingual questions)', () => {
  it.each([
    ['شحال ثمن القفطان ياسمين؟', 'caftan'],
    ['bch7al l9eftan?', 'caftan'],
    ['واش باقي عندكم الجلابة؟', 'djellaba'],
    ['mazal 3ndkom serwal djin?', 'jean'],
    ['سلام شحال الدجين', 'jean'],
    ['شحال ثمن السبرديلة؟', 'sneakers'],
    ['wach sbardila kayn?', 'sneakers'],
    ['هل الحذاء الرياضي متوفر؟', 'sneakers'],
    ['كم سعر البلغة؟', 'babouche'],
    ['bch7al lbelgha?', 'babouche'],
    ['شحال ثمن الصاك ديال الجلد؟', 'bag'],
    ['3tini photo dyal sac dyal jeld', 'bag'],
    ['عندك تصاور ديال العباية سلمى؟', 'abaya'],
    ['mazal 3ndkom l3baya?', 'abaya'],
    ['سلام شحال التيشورت كازا', 'tshirt'],
    ['بشحال المونطر عافاك', 'watch'],
    ['mazal 3ndkom lmontre?', 'watch'],
    ['الكابوشون Ultras كاين؟', 'hoodie'],
    ['How much is the sneakers?', 'sneakers'],
    ["Vous pouvez m'envoyer une photo du caftan Yasmine ?", 'caftan']
  ])('%s → %s', (text, expected) => {
    expect(CatalogMatcher.best(text, catalog)?.id).toBe(expected);
  });

  it.each([
    'iPhone 15 bch7al?', 'Vous vendez parfum Dior ? combien ?', 'واش عندكم التكشيطة؟ بشحال؟', 'salam', 'slm labas?',
    'wach katwslo l casa?', 'livraison l fes bch7al?', 'شحال الليفريزون لفاس؟', 'Send me a photo please'
  ])('names no catalog product: %s', text => {
    expect(CatalogMatcher.best(text, catalog)).toBeNull();
  });

  it('keeps a delivery destination from matching a product named after the city', () => {
    expect(CatalogMatcher.best('bch7al l9eftan w ch7al livraison l fes?', catalog)?.id).toBe('caftan');
    expect(CatalogMatcher.best('Le baskets coûte combien et la livraison à Casablanca ?', catalog)?.id).toBe('sneakers');
  });

  it('matches transliterations across scripts by consonant skeleton', () => {
    expect(skeleton(normalizeToken('ياسمين'))).toBe(skeleton(normalizeToken('Yasmine')));
    expect(skeleton(normalizeToken('قفطان'))).toBe(skeleton(normalizeToken('caftan')));
    expect(skeleton(normalizeToken('مونطر'))).toBe(skeleton(normalizeToken('montre')));
  });

  it('is ambiguous (null) when two products tie', () => {
    const twoCaftans = [...catalog, { id: 'caftan2', name: 'Caftan Leila', description: 'Caftan en velours.', category: 'Caftans', sku: 'AM-CAF2' }];
    expect(CatalogMatcher.best('شحال القفطان؟', twoCaftans)).toBeNull();
    expect(CatalogMatcher.best('شحال القفطان ياسمين؟', twoCaftans)?.id).toBe('caftan');
  });
});

describe('routing product questions that name a catalog product', () => {
  const route = (text: string, catalogProductId: string | null = null) =>
    TurnDecisionResolver.resolve({ text, isEcommerceEnabled: true, catalogProductId } as any);

  it('treats a French photo request as a product image request, not shipping', () => {
    const d = route("Vous pouvez m'envoyer une photo du caftan ?", 'caftan');
    expect(d.domain).toBe('ECOMMERCE');
    expect(d.requestedMediaType).toBe('image');
    expect(d.catalogProductId).toBe('caftan');
  });

  it.each([
    ['le caftan existe en L ?', 'AVAILABILITY'],
    ['عندكم القفطان نمرة XL؟', 'AVAILABILITY'],
    ['هل يوجد قفطان Yasmine بمقاس S؟', 'AVAILABILITY'],
    ['شحال ثمن القفطان؟', 'PRICE'],
    ['bghit ncommandi caftan', 'BUY_INTENT']
  ])('%s → ECOMMERCE %s', (text, intent) => {
    const d = route(text, 'caftan');
    expect(d.domain).toBe('ECOMMERCE');
    expect(d.intent).toBe(intent);
  });

  it('keeps price + delivery questions on the knowledge path with the named product attached', () => {
    const d = route('Le caftan Yasmine coûte combien et la livraison à Casablanca ?', 'caftan');
    expect(d.domain).toBe('KNOWLEDGE');
    expect(d.catalogProductId).toBe('caftan');
  });

  it.each([
    ['شحال الليفريزون لفاس؟', 'SHIPPING'],
    ['do you have a physical store?', 'STORE_INFO'],
    ['fin jat lboutique dyalkom?', 'STORE_INFO']
  ])('%s → KNOWLEDGE %s', (text, intent) => {
    const d = route(text);
    expect(d.domain).toBe('KNOWLEDGE');
    expect(d.intent).toBe(intent);
  });
});

describe('follow-ups and destinations are not product names', () => {
  it.each(['Envoyez-moi une photo svp', 'when will I receive my order in Fez?'])('%s', text => {
    expect(CatalogMatcher.best(text, catalog)).toBeNull();
  });

  it('routes Darija exchange questions to the returns policy', () => {
    const d = TurnDecisionResolver.resolve({ text: 'wach katbdlo?', isEcommerceEnabled: true } as any);
    expect(d.domain).toBe('KNOWLEDGE');
    expect(d.intent).toBe('RETURNS');
  });
});

describe('language detection with product names', () => {
  it('treats Arabizi material questions as Darija', () => {
    expect(LanguageDetector.detect('caftan yasmine mn ach msawb?')).toBe('darija');
  });

  it.each([
    ['How much is the Nour djellaba?', 'en'],
    ['Combien coûte le djellaba Nour ?', 'fr'],
    ['sbah nour', 'darija'],
    ['wach jellaba nour kayn?', 'darija']
  ])('%s → %s', (text, lang) => {
    expect(LanguageDetector.detect(text)).toBe(lang);
  });
});

describe('Darija order questions when the merchant wrote only one script', () => {
  const builder = new ResponseBuilder();
  const state: any = { type: 'collect', field: 'size', prompt: { en: 'Which size?', fr: 'Quelle taille ?', ar: 'ما المقاس؟', darija: 'شنو المقاس؟' } };

  it('asks Arabizi customers in Arabizi instead of a raw field key', () => {
    const text = builder.buildMissingFieldResponse(state, DEFAULT_BUSINESS_CONFIG, 'darija', 'arabizi');
    expect(text).toBe('Chmen taille w chmen lon bghiti?');
    expect(text).not.toContain('3tina: size');
  });

  it("keeps the merchant's own same-script Darija question", () => {
    expect(builder.buildMissingFieldResponse(state, DEFAULT_BUSINESS_CONFIG, 'darija', 'arabic')).toBe('شنو المقاس؟');
  });

  it("falls back to the merchant's French question for unknown fields in Arabizi", () => {
    const custom: any = { type: 'collect', field: 'engravingText', prompt: { fr: 'Quel texte graver ?', darija: 'شنو نكتبو؟' } };
    expect(builder.buildMissingFieldResponse(custom, DEFAULT_BUSINESS_CONFIG, 'darija', 'arabizi')).toBe('Quel texte graver ?');
  });
});

describe('follow-up wording is not a product reference or a completed action', () => {
  it.each(['Envoyez-moi une photo svp', 'Montrez-le moi svp', 'Dites-nous le prix'])('no SKU in %s', text => {
    expect(EcommerceIntentParser.parse(text).sku).toBeUndefined();
  });

  it('still reads real references', () => {
    expect(EcommerceIntentParser.parse('Prix de ATL-CAF-01 ?').sku).toBe('ATL-CAF-01');
  });

  it.each([
    'Once your order is confirmed, you will receive the tracking number on WhatsApp within 24h.',
    'Après confirmation de la commande, vous recevez le numéro de suivi par WhatsApp.',
    'بعد ما يتم تأكيد طلبك، غادي توصلك نمرة التتبع.'
  ])('allows a future step: %s', text => {
    expect(GroundedAnswerGuard.claimsCompletedAction(text)).toBe(false);
  });

  it.each(['Your order is confirmed!', 'Votre commande est confirmée.', 'تم تأكيد طلبك', 'Réservation confirmée !'])('blocks a false claim: %s', text => {
    expect(GroundedAnswerGuard.claimsCompletedAction(text)).toBe(true);
  });
});
