/**
 * ExecutionPlanner.ts
 *
 * Deterministically constructs an ExecutionPlan from a canonical NormalizedTurn
 * and conversational product context.
 * Enforces entity sharing, dependency ordering, and zero LLM calls.
 * 100% deterministic, 0 LLM, 0 embeddings.
 */

import { NormalizedTurn, TurnIntent } from './NormalizedTurn';
import { ProductContext } from './ConversationContext';
import { ExecutionPlan, ExecutionTask, ExecutionTaskType, TaskEntity } from './ExecutionPlan';
import { EcommerceIntentParser } from '../ecommerce/EcommerceIntent';

export class ExecutionPlanner {
  /**
   * Builds an ExecutionPlan from a NormalizedTurn and conversation product context.
   */
  public static plan(
    turn: NormalizedTurn,
    productContext?: ProductContext | null
  ): ExecutionPlan {
    const tasks: ExecutionTask[] = [];
    const allIntents: TurnIntent[] = [turn.primaryIntent, ...(turn.secondaryIntents || [])];
    const uniqueIntents: TurnIntent[] = Array.from(new Set(allIntents));

    // 1. Resolve Target Product / Entity Reference
    const explicitProductEntity = turn.entities.find(e => e.type === 'PRODUCT');
    const explicitCategoryEntity = turn.entities.find(e => e.type === 'CATEGORY');
    const ordinalRef = turn.references.find(r => r.kind === 'ORDINAL');

    let targetProductId: string | undefined;
    let targetProductName: string | undefined;
    let targetSku: string | undefined;

    // Check if explicit product was extracted
    if (explicitProductEntity) {
      if (explicitProductEntity.metadata?.sku) {
        targetSku = explicitProductEntity.metadata.sku;
      }
      if (explicitProductEntity.metadata?.name || explicitProductEntity.canonicalName) {
        targetProductName = explicitProductEntity.metadata?.name || explicitProductEntity.canonicalName;
      }
      if (explicitProductEntity.canonicalId) {
        targetProductId = explicitProductEntity.canonicalId;
      }
    }

    // If no explicit product entity in turn.entities, check EcommerceIntentParser for explicit product extraction
    if (!targetProductId && !targetProductName && !targetSku) {
      const parsedCommerce = EcommerceIntentParser.parse(turn.rawText, productContext, turn.responseLanguage);
      if (parsedCommerce.sku) {
        targetSku = parsedCommerce.sku;
      }
      if (parsedCommerce.productName) {
        targetProductName = parsedCommerce.productName;
      }
    }

    // Contextual product fallback ONLY if turn semantically requires product context
    const isExplicitGiven = Boolean(targetProductId || targetProductName || targetSku || explicitCategoryEntity);
    const requiresProductContext = turn.hasEcommerceIntent ||
      turn.hasVariantConstraint ||
      turn.isContextualVariantFollowUp ||
      turn.policyScope === 'PRODUCT_POLICY' ||
      turn.policyScope === 'CONTEXTUAL_PRODUCT_REFERENCE' ||
      turn.hasContextualProductReference;

    if (!isExplicitGiven && requiresProductContext) {
      if (ordinalRef && typeof ordinalRef.value === 'number' && productContext?.lastViewedProductIds?.[ordinalRef.value]) {
        targetProductId = productContext.lastViewedProductIds[ordinalRef.value];
      } else if (productContext?.selectedProductId) {
        targetProductId = productContext.selectedProductId;
        targetSku = productContext.selectedSku || undefined;
      }
    }

    // Target variant constraint
    const primaryVariant = turn.variants && turn.variants.length > 0 ? turn.variants[0] : null;
    const targetVariant = primaryVariant ? {
      color: primaryVariant.color || productContext?.selectedColor || null,
      size: primaryVariant.size || productContext?.selectedSize || null
    } : {
      color: productContext?.selectedColor || null,
      size: productContext?.selectedSize || null
    };

    // Shared Entity definition across all tasks
    const sharedEntities: TaskEntity[] = [];
    if (targetProductId) {
      sharedEntities.push({ type: 'PRODUCT', value: targetProductId, canonicalId: targetProductId });
    }
    if (targetProductName) {
      sharedEntities.push({ type: 'PRODUCT', value: targetProductName, canonicalName: targetProductName });
    }
    if (targetSku) {
      sharedEntities.push({ type: 'PRODUCT', value: targetSku, canonicalId: targetSku });
    }
    if (explicitCategoryEntity) {
      sharedEntities.push({ type: 'CATEGORY', value: explicitCategoryEntity.text, canonicalName: explicitCategoryEntity.canonicalName });
    }

    let taskIndex = 1;

    // 2. Generate Tasks for each detected semantic intent
    for (const intent of uniqueIntents) {
      const taskId = `task-${taskIndex++}-${intent.toLowerCase()}`;

      if (intent === 'GREETING') {
        tasks.push({
          id: taskId,
          type: 'GREETING',
          intent: 'GREETING'
        });
      } else if (intent === 'HANDOFF') {
        tasks.push({
          id: taskId,
          type: 'HANDOFF',
          intent: 'HANDOFF'
        });
      } else if (intent === 'COMPARE') {
        tasks.push({
          id: taskId,
          type: 'COMPARE',
          intent: 'COMPARE',
          entities: sharedEntities,
          dependencies: targetProductId ? [`task-dep-product`] : undefined,
          metadata: { comparisonTargets: turn.comparisonTargets }
        });
      } else if (intent === 'RECOMMENDATION') {
        tasks.push({
          id: taskId,
          type: 'RECOMMENDATION',
          intent: 'RECOMMENDATION',
          entities: sharedEntities,
          metadata: { criteria: turn.recommendationCriteria }
        });
      } else if (intent === 'PRODUCT_SEARCH') {
        tasks.push({
          id: taskId,
          type: 'ECOMMERCE_FACT',
          intent: 'PRODUCT_SEARCH',
          entities: sharedEntities,
          constraints: {
            category: explicitCategoryEntity?.canonicalName || turn.categories?.[0] || undefined,
            color: targetVariant?.color || undefined,
            size: targetVariant?.size || undefined,
            maxPrice: turn.constraints.find(c => c.kind === 'MAX_PRICE')?.value
          }
        });
      } else if (['PRICE', 'AVAILABILITY', 'PRODUCT_DETAIL', 'VARIANT_SELECTION'].includes(intent)) {
        tasks.push({
          id: taskId,
          type: 'ECOMMERCE_FACT',
          intent: intent,
          entities: sharedEntities,
          targetProductId,
          targetProductName,
          targetSku,
          targetVariant,
          dependencies: (targetProductId || targetProductName || targetSku) ? [`task-dep-product`] : undefined
        });
      } else if (['RETURNS', 'SHIPPING', 'CARE', 'TRACKING', 'WARRANTY', 'PAYMENT', 'STORE_INFO'].includes(intent)) {
        const isProductScoped = turn.policyScope === 'PRODUCT_POLICY' ||
          turn.policyScope === 'CONTEXTUAL_PRODUCT_REFERENCE' ||
          turn.hasProductScopedPolicy ||
          turn.hasContextualProductReference;

        tasks.push({
          id: taskId,
          type: 'KNOWLEDGE_RETRIEVAL',
          intent: intent,
          policyCategory: intent,
          entities: isProductScoped ? sharedEntities : [],
          targetProductId: isProductScoped ? targetProductId : undefined,
          targetProductName: isProductScoped ? targetProductName : undefined,
          targetSku: isProductScoped ? targetSku : undefined,
          dependencies: (isProductScoped && (targetProductId || targetProductName || targetSku)) ? [`task-dep-product`] : undefined
        });
      } else if (intent === 'GENERAL') {
        tasks.push({
          id: taskId,
          type: 'KNOWLEDGE_RETRIEVAL',
          intent: 'GENERAL',
          entities: sharedEntities
        });
      }
    }

    // Fallback if no tasks generated
    if (tasks.length === 0) {
      tasks.push({
        id: `task-1-general`,
        type: 'KNOWLEDGE_RETRIEVAL',
        intent: 'GENERAL'
      });
    }

    // 3. Ordering: Deterministic facts first, Knowledge second, Compare/Recommendation third
    const typeOrder: Record<ExecutionTaskType, number> = {
      GREETING: 0,
      ECOMMERCE_FACT: 1,
      KNOWLEDGE_RETRIEVAL: 2,
      COMPARE: 3,
      RECOMMENDATION: 4,
      FAQ: 5,
      HANDOFF: 6
    };

    tasks.sort((a, b) => (typeOrder[a.type] ?? 99) - (typeOrder[b.type] ?? 99));

    const hasKnowledgeTasks = tasks.some(t => t.type === 'KNOWLEDGE_RETRIEVAL');
    const hasEcommerceTasks = tasks.some(t => t.type === 'ECOMMERCE_FACT');
    const requiresLlmSynthesis = hasKnowledgeTasks && (hasEcommerceTasks || tasks.filter(t => t.type === 'KNOWLEDGE_RETRIEVAL').length > 1);

    return {
      primaryTask: tasks[0],
      tasks,
      responseLanguage: turn.responseLanguage,
      responseScript: turn.responseScript,
      requiresLlmSynthesis
    };
  }
}
