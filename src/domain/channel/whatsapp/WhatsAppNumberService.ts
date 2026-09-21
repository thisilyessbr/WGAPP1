import { PrismaClient, WhatsAppBusinessNumber, ChannelConnection } from '@prisma/client';

export interface RegisterWhatsAppNumberParams {
  tenantId: string;
  accountId: string;
  phoneNumberId: string;
  wabaId?: string | null;
  displayPhoneNumber?: string | null;
  status?: string;
  enabled?: boolean;
  connectionId?: string | null;
  transport?: string;
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
  transport: string;
  connectionId: string | null;
  createdAt: Date;
  updatedAt: Date;
  connection?: ChannelConnection | null;
}

export interface CreateOrUpdateConnectionParams {
  id?: string;
  tenantId: string;
  accountId: string;
  provider?: string;
  connectionKey?: string;
  status?: string;
  enabled?: boolean;
  encryptedCredentials?: string | null;
  appId?: string | null;
  wabaId?: string | null;
  sessionKey?: string | null;
  lastConnectedAt?: Date | null;
  lastError?: string | null;
}

export class WhatsAppNumberService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Registers or updates a WhatsApp Business Phone Number mapping to a specific Account.
   * Enforces:
   * 1. phoneNumberId must be valid and non-empty.
   * 2. accountId must belong to tenantId.
   * 3. phoneNumberId cannot be stolen by another tenant or another account.
   * 4. connectionId (if provided) must belong to tenantId and accountId.
   */
  async registerNumber(params: RegisterWhatsAppNumberParams): Promise<WhatsAppBusinessNumber> {
    const {
      tenantId,
      accountId,
      phoneNumberId,
      wabaId,
      displayPhoneNumber,
      status = 'CONNECTED',
      enabled = true,
      connectionId = null,
      transport = 'META_CLOUD'
    } = params;

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
    const trimmedConnectionId = connectionId?.trim() || null;

    // 1. Verify Account exists and belongs to Tenant
    const account = await this.prisma.account.findUnique({
      where: { id: trimmedAccountId }
    });

    if (!account || account.tenantId !== trimmedTenantId) {
      throw new Error(`Account [${trimmedAccountId}] not found for tenant [${trimmedTenantId}]`);
    }

    // 2. If connectionId provided, verify it belongs to tenant and account
    if (trimmedConnectionId) {
      const connection = await this.prisma.channelConnection.findUnique({
        where: { id: trimmedConnectionId }
      });
      if (!connection || connection.tenantId !== trimmedTenantId || connection.accountId !== trimmedAccountId) {
        throw new Error(`ChannelConnection [${trimmedConnectionId}] does not belong to tenant [${trimmedTenantId}] and account [${trimmedAccountId}]`);
      }
    }

    // 3. Check if phoneNumberId is already registered
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
          enabled,
          transport: transport || existing.transport || 'META_CLOUD',
          connectionId: trimmedConnectionId !== undefined ? trimmedConnectionId : existing.connectionId
        }
      });
    }

    // 4. Create new mapping
    return this.prisma.whatsAppBusinessNumber.create({
      data: {
        tenantId: trimmedTenantId,
        accountId: trimmedAccountId,
        phoneNumberId: trimmedPhoneNumberId,
        wabaId: wabaId?.trim() || null,
        displayPhoneNumber: displayPhoneNumber?.trim() || null,
        status,
        enabled,
        transport: transport || 'META_CLOUD',
        connectionId: trimmedConnectionId
      }
    });
  }

  /**
   * Resolves a WhatsApp phoneNumberId to its mapped tenantId, accountId, transport, and connection.
   * Returns null if not found, or if the number is disabled and requireEnabled is true.
   */
  async resolveAccountByPhoneNumberId(
    phoneNumberId: string,
    options: { requireEnabled?: boolean; includeConnection?: boolean } = { requireEnabled: true }
  ): Promise<WhatsAppNumberMapping | null> {
    if (!phoneNumberId || typeof phoneNumberId !== 'string' || !phoneNumberId.trim()) {
      return null;
    }

    const record = await this.prisma.whatsAppBusinessNumber.findUnique({
      where: { phoneNumberId: phoneNumberId.trim() },
      include: {
        connection: options.includeConnection !== false
      }
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
   * Resolves a phone number and its attached ChannelConnection.
   */
  async resolveConnectionByPhoneNumberId(
    phoneNumberId: string,
    options: { requireEnabled?: boolean } = { requireEnabled: true }
  ): Promise<{ number: WhatsAppBusinessNumber; connection: ChannelConnection | null } | null> {
    const record = await this.resolveAccountByPhoneNumberId(phoneNumberId, {
      ...options,
      includeConnection: true
    });

    if (!record) return null;

    return {
      number: record,
      connection: record.connection || null
    };
  }

  /**
   * Creates or updates a ChannelConnection for a specific Tenant and Account.
   */
  async createOrUpdateConnection(params: CreateOrUpdateConnectionParams): Promise<ChannelConnection> {
    const {
      id,
      tenantId,
      accountId,
      provider = 'META_CLOUD',
      connectionKey,
      status = 'PENDING',
      enabled = true,
      encryptedCredentials,
      appId,
      wabaId,
      sessionKey,
      lastConnectedAt,
      lastError
    } = params;

    const trimmedTenantId = tenantId.trim();
    const trimmedAccountId = accountId.trim();
    const resolvedConnectionKey = (connectionKey || (provider === 'QR_WEB' ? sessionKey : wabaId) || 'default').trim();

    // Verify account belongs to tenant
    const account = await this.prisma.account.findUnique({
      where: { id: trimmedAccountId }
    });
    if (!account || account.tenantId !== trimmedTenantId) {
      throw new Error(`Account [${trimmedAccountId}] not found for tenant [${trimmedTenantId}]`);
    }

    const updateData: any = {
      status,
      enabled,
      ...(encryptedCredentials !== undefined ? { encryptedCredentials } : {}),
      ...(appId !== undefined ? { appId } : {}),
      ...(wabaId !== undefined ? { wabaId } : {}),
      ...(sessionKey !== undefined ? { sessionKey } : {}),
      ...(lastConnectedAt !== undefined ? { lastConnectedAt } : {}),
      ...(lastError !== undefined ? { lastError } : {})
    };

    if (id) {
      const existing = await this.prisma.channelConnection.findUnique({ where: { id } });
      if (existing) {
        if (existing.tenantId !== trimmedTenantId || existing.accountId !== trimmedAccountId) {
          throw new Error(`ChannelConnection [${existing.id}] does not belong to tenant [${trimmedTenantId}] or account [${trimmedAccountId}]`);
        }
        return this.prisma.channelConnection.update({
          where: { id: existing.id },
          data: updateData
        });
      }
    }

    return this.prisma.channelConnection.upsert({
      where: {
        tenantId_accountId_provider_connectionKey: {
          tenantId: trimmedTenantId,
          accountId: trimmedAccountId,
          provider,
          connectionKey: resolvedConnectionKey
        }
      },
      create: {
        ...(id ? { id } : {}),
        tenantId: trimmedTenantId,
        accountId: trimmedAccountId,
        provider,
        connectionKey: resolvedConnectionKey,
        status,
        enabled,
        encryptedCredentials: encryptedCredentials || null,
        appId: appId || null,
        wabaId: wabaId || null,
        sessionKey: sessionKey || null,
        lastConnectedAt: lastConnectedAt || null,
        lastError: lastError || null
      },
      update: updateData
    });
  }

  /**
   * Retrieves a ChannelConnection by ID, enforcing tenant scope.
   */
  async getConnection(connectionId: string, tenantId: string): Promise<ChannelConnection | null> {
    if (!connectionId || !tenantId) return null;

    const conn = await this.prisma.channelConnection.findUnique({
      where: { id: connectionId }
    });

    if (!conn || conn.tenantId !== tenantId.trim()) {
      return null;
    }

    return conn;
  }

  /**
   * Lists ChannelConnections for a tenant and optional account.
   */
  async listConnections(tenantId: string, accountId?: string): Promise<ChannelConnection[]> {
    if (!tenantId) return [];

    return this.prisma.channelConnection.findMany({
      where: {
        tenantId: tenantId.trim(),
        ...(accountId ? { accountId: accountId.trim() } : {})
      },
      orderBy: { createdAt: 'desc' }
    });
  }

  /**
   * Updates connection status and last error.
   */
  async updateConnectionStatus(
    connectionId: string,
    tenantId: string,
    status: string,
    lastError?: string | null
  ): Promise<ChannelConnection> {
    const allowedStatuses = new Set([
      'PENDING',
      'QR_REQUIRED',
      'CONNECTED',
      'RECONNECTING',
      'SUSPENDED',
      'DISCONNECTED',
      'FAILED'
    ]);
    if (!allowedStatuses.has(status)) {
      throw new Error(`Invalid channel connection status [${status}]`);
    }
    const conn = await this.getConnection(connectionId, tenantId);
    if (!conn) {
      throw new Error(`ChannelConnection [${connectionId}] not found for tenant [${tenantId}]`);
    }

    return this.prisma.channelConnection.update({
      where: { id: connectionId },
      data: {
        status,
        enabled: status === 'CONNECTED'
          ? true
          : ['FAILED', 'DISCONNECTED', 'SUSPENDED'].includes(status)
            ? false
            : conn.enabled,
        lastError: lastError !== undefined ? lastError : conn.lastError,
        lastConnectedAt: status === 'CONNECTED' ? new Date() : conn.lastConnectedAt
      }
    });
  }

  /** Disables every mapped number before removing credentials from a connection. */
  async disconnectConnection(connectionId: string, tenantId: string): Promise<ChannelConnection> {
    const conn = await this.getConnection(connectionId, tenantId);
    if (!conn) {
      throw new Error(`ChannelConnection [${connectionId}] not found for tenant [${tenantId}]`);
    }

    const [, disconnected] = await this.prisma.$transaction([
      this.prisma.whatsAppBusinessNumber.updateMany({
        where: { connectionId, tenantId: tenantId.trim() },
        data: { enabled: false, status: 'DISCONNECTED' }
      }),
      this.prisma.channelConnection.update({
        where: { id: connectionId },
        data: {
          status: 'DISCONNECTED',
          enabled: false,
          encryptedCredentials: null,
          lastError: null
        }
      })
    ]);

    return disconnected;
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

  /**
   * Checks whether global emergency QR stop is active in PostgreSQL.
   */
  async isEmergencyQrStopped(): Promise<boolean> {
    try {
      const record = await this.prisma.whatsAppIdempotencyKey.findUnique({
        where: { key: 'system:emergency_qr_stopped' }
      });
      return Boolean(record && record.expiresAt > new Date());
    } catch {
      // QR is optional and unofficial. If the shared safety state cannot be read,
      // block it until the database is healthy again.
      return true;
    }
  }
}
