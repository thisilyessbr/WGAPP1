/**
 * EvidenceBundle.ts
 *
 * Strongly-typed container aggregating all domain facts, policy evidence,
 * comparison sets, and task completion accounting from an ExecutionPlan run.
 * 100% deterministic, 0 LLM, 0 embeddings.
 */

import { ProductLookupResult } from '../ecommerce/EcommerceService';
import { RetrievedChunk } from '../rag/RAGService';
import { ExecutionTaskType } from './ExecutionPlan';

export interface VariantEvidence {
  id: string;
  sku: string;
  color?: string | null;
  size?: string | null;
  stock: number;
  inStock: boolean;
  priceOverride?: number | null;
  effectivePrice: number;
}

export interface ProductEvidence {
  id: string;
  sku: string;
  name: string;
  displayName: string;
  category: string;
  price: number;
  currency: string;
  stock: number;
  inStock: boolean;
  displayDescription?: string;
  attributes?: Record<string, string | number | boolean>;
  variants: VariantEvidence[];
}

export interface PolicyEvidence {
  intent: string;
  topic: string;
  found: boolean;
  summary: string;
  sanitizedContent: string;
  sourceDocTitle?: string;
  confidence: number;
}

export interface ComparisonEvidence {
  targets: ProductLookupResult[];
  attributeDifferences: Record<string, any>;
  cheapestId?: string;
}

export interface PolicyTopicEvidence {
  chunks: RetrievedChunk[];
  found: boolean;
  policyTopic: string;
}

export interface TaskExecutionResult {
  taskId: string;
  type: ExecutionTaskType;
  intent: string;
  status: 'COMPLETED' | 'FAILED' | 'UNAVAILABLE';
  data?: any;
  error?: string;
}

export interface TaskAccounting {
  requestedTasks: string[];
  completedTasks: string[];
  failedTasks: string[];
  unavailableTasks: string[];
  isComplete: boolean;
}

export interface RecommendationEvidence {
  topFact: ProductLookupResult | null;
  candidates: ProductLookupResult[];
  rationale: string;
  hasGroundedRecommendation: boolean;
}

export interface FaqEvidence {
  question: string;
  answer: string;
  confidence: number;
}

export interface EvidenceBundle {
  productFacts: ProductLookupResult[];
  policyEvidenceByIntent: Record<string, PolicyTopicEvidence>;
  comparisonFacts: ProductLookupResult[];
  recommendationResults: RecommendationEvidence | null;
  comparisonEvidence?: ComparisonEvidence | null;
  faqEvidence: FaqEvidence[];
  taskResults: TaskExecutionResult[];
  taskAccounting: TaskAccounting;
  primaryProductFact?: ProductLookupResult | null;
  policyChunks?: any[];
}

export class EvidenceBundleBuilder {
  private productFacts: ProductLookupResult[] = [];
  private policyEvidenceByIntent: Record<string, PolicyTopicEvidence> = {};
  private comparisonFacts: ProductLookupResult[] = [];
  private recommendationResults: RecommendationEvidence | null = null;
  private faqEvidence: FaqEvidence[] = [];
  private taskResults: TaskExecutionResult[] = [];
  private requestedTasks: string[] = [];
  private policyChunks: any[] = [];

  constructor(requestedTasks: string[] = []) {
    this.requestedTasks = [...requestedTasks];
  }

  public setRequestedTasks(taskIds: string[]): this {
    this.requestedTasks = [...taskIds];
    return this;
  }

  public addProductFact(fact: ProductLookupResult): this {
    if (!this.productFacts.some(f => f.product.id === fact.product.id)) {
      this.productFacts.push(fact);
    }
    return this;
  }

  public addPolicyEvidence(intent: string, evidence: PolicyTopicEvidence): this {
    this.policyEvidenceByIntent[intent] = evidence;
    return this;
  }

  public setPolicyChunks(chunks: any[]): this {
    this.policyChunks = [...chunks];
    return this;
  }

  public setComparisonFacts(facts: ProductLookupResult[]): this {
    this.comparisonFacts = [...facts];
    return this;
  }

  public setRecommendationResults(results: RecommendationEvidence): this {
    this.recommendationResults = results;
    return this;
  }

  public addFaqEvidence(faq: FaqEvidence): this {
    this.faqEvidence.push(faq);
    return this;
  }

  public recordTaskResult(result: TaskExecutionResult): this {
    const existingIdx = this.taskResults.findIndex(r => r.taskId === result.taskId);
    if (existingIdx >= 0) {
      this.taskResults[existingIdx] = result;
    } else {
      this.taskResults.push(result);
    }
    return this;
  }

  public build(): EvidenceBundle {
    const completedTasks = this.taskResults.filter(r => r.status === 'COMPLETED').map(r => r.taskId);
    const failedTasks = this.taskResults.filter(r => r.status === 'FAILED').map(r => r.taskId);
    const unavailableTasks = this.taskResults.filter(r => r.status === 'UNAVAILABLE').map(r => r.taskId);

    const isComplete = (completedTasks.length + failedTasks.length + unavailableTasks.length === this.requestedTasks.length);

    return {
      productFacts: [...this.productFacts],
      policyEvidenceByIntent: { ...this.policyEvidenceByIntent },
      comparisonFacts: [...this.comparisonFacts],
      recommendationResults: this.recommendationResults,
      faqEvidence: [...this.faqEvidence],
      taskResults: [...this.taskResults],
      taskAccounting: {
        requestedTasks: [...this.requestedTasks],
        completedTasks,
        failedTasks,
        unavailableTasks,
        isComplete
      },
      primaryProductFact: this.productFacts[0] || null,
      policyChunks: [...this.policyChunks]
    };
  }
}
