import { WhatsAppNumberService } from '../whatsapp/WhatsAppNumberService';
import { ChannelTransport } from './ChannelTransport';
import { OutboundSendResult, OutboundTemplateRequest } from '../whatsapp/WhatsAppOutboundAdapter';
import { logger } from '../../../utils/logger';

export interface RouteOutboundParams {
  tenantId: string;
  accountId: string;
  phoneNumberId: string;
  to: string;
  text: string;
  template?: OutboundTemplateRequest;
}

export class ChannelRouter {
  private transports = new Map<string, ChannelTransport>();

  constructor(
    private numberService: WhatsAppNumberService,
    transports: ChannelTransport[] = []
  ) {
    for (const transport of transports) {
      this.registerTransport(transport);
    }
  }

  registerTransport(transport: ChannelTransport): void {
    this.transports.set(transport.provider, transport);
  }

  getTransport(provider: string): ChannelTransport | undefined {
    return this.transports.get(provider);
  }

  /**
   * Routes an outbound message strictly to the transport and connection of the originating phone number.
   * Enforces:
   * 1. Resolves originating number and its ChannelConnection.
   * 2. Strict tenant and account boundary validation.
   * 3. Unknown, disabled, or mismatched transports are rejected.
   * 4. Zero cross-tenant or cross-number fallback.
   */
  async routeOutbound(params: RouteOutboundParams): Promise<OutboundSendResult> {
    const { tenantId, accountId, phoneNumberId, to, text, template } = params;

    if (!tenantId || !accountId || !phoneNumberId || !to) {
      return {
        success: false,
        error: 'Missing required routing parameters (tenantId, accountId, phoneNumberId, to)',
        isRetryable: false
      };
    }

    // 1. Resolve number and connection
    const resolved = await this.numberService.resolveConnectionByPhoneNumberId(phoneNumberId, {
      requireEnabled: true
    });

    if (!resolved) {
      logger.error(`ChannelRouter: Originating phoneNumberId [${phoneNumberId}] is unknown or disabled for tenant [${tenantId}]`);
      return {
        success: false,
        error: `Originating phoneNumberId [${phoneNumberId}] is unknown or disabled`,
        isRetryable: false
      };
    }

    const { number, connection } = resolved;

    // 2. Strict Tenant / Account Boundary Validation
    if (number.tenantId !== tenantId || number.accountId !== accountId) {
      logger.error(`ChannelRouter: SECURITY BREACH ATTEMPT! Number [${phoneNumberId}] belongs to tenant [${number.tenantId}], but was requested by tenant [${tenantId}]`);
      return {
        success: false,
        error: 'SECURITY VIOLATION: Originating number does not belong to specified tenant/account',
        isRetryable: false
      };
    }

    if (connection && (connection.tenantId !== tenantId || connection.accountId !== accountId)) {
      logger.error(`ChannelRouter: SECURITY BREACH ATTEMPT! Connection [${connection.id}] tenant mismatch. Expected tenant [${tenantId}], got [${connection.tenantId}]`);
      return {
        success: false,
        error: 'SECURITY VIOLATION: Channel connection does not belong to specified tenant/account',
        isRetryable: false
      };
    }

    if (!connection) {
      logger.error(`ChannelRouter: Number [${phoneNumberId}] has no isolated channel connection`);
      return {
        success: false,
        error: 'CHANNEL_CONNECTION_REQUIRED: The number has no isolated channel connection',
        isRetryable: false
      };
    }

    if (!connection.enabled || connection.status !== 'CONNECTED') {
      return {
        success: false,
        error: `CHANNEL_NOT_CONNECTED: Connection status is ${connection.status}`,
        isRetryable: false
      };
    }

    // 3. Resolve Transport
    const transportKey = number.transport || connection?.provider || 'META_CLOUD';
    if (connection.provider !== transportKey) {
      return {
        success: false,
        error: 'SECURITY VIOLATION: Number transport does not match its connection provider',
        isRetryable: false
      };
    }

    // Emergency QR Stop safety boundary enforcement
    if (transportKey === 'QR_WEB') {
      const qrStopped = await this.numberService?.isEmergencyQrStopped?.();
      if (qrStopped) {
        logger.error(`ChannelRouter: Outbound delivery blocked for [${phoneNumberId}] - Emergency QR stop active`);
        return {
          success: false,
          error: 'EMERGENCY_QR_STOPPED: Outbound blocked by emergency QR kill switch',
          isRetryable: false
        };
      }
    }

    const transport = this.transports.get(transportKey);

    if (!transport) {
      logger.error(`ChannelRouter: Unsupported or unregistered transport [${transportKey}] for number [${phoneNumberId}]`);
      return {
        success: false,
        error: `Unknown or unregistered transport: ${transportKey}`,
        isRetryable: false
      };
    }

    // 4. Send strictly through resolved transport
    logger.info(`ChannelRouter: Routing outbound message for [${to}] via [${transportKey}] on number [${phoneNumberId}]`);
    return transport.sendText({
      to,
      text,
      number,
      connection,
      tenantId,
      accountId,
      template
    });
  }
}
