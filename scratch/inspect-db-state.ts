import { prisma, pool } from '../src/tests/testDb';

async function inspectData() {
  const client = await pool.connect();
  try {
    await client.query('SET search_path TO test, public, extensions;');
  } finally {
    client.release();
  }

  const sources = await prisma.knowledgeSource.findMany();
  console.log(`KnowledgeSource count: ${sources.length}`);
  const globalSources = sources.filter(s => !s.accountId);
  const accountSources = sources.filter(s => s.accountId);
  console.log(`- Global sources (accountId IS NULL): ${globalSources.length}`);
  console.log(`- Account-scoped sources: ${accountSources.length}`);

  const accounts = await prisma.account.findMany();
  console.log(`Account count: ${accounts.length}`);
  for (const acc of accounts) {
    console.log(`- Account id: ${acc.id}, name: ${acc.name}, tenantId: ${acc.tenantId}`);
  }

  const tenants = await prisma.tenant.findMany();
  console.log(`Tenant count: ${tenants.length}`);
  for (const t of tenants) {
    console.log(`- Tenant id: ${t.id}, name: ${t.name}`);
  }
}

inspectData().catch(console.error);
