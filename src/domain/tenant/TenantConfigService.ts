import { PrismaClient } from '@prisma/client';
import { BusinessConfig, DEFAULT_BUSINESS_CONFIG } from './BusinessConfig';

interface CachedTenantConfig {
  config: BusinessConfig;
  updatedAt: Date;
  expiresAt: number;
}

export class TenantConfigService {
  private cache = new Map<string, CachedTenantConfig>();
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(private prisma: PrismaClient) {}

  /**
   * Loads the configuration for a specific tenant.
   * Ensures tenant isolation by strictly scoping to tenantId.
   * Checks authoritative DB updatedAt to guarantee multi-replica consistency.
   * Applies generic defaults for missing values.
   */
  async getConfig(tenantId: string): Promise<BusinessConfig> {
    const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
    const cached = isTest ? undefined : this.cache.get(tenantId);

    if (cached && Date.now() < cached.expiresAt) {
      try {
        // Lightweight authoritative version check
        const versionRecord = await this.prisma.tenantConfig.findUnique({
          where: { tenantId },
          select: { updatedAt: true }
        });

        if (!versionRecord) {
          this.cache.delete(tenantId);
          throw new Error(`Configuration not found for tenant: ${tenantId}`);
        }

        // If updatedAt matches, cache is fresh and consistent across all replicas
        if (versionRecord.updatedAt.getTime() === cached.updatedAt.getTime()) {
          return JSON.parse(JSON.stringify(cached.config));
        }
        // If updatedAt changed, fall through to reload full config
      } catch (err: any) {
        if (err.message && err.message.startsWith('Configuration not found')) {
          throw err;
        }
        // If DB is temporarily down, serve unexpired cached config as resilience fallback
        return JSON.parse(JSON.stringify(cached.config));
      }
    }

    const record = await this.prisma.tenantConfig.findUnique({
      where: { tenantId },
    });

    if (!record) {
      this.cache.delete(tenantId);
      throw new Error(`Configuration not found for tenant: ${tenantId}`);
    }

    const rawConfig = record.config as Record<string, any>;
    
    // Deep merge rawConfig into defaults to ensure a complete snapshot is always returned
    const finalConfig = this.mergeConfig(DEFAULT_BUSINESS_CONFIG, rawConfig);
    
    if (!isTest) {
      this.cache.set(tenantId, {
        config: finalConfig,
        updatedAt: record.updatedAt,
        expiresAt: Date.now() + this.CACHE_TTL_MS
      });
    }
    
    return JSON.parse(JSON.stringify(finalConfig));
  }

  /**
   * Updates the configuration and invalidates the cache.
   */
  async updateConfig(tenantId: string, newConfig: BusinessConfig): Promise<void> {
    await this.prisma.tenantConfig.upsert({
      where: { tenantId },
      update: { config: newConfig as any },
      create: { tenantId, config: newConfig as any }
    });
    this.cache.delete(tenantId);
  }

  /**
   * Clears the in-memory configuration cache.
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Safely merges localized prompt fields (greeting, fallback).
   * Normalizes string vs object defaults/overrides without spreading primitive strings.
   */
  private mergeLocalizedPrompt(defaultPrompt: any, overridePrompt: any): any {
    if (overridePrompt === null || overridePrompt === undefined) {
      return defaultPrompt;
    }

    if (typeof overridePrompt === 'object' && !Array.isArray(overridePrompt)) {
      if (Object.keys(overridePrompt).length === 0) {
        return defaultPrompt;
      }
      if (typeof defaultPrompt === 'object' && defaultPrompt !== null && !Array.isArray(defaultPrompt)) {
        return { ...defaultPrompt, ...overridePrompt };
      }
      if (typeof defaultPrompt === 'string') {
        return { en: defaultPrompt, ...overridePrompt };
      }
      return overridePrompt;
    }

    if (typeof overridePrompt === 'string') {
      const trimmed = overridePrompt.trim();
      if (!trimmed) {
        return defaultPrompt;
      }
      return overridePrompt;
    }

    return defaultPrompt;
  }

  /**
   * Merges plain scalar/object fields, ignoring null and undefined override values.
   */
  private mergePlainObject<T extends Record<string, any>>(defaults: T, overrides: any): T {
    if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
      return defaults;
    }
    const result = { ...defaults };
    for (const [key, value] of Object.entries(overrides)) {
      if (value !== null && value !== undefined) {
        (result as any)[key] = value;
      }
    }
    return result;
  }

  /**
   * Deep merges the overrides into the defaults.
   * Defensive implementation preventing string-spread corruption and nested object wiping.
   */
  private mergeConfig(defaults: BusinessConfig, overrides: Record<string, any>): BusinessConfig {
    if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
      return JSON.parse(JSON.stringify(defaults)) as BusinessConfig;
    }

    const merged = JSON.parse(JSON.stringify(defaults)) as BusinessConfig;

    if (overrides.identity && typeof overrides.identity === 'object') {
      merged.identity = this.mergePlainObject(defaults.identity, overrides.identity);
    }
    if (overrides.behavior && typeof overrides.behavior === 'object') {
      merged.behavior = this.mergePlainObject(defaults.behavior, overrides.behavior);
    }
    if (overrides.limits && typeof overrides.limits === 'object') {
      merged.limits = this.mergePlainObject(defaults.limits, overrides.limits);
    }
    if (overrides.prompts && typeof overrides.prompts === 'object') {
      for (const [key, value] of Object.entries(overrides.prompts)) {
        if (value === null || value === undefined) continue;
        if (key === 'greeting' || key === 'fallback') {
          merged.prompts[key] = this.mergeLocalizedPrompt(defaults.prompts[key], value);
        } else if (typeof value === 'string') {
          if (value.trim()) {
            (merged.prompts as any)[key] = value;
          }
        } else {
          (merged.prompts as any)[key] = value;
        }
      }
    }
    
    // Arrays or exact object replacements
    if (overrides.capabilities && typeof overrides.capabilities === 'object') {
      if (Array.isArray(overrides.capabilities.intents)) {
        merged.capabilities.intents = overrides.capabilities.intents;
      }
      if (Array.isArray(overrides.capabilities.faq)) {
        merged.capabilities.faq = overrides.capabilities.faq;
      }
      if (typeof overrides.capabilities.imageEnabled === 'boolean') {
        merged.capabilities.imageEnabled = overrides.capabilities.imageEnabled;
      }
    }
    
    if (overrides.workflows && typeof overrides.workflows === 'object' && !Array.isArray(overrides.workflows)) {
      // Completely override workflows if provided
      merged.workflows = overrides.workflows;
    }
    
    if (overrides.knowledge && typeof overrides.knowledge === 'object') {
      const { ingestion, ...restKnowledge } = overrides.knowledge;
      merged.knowledge = this.mergePlainObject(defaults.knowledge, restKnowledge);
      if (ingestion && typeof ingestion === 'object' && !Array.isArray(ingestion)) {
        merged.knowledge.ingestion = this.mergePlainObject(defaults.knowledge.ingestion, ingestion);
      }
    }

    if (overrides.llm && typeof overrides.llm === 'object') {
      merged.llm = this.mergePlainObject(defaults.llm, overrides.llm);
    }

    if (Array.isArray(overrides.catalog)) {
      merged.catalog = overrides.catalog;
    }
    if (Array.isArray(overrides.customers)) {
      merged.customers = overrides.customers;
    }
    if (Array.isArray(overrides.orders)) {
      merged.orders = overrides.orders;
    }
    if (Array.isArray(overrides.shippingZones)) {
      merged.shippingZones = overrides.shippingZones;
    }
    if (Array.isArray(overrides.promotions)) {
      merged.promotions = overrides.promotions;
    }

    if (typeof overrides.defaultWorkflowId === 'string' && overrides.defaultWorkflowId.trim()) {
      (merged as any).defaultWorkflowId = overrides.defaultWorkflowId;
    }

    return merged;
  }
}
