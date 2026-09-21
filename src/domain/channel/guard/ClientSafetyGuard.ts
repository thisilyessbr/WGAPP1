import { PrismaClient } from '@prisma/client';
import { WhatsAppNumberService } from '../whatsapp/WhatsAppNumberService';
import { logger } from '../../../utils/logger';
import { ConversationAutomationService } from '../../conversation/ConversationAutomationService';

export interface SafetyCheckParams {
  tenantId: string;
  accountId: string;
  phoneNumberId: string;
  recipientWaId: string;
  conversationId?: string;
  wamid?: string;
  consumeRateLimit?: boolean;
  handoffAcknowledgmentFor?: string;
}

export interface SafetyDecision {
  allowed: boolean;
  retryAfterSeconds?: number;
  reason?: string;
  code?: 'ALLOWED' | 'TENANT_MISMATCH' | 'NUMBER_PAUSED' | 'TENANT_PAUSED' | 'HUMAN_TAKEOVER' | 'RATE_LIMIT_EXCEEDED' | 'CIRCUIT_BREAKER_OPEN' | 'EMERGENCY_QR_STOPPED';
}

export interface ClientSafetyGuardConfig {
  maxMessagesPerMinute?: number; // Default: 30
  circuitBreakerThreshold?: number; // Default: 5 consecutive failures
  circuitBreakerWindowMs?: number; // Default: 5 minutes (300_000ms)
}

export class ClientSafetyGuard {
  private static emergencyQrStopped = false;
  private readonly maxMessagesPerMinute: number;
  private readonly circuitBreakerThreshold: number;
  private readonly circuitBreakerWindowMs: number;

  // Rate limiting tracker: key -> timestamps[]
  private rateLimitMap = new Map<string, number[]>();

  // Circuit breaker tracker: phoneNumberId -> { failureCount: number, firstFailureAt: number, broken: boolean }
  private circuitMap = new Map<string, { failureCount: number; firstFailureAt: number; broken: boolean }>();

  private automationService: ConversationAutomationService;

  constructor(
    private prisma: PrismaClient,
    private numberService?: WhatsAppNumberService,
    config: ClientSafetyGuardConfig = {},
    automationService?: ConversationAutomationService
  ) {
    this.maxMessagesPerMinute = config.maxMessagesPerMinute ?? 30;
    this.circuitBreakerThreshold = config.circuitBreakerThreshold ?? 5;
    this.circuitBreakerWindowMs = config.circuitBreakerWindowMs ?? 300_000;
    this.automationService = automationService || new ConversationAutomationService(prisma);
  }

  /**
   * Sanitizes metadata to ensure secrets, tokens, and passwords are never written to audit logs.
   */
  public sanitizeMetadata(meta: Record<string, unknown> | null | undefined): Record<string, unknown> {
    if (!meta) return {};
    const sanitized: Record<string, unknown> = {};
    const forbiddenKeys = ['token', 'secret', 'password', 'key', 'auth', 'credentials', 'accesstoken'];

    for (const [k, v] of Object.entries(meta)) {
      const lower = k.toLowerCase();
      if (forbiddenKeys.some(fk => lower.includes(fk))) {
        sanitized[k] = '[REDACTED]';
      } else if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
        sanitized[k] = this.sanitizeMetadata(v as Record<string, unknown>);
      } else {
        sanitized[k] = v;
      }
    }
    return sanitized;
  }

  /**
   * Records a security/administrative audit event in the database without leaking secrets.
   */
  async recordAuditEvent(params: {
    tenantId: string;
    accountId?: string | null;
    connectionId?: string | null;
    phoneNumberId?: string | null;
    conversationId?: string | null;
    actorId?: string | null;
    action: string;
    metadata?: Record<string, unknown> | null;
  }): Promise<void> {
    try {
      const safeMeta = this.sanitizeMetadata(params.metadata);
      await this.prisma.channelAuditEvent.create({
        data: {
          tenantId: params.tenantId,
          accountId: params.accountId || null,
          connectionId: params.connectionId || null,
          phoneNumberId: params.phoneNumberId || null,
          conversationId: params.conversationId || null,
          actorId: params.actorId || 'system',
          action: params.action,
          metadata: safeMeta as any
        }
      });
    } catch (err: any) {
      logger.error(`ClientSafetyGuard: Failed to write audit event: ${err.message || err}`);
    }
  }

  /**
   * Evaluates all safety checks prior to bot outbound message delivery:
   * 1. Tenant/Account/Number boundary mismatch -> BLOCK + audit
   * 2. Tenant automation paused -> BLOCK
   * 3. Number paused or disabled -> BLOCK
   * 4. Human takeover active / Bot disabled -> BLOCK
   * 5. Rate limit exceeded -> BLOCK + alert
   * 6. Circuit breaker open -> BLOCK
   */
  async evaluateOutbound(params: SafetyCheckParams): Promise<SafetyDecision> {
    const { tenantId, accountId, phoneNumberId, recipientWaId, conversationId, consumeRateLimit = true } = params;

    // 1. Boundary Validation
    if (this.numberService) {
      const mapping = await this.numberService.resolveAccountByPhoneNumberId(phoneNumberId, { requireEnabled: false });
      if (!mapping) {
        await this.recordAuditEvent({
          tenantId,
          accountId,
          phoneNumberId,
          action: 'SECURITY_VIOLATION_UNKNOWN_NUMBER',
          metadata: { phoneNumberId }
        });
        return {
          allowed: false,
          code: 'TENANT_MISMATCH',
          reason: `Originating number [${phoneNumberId}] is not registered`
        };
      }

      if (mapping.tenantId !== tenantId || mapping.accountId !== accountId) {
        logger.error(`ClientSafetyGuard: Tenant mismatch detected! Requested [${tenantId}], belongs to [${mapping.tenantId}]`);
        await this.recordAuditEvent({
          tenantId,
          accountId,
          phoneNumberId,
          action: 'SECURITY_VIOLATION_CROSS_TENANT_ATTEMPT',
          metadata: { attemptedTenant: tenantId, actualTenant: mapping.tenantId }
        });
        return {
          allowed: false,
          code: 'TENANT_MISMATCH',
          reason: 'Security violation: Tenant/Account does not own this phone number'
        };
      }

      // Check Emergency QR Stop for QR transport
      const isQr = mapping.transport === 'QR_WEB' || mapping.connection?.provider === 'QR_WEB';
      if (isQr) {
        const qrStopped = await this.isEmergencyQrStopped();
        if (qrStopped) {
          return {
            allowed: false,
            code: 'EMERGENCY_QR_STOPPED',
            reason: 'Emergency QR stop is active across all QR channels'
          };
        }
      }

      if (!mapping.enabled || mapping.status === 'PAUSED' || mapping.status === 'BLOCKED') {
        return {
          allowed: false,
          code: 'NUMBER_PAUSED',
          reason: `Phone number [${phoneNumberId}] is paused or disabled (status: ${mapping.status})`
        };
      }
    }

    // 2. Tenant Pause Check (PostgreSQL persistent DB source of truth)
    let isTenantPaused = false;
    try {
      const tenantConfig = await this.prisma.tenantConfig.findUnique({ where: { tenantId } });
      if (tenantConfig?.config && typeof tenantConfig.config === 'object' && !Array.isArray(tenantConfig.config)) {
        if ((tenantConfig.config as Record<string, unknown>).automationPaused === true) {
          isTenantPaused = true;
        }
      }
    } catch (err: any) {
      throw new Error('SAFETY_STATE_UNAVAILABLE');
    }

    if (isTenantPaused) {
      return {
        allowed: false,
        code: 'TENANT_PAUSED',
        reason: `Automation is paused for tenant [${tenantId}]`
      };
    }

    // 3. Circuit Breaker Check
    const circuit = this.circuitMap.get(phoneNumberId);
    if (circuit && circuit.broken) {
      // Check if window has elapsed to attempt half-open recovery
      if (Date.now() - circuit.firstFailureAt > this.circuitBreakerWindowMs) {
        this.circuitMap.delete(phoneNumberId);
      } else {
        return {
          allowed: false,
          code: 'CIRCUIT_BREAKER_OPEN',
          retryAfterSeconds: Math.max(1, Math.ceil((circuit.firstFailureAt + this.circuitBreakerWindowMs - Date.now()) / 1000) + 1),
          reason: `Circuit breaker is OPEN for number [${phoneNumberId}] due to repeated provider failures`
        };
      }
    }

    // 4. Human Takeover & Conversation Automation State Check
    let targetConversationId = conversationId;
    if (!targetConversationId && recipientWaId) {
      try {
        const customer = await this.prisma.customer.findFirst({
          where: {
            tenantId,
            OR: [
              { externalId: recipientWaId },
              { id: recipientWaId }
            ]
          }
        });
        if (customer) {
          const activeConv = await this.prisma.conversation.findFirst({
            where: {
              tenantId,
              customerId: customer.id,
              ...(accountId ? { accountId } : {}),
              status: { in: ['ACTIVE', 'HANDOFF_REQUESTED', 'HUMAN_ACTIVE', 'RESOLVED'] }
            },
            orderBy: { createdAt: 'desc' }
          });
          if (activeConv) {
            targetConversationId = activeConv.id;
          }
        }
      } catch (err: any) {
        throw new Error('SAFETY_STATE_UNAVAILABLE');
      }
    }

    if (targetConversationId) {
      const mayReply = await this.automationService.mayAutomatedAssistantReply(tenantId, targetConversationId);
      if (!mayReply) {
        const conv = await this.prisma.conversation.findUnique({
          where: { id: targetConversationId },
          select: { humanRequested: true, status: true }
        });
        let isAcknowledgment = false;
        if (conv?.status === 'HANDOFF_REQUESTED' && params.handoffAcknowledgmentFor) {
          const acknowledgment = await this.prisma.message.findFirst({
            where: {
              tenantId,
              conversationId: targetConversationId,
              role: 'ASSISTANT',
              AND: [
                { metadata: { path: ['responseType'], equals: 'HANDOFF' } },
                { metadata: { path: ['externalMessageId'], equals: params.handoffAcknowledgmentFor } }
              ]
            }
          });
          isAcknowledgment = Boolean(acknowledgment);
        }

        if (!isAcknowledgment) {
          logger.info(`ClientSafetyGuard: Bot reply suppressed by automation policy for conversation [${targetConversationId}]`);
          return {
            allowed: false,
            code: 'HUMAN_TAKEOVER',
            reason: conv?.status === 'HUMAN_ACTIVE'
              ? 'Human takeover active on this conversation'
              : 'Human agent handoff requested on conversation'
          };
        }
      }
    }

    // 5. Rate Limit Check (per recipientWaId + phoneNumberId)
    if (!consumeRateLimit) {
      return { allowed: true, code: 'ALLOWED' };
    }

    const rateKey = `${phoneNumberId}:${recipientWaId}`;
    const now = Date.now();
    const windowStart = now - 60_000;
    const timestamps = (this.rateLimitMap.get(rateKey) || []).filter(t => t > windowStart);

    if (timestamps.length >= this.maxMessagesPerMinute) {
      logger.warn(`ClientSafetyGuard: Rate limit exceeded for recipient [${recipientWaId}] on [${phoneNumberId}]`);
      await this.recordAuditEvent({
        tenantId,
        accountId,
        phoneNumberId,
        conversationId,
        action: 'RATE_LIMIT_EXCEEDED',
        metadata: { recipientWaId, count: timestamps.length }
      });
      return {
        allowed: false,
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfterSeconds: Math.max(1, Math.ceil((timestamps[0] + 60_000 - now) / 1000) + 1),
        reason: `Rate limit of ${this.maxMessagesPerMinute} msgs/min exceeded for recipient`
      };
    }

    // Record rate timestamp
    timestamps.push(now);
    this.rateLimitMap.set(rateKey, timestamps);

    return { allowed: true, code: 'ALLOWED' };
  }

  /**
   * Records a provider failure to update the circuit breaker.
   */
  recordProviderFailure(phoneNumberId: string): void {
    const now = Date.now();
    const current = this.circuitMap.get(phoneNumberId) || { failureCount: 0, firstFailureAt: now, broken: false };

    if (now - current.firstFailureAt > this.circuitBreakerWindowMs) {
      current.failureCount = 1;
      current.firstFailureAt = now;
      current.broken = false;
    } else {
      current.failureCount++;
    }

    if (current.failureCount >= this.circuitBreakerThreshold) {
      current.broken = true;
      logger.error(`ClientSafetyGuard: Circuit breaker TRIPPED for phoneNumberId [${phoneNumberId}] after ${current.failureCount} consecutive failures`);
    }

    this.circuitMap.set(phoneNumberId, current);
  }

  /**
   * Resets circuit breaker upon successful provider delivery.
   */
  recordProviderSuccess(phoneNumberId: string): void {
    this.circuitMap.delete(phoneNumberId);
  }

  // --- Kill Switch Controls ---

  async pauseNumber(tenantId: string, phoneNumberId: string, actorId?: string): Promise<void> {
    const record = await this.prisma.whatsAppBusinessNumber.findUnique({ where: { phoneNumberId } });
    if (!record || record.tenantId !== tenantId) {
      throw new Error(`Number [${phoneNumberId}] not found for tenant [${tenantId}]`);
    }

    await this.prisma.whatsAppBusinessNumber.update({
      where: { phoneNumberId },
      data: { status: 'PAUSED', enabled: false }
    });

    await this.recordAuditEvent({
      tenantId,
      accountId: record.accountId,
      phoneNumberId,
      actorId,
      action: 'NUMBER_PAUSED'
    });
  }

  async resumeNumber(tenantId: string, phoneNumberId: string, actorId?: string): Promise<void> {
    const record = await this.prisma.whatsAppBusinessNumber.findUnique({ where: { phoneNumberId } });
    if (!record || record.tenantId !== tenantId) {
      throw new Error(`Number [${phoneNumberId}] not found for tenant [${tenantId}]`);
    }

    if (!record.connectionId) {
      throw new Error(`Number [${phoneNumberId}] cannot be resumed without an isolated channel connection`);
    }
    const connection = await this.prisma.channelConnection.findUnique({ where: { id: record.connectionId } });
    if (!connection || connection.tenantId !== tenantId || !connection.enabled || connection.status !== 'CONNECTED') {
      throw new Error(`Number [${phoneNumberId}] cannot be resumed because its channel connection is not connected`);
    }

    await this.prisma.whatsAppBusinessNumber.update({
      where: { phoneNumberId },
      data: { status: 'CONNECTED', enabled: true }
    });

    this.recordProviderSuccess(phoneNumberId);

    await this.recordAuditEvent({
      tenantId,
      accountId: record.accountId,
      phoneNumberId,
      actorId,
      action: 'NUMBER_RESUMED'
    });
  }

  async setHumanTakeover(
    tenantId: string,
    conversationId: string,
    humanTakeover: boolean,
    actorId?: string
  ): Promise<void> {
    const conv = await this.prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!conv || conv.tenantId !== tenantId) {
      throw new Error(`Conversation [${conversationId}] not found for tenant [${tenantId}]`);
    }

    await this.prisma.$transaction(async tx => {
      await tx.conversationAutomationState.upsert({
        where: { conversationId },
        create: {
          tenantId,
          accountId: conv.accountId,
          conversationId,
          humanTakeover,
          botEnabled: !humanTakeover,
          updatedBy: actorId || 'human-agent'
        },
        update: {
          humanTakeover,
          botEnabled: !humanTakeover,
          updatedBy: actorId || 'human-agent'
        }
      });

      await tx.conversation.update({
        where: { id: conversationId },
        data: { humanRequested: humanTakeover, humanRequestedAt: humanTakeover ? new Date() : null }
      });

      if (!humanTakeover) {
        await tx.conversation.updateMany({
          where: { id: conversationId, tenantId, status: { in: ['HUMAN_ACTIVE', 'HANDOFF_REQUESTED'] } },
          data: { status: 'ACTIVE' }
        });
    }
    });

    await this.recordAuditEvent({
      tenantId,
      accountId: conv.accountId,
      conversationId,
      actorId,
      action: humanTakeover ? 'HUMAN_TAKEOVER_ACTIVATED' : 'BOT_AUTOMATION_RESUMED'
    });
  }

  async setTenantAutomationPaused(tenantId: string, paused: boolean, reason?: string, actorId?: string): Promise<void> {
    const existingConfig = await this.prisma.tenantConfig.findUnique({ where: { tenantId } });
    const baseConfig = (existingConfig?.config && typeof existingConfig.config === 'object' && !Array.isArray(existingConfig.config))
      ? (existingConfig.config as Record<string, unknown>)
      : {};
    const newConfig = { ...baseConfig, automationPaused: paused };
    await this.prisma.tenantConfig.upsert({
      where: { tenantId },
      create: { tenantId, config: newConfig as any },
      update: { config: newConfig as any }
    });

    await this.recordAuditEvent({
      tenantId,
      actorId,
      action: paused ? 'TENANT_AUTOMATION_PAUSED' : 'TENANT_AUTOMATION_RESUMED',
      metadata: { reason }
    });
  }

  async setEmergencyQrStop(stopped: boolean, tenantId?: string): Promise<void> {
    if (stopped) {
      await this.prisma.whatsAppIdempotencyKey.upsert({
          where: { key: 'system:emergency_qr_stopped' },
          create: {
            key: 'system:emergency_qr_stopped',
            expiresAt: new Date(Date.now() + 100 * 365 * 24 * 3600 * 1000)
          },
          update: {
            expiresAt: new Date(Date.now() + 100 * 365 * 24 * 3600 * 1000)
          }
      });
    } else {
      await this.prisma.whatsAppIdempotencyKey.deleteMany({
          where: { key: 'system:emergency_qr_stopped' }
      });
    }

    ClientSafetyGuard.emergencyQrStopped = stopped;

    logger.warn(`ClientSafetyGuard: Emergency QR stop status persisted to [${stopped}]`);

    await this.recordAuditEvent({
      tenantId: tenantId || 'system',
      action: stopped ? 'EMERGENCY_QR_STOP_ACTIVATED' : 'EMERGENCY_QR_STOP_CLEARED',
      metadata: { stopped }
    });
  }

  async isEmergencyQrStopped(): Promise<boolean> {
    try {
      const record = await this.prisma.whatsAppIdempotencyKey.findUnique({
        where: { key: 'system:emergency_qr_stopped' }
      });
      const persisted = Boolean(record && record.expiresAt > new Date());
      ClientSafetyGuard.emergencyQrStopped = persisted;
      return persisted;
    } catch {
      return true;
    }
  }

  static setEmergencyQrStop(stopped: boolean): void {
    ClientSafetyGuard.emergencyQrStopped = stopped;
    logger.warn(`ClientSafetyGuard: Emergency QR stop status set to [${stopped}]`);
  }

  static isEmergencyQrStopped(): boolean {
    return ClientSafetyGuard.emergencyQrStopped;
  }
}
