import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { portalDatabase } from '../helpers/portal-db';
import { PortalStore } from '../../src/portal/PortalStore';
import { OperatorAlerts, OperatorFinding, DEFAULT_OPERATOR_THRESHOLDS } from '../../src/portal/OperatorAlerts';

const thresholds = { ...DEFAULT_OPERATOR_THRESHOLDS, queueLagMinutes: 5, failedDeliveries15m: 3, aiFailures10m: 5, handoffWaitMinutes: 15, spendWarnRatio: 0.8 };

describe('operator alerts', () => {
  it('reports a stuck queue, failing replies, AI outages, waiting customers and spend, once per hour', async () => {
    const database = await portalDatabase();
    try {
      const store = new PortalStore(database.db);
      const shop = await store.register(randomUUID() + '@example.test', 'Shop', 'hash', null);
      const quiet = await store.register(randomUUID() + '@example.test', 'Quiet shop', 'hash', null);
      const job = (status: string, outbound: string | null, minutesAgo: number, account = shop) => store.db.$executeRaw`INSERT INTO "WhatsAppMessageJob"
        (id,wamid,"partitionKey","tenantId","accountId","phoneNumberId","waId",message,timestamp,status,"outboundStatus","availableAt","createdAt","updatedAt")
        VALUES (${randomUUID()},${randomUUID()},'p',${account.tenantId},${account.accountId},'n','212600000001','hi',${BigInt(Date.now())},${status},${outbound},
          NOW()-(${minutesAgo} * INTERVAL '1 minute'),NOW()-(${minutesAgo} * INTERVAL '1 minute'),NOW()-(${Math.min(minutesAgo, 5)} * INTERVAL '1 minute'))`;
      await job('PENDING', 'PENDING', 12);
      for (let i = 0; i < 3; i++) await job('COMPLETED', 'FAILED', 2);
      await job('COMPLETED', 'FAILED', 2, quiet);

      const customer = randomUUID(), preview = randomUUID();
      await store.db.$executeRaw`INSERT INTO "Customer"(id,"tenantId","externalId","updatedAt") VALUES (${customer},${shop.tenantId},'212600000002',NOW())`;
      await store.db.$executeRaw`INSERT INTO "Customer"(id,"tenantId","externalId","updatedAt") VALUES (${preview},${shop.tenantId},'portal-preview:x',NOW())`;
      for (const [who, minutes] of [[customer, 40], [preview, 40], [customer, 3]] as const) {
        await store.db.$executeRaw`INSERT INTO "Conversation"(id,"tenantId","accountId","customerId",status,"humanRequested","humanRequestedAt","updatedAt")
          VALUES (${randomUUID()},${shop.tenantId},${shop.accountId},${who},'HANDOFF_REQUESTED',true,NOW()-(${minutes} * INTERVAL '1 minute'),NOW())`;
      }

      const period = new Date().toISOString().slice(0, 7);
      await store.db.$executeRaw`UPDATE "PortalProfile" SET status='ACTIVE',"planSnapshot"='{"limits":{"monthlyUsd":5}}'::jsonb WHERE "accountId" IN (${shop.accountId},${quiet.accountId})`;
      await store.db.$executeRaw`INSERT INTO "PortalUsageBucket"("accountId",period,"spentMicros") VALUES (${shop.accountId},${period},4500000)`;
      await store.db.$executeRaw`INSERT INTO "PortalUsageBucket"("accountId",period,"spentMicros") VALUES (${quiet.accountId},${period},1000000)`;

      const sent: OperatorFinding[] = [];
      const alerts = new OperatorAlerts(store, async finding => { sent.push(finding); }, thresholds);
      for (let i = 0; i < 5; i++) alerts.recordAiFailure();

      await alerts.tick();
      const keys = sent.map(f => f.key).sort();
      expect(keys).toEqual([
        'ai_failures',
        `failed_deliveries:${shop.accountId}`,
        `handoff_waiting:${shop.accountId}`,
        'queue_lag',
        `spend:${shop.accountId}:near`
      ].sort());
      expect(sent.find(f => f.key.startsWith('handoff_waiting'))?.detail).toContain('1 customer(s)');
      // Alerts never carry customer phone numbers or message text.
      expect(JSON.stringify(sent)).not.toMatch(/212600000002|"hi"/);

      await alerts.tick();
      expect(sent).toHaveLength(5);
      expect((await alerts.recent()).every(row => row.sentAt)).toBe(true);
    } finally { await database.pg.close(); }
  });

  it('keeps the alert row and records the error when delivery fails', async () => {
    const database = await portalDatabase();
    try {
      const store = new PortalStore(database.db);
      const alerts = new OperatorAlerts(store, async () => { throw new Error('webhook down'); }, { ...thresholds, aiFailures10m: 1 });
      alerts.recordAiFailure();
      await alerts.tick();
      const [row] = await alerts.recent();
      expect(row).toMatchObject({ key: 'ai_failures', sentAt: null, error: 'webhook down' });
    } finally { await database.pg.close(); }
  });

  it('forgets AI failures older than ten minutes', async () => {
    const database = await portalDatabase();
    try {
      let now = Date.now();
      const alerts = new OperatorAlerts(new PortalStore(database.db), async () => {}, { ...thresholds, aiFailures10m: 2 }, () => now);
      alerts.recordAiFailure();
      now += 11 * 60000;
      alerts.recordAiFailure();
      expect((await alerts.check()).some(f => f.key === 'ai_failures')).toBe(false);
    } finally { await database.pg.close(); }
  });
});
