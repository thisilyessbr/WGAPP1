import { PrismaClient, OutcomeEvent, Prisma } from '@prisma/client';
import { logger } from '../../utils/logger';
import {
  OUTCOME_EVENT_TYPES,
  OUTCOME_SOURCES,
  OutcomeEventType,
  RecordOutcomeParams,
  ListOutcomeParams,
  AccountOutcomeSummary,
  AdminOutcomeSummary,
  AdminAccountOutcomeSummary,
  UnresolvedMissedQuestion
} from './types';
import { OutcomePublisher, NoOpOutcomePublisher } from './OutcomePublisher';

export class OutcomeTrackingService {
  constructor(
    private prisma: PrismaClient,
    private publisher: OutcomePublisher = new NoOpOutcomePublisher()
  ) {}

  /**
   * Idempotently records an outcome event.
   * Atomic unique constraint on [accountId, idempotencyKey] guarantees deduplication.
   * If tracking fails, logs the failure and does not crash the caller.
   */
  async recordEvent(params: RecordOutcomeParams): Promise<OutcomeEvent | null> {
    const {
      tenantId,
      accountId,
      type,
      source,
      conversationId,
      customerId,
      value,
      currency,
      relatedOutcomeId,
      idempotencyKey,
      metadata,
      occurredAt
    } = params;

    if (!tenantId || !accountId || !type || !idempotencyKey) {
      logger.error('OutcomeTrackingService: Missing required fields for outcome event', {
        tenantId,
        accountId,
        type,
        hasIdempotencyKey: Boolean(idempotencyKey)
      });
      return null;
    }

    if (!OUTCOME_EVENT_TYPES.includes(type)) {
      logger.warn(`OutcomeTrackingService: Unsupported outcome event type [${type}]`);
      return null;
    }

    if (!OUTCOME_SOURCES.includes(source)) {
      logger.warn(`OutcomeTrackingService: Unsupported outcome source [${source}]`);
      return null;
    }

    try {
      const numericValue = value !== undefined && value !== null ? Number(value) : null;
      const decimalValue = numericValue !== null && Number.isFinite(numericValue) && numericValue >= 0
        ? new Prisma.Decimal(numericValue.toFixed(2))
        : null;
      const normalizedCurrency = currency?.trim().toUpperCase();

      const event = await this.prisma.outcomeEvent.create({
        data: {
          tenantId,
          accountId,
          conversationId: conversationId ?? null,
          customerId: customerId ?? null,
          type,
          source,
          value: decimalValue,
          currency: normalizedCurrency && /^[A-Z]{3}$/.test(normalizedCurrency) ? normalizedCurrency : null,
          relatedOutcomeId: relatedOutcomeId ?? null,
          idempotencyKey: idempotencyKey.trim(),
          metadata: metadata || {},
          occurredAt: occurredAt || new Date()
        }
      });

      // Dispatch to external CRM publisher asynchronously (non-blocking)
      this.publisher.publish(event).catch((err: any) => {
        logger.error(`OutcomeTrackingService: Publisher error for event [${event.id}]: ${err.message || err}`);
      });

      return event;
    } catch (err: any) {
      // P2002: Unique constraint failed on (accountId, idempotencyKey)
      if (err.code === 'P2002' || err.message?.includes('Unique constraint')) {
        const existing = await this.prisma.outcomeEvent.findUnique({
          where: {
            accountId_idempotencyKey: {
              accountId,
              idempotencyKey: idempotencyKey.trim()
            }
          }
        });
        if (existing) {
          logger.info(`OutcomeTrackingService: Deduplicated existing outcome event [${existing.id}] for key [${idempotencyKey}]`);
          return existing;
        }
      }

      logger.error(`OutcomeTrackingService: Failed to record outcome event for account [${accountId}] in conversation [${conversationId || 'none'}]: ${err.message || err}`);
      return null;
    }
  }

  /**
   * Lists events for an account with bounded pagination and optional filtering.
   */
  async listEvents(params: ListOutcomeParams): Promise<{ events: OutcomeEvent[]; total: number }> {
    const { tenantId, accountId, type, days = 30, limit = 50, offset = 0 } = params;

    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 50));
    const safeOffset = Math.max(0, Number(offset) || 0);
    const safeDays = Math.max(1, Math.min(365, Number(days) || 30));

    const since = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000);

    const where: Prisma.OutcomeEventWhereInput = {
      tenantId,
      accountId,
      occurredAt: { gte: since }
    };

    if (type && OUTCOME_EVENT_TYPES.includes(type)) {
      where.type = type;
    }

    const [events, total] = await Promise.all([
      this.prisma.outcomeEvent.findMany({
        where,
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        take: safeLimit,
        skip: safeOffset
      }),
      this.prisma.outcomeEvent.count({ where })
    ]);

    return { events, total };
  }

  /**
   * Computes an account-level outcome summary over the specified window (default 30 days).
   */
  async getAccountSummary(tenantId: string, accountId: string, days = 30): Promise<AccountOutcomeSummary> {
    const safeDays = Math.max(1, Math.min(365, Number(days) || 30));
    const since = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000);

    const events = await this.prisma.outcomeEvent.findMany({
      where: {
        tenantId,
        accountId,
        occurredAt: { gte: since }
      },
      select: {
        id: true,
        type: true,
        value: true,
        currency: true,
        metadata: true,
        occurredAt: true
      }
    });

    let leadsCreated = 0;
    let leadsQualified = 0;
    let handoffsRequested = 0;
    let handoffsClaimed = 0;
    let handoffsResolved = 0;
    let missedQuestions = 0;
    let resolvedMissedQuestions = 0;
    let confirmedBookings = 0;
    let confirmedOrders = 0;

    const claimDurations: number[] = [];
    const resolveDurations: number[] = [];
    const currencyValues: Record<string, number> = {};

    for (const ev of events) {
      switch (ev.type) {
        case 'LEAD_CREATED':
          leadsCreated++;
          break;
        case 'LEAD_QUALIFIED':
          leadsQualified++;
          break;
        case 'HANDOFF_REQUESTED':
          handoffsRequested++;
          break;
        case 'HANDOFF_CLAIMED': {
          handoffsClaimed++;
          const meta = ev.metadata as Record<string, any> | null;
          const claimMs = Number(meta?.timeFromRequestToClaimMs);
          if (Number.isFinite(claimMs) && claimMs >= 0) {
            claimDurations.push(claimMs / 1000);
          }
          break;
        }
        case 'HANDOFF_RESOLVED': {
          handoffsResolved++;
          const meta = ev.metadata as Record<string, any> | null;
          const totalMs = Number(meta?.totalResolutionTimeMs ?? meta?.timeFromClaimToResolutionMs);
          if (Number.isFinite(totalMs) && totalMs >= 0) {
            resolveDurations.push(totalMs / 1000);
          }
          break;
        }
        case 'QUESTION_MISSED':
          missedQuestions++;
          break;
        case 'QUESTION_RESOLVED':
          resolvedMissedQuestions++;
          break;
        case 'BOOKING_CONFIRMED':
          confirmedBookings++;
          break;
        case 'ORDER_CONFIRMED': {
          confirmedOrders++;
          if (ev.value !== null && ev.value !== undefined) {
            const curr = (ev.currency || 'MAD').toUpperCase();
            const val = Number(ev.value);
            currencyValues[curr] = (currencyValues[curr] || 0) + (Number.isFinite(val) ? val : 0);
          }
          break;
        }
      }
    }

    const medianTimeToClaimSeconds = this.calculateMedian(claimDurations);
    const medianTimeToResolveSeconds = this.calculateMedian(resolveDurations);

    return {
      periodDays: safeDays,
      leadsCreated,
      leadsQualified,
      qualificationRate: this.calculateRate(leadsQualified, leadsCreated),
      handoffsRequested,
      handoffsClaimed,
      handoffsResolved,
      handoffResolutionRate: this.calculateRate(handoffsResolved, handoffsRequested),
      medianTimeToClaimSeconds,
      medianTimeToResolveSeconds,
      missedQuestions,
      resolvedMissedQuestions,
      missedQuestionResolutionRate: this.calculateRate(resolvedMissedQuestions, missedQuestions),
      confirmedBookings,
      confirmedOrders,
      confirmedOrderValueByCurrency: currencyValues
    };
  }

  /**
   * Computes admin summary across all accounts or filtered to a single account.
   */
  async getAdminSummary(days = 30, accountIdFilter?: string): Promise<AdminOutcomeSummary> {
    const safeDays = Math.max(1, Math.min(365, Number(days) || 30));
    const since = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000);

    const where: Prisma.OutcomeEventWhereInput = {
      occurredAt: { gte: since }
    };
    if (accountIdFilter) {
      where.accountId = accountIdFilter;
    }

    const events = await this.prisma.outcomeEvent.findMany({
      where,
      select: {
        id: true,
        tenantId: true,
        accountId: true,
        type: true,
        value: true,
        currency: true,
        metadata: true,
        occurredAt: true
      }
    });

    let leadsCreated = 0;
    let leadsQualified = 0;
    let handoffsRequested = 0;
    let handoffsClaimed = 0;
    let handoffsResolved = 0;
    let missedQuestions = 0;
    let resolvedMissedQuestions = 0;
    let confirmedBookings = 0;
    let confirmedOrders = 0;

    const claimDurations: number[] = [];
    const resolveDurations: number[] = [];
    const currencyValues: Record<string, number> = {};

    // Grouping by account for per-client analysis
    const accountAggs = new Map<string, {
      tenantId: string;
      leadsCreated: number;
      leadsQualified: number;
      handoffsRequested: number;
      handoffsClaimed: number;
      handoffsResolved: number;
      missedQuestions: number;
      resolvedMissedQuestions: number;
      confirmedBookings: number;
      confirmedOrders: number;
      claimDurations: number[];
      resolveDurations: number[];
      currencyValues: Record<string, number>;
    }>();

    for (const ev of events) {
      if (!accountAggs.has(ev.accountId)) {
        accountAggs.set(ev.accountId, {
          tenantId: ev.tenantId,
          leadsCreated: 0,
          leadsQualified: 0,
          handoffsRequested: 0,
          handoffsClaimed: 0,
          handoffsResolved: 0,
          missedQuestions: 0,
          resolvedMissedQuestions: 0,
          confirmedBookings: 0,
          confirmedOrders: 0,
          claimDurations: [],
          resolveDurations: [],
          currencyValues: {}
        });
      }
      const acc = accountAggs.get(ev.accountId)!;

      switch (ev.type) {
        case 'LEAD_CREATED':
          leadsCreated++;
          acc.leadsCreated++;
          break;
        case 'LEAD_QUALIFIED':
          leadsQualified++;
          acc.leadsQualified++;
          break;
        case 'HANDOFF_REQUESTED':
          handoffsRequested++;
          acc.handoffsRequested++;
          break;
        case 'HANDOFF_CLAIMED': {
          handoffsClaimed++;
          acc.handoffsClaimed++;
          const meta = ev.metadata as Record<string, any> | null;
          const claimMs = Number(meta?.timeFromRequestToClaimMs);
          if (Number.isFinite(claimMs) && claimMs >= 0) {
            claimDurations.push(claimMs / 1000);
            acc.claimDurations.push(claimMs / 1000);
          }
          break;
        }
        case 'HANDOFF_RESOLVED': {
          handoffsResolved++;
          acc.handoffsResolved++;
          const meta = ev.metadata as Record<string, any> | null;
          const totalMs = Number(meta?.totalResolutionTimeMs ?? meta?.timeFromClaimToResolutionMs);
          if (Number.isFinite(totalMs) && totalMs >= 0) {
            resolveDurations.push(totalMs / 1000);
            acc.resolveDurations.push(totalMs / 1000);
          }
          break;
        }
        case 'QUESTION_MISSED':
          missedQuestions++;
          acc.missedQuestions++;
          break;
        case 'QUESTION_RESOLVED':
          resolvedMissedQuestions++;
          acc.resolvedMissedQuestions++;
          break;
        case 'BOOKING_CONFIRMED':
          confirmedBookings++;
          acc.confirmedBookings++;
          break;
        case 'ORDER_CONFIRMED': {
          confirmedOrders++;
          acc.confirmedOrders++;
          if (ev.value !== null && ev.value !== undefined) {
            const curr = (ev.currency || 'MAD').toUpperCase();
            const val = Number(ev.value);
            const validVal = Number.isFinite(val) ? val : 0;
            currencyValues[curr] = (currencyValues[curr] || 0) + validVal;
            acc.currencyValues[curr] = (acc.currencyValues[curr] || 0) + validVal;
          }
          break;
        }
      }
    }

    // Fetch account names for identified accounts
    const accountIds = Array.from(accountAggs.keys());
    const accounts = accountIds.length > 0
      ? await this.prisma.account.findMany({
          where: { id: { in: accountIds } },
          select: { id: true, name: true }
        })
      : [];
    const accountNameMap = new Map(accounts.map(a => [a.id, a.name]));

    const clientsWithHighMissedQuestions: AdminOutcomeSummary['clientsWithHighMissedQuestions'] = [];
    const perClientSummaries: AdminAccountOutcomeSummary[] = [];

    for (const [accId, data] of accountAggs.entries()) {
      const resRate = this.calculateRate(data.resolvedMissedQuestions, data.missedQuestions);

      if (data.missedQuestions > 0) {
        clientsWithHighMissedQuestions.push({
          accountId: accId,
          accountName: accountNameMap.get(accId) || 'Unknown Client',
          tenantId: data.tenantId,
          missedQuestions: data.missedQuestions,
          resolvedMissedQuestions: data.resolvedMissedQuestions,
          resolutionRate: resRate
        });
      }

      perClientSummaries.push({
        accountId: accId,
        accountName: accountNameMap.get(accId) || 'Unknown Client',
        tenantId: data.tenantId,
        periodDays: safeDays,
        leadsCreated: data.leadsCreated,
        leadsQualified: data.leadsQualified,
        qualificationRate: this.calculateRate(data.leadsQualified, data.leadsCreated),
        handoffsRequested: data.handoffsRequested,
        handoffsClaimed: data.handoffsClaimed,
        handoffsResolved: data.handoffsResolved,
        handoffResolutionRate: this.calculateRate(data.handoffsResolved, data.handoffsRequested),
        medianTimeToClaimSeconds: this.calculateMedian(data.claimDurations),
        medianTimeToResolveSeconds: this.calculateMedian(data.resolveDurations),
        missedQuestions: data.missedQuestions,
        resolvedMissedQuestions: data.resolvedMissedQuestions,
        missedQuestionResolutionRate: resRate,
        confirmedBookings: data.confirmedBookings,
        confirmedOrders: data.confirmedOrders,
        confirmedOrderValueByCurrency: data.currencyValues
      });
    }

    // Sort clients with high missed questions by count desc, then resolution rate asc
    clientsWithHighMissedQuestions.sort((a, b) => b.missedQuestions - a.missedQuestions || a.resolutionRate - b.resolutionRate);

    return {
      periodDays: safeDays,
      totals: {
        leadsCreated,
        leadsQualified,
        qualificationRate: this.calculateRate(leadsQualified, leadsCreated),
        handoffsRequested,
        handoffsClaimed,
        handoffsResolved,
        handoffResolutionRate: this.calculateRate(handoffsResolved, handoffsRequested),
        medianTimeToClaimSeconds: this.calculateMedian(claimDurations),
        medianTimeToResolveSeconds: this.calculateMedian(resolveDurations),
        missedQuestions,
        resolvedMissedQuestions,
        missedQuestionResolutionRate: this.calculateRate(resolvedMissedQuestions, missedQuestions),
        confirmedBookings,
        confirmedOrders,
        confirmedOrderValueByCurrency: currencyValues
      },
      clientsWithHighMissedQuestions,
      perClientSummaries
    };
  }

  /**
   * Resolves a missed question by recording a linked QUESTION_RESOLVED outcome event.
   */
  async resolveMissedQuestion(params: {
    tenantId: string;
    accountId: string;
    outcomeId: string;
    actorId?: string;
  }): Promise<OutcomeEvent> {
    const { tenantId, accountId, outcomeId, actorId } = params;

    const originalEvent = await this.prisma.outcomeEvent.findFirst({
      where: {
        id: outcomeId,
        tenantId,
        accountId,
        type: 'QUESTION_MISSED'
      }
    });

    if (!originalEvent) {
      throw new Error(`OutcomeTrackingService: Missed question event [${outcomeId}] not found for account [${accountId}]`);
    }

    // Check if already resolved
    const existingResolution = await this.prisma.outcomeEvent.findFirst({
      where: {
        tenantId,
        accountId,
        type: 'QUESTION_RESOLVED',
        relatedOutcomeId: outcomeId
      }
    });

    if (existingResolution) {
      return existingResolution;
    }

    const idempotencyKey = `resolve:${outcomeId}`;
    const resolvedEvent = await this.recordEvent({
      tenantId,
      accountId,
      conversationId: originalEvent.conversationId,
      customerId: originalEvent.customerId,
      type: 'QUESTION_RESOLVED',
      source: 'MERCHANT',
      relatedOutcomeId: outcomeId,
      idempotencyKey,
      metadata: {
        resolvedBy: actorId || 'merchant',
        resolvedAt: new Date().toISOString()
      }
    });

    if (!resolvedEvent) {
      throw new Error(`OutcomeTrackingService: Failed to record resolution for question [${outcomeId}]`);
    }

    return resolvedEvent;
  }

  /**
   * Returns missed questions that do not yet have a matching resolution event.
   */
  async getUnresolvedMissedQuestions(
    tenantId: string,
    accountId: string,
    days = 30,
    limit = 20,
    offset = 0
  ): Promise<{ questions: UnresolvedMissedQuestion[]; total: number }> {
    const safeDays = Math.max(1, Math.min(365, Number(days) || 30));
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
    const safeOffset = Math.max(0, Number(offset) || 0);

    const since = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000);

    const where: Prisma.OutcomeEventWhereInput = {
      tenantId,
      accountId,
      type: 'QUESTION_MISSED',
      occurredAt: { gte: since },
      resolutions: {
        none: {
          tenantId,
          accountId,
          type: 'QUESTION_RESOLVED'
        }
      }
    };

    const [events, total] = await Promise.all([
      this.prisma.outcomeEvent.findMany({
        where,
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        take: safeLimit,
        skip: safeOffset
      }),
      this.prisma.outcomeEvent.count({ where })
    ]);

    const questions: UnresolvedMissedQuestion[] = events.map(e => {
      const meta = (e.metadata as Record<string, any>) || {};
      return {
        id: e.id,
        conversationId: e.conversationId,
        customerId: e.customerId,
        question: typeof meta.question === 'string' ? meta.question : 'Customer question',
        language: typeof meta.language === 'string' ? meta.language : 'unknown',
        script: typeof meta.script === 'string' ? meta.script : undefined,
        occurredAt: e.occurredAt.toISOString()
      };
    });

    return { questions, total };
  }

  private calculateMedian(values: number[]): number | null {
    if (!values || values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 !== 0) {
      return Number(sorted[mid].toFixed(2));
    }
    return Number(((sorted[mid - 1] + sorted[mid]) / 2).toFixed(2));
  }

  private calculateRate(numerator: number, denominator: number): number {
    if (denominator <= 0) return 0;
    return Number(Math.min(1, Math.max(0, numerator / denominator)).toFixed(4));
  }
}
