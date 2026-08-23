import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

async function check() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  const products = await prisma.product.findMany({
    where: { tenantId: 'MANUAL-ECOMMERCE-TEST' },
    include: { variants: true }
  });
  console.log(JSON.stringify(products, null, 2));
  await prisma.$disconnect();
  await pool.end();
}
check();
