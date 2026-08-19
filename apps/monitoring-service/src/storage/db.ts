import { Pool } from 'pg';
import { monitoringConfig } from '../config';

let monitoringPool: Pool | null = null;

export function getMonitoringPool(): Pool {
  if (!monitoringPool) {
    monitoringPool = new Pool({
      connectionString: monitoringConfig.databaseUrl,
      max: monitoringConfig.databasePoolMax, // strictly <= 3 connections
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000
    });
  }
  return monitoringPool;
}

export async function closeMonitoringPool(): Promise<void> {
  if (monitoringPool) {
    await monitoringPool.end();
    monitoringPool = null;
  }
}
