import { PrismaClient } from '@prisma/client';
import { logger } from '../../../utils/logger';

export interface IdempotencyStore {
  isDuplicate(key: string): Promise<boolean>;
  record(key: string, ttlSeconds?: number): Promise<boolean>;
  checkAndRecord(key: string, ttlSeconds?: number): Promise<{ isDuplicate: boolean }>;
  delete(key: string): Promise<void>;
}

export class MemoryIdempotencyStore implements IdempotencyStore {
  private cache = new Map<string, number>();
  private readonly defaultTtlMs: number;
  private readonly maxCapacity: number;

  constructor(options: { defaultTtlSeconds?: number; maxCapacity?: number } = {}) {
    this.defaultTtlMs = (options.defaultTtlSeconds ?? 86400) * 1000; // default 24 hours
    this.maxCapacity = options.maxCapacity ?? 10000;
  }

  async isDuplicate(key: string): Promise<boolean> {
    if (!key) return false;
    const now = Date.now();
    const expiresAt = this.cache.get(key);
    if (!expiresAt) return false;
    if (expiresAt <= now) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  async record(key: string, ttlSeconds?: number): Promise<boolean> {
    if (!key) return false;
    const ttlMs = ttlSeconds ? ttlSeconds * 1000 : this.defaultTtlMs;
    this.enforceCapacity();
    this.cache.set(key, Date.now() + ttlMs);
    return true;
  }

  async checkAndRecord(key: string, ttlSeconds?: number): Promise<{ isDuplicate: boolean }> {
    if (!key) return { isDuplicate: false };
    const now = Date.now();
    const expiresAt = this.cache.get(key);
    if (expiresAt && expiresAt > now) {
      return { isDuplicate: true };
    }
    await this.record(key, ttlSeconds);
    return { isDuplicate: false };
  }

  async delete(key: string): Promise<void> {
    if (key) {
      this.cache.delete(key);
    }
  }

  private enforceCapacity(): void {
    if (this.cache.size >= this.maxCapacity) {
      const now = Date.now();
      // Purge expired keys
      for (const [k, exp] of this.cache.entries()) {
        if (exp <= now) this.cache.delete(k);
      }
      // If still at/above capacity, evict oldest entry
      if (this.cache.size >= this.maxCapacity) {
        const firstKey = this.cache.keys().next().value;
        if (firstKey) this.cache.delete(firstKey);
      }
    }
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }
}

export class PostgresIdempotencyStore implements IdempotencyStore {
  private readonly defaultTtlSeconds: number;

  constructor(private prisma: PrismaClient, options: { defaultTtlSeconds?: number } = {}) {
    this.defaultTtlSeconds = options.defaultTtlSeconds ?? 86400; // default 24 hours
  }

  async isDuplicate(key: string): Promise<boolean> {
    if (!key) return false;
    const now = new Date();
    const record = await this.prisma.whatsAppIdempotencyKey.findUnique({
      where: { key: key.trim() }
    });
    if (!record) return false;
    if (record.expiresAt <= now) {
      // Lazy cleanup of expired key
      await this.prisma.whatsAppIdempotencyKey.delete({ where: { id: record.id } }).catch(() => {});
      return false;
    }
    return true;
  }

  async record(key: string, ttlSeconds?: number): Promise<boolean> {
    if (!key) return false;
    const ttl = ttlSeconds ?? this.defaultTtlSeconds;
    const expiresAt = new Date(Date.now() + ttl * 1000);
    const trimmedKey = key.trim();

    try {
      await this.prisma.whatsAppIdempotencyKey.create({
        data: { key: trimmedKey, expiresAt }
      });
      return true;
    } catch (err: any) {
      if (err.code === 'P2002' || err.message?.includes('Unique constraint')) {
        // Key already exists, update expiresAt
        await this.prisma.whatsAppIdempotencyKey.update({
          where: { key: trimmedKey },
          data: { expiresAt }
        }).catch(() => {});
        return true;
      }
      throw err;
    }
  }

  /**
   * Atomically checks and records a key.
   * If two concurrent instances attempt the same key simultaneously,
   * PostgreSQL unique constraint ensures exactly ONE instance succeeds.
   */
  async checkAndRecord(key: string, ttlSeconds?: number): Promise<{ isDuplicate: boolean }> {
    if (!key) return { isDuplicate: false };
    const ttl = ttlSeconds ?? this.defaultTtlSeconds;
    const expiresAt = new Date(Date.now() + ttl * 1000);
    const trimmedKey = key.trim();

    try {
      await this.prisma.whatsAppIdempotencyKey.create({
        data: { key: trimmedKey, expiresAt }
      });
      return { isDuplicate: false };
    } catch (err: any) {
      if (err.code === 'P2002' || err.message?.includes('Unique constraint')) {
        const existing = await this.prisma.whatsAppIdempotencyKey.findUnique({
          where: { key: trimmedKey }
        });
        const now = new Date();
        if (existing && existing.expiresAt <= now) {
          // Expired key, reclaim it atomically
          await this.prisma.whatsAppIdempotencyKey.update({
            where: { key: trimmedKey },
            data: { expiresAt }
          });
          return { isDuplicate: false };
        }
        return { isDuplicate: true };
      }
      logger.error(`PostgresIdempotencyStore: Error checking key [${key}]: ${err.message || err}`);
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    if (!key) return;
    await this.prisma.whatsAppIdempotencyKey.delete({
      where: { key: key.trim() }
    }).catch(() => {});
  }
}
