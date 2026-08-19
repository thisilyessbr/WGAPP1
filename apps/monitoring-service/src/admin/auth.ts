import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { monitoringConfig } from '../config';

/**
 * Constant-time string comparison to prevent timing attacks.
 */
export function timingSafeTokenCompare(givenToken: string, expectedToken: string): boolean {
  if (!givenToken || !expectedToken) return false;
  const givenBuffer = Buffer.from(givenToken);
  const expectedBuffer = Buffer.from(expectedToken);
  if (givenBuffer.length !== expectedBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(givenBuffer, expectedBuffer);
}

/**
 * Middleware enforcing minimal static token authentication for Admin endpoints.
 * Header: Authorization: Bearer <MONITORING_ADMIN_TOKEN>
 * 
 * Fail-Closed Rule:
 * If MONITORING_ADMIN_TOKEN is not configured or empty, requests fail closed (HTTP 503).
 * If header is missing or incorrect, returns generic HTTP 401.
 */
export function requireAdminAuth(req: Request, res: Response, next: NextFunction): void {
  const expectedToken = monitoringConfig.adminToken;

  // Fail closed if admin token is not configured
  if (!expectedToken || !expectedToken.trim()) {
    res.status(503).json({
      error: 'ADMIN_AUTH_NOT_CONFIGURED',
      message: 'Admin authentication is not configured. Admin endpoints are unavailable.'
    });
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'Invalid or missing authentication token'
    });
    return;
  }

  const givenToken = authHeader.slice(7).trim();
  if (!timingSafeTokenCompare(givenToken, expectedToken)) {
    res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'Invalid or missing authentication token'
    });
    return;
  }

  next();
}
