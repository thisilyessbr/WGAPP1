import { ChannelConnection } from '@prisma/client';
import { ChannelTransport, ChannelStatus, SendMessageParams } from './ChannelTransport';
import { WhatsAppOutboundAdapter, OutboundSendResult } from '../whatsapp/WhatsAppOutboundAdapter';
import { logger } from '../../../utils/logger';

export class MetaCloudTransport implements ChannelTransport {
  public readonly provider = 'META_CLOUD';

  constructor(private outboundAdapter: WhatsAppOutboundAdapter) {}

  async sendText(params: SendMessageParams): Promise<OutboundSendResult> {
    const { to, text, number, connection, tenantId, accountId, template } = params;

    // Verify connection matches tenant and account
    if (connection && (connection.tenantId !== tenantId || connection.accountId !== accountId)) {
      logger.error(`MetaCloudTransport: Connection tenant mismatch. Expected tenant [${tenantId}], got [${connection.tenantId}]`);
      return {
        success: false,
        error: 'Security Error: Connection does not belong to specified tenant/account',
        isRetryable: false
      };
    }

    if (template) {
      return this.outboundAdapter.sendTemplateMessage({
        phoneNumberId: number.phoneNumberId,
        to,
        template
      });
    }

    return this.outboundAdapter.sendTextMessage({
      phoneNumberId: number.phoneNumberId,
      to,
      text
    });
  }

  async getStatus(connection: ChannelConnection): Promise<ChannelStatus> {
    return {
      connected: connection.status === 'CONNECTED',
      status: connection.status,
      provider: this.provider,
      lastConnectedAt: connection.lastConnectedAt,
      lastError: connection.lastError
    };
  }

  async disconnect(connection: ChannelConnection): Promise<void> {
    logger.info(`MetaCloudTransport: Disconnecting connection [${connection.id}]`);
  }
}
