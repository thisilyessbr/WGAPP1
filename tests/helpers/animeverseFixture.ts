import { prisma } from '../../src/tests/testDb';
import { MockEmbeddingProvider } from '../../src/core/rag/EmbeddingProvider';
import { seedAnimeVerse } from '../../scripts/seed-animeverse-client';

/**
 * The policy suites require the AnimeVerse catalogue and policy PDFs. Keep
 * that dependency explicit and seed only the isolated TEST_DATABASE_SCHEMA.
 * Never invoke the seed script's development/public-database entry point here.
 */
export async function ensureAnimeVerseFixture(): Promise<void> {
  await seedAnimeVerse(prisma, 'isolated integration-test schema', new MockEmbeddingProvider());

  const completedSources = await prisma.knowledgeSource.count({
    where: { tenantId: 'animeverse', status: 'COMPLETED' }
  });
  const chunkCount = await prisma.knowledgeChunk.count({
    where: { tenantId: 'animeverse' }
  });
  if (completedSources === 0 || chunkCount === 0) {
    throw new Error('AnimeVerse test fixture did not create searchable knowledge.');
  }
}
