import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { DEFAULT_BUSINESS_CONFIG } from '../src/domain/tenant/BusinessConfig';

function getPrismaClient(connectionUrl: string | undefined, schema?: string): { prisma: PrismaClient; pool: Pool } {
  let dbUrl = connectionUrl;
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

  const pool = new Pool({ connectionString: dbUrl, max: 5 });
  if (schema) {
    pool.on('connect', (client) => {
      client.query(`SET search_path TO ${schema}, public, extensions;`);
    });
  }
  const adapter = new PrismaPg(pool, schema ? { schema } : undefined);
  const prisma = new PrismaClient({ adapter });
  return { prisma, pool };
}

async function seedDatabase(prisma: PrismaClient, pool: Pool, label: string, schema: string = 'public') {
  console.log(`\n--- Seeding MANUAL-ECOMMERCE-TEST fixtures in [${label}] (schema: ${schema}) ---`);

  const client = await pool.connect();
  try {
    await client.query(`SET search_path TO ${schema}, public, extensions;`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS "Product" (
          "id" TEXT NOT NULL,
          "tenantId" TEXT NOT NULL,
          "accountId" TEXT NOT NULL,
          "sku" TEXT NOT NULL,
          "name" TEXT NOT NULL,
          "nameLocalized" JSONB,
          "description" TEXT NOT NULL,
          "descriptionLocalized" JSONB,
          "price" DECIMAL(10,2) NOT NULL,
          "currency" TEXT NOT NULL DEFAULT 'USD',
          "stock" INTEGER NOT NULL DEFAULT 0,
          "active" BOOLEAN NOT NULL DEFAULT true,
          "category" TEXT,
          "metadata" JSONB,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
      );

      CREATE TABLE IF NOT EXISTS "ProductVariant" (
          "id" TEXT NOT NULL,
          "productId" TEXT NOT NULL,
          "sku" TEXT NOT NULL,
          "name" TEXT,
          "size" TEXT,
          "color" TEXT,
          "priceOverride" DECIMAL(10,2),
          "stock" INTEGER NOT NULL DEFAULT 0,
          "active" BOOLEAN NOT NULL DEFAULT true,
          "metadata" JSONB,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
      );

      CREATE UNIQUE INDEX IF NOT EXISTS "Product_tenantId_accountId_sku_key" ON "Product"("tenantId", "accountId", "sku");
      CREATE INDEX IF NOT EXISTS "Product_tenantId_accountId_idx" ON "Product"("tenantId", "accountId");
      CREATE INDEX IF NOT EXISTS "Product_tenantId_accountId_active_idx" ON "Product"("tenantId", "accountId", "active");
      CREATE INDEX IF NOT EXISTS "Product_tenantId_accountId_category_idx" ON "Product"("tenantId", "accountId", "category");
      CREATE UNIQUE INDEX IF NOT EXISTS "ProductVariant_productId_sku_key" ON "ProductVariant"("productId", "sku");
      CREATE INDEX IF NOT EXISTS "ProductVariant_productId_idx" ON "ProductVariant"("productId");
      CREATE INDEX IF NOT EXISTS "ProductVariant_productId_active_idx" ON "ProductVariant"("productId", "active");

      ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "metadata" JSONB;
      ALTER TABLE "KnowledgeSource" ADD COLUMN IF NOT EXISTS "accountId" TEXT;
      ALTER TABLE "KnowledgeDocument" ADD COLUMN IF NOT EXISTS "accountId" TEXT;
      ALTER TABLE "KnowledgeChunk" ADD COLUMN IF NOT EXISTS "accountId" TEXT;
    `);
  } finally {
    client.release();
  }

  // 1. Clean up existing tenant and products if any
  try {
    await prisma.productVariant.deleteMany({
      where: { product: { tenantId: 'MANUAL-ECOMMERCE-TEST' } }
    });
    await prisma.product.deleteMany({ where: { tenantId: 'MANUAL-ECOMMERCE-TEST' } });
    await prisma.conversation.deleteMany({ where: { tenantId: 'MANUAL-ECOMMERCE-TEST' } });
    await prisma.customer.deleteMany({ where: { tenantId: 'MANUAL-ECOMMERCE-TEST' } });
    await prisma.account.deleteMany({ where: { tenantId: 'MANUAL-ECOMMERCE-TEST' } });
    await prisma.tenantConfig.deleteMany({ where: { tenantId: 'MANUAL-ECOMMERCE-TEST' } });
    await prisma.tenant.delete({ where: { id: 'MANUAL-ECOMMERCE-TEST' } });
    console.log(`Cleaned up previous MANUAL-ECOMMERCE-TEST tenant and products in ${label}.`);
  } catch (err) {}

  // 2. Create Tenant & Accounts
  const tenant = await prisma.tenant.create({
    data: {
      id: 'MANUAL-ECOMMERCE-TEST',
      name: 'MANUAL-ECOMMERCE-TEST',
      config: {
        create: {
          config: {
            ...DEFAULT_BUSINESS_CONFIG,
            identity: {
              botName: 'ManualTestBot',
              companyName: 'Manual Ecommerce Test Store'
            },
            behavior: {
              language: 'en',
              tone: 'helpful',
              verbosity: 'medium'
            },
            workflows: {},
            capabilities: {
              ...DEFAULT_BUSINESS_CONFIG.capabilities,
              ecommerceEnabled: true
            }
          }
        }
      },
      accounts: {
        create: [
          {
            id: 'STORE-A-MANUAL',
            name: 'STORE-A-MANUAL',
            config: {
              identity: { language: 'en' },
              capabilities: { ecommerceEnabled: true }
            }
          },
          {
            id: 'STORE-B-MANUAL',
            name: 'STORE-B-MANUAL',
            config: {
              identity: { language: 'fr' },
              capabilities: { ecommerceEnabled: true }
            }
          },
          {
            id: 'STORE-C-OFF-MANUAL',
            name: 'STORE-C-OFF-MANUAL',
            config: {
              capabilities: { ecommerceEnabled: false }
            }
          }
        ]
      }
    },
    include: { accounts: true }
  });

  console.log(`Created tenant: ${tenant.id} with accounts: STORE-A-MANUAL, STORE-B-MANUAL, STORE-C-OFF-MANUAL`);

  // 3. Create Products for STORE-A-MANUAL
  // Product 1: Atlas Running Shoes
  const p1 = await prisma.product.create({
    data: {
      tenantId: tenant.id,
      accountId: 'STORE-A-MANUAL',
      name: 'Atlas Running Shoes',
      sku: 'MAN-A-SHOE-001',
      price: 120,
      currency: 'MAD',
      stock: 10,
      category: 'Shoes',
      description: 'High-performance all-weather road running shoes.',
      active: true,
      nameLocalized: {
        en: 'Atlas Running Shoes',
        fr: 'Chaussures de course Atlas',
        ar: 'حذاء الجري أطلس',
        darija: 'Sbbat l-jri Atlas'
      },
      descriptionLocalized: {
        en: 'High-performance all-weather road running shoes.',
        fr: 'Chaussures de course sur route tout temps haute performance.',
        ar: 'حذاء جري متين وعالي الأداء لجميع الأحوال الجوية.',
        darija: 'Sbbat d l-jri s7i7 o khfif bzaf.'
      },
      variants: {
        create: [
          {
            sku: 'MAN-A-B42',
            color: 'Black',
            size: '42',
            priceOverride: 120,
            stock: 4,
            active: true
          },
          {
            sku: 'MAN-A-B43',
            color: 'Black',
            size: '43',
            priceOverride: 120,
            stock: 0,
            active: true
          },
          {
            sku: 'MAN-A-W42',
            color: 'White',
            size: '42',
            priceOverride: 130,
            stock: 2,
            active: true
          }
        ]
      }
    },
    include: { variants: true }
  });
  console.log(`Created product: ${p1.name} (SKU: ${p1.sku}) with 3 variants in STORE-A-MANUAL`);

  // Product 2: Atlas Lite Shoes
  const p2 = await prisma.product.create({
    data: {
      tenantId: tenant.id,
      accountId: 'STORE-A-MANUAL',
      name: 'Atlas Lite Shoes',
      sku: 'MAN-A-SHOE-002',
      price: 80,
      currency: 'MAD',
      stock: 7,
      category: 'Shoes',
      description: 'Breathable daily lightweight walking and training shoes.',
      active: true,
      nameLocalized: {
        en: 'Atlas Lite Shoes',
        fr: 'Chaussures Atlas Lite',
        ar: 'حذاء أطلس الخفيف',
        darija: 'Sbbat Atlas Lite'
      },
      descriptionLocalized: {
        en: 'Breathable daily lightweight walking and training shoes.',
        fr: 'Chaussures légères et respirantes pour la marche quotidienne.',
        ar: 'حذاء مريح وخفيف للمشي والتدريب اليومي.',
        darija: 'Sbbat mriye7 o khfif l kol nhar.'
      }
    }
  });
  console.log(`Created product: ${p2.name} (SKU: ${p2.sku}) in STORE-A-MANUAL`);

  // 4. Create Product for STORE-B-MANUAL
  // Product: Beta Leather Jacket
  const pB = await prisma.product.create({
    data: {
      tenantId: tenant.id,
      accountId: 'STORE-B-MANUAL',
      name: 'Beta Leather Jacket',
      sku: 'MAN-B-JACKET-001',
      price: 500,
      currency: 'MAD',
      stock: 3,
      category: 'Jackets',
      description: 'Premium handcrafted black leather motorcycle jacket.',
      active: true,
      nameLocalized: {
        en: 'Beta Leather Jacket',
        fr: 'Veste en cuir Beta',
        ar: 'سترة جلدية بيتا',
        darija: 'Fista d l-jeld Beta'
      },
      descriptionLocalized: {
        en: 'Premium handcrafted black leather motorcycle jacket.',
        fr: 'Veste de moto en cuir noir de première qualité confectionnée à la main.',
        ar: 'سترة دراجات نارية من الجلد الأسود الفاخر مصنوعة يدويًا.',
        darija: 'Fista d l-jeld l-k7al s7i7a o makhdouma b l-yed.'
      }
    }
  });
  console.log(`Created product: ${pB.name} (SKU: ${pB.sku}) in STORE-B-MANUAL`);

  // 5. Create Manual Customers
  const customerIds = ['manual-customer-A', 'manual-customer-B', 'manual-customer-C'];
  for (const cId of customerIds) {
    await prisma.customer.create({
      data: {
        tenantId: tenant.id,
        externalId: cId
      }
    });
    console.log(`Created customer: ${cId}`);
  }
}

async function main() {
  if (process.env.DATABASE_URL) {
    const { prisma: livePrisma, pool: livePool } = getPrismaClient(process.env.DATABASE_URL);
    try {
      await seedDatabase(livePrisma, livePool, 'DATABASE_URL', 'public');
    } finally {
      await livePrisma.$disconnect();
      await livePool.end();
    }
  }

  if (process.env.TEST_DATABASE_URL) {
    const { prisma: testPrisma, pool: testPool } = getPrismaClient(process.env.TEST_DATABASE_URL, 'test');
    try {
      await seedDatabase(testPrisma, testPool, 'TEST_DATABASE_URL (test schema)', 'test');
    } finally {
      await testPrisma.$disconnect();
      await testPool.end();
    }
  }
}

main()
  .catch((e) => {
    console.error('Seeding error:', e);
    process.exit(1);
  });
