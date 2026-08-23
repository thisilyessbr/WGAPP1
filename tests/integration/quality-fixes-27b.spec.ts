import { describe, it, expect } from 'vitest';
import { EcommerceService } from '../../src/domain/ecommerce/EcommerceService';
import { ProductRepository } from '../../src/domain/ecommerce/ProductRepository';
import { FaqMatcher } from '../../src/domain/faq/FaqMatcher';
import { TurnDecisionResolver } from '../../src/domain/conversation/TurnDecision';
import { RAGService } from '../../src/domain/rag/RAGService';

describe('Phase 27B: Targeted Quality Fixes', () => {

  describe('1. Compound Color Matching', () => {
    const mockProduct: any = {
      id: 'prod-jacket-1',
      tenantId: 'animeverse',
      accountId: 'animeverse-store',
      sku: 'ANV-J001',
      name: 'Cyber Spirit Jacket',
      price: '599.00',
      currency: 'MAD',
      stock: 12,
      active: true,
      category: 'Jackets',
      nameLocalized: { en: 'Cyber Spirit Jacket' },
      descriptionLocalized: { en: 'Futuristic jacket' },
      variants: [
        {
          id: 'var-1',
          productId: 'prod-jacket-1',
          sku: 'ANV-J001-BLK-L',
          color: 'Cyber Black',
          size: 'L',
          stock: 12,
          active: true,
          priceOverride: null
        }
      ]
    };

    const mockRepo: any = {
      findById: async () => mockProduct,
      findBySku: async () => mockProduct,
      findByName: async () => mockProduct,
      search: async (params: any) => {
        if (!params.color) return [mockProduct];
        const match = mockProduct.variants.some((v: any) =>
          v.color.toLowerCase().includes(params.color.toLowerCase())
        );
        return match ? [mockProduct] : [];
      }
    };

    const ecomService = new EcommerceService(mockRepo);

    it('matches "Cyber Black" variant when queried with canonical "Black"', async () => {
      const fact = await ecomService.getProductFact('animeverse', 'animeverse-store', {
        id: 'prod-jacket-1',
        color: 'Black'
      });

      expect(fact).not.toBeNull();
      expect(fact?.selectedVariant).not.toBeNull();
      expect(fact?.selectedVariant?.color).toBe('Cyber Black');
      expect(fact?.inStock).toBe(true);
      expect(fact?.availableStock).toBe(12);
    });

    it('matches "Cyber Black" variant in searchProducts with color: "Black"', async () => {
      const results = await ecomService.searchProducts('animeverse', 'animeverse-store', 'Jacket', 'en', {
        color: 'Black'
      });

      expect(results.length).toBe(1);
      expect(results[0].selectedVariant?.color).toBe('Cyber Black');
      expect(results[0].availableStock).toBe(12);
    });

    it('never matches unrelated colors (e.g. White or Red)', async () => {
      const factWhite = await ecomService.getProductFact('animeverse', 'animeverse-store', {
        id: 'prod-jacket-1',
        color: 'White'
      });
      expect(factWhite?.selectedVariant).toBeNull();
      expect(factWhite?.inStock).toBe(false);
      expect(factWhite?.availableStock).toBe(0);

      const factRed = await ecomService.getProductFact('animeverse', 'animeverse-store', {
        id: 'prod-jacket-1',
        color: 'Red'
      });
      expect(factRed?.selectedVariant).toBeNull();
      expect(factRed?.inStock).toBe(false);
    });
  });

  describe('2. AnimeVerse FAQ Matches in EN / FR / AR / Darija', () => {
    const sampleAnimeVerseFaqs: any[] = [
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
          en: ['shipping', 'delivery', 'delivery fee', 'shipping cost', 'shipping in morocco'],
          fr: ['livraison', 'frais de livraison', 'prix livraison', 'delai livraison', 'temps livraison', 'livraison au maroc'],
          ar: ['توصيل', 'شحن', 'مصاريف التوصيل', 'ثمن التوصيل', 'التوصيل في المغرب'],
          darija: ['livraison', 'twsil', 'chhal twsil', 'chhal livraison', 'twsil f lmghrib']
        }
      },
      {
        id: 'animeverse-returns',
        category: 'returns',
        questions: {
          en: 'What is your return policy?',
          fr: 'Quelle est votre politique de retour ?',
          ar: 'ما هي سياسة الإرجاع؟',
          darija: 'شنو هي سياسة الترجيع؟'
        },
        answers: {
          en: '14-day return/exchange policy.',
          fr: 'Politique de retour et échange de 14 jours.',
          ar: 'سياسة إرجاع واستبدال خلال 14 يومًا.',
          darija: 'كنوفرو إمكانية الترجيع والتبديل فـ14 يوم.'
        },
        keywords: {
          en: ['return', 'returns', 'exchange', 'return policy'],
          fr: ['retour', 'retours', 'echange', 'politique de retour'],
          ar: ['ارجاع', 'إرجاع', 'استبدال', 'ترجيع', 'سياسة الارجاع'],
          darija: ['rje3', 'nrje3', 'nbdel', 'trji3']
        }
      },
      {
        id: 'animeverse-cod',
        category: 'payment',
        questions: {
          en: 'Is Cash on Delivery available?',
          fr: 'Le paiement à la livraison est-il disponible ?',
          ar: 'هل الدفع عند الاستلام متوفر؟',
          darija: 'واش كاين الدفع عند الاستلام؟'
        },
        answers: {
          en: 'Cash on Delivery available across Morocco.',
          fr: 'Le paiement à la livraison est disponible partout au Maroc.',
          ar: 'الدفع عند الاستلام متوفر في جميع أنحاء المغرب.',
          darija: 'الدفع عند الاستلام متوفر فالمغرب كامل.'
        },
        keywords: {
          en: ['cash on delivery', 'cod'],
          fr: ['paiement livraison', 'especes'],
          ar: ['دفع عند الاستلام', 'الدفع عند الاستلام'],
          darija: ['khlas 3nd livraison', 'dafe3 3nd stislam']
        }
      },
      {
        id: 'animeverse-support',
        category: 'support',
        questions: {
          en: 'How to contact support?',
          fr: 'Comment contacter le support ?',
          ar: 'كيف اتواصل مع الدعم؟',
          darija: 'كيفاش نتواصل مع الدعم؟'
        },
        answers: {
          en: 'Contact us at support@animeverse.ma or +212 522 998877.',
          fr: 'Contactez-nous à support@animeverse.ma ou au +212 522 998877.',
          ar: 'تواصل معنا على support@animeverse.ma أو +212 522 998877.',
          darija: 'تواصل معانا فـ support@animeverse.ma ولا +212 522 998877.'
        },
        keywords: {
          en: ['support email', 'support phone', 'contact support'],
          fr: ['email support', 'telephone support', 'contacter support'],
          ar: ['تواصل مع الدعم', 'رقم الهاتف', 'ايميل الدعم'],
          darija: ['contact support', 'nemra d support', 'email support']
        }
      },
      {
        id: 'animeverse-hours',
        category: 'hours',
        questions: {
          en: 'What are your business hours?',
          fr: 'Quels sont vos horaires ?',
          ar: 'ما هي ساعات العمل؟',
          darija: 'شنو هما أوقات العمل؟'
        },
        answers: {
          en: 'Mon-Sat 10:00–20:00.',
          fr: 'Lun-Sam 10h00–20h00.',
          ar: 'من الاثنين إلى السبت 10:00–20:00.',
          darija: 'من الاثنين للسبت من 10:00 لـ 20:00.'
        },
        keywords: {
          en: ['business hours', 'opening hours'],
          fr: ['horaires', 'heures d ouverture'],
          ar: ['ساعات العمل', 'أوقات العمل'],
          darija: ['aw9at l3amal', 'sa3at lkhdma']
        }
      }
    ];

    it('matches Shipping FAQ across EN, FR, AR, Darija', () => {
      const enMatch = FaqMatcher.match('What is the shipping cost in Morocco?', sampleAnimeVerseFaqs, 'en');
      expect(enMatch?.entry.id).toBe('animeverse-shipping');
      expect(enMatch?.answer).toContain('30 MAD');

      const frMatch = FaqMatcher.match('Combien coûte la livraison au Maroc ?', sampleAnimeVerseFaqs, 'fr');
      expect(frMatch?.entry.id).toBe('animeverse-shipping');
      expect(frMatch?.answer).toContain('30 MAD');

      const arMatch = FaqMatcher.match('كم ثمن التوصيل في المغرب؟', sampleAnimeVerseFaqs, 'ar');
      expect(arMatch?.entry.id).toBe('animeverse-shipping');
      expect(arMatch?.answer).toContain('30');

      const darijaMatch = FaqMatcher.match('chhal twsil f lmghrib?', sampleAnimeVerseFaqs, 'darija');
      expect(darijaMatch?.entry.id).toBe('animeverse-shipping');
      expect(darijaMatch?.answer).toContain('30 MAD');
    });

    it('matches Returns FAQ across EN, FR, AR, Darija', () => {
      const enMatch = FaqMatcher.match('What is your return policy?', sampleAnimeVerseFaqs, 'en');
      expect(enMatch?.entry.id).toBe('animeverse-returns');
      expect(enMatch?.answer).toContain('14-day');

      const arMatch = FaqMatcher.match('ما هي سياسة الإرجاع والاستبدال؟', sampleAnimeVerseFaqs, 'ar');
      expect(arMatch?.entry.id).toBe('animeverse-returns');
      expect(arMatch?.answer).toContain('14');
    });

    it('matches COD FAQ in Arabic and Darija', () => {
      const arMatch = FaqMatcher.match('هل يوجد دفع عند الاستلام؟', sampleAnimeVerseFaqs, 'ar');
      expect(arMatch?.entry.id).toBe('animeverse-cod');

      const darijaMatch = FaqMatcher.match('wach kayn khlas 3nd livraison?', sampleAnimeVerseFaqs, 'darija');
      expect(darijaMatch?.entry.id).toBe('animeverse-cod');
    });
  });

  describe('3. Multi-Policy Retrieval Budget', () => {
    it('sets isMultiPolicy: false for single policy query', () => {
      const dec = TurnDecisionResolver.resolve({
        text: 'What is your return policy?',
        language: 'en'
      });
      expect(dec.domain).toBe('KNOWLEDGE');
      expect(dec.intent).toBe('RETURNS');
      expect(dec.isMultiPolicy).toBe(false);
    });

    it('sets isMultiPolicy: true when query contains multiple policy requests (returns + shipping)', () => {
      const dec = TurnDecisionResolver.resolve({
        text: 'Can I return this hoodie, and how much is shipping?',
        language: 'en'
      });
      expect(dec.domain).toBe('KNOWLEDGE');
      expect(dec.isMultiPolicy).toBe(true);
    });

    it('sets isMultiPolicy: true for Moroccan Darija multi-policy inquiry (return + care + shipping)', () => {
      const dec = TurnDecisionResolver.resolve({
        text: 'واش نقدر نرجع هاد الهودي، شحال التوصيل، وكيفاش نغسلو؟',
        language: 'darija'
      });
      expect(dec.domain).toBe('KNOWLEDGE');
      expect(dec.isMultiPolicy).toBe(true);
    });
  });

  describe('4. Sizing Normalization', () => {
    it('normalizes various centimeter units to standard "98 cm"', () => {
      expect(RAGService.normalizeSizingQuery('98 cm')).toBe('98 cm');
      expect(RAGService.normalizeSizingQuery('98cm')).toBe('98 cm');
      expect(RAGService.normalizeSizingQuery('98 centimeters')).toBe('98 cm');
      expect(RAGService.normalizeSizingQuery('98 سم')).toBe('98 cm');
      expect(RAGService.normalizeSizingQuery('3ndi 98 سم ف الصدر')).toBe('3ndi 98 cm ف الصدر');
      expect(RAGService.normalizeSizingQuery('tour de poitrine 104 centimètres')).toBe('tour de poitrine 104 cm');
    });
  });

  describe('5. Product Content Cleanup', () => {
    it('verifies Neon Ronin T-Shirt English description has no duplicate "cyberpunk" tokens', async () => {
      const fs = await import('fs');
      const seedContent = fs.readFileSync('scripts/seed-animeverse-client.ts', 'utf8');
      expect(seedContent).toContain('Cyberpunk inspired ronin graphic t-shirt');
      expect(seedContent).not.toContain('Cyberpunk inspired cyberpunk ronin');
    });
  });

});
