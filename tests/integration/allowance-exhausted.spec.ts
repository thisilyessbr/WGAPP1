import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { portalDatabase } from '../helpers/portal-db';
import { PortalStore } from '../../src/portal/PortalStore';
import { PortalBudget, usageLevel } from '../../src/portal/PortalBudget';
import { PortalStaffActions, usageEmail } from '../../src/portal/PortalStaffActions';
import { validateAdminConfig, validatePlan } from '../../src/portal/validation';
import { ConversationEngine } from '../../src/domain/conversation/ConversationEngine';
import { AccountConfigService } from '../../src/domain/tenant/AccountConfigService';
import { LLMMockProvider } from '../../src/core/llm/LLMProvider';
import { BusinessConfig, DEFAULT_BUSINESS_CONFIG, DEFAULT_TEAM_FOLLOW_UP_MESSAGES } from '../../src/domain/tenant/BusinessConfig';

const BILLING_WORDS = /allowance|limit|quota|plan|billing|budget|credit|forfait|crédit|حد|رصيد|باقة/i;

describe('monthly allowance used up', () => {
  let database: Awaited<ReturnType<typeof portalDatabase>>, store: PortalStore, budget: PortalBudget;
  beforeAll(async () => { database = await portalDatabase(); store = new PortalStore(database.db); budget = new PortalBudget(store, false); }, 60000);
  afterAll(async () => { budget?.dispose(); await database?.pg.close(); });
  afterEach(() => { vi.useRealTimers(); });

  async function account(limits: Record<string, number> = {}) {
    // A verified member with a deliverable address receives usage emails.
    const owner = await store.register(randomUUID() + '@example.com', 'Owner', 'hash', null, true);
    const plan = await store.savePlan(owner.userId, validatePlan({ name: 'Basic', modules: ['knowledge'], limits: { messages: 100, monthlyUsd: 5, ...limits } }));
    const p = await store.profile(owner.accountId);
    await store.updateAccount(owner.userId, owner.accountId, p.revision, { planId: plan.id });
    await store.db.$executeRaw`UPDATE "PortalProfile" SET status='ACTIVE',"voiceNotesAllowed"=true,"voiceNotesEnabled"=true,"voiceTranscriptionProvider"='groq' WHERE "accountId"=${owner.accountId}`;
    return owner;
  }
  const turn = (owner: any, onBlocked?: (code: string) => Promise<string>) =>
    budget.runTurn(owner.tenantId, owner.accountId, randomUUID(), async () => 'Answer', '', onBlocked);
  const alerts = (accountId: string) => store.db.$queryRaw<any[]>`SELECT period,threshold,metric FROM "PortalUsageAlert" WHERE "accountId"=${accountId} ORDER BY period,threshold`;
  const actionAlerts = (accountId: string) => store.db.$queryRaw<any[]>`SELECT kind,occurrence FROM "PortalActionAlert" WHERE "accountId"=${accountId} ORDER BY occurrence`;

  describe('customer reply', () => {
    function conversations(seed: Record<string, any> = {}) {
      const conversation: any = { id: randomUUID(), customerId: 'customer-1', status: 'ACTIVE', contextData: {}, messageCount: 0,
        automationCapped: false, postCompletionCapped: false, humanRequested: false, humanRequestedAt: null, version: 0, ...seed };
      const commits: any[] = [], persisted: any[] = [];
      const service: any = {
        getOrCreateConversation: async (_tenantId: string, _customer: string, accountId: string) => { conversation.accountId = accountId; return conversation; },
        findExistingTurnResponse: async (_tenantId: string, externalId: string) => commits.find(c => c.externalMessageId === externalId)?.assistantMessage ?? null,
        persistMessage: async (...args: any[]) => { persisted.push(args); },
        releaseExpiredWorkflowPause: async () => false,
        getAutomationState: async () => null,
        commitConversationTurn: async (params: any) => {
          commits.push(params);
          conversation.version++;
          if (params.contextData) conversation.contextData = params.contextData;
          if (params.flagHumanRequested) conversation.humanRequested = true;
          if (params.newStatus) conversation.status = params.newStatus;
          return { success: true };
        }
      };
      return { conversation, commits, persisted, service };
    }
    function engine(service: any, config: BusinessConfig = DEFAULT_BUSINESS_CONFIG) {
      const llm = new LLMMockProvider();
      const generate = vi.spyOn(llm, 'generateResponse');
      const configs: any = { getConfig: async () => config };
      const instance = new ConversationEngine(service, configs, {} as any, llm, {} as any,
        undefined, undefined, undefined, undefined, undefined, undefined, budget);
      return { instance, generate };
    }
    async function exhausted() { const owner = await account({ messages: 1 }); await turn(owner); return owner; }
    const send = (e: ConversationEngine, owner: any, text: string) =>
      e.handleMessage(owner.tenantId, '212600000001', text, owner.accountId, { externalMessageId: 'wamid.' + randomUUID() });

    it('tells the customer the team will reply and flags the conversation, without an AI call', async () => {
      const owner = await exhausted(), c = conversations(), { instance, generate } = engine(c.service);
      const reply = await send(instance, owner, 'Hello, do you have this in blue?');
      expect(reply).toBe(DEFAULT_TEAM_FOLLOW_UP_MESSAGES.en);
      expect(generate).not.toHaveBeenCalled();
      expect(c.commits).toHaveLength(1);
      expect(c.commits[0]).toMatchObject({ assistantMessage: reply, flagHumanRequested: true, newStatus: 'HANDOFF_REQUESTED', responseType: 'HANDOFF',
        userMessage: 'Hello, do you have this in blue?' });
    });

    it.each([
      ['Bonjour, vous avez cette robe en bleu ?', DEFAULT_TEAM_FOLLOW_UP_MESSAGES.fr],
      ['هل لديكم هذا المنتج باللون الأزرق؟', DEFAULT_TEAM_FOLLOW_UP_MESSAGES.ar],
      ['واش عندكم هاد الصباط بالزرق؟', DEFAULT_TEAM_FOLLOW_UP_MESSAGES.darija_arabic],
      ['salam wach 3ndkom had sbat b zr9?', DEFAULT_TEAM_FOLLOW_UP_MESSAGES.darija_arabizi]
    ])('answers "%s" in the customer\'s language and script', async (text, expected) => {
      const owner = await exhausted(), c = conversations(), { instance } = engine(c.service);
      expect(await send(instance, owner, text)).toBe(expected);
    });

    it('never mentions the allowance or billing in any built-in language', () => {
      for (const message of Object.values(DEFAULT_TEAM_FOLLOW_UP_MESSAGES)) expect(message).not.toMatch(BILLING_WORDS);
      expect(/[ء-ي]/.test(DEFAULT_TEAM_FOLLOW_UP_MESSAGES.darija_arabic)).toBe(true);
      expect(/[ء-ي]/.test(DEFAULT_TEAM_FOLLOW_UP_MESSAGES.darija_arabizi)).toBe(false);
    });

    it('does not repeat the message in the same conversation this month', async () => {
      const owner = await exhausted(), c = conversations(), { instance } = engine(c.service);
      expect(await send(instance, owner, 'Hello, do you have this in blue?')).toBe(DEFAULT_TEAM_FOLLOW_UP_MESSAGES.en);
      // While the team has the conversation the bot stays quiet; the message is kept for the inbox.
      expect(await send(instance, owner, 'Hello? Anyone there?')).toBe('');
      expect(c.persisted).toHaveLength(1);
      // The team closed the request but the allowance is still used up: flagged again, no second notice.
      c.conversation.humanRequested = false; c.conversation.status = 'ACTIVE';
      expect(await send(instance, owner, 'Hello again')).toBe('');
      expect(c.commits).toHaveLength(2);
      expect(c.commits[1]).toMatchObject({ assistantMessage: null, flagHumanRequested: true, newStatus: 'HANDOFF_REQUESTED' });
    });

    it('tells the customer again in a new month', async () => {
      const owner = await exhausted(), c = conversations({ contextData: { _teamFollowUpNotice: '1999-01' } }), { instance } = engine(c.service);
      expect(await send(instance, owner, 'Hello, do you have this in blue?')).toBe(DEFAULT_TEAM_FOLLOW_UP_MESSAGES.en);
    });

    it('uses the merchant override over the built-in text', async () => {
      const owner = await exhausted();
      const config = { ...DEFAULT_BUSINESS_CONFIG, prompts: { ...DEFAULT_BUSINESS_CONFIG.prompts,
        teamFollowUp: { en: 'Thanks! Sara from the shop will text you back today.', darija: 'Chokran! Sara ghadi tjawbek lyoum.' } } };
      const english = conversations();
      expect(await send(engine(english.service, config).instance, owner, 'Hello, do you have this in blue?')).toBe('Thanks! Sara from the shop will text you back today.');
      const darija = conversations();
      expect(await send(engine(darija.service, config).instance, owner, 'salam wach 3ndkom had sbat b zr9?')).toBe('Chokran! Sara ghadi tjawbek lyoum.');
    });

    it('keeps the merchant override when merged into the account configuration and accepts it in admin', () => {
      const merge = (AccountConfigService.prototype as any).mergeAccountOverrides;
      const merged = merge.call(Object.create(AccountConfigService.prototype), DEFAULT_BUSINESS_CONFIG, { prompts: { teamFollowUp: { fr: 'Notre équipe vous rappelle.' } } });
      expect(merged.prompts.teamFollowUp).toMatchObject({ fr: 'Notre équipe vous rappelle.' });
      expect(validateAdminConfig({ prompts: { teamFollowUp: { en: 'We will call you back.' } } }).prompts.teamFollowUp).toEqual({ en: 'We will call you back.' });
    });

    it('stays silent while a person handles the conversation', async () => {
      const owner = await exhausted(), c = conversations({ status: 'HUMAN_ACTIVE' }), { instance } = engine(c.service);
      expect(await send(instance, owner, 'Hello, do you have this in blue?')).toBe('');
      expect(c.commits).toHaveLength(0);
      expect(c.persisted).toHaveLength(1);
    });

    it('stays silent when the account is paused rather than out of allowance', async () => {
      const owner = await account(), c = conversations(), { instance } = engine(c.service);
      await store.db.$executeRaw`UPDATE "PortalProfile" SET status='SUSPENDED' WHERE "accountId"=${owner.accountId}`;
      expect(await send(instance, owner, 'Hello, do you have this in blue?')).toBe('');
      expect(c.commits).toHaveLength(0);
    });

    it('passes only the allowance refusal to the blocked-turn handler', async () => {
      const owner = await account({ messages: 1 }), id = randomUUID(), onBlocked = vi.fn(async (code: string) => code);
      expect(await budget.runTurn(owner.tenantId, owner.accountId, id, async () => 'Answer', '', onBlocked)).toBe('Answer');
      expect(await turn(owner, onBlocked)).toBe('ALLOWANCE_EXHAUSTED');
      await store.db.$executeRaw`UPDATE "PortalProfile" SET status='SUSPENDED' WHERE "accountId"=${owner.accountId}`;
      expect(await turn(owner, onBlocked)).toBe('');
      expect(onBlocked).toHaveBeenCalledTimes(1);
    });
  });

  describe('merchant alerts', () => {
    it('computes the highest threshold reached by any limit', () => {
      const limits = { messages: 100, llmCalls: 100, images: 0, embeddings: 100, monthlyUsd: 1, numbers: 1, products: 1, documents: 1, storageMb: 1 };
      expect(usageLevel(limits, { messages: 79, spentMicros: 0 })).toBeNull();
      expect(usageLevel(limits, { messages: 80 })).toEqual({ threshold: 80, metric: 'messages' });
      expect(usageLevel(limits, { messages: 10, spentMicros: 1000000 })).toEqual({ threshold: 100, metric: 'monthlyUsd' });
      expect(usageLevel({ ...limits, messages: -1 }, { messages: 5000 })).toBeNull();
      // A module the plan does not include (limit 0) never counts as used up.
      expect(usageLevel(limits, { images: 3 })).toBeNull();
    });

    it('alerts once at 80% and once at 100% of a count limit, and again next month', async () => {
      const owner = await account({ messages: 5 });
      for (let i = 0; i < 3; i++) await turn(owner);
      expect(await alerts(owner.accountId)).toEqual([]);
      await turn(owner);
      const period = new Date().toISOString().slice(0, 7);
      expect(await alerts(owner.accountId)).toEqual([{ period, threshold: 80, metric: 'messages' }]);
      await turn(owner);
      await turn(owner, async () => 'blocked');
      await turn(owner, async () => 'blocked');
      expect(await alerts(owner.accountId)).toEqual([{ period, threshold: 80, metric: 'messages' }, { period, threshold: 100, metric: 'messages' }]);
      expect(await actionAlerts(owner.accountId)).toEqual([{ kind: 'USAGE', occurrence: period + ':100' }, { kind: 'USAGE', occurrence: period + ':80' }]);

      const next = new Date(); next.setUTCDate(1); next.setUTCMonth(next.getUTCMonth() + 1); next.setUTCHours(12);
      vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(next);
      for (let i = 0; i < 4; i++) await turn(owner);
      expect((await alerts(owner.accountId)).filter(a => a.period === next.toISOString().slice(0, 7))).toEqual([{ period: next.toISOString().slice(0, 7), threshold: 80, metric: 'messages' }]);
    });

    it('alerts at 100% when a reservation is refused, even before any usage was counted', async () => {
      const owner = await account({ messages: 0 });
      expect(await turn(owner, async code => code)).toBe('ALLOWANCE_EXHAUSTED');
      expect((await alerts(owner.accountId)).map(a => [a.threshold, a.metric])).toEqual([[100, 'messages']]);
    });

    it('alerts on settled AI spend at 80% and 100%', async () => {
      const owner = await account({ monthlyUsd: 0.01, llmCalls: 10 });
      // DeepSeek reports 27000 input tokens: 8100 of the 10000 micro-USD (plans are priced in cents).
      const inner: any = { generateResponse: async (_prompt: string, _history: any[], options: any) => {
        options.onUsage?.({ provider: 'deepseek', model: 'deepseek-flash', attempts: 1, inputTokens: 27000, outputTokens: 0, tokenSource: 'provider' });
        return 'ok';
      } };
      const llm = budget.wrapLLM(inner, { provider: 'deepseek', model: 'deepseek-flash' });
      const ask = () => budget.runTurn(owner.tenantId, owner.accountId, randomUUID(), () => llm.generateResponse('p', [{ role: 'user', content: 'hi' } as any], { maxTokens: 1 }), '');
      expect(await ask()).toBe('ok');
      expect((await alerts(owner.accountId)).map(a => [a.threshold, a.metric])).toEqual([[80, 'monthlyUsd']]);
      expect(await ask()).toBe('ok'); // settles past the cap
      expect(await ask()).toBe(''); // the next turn is refused
      expect((await alerts(owner.accountId)).map(a => [a.threshold, a.metric])).toEqual([[80, 'monthlyUsd'], [100, 'monthlyUsd']]);
    });

    it('shows the alert in the portal until dismissed and emails members through the staff alert worker', async () => {
      const owner = await account({ messages: 5 });
      for (let i = 0; i < 4; i++) await turn(owner);
      const shown = await store.usageAlert(owner.accountId, owner.tenantId);
      expect(shown).toMatchObject({ threshold: 80 });

      // The worker sends ten alerts per run; earlier tests' alerts are not part of this one.
      await store.db.$executeRaw`UPDATE "PortalActionAlert" SET status='SENT' WHERE "accountId"<>${owner.accountId}`;
      const env = { ...process.env };
      Object.assign(process.env, { RESEND_API_KEY: 'test-key', PORTAL_MAIL_FROM: 'Relayqo <alerts@example.com>', PORTAL_PUBLIC_URL: 'https://portal.example.com' });
      try {
        const deliver = vi.fn(async () => {});
        await new PortalStaffActions(store, deliver).tick();
        const usage = deliver.mock.calls.filter((call: any[]) => call[0].kind === 'USAGE' && call[0].accountId === owner.accountId);
        expect(usage).toHaveLength(1);
        expect(usage[0][1]).toBe('https://portal.example.com/app');
        await new PortalStaffActions(store, deliver).tick();
        expect(deliver.mock.calls.filter((call: any[]) => call[0].kind === 'USAGE' && call[0].accountId === owner.accountId)).toHaveLength(1);
      } finally { process.env = env; }

      await store.dismissUsageAlert(owner.accountId, owner.tenantId, shown!.id);
      expect(await store.usageAlert(owner.accountId, owner.tenantId)).toBeNull();
      await expect(store.dismissUsageAlert(owner.accountId, owner.tenantId, shown!.id)).rejects.toMatchObject({ code: 'USAGE_ALERT_NOT_FOUND' });
    });

    it('writes usage emails for 80% and 100%', () => {
      const [subject80, body80] = usageEmail('2026-10:80', 'https://portal.example.com/app');
      const [subject100, body100] = usageEmail('2026-10:100', 'https://portal.example.com/app');
      expect(subject80).toContain('80%');
      expect(subject100).toContain('used up');
      expect(body80).toContain('https://portal.example.com/app');
      expect(body100).toContain('inbox');
    });
  });
});
