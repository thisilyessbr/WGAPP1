import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

export interface MigrationResult {
  updatedTenants: string[];
  skippedTenants: string[];
  totalInspected: number;
}

/**
 * Migration: Finds all tenants where knowledge.enabled = false AND at least one 
 * completed knowledge source or document exists for that tenant, and sets knowledge.enabled = true.
 */
export async function migrateTenantKnowledgeFlags(prisma: PrismaClient): Promise<MigrationResult> {
  const configs = await prisma.tenantConfig.findMany();
  const updatedTenants: string[] = [];
  const skippedTenants: string[] = [];

  for (const record of configs) {
    const rawConfig = record.config as Record<string, any>;
    const isKnowledgeDisabled = !rawConfig.knowledge || rawConfig.knowledge.enabled === false;

    if (isKnowledgeDisabled) {
      const completedSourcesCount = await prisma.knowledgeSource.count({
        where: {
          tenantId: record.tenantId,
          status: 'COMPLETED'
        }
      });

      const docsCount = await prisma.knowledgeDocument.count({
        where: {
          tenantId: record.tenantId
        }
      });

      if (completedSourcesCount > 0 || docsCount > 0) {
        if (!rawConfig.knowledge) {
          rawConfig.knowledge = { enabled: true };
        } else {
          rawConfig.knowledge.enabled = true;
        }

        await prisma.tenantConfig.update({
          where: { tenantId: record.tenantId },
          data: { config: rawConfig }
        });

        updatedTenants.push(record.tenantId);
        console.log(`[MIGRATION] Enabled knowledge for tenant: "${record.tenantId}" (${docsCount} documents, ${completedSourcesCount} completed sources)`);
      } else {
        skippedTenants.push(record.tenantId);
      }
    } else {
      skippedTenants.push(record.tenantId);
    }
  }

  return {
    updatedTenants,
    skippedTenants,
    totalInspected: configs.length
  };
}

async function main() {
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

  try {
    console.log('--- Starting Knowledge Flag Migration for Pre-existing Tenants ---');
    const result = await migrateTenantKnowledgeFlags(prisma);
    console.log(`Migration Complete:`);
    console.log(`- Total Tenants Inspected: ${result.totalInspected}`);
    console.log(`- Tenants Updated: ${result.updatedTenants.length} (${result.updatedTenants.join(', ') || 'none'})`);
    console.log(`- Tenants Skipped / Already Enabled: ${result.skippedTenants.length}`);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
}
