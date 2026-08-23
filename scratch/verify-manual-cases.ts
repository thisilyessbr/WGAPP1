import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { bootstrapChatbot } from '../src/bootstrap';

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });
  const deps = bootstrapChatbot(prisma);
  const tenantId = 'MANUAL-ECOMMERCE-TEST';
  const accountId = 'STORE-A-MANUAL';
  const custId = `manual-verify-${Date.now()}`;

  console.log('=== RUNNING 8-TURN VERIFICATION ON MANUAL FIXTURE ===\n');

  const turns = [
    'show me shoes',
    'tell me about Atlas Running Shoes',
    'how much is it?',
    'is black size 42 available?',
    'is black size 43 available?',
    'what about white size 42?',
    'tell me about Atlas Running Shoes',
    'is Atlas Running Shoes available?'
  ];

  for (let i = 0; i < turns.length; i++) {
    const msg = turns[i];
    console.log(`[Turn ${i + 1}] User: "${msg}"`);
    const reply = await deps.conversationEngine.handleMessage(tenantId, custId, msg, accountId);
    console.log(`Bot: "${reply.replace(/\n/g, ' ')}"\n`);
  }

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
