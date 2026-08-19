import { startMonitoringServer } from './server';

if (require.main === module) {
  startMonitoringServer().catch((err) => {
    console.error('[monitoring-service] Fatal startup error:', err);
    process.exit(1);
  });
}

export * from './config';
export * from './server';
export * from './storage/TelemetryStorage';
export * from './storage/db';
export * from './ingestion/IngestionService';
export * from './ingestion/validator';
export * from './traces/TraceQueryService';
