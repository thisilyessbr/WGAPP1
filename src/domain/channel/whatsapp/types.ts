export interface NormalizedWhatsAppMessage {
  phoneNumberId: string;
  waId: string;
  wamid: string;
  message: string;
  timestamp: number;
  contactName?: string;
  rawType: string;
}

export interface WhatsAppVerificationQuery {
  'hub.mode'?: string;
  'hub.verify_token'?: string;
  'hub.challenge'?: string;
}

export interface WhatsAppWebhookOptions {
  appSecret?: string;
  verifyToken?: string;
  idempotencyTtlSeconds?: number;
  prisma?: import('@prisma/client').PrismaClient;
}

export interface NormalizedWhatsAppStatus {
  phoneNumberId: string;
  wamid: string;
  recipientWaId: string;
  status: string; // 'sent' | 'delivered' | 'read' | 'failed'
  timestamp: number;
  errorCode?: number;
  errorMessage?: string;
  raw?: any;
}
