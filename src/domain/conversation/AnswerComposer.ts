import { TurnDecision } from './TurnDecision';
import { ProductFact } from '../ecommerce/ProductRepository';
import { BusinessConfig, resolveLocalizedPrompt } from '../tenant/BusinessConfig';
import { LLMProvider, LLMRequestOptions } from '../../core/llm/LLMProvider';
import { SupportedLanguage } from '../faq/FaqMatcher';
import { DirectRagGuard } from '../rag/DirectRagGuard';
import { logger } from '../../utils/logger';
import { EvidenceBundle } from './EvidenceBundle';
import { ExecutionPlan } from './ExecutionPlan';
import { ClaimEvidenceRegistry } from './ClaimEvidenceRegistry';
import { ClaimValidator } from './ClaimValidator';

export interface FinalizeOptions {
  maxResponseLength?: number;
  evidenceRegistry?: ClaimEvidenceRegistry;
  bundle?: EvidenceBundle;
  productFacts?: ProductFact | ProductFact[] | null;
  knowledgeFacts?: string[] | null;
}

export interface AnswerContext {
  turnDecision: TurnDecision;
  productFacts?: ProductFact | ProductFact[] | null;
  knowledgeFacts?: string[] | null;
  responseLanguage: 'en' | 'fr' | 'ar' | 'darija';
  responseScript: 'latin' | 'arabic' | 'arabizi';
  config?: BusinessConfig;
  llm?: LLMProvider;
  llmOptions?: LLMRequestOptions;
}

export interface CompositeAnswerContext {
  bundle: EvidenceBundle;
  plan: ExecutionPlan;
  userQuery: string;
  config?: BusinessConfig;
  llm?: LLMProvider;
  llmOptions?: LLMRequestOptions;
  responseLanguage: 'en' | 'fr' | 'ar' | 'darija';
  responseScript: 'latin' | 'arabic' | 'arabizi';
}

export class AnswerComposer {
  /**
   * Universal response composer: Consumes TurnDecision, authoritative product facts,
   * authoritative RAG facts, and enforces target language/script output.
   */
  public static async compose(context: AnswerContext): Promise<string> {
    const { turnDecision } = context;

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

  /**
   * Composes localized Greeting response.
   */
  public static composeGreeting(context: AnswerContext): string {
    const { responseLanguage, config } = context;
    return resolveLocalizedPrompt(
      config?.prompts?.greeting,
      responseLanguage,
      responseLanguage === 'fr' ? 'Bonjour ! Comment puis-je vous aider aujourd’hui ?'
        : (responseLanguage === 'ar' ? 'مرحباً! كيف يمكنني مساعدتك اليوم؟'
        : (responseLanguage === 'darija' ? 'سلام! كيفاش نقدر نعاونك اليوم؟'
        : 'Hello! How can I help you today?'))
    );
  }

  /**
   * Composes localized Handoff response strictly respecting language and script.
   */
  public static composeHandoff(context: AnswerContext): string {
    const { responseLanguage, responseScript } = context;

    if (responseLanguage === 'fr') {
      return 'Un conseiller humain a été prévenu et va prendre le relais sous peu.';
    }
    if (responseLanguage === 'ar') {
      return 'تم إخطار أحد موظفي خدمة العملاء وسيقوم بمساعدتك قريباً.';
    }
    if (responseLanguage === 'darija') {
      if (responseScript === 'arabizi') {
        return "3lemna l'equipe d support w ghadi yjawbek chi wahed 9riban.";
      }
      return 'علمنا فريق الدعم وغادي يجاوبك واحد من الموظفين قريبا.';
    }
    return 'A human agent has been notified and will assist you shortly.';
  }

  /**
   * Composes localized Fallback response strictly respecting language and script.
   */
  public static composeFallback(context: AnswerContext): string {
    const { responseLanguage, responseScript, config } = context;

    if (config?.prompts?.fallback) {
      const custom = resolveLocalizedPrompt(config.prompts.fallback, responseLanguage, '');
      if (custom && custom.trim()) {
        // If Arabizi requested but prompt is in Arabic script, provide Arabizi
        if (responseLanguage === 'darija' && responseScript === 'arabizi' && /[\u0600-\u06FF]/.test(custom)) {
          return 'Smeh liya, ma3ndich had lme3louma db.';
        }
        return custom;
      }
    }

    if (responseLanguage === 'fr') {
      return 'Désolé, je ne dispose pas de cette information.';
    }
    if (responseLanguage === 'ar') {
      return 'عذراً، لا تتوفر لدي هذه المعلومة حالياً.';
    }
    if (responseLanguage === 'darija') {
      if (responseScript === 'arabizi') {
        return 'Smeh liya, ma3ndich had lme3louma db.';
      }
      return 'سمح ليا، ما عنديش هاد المعلومة حالياً.';
    }
    return 'I did not understand that. Could you rephrase?';
  }

  private static getSafeName(fact: ProductLookupResult | null | undefined, script?: string): string {
    if (!fact) return '';
    if (script === 'arabizi' && /[\u0600-\u06FF]/.test(fact.displayName)) {
      return (fact.product?.nameLocalized as any)?.en || fact.product?.name || fact.displayName;
    }
    return fact.displayName;
  }

  private static getSafeDescription(fact: ProductLookupResult | null | undefined, script?: string): string {
    if (!fact) return '';
    if (script === 'arabizi' && /[\u0600-\u06FF]/.test(fact.displayDescription)) {
      return (fact.product?.descriptionLocalized as any)?.en || fact.product?.description || fact.displayDescription;
    }
    return fact.displayDescription;
  }

  /**
   * Composes deterministic authoritative Ecommerce response strictly respecting language and script.
   */
  public static composeEcommerce(context: AnswerContext): string {
    const { turnDecision, productFacts, responseLanguage, responseScript } = context;

    // 1. Comparison
    if (turnDecision.intent === 'COMPARE') {
      const facts = Array.isArray(productFacts) ? productFacts : (productFacts ? [productFacts] : []);
      if (facts.length >= 2) {
        if (responseLanguage === 'fr') {
          return `Comparaison des produits :\n` + facts.map(c => `- ${this.getSafeName(c, responseScript)} : ${c.effectivePrice} ${c.currency} (${c.inStock ? `En stock: ${c.availableStock}` : 'Rupture'})`).join('\n');
        }
        if (responseLanguage === 'ar') {
          return `مقارنة المنتجات:\n` + facts.map(c => `- ${this.getSafeName(c, responseScript)}: ${c.effectivePrice} ${c.currency} (${c.inStock ? `متوفر: ${c.availableStock}` : 'غير متوفر'})`).join('\n');
        }
        if (responseLanguage === 'darija') {
          if (responseScript === 'arabizi') {
            return `Mo9arana:\n` + facts.map(c => `- ${this.getSafeName(c, responseScript)}: ${c.effectivePrice} ${c.currency} (${c.inStock ? `Kayen: ${c.availableStock}` : 'Msali'})`).join('\n');
          }
          return `مقارنة:\n` + facts.map(c => `- ${this.getSafeName(c, responseScript)}: ${c.effectivePrice} ${c.currency} (${c.inStock ? `كاين: ${c.availableStock}` : 'مسالي'})`).join('\n');
        }
        return `Product Comparison:\n` + facts.map(c => `- ${this.getSafeName(c, responseScript)}: ${c.effectivePrice} ${c.currency} (${c.inStock ? `In stock: ${c.availableStock}` : 'Out of stock'})`).join('\n');
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
        if (responseLanguage === 'fr') {
          return `Nous vous recommandons ${topName} (${top.effectivePrice} ${top.currency}) : ${top.inStock ? `En stock (${top.availableStock} disponibles)` : 'Rupture'}.`;
        }
        if (responseLanguage === 'ar') {
          return `نوصيك بـ ${topName} (${top.effectivePrice} ${top.currency}): ${top.inStock ? `متوفر (${top.availableStock} قطع)` : 'غير متوفر'}.`;
        }
        if (responseLanguage === 'darija') {
          if (responseScript === 'arabizi') {
            return `Kansehok b ${topName} (${top.effectivePrice} ${top.currency}): ${top.inStock ? `Kayen (${top.availableStock} pieces)` : 'Msali'}.`;
          }
          return `كننصحوك بـ ${topName} (${top.effectivePrice} ${top.currency}): ${top.inStock ? `متوفر (${top.availableStock} بياسات)` : 'مسالي'}.`;
        }
        return `We recommend ${topName} (${top.effectivePrice} ${top.currency}): ${top.inStock ? `In stock (${top.availableStock} available)` : 'Out of stock'}.`;
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
          const stockLabel = responseLanguage === 'fr'
            ? (r.inStock ? 'En stock' : 'Rupture')
            : (responseLanguage === 'ar'
              ? (r.inStock ? 'متوفر' : 'غير متوفر')
              : (responseLanguage === 'darija'
                ? (responseScript === 'arabizi' ? (r.inStock ? 'Kayen' : 'Msali') : (r.inStock ? 'كاين' : 'مسالي'))
                : (r.inStock ? 'In stock' : 'Out of stock')));
          const pName = this.getSafeName(r, responseScript);
          return `${i + 1}. ${pName} — ${r.effectivePrice} ${r.currency} (${stockLabel})`;
        }).join('\n');
        return `${header}\n\n${listStr}`;
      } else {
        const kw = turnDecision.searchKeywords || '';
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
        return `Désolé, ce produit n'est pas disponible actuellement dans notre catalogue.`;
      }
      if (responseLanguage === 'ar') {
        return `عذراً، هذا المنتج غير متوفر حالياً في متجرنا.`;
      }
      if (responseLanguage === 'darija') {
        if (responseScript === 'arabizi') {
          return `Smeh liya, had l-produit makaynch db f l-magasin dyalna.`;
        }
        return `سمح ليا، هاد المنتوج ما كاينش حالياً عندنا فالمحل.`;
      }
      return `Sorry, that product is not currently available in our catalog.`;
    }

    const safeFactName = this.getSafeName(fact, responseScript);
    const safeFactDesc = this.getSafeDescription(fact, responseScript);

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

    if (turnDecision.intent === 'PRODUCT_DETAIL') {
      if (responseLanguage === 'fr') {
        const variantsText = fact.product.variants?.length
          ? `\nOptions (tailles et couleurs) : ${fact.product.variants.map(v => `${v.color || ''} ${v.size || ''}`.trim()).filter(Boolean).join(', ')}`
          : '';
        return `${safeFactName}\n${safeFactDesc}\nPrix : ${fact.effectivePrice} ${fact.currency}${variantsText}\nDisponibilité : ${fact.inStock ? `En stock (${fact.availableStock} disponibles)` : 'Rupture de stock'}`;
      }
      if (responseLanguage === 'ar') {
        const variantsText = fact.product.variants?.length
          ? `\nالخيارات المتوفرة (المقاسات والألوان): ${fact.product.variants.map(v => `${v.color || ''} ${v.size || ''}`.trim()).filter(Boolean).join('، ')}`
          : '';
        return `${safeFactName}\n${safeFactDesc}\nالسعر: ${fact.effectivePrice} ${fact.currency}${variantsText}\nالحالة: ${fact.inStock ? `متوفر في المخزون (${fact.availableStock} قطع)` : 'غير متوفر حالياً'}`;
      }
      if (responseLanguage === 'darija') {
        if (responseScript === 'arabizi') {
          const variantsText = fact.product.variants?.length
            ? `\nKheyarat (taille w lwan): ${fact.product.variants.map(v => `${v.color || ''} ${v.size || ''}`.trim()).filter(Boolean).join(', ')}`
            : '';
          return `${safeFactName}\n${safeFactDesc}\nTaman: ${fact.effectivePrice} ${fact.currency}${variantsText}\nStock: ${fact.inStock ? `Kayen (${fact.availableStock} pieces)` : 'Msali db'}`;
        }
        const variantsText = fact.product.variants?.length
          ? `\nالخيارات اللي كاينين (القياس والألوان): ${fact.product.variants.map(v => `${v.color || ''} ${v.size || ''}`.trim()).filter(Boolean).join('، ')}`
          : '';
        return `${safeFactName}\n${safeFactDesc}\nالثمن: ${fact.effectivePrice} ${fact.currency}${variantsText}\nالمخزون: ${fact.inStock ? `كاين (${fact.availableStock} بياسات)` : 'مسالي حالياً'}`;
      }
      const variantsText = fact.product.variants?.length
        ? `\nAvailable options (colors & sizes): ${fact.product.variants.map(v => `${v.color || ''} ${v.size || ''}`.trim()).filter(Boolean).join(', ')}`
        : '';
      return `${safeFactName}\n${safeFactDesc}\nPrice: ${fact.effectivePrice} ${fact.currency}${variantsText}\nAvailability: ${fact.inStock ? `In stock (${fact.availableStock} available)` : 'Out of stock'}`;
    }

    if (turnDecision.intent === 'PRICE') {
      if (responseLanguage === 'fr') {
        return `Le prix de ${safeFactName} est de ${fact.effectivePrice} ${fact.currency}.`;
      }
      if (responseLanguage === 'ar') {
        return `سعر ${safeFactName} هو ${fact.effectivePrice} ${fact.currency}.`;
      }
      if (responseLanguage === 'darija') {
        if (responseScript === 'arabizi') {
          return `Taman dyal ${safeFactName} howa ${fact.effectivePrice} ${fact.currency}.`;
        }
        return `الثمن ديال ${safeFactName} هو ${fact.effectivePrice} ${fact.currency}.`;
      }
      return `The price for ${safeFactName} is ${fact.effectivePrice} ${fact.currency}.`;
    }

    // AVAILABILITY or VARIANT_SELECTION
    if (fact.inStock) {
      if (responseLanguage === 'fr') {
        return `${safeFactName} est disponible au prix de ${fact.effectivePrice} ${fact.currency}. (En stock: ${fact.availableStock})`;
      }
      if (responseLanguage === 'ar') {
        return `${safeFactName} متوفر بسعر ${fact.effectivePrice} ${fact.currency}. (الكمية المتوفرة: ${fact.availableStock})`;
      }
      if (responseLanguage === 'darija') {
        if (responseScript === 'arabizi') {
          return `${safeFactName} kayen f stock b ${fact.effectivePrice} ${fact.currency}. (Kayen mno: ${fact.availableStock})`;
        }
        return `${safeFactName} كاين فالمخزون بالثمن ديال ${fact.effectivePrice} ${fact.currency}. (كاين منو: ${fact.availableStock})`;
      }
      return `${safeFactName} is available for ${fact.effectivePrice} ${fact.currency}. (In stock: ${fact.availableStock})`;
    } else {
      const variantsList = fact.product.variants?.map(v => `${v.color || ''} ${v.size || ''}`.trim()).filter(Boolean);
      if (turnDecision.size || (turnDecision.color && turnDecision.color !== 'ALL')) {
        if (responseLanguage === 'fr') {
          const availStr = variantsList?.length ? ` (Options disponibles : ${variantsList.join(', ')})` : '';
          return `Désolé, ${safeFactName} est actuellement en rupture de stock pour cette option.${availStr}`;
        }
        if (responseLanguage === 'ar') {
          const availStr = variantsList?.length ? ` (الخيارات المتوفرة: ${variantsList.join('، ')})` : '';
          return `عذراً، ${safeFactName} غير متوفر حالياً في المخزون بالمقاس/اللون المطلوب.${availStr}`;
        }
        if (responseLanguage === 'darija') {
          if (responseScript === 'arabizi') {
            const availStr = variantsList?.length ? ` (Kheyarat li kaynin: ${variantsList.join(', ')})` : '';
            return `Smeh liya, ${safeFactName} msali db mn stock f had taille/loun.${availStr}`;
          }
          const availStr = variantsList?.length ? ` (الخيارات اللي كاينين: ${variantsList.join('، ')})` : '';
          return `سمح ليا، ${safeFactName} مسالي حالياً من المخزون فهاد القياس/اللون.${availStr}`;
        }
        const availStr = variantsList?.length ? ` (Available options: ${variantsList.join(', ')})` : '';
        return `Sorry, ${safeFactName} is currently out of stock for that option.${availStr}`;
      } else {
        if (responseLanguage === 'fr') {
          return `Désolé, ${safeFactName} est actuellement en rupture de stock.`;
        }
        if (responseLanguage === 'ar') {
          return `عذراً، ${safeFactName} غير متوفر حالياً في المخزون.`;
        }
        if (responseLanguage === 'darija') {
          if (responseScript === 'arabizi') {
            return `Smeh liya, ${safeFactName} msali db mn stock.`;
          }
          return `سمح ليا، ${safeFactName} مسالي حالياً من المخزون.`;
        }
        return `Sorry, ${safeFactName} is currently out of stock.`;
      }
    }
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
    const guardResult = DirectRagGuard.evaluate(turnDecision?.productName || '', topChunk, responseLanguage, responseScript);
    if (guardResult.isSafe) {
      return topChunk.trim();
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
Stock: ${fact.inStock ? `In stock (${fact.availableStock})` : 'Out of stock'}
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
            .replace(/out of stock/gi, `in stock (${fact.availableStock} available)`)
            .replace(/rupture de stock/gi, `en stock (${fact.availableStock} disponibles)`)
            .replace(/غير متوفر حالياً/g, `متوفر في المخزون (${fact.availableStock} قطع)`)
            .replace(/مسالي حالياً/g, `كاين فالمخزون (${fact.availableStock} بياسات)`);
        }
      }

      return answer;
    } catch (err) {
      logger.warn('AnswerComposer: Hybrid LLM synthesis failed', { err });
      return this.composeFallback(context);
    }
  }

  /**
   * Phase 33D: Global Composite / Multi-Intent Response Composer.
   * Synthesizes authoritative catalog facts, batched policy knowledge, comparison sets,
   * recommendation evidence, and unavailable topic notices in exactly 1 LLM call (or 0 if deterministic).
   */
  public static async composeComposite(context: CompositeAnswerContext): Promise<string> {
    const { bundle, plan, userQuery, config, llm, llmOptions, responseLanguage, responseScript } = context;
    const fact = bundle.primaryProductFact;
    const policyEntries = Object.entries(bundle.policyEvidenceByIntent);
    const unavailableTasks = bundle.taskAccounting.unavailableTasks;

    // 1. If 0 LLM budget or no LLM provider or purely deterministic composite (no knowledge policy synthesis needed)
    if (!plan.requiresLlmSynthesis || !llm) {
      return this.composeDeterministicComposite(context);
    }

    // 2. Multi-intent synthesis using exactly 1 LLM call
    const catalogFactText = fact ? `
Product: ${fact.displayName}
SKU: ${fact.product.sku}
Price: ${fact.effectivePrice} ${fact.currency}
Stock Status: ${fact.inStock ? `In Stock (${fact.availableStock} available)` : 'Out of Stock'}
Available Variants: ${(fact.product?.variants || []).length > 0 ? (fact.product?.variants || []).map(v => `${v.color || ''} ${v.size || ''} (${v.sku}: ${v.priceOverride || fact.effectivePrice} ${fact.currency})`).join(', ') : 'Standard'}
Description: ${fact.displayDescription}
` : '';

    const seenChunkContents = new Set<string>();
    const knowledgeSections = policyEntries
      .filter(([_, ev]) => ev.found && ev.chunks.length > 0)
      .map(([intent, ev]) => {
        const uniqueChunks = ev.chunks.filter(c => {
          const content = c.content?.trim();
          if (!content || seenChunkContents.has(content)) return false;
          seenChunkContents.add(content);
          return true;
        });
        if (uniqueChunks.length === 0) return '';
        return `[POLICY TOPIC: ${intent}]\n${uniqueChunks.map(c => c.content).join('\n')}`;
      })
      .filter(Boolean)
      .join('\n\n');

    const unmappedChunks = (bundle.policyChunks || []).filter(c => {
      const content = c.content?.trim();
      return content && !seenChunkContents.has(content);
    });
    const fullKnowledgeText = knowledgeSections + (unmappedChunks.length > 0 ? `${knowledgeSections ? '\n\n' : ''}[POLICY TOPIC: GENERAL]\n${unmappedChunks.map(c => c.content).join('\n')}` : '');

    const unavailableTopics = unavailableTasks.map(t => t.replace(/^task-\d+-/i, '').toUpperCase());

    const systemPrompt = `You are a helpful customer support assistant for ${config?.identity?.botName || 'our store'}.
Answer the customer's multi-topic inquiry thoroughly and concisely by synthesizing the Live Store Catalog Fact and Store Policy Knowledge.

Output Language: ${responseLanguage}
Output Script: ${responseScript} (if 'arabizi', use Moroccan Darija in Latin letters with 3, 7, 9; if 'arabic', use Arabic script; if 'latin', use Latin script).

Rules:
1. Product price (${fact?.effectivePrice || ''} ${fact?.currency || ''}) and stock status MUST NEVER be altered or hallucinated.
2. Use the Policy Knowledge sections to answer all requested store policy topics (returns, shipping, care, tracking, etc.).
3. Missing / Unavailable Information: If any topic is listed under UNAVAILABLE_TOPICS (${unavailableTopics.join(', ')}), explicitly state that information on that topic is currently unavailable in our store policy.
4. Address all parts of the customer's request in a single coherent answer.
5. If completely unanswerable, output exactly UNANSWERABLE.`;

    const userMessage = `${catalogFactText ? `<STORE_CATALOG_FACT>\n${catalogFactText}\n</STORE_CATALOG_FACT>\n\n` : ''}${fullKnowledgeText ? `<STORE_POLICY_KNOWLEDGE>\n${fullKnowledgeText}\n</STORE_POLICY_KNOWLEDGE>\n\n` : ''}${unavailableTopics.length > 0 ? `<UNAVAILABLE_TOPICS>\n${unavailableTopics.join(', ')}\n</UNAVAILABLE_TOPICS>\n\n` : ''}<CUSTOMER_QUESTION>\n${userQuery}\n</CUSTOMER_QUESTION>`;

    try {
      let response = await llm.generateResponse(
        systemPrompt,
        [{ role: 'user', content: userMessage }],
        { ...(llmOptions || {}), timeoutMs: 3500 }
      );

      if (!response || response.trim() === 'UNANSWERABLE' || response.includes('UNANSWERABLE')) {
        return this.composeDeterministicComposite(context);
      }

      let answer = response.trim();

      // Source-of-truth protection
      if (fact) {
        const expectedPrice = `${fact.effectivePrice} ${fact.currency}`;
        const alteredPriceRegex = new RegExp(`\\b(\\d+(?:\\.\\d+)?)\\s*${fact.currency}\\b`, 'g');
        answer = answer.replace(alteredPriceRegex, (match, p1) => {
          if (p1 !== String(fact.effectivePrice) && p1 !== String(Number(fact.effectivePrice))) {
            return expectedPrice;
          }
          return match;
        });

        // Ensure authoritative product details are present
        if (!answer.includes(String(fact.effectivePrice))) {
          const detHeader = this.composeDeterministicComposite(context);
          if (answer !== 'Mocked response') {
            answer = `${detHeader}\n\n${answer}`;
          } else {
            answer = detHeader;
          }
        }

        if (fact.inStock && (answer.toLowerCase().includes('out of stock') || answer.toLowerCase().includes('rupture de stock') || answer.includes('غير متوفر') || answer.includes('مسالي'))) {
          answer = answer
            .replace(/out of stock/gi, `in stock (${fact.availableStock} available)`)
            .replace(/rupture de stock/gi, `en stock (${fact.availableStock} disponibles)`)
            .replace(/غير متوفر حالياً/g, `متوفر في المخزون (${fact.availableStock} قطع)`)
            .replace(/مسالي حالياً/g, `كاين فالمخزون (${fact.availableStock} بياسات)`);
        }
      }

      return answer;
    } catch (err) {
      logger.warn('AnswerComposer: Composite LLM synthesis failed, falling back to deterministic composition', { err });
      return this.composeDeterministicComposite(context);
    }
  }

  /**
   * Deterministic composite composer (0 LLM calls).
   */
  public static composeDeterministicComposite(context: CompositeAnswerContext): string {
    const { bundle, plan, responseLanguage, responseScript } = context;
    const parts: string[] = [];
    const fact = bundle.primaryProductFact;

    // 1. Recommendation if present
    if (bundle.recommendationResults?.topFact) {
      const rec = bundle.recommendationResults.topFact;
      if (responseLanguage === 'fr') {
        parts.push(`Nous vous recommandons ${rec.displayName} au prix de ${rec.effectivePrice} ${rec.currency}.`);
      } else if (responseLanguage === 'ar') {
        parts.push(`نرشح لك ${rec.displayName} بسعر ${rec.effectivePrice} ${rec.currency}.`);
      } else if (responseLanguage === 'darija') {
        if (responseScript === 'arabizi') {
          parts.push(`Kankhtarou lik ${rec.displayName} b taman d ${rec.effectivePrice} ${rec.currency}.`);
        } else {
          parts.push(`كنرشحو ليك ${rec.displayName} بثمن ${rec.effectivePrice} ${rec.currency}.`);
        }
      } else {
        parts.push(`We recommend ${rec.displayName} priced at ${rec.effectivePrice} ${rec.currency}.`);
      }
    }
    // 2. Primary Product Details / Price / Stock (only when explicitly requested in plan)
    else if (fact && (plan?.tasks?.some(t => t.type === 'ECOMMERCE_FACT') || plan?.tasks?.some(t => Boolean(t.targetProductId || t.targetProductName || t.targetSku)))) {
      const prodName = (responseScript === 'arabizi' && /[\u0600-\u06FF]/.test(fact.displayName))
        ? (fact.product?.nameLocalized as any)?.en || fact.product?.name || 'product'
        : fact.displayName;

      const inStockText = fact.inStock
        ? (responseLanguage === 'fr' ? `en stock (${fact.availableStock} disponibles)`
            : (responseLanguage === 'ar' ? `متوفر في المخزون (${fact.availableStock} قطع)`
            : (responseLanguage === 'darija' ? (responseScript === 'arabizi' ? `kayn f stock (${fact.availableStock} habba)` : `كاين فالمخزون (${fact.availableStock} بياسات)`)
            : `in stock (${fact.availableStock} available)`)))
        : (responseLanguage === 'fr' ? 'actuellement en rupture de stock'
            : (responseLanguage === 'ar' ? 'غير متوفر حالياً في المخزون'
            : (responseLanguage === 'darija' ? (responseScript === 'arabizi' ? 'makaynch db f stock' : 'ما كاينش دابا فالمخزون')
            : 'currently out of stock')));

      if (responseLanguage === 'fr') {
        parts.push(`${prodName} est disponible au prix de ${fact.effectivePrice} ${fact.currency} (${inStockText}).`);
      } else if (responseLanguage === 'ar') {
        parts.push(`منتج ${prodName} سعره ${fact.effectivePrice} ${fact.currency} (${inStockText}).`);
      } else if (responseLanguage === 'darija') {
        if (responseScript === 'arabizi') {
          parts.push(`L-produit ${prodName} taman dyalo ${fact.effectivePrice} ${fact.currency} (${inStockText}).`);
        } else {
          parts.push(`المنتوج ${prodName} الثمن ديالو ${fact.effectivePrice} ${fact.currency} (${inStockText}).`);
        }
      } else {
        parts.push(`${prodName} is priced at ${fact.effectivePrice} ${fact.currency} (${inStockText}).`);
      }
    }

    // 3. Comparison if present
    if (bundle.comparisonFacts.length >= 2) {
      const compText = bundle.comparisonFacts.map(f => {
        const pName = (responseScript === 'arabizi' && /[\u0600-\u06FF]/.test(f.displayName))
          ? (f.product?.nameLocalized as any)?.en || f.product?.name || 'product'
          : f.displayName;
        return `${pName}: ${f.effectivePrice} ${f.currency} (${f.inStock ? 'In stock' : 'Out of stock'})`;
      }).join(' vs ');
      parts.push(compText);
    }

    // 4. Policy Evidence by Intent
    for (const [intent, ev] of Object.entries(bundle.policyEvidenceByIntent)) {
      if (ev.found && ev.chunks.length > 0) {
        const filteredChunks = ev.chunks.filter(c => {
          if (responseScript === 'arabizi' && /[\u0600-\u06FF]/.test(c.content)) {
            return false;
          }
          return true;
        });
        if (filteredChunks.length > 0) {
          const chunkText = filteredChunks.map(c => c.content.trim()).join('\n');
          parts.push(chunkText);
        }
      }
    }

    // 5. Explicit Missing / Unavailable Topic notes
    for (const unavailableTaskId of bundle.taskAccounting.unavailableTasks) {
      const topic = unavailableTaskId.replace(/^task-\d+-/i, '').toUpperCase();
      parts.push(this.getUnavailableTopicNote(topic, responseLanguage, responseScript));
    }

    return parts.filter(Boolean).join('\n\n');
  }

  public static getUnavailableTopicNote(topic: string, lang: SupportedLanguage, script: 'latin' | 'arabic' | 'arabizi'): string {
    const t = topic.toUpperCase();
    if (t === 'CARE') {
      if (lang === 'fr') return "Les instructions d'entretien et de lavage ne sont pas disponibles actuellement dans notre politique.";
      if (lang === 'ar') return "معلومات طريقة الغسيل والعناية غير متوفرة حالياً في سياسة المتجر.";
      if (lang === 'darija') {
        if (script === 'arabizi') return "Lme3loumat dyal lghsil w l3inaya mamtwffrach db f siyasa d lme7al.";
        return "معلومات طريقة الغسيل والعناية ما متوفرينش حاليا فسياسة المحل.";
      }
      return "Care and washing instructions are currently not available in our store policy.";
    }
    if (t === 'RETURNS') {
      if (lang === 'fr') return "Les informations de retour et d'échange ne sont pas disponibles actuellement dans notre politique.";
      if (lang === 'ar') return "معلومات الإرجاع والاستبدال غير متوفرة حالياً في سياسة المتجر.";
      if (lang === 'darija') {
        if (script === 'arabizi') return "Lme3loumat dyal rtour w tbdil mamtwffrach db f siyasa d lme7al.";
        return "معلومات الإرجاع والتبديل ما متوفرينش حاليا فسياسة المحل.";
      }
      return "Return and exchange information is currently not available in our store policy.";
    }
    if (t === 'SHIPPING') {
      if (lang === 'fr') return "Les informations de livraison et d'expédition ne sont pas disponibles actuellement dans notre politique.";
      if (lang === 'ar') return "معلومات الشحن والتوصيل غير متوفرة حالياً في سياسة المتجر.";
      if (lang === 'darija') {
        if (script === 'arabizi') return "Lme3loumat dyal tawsil mamtwffrach db f siyasa d lme7al.";
        return "معلومات التوصيل والشحن ما متوفرينش حاليا فسياسة المحل.";
      }
      return "Shipping and delivery information is currently not available in our store policy.";
    }
    if (t === 'TRACKING') {
      if (lang === 'fr') return "Les informations de suivi de commande ne sont pas disponibles actuellement dans notre politique.";
      if (lang === 'ar') return "معلومات تتبع الطلب غير متوفرة حالياً في سياسة المتجر.";
      if (lang === 'darija') {
        if (script === 'arabizi') return "Lme3loumat dyal ttabo3 d ttalab mamtwffrach db f siyasa d lme7al.";
        return "معلومات تتبع الطلب ما متوفرينش حاليا فسياسة المحل.";
      }
      return "Order tracking information is currently not available in our store policy.";
    }
    if (t === 'PRICE') {
      if (lang === 'fr') return "Le prix de cet article n'est pas disponible.";
      if (lang === 'ar') return "سعر هذا المنتج غير متوفر.";
      if (lang === 'darija') return script === 'arabizi' ? "Taman dyal had l-produit mamtwffrch." : "ثمن هاد المنتوج ما متوفرش.";
      return "Price information for this item is not available.";
    }

    if (lang === 'fr') return `L'information concernant ${topic.toLowerCase()} n'est pas disponible actuellement.`;
    if (lang === 'ar') return `المعلومات بخصوص ${topic} غير متوفرة حالياً.`;
    if (lang === 'darija') return script === 'arabizi' ? `Lme3loumat dyal ${topic} mamtwffrach db.` : `المعلومات بخصوص ${topic} ما متوفرينش حاليا.`;
    return `Information regarding ${topic.toLowerCase()} is currently not available.`;
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
    options?: { maxResponseLength?: number }
  ): string {
    const lang = turnDecision?.responseLanguage || 'en';
    const script = turnDecision?.responseScript || 'latin';

    if (!rawResponse || typeof rawResponse !== 'string' || !rawResponse.trim()) {
      return this.composeFallback({
        turnDecision: turnDecision || { domain: 'FALLBACK', intent: 'FALLBACK', confidence: 1, responseLanguage: lang, responseScript: script },
        responseLanguage: lang,
        responseScript: script,
        config
      });
    }

    let cleaned = rawResponse.trim();

    // 1. Content Trust / Internal Leak & Error Trace Sanitization
    if (/CONCURRENCY_CONFLICT|\bat (?:[a-zA-Z]:|\/app|\/src|\/node_modules)\b|Error:\s+/i.test(cleaned)) {
      logger.warn('AnswerComposer.finalizeResponse: Internal error or stack trace detected in response, sanitizing to fallback...');
      return this.composeFallback({
        turnDecision: turnDecision || { domain: 'FALLBACK', intent: 'FALLBACK', confidence: 1, responseLanguage: lang, responseScript: script },
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
          turnDecision: turnDecision || { domain: 'FALLBACK', intent: 'FALLBACK', confidence: 1, responseLanguage: lang, responseScript: script },
          responseLanguage: lang,
          responseScript: script,
          config
        });
      }
    }

    // 2. Script Invariant Validation
    if (script === 'arabizi') {
      // Arabizi output MUST NOT contain Arabic script characters
      if (/[\u0600-\u06FF]/.test(cleaned)) {
        logger.warn('AnswerComposer.finalizeResponse: Arabic script leaked into Arabizi response, enforcing safe Arabizi fallback...');
        return this.composeFallback({
          turnDecision: turnDecision || { domain: 'FALLBACK', intent: 'FALLBACK', confidence: 1, responseLanguage: 'darija', responseScript: 'arabizi' },
          responseLanguage: 'darija',
          responseScript: 'arabizi',
          config
        });
      }
    }

    // 2.5 Factual Claim Grounding Validation (Phase 33E)
    let evidenceRegistry = options?.evidenceRegistry;
    if (!evidenceRegistry && options?.bundle) {
      evidenceRegistry = ClaimEvidenceRegistry.fromEvidenceBundle(options.bundle);
    } else if (!evidenceRegistry && (options?.productFacts || options?.knowledgeFacts)) {
      evidenceRegistry = ClaimEvidenceRegistry.fromFacts(options.productFacts, options.knowledgeFacts);
    }

    if (evidenceRegistry) {
      const validation = ClaimValidator.validate(cleaned, evidenceRegistry, {
        fallbackLanguage: lang,
        fallbackScript: script
      });
      cleaned = validation.sanitizedText;
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
