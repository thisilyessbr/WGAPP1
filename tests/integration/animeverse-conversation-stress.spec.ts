import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, pool } from '../../src/tests/testDb';
import { bootstrapChatbot } from '../../src/bootstrap';
import { EcommerceIntentParser } from '../../src/domain/ecommerce/EcommerceIntent';
import { createDevChatRouter, createSignedToken } from '../../src/dev/chatApi';
import express from 'express';
import request from 'supertest';

// Dynamic Valid PDF Generator Helper with Exact Byte Offsets and Word-Wrapping
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
  const xref = `xref\n0 6\n0000000000 65535 f \n${pad(offset1)} 00000 n \n${pad(offset2)} 00000 n \n${pad(offset3)} 00000 n \n${pad(offset4)} 00000 n \n${pad(offset5)} 00000 n \ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  const pdfStr = header + obj1 + obj2 + obj3 + obj4 + obj5 + xref;
  return Buffer.from(pdfStr, 'utf-8');
}

describe('Phase 24: AnimeVerse Conversational Pipeline Stress Gate (24 Scenarios)', () => {
  const tenantId = 'animeverse';
  const accountId = 'animeverse-store';
  let deps: ReturnType<typeof bootstrapChatbot>;
  let app: express.Application;

  beforeAll(async () => {
    const client = await pool.connect();
    try {
      await client.query('SET search_path TO test, public, extensions;');
    } finally {
      client.release();
    }
    deps = bootstrapChatbot(prisma);
    app = express();
    app.use(express.json());
    app.use('/api/dev', createDevChatRouter(deps));

    const token = createSignedToken({ tenantId, role: 'admin' });

    // Ingest AnimeVerse Knowledge PDFs into Store Account
    const sizeCarePdf = createPdfBuffer(
      'AnimeVerse Size Guide and Clothing Care Instructions',
      'Size Guide: Size M fits chest 98cm. Clothing Care Instructions: Machine wash cold with similar colors inside out at 30 degrees. Do not tumble dry. Do not iron directly on prints.'
    );

    const shippingReturnPdf = createPdfBuffer(
      'AnimeVerse Shipping Returns and Order Tracking Policy',
      'Shipping Policy: Delivery to Casablanca is 35 MAD. Free shipping across Morocco on orders over 400 MAD. Returns Policy: Return or exchange accepted within 14 days of delivery in original condition with tags. Order Tracking: You will receive an SMS and WhatsApp tracking link when your order ships to follow your delivery status.'
    );

    await request(app)
      .post(`/api/dev/upload?tenantId=${tenantId}&accountId=${accountId}`)
      .set('Authorization', `Bearer ${token}`)
      .attach('document', sizeCarePdf, 'animeverse_care_guide.pdf');

    await request(app)
      .post(`/api/dev/upload?tenantId=${tenantId}&accountId=${accountId}`)
      .set('Authorization', `Bearer ${token}`)
      .attach('document', shippingReturnPdf, 'animeverse_shipping_returns.pdf');
  }, 35000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('1. Ecommerce & Context State Machine (Scenarios 1–9, 15)', () => {
    it('Scenario 1: Product search in Darija', async () => {
      const customerId = `stress-1-${Date.now()}`;
      const res = await deps.conversationEngine.handleMessage(
        tenantId,
        customerId,
        'السلام عليكم، بغيت شي هودي ديال الأنمي يكون مزيان و مناسب للاستعمال اليومي',
        accountId
      );
      expect(res).toMatch(/(?:ها هما المنتوجات|Moon Ninja|Cyber Spirit)/i);
    });

    it('Scenario 2: Ordinal detail ("وريني تفاصيل الأول")', async () => {
      const customerId = `stress-2-${Date.now()}`;
      await deps.conversationEngine.handleMessage(tenantId, customerId, 'وريني الهوديات', accountId);
      const res = await deps.conversationEngine.handleMessage(tenantId, customerId, 'وريني تفاصيل الأول', accountId);
      expect(res).toMatch(/(?:السعر|الثمن|Prix|Price)/i);
      expect(res).toMatch(/599|399/);
    });

    it('Scenario 3: Contextual detail ("بغيت نعرف عليه كثر، شنو المادة ديالو وشنو المميزات ديالو؟")', async () => {
      const customerId = `stress-3-${Date.now()}`;
      await deps.conversationEngine.handleMessage(tenantId, customerId, 'وريني الهوديات', accountId);
      await deps.conversationEngine.handleMessage(tenantId, customerId, 'وريني تفاصيل الأول', accountId);
      const res = await deps.conversationEngine.handleMessage(
        tenantId,
        customerId,
        'بغيت نعرف عليه كثر، شنو المادة ديالو وشنو المميزات ديالو؟',
        accountId
      );
      expect(res).not.toContain('mafhemtch hadchi');
      expect(res).toMatch(/(?:الثمن|السعر|Price|Prix|MAD)/i);
    });

    it('Scenario 4: Contextual price follow-up ("وشحال الثمن ديالو دابا؟")', async () => {
      const customerId = `stress-4-${Date.now()}`;
      await deps.conversationEngine.handleMessage(tenantId, customerId, 'وريني الهوديات', accountId);
      const res = await deps.conversationEngine.handleMessage(tenantId, customerId, 'وشحال الثمن ديالو دابا؟', accountId);
      expect(res).toMatch(/(?:الثمن|سعر|price|prix)/i);
      expect(res).toMatch(/599|399/);
    });

    it('Scenario 5: Prepositional color availability ("واش كاين فالأسود؟")', async () => {
      const customerId = `stress-5-${Date.now()}`;
      await deps.conversationEngine.handleMessage(tenantId, customerId, 'وريني الهوديات', accountId);
      const res = await deps.conversationEngine.handleMessage(tenantId, customerId, 'واش كاين فالأسود؟', accountId);
      expect(res).toMatch(/(?:كاين|متوفر|disponible|available|مخزون)/i);
    });

    it('Scenario 6 & 7: Variant size selection & out-of-stock guard ("بغيت M" & "و L؟")', async () => {
      const customerId = `stress-6-${Date.now()}`;
      await deps.conversationEngine.handleMessage(tenantId, customerId, 'daba 3tini details 3la Cyber Spirit Jacket', accountId);
      
      // Cyber Spirit Jacket is only in size L
      const resM = await deps.conversationEngine.handleMessage(tenantId, customerId, 'بغيت M', accountId);
      expect(resM).toMatch(/(?:مسالي|ما كاينش|غير متوفر|out of stock|rupture)/i);

      const resL = await deps.conversationEngine.handleMessage(tenantId, customerId, 'و L؟', accountId);
      expect(resL).toMatch(/(?:كاين|متوفر|disponible|available|599)/i);
    });

    it('Scenario 8 & 9: Switch product & Switch back to past product', async () => {
      const customerId = `stress-8-${Date.now()}`;
      // 1. Start with Hoodie search
      await deps.conversationEngine.handleMessage(tenantId, customerId, 'وريني الهوديات', accountId);
      
      // 2. Explicitly switch to Cyber Spirit Jacket
      const resSwitch = await deps.conversationEngine.handleMessage(
        tenantId,
        customerId,
        'daba 3tini details 3la Cyber Spirit Jacket',
        accountId
      );
      expect(resSwitch).toMatch(/(?:Cyber Spirit|599)/i);

      // 3. Switch back to the hoodie
      const resBack = await deps.conversationEngine.handleMessage(
        tenantId,
        customerId,
        'w l hoodie, ch7al kan taman dyalo?',
        accountId
      );
      expect(resBack).toMatch(/(?:Moon Ninja|399)/i);
    });

    it('Scenario 10: Listing other available colors ("wach kayn chi loun akhor?")', async () => {
      const customerId = `stress-10-${Date.now()}`;
      await deps.conversationEngine.handleMessage(tenantId, customerId, 'daba 3tini details 3la Cyber Spirit Jacket', accountId);
      const resColors = await deps.conversationEngine.handleMessage(
        tenantId,
        customerId,
        'wach kayn chi loun akhor?',
        accountId
      );
      expect(resColors).not.toContain('mafhemtch hadchi');
      expect(resColors).toMatch(/(?:Cyber Black|couleurs|الألوان|colors)/i);
    });

    it('Scenario 15: Catalog search for uncatalogued/future collection', async () => {
      const customerId = `stress-15-${Date.now()}`;
      const res = await deps.conversationEngine.handleMessage(
        tenantId,
        customerId,
        'واش عندكم Attack on Titan collection جديدة الأسبوع الجاي؟',
        accountId
      );
      expect(res).toMatch(/(?:ما كاينينش|غير متوفر|لا توجد|not currently|catalogue|متجرنا)/i);
    });
  });

  describe('2. Knowledge, Policy, RAG & Hybrid Retrieval (Scenarios 10–14)', () => {
    it('Scenario 11: Care guide retrieval ("kifach nghsel l hoodie?")', async () => {
      const customerId = `stress-11-${Date.now()}`;
      const res = await deps.conversationEngine.handleMessage(
        tenantId,
        customerId,
        'kifach nghsel l hoodie?',
        accountId
      );
      expect(res).not.toContain('mafhemtch hadchi');
      expect(res).toMatch(/(?:ماء|غسل|froid|wash|cold|lavage|30)/i);
    });

    it('Scenario 12: Return policy retrieval ("wach n9der nrje3o ila ma3jebnich?")', async () => {
      const customerId = `stress-12-${Date.now()}`;
      const res = await deps.conversationEngine.handleMessage(
        tenantId,
        customerId,
        'wach n9der nrje3o ila ma3jebnich?',
        accountId
      );
      expect(res).not.toContain('mafhemtch hadchi');
      expect(res).toMatch(/(?:14|jours|يوم|ترجع|retour|return)/i);
    });

    it('Scenario 13: Shipping policy retrieval ("ch7al dyal livraison l Casablanca?")', async () => {
      const customerId = `stress-13-${Date.now()}`;
      const res = await deps.conversationEngine.handleMessage(
        tenantId,
        customerId,
        'ch7al dyal livraison l Casablanca?',
        accountId
      );
      expect(res).not.toContain('mafhemtch hadchi');
      expect(res).toMatch(/(?:35|400|livraison|توصيل|Casablanca|كازا)/i);
    });

    it('Scenario 14: Order tracking routing ("طلبت من عندكم، كيفاش غادي نتبع الطلب ديالي؟")', async () => {
      const customerId = `stress-14-${Date.now()}`;
      const res = await deps.conversationEngine.handleMessage(
        tenantId,
        customerId,
        'طلبت من عندكم، كيفاش غادي نتبع الطلب ديالي؟',
        accountId
      );
      expect(res).not.toContain('mafhemtch hadchi');
      expect(res).toMatch(/(?:تتبع|الطلب|رقم|suivi|track|WhatsApp|SMS|email|رسالة)/i);
    });

    it('Scenario 14B: Hybrid product + policy request ("شنو هي سياسة الإرجاع ديال Cyber Spirit Jacket؟")', async () => {
      const customerId = `stress-14b-${Date.now()}`;
      const res = await deps.conversationEngine.handleMessage(
        tenantId,
        customerId,
        'شنو هي سياسة الإرجاع ديال Cyber Spirit Jacket؟',
        accountId
      );
      expect(res).not.toContain('mafhemtch hadchi');
      expect(res).toMatch(/(?:14|إرجاع|استرجاع|يوم|Cyber Spirit|retour)/i);
    });
  });

  describe('3. Human Handoff & Resume Lifecycle (Scenarios 16–17)', () => {
    it('Scenario 16 & 17: Request handoff, stay silent while agent active, resume when resolved', async () => {
      const customerId = `stress-handoff-${Date.now()}`;
      
      // 1. Establish context with hoodie
      await deps.conversationEngine.handleMessage(tenantId, customerId, 'وريني الهوديات', accountId);

      // 2. Request handoff
      const handoffReply = await deps.conversationEngine.handleMessage(
        tenantId,
        customerId,
        'بغيت نهضر مع شي واحد من الدعم',
        accountId
      );
      expect(handoffReply).toMatch(/(?:الدعم|الموظفين|human|agent|conseiller)/i);

      // Verify conversation status is HANDOFF_REQUESTED
      const customer = await prisma.customer.findUnique({
        where: { tenantId_externalId: { tenantId, externalId: customerId } }
      });
      const conv = await prisma.conversation.findFirst({
        where: { tenantId, customerId: customer!.id }
      });
      expect(conv?.status).toBe('HANDOFF_REQUESTED');

      // 3. Human agent takes over (status = HUMAN_ACTIVE)
      await prisma.conversation.update({
        where: { id: conv!.id },
        data: { status: 'HUMAN_ACTIVE' }
      });

      // Customer message while human is active -> bot remains silent
      const silentReply = await deps.conversationEngine.handleMessage(
        tenantId,
        customerId,
        'الو واش كاين شي حد؟',
        accountId
      );
      expect(silentReply).toBe('');

      // 4. Human agent resolves handoff -> status back to ACTIVE
      await prisma.conversation.update({
        where: { id: conv!.id },
        data: { status: 'ACTIVE' }
      });

      // 5. Customer resumes with conversational question -> bot answers with context
      const resumeReply = await deps.conversationEngine.handleMessage(
        tenantId,
        customerId,
        'شحال كان ثمن الهودي؟',
        accountId
      );
      expect(resumeReply).toMatch(/(?:Moon Ninja|399)/i);
    });
  });

  describe('4. Multilingual & Script Consistency (Scenarios 18–22)', () => {
    it('Scenario 18: Arabic script conversation', async () => {
      const p = EcommerceIntentParser.parse('كم سعر جاكيت Cyber Spirit؟', null, 'ar');
      expect(p.intent).toBe('PRICE');
      expect(p.productName).toContain('Cyber Spirit');
    });

    it('Scenario 19: Darija Arabic script conversation', async () => {
      const p = EcommerceIntentParser.parse('واش كاين هاد الهودي فالكحل؟', null, 'darija');
      expect(p.intent).toBe('AVAILABILITY');
      expect(p.color).toBe('Black');
    });

    it('Scenario 20: Darija Arabizi conversation', async () => {
      const p = EcommerceIntentParser.parse('ch7al taman dyal l hoodie?', null, 'darija');
      expect(p.intent).toBe('PRICE');
    });

    it('Scenario 21: English conversation', async () => {
      const p = EcommerceIntentParser.parse('Do you have Cyber Spirit Jacket in size L?', null, 'en');
      expect(p.intent).toBe('AVAILABILITY');
      expect(p.size).toBe('L');
    });

    it('Scenario 22: French conversation', async () => {
      const p = EcommerceIntentParser.parse('Avez-vous la veste Cyber Spirit en noir taille L ?', null, 'fr');
      expect(p.intent).toBe('AVAILABILITY');
      expect(p.color).toBe('Black');
      expect(p.size).toBe('L');
    });
  });

  describe('5. Complex Multi-Domain & Context Isolation (Scenarios 23–24)', () => {
    it('Scenario 23: Complex multi-domain inquiry parsed cleanly without crash', async () => {
      const customerId = `stress-multi-${Date.now()}`;
      const res = await deps.conversationEngine.handleMessage(
        tenantId,
        customerId,
        'بغيت Moon Ninja Hoodie فالأسود M، إلى ماعجبنيش بغيت نعرف واش نقدر نرجعو، وشحال التوصيل لكازا، وكيفاش نغسلو؟',
        accountId
      );
      expect(res).not.toContain('mafhemtch hadchi');
      expect(res.length).toBeGreaterThan(20);
    });

    it('Scenario 24: Context isolation between two concurrent customers', async () => {
      const custA = `stress-iso-A-${Date.now()}`;
      const custB = `stress-iso-B-${Date.now()}`;

      // Customer A looks at Cyber Spirit Jacket (599 MAD)
      await deps.conversationEngine.handleMessage(tenantId, custA, 'daba 3tini details 3la Cyber Spirit Jacket', accountId);

      // Customer B looks at Neon Ronin T-Shirt (249 MAD)
      await deps.conversationEngine.handleMessage(tenantId, custB, 'daba 3tini details 3la Neon Ronin T-Shirt', accountId);

      // Check prices independently
      const resA = await deps.conversationEngine.handleMessage(tenantId, custA, 'ch7al taman dyalo?', accountId);
      const resB = await deps.conversationEngine.handleMessage(tenantId, custB, 'ch7al taman dyalo?', accountId);

      expect(resA).toContain('599');
      expect(resB).toContain('249');
    });
  });
});
