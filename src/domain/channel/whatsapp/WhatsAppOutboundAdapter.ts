import { logger } from '../../../utils/logger';
import { WhatsAppNumberService } from './WhatsAppNumberService';
import { SecretBox } from '../../../core/security/SecretBox';
import {
  classifyMetaError,
  RETRYABLE_META_ERROR_CODES,
  RETRYABLE_HTTP_STATUSES
} from './WhatsAppErrorClassification';

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
  retryAfterSeconds?: number;
  sentAt?: number;
}

export interface WhatsAppOutboundConfig {
  graphApiVersion?: string; // Defaults to the current configured Meta Graph API version.
  graphApiBaseUrl?: string; // Default: 'https://graph.facebook.com'
  defaultAccessToken?: string;
  maxRetries?: number; // Default: 3
  initialBackoffMs?: number; // Default: 300ms
  fetchFn?: typeof fetch;
  numberService?: WhatsAppNumberService;
  secretBox?: SecretBox;
}

export class WhatsAppOutboundAdapter {
  private readonly version: string;
  private readonly baseUrl: string;
  private readonly defaultAccessToken?: string;
  private readonly maxRetries: number;
  private readonly initialBackoffMs: number;
  private readonly fetchFn: typeof fetch;
  private readonly numberService?: WhatsAppNumberService;
  private readonly secretBox?: SecretBox;

  constructor(config: WhatsAppOutboundConfig = {}) {
    this.version = config.graphApiVersion || process.env.WHATSAPP_GRAPH_API_VERSION || 'v26.0';
    this.baseUrl = config.graphApiBaseUrl || process.env.WHATSAPP_GRAPH_API_BASE_URL || 'https://graph.facebook.com';
    this.defaultAccessToken = config.defaultAccessToken || process.env.WHATSAPP_ACCESS_TOKEN;
    this.maxRetries = config.maxRetries ?? 3;
    this.initialBackoffMs = config.initialBackoffMs ?? 300;
    this.fetchFn = config.fetchFn || globalThis.fetch;
    this.numberService = config.numberService;

    if (config.secretBox) {
      this.secretBox = config.secretBox;
    } else {
      const encKey = process.env.ENCRYPTION_KEY || process.env.CREDENTIALS_ENCRYPTION_KEY || (process.env.NODE_ENV === 'test' ? 'test-encryption-key-32-bytes-long!' : '');
      if (encKey) {
        try {
          this.secretBox = new SecretBox({ key: encKey });
        } catch {
          this.secretBox = undefined;
        }
      }
    }
  }

  /**
   * Resolves the access token for a given phoneNumberId:
   * 1. Uses explicitly passed token if present.
   * 2. Resolves ChannelConnection via WhatsAppNumberService and decrypts credentials with SecretBox.
   * 3. Fails closed: Never falls back to default system token if client credentials fail.
   * Ensures token is never logged or exposed.
   */
  private async resolveToken(phoneNumberId: string, explicitToken?: string): Promise<string | null> {
    if (!this.numberService && explicitToken && explicitToken.trim()) {
      return explicitToken.trim();
    }

    if (this.numberService && this.secretBox) {
      try {
        const resolved = await this.numberService.resolveConnectionByPhoneNumberId(phoneNumberId);

        if (!resolved) {
          return null;
        }

        if (resolved?.connection) {
          if (!resolved.connection.enabled || resolved.connection.status !== 'CONNECTED' || resolved.connection.provider !== 'META_CLOUD') {
            logger.error(`WhatsAppOutboundAdapter: Connection [${resolved.connection.id}] is not an active Meta connection. Failing closed.`);
            return null;
          }
          const encryptedCredentials = resolved.connection.encryptedCredentials;
          if (!encryptedCredentials) {
            logger.error(`WhatsAppOutboundAdapter: Connection [${resolved.connection.id}] has no credentials. Failing closed.`);
            return null;
          }
          const decrypted = this.secretBox.decrypt(encryptedCredentials);
          try {
            const parsed = JSON.parse(decrypted);
            if (parsed && typeof parsed.accessToken === 'string' && parsed.accessToken.trim()) {
              return parsed.accessToken.trim();
            }
          } catch {
            return decrypted.trim();
          }
          return null;
        }

        logger.error(`WhatsAppOutboundAdapter: Number [${phoneNumberId}] has no isolated connection. Failing closed.`);
        return null;
      } catch (err: any) {
        logger.error(`WhatsAppOutboundAdapter: Failed to resolve/decrypt connection token for [${phoneNumberId}]: ${err.message || err}`);
        return null;
      }
    }

    if (!this.numberService && this.defaultAccessToken) {
      return this.defaultAccessToken;
    }

    return null;
  }

  /** Downloads an inbound image with credentials scoped to its originating number. */
  async downloadInboundImage(phoneNumberId: string, mediaId: string): Promise<{ imageBase64: string; mimeType: string }> {
    if (!/^\d+$/.test(mediaId) || !/^\d+$/.test(phoneNumberId)) throw new Error('INVALID_MEDIA_REFERENCE');
    const token = await this.resolveToken(phoneNumberId);
    if (!token) throw new Error('MEDIA_CREDENTIALS_UNAVAILABLE');
    const headers = { Authorization: `Bearer ${token}` };
    const metadataResponse = await this.fetchFn(`${this.baseUrl}/${this.version}/${mediaId}?phone_number_id=${encodeURIComponent(phoneNumberId)}`, {
      headers, signal: AbortSignal.timeout(10_000), redirect: 'error'
    });
    if (!metadataResponse.ok) throw new Error('MEDIA_METADATA_UNAVAILABLE');
    const metadata = await metadataResponse.json() as any;
    const maxBytes = 5 * 1024 * 1024;
    if (!['image/jpeg', 'image/png'].includes(metadata.mime_type) || Number(metadata.file_size) > maxBytes) {
      throw new Error('UNSUPPORTED_IMAGE');
    }
    const url = new URL(metadata.url);
    // Never forward a customer's token to a URL outside Meta's media CDN.
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') ||
        !(url.hostname === 'lookaside.fbsbx.com' || url.hostname.endsWith('.fbcdn.net'))) {
      throw new Error('UNTRUSTED_MEDIA_URL');
    }
    const response = await this.fetchFn(url.toString(), { headers, signal: AbortSignal.timeout(10_000), redirect: 'error' });
    if (!response.ok || !response.body) throw new Error('MEDIA_DOWNLOAD_UNAVAILABLE');
    if (Number(response.headers.get('content-length')) > maxBytes) {
      await response.body.cancel();
      throw new Error('IMAGE_TOO_LARGE');
    }
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let size = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
          await reader.cancel();
          throw new Error('IMAGE_TOO_LARGE');
        }
        chunks.push(Buffer.from(value));
      }
    } finally {
      reader.releaseLock();
    }
    if (!size) throw new Error('EMPTY_IMAGE');
    return { imageBase64: Buffer.concat(chunks).toString('base64'), mimeType: metadata.mime_type };
  }

  /**
   * Sends a plain text message via Meta WhatsApp Cloud API.
   * Endpoint: POST https://graph.facebook.com/{version}/{phoneNumberId}/messages
   * Enforces:
   * 1. 0 LLM/AI interaction (pure outbound transport).
   * 2. Access token confidentiality (never logged).
   * 3. Bounded exponential backoff retry for transient/rate-limited errors.
   * 4. Immediate return for permanent errors without wasted retries.
   * 5. Conservative DELIVERY_UNKNOWN handling for network timeouts.
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

    const token = await this.resolveToken(phoneNumberId, accessToken);
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
          signal: AbortSignal.timeout(15_000),
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });

        if (response.ok) {
          const receipt = await this.readReceipt(response);
          if (!receipt.success) return receipt;
          const providerMessageId = receipt.providerMessageId;
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

        const classified = classifyMetaError(metaError?.code, response.status, lastError);
        isRetryable = classified.isRetryable;

        logger.warn(`WhatsAppOutboundAdapter: Meta API error on attempt ${attempt}: HTTP ${response.status} (code: ${lastErrorCode}) - ${lastError} (retryable: ${isRetryable})`);

        if (!isRetryable) {
          return {
            success: false,
            error: lastError,
            errorCode: lastErrorCode,
            isRetryable: false
          };
        }

        if (attempt < this.maxRetries) {
          const backoff = this.initialBackoffMs * Math.pow(2, attempt - 1);
          await new Promise((resolve) => setTimeout(resolve, backoff));
        }
      } catch (networkErr: any) {
        // The provider may have accepted the request before the connection broke.
        // Retrying without a receipt can duplicate a customer-facing message.
        return {
          success: false,
          error: 'Delivery outcome unknown; reconcile before retry.',
          errorCode: 'DELIVERY_UNKNOWN',
          isRetryable: false
        };
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

    const token = await this.resolveToken(phoneNumberId, accessToken);
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
          signal: AbortSignal.timeout(15_000),
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });

        if (response.ok) {
          const receipt = await this.readReceipt(response);
          if (!receipt.success) return receipt;
          const providerMessageId = receipt.providerMessageId;
          logger.info(`WhatsAppOutboundAdapter: Successfully sent template [${template.name}] to [${to}], Meta ID: [${providerMessageId}]`);
          return { success: true, providerMessageId, sentAt: Date.now() };
        }

        const errorData: any = await response.json().catch(() => ({}));
        const metaError = errorData?.error;
        lastErrorCode = metaError?.code ?? response.status;
        lastError = metaError?.message || `Meta API returned HTTP ${response.status}`;

        const classified = classifyMetaError(metaError?.code, response.status, lastError);
        isRetryable = classified.isRetryable;

        logger.warn(`WhatsAppOutboundAdapter: Meta API template error on attempt ${attempt}: HTTP ${response.status} (code: ${lastErrorCode}) - ${lastError} (retryable: ${isRetryable})`);

        if (!isRetryable) {
          return { success: false, error: lastError, errorCode: lastErrorCode, isRetryable: false };
        }

        if (attempt < this.maxRetries) {
          const backoff = this.initialBackoffMs * Math.pow(2, attempt - 1);
          await new Promise((resolve) => setTimeout(resolve, backoff));
        }
      } catch (networkErr: any) {
        // The provider may have accepted the request before the connection broke.
        // Retrying without a receipt can duplicate a customer-facing message.
        return {
          success: false,
          error: 'Delivery outcome unknown; reconcile before retry.',
          errorCode: 'DELIVERY_UNKNOWN',
          isRetryable: false
        };
      }
    }

    return { success: false, error: lastError, errorCode: lastErrorCode, isRetryable };
  }

  private async readReceipt(response: Response): Promise<OutboundSendResult> {
    const data: any = await response.json().catch(() => null);
    const id = Array.isArray(data?.messages) ? data.messages[0]?.id : undefined;
    if (data?.error || typeof id !== 'string' || !id.trim()) {
      // A 2xx response alone cannot prove acceptance. Resending could duplicate
      // delivery, so let the queue retain this as UNKNOWN for reconciliation.
      return {
        success: false,
        error: 'Meta returned no valid message receipt; reconcile delivery before retry.',
        errorCode: 'DELIVERY_UNKNOWN',
        isRetryable: false
      };
    }
    return { success: true, providerMessageId: id.trim() };
  }

  private isRetryableError(httpStatus: number, metaErrorCode?: number): boolean {
    return classifyMetaError(metaErrorCode, httpStatus).isRetryable;
  }
}
