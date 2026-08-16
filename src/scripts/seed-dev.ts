import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { DEFAULT_BUSINESS_CONFIG } from '../domain/tenant/BusinessConfig';
import { bootstrapChatbot } from '../bootstrap';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });
const deps = bootstrapChatbot(prisma);

async function main() {
  console.log('Seeding dev-tenant...');

  const tenantId = 'dev-tenant';
  
  // Upsert Tenant
  await prisma.tenant.upsert({
    where: { id: tenantId },
    update: { name: 'Development Tenant' },
    create: { id: tenantId, name: 'Development Tenant' },
  });

  // Prepare Config
  const config = JSON.parse(JSON.stringify(DEFAULT_BUSINESS_CONFIG));
  
  // Enable RAG
  config.knowledge.enabled = true;
  config.knowledge.minSimilarityScore = 0.5; // low threshold for testing dummy vectors

  // Inject TUTOR_SESSION intent and workflow
  config.capabilities.intents.push({ id: 'TUTOR_SESSION', description: 'Start a tutoring session' });
  config.workflows['TUTOR_SESSION'] = {
    id: 'TUTOR_SESSION',
    name: 'Tutoring',
    description: 'Book a tutoring session',
    initialState: 'collect_student',
    allowInterruption: false,
    states: {
      collect_student: {
        type: 'collect',
        field: { name: 'studentName', required: true, type: 'string', prompt: "What is the student's name?" },
        transitions: [{ target: 'collect_subject', default: true }]
      },
      collect_subject: {
        type: 'collect',
        field: { name: 'subject', required: true, type: 'string', prompt: 'Which subject?' },
        transitions: [{ target: 'collect_date', default: true }]
      },
      collect_date: {
        type: 'collect',
        field: { name: 'date', required: true, type: 'string', prompt: 'What date would you like to book?' },
        transitions: [{ target: 'collect_duration', default: true }]
      },
      collect_duration: {
        type: 'collect',
        field: { name: 'duration', required: true, type: 'number', prompt: 'Duration in minutes?', min: 30, max: 120 },
        transitions: [{ target: 'confirm_booking', default: true }]
      },
      confirm_booking: {
        type: 'collect',
        prompt: 'confirm',
        transitions: [{ target: 'end', condition: 'true', default: true }] // Wait, evaluator uses `always` but also `default` works.
      },
      end: {
        type: 'end',
        prompt: 'Your tutoring session is booked!'
      }
    }
  };

  await prisma.tenantConfig.upsert({
    where: { tenantId },
    update: { config },
    create: { tenantId, config },
  });

  console.log('dev-tenant config upserted.');

  // Create a dummy PDF Knowledge Document
  // In a real scenario, this would use the PDF library buffer.
  // For dev seeding without requiring a physical file, we can inject chunks directly or mock the ingestion.
  // We'll inject directly to the knowledge repo.
  console.log('Injecting dummy knowledge for RAG test...');
  const source = await prisma.knowledgeSource.create({
    data: {
      tenantId,
      name: 'Tutoring FAQs',
      type: 'TEXT'
    }
  });

  const doc = await prisma.knowledgeDocument.create({
    data: {
      tenantId,
      sourceId: source.id,
      title: 'General Info',
      content: 'We offer tutoring in Math, Physics, and History. Our rates are $50/hour. We are open Monday to Friday.'
    }
  });

  const vector = await (deps.ragService as any).embeddingProvider.embedText('math physics history cost');
  await (deps.ragService as any).knowledgeRepository.insertChunk(tenantId, doc.id, 'We offer tutoring in Math, Physics, and History. Our rates are $50/hour. We are open Monday to Friday.', vector);

  console.log('Dummy knowledge injected.');
  console.log('Seeding complete!');
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
