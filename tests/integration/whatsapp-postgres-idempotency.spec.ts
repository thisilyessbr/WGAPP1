import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { prisma, pool } from '../../src/tests/testDb';
import { PostgresIdempotencyStore } from '../../src/domain/channel/whatsapp/IdempotencyStore';

describe('PHASE WHATSAPP-QUEUE-DISTRIBUTED-IDEMPOTENCY-AUDIT-IMPLEMENT-39: Postgres Distributed Idempotency Integration Tests', () => {
  let store: PostgresIdempotencyStore;

  beforeAll(async () => {
    const client = await pool.connect();
    try {
      await client.query('SET search_path TO test, public, extensions;');
    } finally {
      client.release();
    }
  });

  beforeEach(async () => {
    store = new PostgresIdempotencyStore(prisma, { defaultTtlSeconds: 3600 });
  });

  it('1. Atomically claims a new key and rejects subsequent checks', async () => {
    const key = `wamid-pg-test-${Date.now()}-${Math.random()}`;

    const first = await store.checkAndRecord(key);
    expect(first.isDuplicate).toBe(false);

    const second = await store.checkAndRecord(key);
    expect(second.isDuplicate).toBe(true);

    const isDup = await store.isDuplicate(key);
    expect(isDup).toBe(true);
  });

  it('2. Multi-instance race condition: 20 concurrent threads trying to claim same key produce exactly ONE winner', async () => {
    const raceKey = `wamid-race-${Date.now()}-${Math.random()}`;

    // Simulate 20 concurrent server instances hitting the database at the exact same millisecond
    const results = await Promise.all(
      Array.from({ length: 20 }).map(() => store.checkAndRecord(raceKey))
    );

    const winners = results.filter(r => !r.isDuplicate);
    const losers = results.filter(r => r.isDuplicate);

    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(19);
  });

  it('3. Delete removes the key and allows re-claiming', async () => {
    const key = `wamid-del-${Date.now()}`;

    await store.record(key);
    expect(await store.isDuplicate(key)).toBe(true);

    await store.delete(key);
    expect(await store.isDuplicate(key)).toBe(false);

    const recheck = await store.checkAndRecord(key);
    expect(recheck.isDuplicate).toBe(false);
  });
});
