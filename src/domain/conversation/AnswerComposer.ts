import { TurnDecision } from './TurnDecision';
import { ProductFact } from '../ecommerce/ProductRepository';
import { ProductLookupResult } from '../ecommerce/EcommerceService';
import { EcommerceIntentParser } from '../ecommerce/EcommerceIntent';
import { BusinessConfig, resolveLocalizedPrompt, DEFAULT_HANDOFF_MESSAGES } from '../tenant/BusinessConfig';
import { LLMProvider, LLMRequestOptions } from '../../core/llm/LLMProvider';
import { SupportedLanguage } from '../faq/FaqMatcher';
import { DirectRagGuard } from '../rag/DirectRagGuard';
import { PolicyAnswerSafety } from '../rag/PolicyAnswerSafety';
import { PolicyEvidenceReuse } from '../rag/PolicyEvidenceReuse';
import { logger } from '../../utils/logger';
import { responseMediaStorage } from './ResponseMediaContext';

export interface ChatMedia {
  type: 'image' | 'video';
  url: string;
  thumbnailUrl?: string;
  title?: string;
  alt?: string;
}
/** Per-turn outbound media (alias of the shared response media storage). */
export const outboundMediaContext = responseMediaStorage;

export interface AnswerContext {
  turnDecision: TurnDecision;
  productFacts?: ProductFact | ProductFact[] | null;
  knowledgeFacts?: string[] | null;
  chunks?: any[] | null;
  userMessage?: string;
  responseLanguage: 'en' | 'fr' | 'ar' | 'darija';
  responseScript: 'latin' | 'arabic' | 'arabizi';
  config?: BusinessConfig;
  llm?: LLMProvider;
  llmOptions?: LLMRequestOptions;
}

export class AnswerComposer {
  /**
   * Universal response composer: Consumes TurnDecision, authoritative product facts,
   * authoritative RAG facts, and enforces target language/script output.
   */
  public static async compose(context: AnswerContext): Promise<string> {
    const { turnDecision } = context;

    // Deterministically extract and attach media to request context
    const media = this.extractMedia({
      productFacts: context.productFacts,
      chunks: context.chunks,
      userMessage: context.userMessage,
      intent: turnDecision.intent,
      requestedMediaType: (turnDecision as any).requestedMediaType
    });
    this.attachMediaToContext(media);

    switch (turnDecision.domain) {
      case 'HANDOFF':
        return this.composeHandoff(context);
      case 'FALLBACK':
        return this.composeFallback(context);
      case 'ECOMMERCE':
        return this.composeEcommerce(context);
      case 'KNOWLEDGE':
        if (turnDecision.source === 'HYBRID') {
          return this.composeHybrid(context);
        } else {
          return this.composeKnowledge(context);
        }
      case 'GREETING':
        return this.composeGreeting(context);
      default:
        return this.composeFallback(context);
    }
  }

  public static isValidMediaUrl(url: any): boolean {
    if (typeof url !== 'string') return false;
    const trimmed = url.trim();
    if (!trimmed || trimmed.length > 2048) return false;
    // Strictly require https:// or http:// or data:image/
    if (!/^https?:\/\/[^\s$.?#].[^\s]*$/i.test(trimmed) && !/^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(trimmed)) {
      return false;
    }
    // Reject dangerous schemes
    if (/(?:javascript|data:text|file):/i.test(trimmed)) return false;
    return true;
  }

  public static sanitizeString(str: any, maxLen = 100): string | undefined {
    if (typeof str !== 'string') return undefined;
    const clean = str.replace(/<[^>]*>/g, '').trim();
    return clean.slice(0, maxLen) || undefined;
  }

  public static extractMedia(params: {
    productFacts?: ProductFact | ProductFact[] | null;
    chunks?: any[] | null;
    userMessage?: string;
    intent?: string;
    requestedMediaType?: 'image' | 'video' | 'all';
  }): ChatMedia[] {
    const results: ChatMedia[] = [];
    const seenUrls = new Set<string>();

    const msgLower = (params.userMessage || '').toLowerCase();
    const isExplicitVideo = params.requestedMediaType === 'video' ||
      /(?:^|\s|[.,!?;:()،؟])(?:videos?|clips?|watch\s+video|demo\s+video|vidéo|vidéos|voir\s+la\s+vidéo|فيديو|فيديوهات|فديو|مقطع|شوف\s+الفيديو|lvideo|chof\s+lvideo|wrini\s+video)(?:$|\s|[.,!?;:()،؟])/iu.test(msgLower);

    const isExplicitImage = params.requestedMediaType === 'image' ||
      /(?:^|\s|[.,!?;:()،؟])(?:images?|pictures?|photos?|pics?|voir\s+en\s+photo|صور|صورة|تصوير|شوف\s+الصور|وريني\s+صور|tsawer|tswira|tsawir|chof\s+tsawer|wrini\s+tsawer|تصاور|تصويرة)(?:$|\s|[.,!?;:()،؟])/iu.test(msgLower);

    // 1. Extract from Product Facts
    const facts = Array.isArray(params.productFacts)
      ? params.productFacts
      : (params.productFacts ? [params.productFacts] : []);

    for (const fact of facts) {
      if (!fact || !fact.product) continue;
      const meta = (fact.product.metadata || {}) as Record<string, any>;
      const variantMeta = (fact.selectedVariant?.metadata || {}) as Record<string, any>;
      const displayName = fact.displayName || fact.product.name;

      // Video extraction (strictly if explicit video requested)
      if (isExplicitVideo) {
        const videoUrl = variantMeta.video || variantMeta.videoUrl || meta.video || meta.videoUrl;
        if (this.isValidMediaUrl(videoUrl) && !seenUrls.has(videoUrl)) {
          seenUrls.add(videoUrl);
          const thumbUrl = variantMeta.thumbnail || variantMeta.thumbnailUrl || meta.thumbnail || meta.thumbnailUrl;
          results.push({
            type: 'video',
            url: videoUrl,
            thumbnailUrl: this.isValidMediaUrl(thumbUrl) ? thumbUrl : undefined,
            title: this.sanitizeString(displayName),
            alt: this.sanitizeString(`${displayName} Video`)
          });
          // Cap at 1 video
          break;
        }
      }

      // Image extraction (strictly when explicit image requested)
      if (isExplicitImage) {
        const rawImages: any[] = [];
        if (Array.isArray(variantMeta.images)) rawImages.push(...variantMeta.images);
        if (variantMeta.imageUrl) rawImages.push(variantMeta.imageUrl);
        if (variantMeta.image) rawImages.push(variantMeta.image);

        if (Array.isArray(meta.images)) rawImages.push(...meta.images);
        if (meta.imageUrl) rawImages.push(meta.imageUrl);
        if (meta.image) rawImages.push(meta.image);

        for (const img of rawImages) {
          if (this.isValidMediaUrl(img) && !seenUrls.has(img)) {
            seenUrls.add(img);
            results.push({
              type: 'image',
              url: img,
              title: this.sanitizeString(displayName),
              alt: this.sanitizeString(`${displayName} Image`)
            });
            if (results.filter(m => m.type === 'image').length >= 3) {
              break;
            }
          }
        }

        // Hard response caps: max 3 images
        if (results.filter(m => m.type === 'image').length >= 3) {
          break;
        }
      }
    }

    // 2. Extract from Knowledge Chunks (if no product media or in addition up to cap)
    if (Array.isArray(params.chunks)) {
      for (const chunk of params.chunks) {
        const meta = (chunk.metadata || {}) as Record<string, any>;
        const mediaList: any[] = [];
        if (Array.isArray(meta.media)) mediaList.push(...meta.media);
        if (Array.isArray(meta.images)) mediaList.push(...meta.images.map((url: string) => ({ type: 'image', url })));
        if (meta.imageUrl) mediaList.push({ type: 'image', url: meta.imageUrl });
        if (meta.image) mediaList.push({ type: 'image', url: meta.image });
        if (meta.videoUrl) mediaList.push({ type: 'video', url: meta.videoUrl });
        if (meta.video) mediaList.push({ type: 'video', url: meta.video });

        for (const item of mediaList) {
          if (!item || !this.isValidMediaUrl(item.url) || seenUrls.has(item.url)) continue;
          const mType = item.type === 'video' ? 'video' : 'image';
          if (mType === 'video' && results.filter(m => m.type === 'video').length >= 1) continue;
          if (mType === 'image' && results.filter(m => m.type === 'image').length >= (isExplicitImage ? 3 : 1)) continue;

          seenUrls.add(item.url);
          results.push({
            type: mType,
            url: item.url,
            thumbnailUrl: this.isValidMediaUrl(item.thumbnailUrl) ? item.thumbnailUrl : undefined,
            title: this.sanitizeString(item.title || chunk.documentTitle || 'Knowledge Document'),
            alt: this.sanitizeString(item.alt || chunk.documentTitle || 'Knowledge Media')
          });
        }
      }
    }

    return results;
  }

  public static attachMediaToContext(media: ChatMedia[]): void {
    if (!media || media.length === 0) return;
    const responseContext = responseMediaStorage.getStore();
    if (responseContext) {
      for (const item of media) {
        if (!responseContext.media.some(existing => existing.url === item.url)) {
          responseContext.media.push(item);
        }
      }
    }
    try {
      // Access chatDiagnosticStorage from dev chatApi if in runtime
      const { chatDiagnosticStorage } = require('../../dev/chatApi');
      const store = chatDiagnosticStorage.getStore();
      if (store) {
        if (!store.media) {
          store.media = [];
        }
        for (const item of media) {
          if (!store.media.some((m: ChatMedia) => m.url === item.url)) {
            store.media.push(item);
          }
        }
      }
    } catch {
      // Safe no-op outside chatApi runtime
    }
  }

  /**
   * Composes localized Greeting response.
   */
  public static composeGreeting(context: AnswerContext): string {
    const { responseLanguage, responseScript, config } = context;
    return resolveLocalizedPrompt(
      config?.prompts?.greeting,
      responseLanguage,
      responseLanguage === 'fr' ? 'Bonjour ! Comment puis-je vous aider aujourd’hui ?'
        : (responseLanguage === 'ar' ? 'مرحباً! كيف يمكنني مساعدتك اليوم؟'
        : (responseLanguage === 'darija' ? (responseScript === 'arabizi' ? 'Salam! Kifach n9der n3awnk lyoum?' : 'سلام! كيفاش نقدر نعاونك اليوم؟')
        : 'Hello! How can I help you today?')),
      responseScript
    );
  }

  /**
   * Composes localized Handoff response strictly respecting language and script.
   */
  public static composeHandoff(context: AnswerContext): string {
    const { responseLanguage, responseScript, config } = context;

    const defaultHandoff = responseLanguage === 'darija' && responseScript === 'arabic'
      ? 'علمنا فريق الدعم وغادي يجاوبك واحد من الموظفين قريبا.'
      : DEFAULT_HANDOFF_MESSAGES[responseLanguage as keyof typeof DEFAULT_HANDOFF_MESSAGES] || DEFAULT_HANDOFF_MESSAGES.en;

    if (config?.prompts?.handoff) {
      const custom = resolveLocalizedPrompt(config.prompts.handoff, responseLanguage, '', responseScript);
      if (custom && custom.trim()) {
        if (responseLanguage === 'darija' && responseScript === 'arabizi' && /[\u0600-\u06FF]/.test(custom)) {
          return DEFAULT_HANDOFF_MESSAGES.darija;
        }
        return custom;
      }
    }

    if (responseLanguage === 'darija' && responseScript === 'arabizi') {
      return DEFAULT_HANDOFF_MESSAGES.darija;
    }

    return defaultHandoff;
  }

  /**
   * A customer sent their order or booking details (name, phone, address) to
   * a business without a form: the conversation is passed to the team. The
   * owner's own handoff text wins when set.
   */
  public static composeDetailsHandoff(context: AnswerContext, kind: 'order' | 'booking'): string {
    const { responseLanguage: lang, responseScript: script, config } = context;
    const owner = config?.prompts?.handoff as unknown;
    const defaults = new Set<string>([...Object.values(DEFAULT_HANDOFF_MESSAGES), 'علمنا فريق الدعم وغادي يجاوبك واحد من الموظفين قريبا.']);
    const ownerTexts = typeof owner === 'string' ? [owner] : owner && typeof owner === 'object' ? Object.values(owner as Record<string, unknown>) : [];
    if (ownerTexts.some(text => typeof text === 'string' && text.trim() && !defaults.has(text.trim()))) return AnswerComposer.composeHandoff(context);
    const order = kind === 'order';
    if (lang === 'fr') return `Merci ! J'ai transmis vos coordonnées à notre équipe, qui va vous confirmer ${order ? 'la commande et la livraison' : 'le rendez-vous'} ici très bientôt.`;
    if (lang === 'ar') return `شكراً لك! أرسلت معلوماتك إلى فريقنا، وسيؤكد لك ${order ? 'الطلب والتوصيل' : 'الموعد'} هنا قريباً.`;
    if (lang === 'darija' && script === 'arabizi') return `Chokran! Sifet lma3lomat dyalek l lfari9 dyalna, w ghadi y2akked m3ak ${order ? 'lcommande w tawsil' : 'lmaw3id'} hna 9riban.`;
    if (lang === 'darija') return `شكراً! صيفطت المعلومات ديالك للفريق ديالنا، وغادي يأكد معاك ${order ? 'الكوموند والتوصيل' : 'الموعد'} هنا قريباً.`;
    return `Thank you! I've passed your details to our team, who will confirm ${order ? 'your order and delivery' : 'your appointment'} with you here shortly.`;
  }

  /**
   * Composes localized Fallback response strictly respecting language and script.
   */
  public static composeFallback(context: AnswerContext): string {
    const { responseLanguage, responseScript, config } = context;

    if (config?.prompts?.fallback) {
      const custom = resolveLocalizedPrompt(config.prompts.fallback, responseLanguage, '', responseScript);
      if (custom && custom.trim()) {
        // If Arabizi requested but prompt is in Arabic script, provide Arabizi
        if (responseLanguage === 'darija' && responseScript === 'arabizi' && /[\u0600-\u06FF]/.test(custom)) {
          return "Ma3ndich had lma3loma daba, walakin l'équipe t9der t2akkedha lik hna.";
        }
        return custom;
      }
    }

    if (responseLanguage === 'fr') {
      return "Je n'ai pas cette information pour le moment ; notre équipe pourra vous la confirmer ici.";
    }
    if (responseLanguage === 'ar') {
      return 'لا تتوفر لدي هذه المعلومة حالياً، لكن يمكن لفريقنا تأكيدها لك هنا.';
    }
    if (responseLanguage === 'darija') {
      if (responseScript === 'arabizi') {
        return "Ma3ndich had lma3loma daba, walakin l'équipe t9der t2akkedha lik hna.";
      }
      return 'ما عنديش هاد المعلومة دابا، ولكن الفريق يقدر يأكدها ليك هنا.';
    }
    return "I don't have that information right now, but our team can confirm it for you here.";
  }

  /** Remove a document heading when a trusted RAG chunk is returned verbatim. */
  public static formatDirectKnowledgeAnswer(content: string): string {
    const lines = content.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (lines.length < 2) return content.trim();
    const heading = lines[0].replace(/^#{1,6}\s*/, '').replace(/[:：]\s*$/, '');
    const looksLikeHeading = heading.length <= 120
      && !/[.!?؟]$/.test(heading)
      && /(?:\b(?:guide|manual|overview|faq|instructions|polic(?:y|ies)|catalog(?:ue)?|size chart)\b|دليل|تعليمات|سياسة|الأسئلة الشائعة)\s*$/iu.test(heading);
    return (looksLikeHeading ? lines.slice(1) : lines).join('\n');
  }

  /** Suggest only topics backed by this business's configured data. */
  public static composeUnknownAnswer(context: AnswerContext): string {
    const { responseLanguage: lang, responseScript: script, config } = context;
    const facts = config?.portalFacts || {};
    const policies = facts.policies && typeof facts.policies === 'object' && !Array.isArray(facts.policies)
      ? facts.policies as Record<string, unknown> : {};
    const present = (value: unknown): boolean => typeof value === 'string' && value.trim().length > 0;
    const topics: string[] = [];
    if (config?.capabilities?.ecommerceEnabled) topics.push('products');
    if (Array.isArray(facts.services) && facts.services.length > 0) topics.push('services');
    if (present(policies.shipping)) topics.push('delivery');
    if (present(policies.returns)) topics.push('returns');
    if (present(policies.payment)) topics.push('payment');
    if (present(config?.identity?.businessHours)) topics.push('hours');
    if (config?.identity?.locations?.some(present)) topics.push('location');
    if (config?.capabilities?.faq?.length) topics.push('faq');
    const selected = topics.slice(0, 3);
    const labels: Record<string, Record<string, string>> = {
      en: { products: 'products', services: 'services', delivery: 'delivery', returns: 'returns', payment: 'payment methods', hours: 'opening hours', location: 'location', faq: 'common questions' },
      fr: { products: 'les produits', services: 'les services', delivery: 'la livraison', returns: 'les retours', payment: 'les modes de paiement', hours: 'les horaires', location: 'l’adresse', faq: 'les questions fréquentes' },
      ar: { products: 'المنتجات', services: 'الخدمات', delivery: 'التوصيل', returns: 'الإرجاع', payment: 'طرق الدفع', hours: 'ساعات العمل', location: 'العنوان', faq: 'الأسئلة الشائعة' },
      darija: { products: 'المنتوجات', services: 'الخدمات', delivery: 'التوصيل', returns: 'الترجيع', payment: 'طرق الخلاص', hours: 'أوقات الخدمة', location: 'العنوان', faq: 'الأسئلة الشائعة' },
      arabizi: { products: 'lmontojat', services: 'lkhedmat', delivery: 'tawsil', returns: 'trji3', payment: 'toroq lkhlas', hours: 'lw9at', location: 'l3onwan', faq: 'las2ila lmatrou7a' }
    };
    const key = lang === 'darija' && script === 'arabizi' ? 'arabizi' : lang;
    const names = selected.map(topic => labels[key]?.[topic] || labels.en[topic]);
    const and = key === 'fr' ? ' et ' : key === 'en' ? ' and ' : key === 'arabizi' ? ' w ' : ' و';
    const comma = key === 'ar' || key === 'darija' ? '، ' : ', ';
    const list = names.length > 1 ? `${names.slice(0, -1).join(comma)}${and}${names[names.length - 1]}` : names.join('');
    if (lang === 'fr') return `Je n'ai pas cette précision pour le moment, mais notre équipe pourra vous la confirmer ici.${list ? ` Je peux aussi vous renseigner sur ${list}.` : ''}`;
    if (lang === 'ar') return `لا تتوفر لدي هذه المعلومة حالياً، لكن يمكن لفريقنا تأكيدها لك هنا.${list ? ` ويمكنني أيضاً مساعدتك بخصوص ${list}.` : ''}`;
    if (lang === 'darija' && script === 'arabizi') return `Ma3ndich had lma3loma daba, walakin l'équipe dyalna t9der t2akkedha lik hna.${list ? ` W n9der n3awnek f ${list}.` : ''}`;
    if (lang === 'darija') return `ما عنديش هاد المعلومة دابا، ولكن الفريق ديالنا يقدر يأكدها ليك هنا.${list ? ` ونقدر نعاونك حتى فـ${list}.` : ''}`;
    return `I don't have that detail at the moment, but our team can confirm it for you here.${list ? ` I can also help you with ${list}.` : ''}`;
  }

  /** Answer an exact, single-service price from published fields without a model call. */
  public static composeServicePrice(context: AnswerContext): string | null {
    const services = context.config?.portalFacts?.services;
    const question = context.userMessage?.toLocaleLowerCase() || '';
    if (!Array.isArray(services) || !question) return null;
    const matches = services.filter((service: any) => typeof service?.name === 'string' && question.includes(service.name.toLocaleLowerCase()));
    if (matches.length !== 1) return null;
    const service = matches[0] as { name: string; price?: string | number };
    const price = Number(service.price);
    if (!Number.isFinite(price) || price < 0) return null;
    return AnswerComposer.namedServicePrice(service.name, price, context.config?.identity?.currency || 'MAD', context.responseLanguage, context.responseScript);
  }

  /** "The price of <service> is <price>", from a menu price such as 150 or "150 MAD". */
  public static namedServicePrice(name: string, rawPrice: string | number, currency: string, lang: string, script?: string): string | null {
    const text = String(rawPrice ?? '').trim();
    const amount = /^\d+(?:[.,]\d+)?$/.test(text) ? `${text} ${currency}` : text;
    if (!/\d/.test(amount) || amount.length > 40) return null;
    if (lang === 'fr') return `Le prix de ${name} est de ${amount}.`;
    if (lang === 'ar') return `سعر ${name} هو ${amount}.`;
    if (lang === 'darija' && script === 'arabizi') return `Taman dyal ${name} howa ${amount}.`;
    if (lang === 'darija') return `الثمن ديال ${name} هو ${amount}.`;
    return `The price of ${name} is ${amount}.`;
  }

  private static getSafeName(fact: ProductLookupResult | null | undefined, script?: string, lang?: string): string {
    if (!fact) return '';
    if (lang && fact.product?.nameLocalized && (fact.product.nameLocalized as any)[lang]) {
      const locName = (fact.product.nameLocalized as any)[lang];
      if (script === 'arabizi' && /[\u0600-\u06FF]/.test(locName)) {
        return (fact.product?.nameLocalized as any)?.en || fact.product?.name || locName;
      }
      return locName;
    }
    if (script === 'arabizi' && /[\u0600-\u06FF]/.test(fact.displayName)) {
      return (fact.product?.nameLocalized as any)?.en || fact.product?.name || fact.displayName;
    }
    return fact.displayName || fact.product?.name || '';
  }

  private static getSafeDescription(fact: ProductLookupResult | null | undefined, script?: string, lang?: string): string {
    if (!fact) return '';
    if (lang && fact.product?.descriptionLocalized && (fact.product.descriptionLocalized as any)[lang]) {
      const locDesc = (fact.product.descriptionLocalized as any)[lang];
      if (script === 'arabizi' && /[\u0600-\u06FF]/.test(locDesc)) {
        return (fact.product?.descriptionLocalized as any)?.en || fact.product?.description || locDesc;
      }
      return locDesc;
    }
    if (script === 'arabizi' && /[\u0600-\u06FF]/.test(fact.displayDescription)) {
      return (fact.product?.descriptionLocalized as any)?.en || fact.product?.description || fact.displayDescription;
    }
    return fact.displayDescription || fact.product?.description || '';
  }

  /**
   * Formats a variant label string from resolved color and size.
   * Returns empty string if neither is present.
   * Output: "Black / M", "Black", "M", "Noir / M", etc.
   */
  private static formatVariantLabel(
    color: string | null | undefined,
    size: string | null | undefined,
    lang: string,
    script: string
  ): string {
    const parts: string[] = [];
    if (color && color !== 'ALL') parts.push(color);
    if (size) parts.push(size);
    if (parts.length === 0) return '';
    return parts.join(' / ');
  }

  /**
   * Constructs a structured, customer-facing semantic search target from resolved TurnDecision fields.
   * Priority:
   * 1. If explicit product name exists and is substantive: format with color/size if resolved.
   * 2. If category exists: format category with color/size/constraints.
   * 3. If cleaned search keywords exist: use search keywords.
   * 4. Otherwise: return empty string (generic empty search).
   *
   * Crucially, NEVER echo raw query text, conversational wrappers, or intent verbs.
   */
  public static getSearchTarget(
    turnDecision: TurnDecision,
    lang?: string,
    script?: string
  ): string {
    const parts: string[] = [];

    // 1. Color constraint
    if (turnDecision.color && turnDecision.color !== 'ALL') {
      parts.push(turnDecision.color);
    }

    // 2. Size constraint
    if (turnDecision.size) {
      parts.push(`size ${turnDecision.size}`);
    }

    // 3. Main entity: explicit product name OR category OR search keywords
    let entity = '';
    if (turnDecision.productName && !EcommerceIntentParser.isNonProductReference(turnDecision.productName)) {
      entity = turnDecision.productName;
    } else if (turnDecision.category) {
      entity = turnDecision.category;
    } else if (turnDecision.searchKeywords && !EcommerceIntentParser.isNonProductReference(turnDecision.searchKeywords)) {
      entity = turnDecision.searchKeywords;
    }

    if (entity) {
      // If entity already contains the color/size words, don't duplicate
      const entityLower = entity.toLowerCase();
      const filteredParts = parts.filter(p => !entityLower.includes(p.toLowerCase()));
      if (filteredParts.length > 0) {
        return `${filteredParts.join(' ')} ${entity}`.trim();
      }
      return entity;
    }

    if (parts.length > 0) {
      return parts.join(' ');
    }

    return '';
  }

  /**
   * Composes deterministic authoritative Ecommerce response strictly respecting language and script.
   */
  public static composeEcommerce(context: AnswerContext): string {
    const { turnDecision, productFacts, responseLanguage, responseScript } = context;

    // Extract and attach media to request context
    const media = this.extractMedia({
      productFacts,
      userMessage: context.userMessage,
      intent: turnDecision.intent,
      requestedMediaType: (turnDecision as any).requestedMediaType
    });
    this.attachMediaToContext(media);

    // 1. Comparison
    if (turnDecision.intent === 'COMPARE') {
      const facts = Array.isArray(productFacts) ? productFacts : (productFacts ? [productFacts] : []);
      if (facts.length >= 2) {
        // Stock counts stay internal; only an unavailable item is flagged.
        const off = this.unavailableNote(responseLanguage, responseScript);
        const line = (c: ProductLookupResult) => `- ${this.getSafeName(c, responseScript)} : ${c.effectivePrice} ${c.currency}${c.inStock ? '' : ` (${off})`}`;
        if (responseLanguage === 'fr') {
          return `Voici les deux en un coup d'œil :\n` + facts.map(line).join('\n');
        }
        if (responseLanguage === 'ar') {
          return `إليك المقارنة:\n` + facts.map(c => line(c).replace(' : ', ': ')).join('\n');
        }
        if (responseLanguage === 'darija') {
          if (responseScript === 'arabizi') {
            return `Hahoma b jouj:\n` + facts.map(c => line(c).replace(' : ', ': ')).join('\n');
          }
          return `ها هوما بجوج:\n` + facts.map(c => line(c).replace(' : ', ': ')).join('\n');
        }
        return `Here they are side by side:\n` + facts.map(c => line(c).replace(' : ', ': ')).join('\n');
      } else {
        if (responseLanguage === 'fr') {
          return `Désolé, impossible de trouver tous les produits demandés pour la comparaison.`;
        }
        if (responseLanguage === 'ar') {
          return `عذراً، لم نتمكن من العثور على جميع المنتجات المطلوبة للمقارنة.`;
        }
        if (responseLanguage === 'darija') {
          if (responseScript === 'arabizi') {
            return `Smeh liya, mal9inach ga3 l-produiyat li tlebti bach n9arnohom.`;
          }
          return `سمح ليا، ما لقيناش كاع المنتوجات اللي طلبتي باش نقارنوهم.`;
        }
        return `Sorry, unable to find all requested products for comparison.`;
      }
    }

    // 1.5 Recommendation
    if (turnDecision.intent === 'RECOMMENDATION') {
      const facts = Array.isArray(productFacts) ? productFacts : (productFacts ? [productFacts] : []);
      if (facts.length > 0) {
        const top = facts[0];
        const topName = this.getSafeName(top, responseScript);
        const off = top.inStock ? '' : ` (${this.unavailableNote(responseLanguage, responseScript)})`;
        if (responseLanguage === 'fr') {
          return `Je vous conseille ${topName}, à ${top.effectivePrice} ${top.currency}${off}.`;
        }
        if (responseLanguage === 'ar') {
          return `أنصحك بـ ${topName}، بسعر ${top.effectivePrice} ${top.currency}${off}.`;
        }
        if (responseLanguage === 'darija') {
          if (responseScript === 'arabizi') {
            return `Kan nsa7ek b ${topName}, b ${top.effectivePrice} ${top.currency}${off}.`;
          }
          return `كننصحك بـ ${topName}، بـ ${top.effectivePrice} ${top.currency}${off}.`;
        }
        return `I'd recommend ${topName}, at ${top.effectivePrice} ${top.currency}${off}.`;
      } else {
        if (responseLanguage === 'fr') {
          return `Désolé, nous n'avons pas assez d'informations dans notre catalogue pour faire une recommandation fiable.`;
        }
        if (responseLanguage === 'ar') {
          return `عذراً، لا تتوفر لدينا معلومات كافية في الكتالوج لتقديم توصية مؤكدة حالياً.`;
        }
        if (responseLanguage === 'darija') {
          if (responseScript === 'arabizi') {
            return `Smeh liya, ma3ndnach ma3loumat kafya f l-catalogue bach nsehok b chi haja db.`;
          }
          return `سمح ليا، ما عندناش معلومات كافية فالكاتالوج باش نقدرو ننصحوك بشي حاجة دابا.`;
        }
        return `Sorry, we do not have enough catalog information to make a reliable recommendation right now.`;
      }
    }

    // 2. Product Search
    if (turnDecision.intent === 'PRODUCT_SEARCH') {
      const facts = Array.isArray(productFacts) ? productFacts : (productFacts ? [productFacts] : []);
      if (facts.length > 0) {
        const header = responseLanguage === 'fr'
          ? "Voici les produits correspondants :"
          : (responseLanguage === 'ar'
            ? "إليك المنتجات المتوفرة:"
            : (responseLanguage === 'darija'
              ? (responseScript === 'arabizi' ? "Hahoma l-produiyat li 3ndna:" : "ها هما المنتوجات اللي عندنا:")
              : "Here are the matching products:"));

        const listStr = facts.map((r, i) => {
          const pName = this.getSafeName(r, responseScript);
          return `${i + 1}. ${pName} — ${r.effectivePrice} ${r.currency}${r.inStock ? '' : ` (${this.unavailableNote(responseLanguage, responseScript)})`}`;
        }).join('\n');
        return `${header}\n\n${listStr}`;
      } else {
        const kw = this.getSearchTarget(turnDecision, responseLanguage, responseScript);
        if (responseLanguage === 'fr') {
          return kw ? `Désolé, nous n'avons pas d'articles correspondant à "${kw}" actuellement dans notre catalogue.` : `Désolé, aucun produit ne correspond à votre recherche dans notre catalogue.`;
        }
        if (responseLanguage === 'ar') {
          return kw ? `عذراً، لا توجد منتجات مطابقة لـ "${kw}" حالياً في متجرنا.` : `عذراً، لا توجد منتجات مطابقة لبحثك في متجرنا.`;
        }
        if (responseLanguage === 'darija') {
          if (responseScript === 'arabizi') {
            return kw ? `Smeh liya, makayninch produiyat dyal "${kw}" db f l-magasin.` : `Smeh liya, makayen hta produit kaywafe9 l-baht dyalek.`;
          }
          return kw ? `سمح ليا، ما كاينينش منتوجات ديال "${kw}" حالياً عندنا فالمحل.` : `سمح ليا، ما كاين حتى منتوج مطابق للبحث ديالك فالمحل.`;
        }
        return kw ? `Sorry, we do not currently have items matching "${kw}" in our catalog.` : `Sorry, no products matched your search in our catalog.`;
      }
    }

    // 3. Single Product Fact (PRICE, AVAILABILITY, PRODUCT_DETAIL, VARIANT_SELECTION)
    const fact = Array.isArray(productFacts) ? productFacts[0] : productFacts;
    if (!fact) {
      if (responseLanguage === 'fr') {
        return `Je ne suis pas sûr de l'article dont vous parlez. Pouvez-vous m'envoyer son nom ou une photo ?`;
      }
      if (responseLanguage === 'ar') {
        return `لست متأكداً من المنتج الذي تقصده. هل يمكنك إرسال اسمه أو صورة له؟`;
      }
      if (responseLanguage === 'darija') {
        if (responseScript === 'arabizi') {
          return `Ma 3reftch achmen produit kat9sed. 3afak sift lia smito wla tswira dyalo.`;
        }
        return `ما عرفتش أشمن منتوج كتقصد. عافاك صيفط ليا سميتو ولا تصويرة ديالو.`;
      }
      return `I'm not sure which item you mean. Could you send me its name or a photo?`;
    }

    const safeFactName = this.getSafeName(fact, responseScript, responseLanguage);
    const safeFactDesc = this.getSafeDescription(fact, responseScript, responseLanguage);

    if (turnDecision.color === 'ALL') {
      const colors = Array.from(new Set(fact.product.variants?.map(v => v.color).filter(Boolean)));
      if (responseLanguage === 'fr') {
        return colors.length > 0
          ? `Les couleurs disponibles pour ${safeFactName} sont : ${colors.join(', ')}.`
          : `${safeFactName} est disponible uniquement dans sa couleur standard.`;
      }
      if (responseLanguage === 'ar') {
        return colors.length > 0
          ? `الألوان المتوفرة لـ ${safeFactName} هي: ${colors.join('، ')}.`
          : `${safeFactName} متوفر باللون المعروض فقط.`;
      }
      if (responseLanguage === 'darija') {
        if (responseScript === 'arabizi') {
          return colors.length > 0
            ? `L-alwan li kaynin f ${safeFactName} homa: ${colors.join(', ')}.`
            : `${safeFactName} kayen ghir f had loun safi.`;
        }
        return colors.length > 0
          ? `الألوان اللي كاينين فـ ${safeFactName} هما: ${colors.join('، ')}.`
          : `${safeFactName} كاين غير فهاد اللون فقط.`;
      }
      return colors.length > 0
        ? `The available colors for ${safeFactName} are: ${colors.join(', ')}.`
        : `${safeFactName} is only available in its default color.`;
    }

    if (turnDecision.intent === 'ATTRIBUTE_QUERY') {
      const facts = Array.isArray(productFacts) ? productFacts : (productFacts ? [productFacts] : []);
      if (facts.length > 1) {
        if (responseLanguage === 'fr') {
          return `Voici les caractéristiques de nos ${turnDecision.category || 'articles'} :\n` + facts.map(f => `- ${this.getSafeName(f, responseScript, responseLanguage)} : ${this.getSafeDescription(f, responseScript, responseLanguage)}`).join('\n');
        }
        if (responseLanguage === 'ar') {
          return `إليك مواصفات ${turnDecision.category || 'منتجاتنا'}:\n` + facts.map(f => `- ${this.getSafeName(f, responseScript, responseLanguage)}: ${this.getSafeDescription(f, responseScript, responseLanguage)}`).join('\n');
        }
        if (responseLanguage === 'darija') {
          if (responseScript === 'arabizi') {
            return `Hahoma l-mowasafat dyal ${turnDecision.category || 'l-produiyat'}:\n` + facts.map(f => `- ${this.getSafeName(f, responseScript, responseLanguage)}: ${this.getSafeDescription(f, responseScript, responseLanguage)}`).join('\n');
          }
          return `هاهما المواصفات ديال ${turnDecision.category || 'المنتوجات'}:\n` + facts.map(f => `- ${this.getSafeName(f, responseScript, responseLanguage)}: ${this.getSafeDescription(f, responseScript, responseLanguage)}`).join('\n');
        }
        return `Here are the specifications for our ${turnDecision.category || 'items'}:\n` + facts.map(f => `- ${this.getSafeName(f, responseScript, responseLanguage)}: ${this.getSafeDescription(f, responseScript, responseLanguage)}`).join('\n');
      }

      const family = turnDecision.attributeFamily;
      const attrName = (turnDecision as any).attributeName || family;
      const descLower = safeFactDesc.toLowerCase();
      const kw = (turnDecision.attributeKeywords || '').toLowerCase();

      // 1. Check structured metadata on product and selected variant
      let hasEvidence = false;
      let metadataValue: string | null = null;

      const productMeta = (fact.product.metadata as Record<string, any>) || {};
      const variantMeta = (fact.selectedVariant?.metadata as Record<string, any>) || {};
      const combinedMeta = { ...productMeta, ...variantMeta };

      if (Object.keys(combinedMeta).length > 0) {
        for (const [mKey, mVal] of Object.entries(combinedMeta)) {
          const normKey = mKey.toLowerCase().replace(/[-_]/g, ' ');
          const normAttrName = (attrName || '').toLowerCase().replace(/[-_]/g, ' ');
          const normKw = kw.toLowerCase().replace(/[-_]/g, ' ');

          if (
            normKey === normAttrName ||
            normKey === normKw ||
            normAttrName.includes(normKey) ||
            normKw.includes(normKey) ||
            (normKey.length > 2 && kw && normKw.includes(normKey))
          ) {
            hasEvidence = true;
            metadataValue = String(mVal);
            break;
          }
        }
      }

      // 2. Check description text for keyword or attribute tokens
      if (!hasEvidence && kw) {
        const cleanKwTokens = kw.split(/\s+/).filter(t => t.length > 2);
        if (cleanKwTokens.length > 0 && cleanKwTokens.some(t => descLower.includes(t))) {
          hasEvidence = true;
        } else if (descLower.includes(kw)) {
          hasEvidence = true;
        }
      }

      // 3. Fallback to attribute family patterns if still unconfirmed
      if (!hasEvidence && family && (!kw || /^(?:material|matière|matiere|matériau|composition|fabric|tissu|tissue|fit|weight|dimensions|features?|ثوب|الثوب|القماش|قماش|الخامة|خامة|المادة|الصنعة|tob|ttob|9mach|lq?mach)$/iu.test(kw))) {
        if (family === 'PERFORMANCE') {
          hasEvidence = /(?:waterproof|water-resistant|rainproof|warm|breathable|windproof|imperm[ée]able|chaud|respirant|مقاوم|ضد الما|ضد الماء|سخون|دافئ)/iu.test(descLower);
        } else if (family === 'MATERIAL') {
          hasEvidence = /(?:cotton|polyester|leather|fleece|wool|silk|linen|denim|nylon|coton|cuir|molleton|molletonn|crêpe|soie|acier|mesh|laine|lin|satin|velours|velvet|viscose|jersey|daim|suede|suède|métal|metal|argent|silver|gold|plaqué|bois|wood|céramique|ساتان|قطيفة|حرير|mati[èe]re|tissu|composition|قطن|جلد|قماش|ثوب|صوف|حرير|توب)/iu.test(descLower);
        } else if (family === 'FIT') {
          hasEvidence = /(?:fit|oversize|oversized|slim|regular|loose|coupe|large|ajust[ée]e|واسع|عريض|مزير|فصالة)/iu.test(descLower);
        } else if (family === 'WEIGHT') {
          hasEvidence = /(?:heavy|light|weight|gsm|lourd|l[ée]ger|poids|grammage|ثقيل|خفيف|وزن)/iu.test(descLower);
        } else if (family === 'FEATURE') {
          hasEvidence = /(?:pocket|hood|zip|collar|cuff|sleeve|poche|capuche|fermeture|جيب|جيوب|كابوشون|قب|سنسلة)/iu.test(descLower);
        } else if (family === 'DIMENSIONS') {
          hasEvidence = /(?:dimension|dimensions|cm|mm|meter|inch|height|width|length|taille|longueur|largeur|أبعاد|طول|عرض)/iu.test(descLower);
        }
      }

      // Say plainly what is known and offer the team, instead of "the details do not specify".
      if (!hasEvidence && safeFactDesc) {
        if (responseLanguage === 'fr') {
          return `Je n'ai pas cette précision pour ${safeFactName}. Sa description : ${safeFactDesc} Notre équipe peut vous confirmer le reste ici.`;
        }
        if (responseLanguage === 'ar') {
          return `ليست لدي هذه المعلومة عن ${safeFactName}. وصفه: ${safeFactDesc} يمكن لفريقنا تأكيد الباقي لك هنا.`;
        }
        if (responseLanguage === 'darija') {
          if (responseScript === 'arabizi') {
            return `Ma 3ndich had lma3loma 3la ${safeFactName}. Lwasf dyalo: ${safeFactDesc} Lfari9 dyalna y9der y2ekked lik hna.`;
          }
          return `ما عنديش هاد المعلومة على ${safeFactName}. الوصف ديالو: ${safeFactDesc} الفريق ديالنا يقدر يأكد ليك هنا.`;
        }
        return `I don't have that detail for ${safeFactName}. Its description: ${safeFactDesc} Our team can confirm the rest here.`;
      }

      if (metadataValue) {
        if (responseLanguage === 'fr') {
          return `${safeFactName} (${attrName || 'Spécification'}) : ${metadataValue}. ${safeFactDesc}`;
        }
        if (responseLanguage === 'ar') {
          return `بالنسبة لـ ${safeFactName} (${attrName || 'المواصفات'}): ${metadataValue}. ${safeFactDesc}`;
        }
        if (responseLanguage === 'darija') {
          if (responseScript === 'arabizi') {
            return `Bnisba l ${safeFactName} (${attrName || 'Mowasafat'}): ${metadataValue}. ${safeFactDesc}`;
          }
          return `بالنسبة لـ ${safeFactName} (${attrName || 'المواصفات'}): ${metadataValue}. ${safeFactDesc}`;
        }
        return `Regarding ${safeFactName} (${attrName || 'specification'}): ${metadataValue}. ${safeFactDesc}`;
      }

      if (responseLanguage === 'fr') {
        return `${safeFactName} : ${safeFactDesc}`;
      }
      if (responseLanguage === 'ar') {
        return `بالنسبة لـ ${safeFactName}: ${safeFactDesc}`;
      }
      if (responseLanguage === 'darija') {
        if (responseScript === 'arabizi') {
          return `Bnisba l ${safeFactName}: ${safeFactDesc}`;
        }
        return `بالنسبة لـ ${safeFactName}: ${safeFactDesc}`;
      }
      return `Regarding ${safeFactName}: ${safeFactDesc}`;
    }

    if (turnDecision.intent === 'PRODUCT_DETAIL') {
      const arabicScript = responseLanguage === 'ar' || (responseLanguage === 'darija' && responseScript !== 'arabizi');
      const sep = arabicScript ? '، ' : ', ';
      // In-stock options grouped by colour ("Bleu : 30, 32 · Noir : 34"): a flat
      // "Bleu 30, Noir 30, Bleu 32, ..." list is hard to read in a chat.
      const bySize = new Map<string, string[]>();
      for (const v of fact.product.variants || []) {
        if ((v as any).active === false || !(Number((v as any).stock) > 0)) continue;
        const color = (v.color || '').trim(), size = (v.size || '').trim();
        if (!color && !size) continue;
        const list = bySize.get(color) || [];
        if (size && !list.includes(size)) list.push(size);
        bySize.set(color, list);
      }
      const options = [...bySize.entries()].map(([color, sizes]) => color && sizes.length ? `${color} (${AnswerComposer.sortSizes(sizes).join(sep)})` : color || AnswerComposer.sortSizes(sizes).join(sep)).join(' · ');
      // The merchant's description is quoted only when it is in the reply's language/script.
      const descArabic = /[؀-ۿ]/.test(safeFactDesc);
      const descFrench = !descArabic && (safeFactDesc.match(/(?:^|\s)(?:en|de|des|du|le|la|les|avec|pour|et|à)(?=\s)/giu) || []).length >= 1
        && !/\b(?:the|with|and|for)\b/i.test(safeFactDesc);
      const keepDesc = safeFactDesc && (arabicScript ? descArabic : responseLanguage === 'fr' ? !descArabic : !descArabic && !descFrench);
      const descLine = keepDesc ? `\n${safeFactDesc}` : '';
      const photo = media.some(item => item.type === 'image');
      const lead = !photo ? '' : responseLanguage === 'fr' ? 'Voici la photo : '
        : responseLanguage === 'ar' ? 'إليك الصورة: '
        : responseLanguage === 'darija' ? (responseScript === 'arabizi' ? 'Hahiya tswira: ' : 'ها هي التصويرة: ')
        : "Here's the photo: ";
      // Available items need no stock line; only an unavailable one says so.
      const offLine = fact.inStock ? '' : `\n${this.unavailableSentence(responseLanguage, responseScript)}`;
      if (responseLanguage === 'fr') {
        const variantsText = options ? `\nTailles disponibles : ${options}` : '';
        return `${lead}${safeFactName}${descLine}\nPrix : ${fact.effectivePrice} ${fact.currency}${variantsText}${offLine}`;
      }
      if (responseLanguage === 'ar') {
        const variantsText = options ? `\nالمقاسات المتوفرة: ${options}` : '';
        return `${lead}${safeFactName}${descLine}\nالسعر: ${fact.effectivePrice} ${fact.currency}${variantsText}${offLine}`;
      }
      if (responseLanguage === 'darija') {
        if (responseScript === 'arabizi') {
          const variantsText = options ? `\nTailles li kaynin: ${options}` : '';
          return `${lead}${safeFactName}${descLine}\nTaman: ${fact.effectivePrice} ${fact.currency}${variantsText}${offLine}`;
        }
        const variantsText = options ? `\nالمقاسات اللي كاينين: ${options}` : '';
        return `${lead}${safeFactName}${descLine}\nالثمن: ${fact.effectivePrice} ${fact.currency}${variantsText}${offLine}`;
      }
      const variantsText = options ? `\nAvailable sizes: ${options}` : '';
      return `${lead}${safeFactName}${descLine}\nPrice: ${fact.effectivePrice} ${fact.currency}${variantsText}${offLine}`;
    }

    if (turnDecision.intent === 'BUY_INTENT') {
      const variant = fact.selectedVariant;
      const variantLabel = this.formatVariantLabel(variant?.color || turnDecision.color, variant?.size || turnDecision.size, responseLanguage, responseScript);
      const productSubject = variantLabel ? `${safeFactName} (${variantLabel})` : safeFactName;

      if (!fact.inStock) {
        return `${this.unavailableSentence(responseLanguage, responseScript, productSubject)}${this.inStockOptions(fact, responseLanguage, responseScript)}`;
      }

      // Payment terms come from the store's own policies, never assumed here.
      if (responseLanguage === 'fr') {
        return `Avec plaisir ! ${productSubject} est à ${fact.effectivePrice} ${fact.currency}. Pour la commande, envoyez-moi votre nom complet, votre adresse avec la ville et votre numéro de téléphone.`;
      }
      if (responseLanguage === 'ar') {
        return `بكل سرور! ${productSubject} بسعر ${fact.effectivePrice} ${fact.currency}. لإتمام الطلب، أرسل لي اسمك الكامل وعنوانك مع المدينة ورقم هاتفك.`;
      }
      if (responseLanguage === 'darija') {
        if (responseScript === 'arabizi') {
          return `Mrehba! ${productSubject} b ${fact.effectivePrice} ${fact.currency}. Bach ndiro lcommande, sift liya smitek kamla, l3onwan m3a lmdina w nmra dyal tilifoun.`;
        }
        return `مرحبا! ${productSubject} بـ ${fact.effectivePrice} ${fact.currency}. باش نديرو الكوموند، صيفط ليا سميتك كاملة، العنوان مع المدينة ونمرة التيليفون.`;
      }
      return `With pleasure! ${productSubject} is ${fact.effectivePrice} ${fact.currency}. To place the order, send me your full name, your address with the city, and your phone number.`;
    }

    if (turnDecision.intent === 'PRICE' && !turnDecision.requestedAvailability) {
      const variant = fact.selectedVariant;
      const variantLabel = this.formatVariantLabel(variant?.color || turnDecision.color, variant?.size || turnDecision.size, responseLanguage, responseScript);
      const priceSubject = variantLabel ? `${safeFactName} (${variantLabel})` : safeFactName;

      if (responseLanguage === 'fr') {
        return `${priceSubject} est à ${fact.effectivePrice} ${fact.currency}.`;
      }
      if (responseLanguage === 'ar') {
        return `سعر ${priceSubject} هو ${fact.effectivePrice} ${fact.currency}.`;
      }
      if (responseLanguage === 'darija') {
        if (responseScript === 'arabizi') {
          return `Taman dyal ${priceSubject} howa ${fact.effectivePrice} ${fact.currency}.`;
        }
        return `الثمن ديال ${priceSubject} هو ${fact.effectivePrice} ${fact.currency}.`;
      }
      return `${priceSubject} is ${fact.effectivePrice} ${fact.currency}.`;
    }

    // AVAILABILITY or VARIANT_SELECTION
    const variant = fact.selectedVariant;
    const resolvedColor = variant?.color || (turnDecision.color && turnDecision.color !== 'ALL' ? turnDecision.color : undefined);
    const resolvedSize = variant?.size || turnDecision.size || undefined;
    const hasVariant = !!(resolvedColor || resolvedSize);
    const variantLabel = hasVariant ? this.formatVariantLabel(resolvedColor, resolvedSize, responseLanguage, responseScript) : '';

    // A shop assistant says whether it is available and the price, never how
    // many pieces are left in stock.
    const subject = hasVariant ? `${safeFactName} (${variantLabel})` : safeFactName;
    if (fact.inStock) {
      if (responseLanguage === 'fr') return `Oui, ${subject} est disponible, à ${fact.effectivePrice} ${fact.currency}.`;
      if (responseLanguage === 'ar') return `نعم، ${subject} متوفر بسعر ${fact.effectivePrice} ${fact.currency}.`;
      if (responseLanguage === 'darija') {
        if (responseScript === 'arabizi') return `Ah, ${subject} kayn, b ${fact.effectivePrice} ${fact.currency}.`;
        return `إيه، ${subject} كاين، بـ ${fact.effectivePrice} ${fact.currency}.`;
      }
      return `Yes, ${subject} is available, at ${fact.effectivePrice} ${fact.currency}.`;
    }
    return `${this.unavailableSentence(responseLanguage, responseScript, subject)}${hasVariant ? this.inStockOptions(fact, responseLanguage, responseScript) : ''}`;
  }

  /** XS, S, M, L, XL… then numbers ascending; anything else keeps its order. */
  private static sortSizes(sizes: string[]): string[] {
    const letter = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', '3XL', '4XL', '5XL'];
    const rank = (size: string) => {
      const index = letter.indexOf(size.toUpperCase());
      if (index >= 0) return index;
      const number = Number(size.replace(',', '.'));
      return Number.isFinite(number) ? 100 + number : 10000;
    };
    return [...sizes].sort((a, b) => rank(a) - rank(b));
  }

  /** "unavailable" as a short note after a price, in the reply's language. */
  private static unavailableNote(lang: string, script?: string): string {
    if (lang === 'fr') return 'indisponible pour le moment';
    if (lang === 'ar') return 'غير متوفر حالياً';
    if (lang === 'darija') return script === 'arabizi' ? 'ma b9ach daba' : 'ما بقاش حالياً';
    return 'currently unavailable';
  }

  /** "Sorry, <item> is not available right now." */
  private static unavailableSentence(lang: string, script?: string, subject?: string): string {
    if (lang === 'fr') return subject ? `Désolé, ${subject} n'est plus disponible pour le moment.` : `Cet article n'est plus disponible pour le moment.`;
    if (lang === 'ar') return subject ? `عذراً، ${subject} غير متوفر حالياً.` : 'هذا المنتج غير متوفر حالياً.';
    if (lang === 'darija') {
      if (script === 'arabizi') return subject ? `Smeh liya, ${subject} ma b9ach daba.` : 'Had lproduit ma b9ach daba.';
      return subject ? `سمح ليا، ${subject} ما بقاش حالياً.` : 'هاد المنتوج ما بقاش حالياً.';
    }
    return subject ? `Sorry, ${subject} is not available right now.` : 'This item is not available right now.';
  }

  /** The options still available, grouped by colour: " Still available: Noir (52, 56)." */
  private static inStockOptions(fact: ProductLookupResult, lang: string, script?: string): string {
    const arabicScript = lang === 'ar' || (lang === 'darija' && script !== 'arabizi');
    const sep = arabicScript ? '، ' : ', ';
    const byColor = new Map<string, string[]>();
    for (const v of fact.product.variants || []) {
      if ((v as any).active === false || !(Number(v.stock) > 0)) continue;
      const color = (v.color || '').trim(), size = (v.size || '').trim();
      if (!color && !size) continue;
      const list = byColor.get(color) || [];
      if (size && !list.includes(size)) list.push(size);
      byColor.set(color, list);
    }
    const options = [...byColor.entries()].map(([color, sizes]) => color && sizes.length ? `${color} (${AnswerComposer.sortSizes(sizes).join(sep)})` : color || AnswerComposer.sortSizes(sizes).join(sep)).join(' · ');
    if (!options) return '';
    if (lang === 'fr') return ` Encore disponible : ${options}.`;
    if (lang === 'ar') return ` المتوفر حالياً: ${options}.`;
    if (lang === 'darija') return script === 'arabizi' ? ` Ba9i kayn: ${options}.` : ` باقي كاين: ${options}.`;
    return ` Still available: ${options}.`;
  }

  public static readonly POLICY_HEADINGS: Record<string, Record<string, string>> = {
    SHIPPING: {
      en: 'Shipping Policy',
      fr: 'Politique de livraison',
      ar: 'سياسة الشحن',
      darija: 'سياسة التوصيل',
      arabizi: 'Siyasat Twsil'
    },
    RETURNS: {
      en: 'Return Policy',
      fr: 'Politique de retour',
      ar: 'سياسة الإرجاع',
      darija: 'سياسة الإرجاع',
      arabizi: 'Siyasat Rjou3'
    },
    CARE: {
      en: 'Care Instructions',
      fr: "Conseils d'entretien",
      ar: 'تعليمات العناية',
      darija: 'تعليمات الغسيل',
      arabizi: 'Ta3limat Ghsil'
    },
    TRACKING: {
      en: 'Order Tracking',
      fr: 'Suivi de commande',
      ar: 'تتبع الطلب',
      darija: 'تتبع الطلب',
      arabizi: 'Suivi dyal Talab'
    },
    WARRANTY: {
      en: 'Warranty Policy',
      fr: 'Politique de garantie',
      ar: 'سياسة الضمان',
      darija: 'سياسة الضمان',
      arabizi: 'Siyasat Daman'
    },
    PAYMENT: {
      en: 'Payment Methods',
      fr: 'Modes de paiement',
      ar: 'طرق الدفع',
      darija: 'طرق الخلاص',
      arabizi: 'Toroq Khlas'
    },
    SUPPORT: {
      en: 'Customer Support',
      fr: 'Service client',
      ar: 'خدمة العملاء',
      darija: 'خدمة الزبناء',
      arabizi: 'Khidmat Zobana'
    },
    STORE_INFO: {
      en: 'Store Information',
      fr: 'Informations de la boutique',
      ar: 'معلومات المتجر',
      darija: 'معلومات المحل',
      arabizi: 'Ma3loumat l-Magasin'
    },
    SIZE_GUIDE: {
      en: 'Size Guide',
      fr: 'Guide des tailles',
      ar: 'دليل المقاسات',
      darija: 'دليل المقاسات',
      arabizi: 'Guide dyal Les Tailles'
    }
  };

  /**
   * Deterministically composes clean multi-policy responses from trusted same-language chunks.
   */
  public static composeMultiPolicyDeterministic(
    policyItems: Array<{ intent?: string; heading?: string; content: string }>,
    lang: string = 'en',
    script?: string
  ): string {
    const seenContent = new Set<string>();
    const sections: string[] = [];
    const contentBudget = Math.min(220, Math.floor(440 / Math.max(1, policyItems.length)));

    for (const item of policyItems) {
      const trimmed = item.content?.trim();
      if (!trimmed) continue;
      
      const normalizedCheck = trimmed.toLowerCase();
      if (seenContent.has(normalizedCheck)) continue;
      seenContent.add(normalizedCheck);

      let heading: string | undefined;
      if (item.intent) {
        const intentKey = item.intent.toUpperCase();
        const headingMap = this.POLICY_HEADINGS[intentKey];
        if (headingMap) {
          if (script === 'arabizi' && headingMap.arabizi) {
            heading = headingMap.arabizi;
          } else {
            heading = headingMap[lang] || headingMap.en || item.intent;
          }
        } else {
          heading = item.intent.replace(/_/g, ' ');
        }
      }

      if (!heading) heading = item.heading;
      // Imported PDF titles and hard line breaks consume the mobile answer
      // budget before the actual facts. Keep each requested policy visible.
      const body = trimmed.replace(/^[^\n]{1,120}\n/u, '').replace(/\s+/gu, ' ').trim();
      const shortened = body.length <= contentBudget ? body : (() => {
        const excerpt = body.slice(0, contentBudget);
        const boundary = Math.max(excerpt.lastIndexOf('. '), excerpt.lastIndexOf('؟ '));
        const end = boundary >= contentBudget / 2 ? boundary + 1 : excerpt.lastIndexOf(' ');
        return `${excerpt.slice(0, end > 0 ? end : contentBudget).trim()}…`;
      })();
      if (heading) {
        sections.push(`### ${heading}\n${shortened}`);
      } else {
        sections.push(shortened);
      }
    }

    return sections.join('\n\n');
  }

  /**
   * Composes pure Knowledge RAG response, enforcing translation/script alignment when
   * raw chunk language mismatches target responseLanguage/responseScript.
   */
  public static async composeKnowledge(context: AnswerContext): Promise<string> {
    const { knowledgeFacts, responseLanguage, responseScript, llm, llmOptions, config, turnDecision } = context;

    if (!knowledgeFacts || knowledgeFacts.length === 0) {
      return this.composeFallback(context);
    }

    const topChunk = knowledgeFacts[0];
    if (!topChunk || !topChunk.trim()) {
      return this.composeFallback(context);
    }

    // Direct chunk return evaluation:
    // Allow raw chunk ONLY IF DirectRagGuard confirms language AND script match.
    if (config && context.userMessage && turnDecision?.intent === 'SHIPPING' &&
        PolicyEvidenceReuse.isScopeExpanded('SHIPPING', context.userMessage, config) &&
        !PolicyAnswerSafety.hasShippingScopeEvidence(context.userMessage,
          knowledgeFacts.map(content => ({ content })), config)) {
      return PolicyAnswerSafety.unknownShippingScope(responseLanguage, responseScript);
    }
    const directSafe = config && context.userMessage
      ? PolicyAnswerSafety.directAnswerIsSafe(context.userMessage, topChunk, undefined, config,
        responseLanguage, responseScript)
      : DirectRagGuard.evaluate(turnDecision?.productName || '', topChunk, responseLanguage, responseScript).isSafe;
    if (directSafe && !turnDecision?.isMultiPolicy) {
      return this.formatDirectKnowledgeAnswer(topChunk);
    }

    // Otherwise, translate/synthesize using LLM
    if (!llm) {
      // If no LLM available and raw chunk cannot be returned safely in target language/script
      return this.composeFallback(context);
    }

    const systemPrompt = `You are a helpful customer support assistant for ${config?.identity?.botName || 'our store'}.
Translate and express the authoritative store information from <KNOWLEDGE_BASE> in the customer's exact language and script.

Output Language: ${responseLanguage}
Output Script: ${responseScript} (if 'arabizi', use Moroccan Darija in Latin letters with numbers 3, 7, 9; if 'arabic', use Arabic script; if 'latin', use Latin script).

Rules:
1. Answer ONLY using the facts in <KNOWLEDGE_BASE>.
2. Never invent policies or facts.
3. If the knowledge base does not contain the answer, output exactly UNANSWERABLE.`;

    const userMessage = `<KNOWLEDGE_BASE>
${knowledgeFacts.join('\n\n')}
</KNOWLEDGE_BASE>

<CUSTOMER_QUESTION>
${turnDecision.inputQuery || ''}
</CUSTOMER_QUESTION>`;

    try {
      const response = await llm.generateResponse(
        systemPrompt,
        [{ role: 'user', content: userMessage }],
        llmOptions
      );
      if (!response || response.trim() === 'UNANSWERABLE' || response.includes('UNANSWERABLE')) {
        return this.composeFallback(context);
      }
      return response.trim();
    } catch (err) {
      logger.warn('AnswerComposer: Knowledge LLM synthesis failed', { err });
      return this.composeFallback(context);
    }
  }

  /**
   * Composes Hybrid response combining authoritative Product DB facts and Store Policy facts.
   */
  public static async composeHybrid(context: AnswerContext): Promise<string> {
    const { productFacts, knowledgeFacts, responseLanguage, responseScript, llm, llmOptions, config, turnDecision } = context;

    if (!knowledgeFacts || knowledgeFacts.length === 0) {
      return this.composeFallback(context);
    }

    const fact = Array.isArray(productFacts) ? productFacts[0] : productFacts;

    if (!llm) {
      return this.composeFallback(context);
    }

    const prodContext = fact ? `
Live Store Catalog Fact (Authoritative - DO NOT ALTER):
Product: ${fact.displayName}
SKU: ${fact.product.sku}
Price: ${fact.effectivePrice} ${fact.currency}
Availability: ${fact.inStock ? 'Available' : 'Currently unavailable'} (never state stock quantities to the customer)
Description: ${fact.displayDescription}
` : '';

    const systemPrompt = `You are a customer support assistant for ${config?.identity?.botName || 'our store'}.
Answer the customer's question by combining the Live Store Catalog Fact with the Store Policy Knowledge.

Output Language: ${responseLanguage}
Output Script: ${responseScript} (if 'arabizi', use Moroccan Darija in Latin script; if 'arabic', use Arabic script; if 'latin', use Latin script).

Rules:
1. Product identity, price (${fact?.effectivePrice || ''} ${fact?.currency || ''}), and stock status MUST NEVER be modified or hallucinated.
2. The store policies in <STORE_POLICY_KNOWLEDGE> apply store-wide.
3. If the information does not answer the question, output exactly UNANSWERABLE.`;

    const userMessage = `${prodContext}

<STORE_POLICY_KNOWLEDGE>
${knowledgeFacts.join('\n\n')}
</STORE_POLICY_KNOWLEDGE>

<CUSTOMER_QUESTION>
${turnDecision.inputQuery || ''}
</CUSTOMER_QUESTION>`;

    try {
      let response = await llm.generateResponse(
        systemPrompt,
        [{ role: 'user', content: userMessage }],
        llmOptions
      );
      if (!response || response.trim() === 'UNANSWERABLE' || response.includes('UNANSWERABLE')) {
        return this.composeFallback(context);
      }

      let answer = response.trim();

      // Source-of-truth protection: Enforce authoritative price and currency integrity
      if (fact) {
        // If LLM tried to alter the price number before the currency:
        const expectedPrice = `${fact.effectivePrice} ${fact.currency}`;
        const alteredPriceRegex = new RegExp(`\\b(\\d+(?:\\.\\d+)?)\\s*${fact.currency}\\b`, 'g');
        answer = answer.replace(alteredPriceRegex, (match, p1) => {
          if (p1 !== fact.effectivePrice && p1 !== String(Number(fact.effectivePrice))) {
            return expectedPrice;
          }
          return match;
        });

        // If LLM claimed out of stock when product is actually in stock:
        if (fact.inStock && (answer.toLowerCase().includes('out of stock') || answer.toLowerCase().includes('rupture de stock') || answer.includes('غير متوفر') || answer.includes('مسالي'))) {
          answer = answer
            .replace(/out of stock/gi, 'available')
            .replace(/rupture de stock/gi, 'disponible')
            .replace(/غير متوفر حالياً/g, 'متوفر')
            .replace(/مسالي حالياً/g, 'كاين');
        }
      }

      return answer;
    } catch (err) {
      logger.warn('AnswerComposer: Hybrid LLM synthesis failed', { err });
      return this.composeFallback(context);
    }
  }

  /**
   * Universal Final Response Boundary:
   * The single authoritative gate through which EVERY customer-visible response passes.
   * Enforces content-trust filtering (strips leaked internal labels/examples),
   * language/script invariants, boundary-safe length limiting, and safe localized fallback.
   */
  public static finalizeResponse(
    rawResponse: string,
    turnDecision?: TurnDecision | null,
    config?: BusinessConfig,
    options?: { maxResponseLength?: number; preserveTrailingWorkflowPrompt?: boolean }
  ): string {
    const lang = turnDecision?.responseLanguage || 'en';
    const script = turnDecision?.responseScript || 'latin';

    if (!rawResponse || typeof rawResponse !== 'string' || !rawResponse.trim()) {
      return this.composeFallback({
        turnDecision: turnDecision || { domain: 'FALLBACK', intent: 'FALLBACK', source: 'DETERMINISTIC', confidence: 1, responseLanguage: lang, responseScript: script },
        responseLanguage: lang,
        responseScript: script,
        config
      });
    }

    let cleaned = rawResponse.trim();

    // Reserved example/test domains are never usable customer contact channels.
    // A draft or demo profile may contain them, but the chatbot must not direct a
    // real customer to an inbox that cannot receive mail.
    const placeholderAddress = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.(?:test|example|invalid)\b|\b[A-Z0-9._%+-]+@example\.(?:com|org|net)\b/gi;
    if (placeholderAddress.test(cleaned)) {
      logger.warn('AnswerComposer.finalizeResponse: Placeholder contact address suppressed');
      // Mask addresses before sentence splitting so dots inside an email cannot
      // leave a partial, unusable contact behind. Keep unrelated answer sentences.
      const masked = cleaned.replace(placeholderAddress, '\uE000');
      const retained = masked.split(/(?<=[.!?؟])\s+|\n+/u).filter(sentence => !sentence.includes('\uE000')).join(' ').trim();
      const contactFallback = lang === 'fr' ? 'Continuez ici et notre équipe pourra vous aider.'
        : lang === 'ar' ? 'يمكنك متابعة المحادثة هنا وسيساعدك فريقنا.'
        : lang === 'darija' && script === 'arabizi' ? 'Kmml m3ana hna w l-equipe t3awnek.'
        : lang === 'darija' ? 'كمل معانا هنا والفريق يعاونك.'
        : 'Please continue here and our team can help.';
      cleaned = [retained, contactFallback].filter(Boolean).join(' ');
    }

    // 1. Content Trust / Internal Leak & Error Trace Sanitization
    if (/CONCURRENCY_CONFLICT|\bat (?:[a-zA-Z]:|\/app|\/src|\/node_modules)\b|Error:\s+/i.test(cleaned)) {
      logger.warn('AnswerComposer.finalizeResponse: Internal error or stack trace detected in response, sanitizing to fallback...');
      return this.composeFallback({
        turnDecision: turnDecision || { domain: 'FALLBACK', intent: 'FALLBACK', source: 'DETERMINISTIC', confidence: 1, responseLanguage: lang, responseScript: script },
        responseLanguage: lang,
        responseScript: script,
        config
      });
    }

    if (DirectRagGuard.hasInternalArtifacts(cleaned)) {
      logger.warn('AnswerComposer.finalizeResponse: Internal artifact pattern detected in response, sanitizing...');
      cleaned = DirectRagGuard.sanitizeInternalArtifacts(cleaned);
      if (!cleaned || cleaned.length < 5) {
        return this.composeFallback({
          turnDecision: turnDecision || { domain: 'FALLBACK', intent: 'FALLBACK', source: 'DETERMINISTIC', confidence: 1, responseLanguage: lang, responseScript: script },
          responseLanguage: lang,
          responseScript: script,
          config
        });
      }
    }

    // 2. Script Invariant Validation
    if (script === 'arabizi') {
      cleaned = cleaned.replace(/،/g, ',').replace(/؟/g, '?').replace(/؛/g, ';').replace(/ـ/g, '');
      const arabicMatches = cleaned.match(/[\u0621-\u064A\u0660-\u0669]/g) || [];
      const latinMatches = cleaned.match(/[a-zA-Z]/g) || [];

      // If response is predominantly Arabic script, enforce safe fallback
      if (arabicMatches.length > 5 && arabicMatches.length > latinMatches.length * 0.3) {
        logger.warn('AnswerComposer.finalizeResponse: Predominant Arabic script in Arabizi response, enforcing safe Arabizi fallback...');
        return this.composeFallback({
          turnDecision: turnDecision || { domain: 'FALLBACK', intent: 'FALLBACK', source: 'DETERMINISTIC', confidence: 1, responseLanguage: 'darija', responseScript: 'arabizi' },
          responseLanguage: 'darija',
          responseScript: 'arabizi',
          config
        });
      } else if (arabicMatches.length > 0) {
        // Strip isolated stray Arabic characters to strictly adhere to the Arabizi contract
        cleaned = cleaned.replace(/[\u0600-\u06FF]/g, '').replace(/\s+/g, ' ').trim();
      }
    }

    // 3. Response Length & Sentence Boundary Limiter
    const rawLimit = options?.maxResponseLength ?? config?.limits?.maxResponseLength ?? 500;
    const limit = (typeof rawLimit === 'number' && Number.isFinite(rawLimit) && rawLimit > 0)
      ? Math.floor(rawLimit)
      : (typeof (rawLimit as any) === 'string' && !isNaN(Number(rawLimit)) && Number(rawLimit) > 0
          ? Math.floor(Number(rawLimit))
          : 500);

    if (cleaned.length <= limit) {
      return cleaned;
    }

    // A side-answer must not use the space reserved for the pending workflow
    // question. Otherwise the customer sees the FAQ while the server silently
    // waits for a field whose prompt was cut from the reply.
    if (options?.preserveTrailingWorkflowPrompt) {
      const separator = '\n\n---\n';
      const splitAt = cleaned.lastIndexOf(separator);
      if (splitAt >= 0) {
        const pendingPrompt = cleaned.slice(splitAt + separator.length).trim();
        const answer = cleaned.slice(0, splitAt).trim();
        if (pendingPrompt) {
          const answerBudget = limit - pendingPrompt.length - separator.length;
          if (answerBudget <= 0) return pendingPrompt;
          if (answer.length <= answerBudget) return `${answer}${separator}${pendingPrompt}`;
          const excerpt = answer.slice(0, answerBudget);
          const lastBoundary = Math.max(excerpt.lastIndexOf('. '), excerpt.lastIndexOf('؟ '), excerpt.lastIndexOf('\n'));
          const shortened = (lastBoundary >= answerBudget / 2 ? excerpt.slice(0, lastBoundary + 1) : excerpt)
            .trimEnd();
          return `${shortened}${separator}${pendingPrompt}`;
        }
      }
    }

    const candidate = cleaned.slice(0, limit);

    // Find last complete sentence boundary within limit
    const sentenceTerminatorRegex = /[.!?؟\n]+(?=\s|$)/g;
    let lastSentenceEnd = -1;
    let match: RegExpExecArray | null;

    while ((match = sentenceTerminatorRegex.exec(candidate)) !== null) {
      const endPos = match.index + match[0].length;
      if (endPos >= 15 || endPos >= limit * 0.2) {
        lastSentenceEnd = endPos;
      }
    }

    if (lastSentenceEnd > 0) {
      return candidate.slice(0, lastSentenceEnd).trim();
    }

    // If no sentence boundary found, find last whitespace boundary before limit
    const lastWhitespace = candidate.lastIndexOf(' ');
    if (lastWhitespace > 0) {
      const wordSafeText = candidate.slice(0, lastWhitespace).replace(/[.,;:،؟!?\s]+$/, '').trim();
      return `${wordSafeText}...`;
    }

    return candidate;
  }
}
