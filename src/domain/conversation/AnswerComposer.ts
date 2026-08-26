import { TurnDecision } from './TurnDecision';
import { ProductFact } from '../ecommerce/ProductRepository';
import { EcommerceIntentParser } from '../ecommerce/EcommerceIntent';
import { BusinessConfig, resolveLocalizedPrompt, DEFAULT_HANDOFF_MESSAGES } from '../tenant/BusinessConfig';
import { LLMProvider, LLMRequestOptions } from '../../core/llm/LLMProvider';
import { SupportedLanguage } from '../faq/FaqMatcher';
import { DirectRagGuard } from '../rag/DirectRagGuard';
import { logger } from '../../utils/logger';

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
    const { responseLanguage, responseScript, config } = context;

    const defaultHandoff = DEFAULT_HANDOFF_MESSAGES[responseLanguage as keyof typeof DEFAULT_HANDOFF_MESSAGES] || DEFAULT_HANDOFF_MESSAGES.en;

    if (config?.prompts?.handoff) {
      const custom = resolveLocalizedPrompt(config.prompts.handoff, responseLanguage, '');
      if (custom && custom.trim()) {
        if (responseLanguage === 'darija' && responseScript === 'arabizi' && /[\u0600-\u06FF]/.test(custom)) {
          return 'ghadi n7ewlek l 3end wa7d mn l-fariq dyalna.';
        }
        return custom;
      }
    }

    if (responseLanguage === 'darija' && responseScript === 'arabizi') {
      return 'ghadi n7ewlek l 3end wa7d mn l-fariq dyalna.';
    }

    return defaultHandoff;
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
      if (!hasEvidence && family) {
        if (family === 'PERFORMANCE') {
          hasEvidence = /(?:waterproof|water-resistant|rainproof|warm|breathable|windproof|imperm[ée]able|chaud|respirant|مقاوم|ضد الما|ضد الماء|سخون|دافئ)/iu.test(descLower);
        } else if (family === 'MATERIAL') {
          hasEvidence = /(?:cotton|polyester|leather|fleece|wool|silk|linen|denim|nylon|coton|cuir|mati[èe]re|tissu|composition|قطن|جلد|قماش|ثوب|صوف|حرير|توب)/iu.test(descLower);
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

      if (!hasEvidence && safeFactDesc) {
        if (responseLanguage === 'fr') {
          return `Les informations disponibles pour ${safeFactName} ne mentionnent pas cette caractéristique spécifique (${safeFactDesc}).`;
        }
        if (responseLanguage === 'ar') {
          return `المعلومات المتوفرة لـ ${safeFactName} لا تشير إلى هذه الخاصية تحديداً (${safeFactDesc}).`;
        }
        if (responseLanguage === 'darija') {
          if (responseScript === 'arabizi') {
            return `L-me3loumat li kaynin 3la ${safeFactName} mafihomch had l-khasya b d-debt (${safeFactDesc}).`;
          }
          return `المعلومات المتوفرة على ${safeFactName} ما فيهاش هاد الخاصية بالضبط (${safeFactDesc}).`;
        }
        return `The product details for ${safeFactName} do not specify this particular feature (${safeFactDesc}).`;
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
      const variant = fact.selectedVariant;
      const variantLabel = this.formatVariantLabel(variant?.color || turnDecision.color, variant?.size || turnDecision.size, responseLanguage, responseScript);
      const priceSubject = variantLabel ? `${safeFactName} (${variantLabel})` : safeFactName;

      if (responseLanguage === 'fr') {
        return `Le prix de ${priceSubject} est de ${fact.effectivePrice} ${fact.currency}.`;
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
      return `The price for ${priceSubject} is ${fact.effectivePrice} ${fact.currency}.`;
    }

    // AVAILABILITY or VARIANT_SELECTION
    const variant = fact.selectedVariant;
    const resolvedColor = variant?.color || (turnDecision.color && turnDecision.color !== 'ALL' ? turnDecision.color : undefined);
    const resolvedSize = variant?.size || turnDecision.size || undefined;
    const hasVariant = !!(resolvedColor || resolvedSize);
    const variantLabel = hasVariant ? this.formatVariantLabel(resolvedColor, resolvedSize, responseLanguage, responseScript) : '';

    if (fact.inStock) {
      if (hasVariant) {
        // Variant-level in-stock response
        if (responseLanguage === 'fr') {
          return `${safeFactName} (${variantLabel}) est disponible au prix de ${fact.effectivePrice} ${fact.currency}. (En stock : ${fact.availableStock})`;
        }
        if (responseLanguage === 'ar') {
          return `${safeFactName} (${variantLabel}) متوفر بسعر ${fact.effectivePrice} ${fact.currency}. (الكمية المتوفرة: ${fact.availableStock})`;
        }
        if (responseLanguage === 'darija') {
          if (responseScript === 'arabizi') {
            return `${safeFactName} (${variantLabel}) kayen f stock b ${fact.effectivePrice} ${fact.currency}. (Kayen mno: ${fact.availableStock})`;
          }
          return `${safeFactName} (${variantLabel}) كاين فالمخزون بالثمن ديال ${fact.effectivePrice} ${fact.currency}. (كاين منو: ${fact.availableStock})`;
        }
        return `${safeFactName} (${variantLabel}) is available for ${fact.effectivePrice} ${fact.currency}. (In stock: ${fact.availableStock})`;
      } else {
        // Product-level in-stock response (unchanged)
        if (responseLanguage === 'fr') {
          return `${safeFactName} est disponible au prix de ${fact.effectivePrice} ${fact.currency}. (En stock : ${fact.availableStock})`;
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
      }
    } else {
      const variantsList = fact.product.variants?.filter(v => v.stock > 0).map(v => `${v.color || ''} ${v.size || ''}`.trim()).filter(Boolean);
      if (hasVariant) {
        // Variant-level out-of-stock response
        if (responseLanguage === 'fr') {
          const availStr = variantsList?.length ? ` (Options disponibles : ${variantsList.join(', ')})` : '';
          return `Désolé, ${safeFactName} (${variantLabel}) est actuellement en rupture de stock.${availStr}`;
        }
        if (responseLanguage === 'ar') {
          const availStr = variantsList?.length ? ` (الخيارات المتوفرة: ${variantsList.join('، ')})` : '';
          return `عذراً، ${safeFactName} (${variantLabel}) غير متوفر حالياً في المخزون.${availStr}`;
        }
        if (responseLanguage === 'darija') {
          if (responseScript === 'arabizi') {
            const availStr = variantsList?.length ? ` (Kheyarat li kaynin: ${variantsList.join(', ')})` : '';
            return `Smeh liya, ${safeFactName} (${variantLabel}) msali db mn stock.${availStr}`;
          }
          const availStr = variantsList?.length ? ` (الخيارات اللي كاينين: ${variantsList.join('، ')})` : '';
          return `سمح ليا، ${safeFactName} (${variantLabel}) مسالي حالياً من المخزون.${availStr}`;
        }
        const availStr = variantsList?.length ? ` (Available options: ${variantsList.join(', ')})` : '';
        return `Sorry, ${safeFactName} (${variantLabel}) is currently out of stock.${availStr}`;
      } else {
        // Product-level out-of-stock response (unchanged)
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

    for (const item of policyItems) {
      const trimmed = item.content?.trim();
      if (!trimmed) continue;
      
      const normalizedCheck = trimmed.toLowerCase();
      if (seenContent.has(normalizedCheck)) continue;
      seenContent.add(normalizedCheck);

      let heading = item.heading;
      if (!heading && item.intent) {
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

      if (heading) {
        sections.push(`### ${heading}\n${trimmed}`);
      } else {
        sections.push(trimmed);
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
      cleaned = cleaned.replace(/،/g, ',').replace(/؟/g, '?').replace(/؛/g, ';').replace(/ـ/g, '');
      const arabicMatches = cleaned.match(/[\u0621-\u064A\u0660-\u0669]/g) || [];
      const latinMatches = cleaned.match(/[a-zA-Z]/g) || [];

      // If response is predominantly Arabic script, enforce safe fallback
      if (arabicMatches.length > 5 && arabicMatches.length > latinMatches.length * 0.3) {
        logger.warn('AnswerComposer.finalizeResponse: Predominant Arabic script in Arabizi response, enforcing safe Arabizi fallback...');
        return this.composeFallback({
          turnDecision: turnDecision || { domain: 'FALLBACK', intent: 'FALLBACK', confidence: 1, responseLanguage: 'darija', responseScript: 'arabizi' },
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
