// Utility: Enables knowledge retrieval (knowledge.enabled = true) for a tenant in the database.
// Usage: npm run tenant:enable-rag or node scripts/enable-rag.js [tenantId]

require('dotenv/config');
const { PrismaClient } = require('@prisma/client');
const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');

let dbUrl = process.env.DATABASE_URL;
if (dbUrl && dbUrl.startsWith('prisma+postgres://')) {
  const urlObj = new URL(dbUrl);
  const apiKey = urlObj.searchParams.get('api_key');
  if (apiKey) {
    const decoded = JSON.parse(Buffer.from(apiKey, 'base64').toString('utf8'));
    dbUrl = decoded.databaseUrl;
  }
}

const pool = new Pool({ connectionString: dbUrl });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function run() {
  const tenantId = process.argv[2] || 'dev-tenant';
  const record = await prisma.tenantConfig.findUnique({ where: { tenantId } });
  if (!record) {
    console.error(`No configuration found for tenant "${tenantId}".`);
    process.exit(1);
  }
  const config = record.config;
  config.knowledge = config.knowledge || {};
  config.knowledge.enabled = true;

  await prisma.tenantConfig.update({
    where: { tenantId },
    data: { config }
  });
  console.log(`Knowledge retrieval successfully enabled for tenant "${tenantId}".`);
}

run().catch(console.error).finally(() => {
  prisma.$disconnect();
  pool.end();
});
