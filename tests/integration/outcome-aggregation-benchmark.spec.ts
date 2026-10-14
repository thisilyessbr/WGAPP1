import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, pool } from '../../src/tests/testDb';
import { OutcomeTrackingService } from '../../src/domain/outcome/OutcomeTrackingService';
import { performance } from 'perf_hooks';

describe('Outcome Aggregation & Performance Benchmark', () => {
  let outcomeService: OutcomeTrackingService;
  let tenantId: string;
  let accountIdA: string;
  let accountIdB: string;

  beforeAll(async () => {
    outcomeService = new OutcomeTrackingService(prisma);
    tenantId = `bench-ten-${Date.now()}`;
    accountIdA = `bench-acct-a-${Date.now()}`;
    accountIdB = `bench-acct-b-${Date.now()}`;

    await prisma.tenant.create({
      data: { id: tenantId, name: 'Benchmark Tenant' }
    });

    await prisma.account.createMany({
      data: [
        { id: accountIdA, tenantId, name: 'Benchmark Account A', enabled: true },
        { id: accountIdB, tenantId, name: 'Benchmark Account B', enabled: true }
      ]
    });
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(
      `DELETE FROM "OutcomeEvent" WHERE "tenantId" = '${tenantId}'`
    );
    await prisma.account.deleteMany({ where: { tenantId } });
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
  });

  it('1. Empty dataset aggregates correctly with zeros, nulls, and bounded rates', async () => {
    const summary = await outcomeService.getAccountSummary(tenantId, accountIdA, 30);

    expect(summary.periodDays).toBe(30);
    expect(summary.leadsCreated).toBe(0);
    expect(summary.leadsQualified).toBe(0);
    expect(summary.qualificationRate).toBe(0);
    expect(summary.handoffsRequested).toBe(0);
    expect(summary.handoffsClaimed).toBe(0);
    expect(summary.handoffsResolved).toBe(0);
    expect(summary.handoffResolutionRate).toBe(0);
    expect(summary.medianTimeToClaimSeconds).toBeNull();
    expect(summary.medianTimeToResolveSeconds).toBeNull();
    expect(summary.missedQuestions).toBe(0);
    expect(summary.resolvedMissedQuestions).toBe(0);
    expect(summary.missedQuestionResolutionRate).toBe(0);
    expect(summary.confirmedBookings).toBe(0);
    expect(summary.confirmedOrders).toBe(0);
    expect(summary.confirmedOrderValueByCurrency).toEqual({});
  });

  it('2. Seeds 1,500+ events and verifies PostgreSQL aggregation accuracy, speed, and memory', async () => {
    const now = new Date();
    const rows: string[] = [];

    // 300 LEAD_CREATED
    for (let i = 0; i < 300; i++) {
      rows.push(`('${tenantId}', '${accountIdA}', 'LEAD_CREATED', 'CRM', 'lead-created-${i}', '{}', '${now.toISOString()}')`);
    }

    // 120 LEAD_QUALIFIED (rate = 120/300 = 0.4)
    for (let i = 0; i < 120; i++) {
      rows.push(`('${tenantId}', '${accountIdA}', 'LEAD_QUALIFIED', 'CRM', 'lead-qual-${i}', '{}', '${now.toISOString()}')`);
    }

    // 200 HANDOFF_REQUESTED
    for (let i = 0; i < 200; i++) {
      rows.push(`('${tenantId}', '${accountIdA}', 'HANDOFF_REQUESTED', 'HANDOFF', 'req-${i}', '{}', '${now.toISOString()}')`);
    }

    // 150 HANDOFF_CLAIMED with known claim times: 10s, 20s, 30s, 40s, 50s (median = 30s)
    // Also include a few with corrupted / missing duration metadata to test robustness
    const claimTimesMs = [10000, 20000, 30000, 40000, 50000];
    for (let i = 0; i < 150; i++) {
      const ms = claimTimesMs[i % claimTimesMs.length];
      const meta = i === 0 ? '{"timeFromRequestToClaimMs": "not-a-number"}' : JSON.stringify({ timeFromRequestToClaimMs: ms });
      rows.push(`('${tenantId}', '${accountIdA}', 'HANDOFF_CLAIMED', 'PORTAL', 'claim-${i}', '${meta}', '${now.toISOString()}')`);
    }

    // 100 HANDOFF_RESOLVED with known resolution times: 60s, 120s, 180s (median = 120s)
    // Resolution rate = 100 / 200 = 0.5
    const resolveTimesMs = [60000, 120000, 180000];
    for (let i = 0; i < 100; i++) {
      const ms = resolveTimesMs[i % resolveTimesMs.length];
      rows.push(`('${tenantId}', '${accountIdA}', 'HANDOFF_RESOLVED', 'PORTAL', 'resolve-${i}', '${JSON.stringify({ totalResolutionTimeMs: ms })}', '${now.toISOString()}')`);
    }

    // 250 QUESTION_MISSED
    const missedIds: string[] = [];
    for (let i = 0; i < 250; i++) {
      const qId = `missed-bench-id-${i}`;
      missedIds.push(qId);
      rows.push(`('${tenantId}', '${accountIdA}', 'QUESTION_MISSED', 'CHATBOT_SIGNAL', 'qmiss-${i}', '{"question": "Bench question ${i}"}', '${now.toISOString()}', '${qId}')`);
    }

    // 100 QUESTION_RESOLVED linked to the first 100 missed questions
    for (let i = 0; i < 100; i++) {
      rows.push(`('${tenantId}', '${accountIdA}', 'QUESTION_RESOLVED', 'MERCHANT', 'qres-${i}', '{"resolvedBy": "bench"}', '${now.toISOString()}', gen_random_uuid()::text, '${missedIds[i]}')`);
    }

    // 80 BOOKING_CONFIRMED
    for (let i = 0; i < 80; i++) {
      rows.push(`('${tenantId}', '${accountIdA}', 'BOOKING_CONFIRMED', 'WORKFLOW', 'book-${i}', '{}', '${now.toISOString()}')`);
    }

    // 300 ORDER_CONFIRMED across 3 currencies:
    // 100 * 100.00 MAD = 10,000.00 MAD
    // 100 * 50.00 USD = 5,000.00 USD
    // 100 * 25.00 EUR = 2,500.00 EUR
    for (let i = 0; i < 100; i++) {
      rows.push(`('${tenantId}', '${accountIdA}', 'ORDER_CONFIRMED', 'WORKFLOW', 'ord-mad-${i}', '{}', '${now.toISOString()}', gen_random_uuid()::text, NULL, 100.00, 'MAD')`);
      rows.push(`('${tenantId}', '${accountIdA}', 'ORDER_CONFIRMED', 'WORKFLOW', 'ord-usd-${i}', '{}', '${now.toISOString()}', gen_random_uuid()::text, NULL, 50.00, 'USD')`);
      rows.push(`('${tenantId}', '${accountIdA}', 'ORDER_CONFIRMED', 'WORKFLOW', 'ord-eur-${i}', '{}', '${now.toISOString()}', gen_random_uuid()::text, NULL, 25.00, 'EUR')`);
    }

    // Batch insert into OutcomeEvent
    const batchSize = 300;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      await pool.query(`
        INSERT INTO "OutcomeEvent" (
          "tenantId", "accountId", type, source, "idempotencyKey", metadata, "occurredAt", id, "relatedOutcomeId", value, currency
        ) VALUES ${batch.map(r => {
          // Adjust for optional fields if not specified in basic tuple
          const parts = r.slice(1, -1).split(', ');
          const tId = parts[0];
          const aId = parts[1];
          const type = parts[2];
          const source = parts[3];
          const key = parts[4];
          const meta = parts[5];
          const occurred = parts[6];
          const id = parts[7] || 'gen_random_uuid()::text';
          const relId = parts[8] || 'NULL';
          const val = parts[9] || 'NULL';
          const curr = parts[10] || 'NULL';
          return `(${tId}, ${aId}, ${type}, ${source}, ${key}, ${meta}::jsonb, ${occurred}::timestamptz, ${id}, ${relId}, ${val}, ${curr})`;
        }).join(',\n')}
      `);
    }

    // Benchmark getAccountSummary execution time and heap
    if (global.gc) global.gc();
    const heapBefore = process.memoryUsage().heapUsed;
    const start = performance.now();

    const summary = await outcomeService.getAccountSummary(tenantId, accountIdA, 30);

    const durationMs = performance.now() - start;
    const heapAfter = process.memoryUsage().heapUsed;
    const heapDeltaMb = (heapAfter - heapBefore) / (1024 * 1024);

    // Performance assertion: SQL aggregation should be very fast (< 100ms) and low memory delta
    expect(durationMs).toBeLessThan(500); // Generous upper bound for CI test runners
    expect(heapDeltaMb).toBeLessThan(10); // Node heap should not spike

    // Accuracy assertions
    expect(summary.leadsCreated).toBe(300);
    expect(summary.leadsQualified).toBe(120);
    expect(summary.qualificationRate).toBe(0.4);
    expect(summary.handoffsRequested).toBe(200);
    expect(summary.handoffsClaimed).toBe(150);
    expect(summary.handoffsResolved).toBe(100);
    expect(summary.handoffResolutionRate).toBe(0.5);

    // Median assertions: claimTimes = [10, 20, 30, 40, 50] -> median 30s
    expect(summary.medianTimeToClaimSeconds).toBeCloseTo(30, 1);
    // Median assertions: resolveTimes = [60, 120, 180] -> median 120s
    expect(summary.medianTimeToResolveSeconds).toBeCloseTo(120, 1);

    expect(summary.missedQuestions).toBe(250);
    expect(summary.resolvedMissedQuestions).toBe(100);
    expect(summary.missedQuestionResolutionRate).toBe(0.4);

    expect(summary.confirmedBookings).toBe(80);
    expect(summary.confirmedOrders).toBe(300);

    // Currencies breakdown
    expect(summary.confirmedOrderValueByCurrency.MAD).toBe(10000);
    expect(summary.confirmedOrderValueByCurrency.USD).toBe(5000);
    expect(summary.confirmedOrderValueByCurrency.EUR).toBe(2500);

    // Rate bounds
    expect(summary.qualificationRate).toBeGreaterThanOrEqual(0);
    expect(summary.qualificationRate).toBeLessThanOrEqual(1);
    expect(summary.handoffResolutionRate).toBeGreaterThanOrEqual(0);
    expect(summary.handoffResolutionRate).toBeLessThanOrEqual(1);
    expect(summary.missedQuestionResolutionRate).toBeGreaterThanOrEqual(0);
    expect(summary.missedQuestionResolutionRate).toBeLessThanOrEqual(1);
  });

  it('3. Benchmark getUnresolvedMissedQuestions with SQL NOT EXISTS', async () => {
    const start = performance.now();
    const result = await outcomeService.getUnresolvedMissedQuestions(tenantId, accountIdA, 30, 20, 0);
    const durationMs = performance.now() - start;

    expect(durationMs).toBeLessThan(200);
    // 250 missed - 100 resolved = 150 unresolved
    expect(result.total).toBe(150);
    expect(result.questions.length).toBe(20);
    expect(result.questions[0].question).toContain('Bench question');
  });

  it('4. Benchmark getAdminSummary across accounts and verify filtering', async () => {
    // Seed some events for account B as well
    await pool.query(`
      INSERT INTO "OutcomeEvent" (id, "tenantId", "accountId", type, source, "idempotencyKey", "occurredAt")
      VALUES
        (gen_random_uuid()::text, '${tenantId}', '${accountIdB}', 'LEAD_CREATED', 'CRM', 'b-lead-1', NOW()),
        (gen_random_uuid()::text, '${tenantId}', '${accountIdB}', 'QUESTION_MISSED', 'CHATBOT_SIGNAL', 'b-q-1', NOW());
    `);

    // Global admin summary
    const adminStart = performance.now();
    const adminSummary = await outcomeService.getAdminSummary(30);
    const adminDurationMs = performance.now() - adminStart;

    expect(adminDurationMs).toBeLessThan(1500);
    expect(adminSummary.totals.leadsCreated).toBeGreaterThanOrEqual(301); // 300 from A + 1 from B

    // Filtered admin summary
    const filteredSummary = await outcomeService.getAdminSummary(30, accountIdA);
    expect(filteredSummary.totals.leadsCreated).toBe(300);
  });
});
