import express from 'express';
import request from 'supertest';
import { prisma, pool } from '../src/tests/testDb';
import { bootstrapChatbot } from '../src/bootstrap';
import { createDevChatRouter } from '../src/dev/chatApi';

async function run() {
  const client = await pool.connect();
  try {
    await client.query('SET search_path TO test, public, extensions;');
  } finally {
    client.release();
  }

  const tenantId = 'tenant_rt_51c';
  const accountId = 'acc_rt_51c';

  // Seed tenant & account
  await prisma.message.deleteMany({ where: { tenantId } });
  await prisma.conversation.deleteMany({ where: { tenantId } });
  await prisma.workflowSession.deleteMany({ where: { tenantId } });
  await prisma.productVariant.deleteMany({ where: { product: { tenantId } } });
  await prisma.product.deleteMany({ where: { tenantId } });
  await prisma.tenantConfig.deleteMany({ where: { tenantId } });
  await prisma.account.deleteMany({ where: { tenantId } });
  await prisma.tenant.deleteMany({ where: { id: tenantId } });

  await prisma.tenant.create({
    data: {
      id: tenantId,
      name: 'Runtime 51C Tenant'
    }
  });

  await prisma.tenantConfig.create({
    data: {
      tenantId,
      config: {
        identity: { botName: 'RTBot', language: 'en' },
        capabilities: { ecommerceEnabled: true }
      }
    }
  });

  await prisma.account.create({
    data: {
      id: accountId,
      tenantId,
      name: 'RT 51C Store',
      config: {
        capabilities: { ecommerceEnabled: true }
      }
    }
  });

  // Seed product with images and video
  await prisma.product.create({
    data: {
      id: 'prod-rtx-51c',
      tenantId,
      accountId,
      name: 'Gaming Laptop RTX',
      sku: 'LAP-RTX-51C',
      description: 'Ultra fast RTX gaming laptop',
      price: 1500,
      currency: 'USD',
      stock: 5,
      category: 'Laptops',
      active: true,
      metadata: {
        images: [
          'https://cdn.example.com/laptop-rtx-1.webp',
          'https://cdn.example.com/laptop-rtx-2.webp',
          'https://cdn.example.com/laptop-rtx-3.webp'
        ],
        video: 'https://cdn.example.com/laptop-rtx-demo.mp4',
        thumbnail: 'https://cdn.example.com/laptop-rtx-poster.webp'
      }
    }
  });

  const deps = bootstrapChatbot(prisma);
  const app = express();
  app.use(express.json());
  const devRouter = createDevChatRouter(deps);
  app.use('/api/dev', devRouter);

  console.log('=== RUNTIME 51C MEDIA FOLLOW-UP VERIFICATION START ===\n');

  const customerId = 'cust_51c_' + Date.now();

  const queries = [
    { num: 1, text: 'Show me the Gaming Laptop RTX' },
    { num: 2, text: 'Show me pictures of it' },
    { num: 3, text: 'Show me video of it' },
    { num: 4, text: 'wrini video dial laptop' },
    { num: 5, text: 'wrini lvideo dial laptop' },
    { num: 6, text: 'وريني فيديو ديالو' },
    { num: 7, text: 'montre-moi la vidéo de celui-ci' }
  ];

  for (const q of queries) {
    const res = await request(app)
      .post('/api/dev/chat')
      .set('x-tenant-id', tenantId)
      .set('x-account-id', accountId)
      .send({
        customerId,
        message: q.text
      });

    console.log(`[QUERY ${q.num}] "${q.text}"`);
    console.log(`Status: ${res.status}`);
    console.log(`Media Count: ${res.body.media?.length || 0}`);
    console.log(`Media Payload: ${JSON.stringify(res.body.media || [])}`);
    console.log(`Message Snippet: ${res.body.message?.slice(0, 150)}`);
    console.log('-------------------------------------------');
  }

  console.log('\n=== RUNTIME 51C MEDIA FOLLOW-UP VERIFICATION COMPLETE ===');

  // Cleanup
  await prisma.message.deleteMany({ where: { tenantId } });
  await prisma.conversation.deleteMany({ where: { tenantId } });
  await prisma.workflowSession.deleteMany({ where: { tenantId } });
  await prisma.productVariant.deleteMany({ where: { product: { tenantId } } });
  await prisma.product.deleteMany({ where: { tenantId } });
  await prisma.tenantConfig.deleteMany({ where: { tenantId } });
  await prisma.account.deleteMany({ where: { tenantId } });
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.$disconnect();
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
