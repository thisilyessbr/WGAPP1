import { PrismaClient } from '@prisma/client';
import { logger } from '../../utils/logger';

export interface DurableCustomerContext {
  preferredLanguage?: string;
  preferredName?: string;
  customerType?: string;
  consent?: boolean;
  metadata?: Record<string, any>;
  lastUpdated?: string;
}

export class CustomerContextService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Retrieves long-lived customer facts scoped by tenantId, customerId, and optional accountId.
   */
  async getCustomerContext(
    tenantId: string,
    customerId: string,
    accountId?: string | null
  ): Promise<DurableCustomerContext | null> {
    if (!tenantId || !customerId) return null;

    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, tenantId }
    });

    if (!customer) return null;

    const rawMeta = (customer as any).metadata as Record<string, any> | null;
    if (!rawMeta) return null;

    // If accountId is provided, look for account-scoped context first, then fallback to global
    if (accountId && rawMeta.accounts && rawMeta.accounts[accountId]) {
      return {
        ...rawMeta.global,
        ...rawMeta.accounts[accountId]
      };
    }

    return rawMeta.global || rawMeta;
  }

  /**
   * Updates durable customer context with verified facts.
   * Enforces strict scoping and audit timestamps.
   */
  async updateCustomerContext(
    tenantId: string,
    customerId: string,
    updates: Partial<DurableCustomerContext>,
    accountId?: string | null
  ): Promise<DurableCustomerContext> {
    if (!tenantId || !customerId) {
      throw new Error('TenantId and CustomerId are required for customer context update.');
    }

    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, tenantId }
    });

    if (!customer) {
      throw new Error(`Customer [${customerId}] not found in tenant [${tenantId}].`);
    }

    const existingMeta = ((customer as any).metadata as Record<string, any>) || { accounts: {}, global: {} };
    if (!existingMeta.accounts) existingMeta.accounts = {};
    if (!existingMeta.global) existingMeta.global = {};

    const timestamp = new Date().toISOString();
    const cleanUpdates = { ...updates, lastUpdated: timestamp };

    if (accountId) {
      existingMeta.accounts[accountId] = {
        ...(existingMeta.accounts[accountId] || {}),
        ...cleanUpdates
      };
    } else {
      existingMeta.global = {
        ...(existingMeta.global || {}),
        ...cleanUpdates
      };
    }

    await this.prisma.customer.update({
      where: { id: customerId },
      data: {
        metadata: existingMeta as any
      } as any
    });

    logger.info(`CustomerContextService: Updated durable context for customer [${customerId}]`, {
      tenantId,
      customerId,
      accountId: accountId || 'global'
    });

    return accountId
      ? { ...existingMeta.global, ...existingMeta.accounts[accountId] }
      : existingMeta.global;
  }
}
