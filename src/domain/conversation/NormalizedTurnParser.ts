/**
 * NormalizedTurnParser.ts
 *
 * Universal deterministic parser that transforms raw multilingual customer messages
 * into a strongly-typed, canonical NormalizedTurn representation.
 * 100% deterministic, 0 LLM, 0 embeddings.
 */

import { TextNormalizer } from './TextNormalizer';
import { CategoryVocabulary } from './CategoryVocabulary';
import {
  NormalizedTurn,
  TurnIntent,
  StructuredEntity,
  SemanticReference,
  VariantConstraint,
  ComparisonTarget,
  RecommendationCriteria,
  TurnConstraint,
  PolicyScope,
  ContextScope
} from './NormalizedTurn';
import { ProductContext } from './ConversationContext';
import { LanguageDetector, SupportedLanguage } from '../faq/FaqMatcher';
import { HandoffService } from './HandoffService';
import { GreetingRouter } from './GreetingRouter';

export class NormalizedTurnParser {
  private static readonly ORDINAL_DEFINITIONS: Array<{
    value: number;
    tokens: string[];
  }> = [
    {
      value: 0,
      tokens: [
        'first', '1st', '1',
        'premier', 'premiere', 'première',
        'الاول', 'الأول', 'الاولى', 'الأولى',
        'lwel', 'lowel', 'louwel'
      ]
    },
    {
      value: 1,
      tokens: [
        'second', '2nd', '2',
        'deuxieme', 'deuxième', 'seconde',
        'الثاني', 'التاني', 'الثانية', 'التانية',
        'tani', 'thani'
      ]
    },
    {
      value: 2,
      tokens: [
        'third', '3rd', '3',
        'troisieme', 'troisième',
        'الثالث', 'التالت', 'الثالثة', 'التالتة',
        'talet', 'thaleth'
      ]
    }
  ];

  private static readonly COLOR_MAP: Record<string, string> = {
    black: 'Black', noir: 'Black', white: 'White', blanc: 'White',
    red: 'Red', rouge: 'Red', blue: 'Blue', bleu: 'Blue',
    green: 'Green', vert: 'Green', grey: 'Grey', gray: 'Grey', gris: 'Grey',
    yellow: 'Yellow', jaune: 'Yellow', orange: 'Orange', purple: 'Purple',
    violet: 'Purple', pink: 'Pink', rose: 'Pink', silver: 'Silver',
    'كحل': 'Black', 'الكحل': 'Black', 'فالكحل': 'Black', 'بالكحل': 'Black',
    'أسود': 'Black', 'الأسود': 'Black', 'فالأسود': 'Black', 'بالأسود': 'Black',
    'اسود': 'Black', 'الاسود': 'Black',
    'بيض': 'White', 'البيض': 'White', 'أبيض': 'White', 'الأبيض': 'White',
    'حمر': 'Red', 'الحمر': 'Red', 'أحمر': 'Red', 'الأحمر': 'Red',
    'زرق': 'Blue', 'الزرق': 'Blue', 'أزرق': 'Blue', 'الأزرق': 'Blue',
    'خضر': 'Green', 'الخضر': 'Green', 'أخضر': 'Green', 'الأخضر': 'Green',
    'رمادي': 'Grey', 'الرمادي': 'Grey', 'صفر': 'Yellow', 'أصفر': 'Yellow',
    keshel: 'Black', k7el: 'Black', lk7el: 'Black', k7l: 'Black', lk7l: 'Black', flk7l: 'Black', k7al: 'Black', lk7al: 'Black', flk7al: 'Black'
  };

  private static readonly SIZES = new Set([
    'xs', 's', 'm', 'l', 'xl', 'xxl',
    '35', '36', '37', '38', '39', '40', '41', '42', '43', '44', '45', '46', '47', '48'
  ]);

  /**
   * Main parsing entrypoint: turns raw user text into a NormalizedTurn.
   */
  public static parse(rawText: string, languageHint?: string, productContext?: ProductContext | null): NormalizedTurn {
    const raw = (rawText || '').trim();
    const normalizedText = TextNormalizer.normalizeForMatching(raw);
    const tokens = TextNormalizer.tokenizeAndNormalize(raw);

    // 1. Language & Script Detection
    const detectedLang = (languageHint || LanguageDetector.detect(raw)) as SupportedLanguage;
    const responseLanguage: 'en' | 'fr' | 'ar' | 'darija' =
      detectedLang === 'fr' ? 'fr' : (detectedLang === 'ar' ? 'ar' : (detectedLang === 'darija' ? 'darija' : 'en'));

    let responseScript: 'latin' | 'arabic' | 'arabizi' = 'latin';
    const arabicCharCount = (raw.match(/[\u0600-\u06FF]/g) || []).length;
    if (arabicCharCount > 0 && arabicCharCount / Math.max(1, raw.length) > 0.15) {
      responseScript = 'arabic';
    } else if (responseLanguage === 'darija') {
      responseScript = 'arabizi';
    } else {
      responseScript = 'latin';
    }

    // 2. Extracted Components
    const entities: StructuredEntity[] = [];
    const references: SemanticReference[] = [];
    const categories: string[] = [];
    const variants: VariantConstraint[] = [];
    const constraints: TurnConstraint[] = [];
    const detectedIntents: TurnIntent[] = [];

    // 3. Category Detection
    const matchedCategory = CategoryVocabulary.matchCategory(raw);
    if (matchedCategory) {
      categories.push(matchedCategory);
      entities.push({
        type: 'CATEGORY',
        text: matchedCategory,
        canonicalName: matchedCategory,
        confidence: 0.95
      });
    }

    // 4. Ordinal & Reference Detection
    let extractedOrdinal: number | undefined;
    for (const ord of this.ORDINAL_DEFINITIONS) {
      const normalizedOrdTokens = ord.tokens.map(t => TextNormalizer.normalizeForMatching(t));
      for (const token of tokens) {
        const stripped = TextNormalizer.stripProclitic(token);
        if (
          normalizedOrdTokens.includes(token) ||
          normalizedOrdTokens.includes(stripped) ||
          normalizedOrdTokens.some(ot => TextNormalizer.stripProclitic(ot) === stripped)
        ) {
          extractedOrdinal = ord.value;
          references.push({
            type: 'REFERENCE',
            kind: 'ORDINAL',
            value: ord.value,
            target: 'LAST_SEARCH_RESULTS',
            rawText: token
          });
          break;
        }
      }
      if (extractedOrdinal !== undefined) break;
    }

    // Anaphora references (it, that one, dyalo, dyalha, etc.)
    const anaphoraRegex = /(?:^|\s|[.,!?;:()،؟])(?:it|its|that\s+one|this\s+one|ce\s+produit|cet\s+article|ce\s+modèle|هذا|هدا|هادي|هدي|هادشي|ديالو|ديالها|عليه|عليها|منو|منها|dyalo|dyalha|hada|hadi|hadchi|3lih|3liha)(?:$|\s|[.,!?;:()،؟])/iu;
    if (anaphoraRegex.test(raw)) {
      references.push({
        type: 'REFERENCE',
        kind: 'ANAPHORA',
        value: 'current',
        target: 'CURRENT_CONTEXT',
        rawText: 'anaphora'
      });
    }

    // 5. Variant Extraction (Colors & Sizes)
    let extractedColor: string | undefined;
    for (const [key, val] of Object.entries(this.COLOR_MAP)) {
      const regex = new RegExp(`(?:^|\\s|[.,!?;:()،؟])(?:f-|b-|fl|f|b|l|en|in|de|du|with|مع|في|فـ|ف|بـ|ب|لـ|ل)?\\s*${key}(?:$|\\s|[.,!?;:()،؟])`, 'iu');
      if (regex.test(raw)) {
        extractedColor = val;
        entities.push({
          type: 'VARIANT',
          text: key,
          canonicalName: val,
          confidence: 0.95,
          metadata: { variantType: 'COLOR', value: val }
        });
        break;
      }
    }

    let extractedSize: string | undefined;
    const explicitSizePrefixRegex = /(?:^|\s|[.,!?;:()،؟])(?:size|taille|قياس|نمرة|pointure|f\s+taille|en\s+taille|in\s+size|مقاس|حجم|فالمقاس|بالمقاس|فالحجم|طاي)\s*[:=]?\s*(4[0-8]|3[5-9]|xs|s|m|l|xl|xxl|2xl|3xl)(?:$|\s|[.,!?;:()،؟])/iu;
    const procliticSizeRegex = /(?:^|\s|[.,!?;:()،؟])(?:f-|fl|f\s+|en\s+|in\s+|فـ|ف\s+|بـ|ب\s+|لـ|ل\s+)(4[0-8]|3[5-9]|xs|s|m|l|xl|xxl|2xl|3xl)(?:$|\s|[.,!?;:()،؟])/iu;
    const suffixAvailabilityRegex = /(?:^|\s|[.,!?;:()،؟])(4[0-8]|3[5-9]|xs|s|m|l|xl|xxl|2xl|3xl)\s*(?:واش\s+)?(?:kayn|kayna|dispo|disponible|available|in\s+stock|متوفر|متوفرة|كاين|كاينة|\?|؟)(?:$|\s|[.,!?;:()،؟])/iu;
    const colorPrecedingSizeRegex = /(?:^|\s|[.,!?;:()،؟])(?:black|white|red|blue|noir|blanc|rouge|bleu|كحل|بيض|حمر|زرق|أسود|أبيض|أحمر|أزرق|فالأسود|بالأسود|فالكحل|بالكحل)\s+(4[0-8]|3[5-9]|xs|s|m|l|xl|xxl|2xl|3xl)(?:$|\s|[.,!?;:()،؟])/iu;
    const multiCharOrNumericRegex = /(?:^|\s|[.,!?;:()،؟])(4[0-8]|3[5-9]|xs|xl|xxl|2xl|3xl)(?:$|\s|[.,!?;:()،؟])/iu;
    const shortTurnIsolatedRegex = /^(?:(?:size|taille|قياس|f|en|in|فـ|ف)\s+)?(4[0-8]|3[5-9]|xs|s|m|l|xl|xxl|2xl|3xl)[.?!؟]*$/iu;

    const prefixMatch = raw.match(explicitSizePrefixRegex);
    const procliticMatch = raw.match(procliticSizeRegex);
    const suffixMatch = raw.match(suffixAvailabilityRegex);
    const colorPrecedingMatch = raw.match(colorPrecedingSizeRegex);
    const shortTurnMatch = raw.trim().match(shortTurnIsolatedRegex);
    const multiCharMatch = raw.match(multiCharOrNumericRegex);

    if (prefixMatch && prefixMatch[1]) {
      extractedSize = prefixMatch[1].toUpperCase();
    } else if (procliticMatch && procliticMatch[1]) {
      extractedSize = procliticMatch[1].toUpperCase();
    } else if (suffixMatch && suffixMatch[1]) {
      extractedSize = suffixMatch[1].toUpperCase();
    } else if (colorPrecedingMatch && colorPrecedingMatch[1]) {
      extractedSize = colorPrecedingMatch[1].toUpperCase();
    } else if (shortTurnMatch && shortTurnMatch[1]) {
      extractedSize = shortTurnMatch[1].toUpperCase();
    } else if (multiCharMatch && multiCharMatch[1]) {
      extractedSize = multiCharMatch[1].toUpperCase();
    }

    if (extractedSize) {
      entities.push({
        type: 'VARIANT',
        text: extractedSize,
        canonicalName: extractedSize,
        confidence: 0.95,
        metadata: { variantType: 'SIZE', value: extractedSize }
      });
    }

    if (extractedColor || extractedSize) {
      variants.push({ color: extractedColor || null, size: extractedSize || null });
    }

    // 6. Price Constraint
    const priceConstraintRegex = /(?:under|less\s+than|below|moins\s+de|اقل\s+من|أقل\s+من|ما\s+يفوتش|قل\s+من|b\s*9el\s*mn|b\s*qel\s*mn|9el\s*mn|b\s*a9al\s*mn|ta7t\s*mn)\s*(\d+(?:\.\d+)?)/iu;
    const priceMatch = raw.match(priceConstraintRegex);
    let extractedBudget: number | undefined;
    if (priceMatch && priceMatch[1]) {
      extractedBudget = parseFloat(priceMatch[1]);
      constraints.push({
        kind: 'MAX_PRICE',
        value: extractedBudget,
        rawText: priceMatch[0]
      });
    }

    // 7. Canonical Semantic Recommendation Concepts
    let extractedUseCase: string | undefined;
    if (/(?:daily\s+use|daily|everyday|every\s+day|tous\s+les\s+jours|quotidien|استعمال\s+يومي|للاستعمال\s+اليومي|كل\s+نهار|ل\s*كل\s*نهار|l\s*kol\s*nhar|lkol\s*nhar|kol\s*nhar|kolnhar|lyoum|kolyom)/iu.test(raw)) {
      extractedUseCase = 'daily_use';
    } else if (/(?:sports?|gym|running|outdoor|رياضة|للرياضة|d\s+sport|dyal\s+sport)/iu.test(raw)) {
      extractedUseCase = 'sports';
    } else if (/(?:casual|sortie|خرجة|خفيف)/iu.test(raw)) {
      extractedUseCase = 'casual';
    }

    let extractedSeason: string | undefined;
    if (/(?:winter|hiver|شتاء|الشتاء|الشتا|شتا|chita|chitta|chta|cold|froid|البرد|برد|lyali)/iu.test(raw)) {
      extractedSeason = 'winter';
    } else if (/(?:summer|été|ete|صيف|الصيف|skhon|sahed)/iu.test(raw)) {
      extractedSeason = 'summer';
    }

    // 8. Policy Intent Detection
    const returnsRegex = /(?:return|returns|returning|returned|retour|retours|retourner|remboursement|rembourser|échange|échanges|échanger|exchange|exchanges|refund|refunds|استرجاع|استبدال|إرجاع|ارجاع|الاسترجاع|الاستبدال|ترجيع|تبديل|نرجع|نرجعو|نرجعها|نبدل|نبدلو|نبدلها|rje3|nrje3|rje3o|nrje3o|bdel|nbdel|bdelo|nbdelo)/iu;
    const shippingRegex = /(?:shipping|delivery|deliver|deliveries|livraison|livrer|livrez|expédition|expédier|توصيل|التوصيل|شحن|الشحن|مصاريف\s+الشحن|ثمن\s+التوصيل|سعر\s+التوصيل|توصل|توصلو|كيوصل|يوصل|tewsil|tawsil|twsil|ywsl|twsl)/iu;
    const careRegex = /(?:care|wash|washing|how\s+to\s+wash|entretien|lavage|laver|comment\s+laver|غسيل|الغسيل|طريقة\s+الغسيل|كيفاش\s+نغسل|نغسل|نغسلو|تصبين|نصبن|عناية|العناية|تنظيف|nghsel|nghslo|ghsil|tasbin)/iu;
    const trackingRegex = /(?:tracking|suivi|suivre|suis\s+ma\s+commande|track|track\s+order|order\s+status|تتبع|التتبع|تتبع\s+الطلب|تتبع\s+طلبي|فين\s+وصل|نتبع\s+طلبي|نتبع\s+الطلب|fin\s+wsel|fin\s+wsl)/iu;
    const warrantyRegex = /(?:warranty|guarantee|garantie|ضمان|الضمان|daman|ldaman)/iu;
    const paymentRegex = /(?:payment|paiement|payer|cash\s+on\s+delivery|cod|دفع|الدفع|طريقة\s+الدفع|الدفع\s+عند\s+الاستلام|خلاص|نخلص|khalas|daf3)/iu;
    const storeInfoRegex = /(?:hours|opening\s+hours|business\s+hours|horaires|store\s+location|locations|branch|branches|boutique|magasin|أوقات\s+العمل|فرع|فروع|محل|محلات|فين\s+كاينين|عنوان|العنوان)/iu;

    if (returnsRegex.test(raw)) detectedIntents.push('RETURNS');
    if (shippingRegex.test(raw)) detectedIntents.push('SHIPPING');
    if (careRegex.test(raw)) detectedIntents.push('CARE');
    if (trackingRegex.test(raw)) detectedIntents.push('TRACKING');
    if (warrantyRegex.test(raw)) detectedIntents.push('WARRANTY');
    if (paymentRegex.test(raw)) detectedIntents.push('PAYMENT');
    if (storeInfoRegex.test(raw)) detectedIntents.push('STORE_INFO');

    // 9. Ecommerce Intent Detection
    // 9A. Price intent
    const priceKeywords = /(?:price|pricing|cost|costs|how\s+much|worth|prix|combien|coûte|coute|coûtent|coutent|vaut|valent|ثمن|الثمن|شحال\s+الثمن|بشحال|شحال|سعر|السعر|كيسوى|كاتسوى|يسوى|تسوى|كيساوي|يساوي|تساوي|كيعمل|شحال\s+كيدير|taman|bch7al|bchhal|ch7al|chhal|kayswa|katsswa|katswa|tswa|yswa|kaysawi|kaydir)/iu;
    const isReturnWindow = /(?:combien\s+de\s+temps\s+pour\s+(?:le\s+|l\s+)?(?:retourner|échanger)|délai\s+de\s+retour|how\s+long\s+(?:do\s+i\s+have\s+to|can\s+i)\s+(?:return|exchange)|return\s+window|شحال\s+عندي\s+من\s+الوقت\s+باش\s+نرجع|شحال\s+عندي\s+من\s+الوقت\s+باش\s+نبدل|قداش\s+بقا\s+ليا\s+باش\s+نبدل|chhal\s+3ndi\s+dlwa9t\s+bach\s+nrje3)/iu.test(raw);
    const isPolicyCostInquiry = /(?:combien\s+(?:coûte\s+)?(?:la\s+)?(?:livraison|l'expédition)|how\s+much\s+is\s+shipping|shipping\s+cost|delivery\s+fee|شحال\s+(?:الثمن\s+ديال\s+)?(?:التوصيل|الشحن)|بشحال\s+(?:التوصيل|الشحن)|ثمن\s+(?:التوصيل|الشحن)|سعر\s+(?:التوصيل|الشحن)|ch7al\s+twsil|chhal\s+tawsil|bch7al\s+twsil)/iu.test(raw);
    const hasExplicitProductPriceAsk = /(?:prix\s+d[ue]?\s+(?!livraison|retour|shipping|delivery)[a-zA-Z\u0600-\u06FF]+|quel\s+est\s+le\s+prix|what\s+is\s+the\s+price|price\s+of|how\s+much\s+is\s+(?:the\s+)?[a-zA-Z\u0600-\u06FF]+|combien\s+coûte|combien\s+coute|شحال\s+الثمن|شحال\s+ثمن\s+(?!التوصيل)|شحال\s+كيسوى|شحال\s+كاتسوى|شحال\s+كيدير|بشحال\s+كيسوى|كم\s+سعر\s+(?!التوصيل)|taman\s+dyal|ch7al\s+kayswa|عطيني\s+الثمن|بغيت\s+الثمن)/iu.test(raw);

    if (priceKeywords.test(raw) && !isReturnWindow && (!isPolicyCostInquiry || hasExplicitProductPriceAsk)) {
      detectedIntents.push('PRICE');
    }

    // 9B. Availability / Stock intent
    const availabilityKeywords = /(?:in\s+stock|available|availability|disponible|dispo|متوفر|كاين|واش\s+كاين|واش\s+كاينين|واش\s+متوفر|هل\s+متوفر|stock|kayn|dispo|tailles|sizes|مقاسات|المقاسات|القياسات|قياسات|نمر|نمرات|les\s+tailles|شنو\s+المقاسات|شنو\s+القياسات)/iu;
    if (availabilityKeywords.test(raw) || ((extractedColor || extractedSize) && /(?:do\s+you\s+have|avez-vous|avez\s+vous|واش\s+عندكم|عندكم)/iu.test(raw))) {
      detectedIntents.push('AVAILABILITY');
    }

    // 9C. Compare intent
    let comparisonTargets: ComparisonTarget[] | undefined;
    const compareKeywords = /(?:compare|comparer|comparaison|قارن|مقارنة|mo9arana|versus|vs)/iu;
    if (compareKeywords.test(raw)) {
      detectedIntents.push('COMPARE');
      comparisonTargets = [{ kind: 'CURRENT_CONTEXT' }];
      if (matchedCategory) {
        comparisonTargets.push({ kind: 'CATEGORY', value: matchedCategory, rawText: matchedCategory });
      }
    }

    // 9D. Recommendation intent
    let recommendationCriteria: RecommendationCriteria | undefined;
    const recommendationPhrases = /(?:best|recommend|recommendation|recommander|meilleur|meilleure|conseiller|conseille-moi|conseille\s+moi|أحسن|افضل|أفضل|شنو\s+أحسن|شنو\s+افضل|احسن\s+حاجة|ahsan|lmeilleur|bghit\s+chi\s+7aja|bghit\s+chi\s+haja|بغيت\s+شي\s+حاجة|بغيت\s+شي\s+حاجه|ach\s+t-?nss7ni|ach\s+tnss7ni|شنو\s+تنصحني|which\s+(?:one\s+)?should\s+i\s+(?:choose|get|buy)|quel\s+produit\s+choisir)/iu;
    const hasRecommendationSemantics = recommendationPhrases.test(raw) ||
      (Boolean(extractedUseCase || extractedSeason) && !entities.some(e => e.type === 'PRODUCT'));

    if (hasRecommendationSemantics) {
      detectedIntents.push('RECOMMENDATION');
      recommendationCriteria = {
        category: matchedCategory || undefined,
        useCase: extractedUseCase,
        season: extractedSeason,
        budget: extractedBudget,
        color: extractedColor,
        size: extractedSize
      };
    }

    // 9E. Product Search / Discovery intent
    const searchKeywords = /(?:show\s+me|find|search|looking\s+for|i\s+want|i\s+need|je\s+cherche|montre-moi|بغيت|نقلb|كنقلب|أريد|ابحث\s+عن|وريني|عندكم|واش\s+عندكم|bghit|kan9leb|wrini)/iu;
    if ((matchedCategory || searchKeywords.test(raw) || constraints.length > 0) && !hasRecommendationSemantics) {
      if (!detectedIntents.includes('PRICE') && !detectedIntents.includes('AVAILABILITY') && !detectedIntents.includes('COMPARE') && !detectedIntents.includes('RECOMMENDATION') && detectedIntents.length === 0) {
        detectedIntents.push('PRODUCT_SEARCH');
      }
    }

    // 10. Conversational Intents (Greeting / Handoff)
    if (HandoffService.isHandoffRequested(raw)) {
      detectedIntents.unshift('HANDOFF');
    } else {
      const normalizedGreet = GreetingRouter.normalize(raw);
      const hasQuestion = GreetingRouter.hasQuestionIndicator(raw, normalizedGreet);
      if (!hasQuestion && GreetingRouter.isKnownGreeting(normalizedGreet)) {
        detectedIntents.unshift('GREETING');
      }
    }

    // 11. Explicit vs Contextual Entity Invariants
    const hasExplicitCategory = Boolean(matchedCategory);
    const hasExplicitEntity = entities.some(e => e.type === 'PRODUCT' || e.type === 'CATEGORY');
    const hasContextualReference = references.length > 0;
    const hasVariantConstraint = variants.length > 0;
    const hasExplicitVariantConstraint = hasVariantConstraint && Boolean(extractedSize || extractedColor);
    const hasPolicyIntent = detectedIntents.some(i => ['RETURNS', 'SHIPPING', 'CARE', 'TRACKING', 'WARRANTY', 'PAYMENT', 'STORE_INFO'].includes(i));
    const hasEcommerceIntent = detectedIntents.some(i => ['PRODUCT_SEARCH', 'PRODUCT_DETAIL', 'PRICE', 'AVAILABILITY', 'VARIANT_SELECTION', 'COMPARE', 'RECOMMENDATION'].includes(i));
    const isMultiIntent = detectedIntents.length > 1;

    // 11B. Policy Scope Classification
    let policyScope: PolicyScope | undefined;
    let hasProductScopedPolicy = false;
    let hasGlobalPolicyIntent = false;
    let hasContextualProductReference = false;

    if (hasPolicyIntent) {
      // Check for explicit product entity/category in the turn
      const explicitProduct = entities.some(e => e.type === 'PRODUCT') || hasExplicitCategory;

      // Check for anaphoric / contextual pronoun targeting product
      const productAnaphoraRegex = /(?:^|\s|[.,!?;:()،؟])(?:نرجعو|نرجعها|نبدلو|نبدلها|نغسلو|نغسلها|رجعو|بدلو|غسلو|le\s+retourner|la\s+retourner|l['’]échanger|l['’]echanger|le\s+laver|la\s+laver|le\s+changer|return\s+it|exchange\s+it|wash\s+it|clean\s+it|ce\s+produit|cet\s+article|this\s+product|this\s+item|هاد\s+المنتج|هاد\s+السلعة|هاد\s+البياسة)(?:$|\s|[.,!?;:()،؟])/iu;
      const hasExplicitAnaphora = productAnaphoraRegex.test(raw);

      if (explicitProduct) {
        policyScope = 'PRODUCT_POLICY';
        hasProductScopedPolicy = true;
      } else if (hasExplicitAnaphora) {
        policyScope = 'CONTEXTUAL_PRODUCT_REFERENCE';
        hasProductScopedPolicy = true;
        hasContextualProductReference = true;
      } else {
        policyScope = 'GLOBAL_POLICY';
        hasGlobalPolicyIntent = true;
      }
    }

    // Short Follow-Up Contract (Section 6)
    const isContextualVariantFollowUp = (hasVariantConstraint || /(?:kayn|dispo|متوفر|موجود|available|in\s+stock)/i.test(raw)) && !hasExplicitEntity && !hasExplicitCategory;

    if (isContextualVariantFollowUp && (detectedIntents.length === 0 || detectedIntents.includes('GENERAL'))) {
      detectedIntents.unshift(hasVariantConstraint ? 'VARIANT_SELECTION' : 'AVAILABILITY');
    }

    // 11C. Context Scope
    let contextScope: ContextScope = 'GLOBAL';
    if (productContext?.unresolvedTarget && !hasExplicitEntity && !hasExplicitCategory) {
      contextScope = 'UNRESOLVED';
    } else if (hasExplicitEntity || hasExplicitCategory) {
      contextScope = 'PRODUCT';
    } else if (hasVariantConstraint || isContextualVariantFollowUp) {
      contextScope = 'VARIANT';
    } else if (hasContextualReference || hasContextualProductReference) {
      contextScope = 'REFERENCE';
    } else {
      contextScope = 'GLOBAL';
    }

    // 12. Fallback / General intent if none matched
    if (detectedIntents.length === 0) {
      detectedIntents.push('GENERAL');
    }

    const primaryIntent: TurnIntent = detectedIntents[0];
    const secondaryIntents: TurnIntent[] = detectedIntents.slice(1);

    return {
      rawText: raw,
      normalizedText,
      primaryIntent,
      secondaryIntents,
      entities,
      references,
      categories,
      variants,
      constraints,
      comparisonTargets,
      recommendationCriteria,
      policyScope,
      contextScope,
      responseLanguage,
      responseScript,
      confidence: 0.95,
      hasExplicitEntity,
      hasContextualReference,
      hasExplicitCategory,
      hasVariantConstraint,
      hasExplicitVariantConstraint,
      hasPolicyIntent,
      hasEcommerceIntent,
      isMultiIntent,
      isContextualVariantFollowUp,
      hasProductScopedPolicy,
      hasGlobalPolicyIntent,
      hasContextualProductReference
    };
  }
}
