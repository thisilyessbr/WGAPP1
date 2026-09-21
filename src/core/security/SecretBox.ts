import crypto from 'crypto';

export interface SecretBoxConfig {
  key?: string | Buffer;
}

export class SecretBox {
  private readonly keyBuffer: Buffer;

  constructor(config: SecretBoxConfig = {}) {
    const rawKey = config.key !== undefined
      ? config.key
      : (process.env.ENCRYPTION_KEY || process.env.CREDENTIALS_ENCRYPTION_KEY);
    if (!rawKey || (typeof rawKey === 'string' && !rawKey.trim())) {
      throw new Error('SecretBox: Encryption key is required. Set ENCRYPTION_KEY or provide key in config.');
    }

    this.keyBuffer = SecretBox.normalizeKey(rawKey);
  }

  /**
   * Normalizes key into a 32-byte (256-bit) buffer.
   * Supports:
   * - 64-char Hex string
   * - 44-char Base64 string
   * - 32-byte raw Buffer or 32-char UTF-8 string
   * - Derives with SHA-256 if other length string is provided
   */
  public static normalizeKey(rawKey: string | Buffer): Buffer {
    if (Buffer.isBuffer(rawKey)) {
      if (rawKey.length === 32) return rawKey;
      return crypto.createHash('sha256').update(rawKey).digest();
    }

    const trimmed = rawKey.trim();
    if (!trimmed) {
      throw new Error('SecretBox: Encryption key cannot be empty.');
    }

    // 64-char hex
    if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
      return Buffer.from(trimmed, 'hex');
    }

    // 44-char base64
    if (/^[A-Za-z0-9+/]{43}=$/.test(trimmed) || /^[A-Za-z0-9+/]{44}$/.test(trimmed)) {
      const buf = Buffer.from(trimmed, 'base64');
      if (buf.length === 32) return buf;
    }

    // 32-byte raw UTF-8 string
    const utf8Buf = Buffer.from(trimmed, 'utf8');
    if (utf8Buf.length === 32) {
      return utf8Buf;
    }

    // Fallback: Deterministic SHA-256 digest to produce exact 32 bytes
    return crypto.createHash('sha256').update(trimmed, 'utf8').digest();
  }

  /**
   * Encrypts plaintext using AES-256-GCM.
   * Serialized output format: v1:iv:tag:ciphertext (base64url encoded components)
   */
  encrypt(plaintext: string): string {
    if (typeof plaintext !== 'string') {
      throw new Error('SecretBox: Plaintext must be a string.');
    }

    const iv = crypto.randomBytes(12); // 96-bit IV recommended for GCM
    const cipher = crypto.createCipheriv('aes-256-gcm', this.keyBuffer, iv);

    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final()
    ]);
    const authTag = cipher.getAuthTag(); // 128-bit authentication tag

    return `v1:${iv.toString('base64url')}:${authTag.toString('base64url')}:${ciphertext.toString('base64url')}`;
  }

  /**
   * Decrypts ciphertext produced by encrypt().
   * Throws if tampering is detected or key is incorrect.
   */
  decrypt(payload: string): string {
    if (!payload || typeof payload !== 'string') {
      throw new Error('SecretBox: Ciphertext must be a non-empty string.');
    }

    const parts = payload.split(':');
    if (parts.length !== 4 || parts[0] !== 'v1') {
      throw new Error('SecretBox: Invalid ciphertext format or version mismatch.');
    }

    const [, ivStr, tagStr, cipherStr] = parts;

    try {
      const iv = Buffer.from(ivStr, 'base64url');
      const authTag = Buffer.from(tagStr, 'base64url');
      const ciphertext = Buffer.from(cipherStr, 'base64url');

      if (iv.length !== 12 || authTag.length !== 16) {
        throw new Error('SecretBox: Invalid IV or AuthTag length.');
      }

      const decipher = crypto.createDecipheriv('aes-256-gcm', this.keyBuffer, iv);
      decipher.setAuthTag(authTag);

      const decrypted = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final()
      ]);

      return decrypted.toString('utf8');
    } catch (err: any) {
      throw new Error('SecretBox: Decryption failed (integrity check failed or incorrect key).');
    }
  }

  /**
   * Encrypts any JSON-serializable object into encrypted string.
   */
  encryptJson(data: unknown): string {
    const jsonStr = JSON.stringify(data);
    return this.encrypt(jsonStr);
  }

  /**
   * Decrypts string into typed JSON object.
   */
  decryptJson<T = any>(payload: string): T {
    const jsonStr = this.decrypt(payload);
    try {
      return JSON.parse(jsonStr) as T;
    } catch {
      throw new Error('SecretBox: Failed to parse decrypted JSON payload.');
    }
  }
}
