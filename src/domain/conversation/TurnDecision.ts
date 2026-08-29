import { ProductContext } from './ConversationContext';
import { ExtractedCommerceParams, EcommerceIntentParser, AttributeFamily } from '../ecommerce/EcommerceIntent';
import { ProductFact } from '../ecommerce/EcommerceService';
import { LanguageDetector, SupportedLanguage } from '../faq/FaqMatcher';
import { GreetingRouter } from './GreetingRouter';
import { HandoffService } from './HandoffService';

import { PolicyEvidenceReuse } from '../rag/PolicyEvidenceReuse';
import { ShippingScopeConfig } from '../tenant/BusinessConfig';

export type TurnDomain =
  | 'GENERAL'
  | 'ECOMMERCE'
  | 'KNOWLEDGE'
  | 'SUPPORT'
  | 'WORKFLOW'
  | 'HANDOFF'
  | 'FAQ'
  | 'GREETING';

export type TurnDecisionSource =
  | 'DETERMINISTIC'
  | 'ECOMMERCE'
  | 'RAG'
  | 'HYBRID'
  | 'LLM';

export interface TurnDecision {
  domain: TurnDomain;
  intent: string;
  productId?: string | null;
  productName?: string | null;
  category?: string | null;
  sku?: string | null;
  variantId?: string | null;
  color?: string | null;
  size?: string | null;
  attributeFamily?: AttributeFamily | null;
  attributeKeywords?: string | null;
  attributeName?: string | null;
  searchKeywords?: string | null;
  ordinalIndex?: number | null;
  maxPrice?: number | null;
  compareProductNames?: string[] | null;
  requestedMediaType?: 'image' | 'video' | null;
  isMultiPolicy?: boolean;
  policyIntents?: string[] | null;
  isComparative?: boolean;
  isPluralReference?: boolean;
  isScopeExpansion?: boolean;
  source: TurnDecisionSource;
  responseLanguage: string;
  responseScript: string;
  confidence?: number;
  metadata?: Record<string, any>;
}

export interface TurnDecisionInput {
  text: string;
  language?: SupportedLanguage | string;
  script?: string;
  productContext?: ProductContext | null;
  activePolicyEvidence?: Record<string, any[]> | null;
  activePolicyIntent?: string | null;
  ecommerceParams?: ExtractedCommerceParams | null;
  category?: string | null;
  catalogCategories?: string[] | null;
  customCategoryAliases?: Record<string, string[]> | null;
  customAttributeAliases?: Record<string, string[]> | null;
  candidateMetadataKeys?: string[] | null;
  shippingScope?: ShippingScopeConfig | null;
  domesticCountry?: string | null;
  resolvedProductFact?: ProductFact | null;
  resolvedSearchResults?: any[] | null;
  ragChunks?: any[] | null;
  matchedFaqId?: string | null;
  isGreeting?: boolean;
  isHandoff?: boolean;
  isWorkflow?: boolean;
  isSafetyViolation?: boolean;
  isHybrid?: boolean;
  isEcommerceEnabled?: boolean;
  responseSource?: 'FAQ' | 'RAG' | 'LLM' | 'WORKFLOW' | 'IMAGE' | 'FALLBACK' | 'GREETING' | 'CAP' | 'ECOMMERCE' | 'HANDOFF' | 'HUMAN_AGENT' | 'SAFETY_GUARD';
  confidence?: number;
}

export interface PolicySignals {
  isPolicy: boolean;
  intent: 'RETURNS' | 'CARE' | 'SHIPPING' | 'TRACKING' | 'WARRANTY' | 'PAYMENT' | 'STORE_INFO' | 'SUPPORT' | 'SIZE_GUIDE' | 'KNOWLEDGE_RETRIEVAL';
  matchedCategories: string[];
  isMultiPolicy: boolean;
}

export class TurnDecisionResolver {
  private static readonly RETURNS_TERMS = /(?:return|returns|returning|returned|retour|retours|retourner|remboursement|rembourser|remboursé|rendre|reprise|échange|échanges|échanger|echange|echanger|exchange|exchanges|exchanging|exchanged|refund|refunds|refunding|refunded|send\s+back|money\s+back|استرجاع|استبدال|إرجاع|ارجاع|الإرجاع|الارجاع|الاسترجاع|الاستبدال|ترجيع|الترجيع|تبديل|التبديل|نرجع|نرجعو|نرجعها|نرجعوا|نرجعوه|نرجعهم|نبدل|نبدلو|نبدلها|نبدلوه|نبدلوا|رجع|بدل|يرجع|يبدل|ترجع|تبدل|rje3|nrje3|rje3o|nrje3o|rje3ha|nrje3ha|bdel|nbdel|bdelo|nbdelo|nbdelha|tabdil|tarji3|istirja3|istibdal)/iu;

  private static readonly RETURNS_WINDOW_PATTERNS = /(?:combien\s+de\s+temps\s+pour\s+(?:le\s+|l\s+)?(?:retourner|échanger|echange|changer)|délai\s+de\s+retour|delai\s+de\s+retour|délai\s+d['’]échange|delai\s+d['’]echange|how\s+long\s+(?:do\s+i\s+have\s+to|can\s+i)\s+(?:return|exchange)|how\s+many\s+days\s+(?:to|for)\s+(?:return|exchange)|return\s+window|exchange\s+window|return\s+period|exchange\s+period|شحال\s+عندي\s+من\s+الوقت\s+باش\s+نرجع|شحال\s+عندي\s+من\s+الوقت\s+باش\s+نبدل|شحال\s+ديال\s+الوقت\s+باش\s+نرجع|شحال\s+ديال\s+الوقت\s+باش\s+نبدل|قداش\s+بقا\s+ليا\s+باش\s+نبدل|قداش\s+بقا\s+ليا\s+باش\s+نرجع|قداش\s+عندي\s+من\s+الوقت\s+باش\s+نرجع|قداش\s+عندي\s+من\s+الوقت\s+باش\s+نبدل|مدة\s+الإرجاع|مدة\s+الاسترجاع|مدة\s+التبديل|أجل\s+الإرجاع|أجل\s+الاسترجاع|أجل\s+التبديل|مهلة\s+الإرجاع|مهلة\s+الاسترجاع|مهلة\s+التبديل|chhal\s+3ndi\s+dlwa9t\s+bach\s+nrje3|chhal\s+3ndi\s+dlwa9t\s+bach\s+nbdel|chhal\s+d\s+lwa9t\s+bach\s+nrje3|chhal\s+d\s+lwa9t\s+bach\s+nbdel|9adach\s+b9a\s+lia\s+bach\s+nbdel|9adach\s+b9a\s+lia\s+bach\s+nrje3|qadach\s+b9a\s+lia|9eddach\s+b9a\s+lia|9dach\s+b9a\s+lia|combien\s+de\s+temps\s+pour\s+retourner)/iu;

  private static readonly CARE_TERMS = /(?:care|wash|washing|how\s+to\s+wash|care\s+instructions|cleaning|maintenance|entretien|lavage|laver|comment\s+laver|nettoyage|غسيل|الغسيل|طريقة\s+الغسيل|كيفاش\s+نغسل|كيفية\s+الغسيل|نغسل|نغسلو|نغسلها|تصبين|التصبين|نصبن|نصبنو|نعتني|عناية|العناية|تنظيف|التنظيف|nghsel|nghslo|nghselha|ghsil|lghsil|tghsel|tasbin|nsben|nsbno)/iu;

  private static readonly SHIPPING_TERMS = /(?:ship|shipping|delivery|deliver|deliveries|delivered|livraison|livrer|livrez|livré|expédition|expédier|envoi|envoyer|توصيل|التوصيل|شحن|الشحن|مصاريف\s+الشحن|ثمن\s+التوصيل|سعر\s+التوصيل|وقت\s+التوصيل|مدة\s+التوصيل|توصل|توصلو|كيوصل|كتوصل|يوصل|يوصلو|توصلني|يوصلني|tewsil|tawsil|tawseel|twsil|ywsl|twsl|kiwsl|kitwsl|ywsal|twsal|katwssl|ktwssl|twssl|katwsslo|ktwsslo|twsslo)/iu;

  private static readonly TRACKING_TERMS = /(?:tracking|suivi|suivre|suis\s+ma\s+commande|trace|track|track\s+order|order\s+status|where\s+is\s+my\s+order|où\s+est\s+ma\s+commande|ou\s+est\s+ma\s+commande|تتبع|التتبع|تتبع\s+الطلب|تتبع\s+طلبي|فين\s+وصل|فين\s+واصل|فين\s+كاين\s+الطلب|نتبع\s+طلبي|نتبع\s+الطلب|فين\s+وصل\s+الطلب|فين\s+وصل\s+طلبي|fin\s+wsel|fin\s+wsl)/iu;

  private static readonly WARRANTY_TERMS = /(?:warranty|guarantee|garantie|garantir|ضمان|الضمان|daman|ldaman)/iu;

  private static readonly PAYMENT_TERMS = /(?:payment|paiement|payer|cash\s+on\s+delivery|cod|moyen\s+de\s+paiement|modes\s+de\s+paiement|دفع|الدفع|طريقة\s+الدفع|طرق\s+الدفع|الدفع\s+عند\s+الاستلام|الدفع\s+عند\s+التسليم|خلاص|الخلاص|نخلص|نخلصو|باش\s+نخلص|khalas|l5las|n5les|daf3|dafa3)/iu;

  private static readonly STORE_INFO_TERMS = /(?:hours|opening\s+hours|business\s+hours|horaires|heures\s+d['’]ouverture|store\s+location|locations|branch|branches|boutique|magasin|magasins|أوقات\s+العمل|ساعات\s+العمل|مواعيد|فرع|فروع|محل|محلات|موقعكم|فين\s+كاينين|عنوان|العنوان|frou3|fara3|politique)/iu;

  private static readonly SUPPORT_TERMS = /(?:support\s+email|support\s+phone|phone\s+number|contact\s+support|email\s+support|contactez|contacter|comment\s+contacter|how\s+to\s+contact|how\s+to\s+reach|numéro|numero|téléphone|telephone|رقم\s+الهاتف|إيميل\s+الدعم|ايميل\s+الدعم|إيميل|ايميل|نمرة|السيبور|nemra|sipo?rt|تواصل\s+مع|اتصال\s+ب)/iu;

  private static readonly SIZE_GUIDE_TERMS = /(?:size\s+guide|size\s+chart|size\s+recommendation|which\s+size|what\s+size|which\s+size\s+fits|what\s+fits|size\s+should|guide\s+des\s+tailles|guide\s+de\s+taille|tableau\s+des\s+tailles|quelle\s+taille|quelle\s+est\s+ma\s+taille|choisir\s+(?:sa\s+|une\s+)?taille|دليل\s+المقاسات|جدول\s+المقاسات|المقاس\s+المناسب|أي\s+مقاس|اي\s+مقاس|ما\s+هو\s+المقاس|شكون\s+لاطاي|شنو\s+هي\s+لاطاي|شمن\s+طاي|شمن\s+لاطاي|la\s+taille\s+li\s+tji|la\s+taille\s+li\s+mzyana|ashna\s+hiya\s+la\s+taille|tour\s+de\s+poitrine|chest\s+measurement|body\s+measurement|chest\s+size|\bchest\b.*?\b(?:cm|fits?|size)\b|\b(?:cm|fits?|size)\b.*?\bchest\b|محيط\s+الصدر|قياس\s+الصدر|مقاس\s+الصدر|\bالصدر\b.*?\b(?:سم|cm|مقاس|يناسب|واش|ناخد|ناخذ)\b|(?:سم|cm).*?\b(?:الصدر|صدر)\b|\b(?:الصدر|صدر)\b.*?(?:سم|cm)|f\s+(?:l-)?sder|f-sder|sder.*?(?:cm|taille|size)|\d+\s*(?:cm|سم).*?(?:chest|poitrine|sder|صدر|الصدر|taille|size|fits?)|(?:chest|poitrine|sder|صدر|الصدر|taille|size|fits?).*?\d+\s*(?:cm|سم))/iu;

  /**
   * Deterministically classifies policy signals from user input text.
   */
  public static detectPolicySignals(text: string): PolicySignals {
    const lower = text.toLowerCase().trim();

    const isReturns = this.RETURNS_TERMS.test(lower) || this.RETURNS_WINDOW_PATTERNS.test(lower);
    const isCare = this.CARE_TERMS.test(lower);
    const isShipping = this.SHIPPING_TERMS.test(lower);
    const isTracking = this.TRACKING_TERMS.test(lower);
    const isWarranty = this.WARRANTY_TERMS.test(lower);
    const isPayment = this.PAYMENT_TERMS.test(lower);
    const isSizeGuide = this.SIZE_GUIDE_TERMS.test(lower);
    const isSupport = this.SUPPORT_TERMS.test(lower);
    const isStoreInfo = this.STORE_INFO_TERMS.test(lower);

    const isPolicy = isReturns || isCare || isShipping || isTracking || isWarranty || isPayment || isSizeGuide || isSupport || isStoreInfo;

    let intent: PolicySignals['intent'] = 'KNOWLEDGE_RETRIEVAL';
    if (isReturns) intent = 'RETURNS';
    else if (isCare) intent = 'CARE';
    else if (isShipping) intent = 'SHIPPING';
    else if (isTracking) intent = 'TRACKING';
    else if (isWarranty) intent = 'WARRANTY';
    else if (isPayment) intent = 'PAYMENT';
    else if (isSizeGuide) intent = 'SIZE_GUIDE';
    else if (isSupport) intent = 'SUPPORT';
    else if (isStoreInfo) intent = 'STORE_INFO';

    const matched: string[] = [];
    if (isReturns) matched.push('RETURNS');
    if (isCare) matched.push('CARE');
    if (isShipping) matched.push('SHIPPING');
    if (isTracking) matched.push('TRACKING');
    if (isWarranty) matched.push('WARRANTY');
    if (isPayment) matched.push('PAYMENT');
    if (isSizeGuide) matched.push('SIZE_GUIDE');
    if (isSupport) matched.push('SUPPORT');
    if (isStoreInfo) matched.push('STORE_INFO');

    return {
      isPolicy,
      intent,
      matchedCategories: matched,
      isMultiPolicy: matched.length > 1
    };
  }

  /**
   * Deterministically detects the script from text and language.
   */
  public static detectScript(text: string, lang: string): string {
    const arabicCharCount = (text.match(/[\u0600-\u06FF]/g) || []).length;
    if (arabicCharCount > 0 && arabicCharCount / Math.max(1, text.length) > 0.15) {
      return 'arabic';
    }
    if (lang === 'darija') {
      return 'arabizi';
    }
    if (lang === 'fr' || lang === 'en') {
      return 'latin';
    }
    return 'standard';
  }

  /**
   * Resolves a canonical, authoritative TurnDecision for a conversational turn.
   */
  public static resolve(input: TurnDecisionInput): TurnDecision {
    const text = (input.text || '').trim();
    const language = (input.language || LanguageDetector.detect(text)) as SupportedLanguage;
    const responseScript = input.script || this.detectScript(text, language);

    // 1. Safety Guard Refusal
    if (input.isSafetyViolation || input.responseSource === 'SAFETY_GUARD') {
      return {
        domain: 'GENERAL',
        intent: 'SAFETY_REFUSAL',
        source: 'DETERMINISTIC',
        responseLanguage: language,
        responseScript,
        confidence: 1.0
      };
    }

    // 2. Human Handoff
    const isHandoff = input.isHandoff ?? HandoffService.isHandoffRequested(text);
    if (isHandoff || input.responseSource === 'HANDOFF') {
      return {
        domain: 'HANDOFF',
        intent: 'HANDOFF_REQUEST',
        source: 'DETERMINISTIC',
        responseLanguage: language,
        responseScript,
        confidence: 1.0
      };
    }

    // 3. Workflow Session
    if (input.isWorkflow || input.responseSource === 'WORKFLOW') {
      return {
        domain: 'WORKFLOW',
        intent: 'WORKFLOW_STEP',
        source: 'DETERMINISTIC',
        responseLanguage: language,
        responseScript,
        confidence: input.confidence ?? 1.0
      };
    }

    // 4. Greeting
    const normalized = GreetingRouter.normalize(text);
    const hasQuestion = GreetingRouter.hasQuestionIndicator(text, normalized);
    const isGreeting = input.isGreeting ?? (!hasQuestion && GreetingRouter.isKnownGreeting(normalized));
    if (isGreeting || input.responseSource === 'GREETING') {
      return {
        domain: 'GREETING',
        intent: 'GREETING',
        source: input.responseSource === 'LLM' ? 'LLM' : 'DETERMINISTIC',
        responseLanguage: language,
        responseScript,
        confidence: input.confidence ?? 1.0
      };
    }

    // 5. FAQ
    if (input.matchedFaqId || input.responseSource === 'FAQ') {
      return {
        domain: 'FAQ',
        intent: 'FAQ_ANSWER',
        source: 'DETERMINISTIC',
        responseLanguage: language,
        responseScript,
        confidence: input.confidence ?? 0.9,
        metadata: { faqId: input.matchedFaqId }
      };
    }

    const isEcommerceEnabled = input.isEcommerceEnabled !== false;

    // 6. Parse ecommerce params if not supplied and ecommerce is enabled
    const ecomParams = isEcommerceEnabled
      ? (input.ecommerceParams !== undefined
          ? input.ecommerceParams
          : EcommerceIntentParser.parse(text, input.productContext, language as any, {
              catalogCategories: input.catalogCategories,
              customCategoryAliases: input.customCategoryAliases,
              customAttributeAliases: input.customAttributeAliases,
              candidateMetadataKeys: input.candidateMetadataKeys
            }))
      : null;

    // 7. Policy / Knowledge / Hybrid Detection
    const policySignals = this.detectPolicySignals(text);
    const isPolicyQuery = policySignals.isPolicy;
    const policyIntent = policySignals.intent;
    const isMultiPolicy = policySignals.isMultiPolicy;
    const policyIntents = policySignals.matchedCategories.length > 0
      ? policySignals.matchedCategories.slice(0, 4)
      : null;

    let explicitProductName = ecomParams?.productName || null;
    if (explicitProductName && (EcommerceIntentParser.isNonProductReference(explicitProductName, input.catalogCategories, input.customCategoryAliases, input.customAttributeAliases, input.candidateMetadataKeys) || explicitProductName.length <= 2)) {
      explicitProductName = null;
    }

    if (!explicitProductName && isPolicyQuery) {
      const prodInPolicyPattern = /(?:بـ|ب|في|f|fl|pour|sur|3la|de|du|dial|dyal|ديال|بخصوص|حول|عن|باش\s+نرجع|باش\s+نبدل|باش\s+نغسل|to\s+return|to\s+exchange|to\s+wash|pour\s+retourner|pour\s+échanger|pour\s+laver)\s+([a-zA-Z\u0600-\u06FF\s-]+)/iu;
      const attachedProdPattern = /(?:^|\s)(?:بـ|ب|لـ|ل)([a-zA-Z\u0600-\u06FF\s-]+)/iu;
      const prodMatch = text.match(prodInPolicyPattern) || text.match(attachedProdPattern);
      if (prodMatch && prodMatch[1]) {
        let candidate = prodMatch[1].replace(/[?؟,،.!;:()[\]{}'"]/g, '').trim();
        candidate = candidate.replace(/^(?:retour|retours|refund|exchange|livraison|shipping|delivery|care|wash|guide|politique|استرجاع|استبدال|إرجاع|ارجاع|ترجيع|توصيل|شحن|غسيل|نغسل|عناية|باش\s+نرجع|باش\s+نبدل|باش\s+نغسل)\s*(?:de|du|pour|sur|3la|dial|dyal|ديال|حول)?\s*/iu, '').trim();
        if (!EcommerceIntentParser.isNonProductReference(candidate, input.catalogCategories, input.customCategoryAliases, input.customAttributeAliases, input.candidateMetadataKeys) && candidate.length > 2) {
          explicitProductName = EcommerceIntentParser.cleanProductName(candidate, input.catalogCategories, input.customCategoryAliases, input.customAttributeAliases, input.candidateMetadataKeys);
        }
      }
    }

    const isAnaphoricPolicyQuery = isPolicyQuery && (
      /(?:ديالو|ديالها|عليه|عليها|منو|منها|نغسلو|نرجعو|نبدلو|هذا|هادي|هادشي|dyalo|dyalha|3lih|3liha|it|this|that|ce produit|cet article)/iu.test(text.toLowerCase())
    );

    const hasProductMention = Boolean(
      explicitProductName ||
      (ecomParams?.sku && !EcommerceIntentParser.isNonProductReference(ecomParams.sku, input.catalogCategories, input.customCategoryAliases)) ||
      (isAnaphoricPolicyQuery && input.productContext?.selectedProductId)
    );

    const resolvedContext = this.resolveProductContext(ecomParams, input.productContext, isPolicyQuery, hasProductMention, input.catalogCategories, input.customCategoryAliases);

    const resolvedProdId = input.resolvedProductFact?.product?.id ||
      (isPolicyQuery ? (hasProductMention ? (input.productContext?.selectedProductId || null) : null) : resolvedContext.productId) ||
      input.resolvedSearchResults?.[0]?.product?.id ||
      null;

    const resolvedVariantId = input.resolvedProductFact?.selectedVariant?.id ||
      (isPolicyQuery ? (hasProductMention ? (input.productContext?.selectedVariantId || null) : null) : resolvedContext.variantId) ||
      null;

    const resolvedColor = (input.resolvedProductFact?.selectedVariant?.color ||
      (isPolicyQuery ? (hasProductMention ? (input.productContext?.selectedColor || null) : null) : resolvedContext.color) ||
      null) as string | null;

    const resolvedSize = (input.resolvedProductFact?.selectedVariant?.size ||
      (isPolicyQuery ? (hasProductMention ? (input.productContext?.selectedSize || null) : null) : resolvedContext.size) ||
      null) as string | null;

    const isComparative = isEcommerceEnabled && Boolean(
      ecomParams?.intent === 'COMPARE' ||
      ecomParams?.intent === 'RECOMMENDATION' ||
      /(?:cheaper|recommend|best\s+seller|which\s+one|شكون\s+أرخص|أرخص|rkhis|arkhas)\b/iu.test(text)
    );

    const isPluralReference = Boolean(
      /(?:they|them|those|oversized|wash\s+homa|homa)\b/iu.test(text)
    );

    const isScopeExpansion = Boolean(
      PolicyEvidenceReuse.isScopeExpanded(policyIntent, text, undefined, input.shippingScope, input.domesticCountry)
    );

    // Rule A: Active policy context follow-up (e.g. SHIPPING) vs generic price keyword
    const hasActiveShippingContext = Boolean(
      input.activePolicyEvidence?.SHIPPING?.length ||
      (input.productContext as any)?.activePolicyIntent === 'SHIPPING' ||
      input.activePolicyIntent === 'SHIPPING'
    );
    const hasDestinationPreposition = /(?:^|\s|[.,!?;:()،؟])(?:l-|pour|to|vers|dans|f-|en|in|لـ?|فـ?|في|إلى|الى|بـ?)\s*[\p{L}\p{N}]+/iu.test(text);
    const isGenericPriceFollowUp = isEcommerceEnabled && ecomParams?.intent === 'PRICE' && !explicitProductName && !ecomParams?.sku && !ecomParams?.category;

    if (hasActiveShippingContext && hasDestinationPreposition && isGenericPriceFollowUp) {
      return {
        domain: 'KNOWLEDGE',
        intent: 'SHIPPING',
        source: 'RAG',
        productId: null,
        productName: null,
        category: null,
        sku: null,
        variantId: null,
        color: null,
        size: null,
        searchKeywords: null,
        ordinalIndex: null,
        maxPrice: null,
        compareProductNames: null,
        isMultiPolicy: false,
        policyIntents: ['SHIPPING'],
        isComparative,
        isPluralReference,
        isScopeExpansion: true,
        responseLanguage: language,
        responseScript,
        confidence: 0.95
      };
    }

    // Rule D: Implicit Superlative / Comparative Query with Candidate Set >= 2
    const isSuperlativeComparison = isEcommerceEnabled && Boolean(
      isComparative ||
      /(?:which\s+(?:one\s+)?is|lequel\s+est|(?:و\s*)?شكون\s+(?:فيهم\s+)?(?:الأرخص|الارخص|أحسن|افضل|أفضل)|chkoun\s+fihom|chkon\s+fihom|(?:و\s*)?شكون\s+أرخص|(?:و\s*)?شكون\s+ارخص)\b/iu.test(text)
    );
    const candidateIds = input.productContext?.lastViewedProductIds || [];

    if (isEcommerceEnabled && isSuperlativeComparison && candidateIds.length >= 2 && (!explicitProductName || EcommerceIntentParser.isNonProductReference(explicitProductName, input.catalogCategories, input.customCategoryAliases))) {
      return {
        domain: 'ECOMMERCE',
        intent: 'COMPARE',
        source: 'ECOMMERCE',
        productId: null,
        productName: null,
        category: ecomParams?.category || null,
        sku: null,
        variantId: null,
        color: ecomParams?.color || null,
        size: ecomParams?.size || null,
        attributeFamily: ecomParams?.attributeFamily || null,
        attributeKeywords: ecomParams?.attributeKeywords || null,
        attributeName: ecomParams?.attributeName || null,
        searchKeywords: ecomParams?.searchKeywords || null,
        ordinalIndex: null,
        maxPrice: ecomParams?.maxPrice ?? null,
        compareProductNames: null,
        isComparative: true,
        isPluralReference,
        isScopeExpansion,
        responseLanguage: language,
        responseScript,
        confidence: 0.95
      };
    }

    if (input.isHybrid || (isPolicyQuery && hasProductMention)) {
      return {
        domain: 'KNOWLEDGE',
        intent: policyIntent,
        source: 'HYBRID',
        productId: resolvedProdId,
        productName: explicitProductName,
        category: ecomParams?.category || null,
        sku: ecomParams?.sku || null,
        variantId: resolvedVariantId,
        color: resolvedColor,
        size: resolvedSize,
        searchKeywords: ecomParams?.searchKeywords || null,
        ordinalIndex: ecomParams?.ordinalIndex ?? null,
        maxPrice: ecomParams?.maxPrice ?? null,
        compareProductNames: ecomParams?.compareProductNames || null,
        requestedMediaType: ecomParams?.requestedMediaType ?? null,
        isMultiPolicy,
        policyIntents,
        isComparative,
        isPluralReference,
        isScopeExpansion,
        responseLanguage: language,
        responseScript,
        confidence: input.confidence ?? 0.85
      };
    }

    if (isPolicyQuery || input.responseSource === 'RAG') {
      return {
        domain: 'KNOWLEDGE',
        intent: policyIntent,
        source: input.responseSource === 'LLM' ? 'LLM' : 'RAG',
        productId: null,
        productName: null,
        category: ecomParams?.category || null,
        sku: null,
        variantId: null,
        color: null,
        size: null,
        searchKeywords: ecomParams?.searchKeywords || null,
        ordinalIndex: ecomParams?.ordinalIndex ?? null,
        maxPrice: ecomParams?.maxPrice ?? null,
        compareProductNames: ecomParams?.compareProductNames || null,
        requestedMediaType: ecomParams?.requestedMediaType ?? null,
        isMultiPolicy,
        policyIntents,
        isComparative,
        isPluralReference,
        isScopeExpansion,
        responseLanguage: language,
        responseScript,
        confidence: input.confidence ?? 0.85
      };
    }

    // 8. Ecommerce Domain (only when ecommerce is enabled)
    if (
      isEcommerceEnabled &&
      (input.responseSource === 'ECOMMERCE' ||
      (ecomParams && ['BUY_INTENT', 'PRODUCT_SEARCH', 'PRODUCT_DETAIL', 'ATTRIBUTE_QUERY', 'PRICE', 'AVAILABILITY', 'VARIANT_SELECTION', 'COMPARE', 'RECOMMENDATION'].includes(ecomParams.intent)))
    ) {
      return {
        domain: 'ECOMMERCE',
        intent: ecomParams?.intent || 'ECOMMERCE_INQUIRY',
        source: 'ECOMMERCE',
        productId: resolvedProdId,
        productName: ecomParams?.productName || null,
        category: ecomParams?.category || null,
        sku: ecomParams?.sku || null,
        variantId: resolvedVariantId,
        color: resolvedColor,
        size: resolvedSize,
        attributeFamily: ecomParams?.attributeFamily || null,
        attributeKeywords: ecomParams?.attributeKeywords || null,
        attributeName: ecomParams?.attributeName || null,
        searchKeywords: ecomParams?.searchKeywords || null,
        ordinalIndex: ecomParams?.ordinalIndex ?? null,
        maxPrice: ecomParams?.maxPrice ?? null,
        compareProductNames: ecomParams?.compareProductNames || null,
        requestedMediaType: ecomParams?.requestedMediaType ?? null,
        isComparative,
        isPluralReference,
        isScopeExpansion,
        responseLanguage: language,
        responseScript,
        confidence: input.confidence ?? 0.95
      };
    }

    // 9. General / LLM / Fallback
    return {
      domain: 'GENERAL',
      intent: input.responseSource === 'FALLBACK' ? 'FALLBACK' : 'GENERAL_CONVERSATION',
      source: input.responseSource === 'FALLBACK' ? 'DETERMINISTIC' : 'LLM',
      productId: resolvedProdId,
      productName: ecomParams?.productName || null,
      category: ecomParams?.category || null,
      sku: ecomParams?.sku || null,
      variantId: resolvedVariantId,
      color: resolvedColor,
      size: resolvedSize,
      attributeFamily: ecomParams?.attributeFamily || null,
      attributeKeywords: ecomParams?.attributeKeywords || null,
      attributeName: ecomParams?.attributeName || null,
      searchKeywords: ecomParams?.searchKeywords || null,
      ordinalIndex: ecomParams?.ordinalIndex ?? null,
      maxPrice: ecomParams?.maxPrice ?? null,
      compareProductNames: ecomParams?.compareProductNames || null,
      requestedMediaType: ecomParams?.requestedMediaType ?? null,
      isComparative,
      isPluralReference,
      isScopeExpansion,
      responseLanguage: language,
      responseScript,
      confidence: input.confidence ?? 0.5
    };
  }

  /**
   * Universal Context Invariant Resolver:
   * 1. IF explicit product or category exists: use explicit target, ignore stale productContext.
   * 2. ELSE IF anaphoric / follow-up query: inherit active context.
   * 3. ELSE: no implicit product inheritance.
   */
  public static resolveProductContext(
    extracted: ExtractedCommerceParams | null | undefined,
    context: ProductContext | null | undefined,
    isPolicyQuery: boolean = false,
    hasProductMention: boolean = false,
    catalogCategories?: string[] | null,
    customCategoryAliases?: Record<string, string[]> | null
  ): {
    productId: string | null;
    variantId: string | null;
    sku: string | null;
    color: string | null;
    size: string | null;
    isExplicit: boolean;
  } {
    if (isPolicyQuery) {
      if (!hasProductMention) {
        return {
          productId: null,
          variantId: null,
          sku: null,
          color: null,
          size: null,
          isExplicit: false
        };
      }
      const isExplicit = Boolean(
        (extracted?.sku && !EcommerceIntentParser.isNonProductReference(extracted.sku, catalogCategories, customCategoryAliases)) ||
        (extracted?.productName && !EcommerceIntentParser.isNonProductReference(extracted.productName, catalogCategories, customCategoryAliases)) ||
        extracted?.category
      );
      return {
        productId: isExplicit ? null : (context?.selectedProductId || null),
        variantId: isExplicit ? null : (context?.selectedVariantId || null),
        sku: extracted?.sku || (isExplicit ? null : context?.selectedSku || null),
        color: extracted?.color || (isExplicit ? null : context?.selectedColor || null),
        size: extracted?.size || (isExplicit ? null : context?.selectedSize || null),
        isExplicit
      };
    }

    const isExplicit = Boolean(
      (extracted?.sku && !EcommerceIntentParser.isNonProductReference(extracted.sku, catalogCategories, customCategoryAliases)) ||
      (extracted?.productName && !EcommerceIntentParser.isNonProductReference(extracted.productName, catalogCategories, customCategoryAliases)) ||
      (extracted?.category && !context?.selectedProductId) ||
      (extracted?.intent === 'PRODUCT_SEARCH' && extracted?.searchKeywords && !EcommerceIntentParser.isNonProductReference(extracted.searchKeywords, catalogCategories, customCategoryAliases)) ||
      (extracted?.intent === 'RECOMMENDATION') ||
      (extracted?.ordinalIndex !== undefined && extracted?.ordinalIndex !== null && !context?.selectedProductId)
    );

    if (isExplicit) {
      return {
        productId: null,
        variantId: null,
        sku: extracted?.sku || null,
        color: (extracted?.color && extracted.color !== 'ALL') ? extracted.color : null,
        size: extracted?.size || null,
        isExplicit: true
      };
    }

    const hasActiveProduct = Boolean(context?.selectedProductId);
    if (hasActiveProduct) {
      return {
        productId: context?.selectedProductId || null,
        variantId: context?.selectedVariantId || null,
        sku: context?.selectedSku || null,
        color: (extracted?.color && extracted.color !== 'ALL')
          ? extracted.color
          : (extracted?.color === 'ALL' ? null : context?.selectedColor || null),
        size: extracted?.size || context?.selectedSize || null,
        isExplicit: false
      };
    }

    return {
      productId: null,
      variantId: null,
      sku: extracted?.sku || null,
      color: (extracted?.color && extracted.color !== 'ALL') ? extracted.color : null,
      size: extracted?.size || null,
      isExplicit: false
    };
  }
}
