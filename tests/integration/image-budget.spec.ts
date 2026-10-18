import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { portalDatabase } from '../helpers/portal-db';
import { PortalStore } from '../../src/portal/PortalStore';
import { IMAGE_RESERVATION_MICROS, PortalBudget } from '../../src/portal/PortalBudget';
import { validatePlan } from '../../src/portal/validation';
import { ImageCapabilityGateway } from '../../src/core/gateway/ImageCapabilityGateway';
import { ImageUnderstandingResult } from '../../packages/shared/contracts/image.contract';

const ok = (metadata?: ImageUnderstandingResult['metadata']): ImageUnderstandingResult => ({ success: true, description: 'Red sneaker', objects: ['sneaker'],
  visibleText: null, category: 'Footwear', confidence: 0.9, provider: 'gemini', model: 'gemini-2.5-flash', latencyMs: 5, error: null, metadata });

describe('image analysis settles the reservation at real provider cost', () => {
  let database: Awaited<ReturnType<typeof portalDatabase>>, store: PortalStore, budget: PortalBudget;
  beforeAll(async () => { database = await portalDatabase(); store = new PortalStore(database.db); budget = new PortalBudget(store, false); }, 60000);
  afterAll(async () => { budget?.dispose(); await database?.pg.close(); });
  async function account(limits: any = {}) {
    const owner = await store.register(randomUUID() + '@example.test', 'Images', 'hash', null);
    const plan = await store.savePlan(owner.userId, validatePlan({ name: 'Images', modules: ['knowledge', 'images'], limits: { messages: 100, images: 100, monthlyUsd: 5, ...limits } }));
    const p = await store.profile(owner.accountId);
    await store.updateAccount(owner.userId, owner.accountId, p.revision, { planId: plan.id });
    await store.db.$executeRaw`UPDATE "PortalProfile" SET status='ACTIVE' WHERE "accountId"=${owner.accountId}`;
    return owner;
  }
  async function analyse(owner: any, analyze: () => Promise<ImageUnderstandingResult>) {
    const inner = new ImageCapabilityGateway(); const spy = vi.spyOn(inner, 'analyzeImage').mockImplementation(analyze);
    const gateway = budget.wrapImages(inner);
    const result = await budget.runTurn(owner.tenantId, owner.accountId, randomUUID(),
      () => gateway.analyzeImage(owner.tenantId, { imageBase64: 'aGk=', mimeType: 'image/png' }), null).catch(error => error);
    const entries = await store.db.$queryRaw<any[]>`SELECT * FROM "PortalUsageEntry" WHERE "accountId"=${owner.accountId} AND kind='image'`;
    const bucket = (await store.db.$queryRaw<any[]>`SELECT * FROM "PortalUsageBucket" WHERE "accountId"=${owner.accountId}`)[0];
    return { result, spy, entries, bucket };
  }

  it('charges Gemini 2.5 Flash list price from the usage receipt, thinking billed as output', async () => {
    const { result, entries, bucket } = await analyse(await account(), async () => ok({ inputTokens: 1500, outputTokens: 200, thoughtsTokens: 300, billedModel: 'gemini-2.5-flash', tokenSource: 'provider' }));
    expect(result.success).toBe(true);
    // 1500 × $0.30/M + (200 + 300) × $2.50/M = 450 + 1250 micro-USD
    expect(entries[0]).toMatchObject({ status: 'COMPLETED', reservedMicros: IMAGE_RESERVATION_MICROS });
    expect(Number(entries[0].chargedMicros)).toBe(1700);
    expect(entries[0].metadata).toMatchObject({ tokenSource: 'provider', model: 'gemini-2.5-flash', knownEstimateMicros: 1700 });
    expect(entries[0].metadata.priceBasis).toContain('2.5 Flash $0.30/$2.50');
    expect(Number(bucket.spentMicros)).toBe(1700); expect(Number(bucket.reservedMicros)).toBe(0); expect(Number(bucket.images)).toBe(1);
  });
  it('uses the rates of the fallback model that actually answered', async () => {
    const { entries } = await analyse(await account(), async () => ok({ inputTokens: 1000, outputTokens: 100, billedModel: 'gemini-2.5-flash-lite', tokenSource: 'provider' }));
    expect(Number(entries[0].chargedMicros)).toBe(140); // 1000 × 0.10 + 100 × 0.40
  });
  it('keeps the whole $0.05 reservation when no usage receipt comes back', async () => {
    const { entries, bucket } = await analyse(await account(), async () => ok());
    expect(entries[0].status).toBe('UNKNOWN'); expect(Number(entries[0].chargedMicros)).toBe(IMAGE_RESERVATION_MICROS);
    expect(Number(bucket.spentMicros)).toBe(50000); expect(Number(bucket.reservedMicros)).toBe(0);
  });
  it('keeps the whole reservation when the image call crashes', async () => {
    const { result, entries } = await analyse(await account(), async () => { throw new Error('socket hang up'); });
    expect(result).toBeInstanceOf(Error);
    expect(entries[0].status).toBe('UNKNOWN'); expect(Number(entries[0].chargedMicros)).toBe(IMAGE_RESERVATION_MICROS);
  });
  it('charges nothing when the provider was never billed', async () => {
    const { entries } = await analyse(await account(), async () => ({ ...ok({ providerBilled: false }), success: false, error: 'Gemini API error (HTTP 429)' }));
    expect(entries[0].status).toBe('COMPLETED'); expect(Number(entries[0].chargedMicros)).toBe(0);
  });
  it('declines the photo without calling the service when the allowance cannot cover the ceiling', async () => {
    const { result, spy, entries } = await analyse(await account({ monthlyUsd: 0.04 }), async () => ok());
    expect(spy).not.toHaveBeenCalled(); expect(entries).toHaveLength(0);
    // A failed analysis routes the customer to the conversation's localized image fallback, not an English error.
    expect(result).toMatchObject({ success: false, error: 'ALLOWANCE_EXHAUSTED', model: 'allowance' });
  });
  it('fits about a hundred photos in the default $5 allowance at typical usage', async () => {
    const owner = await account();
    for (let i = 0; i < 100; i++) await analyse(owner, async () => ok({ inputTokens: 1300, outputTokens: 150, thoughtsTokens: 400, billedModel: 'gemini-2.5-flash', tokenSource: 'provider' }));
    const bucket = (await store.db.$queryRaw<any[]>`SELECT * FROM "PortalUsageBucket" WHERE "accountId"=${owner.accountId}`)[0];
    expect(Number(bucket.images)).toBe(100); expect(Number(bucket.spentMicros)).toBeLessThan(250000);
  }, 60000);
});
