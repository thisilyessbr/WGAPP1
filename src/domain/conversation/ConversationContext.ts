import { ConversationMemory, ConversationMemoryManager } from './ConversationMemory';
import { PolicyEvidence } from '../rag/PolicyEvidence';

export type ConversationCapability =
  | 'GREETING'
  | 'FAQ'
  | 'WORKFLOW'
  | 'RAG'
  | 'LLM'
  | 'ECOMMERCE'
  | 'FALLBACK'
  | 'HUMAN_HANDOFF'
  | 'IMAGE'
  | 'CAP';

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

import { SupportedLanguage, LanguageDetector } from '../faq/FaqMatcher';

export interface ProductContext {
  selectedProductId?: string | null;
  selectedVariantId?: string | null;
  selectedSku?: string | null;
  selectedColor?: string | null;
  selectedSize?: string | null;
  lastViewedProductIds?: string[];
  comparisonTargets?: Array<{ id: string; name: string; sku?: string; price: number }>;
}

export interface ConversationContext {
  tenantId: string;
  accountId?: string | null;
  customerId: string;
  conversationId: string;

  language?: string;
  /** Resolved, stable conversation language policy (Phase 10) */
  effectiveLanguage: SupportedLanguage;
  currentIntent?: string | null;
  currentTopic?: string | null;
  activeCapability?: ConversationCapability | null;

  workflowState?: {
    workflowId?: string | null;
    stateId?: string | null;
    collectedData?: Record<string, unknown>;
  } | null;

  /** Transient product references (Phase 13B) - NEVER caches stale price/stock */
  productContext?: ProductContext | null;

  /** Session-scoped active PolicyEvidence cache (Phase 37E) */
  activePolicyEvidence?: Record<string, PolicyEvidence[]> | null;

  recentTurns: ConversationTurn[];

  structuredFacts: Record<string, unknown>;

  /** Controlled 3-layer memory foundation (Phase 5) */
  memory: ConversationMemory;

  safetyState?: {
    status: 'NORMAL' | 'RESTRICTED' | 'HANDOFF';
    reason?: string | null;
  };
}

export interface BuildConversationContextParams {
  tenantId: string;
  accountId?: string | null;
  customerId: string;
  conversationId: string;
  language?: string;
  accountLanguage?: string;
  currentMessageText?: string;
  currentIntent?: string | null;
  currentTopic?: string | null;
  activeCapability?: ConversationCapability | null;
  productContext?: ProductContext | null;
  activePolicyEvidence?: Record<string, PolicyEvidence[]> | null;
  activeSession?: {
    workflowId: string;
    stateId: string;
    collectedData?: Record<string, any> | null;
  } | null;
  recentMessages?: Array<{
    role: string;
    content: string;
    createdAt: Date;
  }>;
  totalMessageCount?: number;
  contextData?: Record<string, any> | null;
  existingSummary?: string | null;
  isCompletedOrClosed?: boolean;
  safetyState?: {
    status: 'NORMAL' | 'RESTRICTED' | 'HANDOFF';
    reason?: string | null;
  };
}

/**
 * Constructs the canonical, strongly-typed ConversationContext for the current turn.
 * Enforces a bounded window of max 4 recent turns, maps workflow state safely,
 * initializes structured facts, attaches the 3-layer memory model, and resolves effective language.
 */
export function buildConversationContext(params: BuildConversationContextParams): ConversationContext {
  // Build canonical 3-layer memory
  const memory = ConversationMemoryManager.buildMemory({
    tenantId: params.tenantId,
    accountId: params.accountId,
    customerId: params.customerId,
    conversationId: params.conversationId,
    recentMessages: params.recentMessages,
    totalMessageCount: params.totalMessageCount,
    contextData: params.contextData,
    activeSessionCollectedData: params.activeSession?.collectedData,
    existingSummary: params.existingSummary || (params.contextData as any)?.summary,
    isCompletedOrClosed: params.isCompletedOrClosed
  });

  // Workflow state from authoritative WorkflowSession
  const workflowState = params.activeSession
    ? {
        workflowId: params.activeSession.workflowId,
        stateId: params.activeSession.stateId,
        collectedData: (params.activeSession.collectedData as Record<string, unknown>) || {}
      }
    : null;

  // Resolve stable effective language policy:
  // 1. Check previous turn's language from memory or contextData
  const storedLang = (params.contextData as any)?._lang as SupportedLanguage | undefined;
  const rawRecent = params.recentMessages || [];
  let previousLang = storedLang;
  if (!previousLang && rawRecent.length > 0) {
    const lastUserTurn = rawRecent.find(m => m.role.toLowerCase() === 'user');
    if (lastUserTurn) {
      previousLang = LanguageDetector.detect(lastUserTurn.content);
    }
  }

  const detectedLang: SupportedLanguage = (params.language as SupportedLanguage) || 'en';
  const accountLang: SupportedLanguage = (params.accountLanguage as SupportedLanguage) || 'en';
  const isAmbiguous = params.currentMessageText !== undefined
    ? LanguageDetector.isAmbiguous(params.currentMessageText)
    : (detectedLang === 'en');

  let effectiveLanguage: SupportedLanguage;
  // If previous turn exists and current is ambiguous (e.g. "ok", "yes", punctuation), preserve previous
  if (previousLang && isAmbiguous) {
    effectiveLanguage = previousLang;
  } else {
    effectiveLanguage = detectedLang || previousLang || accountLang || 'en';
  }

  return {
    tenantId: params.tenantId,
    accountId: params.accountId ?? null,
    customerId: params.customerId,
    conversationId: params.conversationId,
    language: params.language,
    effectiveLanguage,
    currentIntent: params.currentIntent ?? null,
    currentTopic: params.currentTopic ?? null,
    activeCapability: params.activeCapability ?? null,
    workflowState,
    productContext: params.productContext || (params.contextData as any)?.productContext || null,
    activePolicyEvidence: params.activePolicyEvidence || (params.contextData as any)?.activePolicyEvidence || null,
    recentTurns: memory.recentTurns,
    structuredFacts: memory.structuredFacts,
    memory,
    safetyState: params.safetyState || { status: 'NORMAL', reason: null }
  };
}
