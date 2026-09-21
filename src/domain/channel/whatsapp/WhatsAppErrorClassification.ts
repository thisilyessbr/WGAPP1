/**
 * Verified Meta WhatsApp Cloud API Error Classifications.
 *
 * In accordance with official Meta Graph & Cloud API specifications:
 * Transient errors (e.g. throughput rate limit, generic server glitches) qualify for exponential backoff.
 * Permanent errors (e.g. recipient not on WhatsApp, expired 24h CSW, token expiration) fail fast.
 *
 * CRITICAL (User Directive 3):
 * - 131056 (Pair Rate Limit Hit) is recipient-side; Meta states "Do not retry immediately" to avoid spam bans.
 * - 131000 ("Something went wrong") is Meta's generic transient internal error; retryable with backoff.
 * - 130429 (Throughput limit) is retryable with backoff.
 * - DELIVERY_UNKNOWN is conservative: not automatically retried without prior verification.
 */

export type MetaErrorCategory =
  | 'RATE_LIMIT'
  | 'TRANSIENT_SERVER'
  | 'RECIPIENT_UNDELIVERABLE'
  | 'WINDOW_EXPIRED'
  | 'POLICY_VIOLATION'
  | 'AUTH_FAILURE'
  | 'PAYLOAD_ERROR'
  | 'DELIVERY_UNKNOWN'
  | 'UNKNOWN';

export interface ClassifiedMetaError {
  isRetryable: boolean;
  category: MetaErrorCategory;
  userMessage: string;
  code?: number | string | null;
  errorCode?: number | string | null;
  httpStatus?: number;
}

/**
 * Verified set of Meta Cloud API numeric error codes that are transient and safe to retry with backoff.
 */
export const RETRYABLE_META_ERROR_CODES: ReadonlySet<number> = new Set<number>([
  130429, // Cloud API throughput rate limit hit
  131000, // Generic transient "Something went wrong" internal error
  80007,  // User rate limit reached
  130472, // Temporary certificate or experiment synchronization issue
  1,      // An unknown / temporary error occurred
  2       // Service temporary error
]);

/**
 * Standard HTTP status codes that represent transient network or gateway errors.
 */
export const RETRYABLE_HTTP_STATUSES: ReadonlySet<number> = new Set<number>([
  408, // Request Timeout
  429, // Too Many Requests
  500, // Internal Server Error
  502, // Bad Gateway
  503, // Service Unavailable
  504  // Gateway Timeout
]);

/**
 * Classifies a Meta API error code and HTTP status code into actionable reliability semantics.
 */
export function classifyMetaError(
  code: number | string | null | undefined,
  httpStatus?: number,
  rawErrorMessage?: string
): ClassifiedMetaError {
  const result = classifyMetaErrorInternal(code, httpStatus, rawErrorMessage);
  return {
    ...result,
    errorCode: result.errorCode ?? result.code
  };
}

function classifyMetaErrorInternal(
  code: number | string | null | undefined,
  httpStatus?: number,
  rawErrorMessage?: string
): ClassifiedMetaError {
  const numCode = typeof code === 'number' ? code : Number(code);

  if (code === 'DELIVERY_UNKNOWN') {
    return {
      isRetryable: false,
      category: 'DELIVERY_UNKNOWN',
      userMessage: 'Delivery outcome unconfirmed; network timeout before receipt.',
      code: 'DELIVERY_UNKNOWN',
      httpStatus
    };
  }

  // Check specific Meta error codes
  if (!Number.isNaN(numCode)) {
    switch (numCode) {
      case 130429:
      case 80007:
        return {
          isRetryable: true,
          category: 'RATE_LIMIT',
          userMessage: 'WhatsApp throughput limit reached; retrying with backoff.',
          code: numCode,
          httpStatus
        };

      case 131000:
      case 1:
      case 2:
      case 130472:
        return {
          isRetryable: true,
          category: 'TRANSIENT_SERVER',
          userMessage: 'Meta temporary server error; retrying with backoff.',
          code: numCode,
          httpStatus
        };

      case 131056:
        // Meta explicitly instructs: "Do not retry immediately" for pair rate limits
        return {
          isRetryable: false,
          category: 'RATE_LIMIT',
          userMessage: 'Pair rate limit hit for this recipient. Space out messages to avoid spam penalties.',
          code: numCode,
          httpStatus
        };

      case 131026:
        return {
          isRetryable: false,
          category: 'RECIPIENT_UNDELIVERABLE',
          userMessage: 'Recipient phone number is not available on WhatsApp or has blocked business.',
          code: numCode,
          httpStatus
        };

      case 131047:
        return {
          isRetryable: false,
          category: 'WINDOW_EXPIRED',
          userMessage: '24-hour customer service window has expired. A pre-approved template message is required.',
          code: numCode,
          httpStatus
        };

      case 131051:
      case 131052:
        return {
          isRetryable: false,
          category: 'PAYLOAD_ERROR',
          userMessage: 'Unsupported message format or media payload.',
          code: numCode,
          httpStatus
        };

      case 131053:
        return {
          isRetryable: false,
          category: 'POLICY_VIOLATION',
          userMessage: 'Message blocked by WhatsApp spam detection or integrity policies.',
          code: numCode,
          httpStatus
        };

      case 190:
        return {
          isRetryable: false,
          category: 'AUTH_FAILURE',
          userMessage: 'WhatsApp access token is invalid or expired. Re-authentication required.',
          code: numCode,
          httpStatus
        };

      case 100:
      case 132000:
      case 132001:
        return {
          isRetryable: false,
          category: 'PAYLOAD_ERROR',
          userMessage: 'Invalid message parameter or template configuration.',
          code: numCode,
          httpStatus
        };
    }
  }

  // Fallback to HTTP status code classification
  if (httpStatus && RETRYABLE_HTTP_STATUSES.has(httpStatus)) {
    return {
      isRetryable: true,
      category: httpStatus === 429 ? 'RATE_LIMIT' : 'TRANSIENT_SERVER',
      userMessage: `Meta returned HTTP ${httpStatus}. Retrying with backoff.`,
      code: code ?? httpStatus,
      httpStatus
    };
  }

  return {
    isRetryable: false,
    category: 'UNKNOWN',
    userMessage: rawErrorMessage || `Meta outbound failed (code: ${code ?? 'N/A'}, HTTP ${httpStatus ?? 'N/A'})`,
    code: code ?? null,
    httpStatus
  };
}
