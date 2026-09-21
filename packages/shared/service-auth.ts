import { timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

/** Only trusted backend services hold this credential; it is never a browser token. */
export function requireServiceAuth(req: Request, res: Response, next: NextFunction) {
  const secret = process.env.INTERNAL_SERVICE_TOKEN || '';
  if (secret.length < 32) return res.status(503).json({ error: 'SERVICE_AUTH_NOT_CONFIGURED' });
  const supplied = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization || ''))?.[1] || '';
  const expected = Buffer.from(secret);
  const actual = Buffer.from(supplied);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return res.status(401).json({ error: 'UNAUTHORIZED' });
  }
  next();
}

export function serviceAuthHeaders(): Record<string, string> {
  const secret = process.env.INTERNAL_SERVICE_TOKEN;
  return secret ? { Authorization: `Bearer ${secret}` } : {};
}
