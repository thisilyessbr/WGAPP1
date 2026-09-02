import crypto from 'crypto';

export class WhatsAppSignatureValidator {
  /**
   * Validates Meta X-Hub-Signature-256 header against raw payload and App Secret.
   * Uses crypto.timingSafeEqual to prevent timing attacks.
   */
  static isValid(rawBody: Buffer | string | undefined, signatureHeader: string | undefined, appSecret: string | undefined): boolean {
    if (!rawBody || !signatureHeader || !appSecret) {
      return false;
    }

    const trimmedHeader = signatureHeader.trim();
    if (!trimmedHeader.startsWith('sha256=')) {
      return false;
    }

    const providedSignature = trimmedHeader.slice(7).trim();
    if (providedSignature.length !== 64) {
      return false;
    }

    const hmac = crypto.createHmac('sha256', appSecret);
    if (Buffer.isBuffer(rawBody)) {
      hmac.update(rawBody);
    } else {
      hmac.update(Buffer.from(rawBody, 'utf8'));
    }
    const expectedSignature = hmac.digest('hex');

    try {
      const providedBuffer = Buffer.from(providedSignature, 'hex');
      const expectedBuffer = Buffer.from(expectedSignature, 'hex');

      if (providedBuffer.length !== expectedBuffer.length) {
        return false;
      }

      return crypto.timingSafeEqual(providedBuffer, expectedBuffer);
    } catch {
      return false;
    }
  }
}
