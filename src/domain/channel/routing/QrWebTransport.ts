import { ChannelConnection } from '@prisma/client';
import { ChannelStatus, ChannelTransport, SendMessageParams } from './ChannelTransport';
import { OutboundSendResult } from '../whatsapp/WhatsAppOutboundAdapter';
import { QrSessionManager } from './QrSessionManager';

export class QrWebTransport implements ChannelTransport {
  readonly provider = 'QR_WEB';

  constructor(private readonly sessions: QrSessionManager) {}

  async sendText(params: SendMessageParams): Promise<OutboundSendResult> {
    if (!params.connection || params.connection.provider !== this.provider) {
      return { success: false, error: 'QR connection is missing or mismatched', isRetryable: false };
    }
    if (params.template) {
      return { success: false, error: 'Templates are supported only by the official Meta transport', isRetryable: false };
    }
    try {
      const sent = await this.sessions.send(params.connection.id, params.to, params.text);
      return { success: true, providerMessageId: sent.id, sentAt: Date.now() };
    } catch (error: any) {
      return { success: false, error: error.message || String(error), isRetryable: true };
    }
  }

  async getStatus(connection: ChannelConnection): Promise<ChannelStatus> {
    return {
      connected: connection.enabled && connection.status === 'CONNECTED',
      status: connection.status,
      provider: this.provider,
      lastConnectedAt: connection.lastConnectedAt,
      lastError: connection.lastError
    };
  }

  disconnect(connection: ChannelConnection): Promise<void> {
    return this.sessions.disconnect(connection);
  }
}
