import { PrismaClient } from '@prisma/client';
import { BusinessConfig, DEFAULT_BUSINESS_CONFIG } from './BusinessConfig';

export class TenantConfigService {
  private cache = new Map<string, { config: BusinessConfig; expiresAt: number }>();
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(private prisma: PrismaClient) {}

  /**
   * Loads the configuration for a specific tenant.
   * Ensures tenant isolation by strictly scoping to tenantId.
   * Applies generic defaults for missing values.
   */
  async getConfig(tenantId: string): Promise<BusinessConfig> {
    const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
    if (!isTest) {
      const cached = this.cache.get(tenantId);
      if (cached && Date.now() < cached.expiresAt) {
        return JSON.parse(JSON.stringify(cached.config));
      }
    }

    const record = await this.prisma.tenantConfig.findUnique({
      where: { tenantId },
    });

    if (!record) {
      throw new Error(`Configuration not found for tenant: ${tenantId}`);
    }

    const rawConfig = record.config as Record<string, any>;
    
    // Deep merge rawConfig into defaults to ensure a complete snapshot is always returned
    const finalConfig = this.mergeConfig(DEFAULT_BUSINESS_CONFIG, rawConfig);
    
    if (!isTest) {
      this.cache.set(tenantId, { config: finalConfig, expiresAt: Date.now() + this.CACHE_TTL_MS });
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
   * Deep merges the overrides into the defaults.
   * Simplistic implementation suitable for the defined BusinessConfig structure.
   */
  private mergeConfig(defaults: BusinessConfig, overrides: Record<string, any>): BusinessConfig {
    const merged = JSON.parse(JSON.stringify(defaults)) as BusinessConfig;

    if (overrides.identity) Object.assign(merged.identity, overrides.identity);
    if (overrides.behavior) Object.assign(merged.behavior, overrides.behavior);
    if (overrides.limits) Object.assign(merged.limits, overrides.limits);
    if (overrides.prompts) {
      Object.assign(merged.prompts, overrides.prompts);
      if (overrides.prompts.greeting && typeof overrides.prompts.greeting === 'object') {
        merged.prompts.greeting = { ...(defaults.prompts.greeting as any), ...overrides.prompts.greeting };
      }
      if (overrides.prompts.fallback && typeof overrides.prompts.fallback === 'object') {
        merged.prompts.fallback = { ...(defaults.prompts.fallback as any), ...overrides.prompts.fallback };
      }
    }
    
    // Arrays or exact object replacements
    if (overrides.capabilities) {
      if (overrides.capabilities.intents) {
        merged.capabilities.intents = overrides.capabilities.intents;
      }
      if (overrides.capabilities.faq) {
        merged.capabilities.faq = overrides.capabilities.faq;
      }
      if (overrides.capabilities.imageEnabled !== undefined) {
        merged.capabilities.imageEnabled = overrides.capabilities.imageEnabled;
      }
    }
    
    if (overrides.workflows) {
      // Completely override workflows if provided
      merged.workflows = overrides.workflows;
    }
    
    if (overrides.knowledge) Object.assign(merged.knowledge, overrides.knowledge);
    if (overrides.llm) Object.assign(merged.llm, overrides.llm);
    if (overrides.defaultWorkflowId) (merged as any).defaultWorkflowId = overrides.defaultWorkflowId;

    return merged;
  }
}
