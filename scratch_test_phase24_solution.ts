import { SupportedLanguage } from './src/domain/faq/FaqMatcher';
import { ProductContext } from './src/domain/conversation/ConversationContext';

const KNOWLEDGE_POLICY_TERMS = /(?:shipping|delivery|livraison|retour|retours|refund|exchange|warranty|guarantee|garantie|care|wash|guide|hours|politique|suivi|tracking|suivre|توصيل|شحن|استرجاع|استبدال|إرجاع|ارجاع|الإرجاع|الارجاع|ترجيع|سياسة|ضمان|غسيل|نغسل|نغسلو|نعتني|عناية|طريقة|ساعات|مواعيد|نتبع|تتبع|تتبع الطلب|فين وصل)/iu;

const COLOR_MAP: Record<string, string> = {
  black: 'Black',
  noir: 'Black',
  white: 'White',
  blanc: 'White',
  red: 'Red',
  rouge: 'Red',
  blue: 'Blue',
  bleu: 'Blue',
  green: 'Green',
  vert: 'Green',
  grey: 'Grey',
  gray: 'Grey',
  gris: 'Grey',
  yellow: 'Yellow',
  jaune: 'Yellow',
  orange: 'Orange',
  purple: 'Purple',
  violet: 'Purple',
  pink: 'Pink',
  rose: 'Pink',
  silver: 'Silver',

  'كحل': 'Black',
  'الكحل': 'Black',
  'فالكحل': 'Black',
  'بالكحل': 'Black',
  'فل كحل': 'Black',
  'أسود': 'Black',
  'الأسود': 'Black',
  'فالأسود': 'Black',
  'بالأسود': 'Black',
  'اسود': 'Black',
  'الاسود': 'Black',
  'فالاسود': 'Black',
  'بالاسود': 'Black',

  'بيض': 'White',
  'البيض': 'White',
  'فالبيض': 'White',
  'بالبيض': 'White',
  'أبيض': 'White',
  'الأبيض': 'White',
  'فالأبيض': 'White',
  'بالأبيض': 'White',
  'ابيض': 'White',
  'الابيض': 'White',
  'فالابيض': 'White',
  'بالابيض': 'White',

  'حمر': 'Red',
  'الحمر': 'Red',
  'فالحمر': 'Red',
  'بالحمر': 'Red',
  'أحمر': 'Red',
  'الأحمر': 'Red',
  'فالأحمر': 'Red',
  'بالأحمر': 'Red',

  'زرق': 'Blue',
  'الزرق': 'Blue',
  'فالزرق': 'Blue',
  'بالزرق': 'Blue',
  'أزرق': 'Blue',
  'الأزرق': 'Blue',
  'فالأزرق': 'Blue',
  'بالأزرق': 'Blue',

  'خضر': 'Green',
  'الخضر': 'Green',
  'فالخضر': 'Green',
  'بالخضر': 'Green',
  'أخضر': 'Green',
  'الأخضر': 'Green',
  'فالأخضر': 'Green',
  'بالأخضر': 'Green',

  'رمادي': 'Grey',
  'الرمادي': 'Grey',
  'فالرمادي': 'Grey',
  'بالرمادي': 'Grey',

  'صفر': 'Yellow',
  'الصفر': 'Yellow',
  'فالصفر': 'Yellow',
  'بالصفر': 'Yellow',
  'أصفر': 'Yellow',
  'الأصفر': 'Yellow',
  'فالأصفر': 'Yellow',
  'بالالأصفر': 'Yellow',

  keshel: 'Black',
  k7el: 'Black',
  lk7el: 'Black',
  lkeshel: 'Black'
};

const ORDINAL_MAP: Record<string, number> = {
  first: 0,
  '1st': 0,
  premier: 0,
  premiere: 0,
  'الاول': 0,
  'الأول': 0,
  '1': 0,
  lwel: 0,
  lowel: 0,
  louwel: 0,
  second: 1,
  '2nd': 1,
  deuxieme: 1,
  deuxième: 1,
  'الثاني': 1,
  '2': 1,
  tani: 1,
  thani: 1,
  third: 2,
  '3rd': 2,
  troisieme: 2,
  troisième: 2,
  'الثالث': 2,
  '3': 2,
  talet: 2,
  thaleth: 2
};

const MODIFIER_OR_ANAPHORA_TOKENS = new Set([
  'black', 'white', 'red', 'blue', 'silver', 'noir', 'blanc', 'rouge', 'bleu', 'grey', 'gray', 'yellow', 'green',
  'كحل', 'بيض', 'حمر', 'زرق', 'أسود', 'أبيض', 'أحمر', 'أزرق', 'رمادي', 'خضر', 'صفر', 'الكحل', 'الأسود', 'فالأسود', 'بالأسود', 'فالكحل', 'بالكحل',
  'size', 'taille', 'pointure', 'قياس', 'نمرة', 'the', 'le', 'la', 'les', 'one', 'in', 'en', 'f', 'is', 'it', 'its', 'now', 'currently', 'and', 'et',
  '40', '41', '42', '43', '44', '45', '46', '47', '48', 's', 'm', 'l', 'xl', 'xxl',
  'و', 'في', 'ديال', 'ديالو', 'ديالها', 'واش', 'واش كاين', 'كاين', 'متوفر', 'كاينين', 'شنو', 'وشنو', 'هذا', 'هادي', 'هادشي', 'عليه', 'عليها', 'منو', 'منها',
  'دابا', 'الان', 'الآن', 'المادة', 'المميزات', 'ميزات', 'مميزات', 'خصائص', 'مواصفات', 'تفاصيل', 'معلومات', 'كثر', 'أكثر', 'الأول', 'الاول', 'الثاني', 'الثالث', 'ثمن', 'الثمن', 'سعر', 'السعر',
  'had', 'hada', 'hadi', 'hadchi', 'dyalo', 'dyalha', '3lih', '3liha', 'daba', 'kayn', 'dispo', 'details', 'lwel', 'lowel', 'tani', 'talet', 'taman',
  'chi', 'loun', 'akhor', 'khor', 'autre', 'couleur', 'colors', 'color', 'لون', 'آخر', 'اخر', 'ثاني', '3la', 'sur', 'about',
  'شحال', 'وشحال', 'بشحال', 'وبشحال', 'كم', 'كان', 'سعر', 'وسعر'
]);

function extractColor(text: string): string | undefined {
  const lower = text.toLowerCase();
  for (const [key, val] of Object.entries(COLOR_MAP)) {
    const reg = new RegExp(`(?:^|\\s|[.,!?;:()،؟])${key}(?:$|\\s|[.,!?;:()،؟])`, 'iu');
    if (reg.test(lower)) {
      return val;
    }
  }
  return undefined;
}

function extractOrdinal(text: string): number | undefined {
  const lower = text.toLowerCase();
  for (const [key, idx] of Object.entries(ORDINAL_MAP)) {
    const reg = new RegExp(`(?:^|\\s|[.,!?;:()،؟])${key}(?:$|\\s|[.,!?;:()،؟])`, 'iu');
    if (reg.test(lower)) {
      return idx;
    }
  }
  return undefined;
}

function extractSize(text: string): string | undefined {
  const lower = text.toLowerCase();
  // 1. Explicit prefix: size, taille, قياس, نمرة, f, en
  const explicitMatch = lower.match(/(?:size|taille|قياس|نمرة|pointure|f|en)\s*[:=]?\s*(\b(?:4[0-8]|3[5-9]|xs|s|m|l|xl|xxl)\b)/i);
  if (explicitMatch) {
    return explicitMatch[1].toUpperCase();
  }
  // 2. Standalone or end-of-phrase sizes (e.g. "بغيت M", "و L؟", "واش كاين XL؟", "dyal XL")
  const standaloneMatch = lower.match(/(?:^|\s|[.,!?;:()،؟]|dyal|ديال|واش\s+كاين|بغيت)\s*(\b(?:4[0-8]|3[5-9]|xs|s|m|l|xl|xxl)\b)(?:$|\s|[.,!?;:()،؟])/i);
  if (standaloneMatch) {
    const candidate = standaloneMatch[1].toLowerCase();
    // Guard against article 'l' followed by an alphanumeric noun (e.g. "l hoodie", "l casablanca")
    const afterIdx = lower.indexOf(candidate) + candidate.length;
    const rest = lower.slice(afterIdx).trim();
    if (candidate === 'l' && /^[a-z\u0600-\u06FF]/i.test(rest)) {
      return undefined;
    }
    return candidate.toUpperCase();
  }
  return undefined;
}

function isNonProductReference(name: string): boolean {
  if (!name || !name.trim()) return true;
  const tokens = name.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').split(/\s+/).filter(Boolean);
  return tokens.length === 0 || tokens.every(t => {
    if (MODIFIER_OR_ANAPHORA_TOKENS.has(t)) return true;
    if (t.startsWith('و') && t.length > 2 && MODIFIER_OR_ANAPHORA_TOKENS.has(t.slice(1))) return true;
    if (t.startsWith('ال') && t.length > 3 && MODIFIER_OR_ANAPHORA_TOKENS.has(t.slice(2))) return true;
    if (t.startsWith('ل') && t.length > 2 && MODIFIER_OR_ANAPHORA_TOKENS.has(t.slice(1))) return true;
    return false;
  });
}

function parseTest(text: string, productContext?: ProductContext | null, lang: SupportedLanguage = 'en') {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  const isKnowledgePolicy = KNOWLEDGE_POLICY_TERMS.test(lower);

  // 1. SKU
  const skuMatch = trimmed.match(/\b([A-Z0-9]{3,}-[A-Z0-9_-]+)\b/i);
  const sku = skuMatch ? skuMatch[1].toUpperCase() : undefined;

  // 2. Color
  const color = extractColor(trimmed);

  // 3. Size
  const size = extractSize(trimmed);

  // 4. Ordinal
  const ordinalIndex = extractOrdinal(trimmed);

  // 5. Price filter
  let maxPrice: number | undefined;
  const priceFilterMatch = lower.match(/(?:under|less than|below|moins de|max|اقل من|أقل من|ما يفوتش)\s*(\d+(?:\.\d+)?)/i);
  if (priceFilterMatch) {
    maxPrice = parseFloat(priceFilterMatch[1]);
  }

  // 6. Compare intent
  const isCompare = /(?:^|\s)(compare|comparer|مقارنة|قارن بين)(?:$|\s)/iu.test(lower) || lower.includes('compare ');
  if (isCompare) {
    const compareMatch = trimmed.match(/(?:compare|comparer|مقارنة|قارن بين)\s+(.+?)\s+(?:and|et|و|مع)\s+(.+)/iu);
    if (compareMatch) {
      return {
        intent: 'COMPARE',
        compareProductNames: [compareMatch[1].trim(), compareMatch[2].trim()],
        sku,
        color,
        size
      };
    }
    return { intent: 'COMPARE', sku, color, size };
  }

  // 7. Price intent
  const isPriceKeyword = !isKnowledgePolicy && (
    /(?:^|\s|[.,!?;:()،؟])(?:how much|price|cost|combien|prix|ثمن|والثمن|شحال|وشحال|بشحال|وبشحال|سعر|وسعر|كم سعر|bch7al|bchal|chhal|ch7al|taman)(?:$|\s|[.,!?;:()،؟])/iu.test(lower) ||
    lower.includes('كم سعر') || lower.includes('شحال ثمن') || lower.includes('وشحال الثمن') || lower.includes('quel est le prix') || lower.includes('what is the price')
  );

  if (isPriceKeyword) {
    let cleanName = trimmed;
    const startsWithPriceQuery = /^(?:and\s+|et\s+|w\s+|و\s*)?(?:ch7al|bch7al|كم|سعر|ثمن|taman|how much|what was|what is|quel)/iu.test(trimmed);

    if (startsWithPriceQuery) {
      const priceAfterNounPattern = /(?:شحال كان ثمن ديال|شحال كان ثمن|شحال الثمن ديال|شحال ثمن ديال|شحال ثمن|شحال كان|شحال|كم سعر|what was the price of|what is the price of|how much was|how much is)\s+([a-zA-Z\u0600-\u06FF\s-]+)/iu;
      const priceAfterNounMatch = trimmed.match(priceAfterNounPattern);
      if (priceAfterNounMatch && priceAfterNounMatch[1]) {
        const candidate = priceAfterNounMatch[1].replace(/[?؟,،.!;:()[\]{}'"]/g, '').trim();
        cleanName = !isNonProductReference(candidate) ? candidate : '';
      } else {
        cleanName = '';
      }
    } else {
      const switchPattern = /^(?:and\s+|et\s+|w\s+|و\s*)?(?:l\s+|le\s+|la\s+|the\s+|al-|ال)?([a-zA-Z\u0600-\u06FF\s-]+?)[,،]?\s+(?:ch7al|bch7al|كم|سعر|ثمن|taman|how much|what was|what is|quel)/iu;
      const switchMatch = trimmed.match(switchPattern);
      if (switchMatch && switchMatch[1] && !isNonProductReference(switchMatch[1])) {
        cleanName = switchMatch[1].trim();
      } else {
        cleanName = cleanName
          .replace(/^(?:and\s+|et\s+|w\s+|و\s*|\s*)?(?:what was the price of|what is the price of|what's the price of|how much is|how much was|quel était le prix de|quel est le prix de|combien coûte|combien coute|كم سعر|شحال كان الثمن ديال|شحال الثمن ديال|وشحال كان الثمن ديال|وشحال الثمن ديال|شحال كان ثمن|شحال الثمن|وشحال الثمن|شحال كان|شحال|وشحال|بشحال|وبشحال|bch7al had|bch7al|ch7al kan taman dyal|ch7al taman dyal|ch7al kan taman|ch7al taman|ch7al|taman dyal|taman)\s*/iu, '')
          .replace(/\b(?:it|that one|this one|ce modèle|cette paire|هذا|هادي|هادشي|ديالو|ديالها|دابا|الان|الآن|had|hada|hadi|hadchi|dyalo|dyalha|daba|now|kan|was)\b/giu, '')
          .replace(/[?؟,،.!;:()[\]{}'"]/g, '')
          .trim();
      }
    }

    return {
      intent: 'PRICE',
      sku,
      productName: (!isNonProductReference(cleanName) && cleanName) ? cleanName : undefined,
      color,
      size,
      ordinalIndex
    };
  }

  // 8. Color inquiry / Available colors request
  const isColorInquiry = !isKnowledgePolicy && (
    /(?:^|\s|[.,!?;:()،؟])(?:chi loun akhor|loun akhor|autre couleur|autres couleurs|other color|other colors|لون آخر|ألوان أخرى|الوان اخرى|ألوان ثانية|شي لون اخر)(?:$|\s|[.,!?;:()،؟])/iu.test(lower)
  );
  if (isColorInquiry && Boolean(productContext?.selectedProductId)) {
    return {
      intent: 'PRODUCT_DETAIL',
      sku,
      productName: undefined,
      color: 'ALL',
      size,
      ordinalIndex
    };
  }

  // 9. Availability / Stock intent
  const isAvailabilityKeyword = !isKnowledgePolicy && (
    /(?:^|\s|[.,!?;:()،؟])(?:in stock|available|availability|disponible|dispo|متوفر|كاين|واش كاين|واش كاينين|واش متوفر|هل متوفر|stock|kayn|dispo)(?:$|\s|[.,!?;:()،؟])/iu.test(lower) ||
    lower.includes('متوفر') || lower.includes('واش كاين')
  );

  if (isAvailabilityKeyword) {
    let cleanName = trimmed
      .replace(/^(?:is|are|do you have|est-ce que|avez-vous|واش كاين|واش متوفر|هل متوفر|واش كاينين|wach kayn|wash kayn)\s*/iu, '')
      .replace(/\b(?:in stock|available|availability|disponible|dispo|متوفر|كاين|stock|it|that one|had|hada|hadi|dyalo|dyalha|فالأسود|بالأسود|فالكحل|بالكحل|en noir|in black|f\s+[a-z0-9]+|en\s+[a-z0-9]+)\b/giu, '')
      .replace(/[?؟,،.!;:()[\]{}'"]/g, '')
      .trim();

    return {
      intent: 'AVAILABILITY',
      sku,
      productName: (!isNonProductReference(cleanName) && cleanName) ? cleanName : undefined,
      color,
      size,
      ordinalIndex
    };
  }

  // 10. Product Detail & Contextual Product Inquiries
  const DETAIL_PATTERNS = /(?:^|\s|[.,!?;:()،؟])(?:tell me about|details for|details|what is|parle-moi de|détails sur|détails|plus d'infos|شنو هو|معلومات على|معلومات أكثر|معلومات كثر|معلومات|تفاصيل|عطيني تفاصيل|وريني تفاصيل|تفاصيل ديال|شنو المادة|المادة ديالو|المميزات ديالو|المميزات|خصائص|مواصفات|نعرف عليه كثر|نعرف كثر|3tini details|details dyal|bghit n3rf 3lih kter|n3rf 3lih kter|choufkter)(?:$|\s|[.,!?;:()،؟])/iu;

  const isDetailIntent = !isKnowledgePolicy && (
    DETAIL_PATTERNS.test(lower) ||
    (ordinalIndex !== undefined && /(?:details|détails|تفاصيل|معلومات|voir|montre|وريني)/iu.test(lower)) ||
    (Boolean(productContext?.selectedProductId) && /(?:المادة|المميزات|خصائص|مواصفات|نعرف عليه|composition|matiere|caracteristiques|features|material)/iu.test(lower))
  );

  if (isDetailIntent) {
    let cleanKeywords = trimmed
      .replace(/^(?:daba\s+)?(?:3tini|werini|wrini|donne-moi|montre-moi|tell me about|donne|donnez|montre|montrez)?\s*(?:details|détails|معلومات|تفاصيل)?\s*(?:3la|sur|about|حول|de|du|le|la|les|the|al-|ال|pour)?\s*/iu, '')
      .replace(/\b(?:the|le|la|les|al-|ال|one|un|une|واحد|second|first|third|1st|2nd|3rd|deuxieme|deuxième|premier|premiere|الأول|الاول|الثاني|الثالث|lwel|lowel)\b/giu, '')
      .replace(/[?؟,،.!;:()[\]{}'"]/g, '')
      .trim();

    return {
      intent: 'PRODUCT_DETAIL',
      sku,
      productName: (!isNonProductReference(cleanKeywords) && cleanKeywords) ? cleanKeywords : undefined,
      color,
      size,
      ordinalIndex
    };
  }

  // 11. Variant Selection / Follow-up
  const isVariantSelection = !isKnowledgePolicy && (
    (color !== undefined || size !== undefined || (ordinalIndex !== undefined && !isDetailIntent)) &&
    Boolean(productContext?.selectedProductId || productContext?.lastViewedProductIds?.length)
  );

  if (isVariantSelection) {
    return {
      intent: 'VARIANT_SELECTION',
      sku,
      color,
      size,
      ordinalIndex
    };
  }

  // 12. Product Search / Catalog Inquiries
  const DISCOVERY_PATTERNS = [
    /(?:^|\s|[.,!?;:()،؟])(show me|find|search|do you have|do you sell|looking for|i want|i need|i'm looking for|i am looking for|what products|any products|browse|catalog|catalogue)(?:$|\s|[.,!?;:()،؟])/iu,
    /(?:^|\s|[.,!?;:()،؟])(montre-moi|montrez-moi|chercher|je cherche|avez-vous|vous avez|vendez-vous|quels sont les produits|catalogue|voir les)(?:$|\s|[.,!?;:()،؟])/iu,
    /(?:^|\s|[.,!?;:()،؟])(بغيت|نقلب على|كنقلب على|أريد|اريد|ابحث عن|أبحث عن|وريني|وروني|شوف|عندكم|واش عندكم|واش كاين|واش كاينين|كاين شي|كاينين شي|المنتجات|المنتوجات|السلعة|كتبيعو|كاينين)(?:$|\s|[.,!?;:()،؟])/iu,
    /(?:^|\s|[.,!?;:()،؟])(bghit|bghina|kayn chi|kaynin chi|3ndkom|3ndkoum|3ndkm|andkom|andkoum|wach 3ndkom|wash 3ndkom|wrini|werini|chof|kan9leb|kanqleb|katbi3o)(?:$|\s|[.,!?;:()،؟])/iu,
    /(?:^|\s|[.,!?;:()،؟])(products|produits|منتجات|منتوجات|سلعة|حوايج|hoodie|hoodies|t-shirt|tshirt|t-shirts|tshirts|jacket|jackets|shoes|sweat|sweats|veste|vestes|tricot|tricots|capuchon|pull|هودي|هوديات|تيشورت|تيشورتات|تيشيرت|تيشيرتات|جاكيت|جاكيط|جاكيتات|أحذية|احذية|قميص|قمصان|collection|كوليكسيون)(?:$|\s|[.,!?;:()،؟])/iu
  ];

  const isSearchIntent = !isKnowledgePolicy && (
    DISCOVERY_PATTERNS.some(pat => pat.test(lower)) ||
    maxPrice !== undefined
  );

  if (isSearchIntent) {
    const cleanKeywords = trimmed
      .replace(/^(?:salam|salut|bonjour|hello|hi|hey|ahlan|السلام عليكم|سلام|أهلا|اهلا|صباح الخير|مساء الخير)[،,\s]+/iu, '')
      .replace(/^(?:show me|find|search for|do you have|do you sell|looking for|i want|i need|i'm looking for|chercher|je cherche|montre-moi|montrez-moi|avez-vous|وريني|وروني|واش عندكم|عندكم|بغيت شي|بغيت|أريد|اريد|ابحث عن|bghit chi|bghit|3ndkom chi|3ndkom|andkom chi|andkom|wach 3ndkom|wash 3ndkom|wrini|werini|kayn chi|kaynin chi)\s+/iu, '')
      .replace(/(?:under|less than|moins de|اقل من|أقل من|ما يفوتش)\s*\d+(?:\.\d+)?(?:\s*(?:mad|usd|eur|درهم))?/giu, '')
      .replace(/[?؟,،.!;:()[\]{}'"]/g, '')
      .trim();

    return {
      intent: 'PRODUCT_SEARCH',
      searchKeywords: cleanKeywords || undefined,
      maxPrice,
      color,
      size
    };
  }

  return { intent: 'UNKNOWN', sku, color, size, ordinalIndex };
}

console.log("TESTING PERFECTED PHASE 24 INTENT PARSER LOGIC:");

const sampleProductContext: ProductContext = {
  selectedProductId: 'prod-jacket-1',
  lastViewedProductIds: ['prod-jacket-1', 'prod-hoodie-2']
};

const testCases = [
  { text: "wach kayn chi loun akhor?", ctx: sampleProductContext },
  { text: "daba 3tini details 3la Cyber Spirit Jacket", ctx: sampleProductContext },
  { text: "wach kayn f L?", ctx: sampleProductContext },
  { text: "w l hoodie, ch7al kan taman dyalo?", ctx: sampleProductContext },
  { text: "شنو هي سياسة الإرجاع ديال Cyber Spirit Jacket؟", ctx: sampleProductContext },
  { text: "كيفاش نعتني بتيشيرت Neon Ronin؟", ctx: sampleProductContext },
  { text: "طلبت من عندكم، كيفاش غادي نتبع الطلب ديالي؟", ctx: sampleProductContext },
  { text: "واش عندكم Attack on Titan collection جديدة الأسبوع الجاي؟", ctx: sampleProductContext },
  { text: "شحال كان ثمن الهودي؟", ctx: sampleProductContext }
];

for (const tc of testCases) {
  const p = parseTest(tc.text, tc.ctx);
  console.log(`\nInput: "${tc.text}"`);
  console.log(`  -> Intent: ${p.intent}, productName: "${p.productName || 'undefined'}", color: ${p.color || 'undefined'}, size: ${p.size || 'undefined'}`);
}
