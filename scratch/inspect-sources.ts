import { prisma, pool } from '../src/tests/testDb';

async function inspectSources() {
  const client = await pool.connect();
  try {
    await client.query('SET search_path TO test, public, extensions;');
  } finally {
    client.release();
  }

  const sources = await prisma.knowledgeSource.findMany({
    select: { id: true, tenantId: true, accountId: true, name: true, status: true, hash: true, createdAt: true }
  });
  console.log(`=== KNOWLEDGE SOURCES IN DB: ${sources.length} ===`);
  for (const s of sources) {
    console.log(`- id: ${s.id}, tenantId: ${s.tenantId}, accountId: ${s.accountId || 'NULL (GLOBAL)'}, name: ${s.name}, status: ${s.status}, hash: ${s.hash}`);
  }
}

inspectSources().catch(console.error);
