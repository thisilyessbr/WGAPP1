import { OutcomeEvent, Prisma } from '@prisma/client';

export const OUTCOME_EVENT_TYPES = [
  'LEAD_CREATED',
  'LEAD_QUALIFIED',
  'BOOKING_CONFIRMED',
  'ORDER_CONFIRMED',
  'QUESTION_MISSED',
  'QUESTION_RESOLVED',
  'HANDOFF_REQUESTED',
  'HANDOFF_CLAIMED',
  'HANDOFF_RESOLVED'
] as const;

export type OutcomeEventType = typeof OUTCOME_EVENT_TYPES[number];

export const OUTCOME_SOURCES = [
  'CHATBOT_SIGNAL',
  'WORKFLOW',
  'MERCHANT',
  'CRM_STATUS',
  'HANDOFF',
  'SYSTEM'
] as const;

export type OutcomeSource = typeof OUTCOME_SOURCES[number];

export interface RecordOutcomeParams {
  tenantId: string;
  accountId: string;
  type: OutcomeEventType;
  source: OutcomeSource;
  conversationId?: string | null;
  customerId?: string | null;
  value?: number | Prisma.Decimal | null;
  currency?: string | null;
  relatedOutcomeId?: string | null;
  idempotencyKey: string;
  metadata?: Record<string, any>;
  occurredAt?: Date;
}

export interface ListOutcomeParams {
  tenantId: string;
  accountId: string;
  type?: OutcomeEventType;
  days?: number;
  limit?: number;
  offset?: number;
}

export interface AccountOutcomeSummary {
  periodDays: number;
  leadsCreated: number;
  leadsQualified: number;
  qualificationRate: number;
  handoffsRequested: number;
  handoffsClaimed: number;
  handoffsResolved: number;
  handoffResolutionRate: number;
  medianTimeToClaimSeconds: number | null;
  medianTimeToResolveSeconds: number | null;
  missedQuestions: number;
  resolvedMissedQuestions: number;
  missedQuestionResolutionRate: number;
  confirmedBookings: number;
  confirmedOrders: number;
  confirmedOrderValueByCurrency: Record<string, number>;
}

export interface AdminAccountOutcomeSummary extends AccountOutcomeSummary {
  accountId: string;
  accountName?: string;
  tenantId: string;
}

export interface AdminOutcomeSummary {
  periodDays: number;
  totals: {
    leadsCreated: number;
    leadsQualified: number;
    qualificationRate: number;
    handoffsRequested: number;
    handoffsClaimed: number;
    handoffsResolved: number;
    handoffResolutionRate: number;
    medianTimeToClaimSeconds: number | null;
    medianTimeToResolveSeconds: number | null;
    missedQuestions: number;
    resolvedMissedQuestions: number;
    missedQuestionResolutionRate: number;
    confirmedBookings: number;
    confirmedOrders: number;
    confirmedOrderValueByCurrency: Record<string, number>;
  };
  clientsWithHighMissedQuestions: Array<{
    accountId: string;
    accountName?: string;
    tenantId: string;
    missedQuestions: number;
    resolvedMissedQuestions: number;
    resolutionRate: number;
  }>;
  perClientSummaries?: AdminAccountOutcomeSummary[];
}

export interface UnresolvedMissedQuestion {
  id: string;
  conversationId: string | null;
  customerId: string | null;
  question: string;
  language: string;
  script?: string;
  occurredAt: string;
}
