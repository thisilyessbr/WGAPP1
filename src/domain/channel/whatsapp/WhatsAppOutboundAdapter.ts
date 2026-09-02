import { logger } from '../../../utils/logger';

export interface OutboundMessage {
  recipientId: string;
  text: string;
  metadata?: Record<string, unknown>;
}

export interface OutboundTemplateRequest {
  name: string;
  languageCode: string;
  category?: 'UTILITY' | 'MARKETING' | 'AUTHENTICATION';
  components?: Array<{
    type: 'header' | 'body' | 'button';
    parameters: Array<{
      type: 'text' | 'image' | 'document' | 'video';
      text?: string;
      image?: { link: string };
    }>;
  }>;
}

export interface OutboundSendResult {
  success: boolean;
  providerMessageId?: string | null;
  error?: string | null;
  errorCode?: number | string | null;
  isRetryable?: boolean;
  sentAt?: number;
}

export interface WhatsAppOutboundConfig {
  graphApiVersion?: string; // Default: 'v22.0' (Official Meta Graph API recommended version)
  graphApiBaseUrl?: string; // Default: 'https://graph.facebook.com'
  defaultAccessToken?: string;
  maxRetries?: number; // Default: 3
  initialBackoffMs?: number; // Default: 300ms
  fetchFn?: typeof fetch; // Injectable fetch for automated testing / mocking
}

export class WhatsAppOutboundAdapter {
  private readonly version: string;
  private readonly baseUrl: string;
  private readonly defaultAccessToken?: string;
  private readonly maxRetries: number;
  private readonly initialBackoffMs: number;
  private readonly fetchFn: typeof fetch;

  // Retryable Meta error codes based on official Meta Cloud API documentation
  // 130429: Cloud API Message Throughput Reached (MPS rate limit)
  // 131056: Pair Rate Limit Hit (too many messages to same recipient in short window)
  // 131030: 429 Too Many Requests
  // 130472: Rate limit hit
  // 80007: Rate limit issue
  // 1: Temporary Meta internal service error
  private static readonly RETRYABLE_META_ERROR_CODES = new Set<number>([
    130429, 131056, 131030, 130472, 80007, 1
  ]);

  // Retryable HTTP status codes
  private static readonly RETRYABLE_HTTP_STATUSES = new Set<number>([
    408, 429, 500, 502, 503, 504
  ]);

  constructor(config: WhatsAppOutboundConfig = {}) {
    this.version = config.graphApiVersion || process.env.WHATSAPP_GRAPH_API_VERSION || 'v22.0';
    this.baseUrl = config.graphApiBaseUrl || process.env.WHATSAPP_GRAPH_API_BASE_URL || 'https://graph.facebook.com';
    this.defaultAccessToken = config.defaultAccessToken || process.env.WHATSAPP_ACCESS_TOKEN;
    this.maxRetries = config.maxRetries ?? 3;
    this.initialBackoffMs = config.initialBackoffMs ?? 300;
    this.fetchFn = config.fetchFn || globalThis.fetch;
  }

  /**
   * Sends a plain text message via Meta WhatsApp Cloud API.
   * Endpoint: POST https://graph.facebook.com/{version}/{phoneNumberId}/messages
   * Enforces:
   * 1. 0 LLM/AI interaction (pure outbound transport).
   * 2. Access token confidentiality (never logged).
   * 3. Bounded exponential backoff retry for transient/rate-limited errors.
   * 4. Immediate return for permanent errors without wasted retries.
   */
  async sendTextMessage(params: {
    phoneNumberId: string;
    to: string;
    text: string;
    accessToken?: string;
  }): Promise<OutboundSendResult> {
    const { phoneNumberId, to, text, accessToken } = params;

    if (!phoneNumberId || !phoneNumberId.trim()) {
      return {
        success: false,
        error: 'phoneNumberId is required',
        isRetryable: false
      };
    }

    if (!to || !to.trim()) {
      return {
        success: false,
        error: 'recipient phone number (to) is required',
        isRetryable: false
      };
    }

    if (!text || !text.trim()) {
      return {
        success: false,
        error: 'message text body is required',
        isRetryable: false
      };
    }

    const token = accessToken?.trim() || this.defaultAccessToken?.trim();
    if (!token) {
      logger.error(`WhatsAppOutboundAdapter: Missing access token for phoneNumberId [${phoneNumberId}]`);
      return {
        success: false,
        error: 'WHATSAPP_ACCESS_TOKEN is not configured',
        errorCode: 190,
        isRetryable: false
      };
    }

    const url = `${this.baseUrl}/${this.version}/${phoneNumberId.trim()}/messages`;
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: to.trim(),
      type: 'text',
      text: {
        body: text.trim()
      }
    };

    let attempt = 0;
    let lastError: string = 'Unknown network error';
    let lastErrorCode: number | string | null = null;
    let isRetryable = false;

    while (attempt < this.maxRetries) {
      attempt++;
      try {
        logger.info(`WhatsAppOutboundAdapter: Sending message to user [${to}] from phoneNumberId [${phoneNumberId}] (attempt ${attempt}/${this.maxRetries})`);

        const response = await this.fetchFn(url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });

        if (response.ok) {
          const data: any = await response.json().catch(() => ({}));
          const providerMessageId = data?.messages?.[0]?.id || null;
          logger.info(`WhatsAppOutboundAdapter: Successfully sent message to [${to}], Meta message ID: [${providerMessageId}]`);
          return {
            success: true,
            providerMessageId,
            sentAt: Date.now()
          };
        }

        // Handle error response from Meta
        const errorData: any = await response.json().catch(() => ({}));
        const metaError = errorData?.error;
        lastErrorCode = metaError?.code ?? response.status;
        lastError = metaError?.message || `Meta API returned HTTP ${response.status}`;

        isRetryable = this.isRetryableError(response.status, metaError?.code);

        logger.warn(`WhatsAppOutboundAdapter: Meta API error on attempt ${attempt}: HTTP ${response.status} (code: ${lastErrorCode}) - ${lastError} (retryable: ${isRetryable})`);

        if (!isRetryable) {
          // Permanent failure (e.g. 400 bad request, 401 unauthorized, 131051 unsupported type, 131047 >24h window)
          return {
            success: false,
            error: lastError,
            errorCode: lastErrorCode,
            isRetryable: false
          };
        }

        // If retryable and attempts remaining, apply exponential backoff
        if (attempt < this.maxRetries) {
          const backoff = this.initialBackoffMs * Math.pow(2, attempt - 1);
          await new Promise((resolve) => setTimeout(resolve, backoff));
        }
      } catch (networkErr: any) {
        lastError = networkErr?.message || String(networkErr);
        lastErrorCode = 'NETWORK_ERROR';
        isRetryable = true;
        logger.warn(`WhatsAppOutboundAdapter: Network failure on attempt ${attempt}: ${lastError}`);

        if (attempt < this.maxRetries) {
          const backoff = this.initialBackoffMs * Math.pow(2, attempt - 1);
          await new Promise((resolve) => setTimeout(resolve, backoff));
        }
      }
    }

    logger.error(`WhatsAppOutboundAdapter: Outbound sending failed after ${this.maxRetries} attempts for user [${to}]: ${lastError}`);
    return {
      success: false,
      error: lastError,
      errorCode: lastErrorCode,
      isRetryable
    };
  }

  /**
   * Sends a pre-approved template message via Meta WhatsApp Cloud API (e.g. outside 24h window).
   * Endpoint: POST https://graph.facebook.com/{version}/{phoneNumberId}/messages
   */
  async sendTemplateMessage(params: {
    phoneNumberId: string;
    to: string;
    template: OutboundTemplateRequest;
    accessToken?: string;
  }): Promise<OutboundSendResult> {
    const { phoneNumberId, to, template, accessToken } = params;

    if (!phoneNumberId || !phoneNumberId.trim()) {
      return { success: false, error: 'phoneNumberId is required', isRetryable: false };
    }
    if (!to || !to.trim()) {
      return { success: false, error: 'recipient phone number (to) is required', isRetryable: false };
    }
    if (!template || !template.name) {
      return { success: false, error: 'template name is required', isRetryable: false };
    }

    const token = accessToken?.trim() || this.defaultAccessToken?.trim();
    if (!token) {
      return { success: false, error: 'WHATSAPP_ACCESS_TOKEN is not configured', errorCode: 190, isRetryable: false };
    }

    const url = `${this.baseUrl}/${this.version}/${phoneNumberId.trim()}/messages`;
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: to.trim(),
      type: 'template',
      template: {
        name: template.name.trim(),
        language: {
          code: template.languageCode || 'en_US'
        },
        components: template.components || []
      }
    };

    let attempt = 0;
    let lastError: string = 'Unknown network error';
    let lastErrorCode: number | string | null = null;
    let isRetryable = false;

    while (attempt < this.maxRetries) {
      attempt++;
      try {
        logger.info(`WhatsAppOutboundAdapter: Sending template [${template.name}] to user [${to}] from [${phoneNumberId}] (attempt ${attempt}/${this.maxRetries})`);

        const response = await this.fetchFn(url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });

        if (response.ok) {
          const data: any = await response.json().catch(() => ({}));
          const providerMessageId = data?.messages?.[0]?.id || null;
          logger.info(`WhatsAppOutboundAdapter: Successfully sent template [${template.name}] to [${to}], Meta ID: [${providerMessageId}]`);
          return { success: true, providerMessageId, sentAt: Date.now() };
        }

        const errorData: any = await response.json().catch(() => ({}));
        const metaError = errorData?.error;
        lastErrorCode = metaError?.code ?? response.status;
        lastError = metaError?.message || `Meta API returned HTTP ${response.status}`;
        isRetryable = this.isRetryableError(response.status, metaError?.code);

        logger.warn(`WhatsAppOutboundAdapter: Meta API template error on attempt ${attempt}: HTTP ${response.status} (code: ${lastErrorCode}) - ${lastError} (retryable: ${isRetryable})`);

        if (!isRetryable) {
          return { success: false, error: lastError, errorCode: lastErrorCode, isRetryable: false };
        }

        if (attempt < this.maxRetries) {
          const backoff = this.initialBackoffMs * Math.pow(2, attempt - 1);
          await new Promise((resolve) => setTimeout(resolve, backoff));
        }
      } catch (networkErr: any) {
        lastError = networkErr?.message || String(networkErr);
        lastErrorCode = 'NETWORK_ERROR';
        isRetryable = true;

        if (attempt < this.maxRetries) {
          const backoff = this.initialBackoffMs * Math.pow(2, attempt - 1);
          await new Promise((resolve) => setTimeout(resolve, backoff));
        }
      }
    }

    return { success: false, error: lastError, errorCode: lastErrorCode, isRetryable };
  }

  /**
   * Evaluates whether a Meta API error is transient/retryable.
   */
  private isRetryableError(httpStatus: number, metaErrorCode?: number): boolean {
    if (WhatsAppOutboundAdapter.RETRYABLE_HTTP_STATUSES.has(httpStatus)) {
      return true;
    }
    if (typeof metaErrorCode === 'number' && WhatsAppOutboundAdapter.RETRYABLE_META_ERROR_CODES.has(metaErrorCode)) {
      return true;
    }
    return false;
  }
}
