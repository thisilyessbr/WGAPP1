// Utility: Dumps extracted text from all KnowledgeChunks stored for a tenant in the database.
// Usage: npm run db:extract or node scripts/extract-db.js [tenantId]

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
  const chunks = await prisma.knowledgeChunk.findMany({
    where: { tenantId },
    orderBy: { id: 'asc' }
  });
  console.log(`=== Extracted Chunks for Tenant "${tenantId}" (${chunks.length} chunks) ===\n`);
  chunks.forEach((c, idx) => {
    console.log(`--- [Chunk ${idx + 1} | ID: ${c.id}] ---`);
    console.log(c.content);
    console.log();
  });
}

run().catch(console.error).finally(() => {
  prisma.$disconnect();
  pool.end();
});
