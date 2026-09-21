import { AsyncLocalStorage } from 'async_hooks';
import { createHash, randomUUID } from 'crypto';
import { LLMProvider, LLMProviderError, LLMRequestOptions, LLMUsage } from '../core/llm/LLMProvider';
import { resolveDeepSeekModel } from '../core/llm/DeepSeekProvider';
import { EmbeddingProvider } from '../core/rag/EmbeddingProvider';
import { ImageCapabilityGateway } from '../core/gateway/ImageCapabilityGateway';
import { telemetry } from '../core/telemetry/TelemetryClient';
import { PortalStore } from './PortalStore';
import { PortalError, PortalProfile } from './types';

interface UsageContext { profile: PortalProfile; key: string; sequence: number; llm: number; embedding: number; image: number; events: Record<string, unknown>; allowInactive: boolean; preview?: boolean; }
export class PortalBudget {
  private context = new AsyncLocalStorage<UsageContext>();
  private unsubscribe: () => void;
  constructor(private store: PortalStore) {
    this.unsubscribe = telemetry.onEvent(event => {
      const ctx = this.context.getStore();
      if (!ctx || event.tenantId !== ctx.profile.tenantId) return;
      if (event.eventType === 'response_completed') {
        const meta = event.metadata as any;
        ctx.events = { ...ctx.events, source: meta?.responseSource || meta?.source, language: meta?.turnDecision?.responseLanguage,
          script: meta?.turnDecision?.responseScript, intent: meta?.turnDecision?.intent, latencyMs: event.latencyMs };
      }
    });
  }
  dispose() { this.unsubscribe(); }
  async getPreviewProfile(tenantId: string, accountId: string): Promise<PortalProfile> {
    return this.store.profile(accountId, tenantId);
  }
  async runTurn<T>(tenantId: string, accountId: string | null | undefined, externalId: string | null | undefined, run: () => Promise<T>, blocked: T): Promise<T> {
    const profiles = await this.store.db.$queryRaw<PortalProfile[]>`SELECT * FROM "PortalProfile" WHERE "tenantId"=${tenantId} AND (${accountId || null}::text IS NULL OR "accountId"=${accountId || null}) LIMIT 2`;
    if (!profiles.length) return run(); // Legacy clients retain their current path until explicitly adopted.
    if (!accountId || profiles.length !== 1 || profiles[0].status !== 'ACTIVE' || !profiles[0].planSnapshot) return blocked;
    const profile = profiles[0];
    const key = externalId ? 'message:' + createHash('sha256').update(externalId).digest('hex') : 'preview:' + randomUUID();
    const ctx: UsageContext = { profile, key, sequence: 0, llm: 0, embedding: 0, image: 0, events: {}, allowInactive: false };
    return this.context.run(ctx, async () => {
      let reservation: string;
      try { reservation = await this.reserve('message', 0, key, true); }
      catch (error) { if (error instanceof PortalError && error.status === 402) return blocked; throw error; }
      const started = Date.now();
      try {
        const result = await run();
        await this.finish(reservation, 0, { ...ctx.events, latencyMs: Date.now() - started, success: true });
        return result;
      } catch (error) {
        await this.finish(reservation, 0, { latencyMs: Date.now() - started, success: false });
        throw error;
      }
    });
  }
  async runIngestion<T>(profile: PortalProfile, documentId: string, run: () => Promise<T>) {
    if (!profile.planSnapshot?.modules.includes('knowledge')) throw new PortalError(403, 'KNOWLEDGE_NOT_INCLUDED');
    return this.context.run({ profile, key: 'document:' + documentId + ':' + randomUUID(), sequence: 0, llm: 0, embedding: 0, image: 0, events: {}, allowInactive: true }, run);
  }
  /** Bounded admin previews never reserve or charge the client's commercial bucket. */
  async runPreview<T>(profile: PortalProfile, run: () => Promise<T>): Promise<T> {
    return this.context.run({ profile, key: 'admin-preview:' + randomUUID(), sequence: 0, llm: 0, embedding: 0, image: 0, events: {}, allowInactive: true, preview: true }, run);
  }
  private async reserve(kind: 'message' | 'llm' | 'image' | 'embedding', reservedMicros: number, key?: string, allowCompleted = false): Promise<string> {
    const ctx = this.context.getStore();
    if (!ctx) return '';
    if (ctx.preview) return '';
    const dedupeKey = key || `${ctx.key}:${++ctx.sequence}:${kind}`;
    return this.store.transaction(async s => {
      const p = await s.lockProfile(ctx.profile.accountId);
      if (!p.planSnapshot || (!ctx.allowInactive && p.status !== 'ACTIVE') || p.status === 'SUSPENDED') throw new PortalError(402, 'ACCOUNT_NOT_ACTIVE');
      const prior = (await s.db.$queryRaw<any[]>`SELECT id,status FROM "PortalUsageEntry" WHERE "accountId"=${p.accountId} AND "dedupeKey"=${dedupeKey}`)[0];
      if (prior) {
        if (allowCompleted && prior.status === 'COMPLETED') return prior.id;
        throw new PortalError(402, 'OPERATION_ALREADY_RESERVED');
      }
      const period = new Date().toISOString().slice(0, 7);
      await s.db.$executeRaw`INSERT INTO "PortalUsageBucket"("accountId",period) VALUES (${p.accountId},${period}) ON CONFLICT DO NOTHING`;
      const bucket = (await s.db.$queryRaw<any[]>`SELECT * FROM "PortalUsageBucket" WHERE "accountId"=${p.accountId} AND period=${period} FOR UPDATE`)[0];
      const field = kind === 'message' ? 'messages' : kind === 'llm' ? 'llmCalls' : kind === 'image' ? 'images' : 'embeddings';
      const limits = p.planSnapshot.limits;
      if ((!(kind === 'message' && limits.messages === -1) && Number(bucket[field]) >= limits[field]) || Number(bucket.spentMicros) + Number(bucket.reservedMicros) + reservedMicros > Math.floor(limits.monthlyUsd * 1000000)) {
        throw new PortalError(402, 'ALLOWANCE_EXHAUSTED', 'The account allowance has been reached. Contact the administrator.');
      }
      const id = randomUUID();
      await s.db.$executeRaw`INSERT INTO "PortalUsageEntry"(id,"accountId",period,kind,"dedupeKey","reservedMicros") VALUES (${id},${p.accountId},${period},${kind},${dedupeKey},${reservedMicros})`;
      await s.db.$executeRaw`UPDATE "PortalUsageBucket" SET messages=messages+${kind === 'message' ? 1 : 0},"llmCalls"="llmCalls"+${kind === 'llm' ? 1 : 0},
        images=images+${kind === 'image' ? 1 : 0},embeddings=embeddings+${kind === 'embedding' ? 1 : 0},"reservedMicros"="reservedMicros"+${reservedMicros}
        WHERE "accountId"=${p.accountId} AND period=${period}`;
      return id;
    });
  }
  private async finish(id: string, chargedMicros: number | null, metadata: Record<string, unknown>) {
    if (!id) return;
    await this.store.transaction(async s => {
      const entry = (await s.db.$queryRaw<any[]>`SELECT * FROM "PortalUsageEntry" WHERE id=${id} FOR UPDATE`)[0];
      if (!entry || entry.status !== 'RESERVED') return;
      const known = chargedMicros !== null;
      // Missing provider usage retains the full reservation as an explicitly estimated charge.
      const charge = known ? Math.max(0, Math.ceil(chargedMicros)) : Number(entry.reservedMicros);
      await s.db.$executeRaw`UPDATE "PortalUsageEntry" SET status=${known ? 'COMPLETED' : 'UNKNOWN'},"chargedMicros"=${charge},metadata=${JSON.stringify(metadata)}::jsonb WHERE id=${id}`;
      await s.db.$executeRaw`UPDATE "PortalUsageBucket" SET "reservedMicros"="reservedMicros"-${Number(entry.reservedMicros)},"spentMicros"="spentMicros"+${charge}
        WHERE "accountId"=${entry.accountId} AND period=${entry.period}`;
    });
  }
  wrapLLM(inner: LLMProvider, defaults: { provider: string; model: string }): LLMProvider {
    const execute = async <T>(prompt: string, input: string, options: LLMRequestOptions | undefined, call: (options: LLMRequestOptions) => Promise<T>) => {
      const ctx = this.context.getStore();
      if (!ctx) return call(options || {});
      if (++ctx.llm > 4) throw new LLMProviderError({ provider: defaults.provider, type: 'rate_limit', message: 'Per-turn AI allowance reached' });
      const model = resolveDeepSeekModel(options?.model || defaults.model);
      if (!['deepseek-flash', 'deepseek-v4-pro', 'mock-model'].includes(model) || !['deepseek', 'mock'].includes(defaults.provider)) throw new PortalError(402, 'UNPRICED_PROVIDER');
      const rates = model === 'deepseek-v4-pro' ? { input: 1.32, output: 3.96, cached: 0.044 } : { input: 0.30, output: 1.20, cached: 0.006 };
      const bytes = Buffer.byteLength(prompt + input, 'utf8') + 1024;
      if (bytes > 66560) throw new PortalError(413, 'AI_INPUT_TOO_LARGE');
      const maxOutput = Math.min(Number.isFinite(options?.maxTokens) && options!.maxTokens! > 0 ? options!.maxTokens! : 2048, 2048);
      const reserve = defaults.provider === 'mock' ? 0 : Math.ceil(2 * (bytes * rates.input + maxOutput * rates.output));
      let id: string;
      try { id = await this.reserve('llm', reserve); }
      catch (error: any) { throw new LLMProviderError({ provider: defaults.provider, type: 'rate_limit', message: error.message }); }
      let usage: LLMUsage | undefined;
      try {
        return await call({ ...options, onUsage: value => { usage = value; options?.onUsage?.(value); } });
      } finally {
        const actual = usage?.attempts === 0 || defaults.provider === 'mock' ? 0 : usage?.tokenSource === 'provider'
          ? Math.ceil(Math.max(0, usage.inputTokens! - (usage.cacheHitTokens || 0)) * rates.input + (usage.cacheHitTokens || 0) * rates.cached + usage.outputTokens! * rates.output) : null;
        // A preceding failed attempt can have unknown billing even when the retry succeeded.
        await this.finish(id, usage && usage.attempts > 1 ? null : actual, { ...usage, model, priceBasis: 'USD peak rates 2026-09-13', knownEstimateMicros: actual });
      }
    };
    return {
      classifyIntent: (prompt, message, allowed, options) => !allowed.length ? Promise.resolve(null) : execute(prompt, message, options, opt => inner.classifyIntent(prompt, message, allowed, opt)),
      extractField: (prompt, message, type, options) => execute(prompt, message, options, opt => inner.extractField(prompt, message, type, opt)),
      generateResponse: (prompt, history, options) => execute(prompt, history.map(h => h.content).join('\n'), options, opt => inner.generateResponse(prompt, history, opt))
    };
  }
  wrapEmbeddings(inner: EmbeddingProvider): EmbeddingProvider {
    return { embedText: async text => {
      const ctx = this.context.getStore(); if (!ctx) return inner.embedText(text);
      const ceiling = ctx.allowInactive ? 500 : 4;
      if (++ctx.embedding > ceiling) throw new PortalError(402, 'EMBEDDING_LIMIT');
      const id = await this.reserve('embedding', Math.ceil((Buffer.byteLength(text, 'utf8') + 64) * 0.15));
      try { return await inner.embedText(text); }
      finally { await this.finish(id, null, { provider: 'gemini', model: 'gemini-embedding-001', inputBytes: Buffer.byteLength(text, 'utf8'), tokenSource: 'unknown', priceBasis: 'Conservative byte estimate at $0.15/M tokens' }); }
    } };
  }
  wrapImages(inner: ImageCapabilityGateway): ImageCapabilityGateway {
    const budget = this;
    return new class extends ImageCapabilityGateway {
      checkHealth() { return inner.checkHealth(); }
      async analyzeImage(...args: Parameters<ImageCapabilityGateway['analyzeImage']>) {
        const ctx = budget.context.getStore();
        if (!ctx) return inner.analyzeImage(...args);
        if (!ctx.profile.planSnapshot?.modules.includes('images') || ++ctx.image > 1) throw new PortalError(402, 'IMAGE_ALLOWANCE_EXHAUSTED');
        // No image token receipt is currently returned by the image service.
        const id = await budget.reserve('image', 1000000);
        try { return await inner.analyzeImage(...args); }
        finally { await budget.finish(id, null, { tokenSource: 'unknown', priceBasis: '$1 conservative per-image reservation; reconcile against provider usage' }); }
      }
    }();
  }
}
