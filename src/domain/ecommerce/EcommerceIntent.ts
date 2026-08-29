import { SupportedLanguage } from '../faq/FaqMatcher';
import { ProductContext } from '../conversation/ConversationContext';
import { HandoffService } from '../conversation/HandoffService';

export type AttributeFamily =
  | 'MATERIAL'
  | 'PERFORMANCE'
  | 'FEATURE'
  | 'FIT'
  | 'DIMENSIONS'
  | 'WEIGHT'
  | 'CARE'
  | string;

export type CommerceIntentType =
  | 'BUY_INTENT'
  | 'PRODUCT_SEARCH'
  | 'PRODUCT_DETAIL'
  | 'ATTRIBUTE_QUERY'
  | 'PRICE'
  | 'AVAILABILITY'
  | 'VARIANT_SELECTION'
  | 'COMPARE'
  | 'RECOMMENDATION'
  | 'UNKNOWN';

export interface ExtractedCommerceParams {
  intent: CommerceIntentType;
  attributeFamily?: AttributeFamily;
  attributeKeywords?: string;
  attributeName?: string;
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
  requestedMediaType?: 'image' | 'video';
}

export class EcommerceIntentParser {
  public static readonly CANONICAL_CATEGORIES: Record<string, string[]> = {
    'T-Shirts': ['t-shirt', 't-shirts', 'tshirt', 'tshirts', 'tee', 'tees', 'shirt', 'shirts', 't-shirten', 'تيشورت', 'تيشورتات', 'تيشيرت', 'تيشيرتات', 'قميص', 'قمصان'],
    'Hoodies': ['hoodie', 'hoodies', 'sweat', 'sweats', 'sweatshirt', 'sweatshirts', 'pull', 'capuchon', 'هودي', 'هوديات', 'سويت', 'سويتشرت', 'كابوشون'],
    'Jackets': ['jacket', 'jackets', 'veste', 'vestes', 'blouson', 'blousons', 'manteau', 'manteaux', 'جاكيط', 'جاكيطات', 'جاكيت', 'جاكيتات', 'سترة', 'سترات'],
    'Shoes': ['shoes', 'shoe', 'sneakers', 'sneaker', 'chaussures', 'chaussure', 'baskets', 'basket', 'حذاء', 'أحذية', 'احذية', 'سباط', 'صباط', 'سبابط', 'صبابط', 'سبرديلة', 'صبرديلة', 'سبراديل', 'صنادل', 'صندالة'],
    'Pants': ['pants', 'pant', 'jeans', 'jean', 'trousers', 'pantalon', 'pantalons', 'jogging', 'سروال', 'سراول', 'بنطلون', 'بناطيل', 'جينز'],
    'Accessories': ['accessories', 'accessory', 'accessoires', 'accessoire', 'إكسسوارات', 'اكسسوارات', 'إكسسوار', 'اكسسوار', 'حزام', 'أحزمة', 'كاب', 'طاقية', 'كاسكيط', 'casquette', 'chapeau', 'bonnet', 'sac', 'sacoche', 'محفظة', 'صاك']
  };

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

  public static readonly FUNCTIONAL_STATE_TOKENS = new Set([
    // Arabic state & availability verbs/adjectives/particles
    'كاين', 'كاينة', 'كاينا', 'كاينه', 'كاينين', 'كاينينش', 'مكاينش', 'ماكاينش', 'ما كاينش', 'ماكاينينش', 'ما كاينينش',
    'متوفر', 'متوفرة', 'متوفره', 'متوفرين', 'متوفرات', 'توفير', 'يتوفر', 'تتوفر',
    'موجود', 'موجودة', 'موجوده', 'موجودين', 'يوجد', 'توجد',
    'باقي', 'مازال', 'ما زال', 'مزال', 'عاد', 'دابا', 'الان', 'الآن',
    'مخزون', 'المخزون', 'ستوك', 'الستوك', 'محل', 'المحل', 'متجر', 'المتجر',
    'عندكم', 'عندك', 'كتبيعو', 'تبيعو', 'تبيعوا', 'كتوفرو', 'متاح', 'متاحة', 'متاحين',
    // Arabizi
    'kayn', 'kayna', 'kaynin', 'makaynch', 'makayninch', 'dispo', 'disponible', 'disponibles', 'dispos', 'stock',
    'mowjoud', 'mowjouda', 'ba9i', 'baki', 'mazal', 'mzal', '3ndkom', '3ndkoum', '3ndkm', '3ndek', 'katbi3o',
    // French
    'disponible', 'disponibles', 'dispo', 'dispos', 'stock', 'avez-vous', 'vous avez', 'vendez-vous', 'existe', 'existent',
    // English
    'available', 'availability', 'stock', 'have', 'sell', 'exist', 'exists'
  ]);

  public static readonly FUNCTIONAL_PRONOUN_ANAPHORA_TOKENS = new Set([
    // Arabic pronouns & demonstratives
    'هاد', 'هذا', 'هدا', 'هادي', 'هدي', 'هادو', 'هادوك', 'هادشي', 'هذه', 'ذلك', 'تلك', 'هو', 'هي', 'هم', 'هن',
    'ديالو', 'ديالها', 'ديالهم', 'ديالي', 'ديالنا', 'ديالكم',
    'منو', 'منها', 'منهم', 'مني', 'منا', 'منكم',
    'عليه', 'عليها', 'عليهم', 'عليا', 'علينا', 'عليكم',
    'فيه', 'فيها', 'فيهم', 'فيا', 'فينا', 'فيكم',
    'معاه', 'معاها', 'معاهم', 'معايا', 'معانا', 'معاكم',
    'واحد', 'وحدة', 'ديك', 'داك', 'هادوك', 'هاذي', 'هذي',
    // Arabizi
    'hada', 'hadi', 'had', 'hado', 'hadok', 'hadchi', 'dyalo', 'dyalha', 'dyalhom', 'dyali', 'dyalna', 'dyalkom',
    '3lih', '3liha', '3lihom', 'mno', 'mnha', 'mnkom', 'fih', 'fiha', 'fihom', 'm3ah', 'm3aha', 'm3ahom',
    // French
    'ce', 'cet', 'cette', 'ces', 'ceci', 'cela', 'ça', 'ca', 'il', 'elle', 'ils', 'elles', 'le', 'la', 'les', 'lui', 'leur', 'en', 'y', 'moi', 'toi', 'nous', 'vous', 'eux', 'celui-ci', 'celui-la', 'celui-là', 'celle-ci', 'celle-la', 'celle-là', 'celui', 'celle', 'ceux', 'celles',
    // English
    'this', 'that', 'these', 'those', 'it', 'its', 'them', 'they', 'one', 'ones'
  ]);

  public static readonly FUNCTIONAL_QUESTION_TOKENS = new Set([
    // Arabic question particles
    'واش', 'هل', 'أ', 'شنو', 'وشنو', 'شكون', 'وشكون', 'فين', 'وفين', 'شحال', 'وشحال', 'بشحال', 'وبشحال', 'كم', 'كان', 'سعر', 'وسعر', 'ثمن', 'والثمن',
    'كيسوى', 'كاتسوى', 'كتسوى', 'يسوى', 'تسوى', 'كيسوا', 'يسوا', 'تسوا', 'كيساوي', 'يساوي', 'تساوي', 'كيعمل', 'يعمل', 'تعمل', 'يكلف', 'تكلف', 'ثمنه', 'سعرها', 'سعره', 'ثمنها', 'كيدير', 'كادير', 'كتدير',
    'كيفاش', 'علاش', 'وقتاش', 'فوقاش',
    // Arabizi
    'wach', 'wash', 'ach', 'chnou', 'chnu', 'chkon', 'chkoun', 'fin', 'ch7al', 'chhal', 'bch7al', 'taman', 'kayswa', 'katswa', 'kaysawi', 'kaydir', 'kadir',
    // French
    'qui', 'who', 'which', 'lequel', 'laquelle', 'comment', 'combien', 'coute', 'coûte', 'coutent', 'coûtent', 'vaut', 'valent', 'est', 'sont', 'avez', 'avez-vous', 'est-ce', 'est-elle', 'est-il',
    // English
    'where', 'what', 'how', 'which', 'who', 'costs', 'cost', 'price', 'priced', 'worth', 'is', 'are', 'do', 'does'
  ]);

  public static readonly FUNCTIONAL_INTENT_VERBS = new Set([
    'بغيت', 'بغينا', 'أريد', 'اريد', 'نقلب', 'كنقلب', 'نبحث', 'كنبحث', 'وريني', 'وروني', 'عطيني', 'عطوني', 'شوف',
    'نشري', 'نشريه', 'نشريها', 'شراء', 'شراءه', 'شراءها', 'أشتري', 'اشتري', 'أشتريه', 'اشتريه', 'أشتريها', 'اشتريها', 'نشتري', 'اشري',
    'نطلب', 'نطلبو', 'نطلبها', 'أطلب', 'اطلب', 'أطلبه', 'اطلبه', 'أطلبها', 'اطلبها', 'نكوموندي', 'نكموندي', 'طلب', 'الطلب', 'الشراء',
    'ناخد', 'ناخذ', 'ناخدو', 'ناخذو', 'باغي', 'باغية', 'سأشتري', 'ساشتري', 'سوف أشتري', 'سوف اشتري', 'سأطلب', 'ساطلب', 'سوف أطلب', 'سوف اطلب',
    'bghit', 'bghina', 'kan9leb', 'kanqleb', 'wrini', 'werini', 'chof', '3tini', 'atoni',
    'nchri', 'nechri', 'chri', 'nshri', 'nchrih', 'nchriha', 'nechrih', 'nshrih',
    'ncommandi', 'ncommander', 'commandi', 'nkomandi', 'nkomander', 'komandi', 'ncommandih',
    'nkhod', 'nakhod', 'khod', 'baghi', 'baghya',
    'je veux', 'cherche', 'cherche-moi', 'montre-moi', 'donne-moi', 'voir', 'montre', 'donne', 'parle-moi', 'dis-moi',
    'acheter', 'achetez', 'commander', 'commande', 'prendre',
    'want', 'need', 'looking', 'show', 'give', 'find',
    'buy', 'buying', 'purchase', 'purchasing', 'order', 'ordering', 'checkout', 'take', 'get'
  ]);

  private static readonly MODIFIER_OR_ANAPHORA_TOKENS = new Set([
    'black', 'white', 'red', 'blue', 'silver', 'noir', 'blanc', 'rouge', 'bleu', 'grey', 'gray', 'yellow', 'green',
    'كحل', 'بيض', 'حمر', 'زرق', 'أسود', 'أبيض', 'أحمر', 'أزرق', 'رمادي', 'خضر', 'صفر', 'الكحل', 'الأسود', 'فالأسود', 'بالأسود', 'فالكحل', 'بالكحل',
    'size', 'taille', 'pointure', 'قياس', 'نمرة', 'the', 'le', 'la', 'les', 'one', 'in', 'en', 'f', 'is', 'it', 'its', 'now', 'currently', 'and', 'et',
    'video', 'videos', 'vidéo', 'vidéos', 'lvideo', 'l-video', 'fvideo', 'f-video', 'photo', 'photos', 'image', 'images', 'pic', 'pics', 'picture', 'pictures', 'clip', 'clips',
    'tsawer', 'tswira', 'tsawir', 'tsawar',
    'فيديو', 'فيديوهات', 'فديو', 'مقطع', 'مقاطع', 'صور', 'صورة', 'تصوير', 'تصاور', 'تصويرة',
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
 
  private static escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Identifies category mention from user text:
   * 1. Exact / Plural / Singular match against dynamic catalog categories
   * 2. Configured custom category aliases (from BusinessConfig)
   * 3. Legacy compatibility fallback (CANONICAL_CATEGORIES)
   */
  public static extractCategory(
    text: string,
    catalogCategories?: string[] | null,
    customCategoryAliases?: Record<string, string[]> | null
  ): string | undefined {
    if (!text || !text.trim()) return undefined;
    const lower = text.toLowerCase().trim();

    // 1. Exact / Plural / Singular match against dynamic catalog categories
    if (catalogCategories && catalogCategories.length > 0) {
      for (const cat of catalogCategories) {
        if (!cat) continue;
        const catLower = cat.toLowerCase().trim();
        const catSingular = catLower.endsWith('s') && catLower.length > 3 ? catLower.slice(0, -1) : catLower;
        const catPlural = catLower.endsWith('s') ? catLower : `${catLower}s`;
        const forms = Array.from(new Set([catLower, catSingular, catPlural]));

        for (const form of forms) {
          const regex = new RegExp(`(?:^|\\s|[.,!?;:()،؟])(?:f-|l-|d-|al-|ال|فال|بال|ف|ب|le|la|les|the)?${this.escapeRegex(form)}(?:$|\\s|[.,!?;:()،؟])`, 'iu');
          if (regex.test(lower)) {
            return cat;
          }
        }
      }
    }

    // 2. Configured custom category aliases (from BusinessConfig)
    if (customCategoryAliases && Object.keys(customCategoryAliases).length > 0) {
      for (const [canonical, aliases] of Object.entries(customCategoryAliases)) {
        if (!aliases || !Array.isArray(aliases)) continue;
        for (const alias of aliases) {
          if (!alias) continue;
          const aliasLower = alias.toLowerCase().trim();
          const regex = new RegExp(`(?:^|\\s|[.,!?;:()،؟])(?:f-|l-|d-|al-|ال|فال|بال|ف|ب|le|la|les|the)?${this.escapeRegex(aliasLower)}(?:$|\\s|[.,!?;:()،؟])`, 'iu');
          if (regex.test(lower)) {
            return canonical;
          }
        }
      }
    }

    // 3. Legacy compatibility fallback
    for (const [canonical, aliases] of Object.entries(this.CANONICAL_CATEGORIES)) {
      for (const alias of aliases) {
        const regex = new RegExp(`(?:^|\\s|[.,!?;:()،؟])(?:f-|l-|d-|al-|ال|فال|بال|ف|ب|le|la|les|the)?${this.escapeRegex(alias)}(?:$|\\s|[.,!?;:()،؟])`, 'iu');
        if (regex.test(lower)) {
          return canonical;
        }
      }
    }
    return undefined;
  }

  public static isCategoryReference(
    token: string,
    catalogCategories?: string[] | null,
    customCategoryAliases?: Record<string, string[]> | null
  ): boolean {
    if (!token) return false;
    const lower = token.toLowerCase().trim();

    if (catalogCategories && catalogCategories.length > 0) {
      for (const cat of catalogCategories) {
        if (!cat) continue;
        const catLower = cat.toLowerCase().trim();
        const catSingular = catLower.endsWith('s') && catLower.length > 3 ? catLower.slice(0, -1) : catLower;
        const catPlural = catLower.endsWith('s') ? catLower : `${catLower}s`;
        const forms = [catLower, catSingular, catPlural];
        for (const f of forms) {
          if (lower === f || lower === `ال${f}` || lower === `l-${f}` || lower === `f-${f}` || lower === `al-${f}`) {
            return true;
          }
        }
      }
    }

    if (customCategoryAliases && Object.keys(customCategoryAliases).length > 0) {
      for (const aliases of Object.values(customCategoryAliases)) {
        if (!aliases || !Array.isArray(aliases)) continue;
        for (const alias of aliases) {
          if (!alias) continue;
          const aLower = alias.toLowerCase().trim();
          if (lower === aLower || lower === `ال${aLower}` || lower === `l-${aLower}` || lower === `f-${aLower}` || lower === `al-${aLower}`) {
            return true;
          }
        }
      }
    }

    // 3. Legacy compatibility fallback
    for (const aliases of Object.values(this.CANONICAL_CATEGORIES)) {
      for (const alias of aliases) {
        if (lower === alias || lower === `ال${alias}` || lower === `l-${alias}` || lower === `f-${alias}`) {
          return true;
        }
      }
    }

    return false;
  }

  public static readonly ATTRIBUTE_FAMILY_PATTERNS: Record<string, RegExp> = {
    MATERIAL: /(?:^|\s|[.,!?;:()،؟])(?:materials?|compositions?|fabrics?|cottons?|polyesters?|leathers?|fleeces?|linens?|wools?|silks?|denims?|nylons?|mati[èe]res?|tissus?|cotons?|cuirs?|laines?|soies?|lins?|مادة|المادة|قماش|القماش|أقمشة|اقمشة|ثوب|الثوب|توب|التوب|لتوب|قطن|القطن|قطني|قطنية|جلد|الجلد|جلدي|جلدية|صوف|حرير|tissou?|9mach|l9mach|toub|ltoub|9ton|l9ton|9otn|jeld|ljeld)(?:$|\s|[.,!?;:()،؟])/iu,
    PERFORMANCE: /(?:^|\s|[.,!?;:()،؟])(?:waterproof|water-resistant|water\s+resistant|rainproof|warm|breathable|windproof|thermal|insulation|quick\s+dry|imperm[ée]ables?|r[ée]sistant\s+[àa]\s+l['’]eau|chaud|chaude|respirant|respirante|coupe-vent|thermique|مقاوم\s+للماء|ضد\s+الماء|ضد\s+الما|مضاد\s+للماء|مضاد\s+للما|دافئ|دافئة|سخون|سخونة|يدفي|كتدفي|بارد|باردة|كيبرد|مبرد|يتنفس|تنفس|ddefy|d\s*ded\s*l-?ma|skhoun|skhona|dafi|waterproof|m9awem\s+lma)(?:$|\s|[.,!?;:()،؟])/iu,
    FEATURE: /(?:^|\s|[.,!?;:()،؟])(?:pockets?|hooded|hoods?|zippers?|zips?|drawstrings?|collars?|cuffs?|sleeves?|lining|buttons?|poches?|capuches?|fermetures?\s+[ée]clair|fermetures?|cordons?|cols?|manches?|doublures?|boutons?|جيوب|جيب|كابوشون|قب|سنسلة|سلسلة|سحاب|خيط|كمام|أكمام|ازرار|أزرار|صدفي|poches?|capuchon|sensla|9ob|jyoub|jiyoub)(?:$|\s|[.,!?;:()،؟])/iu,
    FIT: /(?:^|\s|[.,!?;:()،؟])(?:fits?|oversized?|slim\s+fit|regular\s+fit|tight|loose|relaxed|cuts?|tailoring|coupes?|coupe\s+large|coupe\s+ajust[ée]e|ajust[ée]e?|large|serr[ée]e?|amples?|oversize|فصالة|الفصالة|قصة|القصة|واسع|واسعة|عريض|عريضة|مزير|مزيرة|طاي\s+عريضة|مفصل|la\s+coupe|was3|was3a|3rid|3rida|mzyer|mzyra|oversize|serr[ée])(?:$|\s|[.,!?;:()،؟])/iu,
    DIMENSIONS: /(?:^|\s|[.,!?;:()،؟])(?:dimensions?|measurements?|lengths?|widths?|heights?|size\s+charts?|measurement|mesures?|longueurs?|largeurs?|hauteurs?|taille\s+en\s+cm|guide\s+des\s+tailles|أبعاد|ابعاد|قياسات|القياسات|مقاسات|المقاسات|طول|الطول|عرض|العرض|ارتفاع|الارتفاع|عبار|العبار|عبارات|العبارات|سنتيمتر|3bar|l-?3bar|toul|3ord)(?:$|\s|[.,!?;:()،؟])/iu,
    WEIGHT: /(?:^|\s|[.,!?;:()،؟])(?:weights?|heavy|lightweight|light|grams?|gsm|thickness|thick|thin|poids|lourds?|l[ée]gers?|l[ée]g[èe]re|grammages?|[ée]paisseurs?|[ée]pais|fins?|وزن|الوزن|ثقيل|ثقيلة|خفيف|خفيفة|غليظ|غليظة|رقيق|رقيقة|سمك|السمك|تقل|التقل|lourde?|khfif|khfifa|t9il|t9ila|ghlid|rqiq|wzen)(?:$|\s|[.,!?;:()،؟])/iu,
    CARE: /(?:^|\s|[.,!?;:()،؟])(?:wash\s+temperature|washing\s+instructions?|how\s+to\s+wash|dry\s+clean|ironing|temperature|bleach|machine\s+wash|temp[ée]rature\s+de\s+lavage|repassage|nettoyage\s+[àa]\s+sec|طريقة\s+الغسيل|كيفاش\s+نغسل|تصبين|مكواة|حديد|صلوح|درجة\s+حرارة)(?:$|\s|[.,!?;:()،؟])/iu
  };

  public static detectAttributeFamily(
    text: string,
    customAttributeAliases?: Record<string, string[]> | null,
    candidateMetadataKeys?: string[] | null
  ): { family: string; keyword: string; attributeName?: string } | undefined {
    if (!text || !text.trim()) return undefined;
    const lower = text.toLowerCase();

    if (customAttributeAliases && Object.keys(customAttributeAliases).length > 0) {
      for (const [canonicalAttr, aliases] of Object.entries(customAttributeAliases)) {
        if (!aliases || !Array.isArray(aliases)) continue;
        for (const alias of aliases) {
          if (!alias) continue;
          const aliasLower = alias.toLowerCase().trim();
          const regex = new RegExp(`(?:^|\\s|[.,!?;:()،؟])(?:f-|l-|d-|b-|al-|ال|فال|بال|ف|ب|ل|لـ|le|la|les|l['’]|d['’]|the)?\\s*${this.escapeRegex(aliasLower)}(?:$|\\s|[.,!?;:()،؟])`, 'iu');
          const match = lower.match(regex);
          if (match) {
            return { family: canonicalAttr.toUpperCase(), keyword: match[0].trim(), attributeName: canonicalAttr };
          }
        }
      }
    }

    if (candidateMetadataKeys && candidateMetadataKeys.length > 0) {
      for (const key of candidateMetadataKeys) {
        if (!key) continue;
        const keyLower = key.toLowerCase().trim();
        const keyWithSpaces = keyLower.replace(/[-_]/g, ' ');
        const forms = Array.from(new Set([keyLower, keyWithSpaces]));
        for (const form of forms) {
          const regex = new RegExp(`(?:^|\\s|[.,!?;:()،؟])(?:f-|l-|d-|b-|al-|ال|فال|بال|ف|ب|ل|لـ|le|la|les|l['’]|d['’]|the)?\\s*${this.escapeRegex(form)}(?:$|\\s|[.,!?;:()،؟])`, 'iu');
          const match = lower.match(regex);
          if (match) {
            return { family: key.toUpperCase(), keyword: match[0].trim(), attributeName: key };
          }
        }
      }
    }

    const universalFamilies: [string, RegExp][] = [
      ['DIMENSIONS', /(?:^|\s|[.,!?;:()،؟])(?:dimensions?|measurements?|lengths?|widths?|heights?|size\s+charts?|measurement|mesures?|longueurs?|largeurs?|hauteurs?|taille\s+en\s+cm|guide\s+des\s+tailles|أبعاد|ابعاد|قياسات|القياسات|مقاسات|المقاسات|طول|الطول|عرض|العرض|ارتفاع|الارتفاع|عبار|العبار|عبارات|العبارات|سنتيمتر|3bar|l-?3bar|toul|3ord)(?:$|\s|[.,!?;:()،؟])/iu],
      ['WEIGHT', /(?:^|\s|[.,!?;:()،؟])(?:weights?|heavy|lightweight|light|grams?|gsm|thickness|thick|thin|poids|lourds?|l[ée]gers?|l[ée]g[èe]re|grammages?|[ée]paisseurs?|[ée]pais|fins?|وزن|الوزن|ثقيل|ثقيلة|خفيف|خفيفة|غليظ|غليظة|رقيق|رقيقة|سمك|السمك|تقل|التقل|lourde?|khfif|khfifa|t9il|t9ila|ghlid|rqiq|wzen)(?:$|\s|[.,!?;:()،؟])/iu]
    ];

    for (const [family, regex] of universalFamilies) {
      const match = lower.match(regex);
      if (match) {
        return { family, keyword: match[0].trim(), attributeName: family.toLowerCase() };
      }
    }

    for (const [family, regex] of Object.entries(this.ATTRIBUTE_FAMILY_PATTERNS)) {
      const match = lower.match(regex);
      if (match) {
        return { family, keyword: match[0].trim(), attributeName: family.toLowerCase() };
      }
    }

    return undefined;
  }

  public static hasQuestionOrInquiryStructure(text: string): boolean {
    const lower = text.toLowerCase();
    if (/[?؟]/.test(text)) return true;
    if (/(?:^|\s|[.,!?;:()،؟])(?:what|which|is|are|does|do|how|can|tell|details|شنو|واش|هل|أ|شحال|كيفاش|معلومات|تفاصيل|وريني|عطيني|شوف|est-ce|quelle|quel|quels|quelles|comment|est-il|est-elle|sont-ils|sont-elles|y\s+a-t-il|c'est|wach|wash|ach|chnou|chnu|chhal|ch7al|kifach|werini|wrini|3tini)(?:$|\s|[.,!?;:()،؟])/iu.test(lower)) {
      return true;
    }
    return false;
  }

  public static isNonProductToken(
    token: string,
    catalogCategories?: string[] | null,
    customCategoryAliases?: Record<string, string[]> | null,
    customAttributeAliases?: Record<string, string[]> | null,
    candidateMetadataKeys?: string[] | null
  ): boolean {
    if (!token) return true;
    const lower = token.toLowerCase();
    const SIZES = new Set(['xs', 's', 'm', 'l', 'xl', 'xxl', '2xl', '3xl', '35', '36', '37', '38', '39', '40', '41', '42', '43', '44', '45', '46', '47', '48']);

    if (this.FUNCTIONAL_STATE_TOKENS.has(lower)) return true;
    if (this.FUNCTIONAL_PRONOUN_ANAPHORA_TOKENS.has(lower)) return true;
    if (this.FUNCTIONAL_QUESTION_TOKENS.has(lower)) return true;
    if (this.FUNCTIONAL_INTENT_VERBS.has(lower)) return true;
    if (this.MODIFIER_OR_ANAPHORA_TOKENS.has(lower)) return true;
    if (this.ORDINAL_MAP[lower] !== undefined) return true;
    if (SIZES.has(lower)) return true;
    if (this.isCategoryReference(lower, catalogCategories, customCategoryAliases)) return true;
    if (this.COLOR_MAP[lower]) return true;
    if (this.detectAttributeFamily(lower, customAttributeAliases, candidateMetadataKeys)) return true;

    if (['اول', 'أول', 'اولى', 'أولى', 'تاني', 'ثاني', 'تانية', 'ثانية', 'تالت', 'ثالث', 'تالتة', 'ثالثة', 'premier', 'premiere', 'première', 'deuxieme', 'deuxième', 'troisieme', 'troisième', 'first', 'second', 'third'].includes(lower)) return true;

    if (['و', 'في', 'فـ', 'ف', 'بـ', 'ب', 'لـ', 'ل', 'من', 'عن', 'مع', 'على', 'ديال', 'dyal', 'dial', 'de', 'du', 'des', 'en', 'in', 'at', 'on', 'with', 'for', 'and', 'et', 'f', 'b', 'l', 'm3a', '3la', 'sur', 'pour', 'dans', 'of', 'made', 'to', 'is', 'are', 'was', 'were', 'our', 'your', 'my', 'its', 'sa', 'son', 'ses', 'vos', 'nos', 'leur', 'leurs', 'moi', 'toi', 'nous', 'vous', 'eux', 'ولا', 'او', 'أو', 'أم', 'ام', 'اللي', 'لي', 'عندكم', 'عندك', 'عندنا', 'zippe', 'zippee', 'zippees', 'zippes', 'zippé', 'zippée', 'zippées', 'zippés', 'video', 'videos', 'vidéo', 'vidéos', 'lvideo', 'l-video', 'fvideo', 'f-video', 'photo', 'photos', 'image', 'images', 'pic', 'pics', 'picture', 'pictures', 'clip', 'clips', 'tsawer', 'tswira', 'tsawir', 'tsawar', 'فيديو', 'فيديوهات', 'فديو', 'مقطع', 'مقاطع', 'صور', 'صورة', 'تصوير', 'تصاور', 'تصويرة'].includes(lower)) return true;

    if (['منتج', 'المنتج', 'منتوج', 'المنتوج', 'منتجات', 'المنتجات', 'منتوجات', 'المنتوجات', 'سلعة', 'السلعة', 'حاجة', 'الحاجة', 'موديل', 'الموديل', 'بياسة', 'البياسة', 'قطعة', 'القطعة', 'produit', 'produits', 'lproduit', 'l-produit', 'article', 'articles', 'item', 'items', 'product', 'products', 'hadchi', 'هادا'].includes(lower)) return true;

    if (lower.startsWith('و') && lower.length > 2 && this.isNonProductToken(lower.slice(1), catalogCategories, customCategoryAliases, customAttributeAliases, candidateMetadataKeys)) return true;
    if (lower.startsWith('ال') && lower.length > 3 && this.isNonProductToken(lower.slice(2), catalogCategories, customCategoryAliases, customAttributeAliases, candidateMetadataKeys)) return true;
    if (lower.startsWith('لـ') && lower.length > 3 && this.isNonProductToken(lower.slice(2), catalogCategories, customCategoryAliases, customAttributeAliases, candidateMetadataKeys)) return true;
    if (lower.startsWith('للـ') && lower.length > 4 && this.isNonProductToken(lower.slice(3), catalogCategories, customCategoryAliases, customAttributeAliases, candidateMetadataKeys)) return true;
    if (lower.startsWith('لل') && lower.length > 3 && this.isNonProductToken(lower.slice(2), catalogCategories, customCategoryAliases, customAttributeAliases, candidateMetadataKeys)) return true;
    if (lower.startsWith('ل') && lower.length > 2 && this.isNonProductToken(lower.slice(1), catalogCategories, customCategoryAliases, customAttributeAliases, candidateMetadataKeys)) return true;
    if (lower.startsWith('فـ') && lower.length > 3 && this.isNonProductToken(lower.slice(2), catalogCategories, customCategoryAliases, customAttributeAliases, candidateMetadataKeys)) return true;
    if (lower.startsWith('ف') && lower.length > 2 && this.isNonProductToken(lower.slice(1), catalogCategories, customCategoryAliases, customAttributeAliases, candidateMetadataKeys)) return true;
    if (lower.startsWith('بـ') && lower.length > 3 && this.isNonProductToken(lower.slice(2), catalogCategories, customCategoryAliases, customAttributeAliases, candidateMetadataKeys)) return true;
    if (lower.startsWith('ب') && lower.length > 2 && this.isNonProductToken(lower.slice(1), catalogCategories, customCategoryAliases, customAttributeAliases, candidateMetadataKeys)) return true;
    if (lower.startsWith('ما') && lower.length > 3 && this.isNonProductToken(lower.slice(2), catalogCategories, customCategoryAliases, customAttributeAliases, candidateMetadataKeys)) return true;
    if (lower.startsWith('م') && lower.length > 2 && this.isNonProductToken(lower.slice(1), catalogCategories, customCategoryAliases, customAttributeAliases, candidateMetadataKeys)) return true;

    if ((lower.startsWith('f-') || lower.startsWith('l-') || lower.startsWith('d-') || lower.startsWith('b-')) && lower.length > 2 && this.isNonProductToken(lower.slice(2), catalogCategories, customCategoryAliases, customAttributeAliases, candidateMetadataKeys)) return true;
    if ((lower.startsWith('fl') || lower.startsWith('bl')) && lower.length > 3 && this.isNonProductToken(lower.slice(2), catalogCategories, customCategoryAliases, customAttributeAliases, candidateMetadataKeys)) return true;

    if ((lower.endsWith('ها') || lower.endsWith('هم') || lower.endsWith('كم') || lower.endsWith('نا') || lower.endsWith('ين') || lower.endsWith('ات') || lower.endsWith('ية')) && lower.length > 3 && this.isNonProductToken(lower.slice(0, -2), catalogCategories, customCategoryAliases, customAttributeAliases, candidateMetadataKeys)) return true;
    if ((lower.endsWith('ه') || lower.endsWith('ك') || lower.endsWith('ي') || lower.endsWith('ة') || lower.endsWith('و')) && lower.length > 2 && this.isNonProductToken(lower.slice(0, -1), catalogCategories, customCategoryAliases, customAttributeAliases, candidateMetadataKeys)) return true;

    if (lower.length <= 2) return true;

    return false;
  }

  public static isNonProductReference(
    name: string,
    catalogCategories?: string[] | null,
    customCategoryAliases?: Record<string, string[]> | null,
    customAttributeAliases?: Record<string, string[]> | null,
    candidateMetadataKeys?: string[] | null
  ): boolean {
    if (!name || !name.trim()) return true;
    const normalized = name.replace(/\u0640/g, '').trim();
    const cleanChars = normalized.replace(/[^\p{L}\p{N}]/gu, '');
    if (cleanChars.length < 3) return true;

    const tokens = normalized.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').split(/[\s-]+/).filter(Boolean);
    if (tokens.length === 0) return true;

    return tokens.every(t => this.isNonProductToken(t, catalogCategories, customCategoryAliases, customAttributeAliases, candidateMetadataKeys));
  }

  public static cleanProductName(
    raw: string,
    catalogCategories?: string[] | null,
    customCategoryAliases?: Record<string, string[]> | null,
    customAttributeAliases?: Record<string, string[]> | null,
    candidateMetadataKeys?: string[] | null
  ): string {
    if (!raw || !raw.trim()) return '';
    let cleaned = raw.replace(/\u0640/g, '');

    for (const colorKey of Object.keys(this.COLOR_MAP)) {
      const colorRegex = new RegExp(`(?:^|\\s|[.,!?;:()،؟])(?:f-|b-|fl|f|b|l|en|in|de|du|with|مع|في|فـ|ف|بـ|ب|لـ|ل)?\\s*${colorKey}(?:$|\\s|[.,!?;:()،؟])`, 'giu');
      cleaned = cleaned.replace(colorRegex, ' ');
    }

    const sizePrefixRegex = /(?:^|\s|[.,!?;:()،؟])(?:taille|size|pointure|قياس|نمرة)\s*(?:de|du|en|f|fl|d|l)?\s*(?:4[0-8]|3[5-9]|xs|s|m|l|xl|xxl|2xl|3xl)(?:$|\s|[.,!?;:()،؟])/giu;
    cleaned = cleaned.replace(sizePrefixRegex, ' ');

    const standaloneSizeRegex = /(?:^|\s|[.,!?;:()،؟])(?:f-|fl|f|b-|b|l-|l|en|in|de|du|فـ|ف|بـ|ب|لـ|ل)?\s*(?:4[0-8]|3[5-9]|xs|s|m|l|xl|xxl|2xl|3xl)(?:$|\s|[.,!?;:()،؟])/giu;
    cleaned = cleaned.replace(standaloneSizeRegex, ' ');

    const statePatternsRegex = /(?:^|\s|[.,!?;:()،؟])(?:واش\s+عندكم|عندكم|واش\s+عندك|عندك|واش\s+كاينين|واش\s+كاين|واش\s+كاينة|واش\s+كاينا|واش\s+متوفر|واش\s+متوفرة|واش\s+متوفرين|هل\s+متوفر|هل\s+متوفرة|هل\s+متوفرين|هل\s+عندكم|كتبيعو|واش\s+كتبيعو|واش\s+باقي\s+كاين|واش\s+باقي\s+كاينة|واش\s+باقي\s+متوفر|واش\s+باقي|باقي\s+كاين|باقي\s+كاينة|باقي\s+متوفر|باقي|مازال\s+كاين|مازال\s+كاينة|مازال|مزال|موجود|موجودة|موجودين|avez-vous|avez\s+vous|vous\s+avez|vendez-vous|do\s+you\s+have|have\s+you|3ndkom|3ndkoum|3ndkm|3ndek|wach\s+3ndkom|wash\s+3ndkom|wach\s+kayn|wash\s+kayn|wach\s+kayna|wash\s+kayna|wach\s+kaynin|wash\s+kaynin|wach\s+ba9i|wash\s+ba9i|is\s+it\s+available|is\s+available|are\s+they\s+available|in\s+stock|disponible|disponibles|dispo|dispos)(?:$|\s|[.,!?;:()،؟])/giu;
    cleaned = cleaned.replace(statePatternsRegex, ' ');

    const anaphoraRegex = /(?:^|\s|[.,!?;:()،؟])(?:had|hada|hadi|hadchi|hado|hadok|dyalo|dyalha|dyalhom|3lih|3liha|mno|mnha|fih|fiha|ce|cet|cette|ces|ceci|cela|ça|ca|celui-ci|celui-la|celui-là|celle-ci|celle-la|celle-là|celui|celle|ceux|celles|it|this|that|these|those|هاد|هذا|هدا|هادا|هادي|هدي|هادو|هادوك|هادشي|ديالو|ديالها|ديالهم|منو|منها|منهم|عليه|عليها|عليهم|فيه|فيها|فيهم|واحد|وحدة|ديك|داك)(?:$|\s|[.,!?;:()،؟])/giu;
    cleaned = cleaned.replace(anaphoraRegex, ' ');

    const leadingMediaPrefixRegex = /^(?:videos?|clips?|vidéos?|l-?video|f-?video|tsawer|tswira|tsawir|photos?|pictures?|images?|pics?|فيديو|فيديوهات|فديو|مقطع|مقاطع|صور|صورة|تصوير|تصاور|تصويرة)\s+(?:of|de|du|d'|dial|dyal|ديال|حول|pour)?\s*/iu;
    cleaned = cleaned.replace(leadingMediaPrefixRegex, '');

    const trailingMediaSuffixRegex = /\s+(?:of|de|du|d'|dial|dyal|ديال)?\s*(?:videos?|clips?|vidéos?|l-?video|f-?video|tsawer|tswira|tsawir|photos?|pictures?|images?|pics?|فيديو|فيديوهات|فديو|مقطع|مقاطع|صور|صورة|تصوير|تصاور|تصويرة)\s*$/iu;
    cleaned = cleaned.replace(trailingMediaSuffixRegex, '');

    cleaned = cleaned.replace(/^[?؟,،.!;:()[\]{}'"]+|[?؟,،.!;:()[\]{}'"]+$/g, '').trim();
    cleaned = cleaned
      .replace(/^(?:ana\s+bghit\s+(?:nchri|nechri|ncommandi|ncommander|nkomandi|nshri|nkhod|chri|commandi)|ana\s+bghit|bghit\s+(?:nchri|nechri|ncommandi|ncommander|nkomandi|nshri|nkhod|chri|commandi|buy|order|take|get|acheter|commander)|bghit|bghina|baghi\s+(?:nchri|nechri|ncommandi|nshri|nkhod|buy|order)|baghi|baghya\s+(?:nchri|nechri|ncommandi|nshri|nkhod|buy|order)|baghya|(?:wach\s+)?(?:n9der|nqder|ne9der)\s+(?:nchri|nechri|nshri|ncommandi|nkomandi|nkhod)|(?:kifash|kifesh)\s+(?:nchri|nechri|ncommandi|nkomandi)|(?:واش\s+)?نقدر\s+(?:نشري|نكوموندي|نكموندي|نطلب|ناخد)|كيفاش\s+(?:نشري|نكوموندي|نكموندي|نطلب)|بغي[ـت]?\s+(?:نشري|نطلب|نكوموندي|نكموندي|ناخد|ناخذ|نشتري|buy|order|acheter|commander)|بغي[ـت]?|باغي\s+(?:نشري|نطلب|نكوموندي|نكموندي|ناخد|نشتري)|باغي|باغية\s+(?:نشري|نطلب|نكوموندي|نكموندي|ناخد|نشتري)|باغية|(?:س[أا]شتري|ساشتري|س[أا]طلب|ساطلب|سوف\s+[أا]شتري|سوف\s+اشتري|سوف\s+[أا]طلب|سوف\s+اطلب)|(?:[أا]ريد|[أا]ود|[أا]رغب)\s+(?:شراء|الشراء|[أا]ن\s+[أا]شتري|[أا]ن\s+[أا]طلب|[أا]شتري|نشتري|[أا]طلب|الطلب|طلب|buy|order|take|get|acheter|commander)|[أا]ريد|اريد|je\s+veux\s+(?:acheter|commander|prendre|nchri|nechri|ncommandi)|je veux|j['’]aimerais\s+(?:acheter|commander)|i\s+want\s+to\s+(?:buy|order|purchase|take|get|checkout)|i want|i\s+wanna\s+(?:buy|order|purchase)|i['’]?d\s+like\s+to\s+(?:buy|order|purchase)|can\s+i\s+(?:buy|order|purchase|take|get)|i need|montre-moi|show me(?:\s+a|\s+the)?|watch(?:\s+the)?|voir(?:\s+la)?|regarde|وريني|شوف|عطيني|شحال|وشحال|بشحال|ch7al|chhal|taman|ثمن|سعر|how much(?:\s+is|\s+was)?|what is the price of|what was the price of|what's the price of|combien(?:\s+coûte|\s+coute|\s+vaut|\s+ça vaut|\s+ca vaut)?|quel est le prix de|quel était le prix de|كم سعر|what\s+material(?:\s+is|\s+are)?|what\s+is|what\s+are|what|is\s+it|is\s+the|is|are|does|do|how|quelle\s+est|quel\s+est|est-ce\s+qu['’]il\s+a|est-ce\s+qu['’]il|est-ce\s+que|est-ce|en\s+quelle(?:\s+matière)?|de\s+quelle(?:\s+matière)?|شنو\s+هي\s+المادة|شنو\s+المادة|شنو\s+هي|شنو\s+هو|شنو|واش\s+هي|واش\s+هو|واش|هل|أ|wach|wash|ach|chnou|chnu|chof|chouf|wrini|werini)(?:\s+|$)/iu, '')
      .replace(/^(?:to\s+(?:buy|order|purchase|take|get|checkout)|buy|order|purchase|checkout|take|get|passer\s+commande|acheter|commander|prendre|nchri|nechri|chri|nshri|nkhod|nakhod|khod|ncommandi|ncommander|commandi|nkomandi|nkomander|komandi|nchrih|nechrih|nshrih|ncommandih|نشري|نشريه|نشريها|شراء|شراءه|شراءها|أشتري|اشتري|أشتريه|اشتريه|أشتريها|اشتريها|نشتري|اشري|نطلب|نطلبو|نطلبها|أطلب|اطلب|أطلبه|اطلبه|أطلبها|اطلبها|نكوموندي|نكموندي|ناخد|ناخذ|ناخدو|ناخذو|طلب|الشراء|الطلب)(?:\s+|$)/iu, '')
      .replace(/^(?:the|le|la|les|l'|d'|el|al|al-|ال|للـ|لل|had|hada|hadi|هاد|هذا|هدا|هادا|هادي|your|our|vos|nos|sa|son|ses|its|their|est|sont|ديال|dyal|dial|de|du|des|d'un|d'une|of(?:\s+the)?|from|any|some|شي|chi)\s+/iu, '')
      .replace(/(?:^|\s)(?:f|b|fl|en|in|de|du|des|with|مع|في|فـ|ف|بـ|ب|لـ|ل|ديال|dyal|dial|شحال|وشحال|بشحال|ثمن|سعر|ch7al|taman|worth|coute|coûte|vaut|تسوى|يسوى|كيسوى|price|cost|made\s+of|made|of|pour|for|zippée|zippées|zippé|zippés|waterproof|water-resistant|imperméable|impermeable|respirant|chaud|chaude|oversize|oversized|large|serré|slim|heavy|light|cotton|coton|leather|cuir|مقاوم\s+للماء|ضد\s+الما|ضد\s+الماء|سخون|دافئ|قطن|واسع|عريض|مزير|ولا|أو|او|أم|ام)\s*$/giu, '')
      .replace(/^[?؟,،.!;:()[\]{}'"]+|[?؟,،.!;:()[\]{}'"]+$/g, '')
      .trim();

    cleaned = cleaned.replace(/\s+/g, ' ').trim();

    if (this.isNonProductReference(cleaned, catalogCategories, customCategoryAliases, customAttributeAliases, candidateMetadataKeys)) {
      return '';
    }

    return cleaned;
  }

  static parse(
    text: string,
    productContext?: ProductContext | null,
    lang: SupportedLanguage = 'en',
    options?: {
      catalogCategories?: string[] | null;
      customCategoryAliases?: Record<string, string[]> | null;
      customAttributeAliases?: Record<string, string[]> | null;
      candidateMetadataKeys?: string[] | null;
    }
  ): ExtractedCommerceParams {
    let normalizedText = text.replace(/\u0640/g, '');
    // Bounded normalization for common glued purchase forms
    normalizedText = normalizedText
      .replace(/\bwantto\b/gi, 'want to')
      .replace(/\bbuyit\b/gi, 'buy it')
      .replace(/\borderit\b/gi, 'order it')
      .replace(/\bjeveux\b/gi, 'je veux')
      .replace(/\btobuy\b/gi, 'to buy')
      .replace(/\bwant\s+to\s+bu\b/gi, 'want to buy')
      .replace(/([^\d])([,،])([^\d])/g, '$1 $3');

    const trimmed = normalizedText.trim();
    const lower = trimmed.toLowerCase();

    if (HandoffService.isHandoffRequested(trimmed)) {
      return { intent: 'UNKNOWN' };
    }

    // 0. Extract Category
    const category = this.extractCategory(trimmed, options?.catalogCategories, options?.customCategoryAliases);

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
    const procliticSizeRegex = /(?:^|\s|[.,!?;:()،؟])(?:f-|fl|f\s+|en\s+|in\s+|فـ?|بـ?|لـ?)\s*(4[0-8]|3[5-9]|xs|s|m|l|xl|xxl|2xl|3xl)(?:$|\s|[.,!?;:()،؟])/iu;
    const intentVerbSizeRegex = /(?:^|\s|[.,!?;:()،؟])(?:bghit|bghina|بغيت|أريد|اريد|je\s+veux|i\s+want|i\s+need|prends|take|khtar|choisir|نختار)\s+(4[0-8]|3[5-9]|xs|s|m|l|xl|xxl|2xl|3xl)(?:$|\s|[.,!?;:()،؟])/iu;
    const suffixAvailabilityRegex = /(?:^|\s|[.,!?;:()،؟])(4[0-8]|3[5-9]|xs|s|m|l|xl|xxl|2xl|3xl)\s*(?:واش\s+)?(?:kayn|kayna|dispo|disponible|available|in\s+stock|متوفر|متوفرة|كاين|كاينة|\?|؟)(?:$|\s|[.,!?;:()،؟])/iu;
    const colorPrecedingSizeRegex = /(?:^|\s|[.,!?;:()،؟])(?:black|white|red|blue|noir|blanc|rouge|bleu|كحل|بيض|حمر|زرق|أسود|أبيض|أحمر|أزرق|فالأسود|بالأسود|فالكحل|بالكحل)\s+(4[0-8]|3[5-9]|xs|s|m|l|xl|xxl|2xl|3xl)(?:$|\s|[.,!?;:()،؟])/iu;
    const multiCharOrNumericRegex = /(?:^|\s|[.,!?;:()،؟])(4[0-8]|3[5-9]|xs|xl|xxl|2xl|3xl)(?:$|\s|[.,!?;:()،؟])/iu;
    const shortTurnIsolatedRegex = /^(?:(?:size|taille|قياس|f|en|in|فـ|ف|bghit|بغيت|اريد)\s+)?(4[0-8]|3[5-9]|xs|s|m|l|xl|xxl|2xl|3xl)[.?!؟]*$/iu;

    const prefixMatch = trimmed.match(explicitSizePrefixRegex);
    const procliticMatch = trimmed.match(procliticSizeRegex);
    const intentVerbMatch = trimmed.match(intentVerbSizeRegex);
    const suffixMatch = trimmed.match(suffixAvailabilityRegex);
    const colorPrecedingMatch = trimmed.match(colorPrecedingSizeRegex);
    const shortTurnMatch = trimmed.trim().match(shortTurnIsolatedRegex);
    const multiCharMatch = trimmed.match(multiCharOrNumericRegex);

    if (prefixMatch && prefixMatch[1]) {
      size = prefixMatch[1].toUpperCase();
    } else if (procliticMatch && procliticMatch[1]) {
      size = procliticMatch[1].toUpperCase();
    } else if (intentVerbMatch && intentVerbMatch[1]) {
      size = intentVerbMatch[1].toUpperCase();
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
      const candidateSku = skuMatch[1].toUpperCase();
      if (!this.isNonProductReference(candidateSku, options?.catalogCategories, options?.customCategoryAliases, options?.customAttributeAliases, options?.candidateMetadataKeys)) {
        sku = candidateSku;
      }
    }

    // 5. Max Price / Budget extraction
    let maxPrice: number | undefined;
    const priceFilterMatch = lower.match(/(?:under|less\s+than|below|moins\s+de|max|اقل\s+من|أقل\s+من|ما\s+يفوتش|قل\s+من|b\s*9el\s*mn|b\s*qel\s*mn|9el\s*mn|b\s*a9al\s*mn|ta7t\s*mn)\s*(\d+(?:\.\d+)?)/iu);
    if (priceFilterMatch) {
      maxPrice = parseFloat(priceFilterMatch[1]);
    }

    const KNOWLEDGE_POLICY_TERMS = /(?:shipping|delivery|deliver|deliveries|delivered|livraison|livrer|expédition|envoi|retour|retours|retourner|remboursement|rembourser|remboursé|rendre|reprise|échange|échanges|échanger|echange|echanger|exchange|exchanges|exchanging|exchanged|refund|refunds|refunding|refunded|send\s+back|money\s+back|warranty|guarantee|garantie|garantir|care|how\s+to\s+wash|wash\s+instructions|washing|machine\s+wash|easy\s+care|entretien|lavage|laver|comment\s+laver|nettoyage|guide|hours|opening\s+hours|business\s+hours|horaires|heures\s+d['’]ouverture|politique|suivi|tracking|suivre|suis\s+ma\s+commande|track|track\s+order|order\s+status|where\s+is\s+my\s+order|où\s+est\s+ma\s+commande|ou\s+est\s+ma\s+commande|nghsel|nghslo|nghselha|ghsil|lghsil|tghsel|tasbin|nsben|nsbno|nrje3|nrje3o|nrje3ha|rje3|rje3o|rje3ha|nbdel|nbdelo|nbdelha|bdel|bdelo|bdelha|tawsil|tawseel|twsil|ywsl|twsl|kiwsl|kitwsl|ywsal|twsal|fin\s+wsel|fin\s+wsl|payment|paiement|payer|cash\s+on\s+delivery|cod|daman|ldaman|khalas|l5las|n5les|daf3|dafa3|frou3|fara3|reccommand|support|customer\s+service|support\s+email|support\s+phone|phone\s+number|service\s+client|contact|contact\s+support|email\s+support|numéro|numero|téléphone|telephone|خدمة\s+العملاء|خدمة\s+الزبناء|تواصل|اتصال|رقم\s+الهاتف|إيميل|ايميل|نمرة|السيبور|nemra|sipo?rt|size\s+guide|size\s+chart|size\s+recommendation|which\s+size|what\s+size|which\s+size\s+fits|what\s+fits|size\s+should|guide\s+des\s+tailles|guide\s+de\s+taille|tableau\s+des\s+tailles|quelle\s+taille|quelle\s+est\s+ma\s+taille|choisir\s+(?:sa\s+|une\s+)?taille|دليل\s+المقاسات|جدول\s+المقاسات|المقاس\s+المناسب|أي\s+مقاس|اي\s+مقاس|ما\s+هو\s+المقاس|شكون\s+لاطاي|شنو\s+هي\s+لاطاي|شمن\s+طاي|شمن\s+لاطاي|la\s+taille\s+li\s+tji|la\s+taille\s+li\s+mzyana|ashna\s+hiya\s+la\s+taille|tour\s+de\s+poitrine|chest\s+measurement|body\s+measurement|chest\s+size|محيط\s+الصدر|قياس\s+الصدر|مقاس\s+الصدر|f\s+sder|f\s+l-sder|توصيل|التوصيل|شحن|الشحن|مصاريف\s+الشحن|ثمن\s+التوصيل|سعر\s+التوصيل|وقت\s+التوصيل|مدة\s+التوصيل|توصل|توصلو|كيوصل|كتوصل|يوصل|يوصلو|توصلني|يوصلني|استرجاع|استبدال|إرجاع|ارجاع|الإرجاع|الارجاع|الاسترجاع|الاستبدال|ترجيع|الترجيع|تبديل|التبديل|نرجع|نرجعو|نرجعها|نرجعوا|نرجعوه|نرجعهم|نبدل|نبدلو|نبدلها|نبدلوه|نبدلوا|رجع|بدل|يرجع|يبدل|ترجع|تبدل|سياسة|ضمان|الضمان|غسيل|الغسيل|طريقة\s+الغسيل|كيفاش\s+نغسل|كيفية\s+الغسيل|نغسل|نغسلو|نغسلها|تصبين|التصبين|نصبن|نصبنو|نعتني|عناية|العناية|تنظيف|التنظيف|طريقة|ساعات|ساعات\s+العمل|أوقات\s+العمل|مواعيد|نتبع|تتبع|تتبع\s+الطلب|تتبع\s+طلبي|فين\s+وصل|فين\s+واصل|فين\s+كاين|دفع|الدفع|طريقة\s+الدفع|طرق\s+الدفع|الدفع\s+عند\s+الاستلام|الدفع\s+عند\s+التسليم|خلاص|الخلاص|نخلص|نخلصو|باش\s+نخلص|أجل\s+الإرجاع|أجل\s+الاسترجاع|أجل\s+التبديل|مهلة\s+الإرجاع|مهلة\s+الاسترجاع|مهلة\s+التبديل|مدة\s+الإرجاع|مدة\s+الاسترجاع|مدة\s+التبديل|شحال\s+عندي\s+من\s+الوقت|شحال\s+ديال\s+الوقت|قداش\s+بقا\s+ليا|قداش\s+عندي|combien\s+de\s+temps|délai\s+de\s+retour|delai\s+de\s+retour|délai\s+d['’]échange|delai\s+d['’]echange|how\s+long\s+do\s+i\s+have|how\s+many\s+days|return\s+window|exchange\s+window|return\s+period|exchange\s+period|chhal\s+3ndi\s+dlwa9t|9adach\s+b9a|9eddach\s+b9a|9dach\s+b9a)/iu;

    if (KNOWLEDGE_POLICY_TERMS.test(lower)) {
      let explicitProd: string | undefined;
      const priceAskProdPattern = /(?:how\s+much\s+is|what\s+is\s+the\s+price\s+of|quel\s+est\s+le\s+prix\s+d[ue]?|combien\s+coûte|combien\s+coute|شحال\s+كيسوى|شحال\s+كيدير|شحال\s+الثمن\s+ديال|كم\s+سعر|ch7al\s+kayswa|bch7al)\s+([a-zA-Z\u0600-\u06FF\s-]+?)(?:\s+(?:and|et|w|واش|how|how\s+do|كيفاش|فين|où|ou|how\s+can|\?|؟|,|$))/iu;
      const prodInPolicyPattern = /(?:بـ|ب|في|f|fl|pour|sur|3la|de|du|dial|dyal|ديال|بخصوص|حول|عن|باش\s+نرجع|باش\s+نبدل|باش\s+نغسل|to\s+return|to\s+exchange|to\s+wash|pour\s+retourner|pour\s+échanger|pour\s+laver)\s+([a-zA-Z\u0600-\u06FF\s-]+)/iu;
      const attachedProdPattern = /(?:^|\s)(?:بـ|ب|لـ|ل)([a-zA-Z\u0600-\u06FF\s-]+)/iu;
      const prodMatch = trimmed.match(priceAskProdPattern) || trimmed.match(prodInPolicyPattern) || trimmed.match(attachedProdPattern);
      if (prodMatch && prodMatch[1]) {
        let candidate = prodMatch[1].replace(/[?؟,،.!;:()[\]{}'"]/g, '').trim();
        candidate = candidate.replace(/^(?:retour|retours|refund|exchange|livraison|shipping|delivery|care|wash|guide|politique|استرجاع|استبدال|إرجاع|ارجاع|ترجيع|توصيل|شحن|غسيل|نغسل|عناية|باش\s+نرجع|باش\s+نبدل|باش\s+نغسل)\s*(?:de|du|pour|sur|3la|dial|dyal|ديال|حول)?\s*/iu, '').trim();
        if (!this.isNonProductReference(candidate, options?.catalogCategories, options?.customCategoryAliases) && candidate.length > 2) {
          explicitProd = this.cleanProductName(candidate, options?.catalogCategories, options?.customCategoryAliases);
        }
      }

      return {
        intent: 'UNKNOWN',
        sku,
        productName: explicitProd || undefined,
        category,
        color,
        size
      };
    }

    // Indefinite entity reference detection
    const hasIndefiniteMarker = /(?:^|\s|[.,!?;:()،؟])(?:something|anything|other|another|un\s+autre|une\s+autre|autre|autres|quelque\s+chose|des\s+articles|des\s+produits|شي\s+حاجة|شي\s+حاجه|حاجة|حاجه|واحد\s+اخر|واحد\s+آخر|شي\s+واحد|chi\s+7aja|chi\s+haja|chi\s+khor|wa7ed\s+akhor|شي|chi)\b/iu.test(lower);
    const hasIntentVerb = /(?:^|\s|[.,!?;:()،؟])(?:bghit|bghina|بغيت|وبغيت|أريد|واريد|اريد|je\s+veux|i\s+want|i\s+need|show\s+me|montre-moi|عطيني|وريني|cherche|looking\s+for)\b/iu.test(lower);
    const isComparativeBudget = /(?:cheaper|moins\s+cher|plus\s+abordable|أرخص|ارخص|رخيص|rkhis|arkhas|أقل\s+ثمن|اقل\s+ثمن|أقل\s+سعر)\b/iu.test(lower);

    // Rule B: Indefinite alternative request + comparative/budget semantics -> RECOMMENDATION
    const isComparativeAlternative = isComparativeBudget && (hasIndefiniteMarker || hasIntentVerb);

    const isRecommendation = !KNOWLEDGE_POLICY_TERMS.test(lower) && (
      isComparativeAlternative ||
      /(?:^|\s|[.,!?;:()،؟])(?:best|recommend|recommendation|recommander|recommandez|recommande|meilleur|meilleure|conseil|conseiller|conseille|conseillez|conseille-(?:moi|nous)|conseillez-(?:moi|vous|nous)|conseille\s+moi|conseillez\s+moi|أحسن|افضل|أفضل|شنو\s+أحسن|شنو\s+افضل|احسن\s+حاجة|ahsan|lmeilleur|bghit\s+chi\s+7aja|bghit\s+chi\s+haja|بغيت\s+شي\s+حاجة|بغيت\s+شي\s+حاجه|ach\s+t-?n[e]?s+[a-z0-9]*|شنو\s+تنصحني|which\s+.*should\s+i\s+(?:choose|get|buy|pick|take)|which\s+should\s+i\s+(?:choose|get|buy|pick|take)|which\s+.*is\s+better|what\s+should\s+i\s+(?:choose|get|buy|pick|take)|شنو\s+(?:نشري|أشتري|اشتري)|ach\s+(?:nchri|nechri)|achno\s+(?:nchri|nechri)|chno\s+(?:nchri|nechri)|quel\s+produit\s+(?:choisir|acheter|me\s+conseillez|conseillez)|quelle\s+option\s+choisir)(?:$|\s|[.,!?;:()،؟-])/iu.test(lower) ||
      /(?:which\s+(?:one|product|item|model|option|article)\s+is\s+best|lequel\s+est\s+le\s+meilleur|quel\s+est\s+le\s+meilleur|أيهم\s+أفضل|اي\s+واحد\s+احسن|اشمن\s+واحد\s+احسن)/iu.test(lower)
    );
    if (isRecommendation) {
      const cleanKeywords = trimmed
        .replace(/^(?:salam|salut|bonjour|hello|hi|hey|ahlan|السلام عليكم|سلام|أهلا|اهلا|صباح الخير|مساء الخير)[،,\s]+/iu, '')
        .replace(/^(?:best|recommend|recommendation|recommander|meilleur|meilleure|conseiller|conseille-moi|conseille\s+moi|أحسن|افضل|أفضل|شنو\s+أحسن|شنو\s+افضل|احسن\s+حاجة|ahsan|lmeilleur|bghit\s+chi\s+7aja|bghit\s+chi\s+haja|بغيت\s+شي\s+حاجة|بغيت\s+شي\s+حاجه|ach\s+t-?nss7ni|ach\s+tnss7ni|شنو\s+تنصحني|which\s+(?:one\s+)?should\s+i\s+(?:choose|get|buy)|quel\s+produit\s+choisir)\s+/iu, '')
        .replace(/[?؟,،.!;:()[\]{}'"]/g, '')
        .trim();

      const cleanedSearchKeywords = this.cleanProductName(cleanKeywords, options?.catalogCategories, options?.customCategoryAliases, options?.customAttributeAliases, options?.candidateMetadataKeys);

      return {
        intent: 'RECOMMENDATION',
        sku,
        productName: (!this.isNonProductReference(cleanedSearchKeywords, options?.catalogCategories, options?.customCategoryAliases, options?.customAttributeAliases, options?.candidateMetadataKeys) && cleanedSearchKeywords) ? cleanedSearchKeywords : undefined,
        category,
        color,
        size,
        maxPrice,
        searchKeywords: cleanedSearchKeywords || undefined
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
        const targetB = this.cleanProductName(compareWithMatch[1].replace(/^(?:shi|chi|un|une|some|le|la|les|al-|ال|شي|هاد|had)\s+/iu, ''), options?.catalogCategories, options?.customCategoryAliases);
        return {
          intent: 'COMPARE',
          compareProductNames: targetB && !this.isNonProductReference(targetB, options?.catalogCategories, options?.customCategoryAliases) ? [targetB] : undefined,
          sku,
          category,
          color,
          size
        };
      }

      // 6B. Compare two explicit products: "compare X and Y" / "قارن بين X و Y"
      const compareMatch = trimmed.match(/(?:compare|comparer|comparaison|مقارنة|قارن بين|قارن هاد|قارنها|قارنو|9aren bin|9arenha|قارن|9aren)\s*(?:bin|بين)?\s*(.+?)\s+(?:and|et|و|مع|avec|vs|versus|w|wa)\s+(.+)/iu);
      if (compareMatch && compareMatch[1] && compareMatch[2]) {
        const prod1 = this.cleanProductName(compareMatch[1].replace(/^(?:bin|بين|هاد|had|ce|cet|cette|le|la|les|al-|ال)\s+/iu, ''), options?.catalogCategories, options?.customCategoryAliases);
        const prod2 = this.cleanProductName(compareMatch[2].replace(/^(?:bin|بين|هاد|had|ce|cet|cette|le|la|les|al-|ال)\s+/iu, ''), options?.catalogCategories, options?.customCategoryAliases);
        if (prod1 && !this.isNonProductReference(prod1, options?.catalogCategories, options?.customCategoryAliases)) {
          return {
            intent: 'COMPARE',
            compareProductNames: [prod1, prod2].filter(p => !this.isNonProductReference(p, options?.catalogCategories, options?.customCategoryAliases)),
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
      const explicitMonetary = /(?:price|cost|worth|prix|coûte|coute|vaut|cheaper|moins cher|أرخص|ارخص|ثمن|سعر|بشحال|bch7al|bchhal|taman|mad|usd|eur|درهم)/iu.test(lower);
      const attrMatch = !explicitMonetary ? this.detectAttributeFamily(lower, options?.customAttributeAliases, options?.candidateMetadataKeys) : undefined;

      if (attrMatch) {
        const cleanedProductName = this.cleanProductName(trimmed, options?.catalogCategories, options?.customCategoryAliases, options?.customAttributeAliases, options?.candidateMetadataKeys);
        return {
          intent: 'ATTRIBUTE_QUERY',
          attributeFamily: attrMatch.family,
          attributeKeywords: attrMatch.keyword,
          attributeName: attrMatch.attributeName,
          sku,
          productName: (!this.isNonProductReference(cleanedProductName, options?.catalogCategories, options?.customCategoryAliases, options?.customAttributeAliases, options?.candidateMetadataKeys) && cleanedProductName) ? cleanedProductName : undefined,
          category,
          color,
          size,
          ordinalIndex
        };
      }

      const cleanedProductName = this.cleanProductName(trimmed, options?.catalogCategories, options?.customCategoryAliases, options?.customAttributeAliases, options?.candidateMetadataKeys);
      const extractedProdName = (!this.isNonProductReference(cleanedProductName, options?.catalogCategories, options?.customCategoryAliases, options?.customAttributeAliases, options?.candidateMetadataKeys) && cleanedProductName) ? cleanedProductName : undefined;

      return {
        intent: 'PRICE',
        sku,
        productName: extractedProdName,
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
      /(?:^|\s|[.,!?;:()،؟])(?:in stock|available|availability|disponible|dispo|متوفر|متوفرة|متوفرين|كاين|كاينة|كاينين|واش كاين|واش كاينة|واش كاينين|واش متوفر|واش متوفرة|هل متوفر|هل متوفرة|stock|kayn|kayna|dispo|ba9i|باقي|مازال)(?:$|\s|[.,!?;:()،؟])/iu.test(lower) ||
      ((color !== undefined || size !== undefined) && /(?:do you have|avez-vous|avez vous|you have|have you|واش عندكم|عندكم|كتبيعو)/iu.test(lower)) ||
      lower.includes('متوفر') || lower.includes('متوفرة') || lower.includes('واش كاين') || lower.includes('واش كاينة')
    );

    if (isAvailabilityKeyword) {
      const cleanedProductName = this.cleanProductName(trimmed, options?.catalogCategories, options?.customCategoryAliases);
      const extractedProdName = (!this.isNonProductReference(cleanedProductName, options?.catalogCategories, options?.customCategoryAliases) && cleanedProductName) ? cleanedProductName : undefined;

      // Rule C: Indefinite / New Entity Discovery vs Definite Product Availability
      const hasDefiniteReference = /(?:^|\s|[.,!?;:()،؟])(?:this|that|ce|cet|cette|ces|هاد|هذا|هدا|هادي|هدي|هادو|هادوك|هادشي|dyalo|dyalha|3lih|3liha|منو|منها|فيه|فيها)\b/iu.test(lower) || Boolean(sku);

      if (hasIndefiniteMarker && !hasDefiniteReference && !extractedProdName) {
        return {
          intent: 'RECOMMENDATION',
          category,
          color,
          size
        };
      }

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

    // 9.5 Attribute / Feature Inquiry (Precedence: ATTRIBUTE_QUERY > PRODUCT_SEARCH)
    const attrMatch = !KNOWLEDGE_POLICY_TERMS.test(lower) ? this.detectAttributeFamily(lower, options?.customAttributeAliases, options?.candidateMetadataKeys) : undefined;
    const hasInquiryStructure = this.hasQuestionOrInquiryStructure(trimmed) || Boolean(productContext?.selectedProductId);
    const isExplicitSearchVerb = /(?:^|\s|[.,!?;:()،؟])(?:bghit|bghina|بغيت|أريد|اريد|je\s+veux|i\s+want|i\s+need|looking\s+for|je\s+cherche|كنقلب|نقلب|وريني|وروني|show\s+me|find|search\s+for)(?:$|\s|[.,!?;:()،؟])/iu.test(lower);

    if (attrMatch && hasInquiryStructure && !isExplicitSearchVerb) {
      const cleanedProductName = this.cleanProductName(trimmed, options?.catalogCategories, options?.customCategoryAliases, options?.customAttributeAliases, options?.candidateMetadataKeys);
      return {
        intent: 'ATTRIBUTE_QUERY',
        attributeFamily: attrMatch.family,
        attributeKeywords: attrMatch.keyword,
        attributeName: attrMatch.attributeName,
        sku,
        productName: (!this.isNonProductReference(cleanedProductName, options?.catalogCategories, options?.customCategoryAliases, options?.customAttributeAliases, options?.candidateMetadataKeys) && cleanedProductName) ? cleanedProductName : undefined,
        category,
        color,
        size,
        ordinalIndex
      };
    }

    // 10. Buy / Order / Purchase Intent (Precedence: BUY_INTENT > PRODUCT_DETAIL / PRODUCT_SEARCH)
    const BUY_PATTERNS = /(?:^|\s|[.,!?;:()،؟])(?:i\s+want\s+to\s+(?:buy|order|purchase|take|get|checkout)|want\s+to\s+(?:buy|order|purchase|take|get)|i\s+wanna\s+(?:buy|order|purchase)|i['’]?d\s+like\s+to\s+(?:buy|order|purchase)|can\s+i\s+(?:buy|order|purchase|take|get)|how\s+to\s+(?:buy|order)|place\s+an?\s+order|buy\s+(?:this|it|that|the|a|one)|order\s+(?:this|it|that|the|a|one)|purchase\s+(?:this|it|that|the|a|one)|je\s+veux\s+(?:acheter|commander|prendre|nchri|nechri|ncommandi)|j['’]aimerais\s+(?:acheter|commander)|comment\s+(?:acheter|commander)|passer\s+commande|(?:bghit|bghina|baghi|baghya|ana\s+bghit)\s+(?:nchri|nechri|nshri|chri|ncommandi|ncommander|commandi|nkomandi|nkomander|komandi|nkhod|nakhod|khod|acheter|commander|buy|order|take|get)(?:h|ha)?|(?:wach\s+)?(?:n9der|nqder|ne9der)\s+(?:nchri|nechri|nshri|ncommandi|nkomandi|nkhod)(?:h|ha)?|(?:kifash|kifesh)\s+(?:nchri|nechri|ncommandi|ncommander|nkomandi)|(?:nchri|nechri|nshri|ncommandi|nkomandi)\s+(?:hadchi|hada|hadi|had|had\s+lproduit|had\s+l-produit|this|it|that)|(?:أريد|اريد|أود|اود|بغي[ـت]?|باغي|باغية)\s+(?:شراء(?:ه|ها)?|الشراء|[أا]ن\s+[أا]شتري(?:ه|ها)?|[أا]ن\s+[أا]طلب(?:و|ها)?|[أا]شتري(?:ه|ها)?|نشتري(?:ه|ها)?|[أا]طلب(?:و|ها)?|الطلب|طلب(?:و|ها)?|نشري(?:ه|ها)?|نطلب(?:و|ها)?|نكوموندي(?:ه|ها)?|نكموندي(?:ه|ها)?|ناخد(?:و|ها)?|ناخذ(?:و|ها)?|buy|order|take|get|acheter|commander)|(?:س[أا]شتري|ساشتري|س[أا]طلب|ساطلب|سوف\s+[أا]شتري|سوف\s+اشتري|سوف\s+[أا]طلب|سوف\s+اطلب)(?:ه|ها)?|(?:واش\s+)?نقدر\s+(?:نشري(?:ه|ها)?|نكوموندي(?:ه|ها)?|نكموندي(?:ه|ها)?|نطلب(?:و|ها)?|ناخد(?:و|ها)?)|كيفية\s+(?:الشراء|الطلب)|كيفاش\s+(?:نشري(?:ه|ها)?|نكوموندي(?:ه|ها)?|نكموندي(?:ه|ها)?|نطلب(?:و|ها)?)|كيف\s+[أا]شتري|كيف\s+[أا]طلب)(?:$|\s|[.,!?;:()،؟])/iu;

    const isBuyIntent = !KNOWLEDGE_POLICY_TERMS.test(lower) && BUY_PATTERNS.test(lower);

    if (isBuyIntent) {
      const cleanedProductName = this.cleanProductName(trimmed, options?.catalogCategories, options?.customCategoryAliases, options?.customAttributeAliases, options?.candidateMetadataKeys);
      const extractedProdName = (!this.isNonProductReference(cleanedProductName, options?.catalogCategories, options?.customCategoryAliases, options?.customAttributeAliases, options?.candidateMetadataKeys) && cleanedProductName) ? cleanedProductName : undefined;

      return {
        intent: 'BUY_INTENT',
        sku,
        productName: extractedProdName,
        category,
        color,
        size,
        ordinalIndex
      };
    }

    // 11. Product Detail & Contextual Product Inquiries (including Media Requests)
    const DETAIL_PATTERNS = /(?:^|\s|[.,!?;:()،؟])(?:tell me about|details for|details|what is|parle-moi de|détails sur|détails|plus d'infos|شنو هو|معلومات على|معلومات أكثر|معلومات كثر|معلومات|تفاصيل|عطيني تفاصيل|وريني تفاصيل|تفاصيل ديال|شنو المادة|المادة ديالو|المميزات ديالو|المميزات|خصائص|مواصفات|نعرف عليه كثر|نعرف كثر|3tini details|details dyal|bghit n3rf 3lih kter|n3rf 3lih kter|choufkter)(?:$|\s|[.,!?;:()،؟])/iu;

    const isImageRequest = !KNOWLEDGE_POLICY_TERMS.test(lower) && (
      /(?:^|\s|[.,!?;:()،؟])(?:images?|pictures?|photos?|pics?|voir\s+en\s+photo|صور|صورة|تصوير|شوف\s+الصور|وريني\s+صور|tsawer|tswira|tsawir|chof\s+tsawer|wrini\s+tsawer|تصاور|تصويرة)(?:$|\s|[.,!?;:()،؟])/iu.test(lower)
    );

    const isVideoRequest = !KNOWLEDGE_POLICY_TERMS.test(lower) && (
      /(?:^|\s|[.,!?;:()،؟])(?:videos?|clips?|watch\s+video|demo\s+video|vidéo|vidéos|voir\s+la\s+vidéo|فيديو|فيديوهات|فديو|مقطع|شوف\s+الفيديو|lvideo|chof\s+lvideo|wrini\s+video)(?:$|\s|[.,!?;:()،؟])/iu.test(lower)
    );

    const isDetailIntent = !KNOWLEDGE_POLICY_TERMS.test(lower) && (
      DETAIL_PATTERNS.test(lower) ||
      isImageRequest ||
      isVideoRequest ||
      (ordinalIndex !== undefined && /(?:details|détails|تفاصيل|معلومات|voir|montre|وريني)/iu.test(lower)) ||
      (Boolean(productContext?.selectedProductId) && /(?:المادة|المميزات|خصائص|مواصفات|نعرف عليه|composition|matiere|caracteristiques|features|material)/iu.test(lower))
    );

    if (isDetailIntent) {
      let cleanKeywords = trimmed
        .replace(/^(?:daba\s+)?(?:بغيت نعرف عليه كثر|بغيت نعرف كثر|بغيت نعرف|نعرف عليه كثر|نعرف كثر|bghit n3rf 3lih kter|bghit n3rf kter|n3rf 3lih kter|وريني|وروني|عطيني|عطوني|شوف|3tini|werini|wrini|chof|chouf|donne-moi|montre-moi|tell me about|show me(?:\s+a|\s+the)?|watch(?:\s+the)?|voir(?:\s+la)?|regarde|donne|donnez|montre|montrez)?\s*(?:details|détails|معلومات|تفاصيل|صور|صورة|تصاور|تصويرة|فيديو|فيديوهات|فديو|مقطع|video|videos?|vidéo|vidéos?|l-?video|f-?video|photos?|pictures?|images?|pics?)?\s*(?:3la|sur|about|حول|de|du|d'|le|la|les|the|al-|ال|للـ|لل|pour|dyal|dial|of(?:\s+the)?|from)?\s*/iu, '')
        .replace(/\b(?:the|le|la|les|al-|ال|one|un|une|واحد|second|first|third|1st|2nd|3rd|deuxieme|deuxième|premier|premiere|الأول|الاول|الثاني|الثالث|lwel|lowel)\b/giu, '')
        .replace(/[?؟,،.!;:()[\]{}'"]/g, '')
        .trim();

      const cleanedProductName = this.cleanProductName(cleanKeywords, options?.catalogCategories, options?.customCategoryAliases, options?.customAttributeAliases, options?.candidateMetadataKeys);
      return {
        intent: 'PRODUCT_DETAIL',
        sku,
        productName: (!this.isNonProductReference(cleanedProductName, options?.catalogCategories, options?.customCategoryAliases, options?.customAttributeAliases, options?.candidateMetadataKeys) && cleanedProductName) ? cleanedProductName : undefined,
        category,
        color,
        size,
        ordinalIndex,
        requestedMediaType: isVideoRequest ? 'video' : (isImageRequest ? 'image' : undefined)
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

      const cleanedSearchKeywords = this.cleanProductName(cleanKeywords, options?.catalogCategories, options?.customCategoryAliases, options?.customAttributeAliases, options?.candidateMetadataKeys);
      return {
        intent: 'PRODUCT_SEARCH',
        productName: (!this.isNonProductReference(cleanedSearchKeywords, options?.catalogCategories, options?.customCategoryAliases, options?.customAttributeAliases, options?.candidateMetadataKeys) && cleanedSearchKeywords) ? cleanedSearchKeywords : undefined,
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
