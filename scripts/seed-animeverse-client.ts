import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { DEFAULT_BUSINESS_CONFIG } from '../src/domain/tenant/BusinessConfig';

function getPrismaClient(connectionUrl: string | undefined, schema?: string): { prisma: PrismaClient; pool: Pool } | null {
  if (!connectionUrl) return null;
  let dbUrl = connectionUrl;
  if (dbUrl.startsWith('prisma+postgres://')) {
    const urlObj = new URL(dbUrl);
    const apiKey = urlObj.searchParams.get('api_key');
    if (apiKey) {
      const decoded = JSON.parse(Buffer.from(apiKey, 'base64').toString('utf8'));
      dbUrl = decoded.databaseUrl;
    }
  }

  if (dbUrl) {
    try {
      const parsed = new URL(dbUrl);
      parsed.searchParams.delete('connection_limit');
      parsed.searchParams.delete('connect_timeout');
      parsed.searchParams.delete('max_idle_connection_lifetime');
      parsed.searchParams.delete('pool_timeout');
      parsed.searchParams.delete('socket_timeout');
      dbUrl = parsed.toString();
    } catch (e) {}
  }

  const pool = new Pool({ connectionString: dbUrl, max: 5 });
  if (schema) {
    pool.on('connect', (client) => {
      client.query(`SET search_path TO ${schema}, public, extensions;`);
    });
  }
  const adapter = new PrismaPg(pool, schema ? { schema } : undefined);
  const prisma = new PrismaClient({ adapter });
  return { prisma, pool };
}

async function seedAnimeVerse(prisma: PrismaClient, label: string) {
  console.log(`\n--- Seeding dedicated AnimeVerse Client Tenant in [${label}] ---`);

  const tenantId = 'animeverse';
  const accountId = 'animeverse-store';

  // 1. Upsert Tenant
  const tenant = await prisma.tenant.upsert({
    where: { id: tenantId },
    update: { name: 'AnimeVerse' },
    create: { id: tenantId, name: 'AnimeVerse' }
  });

  // 2. Prepare Config
  const config = JSON.parse(JSON.stringify(DEFAULT_BUSINESS_CONFIG));
  config.identity = {
    botName: 'AnimeVerse Assistant',
    brand: 'AnimeVerse',
    companyName: 'AnimeVerse Morocco',
    industry: 'Anime Apparel & Collectibles',
    country: 'Morocco',
    currency: 'MAD',
    language: 'en',
    businessHours: 'Mon-Sat 10:00 - 20:00',
    locations: 'Casablanca, Morocco (Worldwide Shipping)',
    tone: 'friendly, enthusiastic, and knowledgeable anime style',
    support: {
      email: 'support@animeverse.ma',
      phone: '+212 522 998877',
      sales: 'sales@animeverse.ma',
      returns: 'returns@animeverse.ma'
    }
  };
  config.capabilities = {
    ...DEFAULT_BUSINESS_CONFIG.capabilities,
    ecommerceEnabled: true,
    imageEnabled: false,
    faq: [
      {
        id: 'animeverse-shipping',
        category: 'shipping',
        questions: {
          en: 'What are the shipping costs and delivery times?',
          fr: 'Quels sont les frais et délais de livraison ?',
          ar: 'ما هي تكلفة ومدة التوصيل؟',
          darija: 'شحال ثمن ومدة التوصيل؟'
        },
        answers: {
          en: 'Standard shipping across Morocco is 30 MAD, usually 24–48 hours.',
          fr: 'Livraison standard partout au Maroc : 30 MAD, généralement sous 24–48 h.',
          ar: 'التوصيل العادي في جميع أنحاء المغرب هو 30 درهمًا، عادة خلال 24–48 ساعة.',
          darija: 'التوصيل عادي فالمغرب كامل بـ30 MAD، وعادة كيوصل بين 24 و48 ساعة.'
        },
        keywords: {
          en: ['shipping', 'delivery', 'delivery fee', 'shipping cost', 'how long delivery', 'delivery time'],
          fr: ['livraison', 'frais de livraison', 'prix livraison', 'delai livraison', 'temps livraison'],
          ar: ['توصيل', 'شحن', 'مصاريف التوصيل', 'ثمن التوصيل', 'سعر التوصيل', 'مدة التوصيل', 'وقت التوصيل'],
          darija: ['livraison', 'twsil', 'chhal twsil', 'chhal livraison', 'w9tach twsel', 'fo9ach twsel']
        }
      },
      {
        id: 'animeverse-returns',
        category: 'returns',
        questions: {
          en: 'What is your return and exchange policy?',
          fr: 'Quelle est votre politique de retour et d\'échange ?',
          ar: 'ما هي سياسة الإرجاع والاستبدال؟',
          darija: 'شنو هي سياسة الترجيع والتبديل؟'
        },
        answers: {
          en: 'We offer a 14-day return/exchange policy for unworn items with tags attached.',
          fr: 'Nous proposons une politique de retour/échange de 14 jours pour les articles non portés avec étiquettes.',
          ar: 'نقدم سياسة إرجاع واستبدال خلال 14 يومًا للمنتجات غير الملبوسة مع البطاقات الأصلية.',
          darija: 'كنوفرو إمكانية الترجيع والتبديل فـ14 يوم للمنتوجات اللي ما ملبوساش ومع التيكيت ديالها.'
        },
        keywords: {
          en: ['return', 'returns', 'exchange', 'exchanges', 'refund', 'return policy'],
          fr: ['retour', 'retours', 'echange', 'echanges', 'remboursement', 'politique de retour'],
          ar: ['ارجاع', 'إرجاع', 'استبدال', 'تبديل', 'ترجيع', 'سياسة الارجاع', 'سياسة الاستبدال'],
          darija: ['rje3', 'nrje3', 'nbdel', 'tbdel', 'trji3', 'tabdil']
        }
      },
      {
        id: 'animeverse-cod',
        category: 'payment',
        questions: {
          en: 'Is Cash on Delivery (COD) available?',
          fr: 'Le paiement à la livraison est-il disponible ?',
          ar: 'هل الدفع عند الاستلام متوفر؟',
          darija: 'واش كاين الدفع عند الاستلام؟'
        },
        answers: {
          en: 'Cash on Delivery is available across Morocco.',
          fr: 'Le paiement à la livraison (COD) est disponible partout au Maroc.',
          ar: 'الدفع عند الاستلام متوفر في جميع أنحاء المغرب.',
          darija: 'الدفع عند الاستلام متوفر فالمغرب كامل.'
        },
        keywords: {
          en: ['cash on delivery', 'cod', 'pay on delivery', 'cash'],
          fr: ['paiement a la livraison', 'paiement livraison', 'especes', 'cod'],
          ar: ['دفع عند الاستلام', 'الدفع عند الاستلام', 'كاش', 'نقدا عند الاستلام'],
          darija: ['khlas 3nd livraison', 'dafe3 3nd stislam', 'khalas f lbab', 'cod']
        }
      },
      {
        id: 'animeverse-support',
        category: 'support',
        questions: {
          en: 'How can I contact customer support?',
          fr: 'Comment contacter le support client ?',
          ar: 'كيف يمكنني التواصل مع خدمة العملاء؟',
          darija: 'كيفاش نتواصل مع خدمة الزبناء؟'
        },
        answers: {
          en: 'You can reach our customer support at support@animeverse.ma or by phone at +212 522 998877.',
          fr: 'Vous pouvez joindre notre support à support@animeverse.ma ou par téléphone au +212 522 998877.',
          ar: 'يمكنك التواصل مع خدمة العملاء عبر البريد الإلكتروني support@animeverse.ma أو الهاتف على +212 522 998877.',
          darija: 'تقدر تواصل مع خدمة الزبناء فـ support@animeverse.ma ولا بالنمرة +212 522 998877.'
        },
        keywords: {
          en: ['contact support', 'customer support email', 'support phone', 'how to reach support'],
          fr: ['contacter le support', 'email support', 'telephone support', 'service client'],
          ar: ['تواصل مع الدعم', 'رقم الهاتف', 'ايميل الدعم', 'خدمة الزبناء', 'خدمة العملاء'],
          darija: ['contact support', 'nemra d support', 'email dyal support', 'khedmat zobana']
        }
      },
      {
        id: 'animeverse-hours',
        category: 'hours',
        questions: {
          en: 'What are your opening or business hours?',
          fr: 'Quels sont vos horaires d\'ouverture ?',
          ar: 'ما هي ساعات وأوقات العمل؟',
          darija: 'شنو هما أوقات وساعات العمل؟'
        },
        answers: {
          en: 'Our online store is open 24/7. Customer support is available Monday to Saturday from 10:00 to 20:00.',
          fr: 'Notre boutique en ligne est ouverte 24/7. Le service client est disponible du lundi au samedi de 10h00 à 20h00.',
          ar: 'متجرنا الإلكتروني مفتوح 24/7. خدمة العملاء متوفرة من الاثنين إلى السبت من 10:00 إلى 20:00.',
          darija: 'السيت ديالنا محلول 24/7. وخدمة الزبناء خدامة من الاثنين للسبت من 10:00 لـ 20:00.'
        },
        keywords: {
          en: ['business hours', 'opening hours', 'hours', 'when are you open', 'work hours'],
          fr: ['horaires', 'heures d ouverture', 'quand etes vous ouvert', 'horaires de travail'],
          ar: ['ساعات العمل', 'اوقات العمل', 'أوقات العمل', 'متى تفتحون', 'مواعيد العمل'],
          darija: ['aw9at l3amal', 'fo9ach kat7lo', 'wa9tach mafto7in', 'sa3at lkhdma']
        }
      }
    ]
  };
  config.knowledge = {
    ...DEFAULT_BUSINESS_CONFIG.knowledge,
    enabled: true
  };

  await prisma.tenantConfig.upsert({
    where: { tenantId },
    update: { config, updatedAt: new Date() },
    create: { tenantId, config, updatedAt: new Date() }
  });

  // 3. Upsert exactly ONE Account: animeverse-store
  const account = await prisma.account.upsert({
    where: { id: accountId },
    update: {
      tenantId,
      name: 'AnimeVerse Store',
      enabled: true,
      config: {
        identity: { language: 'en', botName: 'AnimeVerse Assistant' },
        capabilities: { ecommerceEnabled: true }
      }
    },
    create: {
      id: accountId,
      tenantId,
      name: 'AnimeVerse Store',
      enabled: true,
      config: {
        identity: { language: 'en', botName: 'AnimeVerse Assistant' },
        capabilities: { ecommerceEnabled: true }
      }
    }
  });

  console.log(`Verified Tenant: ID="${tenant.id}", Name="${tenant.name}"`);
  console.log(`Verified Single Account: ID="${account.id}", Name="${account.name}"`);

  // 4. Clean up existing AnimeVerse products before re-seeding
  await prisma.productVariant.deleteMany({
    where: { product: { tenantId, accountId } }
  });
  await prisma.product.deleteMany({
    where: { tenantId, accountId }
  });

  // 5. Seed AnimeVerse Products & Variants
  // Product 1: Moon Ninja Hoodie
  await prisma.product.create({
    data: {
      tenantId,
      accountId,
      sku: 'ANV-H001',
      name: 'Moon Ninja Hoodie',
      price: 399,
      currency: 'MAD',
      stock: 25,
      category: 'Hoodies',
      active: true,
      description: 'Premium heavyweight oversized anime ninja graphic hoodie crafted with 100% organic French terry cotton.',
      nameLocalized: {
        en: 'Moon Ninja Hoodie',
        fr: 'Sweat à Capuche Moon Ninja',
        ar: 'هودي نينجا القمر',
        darija: 'Capuchon Moon Ninja'
      },
      descriptionLocalized: {
        en: 'Premium heavyweight oversized anime ninja graphic hoodie crafted with 100% organic French terry cotton.',
        fr: 'Sweat à capuche surdimensionné anime ninja en coton bio haute densité.',
        ar: 'هودي أوفرسايز فاخر بطباعة نينجا أنمي من القطن الطبيعي عالي الجودة.',
        darija: 'Capuchon oversize d-l-cotton s7i7 o zwin bzaf dyal ninja anime.'
      },
      variants: {
        create: [
          { sku: 'ANV-H001-BLK-M', size: 'M', color: 'Black', stock: 10, active: true },
          { sku: 'ANV-H001-BLK-L', size: 'L', color: 'Black', stock: 10, active: true },
          { sku: 'ANV-H001-NVY-XL', size: 'XL', color: 'Navy Blue', stock: 5, active: true }
        ]
      }
    }
  });

  // Product 2: Neon Ronin T-Shirt
  await prisma.product.create({
    data: {
      tenantId,
      accountId,
      sku: 'ANV-T001',
      name: 'Neon Ronin T-Shirt',
      price: 249,
      currency: 'MAD',
      stock: 30,
      category: 'T-Shirts',
      active: true,
      description: 'Cyberpunk inspired ronin graphic t-shirt with glow-in-the-dark screen print details.',
      nameLocalized: {
        en: 'Neon Ronin T-Shirt',
        fr: 'T-Shirt Neon Ronin',
        ar: 'تيشيرت رونين نيون',
        darija: 'Tricot Neon Ronin'
      },
      descriptionLocalized: {
        en: 'Cyberpunk inspired ronin graphic t-shirt with glow-in-the-dark screen print details.',
        fr: 'T-shirt graphique cyberpunk ronin avec détails luminescents.',
        ar: 'تيشيرت بتصميم سايبربانك رونين مع طباعة مضيئة في الظلام.',
        darija: 'Tricot d-l-cotton cyberpunk ronin kaydwi f dlam.'
      },
      variants: {
        create: [
          { sku: 'ANV-T001-WHT-S', size: 'S', color: 'White', stock: 15, active: true },
          { sku: 'ANV-T001-BLK-M', size: 'M', color: 'Black', stock: 15, active: true }
        ]
      }
    }
  });

  // Product 3: Cyber Spirit Jacket
  await prisma.product.create({
    data: {
      tenantId,
      accountId,
      sku: 'ANV-J001',
      name: 'Cyber Spirit Jacket',
      price: 599,
      currency: 'MAD',
      stock: 12,
      category: 'Jackets',
      active: true,
      description: 'Futuristic water-resistant technical windbreaker bomber jacket featuring embroidered anime cyber motifs.',
      nameLocalized: {
        en: 'Cyber Spirit Jacket',
        fr: 'Veste Cyber Spirit',
        ar: 'جاكيت روح السايبر',
        darija: 'Veste Cyber Spirit'
      },
      descriptionLocalized: {
        en: 'Futuristic water-resistant technical windbreaker bomber jacket featuring embroidered anime cyber motifs.',
        fr: 'Veste coupe-vent technique et déperlante avec broderies anime futuristes.',
        ar: 'جاكيت مضاد للماء وعاصف للرياح بتطريزات سايبر أنمي مستقبلية.',
        darija: 'Veste coupe-vent madiyya d l-ma o rri7 b zwaqa d anime.'
      },
      variants: {
        create: [
          { sku: 'ANV-J001-BLK-L', size: 'L', color: 'Cyber Black', stock: 12, active: true }
        ]
      }
    }
  });

  console.log(`Seeded 3 real AnimeVerse products with variants.`);
}

async function main() {
  const live = getPrismaClient(process.env.DATABASE_URL);
  if (live) {
    try {
      await seedAnimeVerse(live.prisma, 'DEVELOPMENT DATABASE (DATABASE_URL)');
    } finally {
      await live.prisma.$disconnect();
      await live.pool.end();
    }
  }

  const test = getPrismaClient(process.env.TEST_DATABASE_URL, 'test');
  if (test) {
    try {
      await seedAnimeVerse(test.prisma, 'TEST DATABASE (schema: test)');
    } finally {
      await test.prisma.$disconnect();
      await test.pool.end();
    }
  }

  const testPublic = getPrismaClient(process.env.TEST_DATABASE_URL, 'public');
  if (testPublic) {
    try {
      await seedAnimeVerse(testPublic.prisma, 'TEST DATABASE (schema: public)');
    } finally {
      await testPublic.prisma.$disconnect();
      await testPublic.pool.end();
    }
  }
}

main().catch(console.error);
