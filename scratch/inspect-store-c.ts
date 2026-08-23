import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

function getPrisma(url: string | undefined, schema?: string) {
  let dbUrl = url;
  if (dbUrl && dbUrl.startsWith('prisma+postgres://')) {
    const urlObj = new URL(dbUrl);
    const apiKey = urlObj.searchParams.get('api_key');
    if (apiKey) {
      const decoded = JSON.parse(Buffer.from(apiKey, 'base64').toString('utf8'));
      dbUrl = decoded.databaseUrl;
    }
  }
  const pool = new Pool({ connectionString: dbUrl });
  if (schema) {
    pool.on('connect', (client) => {
      client.query(`SET search_path TO ${schema}, public, extensions;`);
    });
  }
  const adapter = new PrismaPg(pool, schema ? { schema } : undefined);
  return { prisma: new PrismaClient({ adapter }), pool };
}

async function check(url: string | undefined, label: string, schema?: string) {
  if (!url) return;
  const { prisma, pool } = getPrisma(url, schema);
  try {
    console.log(`\n=== Checking Database: ${label} ===`);
    const tenant = await prisma.tenant.findUnique({
      where: { id: 'MANUAL-ECOMMERCE-TEST' },
      include: { accounts: true }
    });
    console.log('Tenant:', tenant?.id, tenant?.name);
    console.log('Accounts:');
    if (tenant) {
      for (const a of tenant.accounts) {
        console.log(`- ID: "${a.id}", Name: "${a.name}", Enabled: ${a.enabled}, TenantId: "${a.tenantId}", Config:`, JSON.stringify(a.config));
      }
    }

    const storeC = await prisma.account.findUnique({
      where: { id: 'STORE-C-OFF-MANUAL' }
    });
    console.log('findUnique STORE-C-OFF-MANUAL:', storeC);
  } catch (err) {
    console.error(`Error checking ${label}:`, err);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

async function main() {
  await check(process.env.DATABASE_URL, 'DATABASE_URL', 'public');
  await check(process.env.TEST_DATABASE_URL, 'TEST_DATABASE_URL', 'test');
}

main();
