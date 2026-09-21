import { ChannelConnection, WhatsAppBusinessNumber } from '@prisma/client';
import { OutboundSendResult, OutboundTemplateRequest } from '../whatsapp/WhatsAppOutboundAdapter';

export interface ChannelStatus {
  connected: boolean;
  status: string;
  provider: string;
  lastConnectedAt?: Date | null;
  lastError?: string | null;
}

export interface SendMessageParams {
  to: string;
  text: string;
  number: WhatsAppBusinessNumber;
  connection?: ChannelConnection | null;
  tenantId: string;
  accountId: string;
  template?: OutboundTemplateRequest;
}

export interface ChannelTransport {
  readonly provider: string;
  sendText(params: SendMessageParams): Promise<OutboundSendResult>;
  getStatus(connection: ChannelConnection): Promise<ChannelStatus>;
  disconnect(connection: ChannelConnection): Promise<void>;
}
