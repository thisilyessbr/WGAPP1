import { EcommerceService } from '../ecommerce/EcommerceService';
import { CatalogMatcher } from '../ecommerce/CatalogMatcher';
import { BusinessConfig } from '../tenant/BusinessConfig';
import { TurnDecision } from './TurnDecision';
import { AnswerComposer } from './AnswerComposer';
import { ConversationContext } from './ConversationContext';
import { SupportedLanguage } from '../faq/FaqMatcher';
import { telemetry } from '../../core/telemetry/TelemetryClient';

export interface EcommerceIntentHandlerParams {
  turnDecision: TurnDecision;
  tenantId: string;
  targetAccountId: string;
  effectiveLang: SupportedLanguage;
  content: string;
  conversation: { id: string; contextData: unknown };
  conversationContext: ConversationContext;
  correlationId: string;
  config: BusinessConfig;
  ecommerceService: EcommerceService;
}

export interface EcommerceIntentHandlerResult {
  handled: boolean;
  responseSource?: 'ECOMMERCE';
  answerText?: string;
  productContextUpdate?: any;
  contextDataUpdate?: Record<string, any>;
}

/**
 * Executes the conversational-commerce domain (product search, comparison,
 * recommendations, price/availability/detail lookups) for a turn already
 * classified as ECOMMERCE by TurnDecision. Returns handled:false when the
 * turn's specific intent isn't one this handler covers, so the caller can
 * fall through to the next stage (FAQ fast-path, RAG, etc.) unchanged.
 */
export class EcommerceIntentHandler {
  static async handle(params: EcommerceIntentHandlerParams): Promise<EcommerceIntentHandlerResult> {
    const { tenantId, targetAccountId, effectiveLang, content, conversation, conversationContext, correlationId, config, ecommerceService } = params;
    // Parser leftovers such as "send me a photo please" or "sift lia tswira"
    // contain no product words: treat them as a follow-up about the active product.
    const turnDecision = params.turnDecision.productName && !params.turnDecision.catalogProductId
      && CatalogMatcher.queryTokens(params.turnDecision.productName).length === 0
      ? { ...params.turnDecision, productName: null }
      : params.turnDecision;

    if (turnDecision.intent === 'PRODUCT_SEARCH') {
      const results = await ecommerceService.searchProducts(
        tenantId,
        targetAccountId,
        turnDecision.searchKeywords || undefined,
        effectiveLang,
        {
          maxPrice: turnDecision.maxPrice || undefined,
          color: turnDecision.color || undefined,
          size: turnDecision.size || undefined,
          category: turnDecision.category || undefined
        }
      );

      telemetry.emit({
        eventType: 'ecommerce_executed',
        tenantId,
        accountId: targetAccountId,
        conversationId: conversation.id,
        correlationId,
        stage: 'ecommerce',
        status: 'SUCCESS',
        metadata: { intent: 'PRODUCT_SEARCH', resultsCount: results.length }
      });

      const answerText = AnswerComposer.composeEcommerce({
        turnDecision,
        productFacts: results,
        userMessage: content,
        responseLanguage: effectiveLang,
        responseScript: turnDecision.responseScript,
        config
      });

      const currentContextData = (conversation.contextData as Record<string, any>) || {};
      if (results.length > 0) {
        const productIds = results.map(r => r.product.id);
        currentContextData.productContext = {
          ...(currentContextData.productContext || {}),
          lastViewedProductIds: productIds,
          selectedProductId: results.length === 1 ? results[0].product.id : null,
          selectedVariantId: null,
          selectedSku: results.length === 1 ? results[0].product.sku : null,
          selectedColor: null,
          selectedSize: null,
          unresolvedTarget: null
        };
      } else {
        // Invalidate stale product context and persist unresolvedTarget on explicit search with 0 results
        currentContextData.productContext = {
          ...(currentContextData.productContext || {}),
          lastViewedProductIds: [],
          selectedProductId: null,
          selectedVariantId: null,
          selectedSku: null,
          selectedColor: null,
          selectedSize: null,
          unresolvedTarget: {
            rawQuery: content,
            normalizedEntity: turnDecision.productName || turnDecision.searchKeywords || undefined,
            category: turnDecision.category || undefined,
            reason: 'NOT_FOUND',
            timestamp: Date.now()
          }
        };
      }

      return {
        handled: true,
        responseSource: 'ECOMMERCE',
        answerText,
        productContextUpdate: currentContextData.productContext,
        contextDataUpdate: currentContextData
      };
    }

    if (turnDecision.intent === 'COMPARE') {
      const targets: Array<{ id?: string; sku?: string; name?: string; category?: string; ordinalIndex?: number; color?: string; size?: string }> = [];

      if (turnDecision.compareProductNames && turnDecision.compareProductNames.length >= 2) {
        for (const name of turnDecision.compareProductNames) {
          targets.push({ name });
        }
      } else {
        // Target A: current active product or first ordinal
        if (conversationContext.productContext?.selectedProductId) {
          targets.push({
            id: conversationContext.productContext.selectedProductId,
            color: conversationContext.productContext.selectedColor || undefined,
            size: conversationContext.productContext.selectedSize || undefined
          });
        } else if (turnDecision.ordinalIndex !== undefined && turnDecision.ordinalIndex !== null && conversationContext.productContext?.lastViewedProductIds?.length) {
          targets.push({
            id: conversationContext.productContext.lastViewedProductIds[turnDecision.ordinalIndex]
          });
        } else if (turnDecision.productName) {
          targets.push({ name: turnDecision.productName });
        }

        // Target B: explicit category or secondary product mention
        if (turnDecision.category) {
          targets.push({ category: turnDecision.category });
        } else if (turnDecision.compareProductNames && turnDecision.compareProductNames.length === 1) {
          targets.push({ name: turnDecision.compareProductNames[0] });
        }

        // Candidate set fallback: if targets < 2 and lastViewedProductIds >= 2, populate targets from candidate set
        if (targets.length < 2 && conversationContext.productContext?.lastViewedProductIds && conversationContext.productContext.lastViewedProductIds.length >= 2) {
          targets.length = 0;
          for (const pid of conversationContext.productContext.lastViewedProductIds.slice(0, 4)) {
            targets.push({ id: pid });
          }
        }
      }

      const compResult = await ecommerceService.compareProducts(
        tenantId,
        targetAccountId,
        targets,
        effectiveLang,
        conversationContext.productContext?.lastViewedProductIds
      );

      let productContextUpdate: any;
      let contextDataUpdate: Record<string, any> | undefined;
      if (compResult.targets.length >= 2) {
        const currentContextData = (conversation.contextData as Record<string, any>) || {};
        currentContextData.productContext = {
          ...(currentContextData.productContext || {}),
          comparisonTargets: compResult.targets.map(t => ({
            id: t.product.id,
            name: t.displayName,
            sku: t.product.sku,
            price: t.effectivePrice
          }))
        };
        productContextUpdate = currentContextData.productContext;
        contextDataUpdate = currentContextData;
      }

      const answerText = AnswerComposer.composeEcommerce({
        turnDecision,
        productFacts: compResult.targets,
        userMessage: content,
        responseLanguage: effectiveLang,
        responseScript: turnDecision.responseScript,
        config
      });

      return { handled: true, responseSource: 'ECOMMERCE', answerText, productContextUpdate, contextDataUpdate };
    }

    if (turnDecision.intent === 'RECOMMENDATION') {
      const criteria = {
        category: turnDecision.category || undefined,
        budget: turnDecision.maxPrice || undefined,
        color: turnDecision.color || undefined,
        size: turnDecision.size || undefined,
        searchKeywords: turnDecision.searchKeywords || undefined,
        attributeKeywords: turnDecision.attributeKeywords || undefined,
        attributeName: (turnDecision as any).attributeName || undefined
      };

      const recResult = await ecommerceService.getRecommendations(
        tenantId,
        targetAccountId,
        criteria,
        effectiveLang
      );

      if (recResult.hasGroundedRecommendation && recResult.topFact) {
        const currentContextData = (conversation.contextData as Record<string, any>) || {};
        const prevViewed = currentContextData.productContext?.lastViewedProductIds || [];
        const updatedViewed = Array.from(new Set([...prevViewed, recResult.topFact.product.id]));
        currentContextData.productContext = {
          ...(currentContextData.productContext || {}),
          lastViewedProductIds: updatedViewed,
          selectedProductId: recResult.topFact.product.id,
          selectedVariantId: recResult.topFact.selectedVariant ? recResult.topFact.selectedVariant.id : null,
          selectedSku: recResult.topFact.selectedVariant ? recResult.topFact.selectedVariant.sku : recResult.topFact.product.sku,
          selectedColor: recResult.topFact.selectedVariant ? (recResult.topFact.selectedVariant.color || null) : null,
          selectedSize: recResult.topFact.selectedVariant ? (recResult.topFact.selectedVariant.size || null) : null
        };

        const answerText = AnswerComposer.composeEcommerce({
          turnDecision,
          productFacts: [recResult.topFact],
          userMessage: content,
          responseLanguage: effectiveLang,
          responseScript: turnDecision.responseScript,
          config
        });

        return {
          handled: true,
          responseSource: 'ECOMMERCE',
          answerText,
          productContextUpdate: currentContextData.productContext,
          contextDataUpdate: currentContextData
        };
      }

      const answerText = AnswerComposer.composeEcommerce({
        turnDecision,
        productFacts: [],
        userMessage: content,
        responseLanguage: effectiveLang,
        responseScript: turnDecision.responseScript,
        config
      });
      return { handled: true, responseSource: 'ECOMMERCE', answerText };
    }

    if (['BUY_INTENT', 'PRICE', 'AVAILABILITY', 'PRODUCT_DETAIL', 'VARIANT_SELECTION', 'ATTRIBUTE_QUERY'].includes(turnDecision.intent)) {
      let targetId: string | undefined;
      const hasActiveProduct = Boolean(conversationContext.productContext?.selectedProductId);
      const isMediaRequest = Boolean(turnDecision.requestedMediaType === 'image' || turnDecision.requestedMediaType === 'video');

      const isExplicitProduct = Boolean(
        turnDecision.sku ||
        turnDecision.productName ||
        turnDecision.category ||
        (turnDecision.ordinalIndex !== undefined && turnDecision.ordinalIndex !== null && !hasActiveProduct)
      );

      // Check comparisonTargets follow-up (e.g. "شكون أرخص؟" after comparison)
      if (
        !turnDecision.sku && !turnDecision.productName && !turnDecision.category &&
        turnDecision.intent === 'PRICE' &&
        conversationContext.productContext?.comparisonTargets &&
        conversationContext.productContext.comparisonTargets.length >= 2 &&
        /(?:which\s+is\s+cheaper|cheaper|lequel\s+est\s+le\s+moins\s+cher|moins\s+cher|شكون\s+أرخص|شكون\s+ارخص|شكون\s+لي\s+رخيص|ارخص|أرخص|rkhis|arkhas)/iu.test(content)
      ) {
        const sortedComp = [...conversationContext.productContext.comparisonTargets].sort((a, b) => a.price - b.price);
        targetId = sortedComp[0].id;
      } else if (turnDecision.catalogProductId) {
        // The customer named this catalog product explicitly (any script).
        targetId = turnDecision.catalogProductId;
      } else if (turnDecision.ordinalIndex !== undefined && turnDecision.ordinalIndex !== null && conversationContext.productContext?.lastViewedProductIds?.length) {
        targetId = conversationContext.productContext.lastViewedProductIds[turnDecision.ordinalIndex];
      } else if (isMediaRequest && hasActiveProduct && (!turnDecision.sku && (!turnDecision.productName || turnDecision.productName.toLowerCase() === 'it' || turnDecision.productName.toLowerCase() === 'this' || turnDecision.productName.toLowerCase() === 'that'))) {
        targetId = conversationContext.productContext!.selectedProductId || undefined;
      } else if (!turnDecision.sku && !turnDecision.productName && !turnDecision.category && hasActiveProduct) {
        targetId = conversationContext.productContext!.selectedProductId || undefined;
      }

      let lookupColor: string | undefined;
      let lookupSize: string | undefined;

      if ((isExplicitProduct && !targetId) || (turnDecision.catalogProductId && targetId === turnDecision.catalogProductId)) {
        lookupColor = (turnDecision.color && turnDecision.color !== 'ALL') ? turnDecision.color : undefined;
        lookupSize = turnDecision.size || undefined;
      } else {
        lookupColor = (turnDecision.color && turnDecision.color !== 'ALL')
          ? turnDecision.color
          : (turnDecision.color === 'ALL' ? undefined : conversationContext.productContext?.selectedColor || undefined);
        lookupSize = turnDecision.size || conversationContext.productContext?.selectedSize || undefined;
      }

      let fact = await ecommerceService.getProductFact(
        tenantId,
        targetAccountId,
        {
          id: targetId,
          sku: turnDecision.sku || undefined,
          name: targetId ? undefined : (turnDecision.productName || undefined),
          color: lookupColor,
          size: lookupSize
        },
        effectiveLang
      );

      // Category-only enquiries (e.g. "jeans size 34") are answerable only
      // when the live catalog identifies one unambiguous product. Re-resolve
      // the variant through getProductFact so stock is never the parent total.
      if (!fact && turnDecision.category && !turnDecision.productName
        && ['PRICE', 'AVAILABILITY', 'BUY_INTENT', 'VARIANT_SELECTION'].includes(turnDecision.intent)) {
        const candidates = await ecommerceService.searchProducts(
          tenantId, targetAccountId, undefined, effectiveLang,
          { category: turnDecision.category, limit: 3 }
        );
        if (candidates.length === 1) {
          fact = await ecommerceService.getProductFact(tenantId, targetAccountId, {
            id: candidates[0].product.id, color: lookupColor, size: lookupSize
          }, effectiveLang);
        } else if (candidates.length > 1) {
          const currentContextData = (conversation.contextData as Record<string, any>) || {};
          currentContextData.productContext = {
            ...(currentContextData.productContext || {}),
            lastViewedProductIds: candidates.map(candidate => candidate.product.id),
            selectedProductId: null,
            selectedVariantId: null,
            selectedSku: null,
            selectedColor: null,
            selectedSize: null,
            unresolvedTarget: null
          };
          // Do not show parent stock or price before the customer picks a product.
          const choiceText = candidates.map((candidate, index) =>
            `${index + 1}. ${candidate.displayName}`
          ).join('\n');
          const clarification = effectiveLang === 'fr' ? 'Lequel vous intéresse ?'
            : effectiveLang === 'en' ? 'Which one interests you?'
            : effectiveLang === 'ar' ? 'أي منتج تقصد؟'
            : turnDecision.responseScript === 'arabizi' ? 'Chmen wa7ed bghiti?'
            : 'شنو هو المنتوج اللي بغيتي؟';
          return {
            handled: true, responseSource: 'ECOMMERCE',
            answerText: `${choiceText}\n${clarification}`,
            productContextUpdate: currentContextData.productContext,
            contextDataUpdate: currentContextData
          };
        }
      }

      let categoryFacts: any[] = [];
      if (!fact && (turnDecision.category || turnDecision.productName) && (turnDecision.intent === 'ATTRIBUTE_QUERY' || turnDecision.intent === 'PRODUCT_DETAIL')) {
        categoryFacts = await ecommerceService.searchProducts(
          tenantId,
          targetAccountId,
          turnDecision.productName || undefined,
          effectiveLang,
          {
            category: turnDecision.category || undefined,
            limit: 3
          }
        );
        if (categoryFacts.length === 1) {
          fact = categoryFacts[0];
        }
      }

      let productContextUpdate: any;
      let contextDataUpdate: Record<string, any> | undefined;
      if (fact) {
        telemetry.emit({
          eventType: 'ecommerce_executed',
          tenantId,
          accountId: targetAccountId,
          conversationId: conversation.id,
          correlationId,
          stage: 'ecommerce',
          status: 'SUCCESS',
          metadata: { intent: turnDecision.intent, productId: fact.product.id, inStock: fact.inStock }
        });

        const currentContextData = (conversation.contextData as Record<string, any>) || {};
        currentContextData.productContext = {
          ...(currentContextData.productContext || {}),
          selectedProductId: fact.product.id,
          selectedVariantId: fact.selectedVariant ? fact.selectedVariant.id : null,
          selectedSku: fact.selectedVariant ? fact.selectedVariant.sku : fact.product.sku,
          selectedColor: fact.selectedVariant ? (fact.selectedVariant.color || null) : (lookupColor || null),
          selectedSize: fact.selectedVariant ? (fact.selectedVariant.size || null) : (lookupSize || null)
        };

        productContextUpdate = currentContextData.productContext;
        contextDataUpdate = currentContextData;
      }

      const answerText = AnswerComposer.composeEcommerce({
        turnDecision,
        productFacts: categoryFacts.length > 1 ? categoryFacts : fact,
        userMessage: content,
        responseLanguage: effectiveLang,
        responseScript: turnDecision.responseScript,
        config
      });

      return { handled: true, responseSource: 'ECOMMERCE', answerText, productContextUpdate, contextDataUpdate };
    }

    return { handled: false };
  }
}
