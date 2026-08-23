/**
 * ExecutionPlan.ts
 *
 * Represents an ordered, dependency-aware plan of semantic execution tasks
 * derived from a NormalizedTurn and conversation context.
 * 100% deterministic, language-neutral, 0 LLM, 0 embeddings.
 */

import { TurnIntent } from './NormalizedTurn';

export type ExecutionTaskType =
  | 'ECOMMERCE_FACT'
  | 'KNOWLEDGE_RETRIEVAL'
  | 'COMPARE'
  | 'RECOMMENDATION'
  | 'FAQ'
  | 'GREETING'
  | 'HANDOFF';

export interface TaskEntity {
  type: string;
  value: string;
  rawText?: string;
  canonicalId?: string;
  canonicalName?: string;
}

export interface ExecutionTask {
  id: string;
  type: ExecutionTaskType;
  intent: TurnIntent | string;
  entities?: TaskEntity[];
  references?: string[];
  constraints?: Record<string, any>;
  dependencies?: string[]; // IDs of prerequisite tasks that must resolve first
  targetProductId?: string;
  targetProductName?: string;
  targetSku?: string;
  targetVariant?: { color?: string | null; size?: string | null };
  policyCategory?: string;
  metadata?: Record<string, any>;
}

export interface ExecutionPlan {
  primaryTask: ExecutionTask;
  tasks: ExecutionTask[];
  responseLanguage: 'en' | 'fr' | 'ar' | 'darija';
  responseScript: 'latin' | 'arabic' | 'arabizi';
  requiresLlmSynthesis?: boolean;
}
