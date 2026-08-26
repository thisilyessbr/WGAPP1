import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '../../src/tests/testDb';
import { bootstrapChatbot } from '../../src/bootstrap';

describe('PHASE DEV-TEST-44E: Disposable Consultation Demo Tenant Verification', () => {
  const tenantId = 'consultation-demo';
  const accountId = 'consultation-demo-account';
  let deps: ReturnType<typeof bootstrapChatbot>;

  beforeAll(async () => {
    deps = bootstrapChatbot(prisma);
  });

  it('1. Tenant and Account exist with ecommerceEnabled = false', async () => {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    expect(tenant).not.toBeNull();

    const account = await prisma.account.findUnique({ where: { id: accountId } });
    expect(account).not.toBeNull();

    const config = await deps.accountConfigService!.getEffectiveConfig(tenantId, accountId);
    expect(config.capabilities?.ecommerceEnabled).toBe(false);
    expect(config.identity?.brand).toBe('Consultation Demo');
  });

  it('2. 12 localized FAQ entries exist and are loaded in config', async () => {
    const config = await deps.accountConfigService!.getEffectiveConfig(tenantId, accountId);
    expect(config.capabilities?.faq).toBeDefined();
    expect(config.capabilities.faq?.length).toBe(12);

    const categories = config.capabilities.faq?.map(f => f.category);
    expect(categories).toContain('services');
    expect(categories).toContain('duration');
    expect(categories).toContain('pricing');
    expect(categories).toContain('cancellation');
    expect(categories).toContain('hours');
  });

  it('3. 4 Knowledge PDF documents are ingested and scoped to consultation-demo', async () => {
    const sources = await prisma.knowledgeSource.findMany({
      where: { tenantId }
    });
    // 4 PDFs + 1 FAQ source = 5 sources
    expect(sources.length).toBeGreaterThanOrEqual(4);

    const chunks = await prisma.knowledgeChunk.findMany({
      where: { tenantId }
    });
    expect(chunks.length).toBeGreaterThanOrEqual(16); // 4 PDFs + 12 FAQs
  });

  it('4. Consultation booking workflow is configured with all 8 states and fields', async () => {
    const config = await deps.accountConfigService!.getEffectiveConfig(tenantId, accountId);
    expect(config.workflows).toBeDefined();
    expect(config.workflows?.consultation_booking).toBeDefined();

    const wf = config.workflows.consultation_booking;
    expect(wf.initialState).toBe('collect_name');
    expect(Object.keys(wf.states).length).toBe(8);

    // Verify fields
    expect((wf.states.collect_name.field as any)?.name).toBe('name');
    expect((wf.states.collect_phone.field as any)?.name).toBe('phone');
    expect((wf.states.collect_email.field as any)?.name).toBe('email');
    expect((wf.states.collect_topic.field as any)?.name).toBe('consultation_topic');
    expect((wf.states.collect_date.field as any)?.name).toBe('preferred_date');
    expect((wf.states.collect_time.field as any)?.name).toBe('preferred_time');
    expect(wf.states.confirm_booking.type).toBe('confirm');
    expect(wf.states.booking_complete.type).toBe('end');
  });

  it('5. Tenant isolation: animeverse products and consultation-demo are strictly isolated', async () => {
    const animeverseProducts = await prisma.product.findMany({
      where: { tenantId: 'animeverse' }
    });
    expect(animeverseProducts.length).toBeGreaterThan(0);

    const consultProducts = await prisma.product.findMany({
      where: { tenantId }
    });
    expect(consultProducts.length).toBe(0); // Consultation tenant has 0 products
  });
});
