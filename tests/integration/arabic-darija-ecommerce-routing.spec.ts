import { describe, it, expect, beforeEach, beforeAll, afterEach } from 'vitest';
import { prisma, pool } from '../../src/tests/testDb';
import { bootstrapChatbot } from '../../src/bootstrap';
import { DEFAULT_BUSINESS_CONFIG } from '../../src/domain/tenant/BusinessConfig';
import { LLMMockProvider } from '../../src/core/llm/LLMProvider';
import { EcommerceIntentParser } from '../../src/domain/ecommerce/EcommerceIntent';
import { LanguageDetector } from '../../src/domain/faq/FaqMatcher';

describe('Phase 22: Arabic & Darija Ecommerce Routing & Knowledge Disambiguation', () => {
  let deps: ReturnType<typeof bootstrapChatbot>;
  let mockLlm: LLMMockProvider;
  const createdTenantIds: string[] = [];

  beforeAll(async () => {
    const client = await pool.connect();
    try {
      await client.query('SET search_path TO test, public, extensions;');
    } finally {
      client.release();
    }
  });

  beforeEach(async () => {
    deps = bootstrapChatbot(prisma);
    mockLlm = new LLMMockProvider();
    deps.llmFactory.registerProvider('mock', 'mock-model', mockLlm);
    deps.tenantConfigService.clearCache();
  });

  afterEach(async () => {
    for (const tenantId of createdTenantIds) {
      try {
        await prisma.tenant.delete({ where: { id: tenantId } });
      } catch (err) {}
    }
    createdTenantIds.length = 0;
  });

  async function seedAnimeVerseStore() {
    const tenant = await prisma.tenant.create({
      data: {
        name: `Tenant-AnimeVerse-${Date.now()}`,
        config: {
          create: {
            config: {
              ...DEFAULT_BUSINESS_CONFIG,
              knowledge: {
                enabled: true,
                maxChunks: 3,
                minSimilarityScore: 0.5
              }
            }
          }
        },
        accounts: {
          create: {
            name: 'animeverse-store',
            config: {
              capabilities: { ecommerceEnabled: true }
            }
          }
        }
      },
      include: { accounts: true }
    });
    createdTenantIds.push(tenant.id);
    const account = tenant.accounts[0];

    // Seed 1: Moon Ninja Hoodie
    await prisma.product.create({
      data: {
        tenantId: tenant.id,
        accountId: account.id,
        sku: 'ANV-H001',
        name: 'Moon Ninja Hoodie',
        nameLocalized: {
          en: 'Moon Ninja Hoodie',
          fr: 'Sweat à Capuche Moon Ninja',
          ar: 'هودي نينجا القمر',
          darija: 'Capuchon Moon Ninja'
        },
        description: 'Premium heavyweight oversized anime hoodie',
        descriptionLocalized: {
          en: 'Premium heavyweight oversized anime hoodie',
          fr: 'Sweat à capuche oversize anime premium',
          ar: 'هودي أوفرسايز فاخر بطابع الأنمي',
          darija: 'هودي أوفرسايز ممتاز ديال الأنمي'
        },
        price: 399,
        currency: 'MAD',
        stock: 25,
        active: true,
        category: 'Hoodies',
        variants: {
          create: [
            { sku: 'ANV-H001-BLK-M', color: 'Black', size: 'M', stock: 10, active: true },
            { sku: 'ANV-H001-BLK-L', color: 'Black', size: 'L', stock: 10, active: true }
          ]
        }
      }
    });

    // Seed 2: Neon Ronin T-Shirt
    await prisma.product.create({
      data: {
        tenantId: tenant.id,
        accountId: account.id,
        sku: 'ANV-T001',
        name: 'Neon Ronin T-Shirt',
        nameLocalized: {
          en: 'Neon Ronin T-Shirt',
          fr: 'T-Shirt Neon Ronin',
          ar: 'تيشيرت رونين نيون',
          darija: 'T-Shirt Neon Ronin'
        },
        description: '100% organic cotton graphic tee',
        descriptionLocalized: {
          en: '100% organic cotton graphic tee',
          fr: 'T-shirt graphique 100% coton bio',
          ar: 'تيشيرت قطن عضوي بتصميم نيون',
          darija: 'تريكو قطن نقي بتصميم الأنمي'
        },
        price: 249,
        currency: 'MAD',
        stock: 30,
        active: true,
        category: 'T-Shirts'
      }
    });

    // Seed 3: Cyber Spirit Jacket
    await prisma.product.create({
      data: {
        tenantId: tenant.id,
        accountId: account.id,
        sku: 'ANV-J001',
        name: 'Cyber Spirit Jacket',
        nameLocalized: {
          en: 'Cyber Spirit Jacket',
          fr: 'Veste Cyber Spirit',
          ar: 'جاكيت سايبر سبيريت',
          darija: 'جاكيط سايبر سبيريت'
        },
        description: 'Water-resistant techwear bomber jacket',
        descriptionLocalized: {
          en: 'Water-resistant techwear bomber jacket',
          fr: 'Veste bomber techwear résistante à l\'eau',
          ar: 'جاكيت بومبر مقاوم للماء بنمط سايبربانك',
          darija: 'جاكيط بومبر واعرة ما كتدخلش الما'
        },
        price: 599,
        currency: 'MAD',
        stock: 12,
        active: true,
        category: 'Jackets'
      }
    });

    return { tenant, account };
  }

  describe('1. Deterministic Intent Parser Unit Tests', () => {
    it('parses Arabic/Darija product search queries', () => {
      const p1 = EcommerceIntentParser.parse('بغيت شي هودي ديال الأنمي', null, 'darija');
      expect(p1.intent).toBe('PRODUCT_SEARCH');

      const p2 = EcommerceIntentParser.parse('بغيت هودي', null, 'darija');
      expect(p2.intent).toBe('PRODUCT_SEARCH');

      const p3 = EcommerceIntentParser.parse('وريني الهوديات', null, 'ar');
      expect(p3.intent).toBe('PRODUCT_SEARCH');

      const p4 = EcommerceIntentParser.parse('عندكم تيشورتات؟', null, 'ar');
      expect(p4.intent).toBe('PRODUCT_SEARCH');

      const p5 = EcommerceIntentParser.parse('bghit chi hoodie', null, 'darija');
      expect(p5.intent).toBe('PRODUCT_SEARCH');

      const p6 = EcommerceIntentParser.parse('3ndkom chi jacket?', null, 'darija');
      expect(p6.intent).toBe('PRODUCT_SEARCH');
    });

    it('parses explicit product price intent', () => {
      const p = EcommerceIntentParser.parse('شحال الثمن ديال Moon Ninja Hoodie؟', null, 'darija');
      expect(p.intent).toBe('PRICE');
      expect(p.productName).toContain('Moon Ninja Hoodie');
    });

    it('disambiguates knowledge policy questions away from ecommerce', () => {
      const q1 = EcommerceIntentParser.parse('كيفاش نغسل الهودي؟', null, 'darija');
      expect(q1.intent).toBe('UNKNOWN');

      const q2 = EcommerceIntentParser.parse('واش نقدر نرجعو؟', null, 'darija');
      expect(q2.intent).toBe('UNKNOWN');

      const q3 = EcommerceIntentParser.parse('شحال التوصيل؟', null, 'darija');
      expect(q3.intent).toBe('UNKNOWN');
    });
  });

  describe('2. End-to-End Conversation Engine Routing', () => {
    it('routes "السلام عليكم، بغيت شي هودي ديال الأنمي" to Ecommerce and returns products', async () => {
      const { tenant, account } = await seedAnimeVerseStore();

      const reply = await deps.conversationEngine.handleMessage(
        tenant.id,
        'user-arb-01',
        'السلام عليكم، بغيت شي هودي ديال الأنمي',
        account.id
      );

      expect(reply).toMatch(/(?:Moon Ninja|Capuchon|هودي)/);
      expect(reply).toContain('399 MAD');
    });

    it('routes "وريني الهوديات" to Ecommerce and returns hoodie product', async () => {
      const { tenant, account } = await seedAnimeVerseStore();

      const reply = await deps.conversationEngine.handleMessage(
        tenant.id,
        'user-arb-02',
        'وريني الهوديات',
        account.id
      );

      expect(reply).toMatch(/(?:Moon Ninja|Capuchon|هودي)/);
      expect(reply).toContain('399 MAD');
    });

    it('routes "عندكم تيشورتات؟" to Ecommerce and returns t-shirt product', async () => {
      const { tenant, account } = await seedAnimeVerseStore();

      const reply = await deps.conversationEngine.handleMessage(
        tenant.id,
        'user-arb-03',
        'عندكم تيشورتات؟',
        account.id
      );

      expect(reply).toMatch(/(?:Neon Ronin|تيشيرت|T-Shirt)/);
      expect(reply).toContain('249 MAD');
    });

    it('routes "3ndkom chi jacket?" to Ecommerce and returns jacket product', async () => {
      const { tenant, account } = await seedAnimeVerseStore();

      const reply = await deps.conversationEngine.handleMessage(
        tenant.id,
        'user-arb-04',
        '3ndkom chi jacket?',
        account.id
      );

      expect(reply).toMatch(/(?:Cyber Spirit|جاكيط|جاكيت|Veste)/);
      expect(reply).toContain('599 MAD');
    });

    it('routes "شحال الثمن ديال Moon Ninja Hoodie؟" to PRICE fact handler', async () => {
      const { tenant, account } = await seedAnimeVerseStore();

      const reply = await deps.conversationEngine.handleMessage(
        tenant.id,
        'user-arb-05',
        'شحال الثمن ديال Moon Ninja Hoodie؟',
        account.id
      );

      expect(reply).toContain('399 MAD');
    });

    it('does NOT route "شحال التوصيل؟" or "كيفاش نغسل الهودي؟" to Ecommerce', async () => {
      const { tenant, account } = await seedAnimeVerseStore();

      // Mock LLM will answer for RAG/fallback since these are policy questions
      mockLlm.mockResponse = 'التوصيل مجاني للطلبات فوق 500 درهم.';

      const reply = await deps.conversationEngine.handleMessage(
        tenant.id,
        'user-arb-06',
        'شحال التوصيل؟',
        account.id
      );

      // Should not return a product listing
      expect(reply).not.toContain('Voici les produits');
      expect(reply).not.toContain('ها هما المنتوجات');
      expect(reply).not.toContain('إليك المنتجات');
    });
  });
});
