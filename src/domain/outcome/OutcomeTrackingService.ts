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

export type OutcomeDatabaseClient = PrismaClient | {
  $queryRaw: <T = any>(query: TemplateStringsArray | any, ...values: any[]) => Promise<T>;
  $executeRaw?: (query: TemplateStringsArray | any, ...values: any[]) => Promise<number>;
  outcomeEvent?: any;
  account?: any;
};

export class OutcomeTrackingService {
  constructor(
    private prisma: OutcomeDatabaseClient,
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
      const validCurrency = normalizedCurrency && /^[A-Z]{3}$/.test(normalizedCurrency) ? normalizedCurrency : null;

      let event: OutcomeEvent | null = null;
      if (this.prisma.outcomeEvent?.create) {
        event = await this.prisma.outcomeEvent.create({
          data: {
            tenantId,
            accountId,
            conversationId: conversationId ?? null,
            customerId: customerId ?? null,
            type,
            source,
            value: decimalValue,
            currency: validCurrency,
            relatedOutcomeId: relatedOutcomeId ?? null,
            idempotencyKey: idempotencyKey.trim(),
            metadata: metadata || {},
            occurredAt: occurredAt || new Date()
          }
        });
      } else {
        const id = crypto.randomUUID();
        const occurred = occurredAt || new Date();
        const rows = await this.prisma.$queryRaw<any[]>`
          INSERT INTO "OutcomeEvent"(
            id, "tenantId", "accountId", "conversationId", "customerId",
            type, source, value, currency, "relatedOutcomeId",
            "idempotencyKey", metadata, "occurredAt", "createdAt"
          ) VALUES (
            ${id}, ${tenantId}, ${accountId}, ${conversationId ?? null}, ${customerId ?? null},
            ${type}, ${source}, ${decimalValue === null ? null : decimalValue.toString()}::numeric, ${validCurrency}, ${relatedOutcomeId ?? null},
            ${idempotencyKey.trim()}, ${JSON.stringify(metadata || {})}::jsonb, ${occurred}, NOW()
          )
          RETURNING *
        `;
        event = rows[0] || null;
      }

      if (event) {
        // Dispatch to external CRM publisher asynchronously (non-blocking)
        this.publisher.publish(event).catch((err: any) => {
          logger.error(`OutcomeTrackingService: Publisher error for event [${event!.id}]: ${err.message || err}`);
        });
      }

      return event;
    } catch (err: any) {
      // P2002: Unique constraint failed on (accountId, idempotencyKey)
      if (err.code === 'P2002' || err.message?.includes('Unique constraint') || err.message?.includes('duplicate key')) {
        let existing: OutcomeEvent | null = null;
        if (this.prisma.outcomeEvent?.findUnique) {
          existing = await this.prisma.outcomeEvent.findUnique({
            where: {
              accountId_idempotencyKey: {
                accountId,
                idempotencyKey: idempotencyKey.trim()
              }
            }
          });
        } else {
          const rows = await this.prisma.$queryRaw<any[]>`
            SELECT * FROM "OutcomeEvent"
            WHERE "accountId" = ${accountId} AND "idempotencyKey" = ${idempotencyKey.trim()}
            LIMIT 1
          `;
          existing = rows[0] || null;
        }

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

    let events: OutcomeEvent[];
    let total: number;

    if (this.prisma.outcomeEvent?.findMany) {
      const where: Prisma.OutcomeEventWhereInput = {
        tenantId,
        accountId,
        occurredAt: { gte: since }
      };

      if (type && OUTCOME_EVENT_TYPES.includes(type)) {
        where.type = type;
      }

      [events, total] = await Promise.all([
        this.prisma.outcomeEvent.findMany({
          where,
          orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
          take: safeLimit,
          skip: safeOffset
        }),
        this.prisma.outcomeEvent.count({ where })
      ]);
    } else {
      const rows = type && OUTCOME_EVENT_TYPES.includes(type)
        ? await this.prisma.$queryRaw<any[]>`
            SELECT * FROM "OutcomeEvent"
            WHERE "tenantId" = ${tenantId} AND "accountId" = ${accountId} AND type = ${type} AND "occurredAt" >= ${since}
            ORDER BY "occurredAt" DESC, id DESC
            LIMIT ${safeLimit} OFFSET ${safeOffset}
          `
        : await this.prisma.$queryRaw<any[]>`
            SELECT * FROM "OutcomeEvent"
            WHERE "tenantId" = ${tenantId} AND "accountId" = ${accountId} AND "occurredAt" >= ${since}
            ORDER BY "occurredAt" DESC, id DESC
            LIMIT ${safeLimit} OFFSET ${safeOffset}
          `;
      const countRows = type && OUTCOME_EVENT_TYPES.includes(type)
        ? await this.prisma.$queryRaw<any[]>`
            SELECT COUNT(*)::int AS count FROM "OutcomeEvent"
            WHERE "tenantId" = ${tenantId} AND "accountId" = ${accountId} AND type = ${type} AND "occurredAt" >= ${since}
          `
        : await this.prisma.$queryRaw<any[]>`
            SELECT COUNT(*)::int AS count FROM "OutcomeEvent"
            WHERE "tenantId" = ${tenantId} AND "accountId" = ${accountId} AND "occurredAt" >= ${since}
          `;
      events = rows;
      total = Number(countRows[0]?.count) || 0;
    }

    return { events, total };
  }

  /**
   * Computes an account-level outcome summary via direct PostgreSQL database aggregation.
   */
  async getAccountSummary(tenantId: string, accountId: string, days = 30): Promise<AccountOutcomeSummary> {
    const safeDays = Math.max(1, Math.min(365, Number(days) || 30));
    const since = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000);

    const [rows, currencyRows] = await Promise.all([
      this.prisma.$queryRaw<any[]>`
        SELECT
          COUNT(*) FILTER (WHERE type = 'LEAD_CREATED')::int AS "leadsCreated",
          COUNT(*) FILTER (WHERE type = 'LEAD_QUALIFIED')::int AS "leadsQualified",
          COUNT(*) FILTER (WHERE type = 'HANDOFF_REQUESTED')::int AS "handoffsRequested",
          COUNT(*) FILTER (WHERE type = 'HANDOFF_CLAIMED')::int AS "handoffsClaimed",
          COUNT(*) FILTER (WHERE type = 'HANDOFF_RESOLVED')::int AS "handoffsResolved",
          COUNT(*) FILTER (WHERE type = 'QUESTION_MISSED')::int AS "missedQuestions",
          COUNT(*) FILTER (WHERE type = 'QUESTION_RESOLVED')::int AS "resolvedMissedQuestions",
          COUNT(*) FILTER (WHERE type = 'BOOKING_CONFIRMED')::int AS "confirmedBookings",
          COUNT(*) FILTER (WHERE type = 'ORDER_CONFIRMED')::int AS "confirmedOrders",
          percentile_cont(0.5) WITHIN GROUP (
            ORDER BY (
              CASE
                WHEN (metadata->>'timeFromRequestToClaimMs') ~ '^[0-9]+(\.[0-9]+)?$'
                THEN (metadata->>'timeFromRequestToClaimMs')::double precision / 1000.0
                ELSE NULL
              END
            )
          ) FILTER (WHERE type = 'HANDOFF_CLAIMED') AS "medianTimeToClaimSeconds",
          percentile_cont(0.5) WITHIN GROUP (
            ORDER BY (
              CASE
                WHEN COALESCE(metadata->>'totalResolutionTimeMs', metadata->>'timeFromClaimToResolutionMs') ~ '^[0-9]+(\.[0-9]+)?$'
                THEN (COALESCE(metadata->>'totalResolutionTimeMs', metadata->>'timeFromClaimToResolutionMs'))::double precision / 1000.0
                ELSE NULL
              END
            )
          ) FILTER (WHERE type = 'HANDOFF_RESOLVED') AS "medianTimeToResolveSeconds"
        FROM "OutcomeEvent"
        WHERE "tenantId" = ${tenantId} AND "accountId" = ${accountId} AND "occurredAt" >= ${since}
      `,
      this.prisma.$queryRaw<any[]>`
        SELECT UPPER(COALESCE(currency, 'MAD')) AS currency, SUM(value)::double precision AS total
        FROM "OutcomeEvent"
        WHERE "tenantId" = ${tenantId} AND "accountId" = ${accountId} AND type = 'ORDER_CONFIRMED' AND "occurredAt" >= ${since} AND value IS NOT NULL AND value > 0
        GROUP BY UPPER(COALESCE(currency, 'MAD'))
      `
    ]);

    const r = rows[0] || {};
    const leadsCreated = Number(r.leadsCreated) || 0;
    const leadsQualified = Number(r.leadsQualified) || 0;
    const handoffsRequested = Number(r.handoffsRequested) || 0;
    const handoffsClaimed = Number(r.handoffsClaimed) || 0;
    const handoffsResolved = Number(r.handoffsResolved) || 0;
    const missedQuestions = Number(r.missedQuestions) || 0;
    const resolvedMissedQuestions = Number(r.resolvedMissedQuestions) || 0;
    const confirmedBookings = Number(r.confirmedBookings) || 0;
    const confirmedOrders = Number(r.confirmedOrders) || 0;

    const medianTimeToClaimSeconds = r.medianTimeToClaimSeconds !== null && r.medianTimeToClaimSeconds !== undefined
      ? Number(Number(r.medianTimeToClaimSeconds).toFixed(2))
      : null;
    const medianTimeToResolveSeconds = r.medianTimeToResolveSeconds !== null && r.medianTimeToResolveSeconds !== undefined
      ? Number(Number(r.medianTimeToResolveSeconds).toFixed(2))
      : null;

    const currencyValues: Record<string, number> = {};
    for (const cr of currencyRows) {
      if (cr.currency) {
        currencyValues[cr.currency] = Number(Number(cr.total || 0).toFixed(2));
      }
    }

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
   * Computes admin summary across all accounts or filtered to a single account via direct PostgreSQL aggregation.
   */
  async getAdminSummary(days = 30, accountIdFilter?: string): Promise<AdminOutcomeSummary> {
    const safeDays = Math.max(1, Math.min(365, Number(days) || 30));
    const since = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000);

    const totalsPromise = accountIdFilter
      ? this.prisma.$queryRaw<any[]>`
          SELECT
            COUNT(*) FILTER (WHERE type = 'LEAD_CREATED')::int AS "leadsCreated",
            COUNT(*) FILTER (WHERE type = 'LEAD_QUALIFIED')::int AS "leadsQualified",
            COUNT(*) FILTER (WHERE type = 'HANDOFF_REQUESTED')::int AS "handoffsRequested",
            COUNT(*) FILTER (WHERE type = 'HANDOFF_CLAIMED')::int AS "handoffsClaimed",
            COUNT(*) FILTER (WHERE type = 'HANDOFF_RESOLVED')::int AS "handoffsResolved",
            COUNT(*) FILTER (WHERE type = 'QUESTION_MISSED')::int AS "missedQuestions",
            COUNT(*) FILTER (WHERE type = 'QUESTION_RESOLVED')::int AS "resolvedMissedQuestions",
            COUNT(*) FILTER (WHERE type = 'BOOKING_CONFIRMED')::int AS "confirmedBookings",
            COUNT(*) FILTER (WHERE type = 'ORDER_CONFIRMED')::int AS "confirmedOrders",
            percentile_cont(0.5) WITHIN GROUP (
              ORDER BY (
                CASE
                  WHEN (metadata->>'timeFromRequestToClaimMs') ~ '^[0-9]+(\.[0-9]+)?$'
                  THEN (metadata->>'timeFromRequestToClaimMs')::double precision / 1000.0
                  ELSE NULL
                END
              )
            ) FILTER (WHERE type = 'HANDOFF_CLAIMED') AS "medianTimeToClaimSeconds",
            percentile_cont(0.5) WITHIN GROUP (
              ORDER BY (
                CASE
                  WHEN COALESCE(metadata->>'totalResolutionTimeMs', metadata->>'timeFromClaimToResolutionMs') ~ '^[0-9]+(\.[0-9]+)?$'
                  THEN (COALESCE(metadata->>'totalResolutionTimeMs', metadata->>'timeFromClaimToResolutionMs'))::double precision / 1000.0
                  ELSE NULL
                END
              )
            ) FILTER (WHERE type = 'HANDOFF_RESOLVED') AS "medianTimeToResolveSeconds"
          FROM "OutcomeEvent"
          WHERE "occurredAt" >= ${since} AND "accountId" = ${accountIdFilter}
        `
      : this.prisma.$queryRaw<any[]>`
          SELECT
            COUNT(*) FILTER (WHERE type = 'LEAD_CREATED')::int AS "leadsCreated",
            COUNT(*) FILTER (WHERE type = 'LEAD_QUALIFIED')::int AS "leadsQualified",
            COUNT(*) FILTER (WHERE type = 'HANDOFF_REQUESTED')::int AS "handoffsRequested",
            COUNT(*) FILTER (WHERE type = 'HANDOFF_CLAIMED')::int AS "handoffsClaimed",
            COUNT(*) FILTER (WHERE type = 'HANDOFF_RESOLVED')::int AS "handoffsResolved",
            COUNT(*) FILTER (WHERE type = 'QUESTION_MISSED')::int AS "missedQuestions",
            COUNT(*) FILTER (WHERE type = 'QUESTION_RESOLVED')::int AS "resolvedMissedQuestions",
            COUNT(*) FILTER (WHERE type = 'BOOKING_CONFIRMED')::int AS "confirmedBookings",
            COUNT(*) FILTER (WHERE type = 'ORDER_CONFIRMED')::int AS "confirmedOrders",
            percentile_cont(0.5) WITHIN GROUP (
              ORDER BY (
                CASE
                  WHEN (metadata->>'timeFromRequestToClaimMs') ~ '^[0-9]+(\.[0-9]+)?$'
                  THEN (metadata->>'timeFromRequestToClaimMs')::double precision / 1000.0
                  ELSE NULL
                END
              )
            ) FILTER (WHERE type = 'HANDOFF_CLAIMED') AS "medianTimeToClaimSeconds",
            percentile_cont(0.5) WITHIN GROUP (
              ORDER BY (
                CASE
                  WHEN COALESCE(metadata->>'totalResolutionTimeMs', metadata->>'timeFromClaimToResolutionMs') ~ '^[0-9]+(\.[0-9]+)?$'
                  THEN (COALESCE(metadata->>'totalResolutionTimeMs', metadata->>'timeFromClaimToResolutionMs'))::double precision / 1000.0
                  ELSE NULL
                END
              )
            ) FILTER (WHERE type = 'HANDOFF_RESOLVED') AS "medianTimeToResolveSeconds"
          FROM "OutcomeEvent"
          WHERE "occurredAt" >= ${since}
        `;

    const totalCurrenciesPromise = accountIdFilter
      ? this.prisma.$queryRaw<any[]>`
          SELECT UPPER(COALESCE(currency, 'MAD')) AS currency, SUM(value)::double precision AS total
          FROM "OutcomeEvent"
          WHERE "occurredAt" >= ${since} AND "accountId" = ${accountIdFilter} AND type = 'ORDER_CONFIRMED' AND value IS NOT NULL AND value > 0
          GROUP BY UPPER(COALESCE(currency, 'MAD'))
        `
      : this.prisma.$queryRaw<any[]>`
          SELECT UPPER(COALESCE(currency, 'MAD')) AS currency, SUM(value)::double precision AS total
          FROM "OutcomeEvent"
          WHERE "occurredAt" >= ${since} AND type = 'ORDER_CONFIRMED' AND value IS NOT NULL AND value > 0
          GROUP BY UPPER(COALESCE(currency, 'MAD'))
        `;

    const accountRowsPromise = accountIdFilter
      ? this.prisma.$queryRaw<any[]>`
          SELECT
            "tenantId",
            "accountId",
            COUNT(*) FILTER (WHERE type = 'LEAD_CREATED')::int AS "leadsCreated",
            COUNT(*) FILTER (WHERE type = 'LEAD_QUALIFIED')::int AS "leadsQualified",
            COUNT(*) FILTER (WHERE type = 'HANDOFF_REQUESTED')::int AS "handoffsRequested",
            COUNT(*) FILTER (WHERE type = 'HANDOFF_CLAIMED')::int AS "handoffsClaimed",
            COUNT(*) FILTER (WHERE type = 'HANDOFF_RESOLVED')::int AS "handoffsResolved",
            COUNT(*) FILTER (WHERE type = 'QUESTION_MISSED')::int AS "missedQuestions",
            COUNT(*) FILTER (WHERE type = 'QUESTION_RESOLVED')::int AS "resolvedMissedQuestions",
            COUNT(*) FILTER (WHERE type = 'BOOKING_CONFIRMED')::int AS "confirmedBookings",
            COUNT(*) FILTER (WHERE type = 'ORDER_CONFIRMED')::int AS "confirmedOrders",
            percentile_cont(0.5) WITHIN GROUP (
              ORDER BY (
                CASE
                  WHEN (metadata->>'timeFromRequestToClaimMs') ~ '^[0-9]+(\.[0-9]+)?$'
                  THEN (metadata->>'timeFromRequestToClaimMs')::double precision / 1000.0
                  ELSE NULL
                END
              )
            ) FILTER (WHERE type = 'HANDOFF_CLAIMED') AS "medianTimeToClaimSeconds",
            percentile_cont(0.5) WITHIN GROUP (
              ORDER BY (
                CASE
                  WHEN COALESCE(metadata->>'totalResolutionTimeMs', metadata->>'timeFromClaimToResolutionMs') ~ '^[0-9]+(\.[0-9]+)?$'
                  THEN (COALESCE(metadata->>'totalResolutionTimeMs', metadata->>'timeFromClaimToResolutionMs'))::double precision / 1000.0
                  ELSE NULL
                END
              )
            ) FILTER (WHERE type = 'HANDOFF_RESOLVED') AS "medianTimeToResolveSeconds"
          FROM "OutcomeEvent"
          WHERE "occurredAt" >= ${since} AND "accountId" = ${accountIdFilter}
          GROUP BY "tenantId", "accountId"
        `
      : this.prisma.$queryRaw<any[]>`
          SELECT
            "tenantId",
            "accountId",
            COUNT(*) FILTER (WHERE type = 'LEAD_CREATED')::int AS "leadsCreated",
            COUNT(*) FILTER (WHERE type = 'LEAD_QUALIFIED')::int AS "leadsQualified",
            COUNT(*) FILTER (WHERE type = 'HANDOFF_REQUESTED')::int AS "handoffsRequested",
            COUNT(*) FILTER (WHERE type = 'HANDOFF_CLAIMED')::int AS "handoffsClaimed",
            COUNT(*) FILTER (WHERE type = 'HANDOFF_RESOLVED')::int AS "handoffsResolved",
            COUNT(*) FILTER (WHERE type = 'QUESTION_MISSED')::int AS "missedQuestions",
            COUNT(*) FILTER (WHERE type = 'QUESTION_RESOLVED')::int AS "resolvedMissedQuestions",
            COUNT(*) FILTER (WHERE type = 'BOOKING_CONFIRMED')::int AS "confirmedBookings",
            COUNT(*) FILTER (WHERE type = 'ORDER_CONFIRMED')::int AS "confirmedOrders",
            percentile_cont(0.5) WITHIN GROUP (
              ORDER BY (
                CASE
                  WHEN (metadata->>'timeFromRequestToClaimMs') ~ '^[0-9]+(\.[0-9]+)?$'
                  THEN (metadata->>'timeFromRequestToClaimMs')::double precision / 1000.0
                  ELSE NULL
                END
              )
            ) FILTER (WHERE type = 'HANDOFF_CLAIMED') AS "medianTimeToClaimSeconds",
            percentile_cont(0.5) WITHIN GROUP (
              ORDER BY (
                CASE
                  WHEN COALESCE(metadata->>'totalResolutionTimeMs', metadata->>'timeFromClaimToResolutionMs') ~ '^[0-9]+(\.[0-9]+)?$'
                  THEN (COALESCE(metadata->>'totalResolutionTimeMs', metadata->>'timeFromClaimToResolutionMs'))::double precision / 1000.0
                  ELSE NULL
                END
              )
            ) FILTER (WHERE type = 'HANDOFF_RESOLVED') AS "medianTimeToResolveSeconds"
          FROM "OutcomeEvent"
          WHERE "occurredAt" >= ${since}
          GROUP BY "tenantId", "accountId"
        `;

    const accountCurrenciesPromise = accountIdFilter
      ? this.prisma.$queryRaw<any[]>`
          SELECT "accountId", UPPER(COALESCE(currency, 'MAD')) AS currency, SUM(value)::double precision AS total
          FROM "OutcomeEvent"
          WHERE "occurredAt" >= ${since} AND "accountId" = ${accountIdFilter} AND type = 'ORDER_CONFIRMED' AND value IS NOT NULL AND value > 0
          GROUP BY "accountId", UPPER(COALESCE(currency, 'MAD'))
        `
      : this.prisma.$queryRaw<any[]>`
          SELECT "accountId", UPPER(COALESCE(currency, 'MAD')) AS currency, SUM(value)::double precision AS total
          FROM "OutcomeEvent"
          WHERE "occurredAt" >= ${since} AND type = 'ORDER_CONFIRMED' AND value IS NOT NULL AND value > 0
          GROUP BY "accountId", UPPER(COALESCE(currency, 'MAD'))
        `;

    const [totalRows, totalCurrencyRows, accountRows, accountCurrencyRows] = await Promise.all([
      totalsPromise,
      totalCurrenciesPromise,
      accountRowsPromise,
      accountCurrenciesPromise
    ]);

    const r = totalRows[0] || {};
    const leadsCreated = Number(r.leadsCreated) || 0;
    const leadsQualified = Number(r.leadsQualified) || 0;
    const handoffsRequested = Number(r.handoffsRequested) || 0;
    const handoffsClaimed = Number(r.handoffsClaimed) || 0;
    const handoffsResolved = Number(r.handoffsResolved) || 0;
    const missedQuestions = Number(r.missedQuestions) || 0;
    const resolvedMissedQuestions = Number(r.resolvedMissedQuestions) || 0;
    const confirmedBookings = Number(r.confirmedBookings) || 0;
    const confirmedOrders = Number(r.confirmedOrders) || 0;

    const medianTimeToClaimSeconds = r.medianTimeToClaimSeconds !== null && r.medianTimeToClaimSeconds !== undefined
      ? Number(Number(r.medianTimeToClaimSeconds).toFixed(2))
      : null;
    const medianTimeToResolveSeconds = r.medianTimeToResolveSeconds !== null && r.medianTimeToResolveSeconds !== undefined
      ? Number(Number(r.medianTimeToResolveSeconds).toFixed(2))
      : null;

    const totalCurrencyValues: Record<string, number> = {};
    for (const cr of totalCurrencyRows) {
      if (cr.currency) {
        totalCurrencyValues[cr.currency] = Number(Number(cr.total || 0).toFixed(2));
      }
    }

    const accountCurrenciesMap = new Map<string, Record<string, number>>();
    for (const ac of accountCurrencyRows) {
      if (!accountCurrenciesMap.has(ac.accountId)) {
        accountCurrenciesMap.set(ac.accountId, {});
      }
      accountCurrenciesMap.get(ac.accountId)![ac.currency] = Number(Number(ac.total || 0).toFixed(2));
    }

    // Fetch account names for identified accounts
    const accountIds = accountRows.map(a => a.accountId);
    let accountNameMap = new Map<string, string>();
    if (accountIds.length > 0) {
      try {
        const accRows = await this.prisma.$queryRaw<any[]>`
          SELECT id, name FROM "Account" WHERE id = ANY(${accountIds}::text[])
        `;
        accountNameMap = new Map(accRows.map((a: any) => [a.id, a.name]));
      } catch {
        // Fallback if Account table lookup fails
      }
    }

    const clientsWithHighMissedQuestions: AdminOutcomeSummary['clientsWithHighMissedQuestions'] = [];
    const perClientSummaries: AdminAccountOutcomeSummary[] = [];

    for (const ar of accountRows) {
      const accId = ar.accountId;
      const accMissed = Number(ar.missedQuestions) || 0;
      const accResolved = Number(ar.resolvedMissedQuestions) || 0;
      const resRate = this.calculateRate(accResolved, accMissed);
      const accName = accountNameMap.get(accId) || 'Unknown Client';
      const currs = accountCurrenciesMap.get(accId) || {};

      if (accMissed > 0) {
        clientsWithHighMissedQuestions.push({
          accountId: accId,
          accountName: accName,
          tenantId: ar.tenantId,
          missedQuestions: accMissed,
          resolvedMissedQuestions: accResolved,
          resolutionRate: resRate
        });
      }

      perClientSummaries.push({
        accountId: accId,
        accountName: accName,
        tenantId: ar.tenantId,
        periodDays: safeDays,
        leadsCreated: Number(ar.leadsCreated) || 0,
        leadsQualified: Number(ar.leadsQualified) || 0,
        qualificationRate: this.calculateRate(Number(ar.leadsQualified) || 0, Number(ar.leadsCreated) || 0),
        handoffsRequested: Number(ar.handoffsRequested) || 0,
        handoffsClaimed: Number(ar.handoffsClaimed) || 0,
        handoffsResolved: Number(ar.handoffsResolved) || 0,
        handoffResolutionRate: this.calculateRate(Number(ar.handoffsResolved) || 0, Number(ar.handoffsRequested) || 0),
        medianTimeToClaimSeconds: ar.medianTimeToClaimSeconds !== null && ar.medianTimeToClaimSeconds !== undefined ? Number(Number(ar.medianTimeToClaimSeconds).toFixed(2)) : null,
        medianTimeToResolveSeconds: ar.medianTimeToResolveSeconds !== null && ar.medianTimeToResolveSeconds !== undefined ? Number(Number(ar.medianTimeToResolveSeconds).toFixed(2)) : null,
        missedQuestions: accMissed,
        resolvedMissedQuestions: accResolved,
        missedQuestionResolutionRate: resRate,
        confirmedBookings: Number(ar.confirmedBookings) || 0,
        confirmedOrders: Number(ar.confirmedOrders) || 0,
        confirmedOrderValueByCurrency: currs
      });
    }

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
        medianTimeToClaimSeconds,
        medianTimeToResolveSeconds,
        missedQuestions,
        resolvedMissedQuestions,
        missedQuestionResolutionRate: this.calculateRate(resolvedMissedQuestions, missedQuestions),
        confirmedBookings,
        confirmedOrders,
        confirmedOrderValueByCurrency: totalCurrencyValues
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

    let originalEvent: OutcomeEvent | null = null;
    if (this.prisma.outcomeEvent?.findFirst) {
      originalEvent = await this.prisma.outcomeEvent.findFirst({
        where: {
          id: outcomeId,
          tenantId,
          accountId,
          type: 'QUESTION_MISSED'
        }
      });
    } else {
      const rows = await this.prisma.$queryRaw<any[]>`
        SELECT * FROM "OutcomeEvent"
        WHERE id = ${outcomeId} AND "tenantId" = ${tenantId} AND "accountId" = ${accountId} AND type = 'QUESTION_MISSED'
        LIMIT 1
      `;
      originalEvent = rows[0] || null;
    }

    if (!originalEvent) {
      throw new Error(`OutcomeTrackingService: Missed question event [${outcomeId}] not found for account [${accountId}]`);
    }

    // Check if already resolved
    let existingResolution: OutcomeEvent | null = null;
    if (this.prisma.outcomeEvent?.findFirst) {
      existingResolution = await this.prisma.outcomeEvent.findFirst({
        where: {
          tenantId,
          accountId,
          type: 'QUESTION_RESOLVED',
          relatedOutcomeId: outcomeId
        }
      });
    } else {
      const rows = await this.prisma.$queryRaw<any[]>`
        SELECT * FROM "OutcomeEvent"
        WHERE "tenantId" = ${tenantId} AND "accountId" = ${accountId} AND type = 'QUESTION_RESOLVED' AND "relatedOutcomeId" = ${outcomeId}
        LIMIT 1
      `;
      existingResolution = rows[0] || null;
    }

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
   * Returns missed questions that do not yet have a matching resolution event via SQL NOT EXISTS.
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

    const [rows, countRows] = await Promise.all([
      this.prisma.$queryRaw<any[]>`
        SELECT id, "conversationId", "customerId", metadata, "occurredAt"
        FROM "OutcomeEvent" m
        WHERE m."tenantId" = ${tenantId} AND m."accountId" = ${accountId} AND m.type = 'QUESTION_MISSED' AND m."occurredAt" >= ${since}
          AND NOT EXISTS (
            SELECT 1 FROM "OutcomeEvent" r
            WHERE r."tenantId" = ${tenantId} AND r."accountId" = ${accountId} AND r.type = 'QUESTION_RESOLVED' AND r."relatedOutcomeId" = m.id
          )
        ORDER BY m."occurredAt" DESC, m.id DESC
        LIMIT ${safeLimit} OFFSET ${safeOffset}
      `,
      this.prisma.$queryRaw<any[]>`
        SELECT COUNT(*)::int AS count
        FROM "OutcomeEvent" m
        WHERE m."tenantId" = ${tenantId} AND m."accountId" = ${accountId} AND m.type = 'QUESTION_MISSED' AND m."occurredAt" >= ${since}
          AND NOT EXISTS (
            SELECT 1 FROM "OutcomeEvent" r
            WHERE r."tenantId" = ${tenantId} AND r."accountId" = ${accountId} AND r.type = 'QUESTION_RESOLVED' AND r."relatedOutcomeId" = m.id
          )
      `
    ]);

    const total = Number(countRows[0]?.count) || 0;
    const questions: UnresolvedMissedQuestion[] = rows.map((e: any) => {
      let meta = e.metadata;
      if (typeof meta === 'string') {
        try {
          meta = JSON.parse(meta);
        } catch {
          meta = {};
        }
      }
      meta = meta || {};
      const occurredAtStr = e.occurredAt instanceof Date ? e.occurredAt.toISOString() : String(e.occurredAt);
      return {
        id: e.id,
        conversationId: e.conversationId,
        customerId: e.customerId,
        question: typeof meta.question === 'string' ? meta.question : 'Customer question',
        language: typeof meta.language === 'string' ? meta.language : 'unknown',
        script: typeof meta.script === 'string' ? meta.script : undefined,
        occurredAt: occurredAtStr
      };
    });

    return { questions, total };
  }

  private calculateRate(numerator: number, denominator: number): number {
    if (!denominator || denominator <= 0) return 0;
    const raw = numerator / denominator;
    if (!Number.isFinite(raw)) return 0;
    return Number(Math.min(1, Math.max(0, raw)).toFixed(4));
  }
}
