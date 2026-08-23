import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, pool } from '../../src/tests/testDb';
import { bootstrapChatbot } from '../../src/bootstrap';
import { EcommerceIntentParser } from '../../src/domain/ecommerce/EcommerceIntent';
import { ProductContext } from '../../src/domain/conversation/ConversationContext';

describe('Phase 23: Conversational Arabic / Darija Ecommerce Context', () => {
  const tenantId = 'animeverse';
  const accountId = 'animeverse-store';
  let deps: ReturnType<typeof bootstrapChatbot>;

  beforeAll(async () => {
    const client = await pool.connect();
    try {
      await client.query('SET search_path TO test, public, extensions;');
    } finally {
      client.release();
    }
    deps = bootstrapChatbot(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('1. EcommerceIntentParser Unit Parsing', () => {
    const ctxWithProduct: ProductContext = {
      selectedProductId: 'prod-hoodie-1',
      lastViewedProductIds: ['prod-hoodie-1', 'prod-jacket-2']
    };

    it('parses discovery inquiries in Arabic script', () => {
      const p = EcommerceIntentParser.parse('بغيت شي هودي ديال الأنمي', null, 'darija');
      expect(p.intent).toBe('PRODUCT_SEARCH');
      expect(p.searchKeywords).toContain('هودي');
    });

    it('parses ordinal product detail request ("وريني تفاصيل الأول")', () => {
      const p = EcommerceIntentParser.parse('وريني تفاصيل الأول', ctxWithProduct, 'ar');
      expect(p.intent).toBe('PRODUCT_DETAIL');
      expect(p.ordinalIndex).toBe(0);
      expect(p.productName).toBeUndefined();
    });

    it('parses contextual product inquiry ("بغيت نعرف عليه كثر، شنو المادة ديالو وشنو المميزات ديالو؟")', () => {
      const p = EcommerceIntentParser.parse('بغيت نعرف عليه كثر، شنو المادة ديالو وشنو المميزات ديالو؟', ctxWithProduct, 'darija');
      expect(p.intent).toBe('PRODUCT_DETAIL');
      expect(p.productName).toBeUndefined();
    });

    it('parses contextual price follow-up with leading conjunction ("وشحال الثمن ديالو دابا؟")', () => {
      const p = EcommerceIntentParser.parse('وشحال الثمن ديالو دابا؟', ctxWithProduct, 'darija');
      expect(p.intent).toBe('PRICE');
      expect(p.productName).toBeUndefined();
    });

    it('parses preposition-prefixed color availability ("واش كاين فالأسود؟")', () => {
      const p = EcommerceIntentParser.parse('واش كاين فالأسود؟', ctxWithProduct, 'darija');
      expect(p.intent).toBe('AVAILABILITY');
      expect(p.color).toBe('Black');
      expect(p.productName).toBeUndefined();
    });

    it('parses size selection ("بغيت M")', () => {
      const p = EcommerceIntentParser.parse('بغيت M', ctxWithProduct, 'darija');
      expect(p.intent).toBe('VARIANT_SELECTION');
      expect(p.size).toBe('M');
    });

    it('parses Arabizi contextual conversation flow', () => {
      const p1 = EcommerceIntentParser.parse('bghit chi hoodie', null, 'darija');
      expect(p1.intent).toBe('PRODUCT_SEARCH');

      const p2 = EcommerceIntentParser.parse('3tini details dyal lwel', ctxWithProduct, 'darija');
      expect(p2.intent).toBe('PRODUCT_DETAIL');
      expect(p2.ordinalIndex).toBe(0);

      const p3 = EcommerceIntentParser.parse('bghit n3rf 3lih kter', ctxWithProduct, 'darija');
      expect(p3.intent).toBe('PRODUCT_DETAIL');

      const p4 = EcommerceIntentParser.parse('ch7al taman dyalo?', ctxWithProduct, 'darija');
      expect(p4.intent).toBe('PRICE');

      const p5 = EcommerceIntentParser.parse('wach kayn f lkeshel?', ctxWithProduct, 'darija');
      expect(p5.intent).toBe('AVAILABILITY');
      expect(p5.color).toBe('Black');

      const p6 = EcommerceIntentParser.parse('bghit taille M', ctxWithProduct, 'darija');
      expect(p6.intent).toBe('VARIANT_SELECTION');
      expect(p6.size).toBe('M');
    });

    it('correctly routes knowledge/policy questions away from ecommerce', () => {
      const pCare = EcommerceIntentParser.parse('كيفاش نغسلو؟', ctxWithProduct, 'darija');
      expect(pCare.intent).toBe('UNKNOWN');

      const pReturn = EcommerceIntentParser.parse('واش نقدر نرجعو؟', ctxWithProduct, 'darija');
      expect(pReturn.intent).toBe('UNKNOWN');

      const pShipping = EcommerceIntentParser.parse('شحال التوصيل؟', ctxWithProduct, 'darija');
      expect(pShipping.intent).toBe('UNKNOWN');
    });
  });

  describe('2. Multi-turn End-to-End Conversation Flow', () => {
    it('executes full 6-turn Darija ecommerce conversation smoothly without fallback', async () => {
      const customerId = `test-conv-p23-${Date.now()}`;

      // Turn 1: Product Search
      const reply1 = await deps.conversationEngine.handleMessage(
        tenantId,
        customerId,
        'السلام عليكم، بغيت شي هودي ديال الأنمي',
        accountId
      );
      expect(reply1).toMatch(/(?:ها هما المنتوجات|Moon Ninja|Cyber Spirit)/i);

      // Turn 2: Ordinal Product Detail
      const reply2 = await deps.conversationEngine.handleMessage(
        tenantId,
        customerId,
        'وريني تفاصيل الأول',
        accountId
      );
      expect(reply2).toMatch(/(?:السعر|الثمن|Prix|Price)/i);
      expect(reply2).toMatch(/599|399/);

      // Turn 3: Contextual Product Information Follow-up
      const reply3 = await deps.conversationEngine.handleMessage(
        tenantId,
        customerId,
        'بغيت نعرف عليه كثر، شنو المادة ديالو وشنو المميزات ديالو؟',
        accountId
      );
      expect(reply3).not.toContain('mafhemtch hadchi');
      expect(reply3).toMatch(/(?:الثمن|السعر|Price|Prix|MAD)/i);

      // Turn 4: Contextual Price Follow-up
      const reply4 = await deps.conversationEngine.handleMessage(
        tenantId,
        customerId,
        'وشحال الثمن ديالو دابا؟',
        accountId
      );
      expect(reply4).toMatch(/599|399/);
      expect(reply4).toMatch(/(?:الثمن|سعر|price|prix)/i);

      // Turn 5: Color Availability Follow-up
      const reply5 = await deps.conversationEngine.handleMessage(
        tenantId,
        customerId,
        'واش كاين فالأسود؟',
        accountId
      );
      expect(reply5).toMatch(/(?:كاين|متوفر|disponible|available|مخزون)/i);

      // Turn 6: Size Selection
      const reply6 = await deps.conversationEngine.handleMessage(
        tenantId,
        customerId,
        'بغيت M',
        accountId
      );
      expect(reply6).not.toContain('mafhemtch hadchi');
      expect(reply6).toMatch(/(?:كاين|متوفر|ما كاينش|غير متوفر|stock)/i);
    });

    it('clears previous variant context when an explicit new product is queried', async () => {
      const customerId = `test-reset-p23-${Date.now()}`;

      // Search and select product
      await deps.conversationEngine.handleMessage(
        tenantId,
        customerId,
        'وريني الهوديات',
        accountId
      );

      // Ask for black
      await deps.conversationEngine.handleMessage(
        tenantId,
        customerId,
        'واش كاين فالأسود؟',
        accountId
      );

      // Explicitly query a different product by name
      const replyNew = await deps.conversationEngine.handleMessage(
        tenantId,
        customerId,
        'شحال الثمن ديال Neon Ronin T-Shirt؟',
        accountId
      );
      expect(replyNew).toMatch(/(?:249|Neon Ronin)/i);
    });
  });
});
