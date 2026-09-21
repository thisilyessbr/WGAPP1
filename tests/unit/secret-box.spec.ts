import { describe, it, expect } from 'vitest';
import { SecretBox } from '../../src/core/security/SecretBox';

describe('SecretBox: AES-256-GCM Security Unit Tests', () => {
  const testKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'; // 64 hex
  const box = new SecretBox({ key: testKey });

  it('1. Successfully encrypts and decrypts sensitive string tokens', () => {
    const sensitiveToken = 'EAAG1234567890abcdefMETA_ACCESS_TOKEN_SECRET';
    const encrypted = box.encrypt(sensitiveToken);

    expect(encrypted).not.toBe(sensitiveToken);
    expect(encrypted).toContain('v1:');
    expect(encrypted.split(':')).toHaveLength(4);

    const decrypted = box.decrypt(encrypted);
    expect(decrypted).toBe(sensitiveToken);
  });

  it('2. Successfully encrypts and decrypts structured JSON credentials', () => {
    const creds = {
      accessToken: 'EAAG_SECRET_TOKEN',
      wabaId: '123456789',
      appId: '987654321',
      tokenExpiresAt: 1735689600000
    };

    const encrypted = box.encryptJson(creds);
    const decrypted = box.decryptJson<typeof creds>(encrypted);

    expect(decrypted).toEqual(creds);
  });

  it('3. Rejects tampered ciphertext with integrity error', () => {
    const encrypted = box.encrypt('important_secret');
    const parts = encrypted.split(':');
    // Tamper with ciphertext payload
    parts[3] = Buffer.from('corrupted_ciphertext').toString('base64url');
    const tampered = parts.join(':');

    expect(() => box.decrypt(tampered)).toThrow(/Decryption failed/);
  });

  it('4. Rejects tampered auth tag with integrity error', () => {
    const encrypted = box.encrypt('important_secret');
    const parts = encrypted.split(':');
    // Modify 1 byte in auth tag
    const tagBuf = Buffer.from(parts[2], 'base64url');
    tagBuf[0] ^= 0xff;
    parts[2] = tagBuf.toString('base64url');
    const tampered = parts.join(':');

    expect(() => box.decrypt(tampered)).toThrow(/Decryption failed/);
  });

  it('5. Cannot decrypt with different encryption key', () => {
    const encrypted = box.encrypt('cross_tenant_secret');
    const anotherBox = new SecretBox({ key: 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210' });

    expect(() => anotherBox.decrypt(encrypted)).toThrow(/Decryption failed/);
  });

  it('6. Throws descriptive error when encryption key is missing', () => {
    const originalKey = process.env.ENCRYPTION_KEY;
    const originalCredKey = process.env.CREDENTIALS_ENCRYPTION_KEY;
    delete process.env.ENCRYPTION_KEY;
    delete process.env.CREDENTIALS_ENCRYPTION_KEY;

    try {
      expect(() => new SecretBox({})).toThrow(/Encryption key is required/);
    } finally {
      if (originalKey) process.env.ENCRYPTION_KEY = originalKey;
      if (originalCredKey) process.env.CREDENTIALS_ENCRYPTION_KEY = originalCredKey;
    }
  });

  it('7. Normalizes various valid key formats properly', () => {
    // 32-byte raw string
    const box32 = new SecretBox({ key: '12345678901234567890123456789012' });
    const enc = box32.encrypt('hello');
    expect(box32.decrypt(enc)).toBe('hello');

    // Arbitrary length string hashed via SHA-256
    const boxArbitrary = new SecretBox({ key: 'my-super-secret-passphrase-short' });
    const enc2 = boxArbitrary.encrypt('world');
    expect(boxArbitrary.decrypt(enc2)).toBe('world');
  });
});
