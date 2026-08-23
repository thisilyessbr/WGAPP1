import { PrismaClient } from '@prisma/client';
import { TenantConfigService } from './TenantConfigService';
import { BusinessConfig, resolveLocalizedPrompt } from './BusinessConfig';

export class AccountConfigService {
  constructor(
    private prisma: PrismaClient,
    private tenantConfigService: TenantConfigService
  ) {}

  /**
   * Resolves the effective runtime configuration for a given tenant and optional account.
   *
   * Rules:
   * 1. If accountId is not provided or empty, returns the tenant's base configuration.
   * 2. If accountId is provided, verifies that the account exists and belongs to the tenant.
   * 3. Overlays account-level overrides (identity, behavior, prompts, limits, etc.) on top of the base tenant config.
   * 4. Guarantees that base tenant config and shared defaults are never mutated.
   * 5. Fails safely if the account does not exist or cross-tenant access is attempted.
   */
  async getEffectiveConfig(tenantId: string, accountId?: string | null): Promise<BusinessConfig> {
    if (!tenantId) {
      throw new Error('tenantId is required to resolve configuration');
    }

    // 1. Fetch base tenant configuration
    const baseConfig = await this.tenantConfigService.getConfig(tenantId);

    // 2. If no accountId provided, return base tenant configuration directly
    if (!accountId || typeof accountId !== 'string' || !accountId.trim()) {
      return JSON.parse(JSON.stringify(baseConfig));
    }

    const trimmedAccountId = accountId.trim();

    // 3. Look up Account and verify tenant ownership
    const account = await this.prisma.account.findUnique({
      where: { id: trimmedAccountId }
    });

    if (!account || account.tenantId !== tenantId) {
      throw new Error(`Account [${trimmedAccountId}] not found for tenant [${tenantId}]`);
    }

    if (!account.enabled) {
      throw new Error(`Account [${trimmedAccountId}] is disabled`);
    }

    // 4. If account has no custom config, return base config
    const accountConfig = account.config as Record<string, any> | null;
    if (!accountConfig || typeof accountConfig !== 'object' || Array.isArray(accountConfig) || Object.keys(accountConfig).length === 0) {
      return JSON.parse(JSON.stringify(baseConfig));
    }

    // 5. Deep merge account overrides onto a deep clone of base config
    return this.mergeAccountOverrides(baseConfig, accountConfig);
  }

  /**
   * Merges account-level overrides on top of base tenant config without mutating baseConfig.
   */
  private mergeAccountOverrides(base: BusinessConfig, overrides: Record<string, any>): BusinessConfig {
    const merged: BusinessConfig = JSON.parse(JSON.stringify(base));

    // Identity overrides (botName, language, brand, etc.)
    if (overrides.identity && typeof overrides.identity === 'object' && !Array.isArray(overrides.identity)) {
      for (const [key, value] of Object.entries(overrides.identity)) {
        if (value !== null && value !== undefined) {
          (merged.identity as any)[key] = value;
        }
      }
    }

    // Behavior overrides (tone, verbosity, stayOnTopic, etc.)
    if (overrides.behavior && typeof overrides.behavior === 'object' && !Array.isArray(overrides.behavior)) {
      for (const [key, value] of Object.entries(overrides.behavior)) {
        if (value !== null && value !== undefined) {
          (merged.behavior as any)[key] = value;
        }
      }
    }

    // Limits overrides
    if (overrides.limits && typeof overrides.limits === 'object' && !Array.isArray(overrides.limits)) {
      for (const [key, value] of Object.entries(overrides.limits)) {
        if (value !== null && value !== undefined && typeof value === 'number' && value > 0) {
          (merged.limits as any)[key] = value;
        }
      }
    }

    // Prompts overrides
    if (overrides.prompts && typeof overrides.prompts === 'object' && !Array.isArray(overrides.prompts)) {
      for (const [key, value] of Object.entries(overrides.prompts)) {
        if (value === null || value === undefined) continue;
        if (key === 'greeting' || key === 'fallback') {
          if (typeof value === 'object' && !Array.isArray(value)) {
            const current = typeof (merged.prompts as any)[key] === 'object' ? (merged.prompts as any)[key] : { en: (merged.prompts as any)[key] };
            (merged.prompts as any)[key] = { ...current, ...value };
          } else if (typeof value === 'string' && value.trim()) {
            (merged.prompts as any)[key] = value;
          }
        } else if (typeof value === 'string' && value.trim()) {
          (merged.prompts as any)[key] = value;
        }
      }
    }

    // LLM overrides (e.g. model, temperature)
    if (overrides.llm && typeof overrides.llm === 'object' && !Array.isArray(overrides.llm)) {
      for (const [key, value] of Object.entries(overrides.llm)) {
        if (value !== null && value !== undefined) {
          (merged.llm as any)[key] = value;
        }
      }
    }

    // Capabilities overrides (e.g. ecommerceEnabled, faq)
    if (overrides.capabilities && typeof overrides.capabilities === 'object' && !Array.isArray(overrides.capabilities)) {
      merged.capabilities = {
        ...(merged.capabilities || {}),
        ...overrides.capabilities
      };
    }

    // Knowledge overrides (e.g. topK, minSimilarityScore)
    if (overrides.knowledge && typeof overrides.knowledge === 'object' && !Array.isArray(overrides.knowledge)) {
      merged.knowledge = {
        ...(merged.knowledge || {}),
        ...overrides.knowledge
      };
    }

    return merged;
  }
}
