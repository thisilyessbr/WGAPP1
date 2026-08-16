// Utility: Runs an automated 16-query evaluation across on-topic, borderline, and off-topic queries to benchmark RAG similarity distributions.
// Usage: npm run rag:benchmark or node scripts/benchmark-rag.js [tenantId]

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');
const { GeminiEmbeddingProvider } = require('../src/core/rag/GeminiEmbeddingProvider');

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

const querySet = [
  // Category A: On-Topic (Direct & Paraphrased)
  { category: 'On-Topic (Direct)', query: "How much does the Starter plan cost?" },
  { category: 'On-Topic (Direct)', query: "What are your business support operating hours?" },
  { category: 'On-Topic (Paraphrased)', query: "Can I get my money back within a month if I'm not satisfied?" },
  { category: 'On-Topic (Paraphrased)', query: "Do I need to send my account password to your customer support team?" },
  { category: 'On-Topic (Paraphrased)', query: "How can I upgrade my subscription or get custom terms?" },
  { category: 'On-Topic (Direct)', query: "What kind of software does Atlas Assistant build?" },

  // Category B: Borderline / Ambiguous / Partial
  { category: 'Borderline/Adjacent', query: "Do you offer any automation tools for sales and CRM?" },
  { category: 'Borderline/Broad', query: "How do I contact customer service?" },
  { category: 'Borderline/Adjacent', query: "Can you help me reset my account credentials?" },
  { category: 'Borderline/Short', query: "Tell me about your enterprise pricing options." },
  { category: 'Borderline/Vague', query: "Tell me more about your features." },

  // Category C: Off-Topic
  { category: 'Off-Topic', query: "What is the capital of France?" },
  { category: 'Off-Topic', query: "Write a Python script to calculate Fibonacci numbers." },
  { category: 'Off-Topic', query: "What are the best ingredients for making Italian pasta?" },
  { category: 'Off-Topic', query: "Who won the World Cup in 2022?" },
  { category: 'Off-Topic', query: "Explain Einstein's theory of general relativity." }
];

async function runBenchmark() {
  const provider = new GeminiEmbeddingProvider();
  const tenantId = process.argv[2] || 'dev-tenant';

  const chunks = await prisma.knowledgeChunk.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'asc' }
  });

  console.log(`Knowledge Base Chunks for ${tenantId}: ${chunks.length} chunks\n`);
  if (chunks.length === 0) {
    console.warn(`No knowledge chunks found for tenant "${tenantId}". Please upload or seed documents first.`);
    return;
  }

  chunks.forEach((c, idx) => {
    console.log(`[Chunk ${idx + 1} (${c.id.substring(0, 8)})]: ${c.content.replace(/\n/g, ' ').substring(0, 90)}...`);
  });

  console.log('\n========================================================================================');
  console.log('RUNNING DIVERSE 16-QUERY BENCHMARK (gemini-embedding-001, 3072 dims, Cosine Similarity)');
  console.log('========================================================================================\n');

  const results = [];

  for (const item of querySet) {
    const vector = await provider.embedText(item.query);
    const vecStr = `[${vector.join(',')}]`;

    const scores = await prisma.$queryRaw`
      SELECT 
        id, 
        1 - (embedding <=> ${vecStr}::vector) as similarity
      FROM "KnowledgeChunk"
      WHERE "tenantId" = ${tenantId}
      ORDER BY similarity DESC
    `;

    const maxScore = scores[0].similarity;
    const minScore = scores[scores.length - 1].similarity;

    results.push({
      category: item.category,
      query: item.query,
      maxScore: Number(maxScore.toFixed(4)),
      minScore: Number(minScore.toFixed(4)),
      scores: scores.map(s => Number(s.similarity.toFixed(4)))
    });
  }

  console.table(results.map(r => ({
    Category: r.category,
    Query: r.query,
    'Top Score': r.maxScore,
    'Chunk 2 Score': r.scores[1] || 'N/A',
    'Score Range': `${r.minScore} - ${r.maxScore}`
  })));

  const grouped = {
    'On-Topic (All)': results.filter(r => r.category.startsWith('On-Topic')),
    'Borderline (All)': results.filter(r => r.category.startsWith('Borderline')),
    'Off-Topic (All)': results.filter(r => r.category === 'Off-Topic')
  };

  console.log('\n========================================================================================');
  console.log('CATEGORY SCORE DISTRIBUTIONS');
  console.log('========================================================================================');

  for (const [catName, list] of Object.entries(grouped)) {
    const maxScores = list.map(r => r.maxScore);
    const min = Math.min(...maxScores);
    const max = Math.max(...maxScores);
    const avg = maxScores.reduce((a, b) => a + b, 0) / maxScores.length;
    console.log(`\n${catName} (N=${list.length}):`);
    console.log(`  Min Top-Score: ${min.toFixed(4)}`);
    console.log(`  Max Top-Score: ${max.toFixed(4)}`);
    console.log(`  Avg Top-Score: ${avg.toFixed(4)}`);
    console.log(`  Score values:  [${maxScores.join(', ')}]`);
  }
}

runBenchmark().catch(console.error).finally(() => {
  prisma.$disconnect();
  pool.end();
});
