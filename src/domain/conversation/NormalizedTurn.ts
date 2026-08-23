/**
 * NormalizedTurn.ts
 *
 * Canonical Intermediate Representation for Conversational Turns.
 * Bridges raw multilingual user input to domain execution with structured
 * intents, entities, references, constraints, and language/script metadata.
 * 100% deterministic, 0 LLM, 0 embeddings.
 */

export type TurnIntent =
  | 'PRODUCT_SEARCH'
  | 'PRODUCT_DETAIL'
  | 'PRICE'
  | 'AVAILABILITY'
  | 'VARIANT_SELECTION'
  | 'COMPARE'
  | 'RECOMMENDATION'
  | 'RETURNS'
  | 'SHIPPING'
  | 'CARE'
  | 'TRACKING'
  | 'WARRANTY'
  | 'PAYMENT'
  | 'STORE_INFO'
  | 'GENERAL'
  | 'GREETING'
  | 'HANDOFF';

export type EntityType =
  | 'PRODUCT'
  | 'CATEGORY'
  | 'VARIANT'
  | 'POLICY'
  | 'LOCATION'
  | 'ORDER_REFERENCE'
  | 'COMPARISON_TARGET'
  | 'REFERENCE';

export interface StructuredEntity {
  type: EntityType;
  text: string;
  canonicalId?: string;
  canonicalName?: string;
  confidence: number;
  metadata?: Record<string, any>;
}

export type ReferenceKind = 'ORDINAL' | 'ANAPHORA' | 'DEICTIC';
export type ReferenceTarget = 'LAST_SEARCH_RESULTS' | 'CURRENT_CONTEXT' | 'COMPARISON_SET';

export interface SemanticReference {
  type: 'REFERENCE';
  kind: ReferenceKind;
  value?: number | string; // e.g. 0 for first, 'current' for anaphora
  target: ReferenceTarget;
  rawText: string;
}

export interface VariantConstraint {
  color?: string | null;
  size?: string | null;
  sku?: string | null;
}

export interface ComparisonTarget {
  kind: 'CURRENT_CONTEXT' | 'CATEGORY' | 'PRODUCT_NAME' | 'ORDINAL';
  value?: string | number;
  rawText?: string;
}

export interface RecommendationCriteria {
  useCase?: string; // e.g. 'daily_use', 'sports', 'casual'
  season?: string; // e.g. 'winter', 'summer'
  category?: string;
  budget?: number;
  color?: string;
  size?: string;
  attributes?: string[];
}

export interface TurnConstraint {
  kind: 'MAX_PRICE' | 'MIN_PRICE' | 'CURRENCY' | 'TIME_WINDOW' | 'LOCATION';
  value: string | number;
  rawText?: string;
}

export type PolicyScope = 'GLOBAL_POLICY' | 'PRODUCT_POLICY' | 'CONTEXTUAL_PRODUCT_REFERENCE';

export type ContextScope = 'GLOBAL' | 'PRODUCT' | 'VARIANT' | 'REFERENCE' | 'UNRESOLVED';

export interface NormalizedTurn {
  rawText: string;
  normalizedText: string;

  primaryIntent: TurnIntent;
  secondaryIntents: TurnIntent[];

  entities: StructuredEntity[];
  references: SemanticReference[];
  categories: string[];
  variants: VariantConstraint[];
  constraints: TurnConstraint[];

  comparisonTargets?: ComparisonTarget[];
  recommendationCriteria?: RecommendationCriteria;
  policyScope?: PolicyScope;
  contextScope?: ContextScope;

  responseLanguage: 'en' | 'fr' | 'ar' | 'darija';
  responseScript: 'latin' | 'arabic' | 'arabizi';

  confidence: number;

  // Semantic Flag Invariants
  hasExplicitEntity: boolean;
  hasContextualReference: boolean;
  hasExplicitCategory: boolean;
  hasVariantConstraint: boolean;
  hasExplicitVariantConstraint?: boolean;
  hasPolicyIntent: boolean;
  hasEcommerceIntent: boolean;
  isMultiIntent: boolean;
  isContextualVariantFollowUp: boolean;
  hasProductScopedPolicy: boolean;
  hasGlobalPolicyIntent: boolean;
  hasContextualProductReference: boolean;
}
