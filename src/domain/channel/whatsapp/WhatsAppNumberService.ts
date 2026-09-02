import { PrismaClient, WhatsAppBusinessNumber } from '@prisma/client';

export interface RegisterWhatsAppNumberParams {
  tenantId: string;
  accountId: string;
  phoneNumberId: string;
  wabaId?: string | null;
  displayPhoneNumber?: string | null;
  status?: string;
  enabled?: boolean;
}

export interface WhatsAppNumberMapping {
  id: string;
  tenantId: string;
  accountId: string;
  phoneNumberId: string;
  wabaId: string | null;
  displayPhoneNumber: string | null;
  status: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export class WhatsAppNumberService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Registers or updates a WhatsApp Business Phone Number mapping to a specific Account.
   * Enforces:
   * 1. phoneNumberId must be valid and non-empty.
   * 2. accountId must belong to tenantId.
   * 3. phoneNumberId cannot be stolen by another tenant or another account.
   */
  async registerNumber(params: RegisterWhatsAppNumberParams): Promise<WhatsAppBusinessNumber> {
    const { tenantId, accountId, phoneNumberId, wabaId, displayPhoneNumber, status = 'CONNECTED', enabled = true } = params;

    if (!tenantId || typeof tenantId !== 'string' || !tenantId.trim()) {
      throw new Error('tenantId is required');
    }
    if (!accountId || typeof accountId !== 'string' || !accountId.trim()) {
      throw new Error('accountId is required');
    }
    if (!phoneNumberId || typeof phoneNumberId !== 'string' || !phoneNumberId.trim()) {
      throw new Error('phoneNumberId is required');
    }

    const trimmedTenantId = tenantId.trim();
    const trimmedAccountId = accountId.trim();
    const trimmedPhoneNumberId = phoneNumberId.trim();

    // 1. Verify Account exists and belongs to Tenant
    const account = await this.prisma.account.findUnique({
      where: { id: trimmedAccountId }
    });

    if (!account || account.tenantId !== trimmedTenantId) {
      throw new Error(`Account [${trimmedAccountId}] not found for tenant [${trimmedTenantId}]`);
    }

    // 2. Check if phoneNumberId is already registered
    const existing = await this.prisma.whatsAppBusinessNumber.findUnique({
      where: { phoneNumberId: trimmedPhoneNumberId }
    });

    if (existing) {
      if (existing.tenantId !== trimmedTenantId || existing.accountId !== trimmedAccountId) {
        throw new Error(`phoneNumberId [${trimmedPhoneNumberId}] is already registered to another account or tenant`);
      }
      // Update existing record for the same account
      return this.prisma.whatsAppBusinessNumber.update({
        where: { phoneNumberId: trimmedPhoneNumberId },
        data: {
          wabaId: wabaId?.trim() || existing.wabaId,
          displayPhoneNumber: displayPhoneNumber?.trim() || existing.displayPhoneNumber,
          status: status || existing.status,
          enabled
        }
      });
    }

    // 3. Create new mapping
    return this.prisma.whatsAppBusinessNumber.create({
      data: {
        tenantId: trimmedTenantId,
        accountId: trimmedAccountId,
        phoneNumberId: trimmedPhoneNumberId,
        wabaId: wabaId?.trim() || null,
        displayPhoneNumber: displayPhoneNumber?.trim() || null,
        status,
        enabled
      }
    });
  }

  /**
   * Resolves a WhatsApp phoneNumberId to its mapped tenantId and accountId.
   * Returns null if not found, or if the number is disabled and requireEnabled is true.
   */
  async resolveAccountByPhoneNumberId(
    phoneNumberId: string,
    options: { requireEnabled?: boolean } = { requireEnabled: true }
  ): Promise<WhatsAppNumberMapping | null> {
    if (!phoneNumberId || typeof phoneNumberId !== 'string' || !phoneNumberId.trim()) {
      return null;
    }

    const record = await this.prisma.whatsAppBusinessNumber.findUnique({
      where: { phoneNumberId: phoneNumberId.trim() }
    });

    if (!record) {
      return null;
    }

    if (options.requireEnabled && !record.enabled) {
      return null;
    }

    return record;
  }

  /**
   * Lists all WhatsApp business numbers registered for a specific Account.
   */
  async listNumbersByAccount(tenantId: string, accountId: string): Promise<WhatsAppBusinessNumber[]> {
    if (!tenantId || !accountId) return [];

    return this.prisma.whatsAppBusinessNumber.findMany({
      where: {
        tenantId: tenantId.trim(),
        accountId: accountId.trim()
      },
      orderBy: { createdAt: 'desc' }
    });
  }

  /**
   * Sets the enabled status of a WhatsApp business number.
   * Enforces tenant boundary validation.
   */
  async setNumberEnabled(tenantId: string, phoneNumberId: string, enabled: boolean): Promise<WhatsAppBusinessNumber> {
    if (!tenantId || !phoneNumberId) {
      throw new Error('tenantId and phoneNumberId are required');
    }

    const record = await this.prisma.whatsAppBusinessNumber.findUnique({
      where: { phoneNumberId: phoneNumberId.trim() }
    });

    if (!record || record.tenantId !== tenantId.trim()) {
      throw new Error(`WhatsAppBusinessNumber [${phoneNumberId}] not found for tenant [${tenantId}]`);
    }

    return this.prisma.whatsAppBusinessNumber.update({
      where: { phoneNumberId: phoneNumberId.trim() },
      data: { enabled }
    });
  }

  /**
   * Deletes a WhatsApp business number mapping.
   * Enforces tenant boundary validation.
   */
  async deleteNumber(tenantId: string, phoneNumberId: string): Promise<void> {
    if (!tenantId || !phoneNumberId) {
      throw new Error('tenantId and phoneNumberId are required');
    }

    const record = await this.prisma.whatsAppBusinessNumber.findUnique({
      where: { phoneNumberId: phoneNumberId.trim() }
    });

    if (!record || record.tenantId !== tenantId.trim()) {
      throw new Error(`WhatsAppBusinessNumber [${phoneNumberId}] not found for tenant [${tenantId}]`);
    }

    await this.prisma.whatsAppBusinessNumber.delete({
      where: { phoneNumberId: phoneNumberId.trim() }
    });
  }
}
