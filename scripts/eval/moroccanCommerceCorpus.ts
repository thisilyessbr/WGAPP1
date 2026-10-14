/**
 * Fictional Moroccan WhatsApp commerce corpus: the questions Moroccan online
 * shops receive most (price, stock, sizes, photos, delivery per city, cash on
 * delivery, exchanges, ordering...) in English, French, Modern Standard Arabic,
 * Darija in Arabic script and Darija in Latin script (Arabizi).
 * No real customer data. Every expectation is derived from STORE below.
 */

export type Lang = 'en' | 'fr' | 'ar' | 'da' | 'dz';
export const LANGS: Lang[] = ['en', 'fr', 'ar', 'da', 'dz'];

export interface StoreProduct {
  key: string; sku: string; name: string; description: string; price: number; category: string;
  image: boolean;
  variants: { size: string; color: string; stock: number }[];
  stock: number;
  alias: Record<Lang, string[]>;
}

export const IMAGE_BASE = 'https://relayqo.example/api/product-images/';
export const imageUrlFor = (key: string) => `${IMAGE_BASE}${({
  caftan: '0b4f5f7e-0001-4a00-8000-000000000001', djellaba: '0b4f5f7e-0002-4a00-8000-000000000002',
  jean: '0b4f5f7e-0003-4a00-8000-000000000003', sneakers: '0b4f5f7e-0004-4a00-8000-000000000004',
  bag: '0b4f5f7e-0005-4a00-8000-000000000005', abaya: '0b4f5f7e-0006-4a00-8000-000000000006',
  tshirt: '0b4f5f7e-0007-4a00-8000-000000000007', watch: '0b4f5f7e-0009-4a00-8000-000000000009',
  hoodie: '0b4f5f7e-0010-4a00-8000-000000000010'
} as Record<string, string>)[key]}`;

const v = (sizes: string[], colors: string[], stock: (size: string, color: string) => number) =>
  sizes.flatMap(size => colors.map(color => ({ size, color, stock: stock(size, color) })));

export const STORE = {
  name: 'Atlas Mode (fictional)',
  address: '12 Rue Tarik Ibn Ziad, Maârif, Casablanca',
  hours: 'Lundi au samedi de 10:00 à 20:00. Fermé le dimanche.',
  description: 'Boutique de vêtements et accessoires marocains à Casablanca, vente en ligne avec livraison partout au Maroc.',
  policies: {
    shipping: 'Livraison partout au Maroc. Casablanca : livraison en 24h, frais 20 MAD. Autres villes : livraison en 48 à 72h, frais 35 MAD. Livraison gratuite dès 500 MAD d\'achat.',
    payment: 'Paiement à la livraison (cash à la réception). Virement bancaire accepté. Pas de paiement par carte bancaire.',
    returns: 'Échange possible sous 7 jours si l\'article n\'est pas porté et garde son étiquette. Pas de remboursement, sauf article défectueux.',
    privacy: ''
  },
  faqs: [
    { question: 'Comment suivre ma commande ?', answer: 'Après confirmation de la commande, vous recevez le numéro de suivi par WhatsApp sous 24h.', language: 'fr', category: 'orders' }
  ],
  products: [
    { key: 'caftan', sku: 'AM-CAF', name: 'Caftan Yasmine', description: 'Caftan brodé main en satin, idéal pour les fêtes.', price: 890, category: 'Caftans', image: true,
      variants: v(['S', 'M', 'L', 'XL'], ['Bordeaux', 'Vert émeraude'], (s, c) => s === 'XL' && c === 'Bordeaux' ? 0 : 3),
      alias: { en: ['Yasmine caftan', 'caftan'], fr: ['caftan Yasmine', 'caftan'], ar: ['قفطان Yasmine', 'القفطان'], da: ['القفطان ياسمين', 'القفطان'], dz: ['caftan yasmine', 'l9eftan'] } },
    { key: 'djellaba', sku: 'AM-DJL', name: 'Djellaba Nour', description: 'Djellaba femme en tissu crêpe, coupe moderne.', price: 450, category: 'Djellabas', image: true,
      variants: v(['M', 'L', 'XL'], ['Beige', 'Noir'], () => 4),
      alias: { en: ['Nour djellaba', 'djellaba'], fr: ['djellaba Nour', 'djellaba'], ar: ['جلابة Nour', 'الجلابة'], da: ['الجلابة نور', 'الجلابة'], dz: ['jellaba nour', 'jellaba'] } },
    { key: 'jean', sku: 'AM-JEA', name: 'Jean Slim Atlas', description: 'Jean slim stretch en denim.', price: 299, category: 'Jeans', image: true,
      variants: v(['30', '32', '34', '36', '38'], ['Bleu', 'Noir'], (s) => s === '38' ? 0 : 5),
      alias: { en: ['Atlas slim jeans', 'jeans'], fr: ['jean slim Atlas', 'jean'], ar: ['جينز Atlas', 'بنطلون الجينز'], da: ['سروال الجين Atlas', 'الدجين'], dz: ['jean atlas', 'serwal djin'] } },
    { key: 'sneakers', sku: 'AM-SNK', name: 'Baskets Rif Runner', description: 'Baskets légères en mesh, semelle confortable.', price: 520, category: 'Chaussures', image: true,
      variants: v(['39', '40', '41', '42', '43', '44'], ['Blanc', 'Noir'], (s, c) => s === '44' && c === 'Blanc' ? 0 : 2),
      alias: { en: ['Rif Runner sneakers', 'sneakers'], fr: ['baskets Rif Runner', 'baskets'], ar: ['حذاء Rif Runner الرياضي', 'الحذاء الرياضي'], da: ['السبرديلة Rif Runner', 'السبرديلة'], dz: ['sbrdila rif runner', 'sbardila'] } },
    { key: 'bag', sku: 'AM-BAG', name: 'Sac Fès Cuir', description: 'Sac à main en cuir véritable fabriqué à Fès, couleur marron.', price: 650, category: 'Sacs', image: true,
      variants: [],
      alias: { en: ['Fes leather bag', 'leather bag'], fr: ['sac Fès cuir', 'sac en cuir'], ar: ['حقيبة Fès الجلدية', 'الحقيبة الجلدية'], da: ['الصاك ديال الجلد Fès', 'الصاك ديال الجلد'], dz: ['sac fes cuir', 'sac dyal jeld'] } },
    { key: 'abaya', sku: 'AM-ABY', name: 'Abaya Salma', description: 'Abaya noire fluide en crêpe de soie.', price: 380, category: 'Abayas', image: true,
      variants: v(['52', '54', '56', '58'], ['Noir'], () => 3),
      alias: { en: ['Salma abaya', 'abaya'], fr: ['abaya Salma', 'abaya'], ar: ['عباية Salma', 'العباية'], da: ['العباية سلمى', 'العباية'], dz: ['abaya salma', 'l3baya'] } },
    { key: 'tshirt', sku: 'AM-TSH', name: 'T-shirt Casablanca', description: 'T-shirt 100% coton imprimé Casablanca.', price: 149, category: 'T-shirts', image: true,
      variants: v(['S', 'M', 'L', 'XL'], ['Blanc', 'Noir', 'Rouge'], () => 6),
      alias: { en: ['Casablanca t-shirt', 't-shirt'], fr: ['t-shirt Casablanca', 't-shirt'], ar: ['قميص Casablanca', 'التيشيرت'], da: ['التيشورت كازا', 'التيشورت'], dz: ['tishort casa', 'tricot casablanca'] } },
    { key: 'babouche', sku: 'AM-BAB', name: 'Babouches Marrakech', description: 'Babouches traditionnelles en cuir.', price: 180, category: 'Chaussures', image: false,
      variants: v(['38', '39', '40', '41', '42', '43', '44'], ['Jaune', 'Rouge'], () => 4),
      alias: { en: ['Marrakech babouches', 'babouches'], fr: ['babouches Marrakech', 'babouches'], ar: ['بلغة Marrakech', 'البلغة'], da: ['البلغة ديال مراكش', 'البلغة'], dz: ['belgha marrakech', 'lbelgha'] } },
    { key: 'watch', sku: 'AM-WAT', name: 'Montre Sahara', description: 'Montre en acier, bracelet cuir.', price: 990, category: 'Accessoires', image: true,
      variants: [],
      alias: { en: ['Sahara watch', 'watch'], fr: ['montre Sahara', 'montre'], ar: ['ساعة Sahara', 'الساعة'], da: ['المونطر Sahara', 'المونطر'], dz: ['montre sahara', 'lmontre'] } },
    { key: 'hoodie', sku: 'AM-HOD', name: 'Hoodie Ultras', description: 'Hoodie molletonné avec capuche.', price: 260, category: 'Hoodies', image: true,
      variants: [{ size: 'M', color: 'Vert', stock: 0 }, { size: 'L', color: 'Vert', stock: 4 }],
      alias: { en: ['Ultras hoodie', 'hoodie'], fr: ['hoodie Ultras', 'sweat à capuche'], ar: ['هودي Ultras', 'الهودي'], da: ['الكابوشون Ultras', 'الكابوشون'], dz: ['capuchon ultras', 'hoodie ultras'] } }
  ].map(p => ({ ...p, stock: p.key === 'watch' ? 0 : p.key === 'bag' ? 6 : p.variants.reduce((sum, x) => sum + x.stock, 0) })) as StoreProduct[]
};

export const CITIES: { key: string; casa: boolean; names: Record<Lang, string> }[] = [
  { key: 'casablanca', casa: true, names: { en: 'Casablanca', fr: 'Casablanca', ar: 'الدار البيضاء', da: 'كازا', dz: 'casa' } },
  { key: 'rabat', casa: false, names: { en: 'Rabat', fr: 'Rabat', ar: 'الرباط', da: 'الرباط', dz: 'rbat' } },
  { key: 'tanger', casa: false, names: { en: 'Tangier', fr: 'Tanger', ar: 'طنجة', da: 'طنجة', dz: 'tanja' } },
  { key: 'agadir', casa: false, names: { en: 'Agadir', fr: 'Agadir', ar: 'أكادير', da: 'أكادير', dz: 'agadir' } },
  { key: 'oujda', casa: false, names: { en: 'Oujda', fr: 'Oujda', ar: 'وجدة', da: 'وجدة', dz: 'wejda' } },
  { key: 'marrakech', casa: false, names: { en: 'Marrakech', fr: 'Marrakech', ar: 'مراكش', da: 'مراكش', dz: 'mrakch' } },
  { key: 'fes', casa: false, names: { en: 'Fez', fr: 'Fès', ar: 'فاس', da: 'فاس', dz: 'fes' } },
  { key: 'laayoune', casa: false, names: { en: 'Laayoune', fr: 'Laâyoune', ar: 'العيون', da: 'العيون', dz: 'l3ayoun' } }
];

export type Expectation =
  | { kind: 'price'; product: string }
  | { kind: 'available'; product: string; expected: boolean }
  | { kind: 'variant'; product: string; expected: boolean }
  | { kind: 'photo'; product: string }
  | { kind: 'fee'; casa: boolean }
  | { kind: 'time'; casa: boolean }
  | { kind: 'cod' } | { kind: 'card' } | { kind: 'exchange' } | { kind: 'refund' } | { kind: 'free' }
  | { kind: 'location' } | { kind: 'hours' } | { kind: 'sunday' } | { kind: 'discount' }
  | { kind: 'unknown' } | { kind: 'order'; product: string } | { kind: 'tracking' } | { kind: 'human' }
  | { kind: 'greeting' } | { kind: 'multi'; product: string; casa: boolean } | { kind: 'quality'; product: string };

export interface EvalCase { id: string; intent: string; lang: Lang; turns: string[]; expect: Expectation }

export type Tpl = Record<Lang, string[]>;
export const fill = (t: string, vars: Record<string, string>) => t.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '')
  .replace(/(^|\s)لال/gu, '$1لل');

export const T: Record<string, Tpl> = {
  price: {
    en: ['How much is the {p}?', 'what is the price of the {p}', 'price of {p} please'],
    fr: ['Combien coûte le {p} ?', "c'est combien le {p}", 'Prix du {p} svp'],
    ar: ['كم سعر {p}؟', 'ما هو ثمن {p}؟'],
    da: ['شحال ثمن {p}؟', 'بشحال {p} عافاك', 'سلام شحال {p}'],
    dz: ['bch7al {p}?', 'ch7al taman dyal {p}', 'salam 3afak bchhal {p}', 'prix {p} 3afak']
  },
  available: {
    en: ['Is the {p} available?', 'do you still have the {p} in stock?'],
    fr: ['Le {p} est disponible ?', 'vous avez encore le {p} ?'],
    ar: ['هل {p} متوفر؟', 'هل لا يزال {p} متاحا؟'],
    da: ['واش {p} كاين؟', 'واش باقي عندكم {p}؟'],
    dz: ['wach {p} kayn?', 'mazal 3ndkom {p}?']
  },
  variant: {
    en: ['Do you have the {p} in size {s}?', 'is the {p} available in {s}?'],
    fr: ['Vous avez le {p} en taille {s} ?', 'le {p} existe en {s} ?'],
    ar: ['هل يوجد {p} بمقاس {s}؟'],
    da: ['واش كاين {p} مقاس {s}؟', 'عندكم {p} نمرة {s}؟'],
    dz: ['wach kayn {p} taille {s}?', '3ndkom {p} f {s}?', '{p} pointure {s} kayna?']
  },
  photo: {
    en: ['Can you send me a photo of the {p}?', 'pictures of the {p} please'],
    fr: ["Vous pouvez m'envoyer une photo du {p} ?", 'photo du {p} svp'],
    ar: ['أرسل لي صورة {p} من فضلك', 'هل يمكنني رؤية صورة {p}؟'],
    da: ['صيفط ليا تصويرة ديال {p}', 'عندك تصاور ديال {p}؟'],
    dz: ['sift lia tswira dyal {p}', '3tini photo dyal {p}', 'momkin tsawer dyal {p}?']
  },
  fee: {
    en: ['Do you deliver to {c}? how much is delivery?', 'delivery cost to {c}?'],
    fr: ['Vous livrez à {c} ? combien coûte la livraison ?', 'frais de livraison pour {c} ?'],
    ar: ['هل توصلون إلى {c}؟ كم ثمن التوصيل؟', 'كم تكلفة الشحن إلى {c}؟'],
    da: ['واش كتوصلو ل{c}؟ شحال التوصيل؟', 'شحال الليفريزون ل{c}؟'],
    dz: ['wach katwslo l {c}? ch7al livraison?', 'livraison l {c} bch7al?']
  },
  time: {
    en: ['How long does delivery take to {c}?', 'when will I receive my order in {c}?'],
    fr: ['Combien de temps pour la livraison à {c} ?', 'délai de livraison {c} ?'],
    ar: ['كم يستغرق التوصيل إلى {c}؟'],
    da: ['شحال كتاخد الليفريزون ل{c}؟', 'إمتى توصلني السلعة ف{c}؟'],
    dz: ['ch7al kat9ad livraison l {c}?', 'imta twsalni f {c}?']
  },
  cod: {
    en: ['Can I pay cash on delivery?', 'do I pay when I receive the package?'],
    fr: ['Paiement à la livraison possible ?', 'je peux payer à la réception ?'],
    ar: ['هل يمكن الدفع عند الاستلام؟', 'هل الدفع نقدا عند التسليم؟'],
    da: ['واش نخلص ملي توصلني السلعة؟', 'الخلاص عند الاستلام؟'],
    dz: ['nkhles 3nd stilam?', 'wach lkhlas f lbab?', 'n9der nkhles mli twsalni?']
  },
  card: {
    en: ['Can I pay by credit card?'], fr: ['Je peux payer par carte bancaire ?'], ar: ['هل يمكن الدفع بالبطاقة البنكية؟'],
    da: ['واش نقدر نخلص بالكارط؟'], dz: ['n9der nkhles b la carte?', 'wach katqblo carte guichet?']
  },
  exchange: {
    en: ["Can I exchange it if the size doesn't fit?", 'what is your exchange policy?'],
    fr: ['Je peux échanger si la taille ne va pas ?', "quelle est votre politique d'échange ?"],
    ar: ['هل يمكن استبدال المنتج إذا لم يناسبني المقاس؟'],
    da: ['إلا ماجاتش عليا القياس نقدر نبدلها؟', 'واش كتبدلو السلعة؟'],
    dz: ['ila majatch 3liya taille n9der nbedel?', 'wach katbdlo?']
  },
  refund: {
    en: ['Can I get a refund?'], fr: ['Vous remboursez si je ne suis pas satisfaite ?'], ar: ['هل يمكن استرجاع المال؟'],
    da: ['واش كترجعو الفلوس؟'], dz: ['wach katrj3o lflouss?', 'ila ma3jbatnich trj3o lia flousi?']
  },
  free: {
    en: ['Is delivery free?'], fr: ['La livraison est gratuite ?'], ar: ['هل التوصيل مجاني؟'],
    da: ['واش التوصيل فابور؟'], dz: ['livraison fabor?', 'wach livraison gratuite?']
  },
  location: {
    en: ['Where is your shop?', 'do you have a physical store?'], fr: ['Où se trouve votre boutique ?', 'vous avez un magasin ?'],
    ar: ['أين يوجد متجركم؟'], da: ['فين كاين المحل ديالكم؟', 'فين جاين؟'], dz: ['fin kaynin?', 'fin jat lboutique dyalkom?']
  },
  hours: {
    en: ['What are your opening hours?', 'what time do you close?'], fr: ["Quels sont vos horaires d'ouverture ?", 'vous fermez à quelle heure ?'],
    ar: ['ما هي أوقات العمل؟'], da: ['فوقاش كتحلو وفوقاش كتسدو؟', 'شنو هي الأوقات ديالكم؟'], dz: ['fo9ach kat7lo?', 'imta katsdo?']
  },
  sunday: {
    en: ['Are you open on Sunday?'], fr: ['Vous êtes ouverts le dimanche ?'], ar: ['هل تفتحون يوم الأحد؟'],
    da: ['واش حالين نهار الحد؟'], dz: ['wach m7lolin nhar l7ed?', 'nhar l7ed khdamin?']
  },
  discount: {
    en: ['Do you have any discount?', 'any promo code?'], fr: ['Vous avez des promotions ?', 'il y a une remise ?'],
    ar: ['هل يوجد تخفيض؟'], da: ['واش كاين شي تخفيض؟', 'واش كاينة شي بروموسيون؟'], dz: ['kayna chi promo?', 'wach kayn chi taklis?', 'dir lia chi remise 3afak']
  },
  unknown: {
    en: ['Do you sell {x}? how much?'], fr: ['Vous vendez {x} ? combien ?'], ar: ['هل تبيعون {x}؟ كم السعر؟'],
    da: ['واش عندكم {x}؟ بشحال؟'], dz: ['3ndkom {x}? bch7al?']
  },
  order: {
    en: ['I want to order the {p}', 'I would like to buy the {p}'], fr: ['Je veux commander le {p}', "j'aimerais acheter le {p}"],
    ar: ['أريد أن أطلب {p}'], da: ['بغيت نطلب {p}', 'بغيت نشري {p}'], dz: ['bghit ncommandi {p}', 'bghit nakhod {p}', 'bghit nchri {p}']
  },
  tracking: {
    en: ['Where is my order? how can I track it?'], fr: ['Comment suivre ma commande ?'], ar: ['كيف يمكنني تتبع طلبي؟'],
    da: ['كيفاش نتبع الكوموند ديالي؟'], dz: ['fin wslat lcommande dyali?', 'kifach ntb3 commande?']
  },
  human: {
    en: ['I want to talk to a real person'], fr: ['Je veux parler à un conseiller'], ar: ['أريد التحدث مع موظف'],
    da: ['بغيت نهضر مع شي واحد من الخدامة'], dz: ['bghit nhder m3a chi wa7d machi robot', '3tini chi insan nhder m3ah']
  },
  greeting: {
    en: ['Hi', 'Hello, good evening'], fr: ['Bonjour', 'Salut, bonsoir'], ar: ['السلام عليكم', 'مرحبا'],
    da: ['سلام، لاباس؟', 'السلام عليكم خويا'], dz: ['salam', 'slm labas?', 'salam khouya']
  },
  multi: {
    en: ['How much is the {p} and how much is delivery to {c}?'], fr: ['Le {p} coûte combien et la livraison à {c} ?'],
    ar: ['كم سعر {p} وكم ثمن التوصيل إلى {c}؟'], da: ['شحال {p} وشحال التوصيل ل{c}؟'], dz: ['bch7al {p} w ch7al livraison l {c}?']
  },
  quality: {
    en: ['What material is the {p} made of?'], fr: ['Le {p} est en quelle matière ?'], ar: ['ما هي مادة صنع {p}؟'],
    da: ['شنو هو الثوب ديال {p}؟'], dz: ['{p} mn ach msawb?']
  },
  followupPhoto: {
    en: ['Send me a photo please'], fr: ['Envoyez-moi une photo svp'], ar: ['أرسل لي صورة من فضلك'],
    da: ['صيفط ليا تصويرة عافاك'], dz: ['sift lia tswira', 'photo 3afak']
  }
};

export const UNKNOWN_ITEMS: Record<Lang, string[]> = {
  en: ['iPhone 15', 'Dior perfume', 'a takchita', 'Raja jersey'], fr: ['iPhone 15', 'parfum Dior', 'takchita', 'maillot du Raja'],
  ar: ['آيفون 15', 'عطر ديور', 'تكشيطة', 'قميص الرجاء'], da: ['آيفون 15', 'ريحة ديور', 'التكشيطة', 'مايو الرجاء'], dz: ['iphone 15', 'ri7a dior', 'takchita', 'maillot raja']
};

const QUOTAS: Record<string, number> = {
  price: 110, available: 70, variant: 70, color: 0, photo: 95, followupPhoto: 40, fee: 70, time: 40, cod: 50, card: 20,
  exchange: 40, refund: 25, free: 25, location: 30, hours: 35, sunday: 20, discount: 35, unknown: 30, order: 60,
  tracking: 25, human: 25, greeting: 25, multi: 50, quality: 10
};

export function buildCorpus(): EvalCase[] {
  const out: EvalCase[] = [];
  for (const [intent, quota] of Object.entries(QUOTAS)) {
    if (!quota) continue;
    const byLang: Record<Lang, EvalCase[]> = { en: [], fr: [], ar: [], da: [], dz: [] };
    for (const lang of LANGS) {
      const templates = (T[intent] as Tpl)[lang];
      const push = (turns: string[], expect: Expectation) => byLang[lang].push({ id: '', intent, lang, turns, expect });
      for (const p of STORE.products) for (const alias of p.alias[lang]) for (const tpl of templates) {
        if (intent === 'price') push([fill(tpl, { p: alias })], { kind: 'price', product: p.key });
        if (intent === 'available') push([fill(tpl, { p: alias })], { kind: 'available', product: p.key, expected: p.stock > 0 });
        if (intent === 'photo' && p.image) push([fill(tpl, { p: alias })], { kind: 'photo', product: p.key });
        if (intent === 'followupPhoto' && p.image) push([fill(T.price[lang][0], { p: alias }), tpl], { kind: 'photo', product: p.key });
        if (intent === 'order' && p.stock > 0) push([fill(tpl, { p: alias })], { kind: 'order', product: p.key });
        if (intent === 'quality') push([fill(tpl, { p: alias })], { kind: 'quality', product: p.key });
        if (intent === 'variant') for (const variant of p.variants) {
          const sizeStock = p.variants.filter(x => x.size === variant.size).reduce((s, x) => s + x.stock, 0);
          push([fill(tpl, { p: alias, s: variant.size })], { kind: 'variant', product: p.key, expected: sizeStock > 0 });
        }
        if (intent === 'multi') for (const c of CITIES) push([fill(tpl, { p: alias, c: c.names[lang] })], { kind: 'multi', product: p.key, casa: c.casa });
      }
      for (const tpl of templates) {
        if (intent === 'fee' || intent === 'time') for (const c of CITIES) push([fill(tpl, { c: c.names[lang] })], { kind: intent, casa: c.casa } as Expectation);
        if (intent === 'unknown') for (const x of UNKNOWN_ITEMS[lang]) push([fill(tpl, { x })], { kind: 'unknown' });
        if (['cod', 'card', 'exchange', 'refund', 'free', 'location', 'hours', 'sunday', 'discount', 'tracking', 'human', 'greeting'].includes(intent)) {
          push([tpl], { kind: intent } as Expectation);
        }
      }
    }
    // Spread the quota evenly across languages; small pools are cycled
    // deterministically (each repeat runs in a fresh conversation).
    const picked: EvalCase[] = [];
    for (let i = 0; picked.length < quota; i++) {
      const lang = LANGS[i % LANGS.length];
      const pool = byLang[lang];
      if (!pool.length) continue;
      const round = Math.floor(i / LANGS.length);
      // Stride through the pool so products and paraphrases are mixed.
      const index = (round * 7 + Math.floor(round / pool.length)) % pool.length;
      picked.push({ ...pool[index], turns: [...pool[index].turns] });
    }
    out.push(...picked);
  }
  return out.map((c, i) => ({ ...c, id: `${String(i + 1).padStart(4, '0')}-${c.intent}-${c.lang}` }));
}
