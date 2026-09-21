import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import 'dotenv/config';

const testDbUrl = process.env.TEST_DATABASE_URL;
if (!testDbUrl) {
  throw new Error(
    'FATAL: TEST_DATABASE_URL is not set! Tests cannot run against the live development database (DATABASE_URL) to prevent data corruption. Please set TEST_DATABASE_URL in .env.'
  );
}

const liveDbUrl = process.env.DATABASE_URL;
if (liveDbUrl && testDbUrl === liveDbUrl) {
  throw new Error(
    'FATAL: TEST_DATABASE_URL resolves to the same value as DATABASE_URL! Tests must run against an isolated test database/schema to prevent data corruption.'
  );
}

let dbUrl = testDbUrl;
if (dbUrl && dbUrl.startsWith('prisma+postgres://')) {
  const urlObj = new URL(dbUrl);
  const apiKey = urlObj.searchParams.get('api_key');
  if (apiKey) {
    const decoded = JSON.parse(Buffer.from(apiKey, 'base64').toString('utf8'));
    dbUrl = decoded.databaseUrl;
  }
}

if (dbUrl) {
  try {
    const parsed = new URL(dbUrl);
    parsed.searchParams.delete('connection_limit');
    parsed.searchParams.delete('connect_timeout');
    parsed.searchParams.delete('max_idle_connection_lifetime');
    parsed.searchParams.delete('pool_timeout');
    parsed.searchParams.delete('socket_timeout');
    dbUrl = parsed.toString();
  } catch (e) {}
}

const testSchema = process.env.TEST_DATABASE_SCHEMA || 'test';
if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(testSchema)) {
  throw new Error('FATAL: TEST_DATABASE_SCHEMA contains invalid characters.');
}

// Configure search_path during the PostgreSQL startup handshake. Running an
// asynchronous query from Pool's `connect` event races the first Prisma query
// and can corrupt the wire protocol under concurrent integration tests.
export const pool = new Pool({
  connectionString: dbUrl,
  max: 5,
  options: `-c search_path=${testSchema},public,extensions`
});
const adapter = new PrismaPg(pool, { schema: testSchema });
export const prisma = new PrismaClient({ adapter });
