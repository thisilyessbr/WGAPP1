/**
 * ClaimGrounding.ts
 *
 * Generic Factual Claim Model for Post-Generation Grounding Verification.
 * Strictly decoupled from tenant/product specific rules.
 * 100% deterministic, 0 LLM calls, 0 embeddings.
 */

export type ClaimType =
  | 'PRICE'
  | 'STOCK'
  | 'SKU'
  | 'VARIANT'
  | 'MATERIAL'
  | 'SIZE'
  | 'FIT'
  | 'FEATURE'
  | 'PERFORMANCE'
  | 'CARE'
  | 'RETURNS'
  | 'SHIPPING'
  | 'TRACKING'
  | 'PAYMENT'
  | 'PRODUCT_BENEFIT'
  | 'RECOMMENDATION'
  | 'OTHER_FACT';

export type ClaimSourceType =
  | 'PRODUCT'
  | 'VARIANT'
  | 'KNOWLEDGE'
  | 'RECOMMENDATION'
  | 'COMPARISON'
  | 'UNGROUNDED';

export interface FactualClaim {
  text: string;
  type: ClaimType;
  subject?: string;
  predicate?: string;
  value?: string | number | boolean;
  sourceType: ClaimSourceType;
  sourceId?: string;
  grounded: boolean;
  confidence?: number;
  unsupportedReason?: string;
}

export interface ClaimValidationResult {
  isValid: boolean;
  claims: FactualClaim[];
  groundedClaims: FactualClaim[];
  unsupportedClaims: FactualClaim[];
  sanitizedText: string;
  claimCount: number;
  groundedClaimCount: number;
  unsupportedClaimCount: number;
  removedClaimCount: number;
  groundingFallbackUsed: boolean;
  groundingSourceTypes: string[];
}
