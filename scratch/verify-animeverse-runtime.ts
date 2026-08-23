import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

function getPrisma(url: string | undefined) {
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
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });
  return { prisma, pool };
}

async function verifyRuntime() {
  const db = getPrisma(process.env.DATABASE_URL);
  if (!db) {
    console.error('No DATABASE_URL configured');
    return;
  }
  const { prisma, pool } = db;

  try {
    console.log('=== 1. TENANT & CONFIG ===');
    const tenant = await prisma.tenant.findUnique({
      where: { id: 'animeverse' },
      include: {
        config: true,
        accounts: true
      }
    });
    console.log('Tenant:', { id: tenant?.id, name: tenant?.name });
    const cfg = tenant?.config?.config as any;
    console.log('TenantConfig.capabilities.faq Count:', cfg?.capabilities?.faq?.length || 0);
    if (cfg?.capabilities?.faq) {
      console.log('FAQs in TenantConfig:');
      for (const f of cfg.capabilities.faq) {
        console.log(`- [${f.id}] category: ${f.category}`);
        console.log(`  Questions:`, f.questions);
        console.log(`  Answers:`, f.answers);
      }
    }
    console.log('TenantConfig.knowledge.topK:', cfg?.knowledge?.topK);

    console.log('\n=== 2. ACCOUNT ===');
    const account = await prisma.account.findUnique({
      where: { id: 'animeverse-store' }
    });
    console.log('Account:', {
      id: account?.id,
      tenantId: account?.tenantId,
      name: account?.name,
      enabled: account?.enabled,
      config: account?.config
    });

    console.log('\n=== 3. PRODUCTS & VARIANTS ===');
    const products = await prisma.product.findMany({
      where: { tenantId: 'animeverse', accountId: 'animeverse-store' },
      include: { variants: true }
    });
    console.log(`Products Count: ${products.length}`);
    for (const p of products) {
      console.log(`\nProduct: [${p.id}] SKU=${p.sku}, Name=${p.name}, Price=${p.price} ${p.currency}, Stock=${p.stock}, Active=${p.active}`);
      console.log(`  English Description: "${p.description}"`);
      console.log(`  Localized Descriptions:`, p.descriptionLocalized);
      console.log(`  Variants (${p.variants.length}):`);
      for (const v of p.variants) {
        console.log(`    - Variant [${v.id}] SKU=${v.sku}, Size=${v.size}, Color=${v.color}, Stock=${v.stock}, PriceOverride=${v.priceOverride}, Active=${v.active}`);
      }
    }

    console.log('\n=== 4. KNOWLEDGE SOURCES & DOCUMENTS ===');
    const sources = await prisma.knowledgeSource.findMany({
      where: { tenantId: 'animeverse' },
      include: {
        documents: {
          include: {
            chunks: { select: { id: true, accountId: true } }
          }
        }
      }
    });
    console.log(`Knowledge Sources for AnimeVerse: ${sources.length}`);
    for (const s of sources) {
      console.log(`- Source [${s.id}] Name="${s.name}", AccountId=${s.accountId}, Status=${s.status}`);
      for (const d of s.documents) {
        console.log(`  - Doc [${d.id}] Title="${d.title}", AccountId=${d.accountId}, Chunks=${d.chunks.length}`);
      }
    }

    console.log('\n=== 5. GLOBAL KNOWLEDGE SOURCES (Tenant-wide) ===');
    const globalSources = await prisma.knowledgeSource.findMany({
      where: { tenantId: 'animeverse', accountId: null }
    });
    console.log(`Global Sources Count: ${globalSources.length}`);

  } catch (e: any) {
    console.error('Error during verification:', e.message);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

verifyRuntime();
