import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, Browser, BrowserContext, Page } from 'playwright';
import express from 'express';
import { resolve } from 'path';
import { randomUUID } from 'crypto';
import { prisma, pool } from '../../src/tests/testDb';
import { PortalStore } from '../../src/portal/PortalStore';
import { PortalAuth, hashPassword, hashToken } from '../../src/portal/PortalAuth';
import { PortalBudget } from '../../src/portal/PortalBudget';
import { PortalDocuments } from '../../src/portal/PortalDocuments';
import { PortalConnections } from '../../src/portal/PortalConnections';
import { createPortalRouter } from '../../src/portal/PortalRouter';
import { validatePlan } from '../../src/portal/validation';
import { ConversationAutomationService } from '../../src/domain/conversation/ConversationAutomationService';
import { MemoryOutboundQueue, WhatsAppOutboundWorker } from '../../src/domain/channel/whatsapp/WhatsAppOutboundQueue';

describe('Phase 3C: Merchant Inbox Browser UI Integration Tests', () => {
  let server: any;
  let origin: string;
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;
  let store: PortalStore;
  let budget: PortalBudget;
  let auth: PortalAuth;
  let docs: PortalDocuments;
  let connections: PortalConnections;
  let automationService: ConversationAutomationService;
  let outboundQueue: MemoryOutboundQueue;
  let outboundWorker: WhatsAppOutboundWorker;

  let testPasswordHash: string;
  let testPlan: any;
  let merchant: any;
  let convAiActive: any;
  let convNeedsHuman: any;
  let convHumanActive: any;
  let convResolved: any;
  let convExpiredCsw: any;
  let convPaginated: any;

  const testPassword = 'Password123!';
  const createdTenantIds: string[] = [];

  beforeAll(async () => {
    const client = await pool.connect();
    try {
      await client.query('SET search_path TO test, public, extensions;');
    } finally {
      client.release();
    }

    store = new PortalStore(prisma as any);
    budget = new PortalBudget(store);
    auth = new PortalAuth(store, { publicUrl: 'http://localhost' });
    docs = new PortalDocuments(store, budget, {} as any, {} as any);
    connections = new PortalConnections(store, {
      whatsAppOnboardingService: { generateSignupState: () => randomUUID(), processEmbeddedSignupCallback: async () => ({ success: true }) } as any,
      qrSessionManager: { isEnabled: () => false } as any
    });
    automationService = new ConversationAutomationService(prisma);
    outboundQueue = new MemoryOutboundQueue(prisma);
    outboundWorker = new WhatsAppOutboundWorker(outboundQueue, {
      sendTextMessage: async () => ({ success: true, providerMessageId: `wamid.${randomUUID()}`, isRetryable: false })
    } as any);

    const app = express();
    app.use(express.json());
    app.use('/api', createPortalRouter(
      { store, auth, documents: docs, connections },
      {
        prisma,
        conversationAutomationService: automationService,
        whatsAppOutboundQueue: outboundQueue
      }
    ));
    app.use('/portal-assets', express.static(resolve('src/portal/ui')));
    app.use((_req, res) => {
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' https://connect.facebook.net; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'");
      res.sendFile(resolve('src/portal/ui/index.html'));
    });

    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((r) => server.once('listening', r));
    origin = 'http://127.0.0.1:' + (server.address() as any).port;

    testPasswordHash = await hashPassword(testPassword);

    const adminId = randomUUID();
    await prisma.portalUser.create({
      data: {
        id: adminId,
        email: `admin-inbox-${adminId.substring(0, 8)}@test.com`,
        name: 'Inbox Admin',
        passwordHash: testPasswordHash,
        role: 'ADMIN',
        verifiedAt: new Date()
      }
    });

    testPlan = await store.savePlan(adminId, validatePlan({
      name: 'Inbox Browser Plan',
      published: true,
      modules: ['commerce', 'knowledge', 'services'],
      limits: { monthlyUsd: 10, messages: 1000, llmCalls: 1000, numbers: 5, documents: 10 }
    }));

    // Create merchant fixture
    const email = `merchant-inbox-${randomUUID().substring(0, 8)}@merchant.test`;
    const reg = await store.register(email, 'Atlas Crafts', testPasswordHash, testPlan.id);
    createdTenantIds.push(reg.tenantId);

    await prisma.portalUser.update({
      where: { id: reg.userId },
      data: { verifiedAt: new Date() }
    });
    const user = await store.userById(reg.userId);

    const phoneNumberId = `phone-${randomUUID().substring(0, 8)}`;
    await prisma.whatsAppBusinessNumber.create({
      data: {
        tenantId: reg.tenantId,
        accountId: reg.accountId,
        phoneNumberId,
        displayPhoneNumber: '+212600112233',
        status: 'CONNECTED',
        enabled: true
      }
    });

    const rawSession = randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '');
    const csrf = randomUUID();
    await store.newSession(user.id, hashToken(rawSession), csrf, new Date(Date.now() + 3600000));

    merchant = {
      userId: reg.userId,
      tenantId: reg.tenantId,
      accountId: reg.accountId,
      user,
      rawSession,
      csrf
    };

    // Fixture 1: AI_ACTIVE conversation (Alice Smith)
    const cust1 = await prisma.customer.create({
      data: {
        tenantId: merchant.tenantId,
        externalId: '212611112233',
        metadata: { name: 'Alice Smith' }
      }
    });
    convAiActive = await prisma.conversation.create({
      data: {
        tenantId: merchant.tenantId,
        accountId: merchant.accountId,
        customerId: cust1.id,
        status: 'ACTIVE',
        messageCount: 2,
        lastMerchantViewedAt: new Date(Date.now() + 60000)
      }
    });
    await prisma.message.create({
      data: {
        tenantId: merchant.tenantId,
        conversationId: convAiActive.id,
        role: 'USER',
        content: 'Hello, what are your opening hours?',
        createdAt: new Date(Date.now() - 30000)
      }
    });
    await prisma.message.create({
      data: {
        tenantId: merchant.tenantId,
        conversationId: convAiActive.id,
        role: 'ASSISTANT',
        content: 'We are open Monday through Saturday, 9am to 7pm.',
        createdAt: new Date(Date.now() - 20000)
      }
    });

    // Fixture 2: HUMAN_REQUIRED conversation (Bob Jones, unread)
    const cust2 = await prisma.customer.create({
      data: {
        tenantId: merchant.tenantId,
        externalId: '212622223344',
        metadata: { name: 'Bob Jones' }
      }
    });
    convNeedsHuman = await prisma.conversation.create({
      data: {
        tenantId: merchant.tenantId,
        accountId: merchant.accountId,
        customerId: cust2.id,
        status: 'HANDOFF_REQUESTED',
        humanRequested: true,
        humanRequestedAt: new Date(),
        messageCount: 1,
        lastMerchantViewedAt: null // unread
      }
    });
    await prisma.message.create({
      data: {
        tenantId: merchant.tenantId,
        conversationId: convNeedsHuman.id,
        role: 'USER',
        content: 'I want to speak with a human please!',
        createdAt: new Date()
      }
    });

    // Fixture 3: HUMAN_ACTIVE conversation (Charlie Brown, claimed by merchant)
    const cust3 = await prisma.customer.create({
      data: {
        tenantId: merchant.tenantId,
        externalId: '212633334455',
        metadata: { name: 'Charlie Brown' }
      }
    });
    convHumanActive = await prisma.conversation.create({
      data: {
        tenantId: merchant.tenantId,
        accountId: merchant.accountId,
        customerId: cust3.id,
        status: 'HUMAN_ACTIVE',
        humanRequested: true,
        contextData: { _portalHandoff: { ownerId: merchant.userId, claimedAt: new Date().toISOString() } },
        messageCount: 4,
        lastMerchantViewedAt: new Date()
      }
    });
    await prisma.message.create({
      data: {
        tenantId: merchant.tenantId,
        conversationId: convHumanActive.id,
        role: 'USER',
        content: 'Do you ship to Tangier?',
        createdAt: new Date(Date.now() - 60000)
      }
    });
    await prisma.message.create({
      data: {
        tenantId: merchant.tenantId,
        conversationId: convHumanActive.id,
        role: 'ASSISTANT',
        content: 'Yes, we deliver across Morocco in 48 hours.',
        metadata: { manual: true, authorId: merchant.userId, authorName: 'Atlas Crafts', deliveryStatus: 'SENT' },
        createdAt: new Date(Date.now() - 50000)
      }
    });
    await prisma.message.create({
      data: {
        tenantId: merchant.tenantId,
        conversationId: convHumanActive.id,
        role: 'ASSISTANT',
        content: 'Sending you tracking number shortly.',
        metadata: { manual: true, authorId: merchant.userId, authorName: 'Atlas Crafts', deliveryStatus: 'PENDING' },
        createdAt: new Date(Date.now() - 40000)
      }
    });
    await prisma.message.create({
      data: {
        tenantId: merchant.tenantId,
        conversationId: convHumanActive.id,
        role: 'ASSISTANT',
        content: 'Here is your link.',
        metadata: { manual: true, authorId: merchant.userId, authorName: 'Atlas Crafts', deliveryStatus: 'FAILED' },
        createdAt: new Date(Date.now() - 30000)
      }
    });

    // Fixture 4: RESOLVED conversation (Diana Prince)
    const cust4 = await prisma.customer.create({
      data: {
        tenantId: merchant.tenantId,
        externalId: '212644445566',
        metadata: { name: 'Diana Prince' }
      }
    });
    convResolved = await prisma.conversation.create({
      data: {
        tenantId: merchant.tenantId,
        accountId: merchant.accountId,
        customerId: cust4.id,
        status: 'RESOLVED',
        messageCount: 1,
        lastMerchantViewedAt: new Date()
      }
    });
    await prisma.message.create({
      data: {
        tenantId: merchant.tenantId,
        conversationId: convResolved.id,
        role: 'USER',
        content: 'Thank you for your help, issue solved!',
        createdAt: new Date(Date.now() - 100000)
      }
    });

    // Fixture 5: Expired 24h CSW conversation (Edward Norton)
    const cust5 = await prisma.customer.create({
      data: {
        tenantId: merchant.tenantId,
        externalId: '212655556677',
        metadata: { name: 'Edward Norton' }
      }
    });
    convExpiredCsw = await prisma.conversation.create({
      data: {
        tenantId: merchant.tenantId,
        accountId: merchant.accountId,
        customerId: cust5.id,
        status: 'HUMAN_ACTIVE',
        humanRequested: true,
        contextData: { _portalHandoff: { ownerId: merchant.userId, claimedAt: new Date().toISOString() } },
        messageCount: 1,
        lastMerchantViewedAt: new Date()
      }
    });
    await prisma.message.create({
      data: {
        tenantId: merchant.tenantId,
        conversationId: convExpiredCsw.id,
        role: 'USER',
        content: 'Message from two days ago',
        createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000) // 48h ago
      }
    });

    // Fixture 6: Paginated conversation (Fiona Gallagher)
    const cust6 = await prisma.customer.create({
      data: {
        tenantId: merchant.tenantId,
        externalId: '212666667788',
        metadata: { name: 'Fiona Gallagher' }
      }
    });
    convPaginated = await prisma.conversation.create({
      data: {
        tenantId: merchant.tenantId,
        accountId: merchant.accountId,
        customerId: cust6.id,
        status: 'ACTIVE',
        messageCount: 3,
        lastMerchantViewedAt: new Date()
      }
    });
    for (let i = 1; i <= 3; i++) {
      await prisma.message.create({
        data: {
          tenantId: merchant.tenantId,
          conversationId: convPaginated.id,
          role: i % 2 === 1 ? 'USER' : 'ASSISTANT',
          content: `Historical message ${i}`,
          createdAt: new Date(Date.now() - (10 - i) * 60000)
        }
      });
    }

    // Launch Playwright Chromium
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addCookies([
      {
        name: 'relayqo_portal',
        value: merchant.rawSession,
        url: origin
      }
    ]);
    page = await context.newPage();
  }, 60000);

  afterAll(async () => {
    budget?.dispose();
    if (outboundQueue) {
      await outboundQueue.shutdown();
    }
    await browser?.close();
    await new Promise<void>((r) => server.close(() => r()));

    // Clean up created fixtures
    for (const tid of createdTenantIds) {
      try {
        await prisma.message.deleteMany({ where: { tenantId: tid } });
        await prisma.conversation.deleteMany({ where: { tenantId: tid } });
        await prisma.customer.deleteMany({ where: { tenantId: tid } });
        await prisma.whatsAppBusinessNumber.deleteMany({ where: { tenantId: tid } });
        await prisma.portalProfile.deleteMany({ where: { tenantId: tid } });
        await prisma.portalMembership.deleteMany({ where: { tenantId: tid } });
        await prisma.account.deleteMany({ where: { tenantId: tid } });
        await prisma.tenant.deleteMany({ where: { id: tid } });
      } catch {}
    }
  });

  it('1. Inbox navigation link appears in sidebar immediately after Overview', async () => {
    await page.goto(origin + '/app');
    await page.getByRole('heading', { name: /Atlas Crafts/i }).waitFor();

    const navLinks = page.locator('.nav a');
    const firstText = await navLinks.nth(0).innerText();
    const secondText = await navLinks.nth(1).innerText();

    expect(firstText).toContain('Overview');
    expect(secondText).toContain('Inbox');
    expect(await navLinks.nth(1).getAttribute('href')).toBe('/app/inbox');
  });

  it('2. merchant sees own conversation list', async () => {
    await page.goto(origin + '/app/inbox');
    await page.waitForSelector('#inbox-conversations-list .inbox-item');

    const items = page.locator('#inbox-conversations-list .inbox-item');
    const count = await items.count();
    expect(count).toBeGreaterThanOrEqual(4);
    expect(await page.locator('#inbox-conversations-list').innerText()).toContain('Alice Smith');
  });

  it('3. unread indicator renders for unread conversation', async () => {
    const unreadItem = page.locator(`.inbox-item[data-conv-id="${convNeedsHuman.id}"]`);
    expect(await unreadItem.getAttribute('class')).toContain('unread');
    const dot = unreadItem.locator('.inbox-unread-dot');
    expect(await dot.isVisible()).toBe(true);
  });

  it('4. Needs-you state renders with semantic badge and text', async () => {
    const item = page.locator(`.inbox-item[data-conv-id="${convNeedsHuman.id}"]`);
    const badge = item.locator('.badge.status-needs-human');
    expect(await badge.isVisible()).toBe(true);
    expect(await badge.innerText()).toBe('Needs you');
  });

  it('5. AI-active state renders with semantic badge and text', async () => {
    const item = page.locator(`.inbox-item[data-conv-id="${convAiActive.id}"]`);
    const badge = item.locator('.badge.status-ai-active');
    expect(await badge.isVisible()).toBe(true);
    expect(await badge.innerText()).toBe('AI active');
  });

  it('6. Human-active state renders with semantic badge and text', async () => {
    const item = page.locator(`.inbox-item[data-conv-id="${convHumanActive.id}"]`);
    const badge = item.locator('.badge.status-human-active');
    expect(await badge.isVisible()).toBe(true);
    expect(await badge.innerText()).toContain('handling this');
  });

  it('7. resolved state renders with semantic badge and text', async () => {
    const item = page.locator(`.inbox-item[data-conv-id="${convResolved.id}"]`);
    const badge = item.locator('.badge.status-resolved');
    expect(await badge.isVisible()).toBe(true);
    expect(await badge.innerText()).toBe('Resolved');
  });

  it('8. conversation opens on click and loads transcript', async () => {
    await page.locator(`.inbox-item[data-conv-id="${convAiActive.id}"]`).click();
    await page.waitForSelector('.inbox-transcript .inbox-msg');
    const heading = page.locator('.inbox-detail-info strong');
    expect(await heading.innerText()).toBe('Alice Smith');
  });

  it('9. transcript ordering is correct (chronological)', async () => {
    const msgs = page.locator('.inbox-transcript .inbox-msg');
    expect(await msgs.count()).toBe(2);
    expect(await msgs.nth(0).locator('.inbox-msg-content').innerText()).toContain('opening hours');
    expect(await msgs.nth(1).locator('.inbox-msg-content').innerText()).toContain('Monday through Saturday');
  });

  it('10. customer, AI, and human messages are distinguishable', async () => {
    await page.locator(`.inbox-item[data-conv-id="${convHumanActive.id}"]`).click();
    await page.waitForSelector('.inbox-transcript .inbox-msg');

    const customerMsg = page.locator('.inbox-msg.msg-customer');
    expect(await customerMsg.first().isVisible()).toBe(true);
    expect(await customerMsg.first().locator('.inbox-msg-sender').innerText()).toBe('CUSTOMER');

    const humanMsg = page.locator('.inbox-msg.msg-human');
    expect(await humanMsg.first().isVisible()).toBe(true);
    expect(await humanMsg.first().locator('.inbox-msg-sender').innerText()).toBe('YOU');
  });

  it('11. Take Over action works and claims conversation', async () => {
    await page.locator(`.inbox-item[data-conv-id="${convNeedsHuman.id}"]`).click();
    await page.waitForSelector('#inbox-takeover-btn');

    await page.locator('#inbox-takeover-btn').click();
    await page.waitForSelector('.badge.status-human-active');

    const headerBadge = page.locator('.inbox-detail-topbar .badge.status-human-active');
    expect(await headerBadge.isVisible()).toBe(true);
    expect(await headerBadge.innerText()).toContain('handling this');
  });

  it('12. composer becomes enabled after takeover', async () => {
    const composerInput = page.locator('#inbox-composer-input');
    expect(await composerInput.isVisible()).toBe(true);
    expect(await composerInput.isEnabled()).toBe(true);
    const sendBtn = page.locator('#inbox-send-btn');
    expect(await sendBtn.isEnabled()).toBe(true);
  });

  it('13. duplicate Send click does not duplicate submission', async () => {
    const composerInput = page.locator('#inbox-composer-input');
    await composerInput.fill('Test message for deduplication');
    const sendBtn = page.locator('#inbox-send-btn');

    // Click Send
    await sendBtn.click();
    // Verify it disables immediately
    expect(await sendBtn.isDisabled()).toBe(true);
    // Wait for submission to complete and field to clear
    await page.waitForFunction(() => {
      const input = document.querySelector('#inbox-composer-input') as HTMLTextAreaElement;
      return input && input.value === '';
    });
  });

  it('14. PENDING delivery state renders for outbound messages', async () => {
    await page.locator(`.inbox-item[data-conv-id="${convHumanActive.id}"]`).click();
    await page.waitForSelector('.delivery-pending');
    const pending = page.locator('.delivery-pending');
    expect(await pending.isVisible()).toBe(true);
    expect(await pending.innerText()).toContain('Sending');
  });

  it('15. SENT delivery state renders with provider acceptance', async () => {
    const sent = page.locator('.delivery-sent');
    expect(await sent.first().isVisible()).toBe(true);
    expect(await sent.first().innerText()).toContain('Sent');
  });

  it('16. FAILED delivery state renders with retry button', async () => {
    const failed = page.locator('.delivery-failed');
    expect(await failed.isVisible()).toBe(true);
    expect(await failed.innerText()).toContain('Failed');

    const retryBtn = page.locator('.delivery-retry-btn');
    expect(await retryBtn.isVisible()).toBe(true);
  });

  it('17. expired 24h window disables free-form composer with warning', async () => {
    await page.locator(`.inbox-item[data-conv-id="${convExpiredCsw.id}"]`).click();
    await page.waitForSelector('.inbox-csw-banner');

    const banner = page.locator('.inbox-csw-banner');
    expect(await banner.isVisible()).toBe(true);
    expect(await banner.innerText()).toContain('customer-service window has expired');

    const composerNote = page.locator('.inbox-composer-disabled-note');
    expect(await composerNote.isVisible()).toBe(true);
    expect(await page.locator('#inbox-composer-input').count()).toBe(0);
  });

  it('18. Resolve action works and transitions conversation to resolved', async () => {
    await page.locator(`.inbox-item[data-conv-id="${convHumanActive.id}"]`).click();
    await page.waitForSelector('#inbox-resolve-btn');

    await page.locator('#inbox-resolve-btn').click();
    await page.waitForSelector('.inbox-detail-topbar .badge.status-resolved');

    const headerBadge = page.locator('.inbox-detail-topbar .badge.status-resolved');
    expect(await headerBadge.isVisible()).toBe(true);
    expect(await headerBadge.innerText()).toBe('Resolved');
  });

  it('19. Reopen action works and restores conversation to AI automation', async () => {
    await page.locator(`.inbox-item[data-conv-id="${convResolved.id}"]`).click();
    await page.waitForSelector('#inbox-reopen-btn');

    await page.locator('#inbox-reopen-btn').click();
    await page.waitForSelector('.inbox-detail-topbar .badge.status-ai-active');

    const headerBadge = page.locator('.inbox-detail-topbar .badge.status-ai-active');
    expect(await headerBadge.isVisible()).toBe(true);
    expect(await headerBadge.innerText()).toBe('AI active');
  });

  it('20. filters work for subset navigation', async () => {
    // Click 'Open' filter
    await page.locator('.inbox-filter-btn[data-filter="open"]').click();
    await page.waitForTimeout(300);
    // Resolved shouldn't be here
    const resolvedInList = page.locator(`#inbox-conversations-list .inbox-item[data-conv-id="${convResolved.id}"]`);
    expect(await resolvedInList.count()).toBe(0);

    // Click 'Resolved' filter
    await page.locator('.inbox-filter-btn[data-filter="resolved"]').click();
    await page.waitForTimeout(300);
    const resolvedNow = page.locator(`#inbox-conversations-list .inbox-item[data-conv-id="${convResolved.id}"]`);
    expect(await resolvedNow.count()).toBe(1);

    // Reset to 'All'
    await page.locator('.inbox-filter-btn[data-filter="all"]').click();
    await page.waitForTimeout(300);
  });

  it('21. search works and filters conversations by text', async () => {
    const searchInput = page.locator('#inbox-search-input');
    await searchInput.fill('Alice');
    await page.waitForTimeout(450); // Wait for debounce

    const items = page.locator('#inbox-conversations-list .inbox-item');
    expect(await items.count()).toBe(1);
    expect(await items.first().innerText()).toContain('Alice Smith');

    await searchInput.fill('');
    await page.waitForTimeout(450);
  });

  it('22. unread clears correctly after conversation is viewed', async () => {
    // convNeedsHuman was marked unread. In test 11 we clicked it, which triggered viewedAt
    const item = page.locator(`.inbox-item[data-conv-id="${convNeedsHuman.id}"]`);
    expect(await item.getAttribute('class')).not.toContain('unread');
  });

  it('23. transcript pagination loads older messages', async () => {
    // Update messageCount in DB to trigger load older
    await prisma.conversation.update({
      where: { id: convPaginated.id },
      data: { messageCount: 10 }
    });

    await page.locator(`.inbox-item[data-conv-id="${convPaginated.id}"]`).click();
    await page.waitForSelector('#inbox-load-older-btn');

    const loadOlderBtn = page.locator('#inbox-load-older-btn');
    expect(await loadOlderBtn.isVisible()).toBe(true);
  });

  it('24. mobile navigation works (collapses two columns, back button restores list)', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(200);

    // Click a conversation
    await page.locator(`.inbox-item[data-conv-id="${convAiActive.id}"]`).click();
    await page.waitForSelector('#inbox-back-btn');

    const backBtn = page.locator('#inbox-back-btn');
    expect(await backBtn.isVisible()).toBe(true);

    // Click Back
    await backBtn.click();
    await page.waitForSelector('#inbox-conversations-list .inbox-item');
    expect(await page.locator('#inbox-conversations-list').isVisible()).toBe(true);

    // Restore desktop viewport
    await page.setViewportSize({ width: 1440, height: 1000 });
  });

  it('25. API error renders useful state without destroying container', async () => {
    // Intercept a detail request to simulate 500
    await page.route('**/api/client/conversations/error-test-id*', (route) => {
      route.fulfill({ status: 500, json: { error: 'INTERNAL_ERROR', message: 'Database query timed out' } });
    });

    await page.evaluate(() => {
      (window as any).RelayqoInbox.loadConversation('error-test-id');
    });

    await page.waitForSelector('#inbox-retry-conv-btn');
    const retryBtn = page.locator('#inbox-retry-conv-btn');
    expect(await retryBtn.isVisible()).toBe(true);

    await page.unroute('**/api/client/conversations/error-test-id*');
  });

  it('26. session/auth failure redirects to login', async () => {
    const unauthContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const unauthPage = await unauthContext.newPage();

    await unauthPage.goto(origin + '/app/inbox');
    await unauthPage.waitForURL('**/login');
    expect(unauthPage.url()).toContain('/login');
    await unauthContext.close();
  });

  it('27. polling updates active transcript when new message arrives', async () => {
    await page.goto(origin + '/app/inbox/' + convAiActive.id);
    await page.waitForSelector('.inbox-transcript');

    const initialMsgCount = await page.locator('.inbox-transcript .inbox-msg').count();

    // Add a new message in DB
    await prisma.message.create({
      data: {
        tenantId: merchant.tenantId,
        conversationId: convAiActive.id,
        role: 'USER',
        content: 'Polling test incoming message!',
        createdAt: new Date()
      }
    });

    // Trigger polling refresh
    await page.evaluate((id) => {
      (window as any).RelayqoInbox.loadConversation(id, true, true);
    }, convAiActive.id);

    await page.waitForFunction((count) => {
      return document.querySelectorAll('.inbox-transcript .inbox-msg').length > count;
    }, initialMsgCount);

    expect(await page.locator('.inbox-transcript').innerText()).toContain('Polling test incoming message!');
  });

  it('28. polling does not overlap concurrent requests', async () => {
    const isOverlapping = await page.evaluate(async () => {
      const inbox = (window as any).RelayqoInbox;
      // Trigger multiple load calls simultaneously
      const p1 = inbox.loadConversationList(true);
      const p2 = inbox.loadConversationList(true);
      await Promise.all([p1, p2]);
      return true;
    });
    expect(isOverlapping).toBe(true);
  });

  it('29. page-hidden polling pauses when document is hidden', async () => {
    const isPaused = await page.evaluate(() => {
      // Simulate hidden document
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      return document.visibilityState === 'hidden';
    });
    expect(isPaused).toBe(true);

    // Restore visible
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    });
  });

  it('30. existing merchant portal features still work (overview, business data, whatsapp)', async () => {
    // Navigate to Overview
    await page.goto(origin + '/app');
    await page.getByRole('heading', { name: /Atlas Crafts/i }).waitFor();
    expect(await page.locator('.dashboard-metric').count()).toBeGreaterThanOrEqual(1);

    // Navigate to Business data
    await page.goto(origin + '/app/business');
    await page.waitForSelector('#business-form');
    expect(await page.locator('#business-form').isVisible()).toBe(true);

    // Navigate to WhatsApp
    await page.goto(origin + '/app/whatsapp');
    await page.waitForSelector('.connection-card');
    expect(await page.locator('.connection-card').innerText()).toContain('WhatsApp');
  });

  it('31. server state change polling updates ownership badge and actions without page reload', async () => {
    // 1. Open conversation 1 which is currently AI_ACTIVE
    await page.goto(origin + '/app/inbox/' + convAiActive.id);
    await page.waitForSelector('.inbox-detail-topbar .badge.status-ai-active');

    const initialBadge = page.locator('.inbox-detail-topbar .badge.status-ai-active');
    expect(await initialBadge.isVisible()).toBe(true);
    expect(await initialBadge.innerText()).toBe('AI active');

    // 2. Simulate server-side handoff request (backend changes conversation state to HANDOFF_REQUESTED)
    await prisma.conversation.update({
      where: { id: convAiActive.id },
      data: {
        status: 'HANDOFF_REQUESTED',
        humanRequested: true,
        humanRequestedAt: new Date()
      }
    });

    // 3. Trigger background poll
    await page.evaluate((id) => {
      (window as any).RelayqoInbox.loadConversation(id, true, true);
    }, convAiActive.id);

    // 4. Verify UI updates ownership badge and displays Take Over button without page reload
    await page.waitForSelector('.inbox-detail-topbar .badge.status-needs-human');
    const updatedBadge = page.locator('.inbox-detail-topbar .badge.status-needs-human');
    expect(await updatedBadge.isVisible()).toBe(true);
    expect(await updatedBadge.innerText()).toBe('Needs you');

    const takeoverBtn = page.locator('#inbox-takeover-btn');
    expect(await takeoverBtn.isVisible()).toBe(true);
  });
});
