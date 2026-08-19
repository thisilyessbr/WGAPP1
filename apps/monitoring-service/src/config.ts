import 'dotenv/config';

export function resolveDatabaseUrl(rawUrl?: string): string {
  let url = rawUrl || process.env.MONITORING_DATABASE_URL || process.env.DIRECT_URL || process.env.DATABASE_URL || '';
  if (url.startsWith('prisma+postgres://')) {
    try {
      const urlObj = new URL(url);
      const apiKey = urlObj.searchParams.get('api_key');
      if (apiKey) {
        const decoded = JSON.parse(Buffer.from(apiKey, 'base64').toString('utf8'));
        if (decoded.databaseUrl) {
          url = decoded.databaseUrl;
        }
      }
    } catch {
      // Use original URL if parsing fails
    }
  }
  return url;
}

export interface MonitoringConfig {
  host: string;
  port: number;
  databaseUrl: string;
  databasePoolMax: number;
  retentionDays: number;
  adminToken: string;
}

const poolMaxRaw = process.env.MONITORING_DATABASE_POOL_MAX ? parseInt(process.env.MONITORING_DATABASE_POOL_MAX, 10) : 3;
// Enforce strict upper bound of 3 connections for monitoring pool
const databasePoolMax = Math.min(Math.max(1, isNaN(poolMaxRaw) ? 3 : poolMaxRaw), 3);

const retentionDaysRaw = process.env.MONITORING_RETENTION_DAYS ? parseInt(process.env.MONITORING_RETENTION_DAYS, 10) : 14;
const retentionDays = isNaN(retentionDaysRaw) || retentionDaysRaw <= 0 ? 14 : retentionDaysRaw;

export const monitoringConfig: MonitoringConfig = {
  host: process.env.MONITORING_HOST || '127.0.0.1',
  port: process.env.MONITORING_PORT ? parseInt(process.env.MONITORING_PORT, 10) : 4003,
  databaseUrl: resolveDatabaseUrl(),
  databasePoolMax,
  retentionDays,
  adminToken: process.env.MONITORING_ADMIN_TOKEN || ''
};
