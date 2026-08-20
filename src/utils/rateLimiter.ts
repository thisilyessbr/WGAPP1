import { Request, Response, NextFunction } from 'express';

export interface RateLimiterOptions {
  windowMs: number;
  maxRequests: number;
  maxKeys?: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime: number;
  retryAfterSeconds: number;
}

export class BoundedRateLimiter {
  private store = new Map<string, { count: number; resetTime: number }>();
  private windowMs: number;
  private maxRequests: number;
  private maxKeys: number;
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(options: RateLimiterOptions) {
    this.windowMs = options.windowMs;
    this.maxRequests = options.maxRequests;
    this.maxKeys = options.maxKeys || 10000;

    // Periodic cleanup of expired keys every minute (unref so it doesn't block shutdown)
    if (typeof setInterval !== 'undefined') {
      this.cleanupTimer = setInterval(() => this.cleanup(), Math.min(this.windowMs, 60000));
      if (this.cleanupTimer.unref) {
        this.cleanupTimer.unref();
      }
    }
  }

  public check(key: string, customMax?: number): RateLimitResult {
    const now = Date.now();
    const max = customMax ?? this.maxRequests;

    let entry = this.store.get(key);
    if (!entry || now > entry.resetTime) {
      // Evict oldest entries if capacity exceeded
      if (!entry && this.store.size >= this.maxKeys) {
        this.cleanup();
        if (this.store.size >= this.maxKeys) {
          const firstKey = this.store.keys().next().value;
          if (firstKey) this.store.delete(firstKey);
        }
      }

      entry = { count: 1, resetTime: now + this.windowMs };
      this.store.set(key, entry);
      return {
        allowed: true,
        remaining: max - 1,
        resetTime: entry.resetTime,
        retryAfterSeconds: Math.ceil(this.windowMs / 1000)
      };
    }

    if (entry.count < max) {
      entry.count++;
      return {
        allowed: true,
        remaining: max - entry.count,
        resetTime: entry.resetTime,
        retryAfterSeconds: Math.ceil((entry.resetTime - now) / 1000)
      };
    }

    // Exceeded
    const retryAfter = Math.max(1, Math.ceil((entry.resetTime - now) / 1000));
    return {
      allowed: false,
      remaining: 0,
      resetTime: entry.resetTime,
      retryAfterSeconds: retryAfter
    };
  }

  public reset(key?: string): void {
    if (key) {
      this.store.delete(key);
    } else {
      this.store.clear();
    }
  }

  public get size(): number {
    return this.store.size;
  }

  public cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (now > entry.resetTime) {
        this.store.delete(key);
      }
    }
  }

  public destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.store.clear();
  }
}

export class ConcurrencyLimiter {
  private activeCount = 0;
  private maxConcurrent: number;

  constructor(maxConcurrent: number) {
    this.maxConcurrent = maxConcurrent;
  }

  public get active(): number {
    return this.activeCount;
  }

  public acquire(): boolean {
    if (this.activeCount < this.maxConcurrent) {
      this.activeCount++;
      return true;
    }
    return false;
  }

  public release(): void {
    if (this.activeCount > 0) {
      this.activeCount--;
    }
  }

  public reset(): void {
    this.activeCount = 0;
  }
}

export interface RouteProtectionOptions {
  keyPrefix: string;
  perIpLimit?: { max: number; windowMs: number };
  perTenantLimit?: { max: number; windowMs: number };
  concurrencyLimit?: number;
}

export function createRouteProtectionMiddleware(options: RouteProtectionOptions) {
  const ipLimiter = options.perIpLimit
    ? new BoundedRateLimiter({
        windowMs: options.perIpLimit.windowMs,
        maxRequests: options.perIpLimit.max,
        maxKeys: 10000
      })
    : null;

  const tenantLimiter = options.perTenantLimit
    ? new BoundedRateLimiter({
        windowMs: options.perTenantLimit.windowMs,
        maxRequests: options.perTenantLimit.max,
        maxKeys: 5000
      })
    : null;

  const concurrencyLimiter = options.concurrencyLimit
    ? new ConcurrencyLimiter(options.concurrencyLimit)
    : null;

  return {
    ipLimiter,
    tenantLimiter,
    concurrencyLimiter,
    middleware: (req: Request, res: Response, next: NextFunction) => {
      // 1. IP Rate Limiting
      if (ipLimiter) {
        const clientIp = req.socket.remoteAddress || req.ip || 'unknown';
        const ipKey = `${options.keyPrefix}:ip:${clientIp}`;
        const ipResult = ipLimiter.check(ipKey);
        if (!ipResult.allowed) {
          res.setHeader('Retry-After', String(ipResult.retryAfterSeconds));
          return res.status(429).json({
            error: 'TOO_MANY_REQUESTS',
            message: 'Too many requests from this IP. Please try again later.',
            retryAfter: ipResult.retryAfterSeconds
          });
        }
      }

      // 2. Authenticated Tenant Rate Limiting (Never trust req.body.tenantId!)
      if (tenantLimiter && req.principal?.tenantId) {
        const tenantKey = `${options.keyPrefix}:tenant:${req.principal.tenantId}`;
        const tenantResult = tenantLimiter.check(tenantKey);
        if (!tenantResult.allowed) {
          res.setHeader('Retry-After', String(tenantResult.retryAfterSeconds));
          return res.status(429).json({
            error: 'TOO_MANY_REQUESTS',
            message: 'Tenant quota limit exceeded. Please try again later.',
            retryAfter: tenantResult.retryAfterSeconds
          });
        }
      }

      // 3. Concurrency Limiting
      if (concurrencyLimiter) {
        const acquired = concurrencyLimiter.acquire();
        if (!acquired) {
          res.setHeader('Retry-After', '1');
          return res.status(429).json({
            error: 'CONCURRENCY_LIMIT_EXCEEDED',
            message: 'Server is currently experiencing high load on this endpoint. Please retry shortly.',
            retryAfter: 1
          });
        }

        let released = false;
        const releaseOnce = () => {
          if (!released) {
            released = true;
            concurrencyLimiter.release();
          }
        };

        res.on('finish', releaseOnce);
        res.on('close', releaseOnce);
      }

      next();
    }
  };
}
