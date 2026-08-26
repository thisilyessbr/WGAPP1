import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { DEFAULT_BUSINESS_CONFIG, BusinessConfig } from '../src/domain/tenant/BusinessConfig';
import { bootstrapChatbot } from '../src/bootstrap';
import { ProductRepository } from '../src/domain/ecommerce/ProductRepository';

function createPdfBuffer(title: string, bodyText: string): Buffer {
  const safeTitle = title.replace(/[()\\]/g, '');
  const lines: string[] = [];
  const words = bodyText.replace(/[()\\]/g, '').split(/\s+/);
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > 60) {
      if (cur) lines.push(cur);
      cur = w;
    } else {
      cur = (cur + ' ' + w).trim();
    }
  }
  if (cur) lines.push(cur);

  let y = 750;
  let streamContent = `BT /F1 16 Tf 50 ${y} Td (${safeTitle}) Tj ET\n`;
  y -= 30;
  for (const line of lines) {
    streamContent += `BT /F1 12 Tf 50 ${y} Td (${line}) Tj ET\n`;
    y -= 20;
  }
  const streamLen = Buffer.byteLength(streamContent, 'utf-8');

  const obj1 = `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`;
  const obj2 = `2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n`;
  const obj3 = `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n`;
  const obj4 = `4 0 obj\n<< /Length ${streamLen} >>\nstream\n${streamContent}endstream\nendobj\n`;
  const obj5 = `5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`;

  const header = `%PDF-1.4\n`;
  const offset1 = Buffer.byteLength(header, 'utf-8');
  const offset2 = offset1 + Buffer.byteLength(obj1, 'utf-8');
  const offset3 = offset2 + Buffer.byteLength(obj2, 'utf-8');
  const offset4 = offset3 + Buffer.byteLength(obj3, 'utf-8');
  const offset5 = offset4 + Buffer.byteLength(obj4, 'utf-8');
  const xrefOffset = offset5 + Buffer.byteLength(obj5, 'utf-8');

  const pad = (n: number) => String(n).padStart(10, '0');
  const xref = `xref\n0 6\n0000000000 65535 f \n${pad(offset1)} 00000 n \n${pad(offset2)} 00000 n \n${pad(offset3)} 00000 n \n${pad(offset4)} 00000 n \n${pad(offset5)} 00000 n \n`;
  const trailer = `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(header + obj1 + obj2 + obj3 + obj4 + obj5 + xref + trailer, 'utf-8');
}

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new Error('DATABASE_URL is not set!');
  }

  console.log('Connecting to development database (public schema)...');
  const pool = new Pool({ connectionString: dbUrl });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });
  await prisma.$connect();

  const deps = bootstrapChatbot(prisma);
  const productRepo = new ProductRepository(prisma);

  try {
    // -------------------------------------------------------------
    // Tenant A: Sahara Voyages (Travel Agency)
    // -------------------------------------------------------------
    console.log('\n1. Seeding Tenant A: Sahara Voyages (Travel Agency)...');
    const tenantAId = 'sahara-voyages';
    await prisma.tenant.upsert({
      where: { id: tenantAId },
      update: { name: 'Sahara Voyages' },
      create: { id: tenantAId, name: 'Sahara Voyages' }
    });

    const configA: BusinessConfig = {
      ...DEFAULT_BUSINESS_CONFIG,
      identity: {
        ...DEFAULT_BUSINESS_CONFIG.identity,
        botName: 'Sahara Guide',
        brand: 'Sahara Voyages',
        companyName: 'Sahara Voyages Morocco',
        industry: 'Travel & Excursions'
      },
      capabilities: {
        ...DEFAULT_BUSINESS_CONFIG.capabilities,
        ecommerceEnabled: false,
        intents: []
      },
      workflows: {},
      knowledge: {
        ...DEFAULT_BUSINESS_CONFIG.knowledge,
        enabled: true,
        topK: 3,
        minSimilarityScore: 0.45
      }
    };
    await deps.tenantConfigService.updateConfig(tenantAId, configA);

    const pdfA = createPdfBuffer(
      'Sahara Voyages Excursions and Booking Policies',
      'Sahara Tour Package: Standard Sahara 3-day tour is 1500 MAD per person including camel trekking and luxury desert camp. Cancellation Policy: Full refund up to 48 hours before departure. Booking Office Hours: Monday to Saturday from 9:00 AM to 6:00 PM. Destinations: Merzouga, Zagora, and Ouarzazate.'
    );
    await deps.pdfIngestionService.ingestPdf(tenantAId, pdfA, 'sahara-tours.pdf', configA);
    console.log('✓ Sahara Voyages seeded.');

    // -------------------------------------------------------------
    // Tenant B: Atlas Fitness Academy (Fitness Coaching)
    // -------------------------------------------------------------
    console.log('\n2. Seeding Tenant B: Atlas Fitness Academy (Fitness Coaching)...');
    const tenantBId = 'atlas-fitness';
    await prisma.tenant.upsert({
      where: { id: tenantBId },
      update: { name: 'Atlas Fitness Academy' },
      create: { id: tenantBId, name: 'Atlas Fitness Academy' }
    });

    const configB: BusinessConfig = {
      ...DEFAULT_BUSINESS_CONFIG,
      identity: {
        ...DEFAULT_BUSINESS_CONFIG.identity,
        botName: 'Atlas Coach',
        brand: 'Atlas Fitness Academy',
        companyName: 'Atlas Fitness Academy',
        industry: 'Fitness Coaching'
      },
      capabilities: {
        ...DEFAULT_BUSINESS_CONFIG.capabilities,
        ecommerceEnabled: false,
        intents: [
          { id: 'fitness_consultation', description: 'Book a free fitness consultation', workflowId: 'fitness_consultation' }
        ]
      },
      workflows: {
        fitness_consultation: {
          id: 'fitness_consultation',
          name: 'Fitness Consultation',
          description: 'Intake workflow for fitness coaching programs',
          initialState: 'collect_name',
          allowInterruption: true,
          states: {
            collect_name: {
              type: 'collect',
              prompt: 'What is your full name?',
              field: { name: 'userName', type: 'string', required: true },
              transitions: [{ target: 'collect_phone', default: true }]
            },
            collect_phone: {
              type: 'collect',
              prompt: 'Please provide your phone number (e.g. +212612345678):',
              field: { name: 'phone', type: 'phone', required: true },
              transitions: [{ target: 'collect_goal', default: true }]
            },
            collect_goal: {
              type: 'collect',
              prompt: 'What is your main fitness goal (e.g. weight loss, muscle gain)?',
              field: { name: 'fitnessGoal', type: 'string', required: true },
              transitions: [{ target: 'confirm_step', default: true }]
            },
            confirm_step: {
              type: 'confirm',
              prompt: 'confirm',
              confirmKeywords: ['yes', 'confirm', 'oui', 'wakha', 'نعم'],
              cancelKeywords: ['no', 'cancel', 'non', 'لا'],
              transitions: [{ target: 'end_step', default: true }]
            },
            end_step: {
              type: 'end',
              prompt: 'Thank you {{userName}}! Your fitness consultation for {{fitnessGoal}} is booked. We will reach you at {{phone}}.'
            }
          }
        }
      },
      knowledge: {
        ...DEFAULT_BUSINESS_CONFIG.knowledge,
        enabled: true,
        topK: 3,
        minSimilarityScore: 0.45
      }
    };
    await deps.tenantConfigService.updateConfig(tenantBId, configB);

    const pdfB = createPdfBuffer(
      'Atlas Fitness Pricing and Session Policies',
      'Atlas Coaching Pricing: Private 1-on-1 coaching sessions are 300 MAD per session. Coaching Program Duration: standard transformation program lasts 12 weeks. Cancellation Policy: Sessions can be rescheduled up to 24 hours in advance with no fee.'
    );
    await deps.pdfIngestionService.ingestPdf(tenantBId, pdfB, 'fitness-policies.pdf', configB);
    console.log('✓ Atlas Fitness Academy seeded.');

    // -------------------------------------------------------------
    // Tenant C: Tech Haven (Electronics)
    // -------------------------------------------------------------
    console.log('\n3. Seeding Tenant C: Tech Haven (Electronics)...');
    const tenantCId = 'tech-haven';
    await prisma.tenant.upsert({
      where: { id: tenantCId },
      update: { name: 'Tech Haven' },
      create: { id: tenantCId, name: 'Tech Haven' }
    });

    const accountC = await prisma.account.upsert({
      where: { id: 'tech-haven-flagship' },
      update: { name: 'Tech Haven Flagship', tenantId: tenantCId },
      create: { id: 'tech-haven-flagship', name: 'Tech Haven Flagship', tenantId: tenantCId }
    });

    const configC: BusinessConfig = {
      ...DEFAULT_BUSINESS_CONFIG,
      identity: {
        ...DEFAULT_BUSINESS_CONFIG.identity,
        botName: 'Tech Haven Assistant',
        brand: 'Tech Haven',
        companyName: 'Tech Haven Electronics',
        industry: 'Consumer Electronics'
      },
      capabilities: {
        ...DEFAULT_BUSINESS_CONFIG.capabilities,
        ecommerceEnabled: true,
        intents: []
      },
      workflows: {},
      knowledge: {
        ...DEFAULT_BUSINESS_CONFIG.knowledge,
        enabled: true,
        topK: 3,
        minSimilarityScore: 0.45
      }
    };
    await deps.tenantConfigService.updateConfig(tenantCId, configC);

    // Seed Electronics Products
    const pC1 = await prisma.product.findFirst({ where: { tenantId: tenantCId, sku: 'ELEC-LAP-001' } });
    if (!pC1) {
      await productRepo.createProduct(tenantCId, accountC.id, {
        name: 'Gaming Laptop RTX',
        sku: 'ELEC-LAP-001',
        price: 12000,
        stock: 5,
        category: 'Laptops',
        description: 'High performance gaming laptop with dedicated GPU.',
        metadata: { ram: '32GB', storage: '1TB', gpu: 'RTX 4060', tags: ['gaming'] }
      });
    }

    const pC2 = await prisma.product.findFirst({ where: { tenantId: tenantCId, sku: 'ELEC-LAP-002' } });
    if (!pC2) {
      await productRepo.createProduct(tenantCId, accountC.id, {
        name: 'Business Ultrabook',
        sku: 'ELEC-LAP-002',
        price: 7500,
        stock: 10,
        category: 'Laptops',
        description: 'Slim lightweight laptop designed for office professionals.',
        metadata: { ram: '16GB', storage: '512GB', tags: ['business'] }
      });
    }

    const pC3 = await prisma.product.findFirst({ where: { tenantId: tenantCId, sku: 'ELEC-MON-001' } });
    if (!pC3) {
      await productRepo.createProduct(tenantCId, accountC.id, {
        name: 'UltraWide 4K Monitor',
        sku: 'ELEC-MON-001',
        price: 3500,
        stock: 8,
        category: 'Monitors',
        description: '34 inch curved IPS display with HDR support.',
        metadata: { panel: 'IPS', refreshRate: '144Hz' }
      });
    }

    const pdfC = createPdfBuffer(
      'Tech Haven Warranty & Shipping Policies',
      'Tech Haven Warranty: Standard hardware warranty is 2 years covering all manufacturing defects. Express Shipping takes 24 to 48 hours across major cities with free returns within 14 days.'
    );
    await deps.pdfIngestionService.ingestPdf(tenantCId, pdfC, 'tech-warranty.pdf', configC, accountC.id);
    console.log('✓ Tech Haven seeded.');

    // -------------------------------------------------------------
    // Tenant D: Nordic Oak Home (Furniture)
    // -------------------------------------------------------------
    console.log('\n4. Seeding Tenant D: Nordic Oak Home (Furniture)...');
    const tenantDId = 'nordic-oak';
    await prisma.tenant.upsert({
      where: { id: tenantDId },
      update: { name: 'Nordic Oak Home' },
      create: { id: tenantDId, name: 'Nordic Oak Home' }
    });

    const accountD = await prisma.account.upsert({
      where: { id: 'nordic-oak-showroom' },
      update: { name: 'Nordic Oak Showroom', tenantId: tenantDId },
      create: { id: 'nordic-oak-showroom', name: 'Nordic Oak Showroom', tenantId: tenantDId }
    });

    const configD: BusinessConfig = {
      ...DEFAULT_BUSINESS_CONFIG,
      identity: {
        ...DEFAULT_BUSINESS_CONFIG.identity,
        botName: 'Nordic Assistant',
        brand: 'Nordic Oak Home',
        companyName: 'Nordic Oak Furniture',
        industry: 'Furniture & Decor'
      },
      capabilities: {
        ...DEFAULT_BUSINESS_CONFIG.capabilities,
        ecommerceEnabled: true,
        intents: [
          { id: 'interior_consultation', description: 'Schedule an interior design consultation', workflowId: 'interior_consultation' }
        ]
      },
      workflows: {
        interior_consultation: {
          id: 'interior_consultation',
          name: 'Interior Consultation',
          description: 'Design consultation booking for home and office furnishing',
          initialState: 'collect_name',
          allowInterruption: true,
          states: {
            collect_name: {
              type: 'collect',
              prompt: 'What is your full name?',
              field: { name: 'clientName', type: 'string', required: true },
              transitions: [{ target: 'collect_phone', default: true }]
            },
            collect_phone: {
              type: 'collect',
              prompt: 'Please provide your contact phone number:',
              field: { name: 'phone', type: 'phone', required: true },
              transitions: [{ target: 'collect_room', default: true }]
            },
            collect_room: {
              type: 'collect',
              prompt: 'Which room are you furnishing (e.g. Living Room, Office, Bedroom)?',
              field: { name: 'roomType', type: 'string', required: true },
              transitions: [{ target: 'confirm_step', default: true }]
            },
            confirm_step: {
              type: 'confirm',
              prompt: 'confirm',
              confirmKeywords: ['yes', 'confirm', 'oui', 'wakha', 'نعم'],
              cancelKeywords: ['no', 'cancel', 'non', 'لا'],
              transitions: [{ target: 'end_step', default: true }]
            },
            end_step: {
              type: 'end',
              prompt: 'Thank you {{clientName}}! Your interior consultation for {{roomType}} is booked at {{phone}}.'
            }
          }
        }
      },
      knowledge: {
        ...DEFAULT_BUSINESS_CONFIG.knowledge,
        enabled: true,
        topK: 3,
        minSimilarityScore: 0.45
      }
    };
    await deps.tenantConfigService.updateConfig(tenantDId, configD);

    // Seed Furniture Products
    const pD1 = await prisma.product.findFirst({ where: { tenantId: tenantDId, sku: 'FURN-DESK-001' } });
    if (!pD1) {
      await productRepo.createProduct(tenantDId, accountD.id, {
        name: 'Executive Oak Desk',
        sku: 'FURN-DESK-001',
        price: 2200,
        stock: 4,
        category: 'Desks',
        description: 'Solid oak modern executive writing desk.',
        metadata: { material: 'Oak', width: '140cm', weight: '35kg' }
      });
    }

    const pD2 = await prisma.product.findFirst({ where: { tenantId: tenantDId, sku: 'FURN-CHAIR-001' } });
    if (!pD2) {
      await productRepo.createProduct(tenantDId, accountD.id, {
        name: 'Office Chair',
        sku: 'FURN-CHAIR-001',
        price: 950,
        stock: 12,
        category: 'Chairs',
        description: 'Genuine leather adjustable office chair.',
        metadata: { material: 'Leather', adjustable: true }
      });
    }

    const pD3 = await prisma.product.findFirst({ where: { tenantId: tenantDId, sku: 'FURN-TABLE-001' } });
    if (!pD3) {
      await productRepo.createProduct(tenantDId, accountD.id, {
        name: 'Dining Table',
        sku: 'FURN-TABLE-001',
        price: 3200,
        stock: 3,
        category: 'Tables',
        description: 'Handcrafted solid oak dining table seats 8.',
        metadata: { material: 'Oak', seats: 8 }
      });
    }

    const pdfD = createPdfBuffer(
      'Nordic Oak Delivery & Assembly Services',
      'Nordic Oak Delivery: Standard furniture delivery takes 3 to 5 business days with professional white-glove assembly service available for 100 MAD. 5-year structural warranty on all solid wood items.'
    );
    await deps.pdfIngestionService.ingestPdf(tenantDId, pdfD, 'furniture-assembly.pdf', configD, accountD.id);
    console.log('✓ Nordic Oak Home seeded.');

    console.log('\n--- All 4 Persistent Development Acceptance Tenants Seeded Successfully! ---');
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch(err => {
  console.error('Seeding error:', err);
  process.exit(1);
});
