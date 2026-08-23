import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

function getPrisma(url: string | undefined, schema?: string) {
  if (!url) return null;
  let dbUrl = url;
  if (dbUrl.startsWith('prisma+postgres://')) {
    const urlObj = new URL(dbUrl);
    const apiKey = urlObj.searchParams.get('api_key');
    if (apiKey) {
      const decoded = JSON.parse(Buffer.from(apiKey, 'base64').toString('utf8'));
      dbUrl = decoded.databaseUrl;
    }
  }
  const pool = new Pool({ connectionString: dbUrl, max: 2 });
  if (schema) {
    pool.on('connect', (client) => {
      client.query(`SET search_path TO ${schema}, public, extensions;`);
    });
  }
  const adapter = new PrismaPg(pool, schema ? { schema } : undefined);
  const prisma = new PrismaClient({ adapter });
  return { prisma, pool };
}

async function audit() {
  const dbs = [
    { label: 'DEV_DB', conn: getPrisma(process.env.DATABASE_URL) },
    { label: 'TEST_DB_test', conn: getPrisma(process.env.TEST_DATABASE_URL, 'test') },
    { label: 'TEST_DB_public', conn: getPrisma(process.env.TEST_DATABASE_URL, 'public') }
  ];

  for (const { label, conn } of dbs) {
    if (!conn) continue;
    console.log(`\n================== DB: ${label} ==================`);
    const { prisma, pool } = conn;
    try {
      const tenants = await prisma.tenant.findMany({ select: { id: true, name: true } });
      console.log('Tenants:', tenants);

      const accounts = await prisma.account.findMany({ select: { id: true, tenantId: true, name: true, enabled: true, config: true } });
      console.log('Accounts:', accounts);

      const products = await prisma.product.findMany({
        where: { tenantId: 'animeverse' },
        include: { variants: true }
      });
      console.log(`\nAnimeVerse Products (${products.length}):`);
      for (const p of products) {
        console.log(`- Product [${p.id}] SKU=${p.sku}, Name=${p.name}, Price=${p.price} ${p.currency}, Stock=${p.stock}, Active=${p.active}, Category=${p.category}`);
        console.log(`  Localized Names:`, p.nameLocalized);
        console.log(`  Localized Descriptions:`, p.descriptionLocalized);
        console.log(`  Variants (${p.variants.length}):`, p.variants.map(v => `[${v.sku}] size=${v.size}, color=${v.color}, stock=${v.stock}, active=${v.active}`));
      }

      const sources = await prisma.knowledgeSource.findMany({
        where: { tenantId: 'animeverse' },
        include: { documents: { include: { chunks: true } } }
      });
      console.log(`\nAnimeVerse Knowledge Sources (${sources.length}):`);
      for (const s of sources) {
        console.log(`- Source [${s.id}] Name=${s.name}, AccountId=${s.accountId}, Status=${s.status}`);
        for (const doc of s.documents) {
          console.log(`  - Doc [${doc.id}] Title=${doc.title}, AccountId=${doc.accountId}, Chunks=${doc.chunks.length}`);
          for (const ch of doc.chunks) {
            console.log(`    * Chunk [${ch.id}] (${ch.content.length} chars): ${ch.content.slice(0, 150)}...`);
          }
        }
      }
    } catch (e: any) {
      console.error(`Error auditing ${label}:`, e.message);
    } finally {
      await prisma.$disconnect();
      await pool.end();
    }
  }
}

audit();
