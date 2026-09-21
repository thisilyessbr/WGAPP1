import { BusinessConfig, DEFAULT_BUSINESS_CONFIG } from '../domain/tenant/BusinessConfig';
import { BusinessData, DEFAULT_PLAN_LIMITS, EMPTY_BUSINESS, PlanLimits, PortalError, PortalPlan } from './types';
import { resolveDeepSeekModel } from '../core/llm/DeepSeekProvider';

export function object(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PortalError(400, 'INVALID_OBJECT');
  return value as Record<string, any>;
}
export function allowed(value: Record<string, any>, keys: string[]): void {
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw new PortalError(400, 'FIELD_NOT_ALLOWED', `This field cannot be changed: ${key}`);
}
export function text(value: unknown, max = 500, fallback = ''): string {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string' || value.length > max || /\u0000/.test(value)) throw new PortalError(400, 'INVALID_TEXT');
  return value.trim();
}
export function integer(value: unknown, min = 0, max = 1000000): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw new PortalError(400, 'INVALID_NUMBER');
  return value;
}
export function money(value: unknown, max = 1000000): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max) throw new PortalError(400, 'INVALID_PRICE');
  return Math.round(value * 100) / 100;
}
export function email(value: unknown): string {
  const result = text(value, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) throw new PortalError(400, 'INVALID_EMAIL', 'Enter a valid email address.');
  return result;
}
export function list(value: unknown, max: number): any[] {
  if (!Array.isArray(value) || value.length > max) throw new PortalError(400, 'LIST_TOO_LARGE');
  return value;
}
function unique(values: string[]) { if (values.some(v => !v) || new Set(values).size !== values.length) throw new PortalError(400, 'DUPLICATE_OR_EMPTY_ID'); }
export function validateBusiness(input: unknown, plan?: PortalPlan | null, previous?: BusinessData, lockedFields: string[] = []): BusinessData {
  const data = object(input); allowed(data, Object.keys(EMPTY_BUSINESS));
  if (JSON.stringify(data).length > 400000) throw new PortalError(413, 'DATA_TOO_LARGE');
  for (const key of lockedFields) if (JSON.stringify(data[key]) !== JSON.stringify((previous as any)?.[key])) throw new PortalError(403, 'FIELD_LOCKED', `${key} is managed by your administrator.`);
  const result = structuredClone(EMPTY_BUSINESS);
  for (const key of ['name', 'email', 'phone', 'website', 'description', 'address', 'hours', 'currency'] as const) {
    result[key] = text(data[key], key === 'description' ? 6000 : key === 'hours' ? 2000 : 500, result[key]);
  }
  if (!result.name || result.name.length > 160) throw new PortalError(400, 'BUSINESS_NAME_REQUIRED');
  if (result.email) result.email = email(result.email);
  if (!/^[A-Z]{3}$/.test(result.currency)) throw new PortalError(400, 'INVALID_CURRENCY');
  if (result.website && !/^https?:\/\//i.test(result.website)) throw new PortalError(400, 'INVALID_WEBSITE');
  const policies = object(data.policies || {}); allowed(policies, Object.keys(result.policies));
  for (const key of Object.keys(result.policies) as (keyof BusinessData['policies'])[]) result.policies[key] = text(policies[key], 12000);
  result.faqs = list(data.faqs || [], 200).map((raw, index) => {
    const f = object(raw); allowed(f, ['id', 'question', 'answer', 'language', 'category']);
    const language = text(f.language, 15, 'en');
    if (!['en', 'fr', 'ar', 'darija'].includes(language)) throw new PortalError(400, 'INVALID_LANGUAGE');
    return { id: text(f.id, 100, `faq-${index + 1}`), question: text(f.question, 500), answer: text(f.answer, 4000), language, category: text(f.category, 100) };
  });
  if (result.faqs.some(f => !f.question || !f.answer)) throw new PortalError(400, 'INCOMPLETE_FAQ');
  unique(result.faqs.map(f => f.id));
  result.products = list(data.products || [], plan?.limits.products ?? 100).map(raw => {
    const p = object(raw); allowed(p, ['sku', 'name', 'description', 'price', 'stock', 'category', 'variants']);
    const variants = list(p.variants || [], 100).map(rawVariant => {
      const v = object(rawVariant); allowed(v, ['sku', 'size', 'color', 'stock', 'price']);
      return { sku: text(v.sku, 100), size: text(v.size, 50), color: text(v.color, 50), stock: integer(v.stock ?? 0), price: v.price == null ? null : money(v.price) };
    });
    unique(variants.map(v => v.sku));
    return { sku: text(p.sku, 100), name: text(p.name, 250), description: text(p.description, 6000), price: money(p.price), stock: integer(p.stock ?? 0), category: text(p.category, 100), variants };
  });
  unique(result.products.map(p => p.sku));
  if (result.products.some(p => !p.name)) throw new PortalError(400, 'PRODUCT_NAME_REQUIRED');
  result.services = list(data.services || [], 100).map(raw => {
    const s = object(raw); allowed(s, ['name', 'description', 'price', 'availability']);
    return { name: text(s.name, 250), description: text(s.description, 6000), price: text(s.price, 250), availability: text(s.availability, 2000) };
  });
  if (result.services.some(s => !s.name)) throw new PortalError(400, 'SERVICE_NAME_REQUIRED');
  if (plan) {
    for (const [field, module] of [['products', 'commerce'], ['services', 'services'], ['faqs', 'knowledge']] as const) {
      if (!plan.modules.includes(module) && result[field].length) throw new PortalError(403, 'MODULE_NOT_INCLUDED', `${module} is not included in this plan.`);
    }
  }
  return result;
}

export function validateAdminConfig(input: unknown): Record<string, any> {
  const config = object(input);
  allowed(config, ['identity', 'behavior', 'limits', 'prompts', 'capabilities', 'workflows', 'knowledge', 'llm', 'ecommerce']);
  const encoded = JSON.stringify(config);
  if (encoded.length > 180000 || /"(?:__proto__|constructor|prototype)"\s*:/.test(encoded)) throw new PortalError(400, 'INVALID_CONFIG');
  for (const value of Object.values(config)) object(value);
  const stringMap = (value: unknown, max = 12000) => {
    for (const entry of Object.values(object(value))) text(entry, max);
  };
  if (config.identity) {
    allowed(config.identity, ['botName', 'language', 'brand', 'industry', 'country', 'currency', 'businessHours', 'locations', 'support']);
    for (const [key, value] of Object.entries(config.identity)) {
      if (key === 'support') stringMap(value, 500);
      else if (key === 'locations') list(value, 30).forEach(v => text(v, 1000));
      else text(value, 2000);
    }
  }
  if (config.behavior) {
    allowed(config.behavior, Object.keys(DEFAULT_BUSINESS_CONFIG.behavior));
    for (const [key, value] of Object.entries(config.behavior)) {
      if (key === 'tone') text(value, 200);
      else if (key === 'verbosity') { if (!['short', 'medium', 'long'].includes(String(value))) throw new PortalError(400, 'INVALID_VERBOSITY'); }
      else if (typeof value !== 'boolean') throw new PortalError(400, 'INVALID_SETTING');
    }
  }
  if (config.prompts) {
    allowed(config.prompts, Object.keys(DEFAULT_BUSINESS_CONFIG.prompts));
    const localized = ['greeting', 'fallback', 'handoff', 'postCompletionClosing', 'postCompletionFallback', 'imageFallback', 'limitExceeded'];
    for (const [key, value] of Object.entries(config.prompts)) {
      if (localized.includes(key) && typeof value === 'object') stringMap(value);
      else text(value, 20000);
    }
  }
  if (config.knowledge) {
    const k = config.knowledge;
    allowed(k, Object.keys(DEFAULT_BUSINESS_CONFIG.knowledge));
    if (k.enabled !== undefined && typeof k.enabled !== 'boolean') throw new PortalError(400, 'INVALID_SETTING');
    if (k.topK !== undefined) integer(k.topK, 1, 10);
    if (k.maxContextSize !== undefined) integer(k.maxContextSize, 100, 12000);
    if (k.minSimilarityScore !== undefined && (typeof k.minSimilarityScore !== 'number' || k.minSimilarityScore < 0 || k.minSimilarityScore > 1)) throw new PortalError(400, 'INVALID_SIMILARITY');
    if (k.embeddingProvider !== undefined && k.embeddingProvider !== 'gemini') throw new PortalError(400, 'UNPRICED_PROVIDER');
    if (k.embeddingModel !== undefined && k.embeddingModel !== 'gemini-embedding-001') throw new PortalError(400, 'UNPRICED_MODEL');
    if (k.ingestion) {
      allowed(object(k.ingestion), Object.keys(DEFAULT_BUSINESS_CONFIG.knowledge.ingestion));
      const effective = { ...DEFAULT_BUSINESS_CONFIG.knowledge.ingestion, ...k.ingestion };
      integer(effective.chunkSize, 200, 2000); integer(effective.chunkOverlap, 0, effective.chunkSize - 1);
      integer(effective.maxFileSizeMb, 1, 10); integer(effective.maxExtractedTextLength, 100, 100000); integer(effective.maxChunks, 1, 500);
    }
  }
  if (config.capabilities) {
    for (const key of ['imageEnabled', 'ecommerceEnabled']) if (config.capabilities[key] !== undefined && typeof config.capabilities[key] !== 'boolean') throw new PortalError(400, 'INVALID_SETTING');
    if (config.capabilities.intents !== undefined) list(config.capabilities.intents, 50).forEach(raw => {
      const intent = object(raw); if (!text(intent.id, 100)) throw new PortalError(400, 'INVALID_INTENT');
      text(intent.description, 2000); if (intent.keywords) list(intent.keywords, 100).forEach(k => text(k, 200));
    });
  }
  if (config.llm) {
    const llm = config.llm;
    allowed(llm, Object.keys(DEFAULT_BUSINESS_CONFIG.llm));
    if (llm.model !== undefined) text(llm.model, 100);
    if (llm.provider !== undefined && !['deepseek', 'mock'].includes(llm.provider)) throw new PortalError(400, 'UNPRICED_PROVIDER', 'Managed accounts currently support DeepSeek; configure pricing before adding another provider.');
    if (llm.model !== undefined && !['deepseek-flash', 'deepseek-v4-pro', 'mock-model'].includes(resolveDeepSeekModel(llm.model))) throw new PortalError(400, 'UNPRICED_MODEL');
    if (llm.maxTokens !== undefined) integer(llm.maxTokens, 1, 2048);
    if (llm.timeoutMs !== undefined) integer(llm.timeoutMs, 500, 30000);
    if (llm.temperature !== undefined && (typeof llm.temperature !== 'number' || llm.temperature < 0 || llm.temperature > 2)) throw new PortalError(400, 'INVALID_TEMPERATURE');
  }
  if (config.limits) for (const n of Object.values(config.limits)) integer(n, 1, 100000);
  if (config.workflows) {
    for (const workflow of Object.values(config.workflows) as any[]) {
      if (!workflow.initialState || !workflow.states?.[workflow.initialState]) throw new PortalError(400, 'INVALID_WORKFLOW');
      for (const state of Object.values(workflow.states) as any[]) {
        if (!['choice','collect','confirm','message','rag','handoff','end'].includes(state.type)) throw new PortalError(400, 'INVALID_WORKFLOW_STATE');
        const targets = [...(state.transitions || []).map((t: any) => t.target), ...(state.options || []).map((o: any) => o.next), ...(state.next ? [state.next] : [])];
        if (targets.some(target => !workflow.states[target])) throw new PortalError(400, 'INVALID_WORKFLOW_TARGET');
      }
    }
  }
  return structuredClone(config);
}

export function validatePlan(input: unknown): Omit<PortalPlan, 'id' | 'revision'> {
  const p = object(input); allowed(p, ['name', 'description', 'price', 'currency', 'published', 'modules', 'limits', 'template', 'revision']);
  const name = text(p.name, 100); if (!name) throw new PortalError(400, 'PLAN_NAME_REQUIRED');
  const modules = list(p.modules || [], 5).map(m => text(m, 30));
  if (modules.some(m => !['commerce', 'services', 'knowledge', 'images', 'qr'].includes(m))) throw new PortalError(400, 'INVALID_MODULE');
  const rawLimits = object(p.limits || {}); allowed(rawLimits, Object.keys(DEFAULT_PLAN_LIMITS));
  const limits = { ...DEFAULT_PLAN_LIMITS };
  for (const key of Object.keys(limits) as (keyof PlanLimits)[]) if (rawLimits[key] !== undefined) limits[key] = key === 'monthlyUsd' ? money(rawLimits[key], 10000) : integer(rawLimits[key], key === 'messages' ? -1 : 0, key === 'numbers' ? 100 : 1000000);
  if (limits.documents > 100 || limits.storageMb > 1000 || limits.products > 2000) throw new PortalError(400, 'PLAN_LIMIT_TOO_LARGE');
  const currency = text(p.currency, 3, 'MAD').toUpperCase(); if (!/^[A-Z]{3}$/.test(currency)) throw new PortalError(400, 'INVALID_CURRENCY');
  return { name, description: text(p.description, 1000), price: money(p.price ?? 0), currency, published: p.published === true, modules, limits, template: validateAdminConfig(p.template || {}) };
}

export function compileBusiness(data: BusinessData, template: Record<string, any>, adminConfig: Record<string, any>, previous: Record<string, any> = {}): BusinessConfig {
  const config: any = structuredClone(DEFAULT_BUSINESS_CONFIG);
  config.portalManaged = true;
  config.behavior.answerOnlyFromKnowledge = true;
  for (const layer of [previous, template, adminConfig]) for (const [key, value] of Object.entries(layer)) {
    config[key] = key === 'workflows' ? structuredClone(value) : { ...(config[key] || {}), ...structuredClone(value) };
  }
  config.knowledge.ingestion = { ...DEFAULT_BUSINESS_CONFIG.knowledge.ingestion, ...template.knowledge?.ingestion, ...adminConfig.knowledge?.ingestion };
  config.identity = { ...config.identity, brand: data.name, businessHours: data.hours, locations: [data.address].filter(Boolean), currency: data.currency,
    support: { ...config.identity.support, email: data.email } };
  config.capabilities.faq = data.faqs;
  // Facts remain untrusted retrieval data, never appended to the trusted system prompt.
  config.portalFacts = { description: data.description, policies: data.policies, services: data.services, phone: data.phone, website: data.website };
  return config;
}
