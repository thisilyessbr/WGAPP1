import { SupportedLanguage } from '../faq/FaqMatcher';
import { ProductContext } from '../conversation/ConversationContext';
import { HandoffService } from '../conversation/HandoffService';

export type CommerceIntentType =
  | 'PRODUCT_SEARCH'
  | 'PRODUCT_DETAIL'
  | 'PRICE'
  | 'AVAILABILITY'
  | 'VARIANT_SELECTION'
  | 'COMPARE'
  | 'RECOMMENDATION'
  | 'UNKNOWN';

export interface ExtractedCommerceParams {
  intent: CommerceIntentType;
  sku?: string;
  productName?: string;
  category?: string;
  color?: string;
  size?: string;
  ordinalIndex?: number;
  maxPrice?: number;
  currency?: string;
  searchKeywords?: string;
  compareProductNames?: string[];
}

import { CategoryVocabulary } from '../conversation/CategoryVocabulary';

export class EcommerceIntentParser {
  public static readonly CANONICAL_CATEGORIES: Record<string, string[]> = CategoryVocabulary.getCanonicalMap();

  private static readonly COLOR_MAP: Record<string, string> = {
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
    mauve: 'Purple',
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

  private static readonly ORDINAL_MAP: Record<string, number> = {
    first: 0,
    '1st': 0,
    premier: 0,
    premiere: 0,
    'première': 0,
    'الاول': 0,
    'الأول': 0,
    'الاولى': 0,
    'الأولى': 0,
    '1': 0,
    lwel: 0,
    lowel: 0,
    louwel: 0,
    second: 1,
    '2nd': 1,
    deuxieme: 1,
    deuxième: 1,
    seconde: 1,
    'الثاني': 1,
    'التاني': 1,
    'الثانية': 1,
    'التانية': 1,
    '2': 1,
    tani: 1,
    thani: 1,
    third: 2,
    '3rd': 2,
    troisieme: 2,
    troisième: 2,
    'الثالث': 2,
    'التالت': 2,
    'الثالثة': 2,
    'التالتة': 2,
    '3': 2,
    talet: 2,
    thaleth: 2
  };

  private static readonly MODIFIER_OR_ANAPHORA_TOKENS = new Set([
    'black', 'white', 'red', 'blue', 'silver', 'noir', 'blanc', 'rouge', 'bleu', 'grey', 'gray', 'yellow', 'green',
    'كحل', 'بيض', 'حمر', 'زرق', 'أسود', 'أبيض', 'أحمر', 'أزرق', 'رمادي', 'خضر', 'صفر', 'الكحل', 'الأسود', 'فالأسود', 'بالأسود', 'فالكحل', 'بالكحل',
    'size', 'taille', 'pointure', 'قياس', 'نمرة', 'the', 'le', 'la', 'les', 'one', 'in', 'en', 'f', 'is', 'it', 'its', 'now', 'currently', 'and', 'et',
    '40', '41', '42', '43', '44', '45', '46', '47', '48', 's', 'm', 'l', 'xl', 'xxl',
    'و', 'في', 'ديال', 'ديالو', 'ديالها', 'واش', 'واش كاين', 'كاين', 'متوفر', 'كاينين', 'شنو', 'وشنو', 'هاد', 'هذا', 'هدا', 'هادي', 'هدي', 'هادو', 'هادوك', 'هادشي', 'عليه', 'عليها', 'منو', 'منها',
    'دابا', 'الان', 'الآن', 'المادة', 'المميزات', 'ميزات', 'مميزات', 'خصائص', 'مواصفات', 'تفاصيل', 'معلومات', 'كثر', 'أكثر', 'الأول', 'الاول', 'الأولى', 'الاولى', 'الثاني', 'التاني', 'الثانية', 'التانية', 'الثالث', 'التالت', 'الثالثة', 'التالتة', 'ثمن', 'الثمن', 'سعر', 'السعر',
    'had', 'hada', 'hadi', 'hadchi', 'dyalo', 'dyalha', '3lih', '3liha', 'daba', 'kayn', 'dispo', 'details', 'lwel', 'lowel', 'tani', 'talet', 'taman',
    'chi', 'loun', 'akhor', 'khor', 'autre', 'couleur', 'colors', 'color', 'لون', 'آخر', 'اخر', 'ثاني', '3la', 'sur', 'about',
    'شحال', 'وشحال', 'بشحال', 'وبشحال', 'كم', 'كان', 'سعر', 'وسعر', 'وريني', 'وروني', 'عطيني', 'عطوني', 'شوف',
    'عندكم', 'واش عندكم', 'عندك', 'واش عندك', 'كتبيعو', 'واش كتبيعو', 'واش متوفرين', 'هل عندكم',
    '3ndkom', '3ndkoum', '3ndkm', '3ndek', 'wach 3ndkom', 'wash 3ndkom', 'wash', 'wach',
    'have', 'avez', 'vous',
    'كيسوى', 'كاتسوى', 'كتسوى', 'يسوى', 'تسوى', 'كيسوا', 'يسوا', 'تسوا', 'كيساوي', 'يساوي', 'تساوي', 'كيعمل', 'يعمل', 'تعمل', 'يكلف', 'تكلف', 'ثمنه', 'سعرها', 'سعره', 'ثمنها', 'كيدير', 'كادير', 'كتدير',
    'kayswa', 'katsswa', 'katswa', 'tswa', 'yswa', 'kaysawi', 'ysawi', 'tsawi', 'kay3mel', 'kadir', 'kaydir',
    'worth', 'costs', 'cost', 'price', 'priced', 'product', 'products', 'item', 'items', 'this', 'that', 'it', 'them',
    'coute', 'coûte', 'coutent', 'coûtent', 'vaut', 'valent', 'valoir', 'produit', 'produits', 'article', 'articles', 'ce', 'cet', 'cette', 'ces', 'ca', 'ça',
    'منتج', 'المنتج', 'منتوج', 'المنتوج', 'منتجات', 'المنتجات', 'منتوجات', 'المنتوجات', 'سلعة', 'السلعة', 'حاجة', 'الحاجة', 'موديل', 'الموديل', 'بياسة', 'البياسة', 'قطعة', 'القطعة',
    'ديالي', 'طلبي', 'الطلب', 'طلب', 'فين', 'وصل', 'طريق', 'مدينة', 'مدن', 'كازا', 'الرباط', 'مراكش', 'طنجة', 'فاس', 'المغرب', 'مغرب', 'لمغرب', 'بالمغرب', 'فالمغرب', 'للمغرب',
    'rabat', 'casa', 'marrakech', 'tanger', 'fes', 'morocco', 'maroc', 'فرع', 'فروع', 'محل', 'محلات', 'كندا', 'canada', 'boutique', 'magasin', 'branch',
    'ها', 'ه', 'هاذي', 'هذي', 'هادو', 'هادوك', 'one', 'them', 'him', 'her', 'ceci', 'cela', 'lui', 'ha', 'm3aha', 'm3ah', 'm3ahom', 'معاها', 'معاه', 'معاهم', 'شي', 'shi', 'chi',
    'شكون', 'وشكون', 'chkon', 'chkoun', 'qui', 'who', 'which', 'lequel', 'laquelle', 'أرخص', 'ارخص', 'أغلى', 'اغلى', 'رخيص', 'غالي', 'rkhis', 'arkhas', 'ghali', 'agla', 'cheaper', 'cheapest', 'expensive', 'plus cher', 'moins cher', 'le moins cher', 'le plus cher'
  ]);

  /**
   * Identifies generic category mention from user text and normalizes to canonical category string.
   */
  public static extractCategory(text: string): string | undefined {
    return CategoryVocabulary.matchCategory(text);
  }

  public static isCategoryReference(token: string): boolean {
    return CategoryVocabulary.isCategoryToken(token);
  }

  public static isNonProductReference(name: string): boolean {
    if (!name || !name.trim()) return true;
    const tokens = name.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').split(/\s+/).filter(Boolean);
    const SIZES = new Set(['xs', 's', 'm', 'l', 'xl', 'xxl', '35', '36', '37', '38', '39', '40', '41', '42', '43', '44', '45', '46', '47', '48']);
    return tokens.length === 0 || tokens.every(t => {
      if (this.MODIFIER_OR_ANAPHORA_TOKENS.has(t)) return true;
      if (SIZES.has(t)) return true;
      if (this.isCategoryReference(t)) return true;
      if (t.startsWith('و') && t.length > 2 && this.MODIFIER_OR_ANAPHORA_TOKENS.has(t.slice(1))) return true;
      if (t.startsWith('ال') && t.length > 3 && this.MODIFIER_OR_ANAPHORA_TOKENS.has(t.slice(2))) return true;
      if (t.startsWith('ل') && t.length > 2 && this.MODIFIER_OR_ANAPHORA_TOKENS.has(t.slice(1))) return true;
      if (t.startsWith('فـ') && t.length > 2 && (this.MODIFIER_OR_ANAPHORA_TOKENS.has(t.slice(2)) || SIZES.has(t.slice(2)))) return true;
      if (t.startsWith('ف') && t.length > 1 && (this.MODIFIER_OR_ANAPHORA_TOKENS.has(t.slice(1)) || SIZES.has(t.slice(1)))) return true;
      if (t.startsWith('بـ') && t.length > 2 && (this.MODIFIER_OR_ANAPHORA_TOKENS.has(t.slice(2)) || SIZES.has(t.slice(2)))) return true;
      if (t.startsWith('ب') && t.length > 1 && (this.MODIFIER_OR_ANAPHORA_TOKENS.has(t.slice(1)) || SIZES.has(t.slice(1)))) return true;
      if ((t.startsWith('f-') || t.startsWith('l-') || t.startsWith('d-')) && t.length > 2 && (this.MODIFIER_OR_ANAPHORA_TOKENS.has(t.slice(2)) || SIZES.has(t.slice(2)))) return true;
      return false;
    });
  }

  public static cleanProductName(raw: string): string {
    let cleaned = raw;

    // 1. Strip color words and prefixes
    for (const colorKey of Object.keys(this.COLOR_MAP)) {
      const colorRegex = new RegExp(`(?:^|\\s|[.,!?;:()،؟])(?:f-|b-|fl|f|b|l|en|in|de|du|with|مع|في|فـ|ف|بـ|ب|لـ|ل)?\\s*${colorKey}(?:$|\\s|[.,!?;:()،؟])`, 'giu');
      cleaned = cleaned.replace(colorRegex, ' ');
    }

    // 2. Strip explicit size tokens and prefixes
    const sizePrefixRegex = /(?:^|\s|[.,!?;:()،؟])(?:size|taille|قياس|نمرة|pointure|f\s+taille|en\s+taille|in\s+size|مقاس|حجم|فالمقاس|بالمقاس|فالحجم)\s*[:=]?\s*(?:4[0-8]|3[5-9]|xs|s|m|l|xl|xxl)(?:$|\s|[.,!?;:()،؟])/giu;
    cleaned = cleaned.replace(sizePrefixRegex, ' ');

    // 3. Strip standalone size letter tokens (including attached prepositions f-, f, fl, ف, فـ, ب, بـ, etc.)
    const standaloneSizeRegex = /(?:^|\s|[.,!?;:()،؟])(?:f-|fl|f|b-|b|l-|l|en|in|de|du|فـ|ف|بـ|ب|لـ|ل)?\s*(?:4[0-8]|3[5-9]|xs|s|m|l|xl|xxl)(?:$|\s|[.,!?;:()،؟])/giu;
    cleaned = cleaned.replace(standaloneSizeRegex, ' ');

    // 4. Strip availability / question patterns
    cleaned = cleaned
      .replace(/(?:^|\s|[.,!?;:()،؟])(?:واش\s+عندكم|عندكم|واش\s+عندك|عندك|واش\s+كاينين|واش\s+كاين|واش\s+متوفر|واش\s+متوفرين|هل\s+متوفر|هل\s+عندكم|كتبيعو|واش\s+كتبيعو|avez-vous|avez\s+vous|vous\s+avez|do\s+you\s+have|have\s+you|3ndkom|3ndkoum|3ndkm|3ndek|wach\s+3ndkom|wash\s+3ndkom|wach\s+kayn|wash\s+kayn|is\s+it\s+available|is\s+available|in\s+stock|disponible|dispo)(?:$|\s|[.,!?;:()،؟])/giu, ' ');

    // 5. Strip leftover trailing/leading prepositions, price markers, or punctuation
    cleaned = cleaned
      .replace(/^(?:bghit|bghina|بغيت|أريد|اريد|je veux|i want|i need|montre-moi|show me|وريني|عطيني|شحال|وشحال|بشحال|ch7al|chhal|taman|ثمن|سعر)\s+/iu, '')
      .replace(/(?:^|\s)(?:f|b|fl|en|in|de|du|with|مع|في|فـ|ف|بـ|ب|لـ|ل|ديال|dyal|dial|شحال|وشحال|بشحال|ثمن|سعر|ch7al|taman)\s*$/giu, '')
      .replace(/^[?؟,،.!;:()[\]{}'"]+|[?؟,،.!;:()[\]{}'"]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    return cleaned;
  }

  static parse(
    text: string,
    productContext?: ProductContext | null,
    lang: SupportedLanguage = 'en'
  ): ExtractedCommerceParams {
    const trimmed = text.trim();
    const lower = trimmed.toLowerCase();

    if (HandoffService.isHandoffRequested(trimmed)) {
      return { intent: 'UNKNOWN' };
    }

    // 0. Extract Category
    const category = this.extractCategory(trimmed);

    // 1. Ordinal index
    let ordinalIndex: number | undefined;
    for (const [key, idx] of Object.entries(this.ORDINAL_MAP)) {
      const regex = new RegExp(`(?:^|\\s|[.,!?;:()،؟])(?:l-|d-|f-|ال|فال|بال|ف|ب)?${key}(?:$|\\s|[.,!?;:()،؟])`, 'iu');
      if (regex.test(lower)) {
        ordinalIndex = idx;
        break;
      }
    }

    // 2. Color extraction
    let color: string | undefined;
    for (const [key, val] of Object.entries(this.COLOR_MAP)) {
      const regex = new RegExp(`(?:^|\\s|[.,!?;:()،؟])(?:f-|b-|fl|f|b|l|en|in|de|du|with|مع|في|فـ|ف|بـ|ب|لـ|ل)?\\s*${key}(?:$|\\s|[.,!?;:()،؟])`, 'iu');
      if (regex.test(lower)) {
        color = val;
        break;
      }
    }

    // 3. Size extraction
    let size: string | undefined;
    const explicitSizePrefixRegex = /(?:^|\s|[.,!?;:()،؟])(?:size|taille|قياس|نمرة|pointure|f\s+taille|en\s+taille|in\s+size|مقاس|حجم|فالمقاس|بالمقاس|فالحجم|طاي)\s*[:=]?\s*(4[0-8]|3[5-9]|xs|s|m|l|xl|xxl|2xl|3xl)(?:$|\s|[.,!?;:()،؟])/iu;
    const procliticSizeRegex = /(?:^|\s|[.,!?;:()،؟])(?:f-|fl|f\s+|en\s+|in\s+|فـ|ف\s+|بـ|ب\s+|لـ|ل\s+)(4[0-8]|3[5-9]|xs|s|m|l|xl|xxl|2xl|3xl)(?:$|\s|[.,!?;:()،؟])/iu;
    const suffixAvailabilityRegex = /(?:^|\s|[.,!?;:()،؟])(4[0-8]|3[5-9]|xs|s|m|l|xl|xxl|2xl|3xl)\s*(?:واش\s+)?(?:kayn|kayna|dispo|disponible|available|in\s+stock|متوفر|متوفرة|كاين|كاينة|\?|؟)(?:$|\s|[.,!?;:()،؟])/iu;
    const colorPrecedingSizeRegex = /(?:^|\s|[.,!?;:()،؟])(?:black|white|red|blue|noir|blanc|rouge|bleu|كحل|بيض|حمر|زرق|أسود|أبيض|أحمر|أزرق|فالأسود|بالأسود|فالكحل|بالكحل)\s+(4[0-8]|3[5-9]|xs|s|m|l|xl|xxl|2xl|3xl)(?:$|\s|[.,!?;:()،؟])/iu;
    const multiCharOrNumericRegex = /(?:^|\s|[.,!?;:()،؟])(4[0-8]|3[5-9]|xs|xl|xxl|2xl|3xl)(?:$|\s|[.,!?;:()،؟])/iu;
    const shortTurnIsolatedRegex = /^(?:(?:size|taille|قياس|f|en|in|فـ|ف)\s+)?(4[0-8]|3[5-9]|xs|s|m|l|xl|xxl|2xl|3xl)[.?!؟]*$/iu;

    const prefixMatch = trimmed.match(explicitSizePrefixRegex);
    const procliticMatch = trimmed.match(procliticSizeRegex);
    const suffixMatch = trimmed.match(suffixAvailabilityRegex);
    const colorPrecedingMatch = trimmed.match(colorPrecedingSizeRegex);
    const shortTurnMatch = trimmed.trim().match(shortTurnIsolatedRegex);
    const multiCharMatch = trimmed.match(multiCharOrNumericRegex);

    if (prefixMatch && prefixMatch[1]) {
      size = prefixMatch[1].toUpperCase();
    } else if (procliticMatch && procliticMatch[1]) {
      size = procliticMatch[1].toUpperCase();
    } else if (suffixMatch && suffixMatch[1]) {
      size = suffixMatch[1].toUpperCase();
    } else if (colorPrecedingMatch && colorPrecedingMatch[1]) {
      size = colorPrecedingMatch[1].toUpperCase();
    } else if (shortTurnMatch && shortTurnMatch[1]) {
      size = shortTurnMatch[1].toUpperCase();
    } else if (multiCharMatch && multiCharMatch[1]) {
      size = multiCharMatch[1].toUpperCase();
    }

    // 4. SKU extraction
    let sku: string | undefined;
    const skuMatch = trimmed.match(/\b([A-Z0-9]{3,}-[A-Z0-9-]{3,})\b/i);
    if (skuMatch) {
      sku = skuMatch[1].toUpperCase();
    }

    // 5. Max Price / Budget extraction
    let maxPrice: number | undefined;
    const priceFilterMatch = lower.match(/(?:under|less\s+than|below|moins\s+de|max|اقل\s+من|أقل\s+من|ما\s+يفوتش|قل\s+من|b\s*9el\s*mn|b\s*qel\s*mn|9el\s*mn|b\s*a9al\s*mn|ta7t\s*mn)\s*(\d+(?:\.\d+)?)/iu);
    if (priceFilterMatch) {
      maxPrice = parseFloat(priceFilterMatch[1]);
    }

    const KNOWLEDGE_POLICY_TERMS = /(?:shipping|delivery|deliver|deliveries|delivered|livraison|livrer|expédition|envoi|retour|retours|retourner|remboursement|rembourser|remboursé|rendre|reprise|échange|échanges|échanger|echange|echanger|exchange|exchanges|exchanging|exchanged|refund|refunds|refunding|refunded|send\s+back|money\s+back|warranty|guarantee|garantie|garantir|care|wash|washing|how\s+to\s+wash|care\s+instructions|entretien|lavage|laver|comment\s+laver|nettoyage|guide|hours|opening\s+hours|business\s+hours|horaires|heures\s+d['’]ouverture|politique|suivi|tracking|suivre|suis\s+ma\s+commande|track|track\s+order|order\s+status|where\s+is\s+my\s+order|où\s+est\s+ma\s+commande|ou\s+est\s+ma\s+commande|nghsel|nghslo|nghselha|ghsil|lghsil|tghsel|tasbin|nsben|nsbno|nrje3|nrje3o|nrje3ha|rje3|rje3o|rje3ha|nbdel|nbdelo|nbdelha|bdel|bdelo|bdelha|tawsil|tawseel|twsil|ywsl|twsl|kiwsl|kitwsl|ywsal|twsal|fin\s+wsel|fin\s+wsl|payment|paiement|payer|cash\s+on\s+delivery|cod|daman|ldaman|khalas|l5las|n5les|daf3|dafa3|frou3|fara3|reccommand|توصيل|التوصيل|شحن|الشحن|مصاريف\s+الشحن|ثمن\s+التوصيل|سعر\s+التوصيل|وقت\s+التوصيل|مدة\s+التوصيل|توصل|توصلو|كيوصل|كتوصل|يوصل|يوصلو|توصلني|يوصلني|استرجاع|استبدال|إرجاع|ارجاع|الإرجاع|الارجاع|الاسترجاع|الاستبدال|ترجيع|الترجيع|تبديل|التبديل|نرجع|نرجعو|نرجعها|نرجعوا|نرجعوه|نرجعهم|نبدل|نبدلو|نبدلها|نبدلوه|نبدلوا|رجع|بدل|يرجع|يبدل|ترجع|تبدل|سياسة|ضمان|الضمان|غسيل|الغسيل|طريقة\s+الغسيل|كيفاش\s+نغسل|كيفية\s+الغسيل|نغسل|نغسلو|نغسلها|تصبين|التصبين|نصبن|نصبنو|نعتني|عناية|العناية|تنظيف|التنظيف|طريقة|ساعات|ساعات\s+العمل|أوقات\s+العمل|مواعيد|نتبع|تتبع|تتبع\s+الطلب|تتبع\s+طلبي|فين\s+وصل|فين\s+واصل|فين\s+كاين|دفع|الدفع|طريقة\s+الدفع|طرق\s+الدفع|الدفع\s+عند\s+الاستلام|الدفع\s+عند\s+التسليم|خلاص|الخلاص|نخلص|نخلصو|باش\s+نخلص|أجل\s+الإرجاع|أجل\s+الاسترجاع|أجل\s+التبديل|مهلة\s+الإرجاع|مهلة\s+الاسترجاع|مهلة\s+التبديل|مدة\s+الإرجاع|مدة\s+الاسترجاع|مدة\s+التبديل|شحال\s+عندي\s+من\s+الوقت|شحال\s+ديال\s+الوقت|قداش\s+بقا\s+ليا|قداش\s+عندي|combien\s+de\s+temps|délai\s+de\s+retour|delai\s+de\s+retour|délai\s+d['’]échange|delai\s+d['’]echange|how\s+long\s+do\s+i\s+have|how\s+many\s+days|return\s+window|exchange\s+window|return\s+period|exchange\s+period|chhal\s+3ndi\s+dlwa9t|9adach\s+b9a|9eddach\s+b9a|9dach\s+b9a)/iu;

    if (KNOWLEDGE_POLICY_TERMS.test(lower)) {
      let explicitProd: string | undefined;
      const priceAskProdPattern = /(?:how\s+much\s+is|what\s+is\s+the\s+price\s+of|quel\s+est\s+le\s+prix\s+d[ue]?|combien\s+coûte|combien\s+coute|شحال\s+كيسوى|شحال\s+كيدير|شحال\s+الثمن\s+ديال|كم\s+سعر|ch7al\s+kayswa|bch7al)\s+([a-zA-Z\u0600-\u06FF\s-]+?)(?:\s+(?:and|et|w|واش|how|how\s+do|كيفاش|فين|où|ou|how\s+can|\?|؟|,|$))/iu;
      const prodInPolicyPattern = /(?:بـ|ب|في|f|fl|pour|sur|3la|de|du|dial|dyal|ديال|بخصوص|حول|عن|باش\s+نرجع|باش\s+نبدل|باش\s+نغسل|to\s+return|to\s+exchange|to\s+wash|pour\s+retourner|pour\s+échanger|pour\s+laver)\s+([a-zA-Z\u0600-\u06FF\s-]+)/iu;
      const attachedProdPattern = /(?:^|\s)(?:بـ|ب|لـ|ل)([a-zA-Z\u0600-\u06FF\s-]+)/iu;
      const prodMatch = trimmed.match(priceAskProdPattern) || trimmed.match(prodInPolicyPattern) || trimmed.match(attachedProdPattern);
      if (prodMatch && prodMatch[1]) {
        let candidate = prodMatch[1].replace(/[?؟,،.!;:()[\]{}'"]/g, '').trim();
        candidate = candidate.replace(/^(?:retour|retours|refund|exchange|livraison|shipping|delivery|care|wash|guide|politique|استرجاع|استبدال|إرجاع|ارجاع|ترجيع|توصيل|شحن|غسيل|نغسل|عناية|باش\s+نرجع|باش\s+نبدل|باش\s+نغسل)\s*(?:de|du|pour|sur|3la|dial|dyal|ديال|حول)?\s*/iu, '').trim();
        if (!this.isNonProductReference(candidate) && candidate.length > 2) {
          explicitProd = this.cleanProductName(candidate);
        }
      }

      return {
        intent: 'POLICY_INQUIRY',
        sku,
        productName: explicitProd || undefined,
        category,
        color,
        size
      };
    }

    const isRecommendation = !KNOWLEDGE_POLICY_TERMS.test(lower) && (
      /(?:^|\s|[.,!?;:()،؟])(?:best|recommend|recommendation|recommander|meilleur|meilleure|conseiller|conseille-moi|conseille\s+moi|أحسن|افضل|أفضل|شنو\s+أحسن|شنو\s+افضل|احسن\s+حاجة|ahsan|lmeilleur|bghit\s+chi\s+7aja|bghit\s+chi\s+haja|بغيت\s+شي\s+حاجة|بغيت\s+شي\s+حاجه|ach\s+t-?nss7ni|ach\s+tnss7ni|شنو\s+تنصحني|which\s+(?:one\s+)?should\s+i\s+(?:choose|get|buy)|quel\s+produit\s+choisir)(?:$|\s|[.,!?;:()،؟])/iu.test(lower) ||
      /(?:which\s+(?:one|hoodie|t-shirt|jacket|product)\s+is\s+best|lequel\s+est\s+le\s+meilleur|quel\s+est\s+le\s+meilleur)/iu.test(lower) ||
      (/(?:daily\s+use|everyday|every\s+day|tous\s+les\s+jours|quotidien|استعمال\s+يومي|للاستعمال\s+اليومي|كل\s+نهار|l\s*kol\s*nhar|lkol\s*nhar|kol\s*nhar|kolnhar|winter|chita|chitta|chta|hiver|شتاء|البراد|برد|lyali|summer|été|ete|صيف|الصيف|sports?|gym|running|outdoor|رياضة|casual|sortie)\b/iu.test(lower) && /(?:bghit|بغيت|je\s+cherche|i\s+want|looking\s+for|i\s+need|montre-moi|وريني|chi\s+7aja|شي\s+حاجة)/iu.test(lower)) ||
      (maxPrice !== undefined && /(?:winter|chita|chitta|chta|hiver|شتاء|daily|kol\s*nhar|summer|été|sport|رياضة)/iu.test(lower))
    );
    if (isRecommendation) {
      return {
        intent: 'RECOMMENDATION',
        sku,
        category,
        color,
        size,
        maxPrice
      };
    }

    // 6. Compare intent
    const isCompare = !KNOWLEDGE_POLICY_TERMS.test(lower) && (
      /(?:^|\s|[.,!?;:()،؟])(?:compare|comparer|comparaison|مقارنة|قارن بين|قارن هاد|قارنها|قارنو|9aren bin|9arenha|قارن|9aren|versus|vs)(?:$|\s|[.,!?;:()،؟])/iu.test(lower) ||
      lower.includes('compare ')
    );
    if (isCompare) {
      // 6A. Compare current product with target B: "قارنها مع X" / "compare it with X" / "قارنها ليا مع شي جاكيط"
      const compareWithPattern = /(?:compare|comparer|comparaison|مقارنة|قارن بين|قارن هاد|قارنها|قارنو|9aren bin|9arenha|قارن|9aren)\s*(?:ha|it|ça|hada|hadi|hadchi|ها|ه|هذا|هادي|هدا|هدي)?\s*(?:liya|lia|m3aya|لي|ليا|معايا)?\s*(?:with|avec|مع|m3a|to|vs)\s+(.+)/iu;
      const compareWithMatch = trimmed.match(compareWithPattern);
      if (compareWithMatch && compareWithMatch[1]) {
        const targetB = this.cleanProductName(compareWithMatch[1].replace(/^(?:shi|chi|un|une|some|le|la|les|al-|ال|شي|هاد|had)\s+/iu, ''));
        return {
          intent: 'COMPARE',
          compareProductNames: targetB && !this.isNonProductReference(targetB) ? [targetB] : undefined,
          sku,
          category,
          color,
          size
        };
      }

      // 6B. Compare two explicit products: "compare X and Y" / "قارن بين X و Y"
      const compareMatch = trimmed.match(/(?:compare|comparer|comparaison|مقارنة|قارن بين|قارن هاد|قارنها|قارنو|9aren bin|9arenha|قارن|9aren)\s*(?:bin|بين)?\s*(.+?)\s+(?:and|et|و|مع|avec|vs|versus|w|wa)\s+(.+)/iu);
      if (compareMatch && compareMatch[1] && compareMatch[2]) {
        const prod1 = this.cleanProductName(compareMatch[1].replace(/^(?:bin|بين|هاد|had|ce|cet|cette|le|la|les|al-|ال)\s+/iu, ''));
        const prod2 = this.cleanProductName(compareMatch[2].replace(/^(?:bin|بين|هاد|had|ce|cet|cette|le|la|les|al-|ال)\s+/iu, ''));
        if (prod1 && !this.isNonProductReference(prod1)) {
          return {
            intent: 'COMPARE',
            compareProductNames: [prod1, prod2].filter(p => !this.isNonProductReference(p)),
            sku,
            category,
            color,
            size
          };
        }
      }

      return { intent: 'COMPARE', sku, category, color, size };
    }

    // 7. Price intent
    const isPriceKeyword = !KNOWLEDGE_POLICY_TERMS.test(lower) && (
      /(?:^|\s|[.,!?;:()،؟])(?:how much|price|cost|costs|worth|combien|prix|coûte|coute|vaut|cheaper|moins cher|le moins cher|أرخص|ارخص|شكون أرخص|شكون ارخص|رخيص|rkhis|arkhas|ثمن|والثمن|شحال|وشحال|بشحال|وبشحال|سعر|وسعر|كم سعر|كيسوى|يسوى|تسوى|كيسوا|يسوا|تسوا|كيساوي|يساوي|تساوي|كيعمل|يعمل|تعمل|bch7al|bchhal|bchal|chhal|ch7al|taman|kayswa|kaysawi)(?:$|\s|[.,!?;:()،؟])/iu.test(lower) ||
      lower.includes('كم سعر') || lower.includes('شحال ثمن') || lower.includes('وشحال الثمن') || lower.includes('quel est le prix') || lower.includes('what is the price')
    );

    if (isPriceKeyword) {
      let cleanName = trimmed;
      const startsWithPriceQuery = /^(?:and\s+|et\s+|w\s+|و\s*)?(?:ch7al|chhal|bch7al|bchhal|bchal|شحال|وشحال|بشحال|وبشحال|كم|سعر|وسعر|ثمن|والثمن|taman|how much|what was|what is|quel|combien|كيسوى|يسوى|تسوى)/iu.test(trimmed);

      if (startsWithPriceQuery) {
        const priceAfterNounPattern = /(?:ch7al\s+kan\s+taman\s+dyal|ch7al\s+taman\s+dyal|ch7al\s+kan\s+taman|ch7al\s+taman|ch7al\s+dyal|ch7al|chhal|bch7al|bchhal|bchal|quel est le prix de|quel était le prix de|combien coûte|combien coute|شحال كان ثمن ديال|شحال كان ثمن|شحال الثمن ديال|شحال ثمن ديال|شحال ثمن|شحال كان|شحال|وشحال|كم سعر|what was the price of|what is the price of|how much was|how much is)\s+([a-zA-Z\u0600-\u06FF\s-]+)/iu;
        const priceAfterNounMatch = trimmed.match(priceAfterNounPattern);
        if (priceAfterNounMatch && priceAfterNounMatch[1]) {
          const candidate = priceAfterNounMatch[1].replace(/[?؟,،.!;:()[\]{}'"]/g, '').trim();
          cleanName = !this.isNonProductReference(candidate) ? candidate : '';
        } else {
          cleanName = '';
        }
      } else {
        const switchPattern = /^(?:and\s+|et\s+|w\s+|و\s*)?(?:l\s+|le\s+|la\s+|the\s+|al-|ال)?([a-zA-Z\u0600-\u06FF\s-]+?)[,،]?\s+(?:ch7al|chhal|bch7al|bchhal|bchal|شحال|وشحال|بشحال|وبشحال|كم|سعر|وسعر|ثمن|والثمن|taman|how much|what was|what is|quel|كيسوى|يسوى|تسوى|coûte|coute|vaut)/iu;
        const switchMatch = trimmed.match(switchPattern);
        if (switchMatch && switchMatch[1] && !this.isNonProductReference(switchMatch[1])) {
          cleanName = switchMatch[1].trim();
        } else {
          cleanName = cleanName
            .replace(/^(?:and\s+|et\s+|w\s+|و\s*|\s*)?(?:what was the price of|what is the price of|what's the price of|how much is|how much was|quel était le prix de|quel est le prix de|combien coûte|combien coute|combien|كم سعر|شحال كان الثمن ديال|شحال الثمن ديال|وشحال كان الثمن ديال|وشحال الثمن ديال|شحال كان ثمن|شحال الثمن|وشحال الثمن|شحال كان|شحال|وشحال|بشحال|وبشحال|bch7al had|bch7al|bchhal|ch7al kan taman dyal|ch7al taman dyal|ch7al kan taman|ch7al taman|ch7al|chhal|taman dyal|taman)\s*/iu, '')
            .replace(/\b(?:it|that one|this one|ce modèle|cette paire|هذا|هادي|هادشي|ديالو|ديالها|دابا|الان|الآن|had|hada|hadi|hadchi|dyalo|dyalha|daba|now|kan|was)\b/giu, '')
            .replace(/[?؟,،.!;:()[\]{}'"]/g, '')
            .trim();
        }
      }

      const cleanedProductName = this.cleanProductName(cleanName);
      return {
        intent: 'PRICE',
        sku,
        productName: (!this.isNonProductReference(cleanedProductName) && cleanedProductName) ? cleanedProductName : undefined,
        category,
        color,
        size,
        ordinalIndex
      };
    }

    // 8. Color inquiry / Available colors request
    const isColorInquiry = !KNOWLEDGE_POLICY_TERMS.test(lower) && (
      /(?:^|\s|[.,!?;:()،؟])(?:chi loun akhor|loun akhor|autre couleur|autres couleurs|other color|other colors|لون آخر|ألوان أخرى|الوان اخرى|ألوان ثانية|شي لون اخر)(?:$|\s|[.,!?;:()،؟])/iu.test(lower)
    );
    if (isColorInquiry && Boolean(productContext?.selectedProductId)) {
      return {
        intent: 'PRODUCT_DETAIL',
        sku,
        productName: undefined,
        category,
        color: 'ALL',
        size,
        ordinalIndex
      };
    }

    // 9. Availability / Stock intent
    const isAvailabilityKeyword = !KNOWLEDGE_POLICY_TERMS.test(lower) && (
      /(?:^|\s|[.,!?;:()،؟])(?:in stock|available|availability|disponible|dispo|متوفر|كاين|واش كاين|واش كاينين|واش متوفر|هل متوفر|stock|kayn|dispo)(?:$|\s|[.,!?;:()،؟])/iu.test(lower) ||
      ((color !== undefined || size !== undefined) && /(?:do you have|avez-vous|avez vous|you have|have you|واش عندكم|عندكم)/iu.test(lower)) ||
      lower.includes('متوفر') || lower.includes('واش كاين')
    );

    if (isAvailabilityKeyword) {
      let cleanName = trimmed
        .replace(/^(?:is|are|do you have|est-ce que|avez-vous|واش كاين|واش متوفر|هل متوفر|واش كاينين|wach kayn|wash kayn)\s*/iu, '')
        .replace(/\b(?:in stock|available|availability|disponible|dispo|متوفر|كاين|stock|it|that one|had|hada|hadi|dyalo|dyalha|فالأسود|بالأسود|فالكحل|بالكحل|en noir|in black|f\s+[a-z0-9]+|en\s+[a-z0-9]+)\b/giu, '')
        .replace(/[?؟,،.!;:()[\]{}'"]/g, '')
        .trim();

      const cleanedProductName = this.cleanProductName(cleanName);
      const extractedProdName = (!this.isNonProductReference(cleanedProductName) && cleanedProductName) ? cleanedProductName : undefined;

      if (category && !extractedProdName && !sku) {
        return {
          intent: 'PRODUCT_SEARCH',
          category,
          color,
          size
        };
      }

      return {
        intent: 'AVAILABILITY',
        sku,
        productName: extractedProdName,
        category,
        color,
        size,
        ordinalIndex
      };
    }

    // 10. Product Detail & Contextual Product Inquiries
    const DETAIL_PATTERNS = /(?:^|\s|[.,!?;:()،؟])(?:tell me about|details for|details|what is|parle-moi de|détails sur|détails|plus d'infos|شنو هو|معلومات على|معلومات أكثر|معلومات كثر|معلومات|تفاصيل|عطيني تفاصيل|وريني تفاصيل|تفاصيل ديال|شنو المادة|المادة ديالو|المميزات ديالو|المميزات|خصائص|مواصفات|نعرف عليه كثر|نعرف كثر|3tini details|details dyal|bghit n3rf 3lih kter|n3rf 3lih kter|choufkter)(?:$|\s|[.,!?;:()،؟])/iu;

    const isDetailIntent = !KNOWLEDGE_POLICY_TERMS.test(lower) && (
      DETAIL_PATTERNS.test(lower) ||
      (ordinalIndex !== undefined && /(?:details|détails|تفاصيل|معلومات|voir|montre|وريني)/iu.test(lower)) ||
      (Boolean(productContext?.selectedProductId) && /(?:المادة|المميزات|خصائص|مواصفات|نعرف عليه|composition|matiere|caracteristiques|features|material)/iu.test(lower))
    );

    if (isDetailIntent) {
      let cleanKeywords = trimmed
        .replace(/^(?:daba\s+)?(?:بغيت نعرف عليه كثر|بغيت نعرف كثر|بغيت نعرف|نعرف عليه كثر|نعرف كثر|bghit n3rf 3lih kter|bghit n3rf kter|n3rf 3lih kter|وريني|وروني|عطيني|عطوني|شوف|3tini|werini|wrini|donne-moi|montre-moi|tell me about|donne|donnez|montre|montrez)?\s*(?:details|détails|معلومات|تفاصيل)?\s*(?:3la|sur|about|حول|de|du|le|la|les|the|al-|ال|pour)?\s*/iu, '')
        .replace(/\b(?:the|le|la|les|al-|ال|one|un|une|واحد|second|first|third|1st|2nd|3rd|deuxieme|deuxième|premier|premiere|الأول|الاول|الثاني|الثالث|lwel|lowel)\b/giu, '')
        .replace(/[?؟,،.!;:()[\]{}'"]/g, '')
        .trim();

      const cleanedProductName = this.cleanProductName(cleanKeywords);
      return {
        intent: 'PRODUCT_DETAIL',
        sku,
        productName: (!this.isNonProductReference(cleanedProductName) && cleanedProductName) ? cleanedProductName : undefined,
        category,
        color,
        size,
        ordinalIndex
      };
    }

    // 11. Variant Selection / Follow-up
    const isVariantSelection = !KNOWLEDGE_POLICY_TERMS.test(lower) && (
      (color !== undefined || size !== undefined || (ordinalIndex !== undefined && !isDetailIntent)) &&
      Boolean(productContext?.selectedProductId || productContext?.lastViewedProductIds?.length)
    );

    if (isVariantSelection) {
      return {
        intent: 'VARIANT_SELECTION',
        sku,
        category,
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

    const isSearchIntent = !KNOWLEDGE_POLICY_TERMS.test(lower) && (
      category !== undefined ||
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

      const cleanedSearchKeywords = this.cleanProductName(cleanKeywords);
      return {
        intent: 'PRODUCT_SEARCH',
        productName: (!this.isNonProductReference(cleanedSearchKeywords) && cleanedSearchKeywords) ? cleanedSearchKeywords : undefined,
        category,
        searchKeywords: cleanedSearchKeywords || undefined,
        maxPrice,
        color,
        size
      };
    }

    return { intent: 'UNKNOWN', sku, category, color, size, ordinalIndex };
  }
}
