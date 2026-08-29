import { describe, it, expect } from 'vitest';
import { EcommerceIntentParser } from '../../src/domain/ecommerce/EcommerceIntent';
import { TurnDecisionResolver } from '../../src/domain/conversation/TurnDecision';
import { AnswerComposer } from '../../src/domain/conversation/AnswerComposer';

describe('PHASE 51C: Media Follow-up & Video Intent Precedence Unit Tests', () => {
  const laptopProduct = {
    id: 'prod-rtx-01',
    tenantId: 'tenant-media',
    accountId: 'acc-media',
    name: 'Gaming Laptop RTX',
    sku: 'LAP-RTX-01',
    description: 'High-end RTX gaming laptop',
    price: 1500,
    currency: 'USD',
    stock: 5,
    category: 'Laptops',
    active: true,
    metadata: {
      images: [
        'https://cdn.example.com/laptop-1.webp',
        'https://cdn.example.com/laptop-2.webp',
        'https://cdn.example.com/laptop-3.webp'
      ],
      video: 'https://cdn.example.com/laptop-demo.mp4',
      thumbnail: 'https://cdn.example.com/laptop-poster.webp'
    },
    variants: []
  };

  const laptopFact = {
    product: laptopProduct,
    selectedVariant: null,
    effectivePrice: 1500,
    currency: 'USD',
    inStock: true,
    availableStock: 5,
    displayName: 'Gaming Laptop RTX',
    displayDescription: 'High-end RTX gaming laptop'
  };

  const productContextWithLaptop = {
    selectedProductId: 'prod-rtx-01',
    selectedSku: 'LAP-RTX-01',
    lastViewedProductIds: ['prod-rtx-01']
  };

  // A. "Show me the Gaming Laptop RTX" -> product selected
  it('A. "Show me the Gaming Laptop RTX" -> PRODUCT_SEARCH without implicit media', () => {
    const parsed = EcommerceIntentParser.parse('Show me the Gaming Laptop RTX');
    expect(parsed.intent).toBe('PRODUCT_SEARCH');
    expect(parsed.searchKeywords).toBe('Gaming Laptop RTX');

    const media = AnswerComposer.extractMedia({
      productFacts: [laptopFact],
      userMessage: 'Show me the Gaming Laptop RTX',
      intent: 'PRODUCT_SEARCH',
      requestedMediaType: parsed.requestedMediaType
    });
    expect(media.length).toBe(0);
  });

  // B. "Show me pictures of it" -> requestedMediaType = image, inherits product, up to 3 images
  it('B. "Show me pictures of it" -> requestedMediaType = image, productName = undefined, 3 images', () => {
    const parsed = EcommerceIntentParser.parse('Show me pictures of it', productContextWithLaptop);
    expect(parsed.intent).toBe('PRODUCT_DETAIL');
    expect(parsed.requestedMediaType).toBe('image');
    expect(parsed.productName).toBeUndefined();

    const decision = TurnDecisionResolver.resolve({
      text: 'Show me pictures of it',
      language: 'en',
      productContext: productContextWithLaptop,
      isEcommerceEnabled: true
    });
    expect(decision.intent).toBe('PRODUCT_DETAIL');
    expect(decision.productId).toBe('prod-rtx-01');
    expect(decision.requestedMediaType).toBe('image');

    const media = AnswerComposer.extractMedia({
      productFacts: laptopFact,
      userMessage: 'Show me pictures of it',
      intent: decision.intent,
      requestedMediaType: decision.requestedMediaType || undefined
    });
    expect(media.length).toBe(3);
    expect(media.every(m => m.type === 'image')).toBe(true);
  });

  // C. "Show me a video of it" -> requestedMediaType = video, same product, 1 video
  it('C. "Show me a video of it" -> requestedMediaType = video, productName = undefined, exactly 1 video', () => {
    const parsed = EcommerceIntentParser.parse('Show me a video of it', productContextWithLaptop);
    expect(parsed.intent).toBe('PRODUCT_DETAIL');
    expect(parsed.requestedMediaType).toBe('video');
    expect(parsed.productName).toBeUndefined();

    const decision = TurnDecisionResolver.resolve({
      text: 'Show me a video of it',
      language: 'en',
      productContext: productContextWithLaptop,
      isEcommerceEnabled: true
    });
    expect(decision.intent).toBe('PRODUCT_DETAIL');
    expect(decision.productId).toBe('prod-rtx-01');
    expect(decision.requestedMediaType).toBe('video');

    const media = AnswerComposer.extractMedia({
      productFacts: laptopFact,
      userMessage: 'Show me a video of it',
      intent: decision.intent,
      requestedMediaType: decision.requestedMediaType || undefined
    });
    expect(media.length).toBe(1);
    expect(media[0].type).toBe('video');
    expect(media[0].url).toBe('https://cdn.example.com/laptop-demo.mp4');
    expect(media[0].thumbnailUrl).toBe('https://cdn.example.com/laptop-poster.webp');
  });

  // D. "show me video of it" -> productName undefined, selectedProductId reused
  it('D. "show me video of it" -> productName undefined, exactly 1 video', () => {
    const parsed = EcommerceIntentParser.parse('show me video of it', productContextWithLaptop);
    expect(parsed.intent).toBe('PRODUCT_DETAIL');
    expect(parsed.requestedMediaType).toBe('video');
    expect(parsed.productName).toBeUndefined();

    const decision = TurnDecisionResolver.resolve({
      text: 'show me video of it',
      language: 'en',
      productContext: productContextWithLaptop,
      isEcommerceEnabled: true
    });
    expect(decision.intent).toBe('PRODUCT_DETAIL');
    expect(decision.productId).toBe('prod-rtx-01');
    expect(decision.requestedMediaType).toBe('video');
  });

  // E. "wrini video dial laptop" -> requestedMediaType = video, productName = laptop
  it('E. "wrini video dial laptop" -> requestedMediaType = video, productName = laptop', () => {
    const parsed = EcommerceIntentParser.parse('wrini video dial laptop');
    expect(parsed.intent).toBe('PRODUCT_DETAIL');
    expect(parsed.requestedMediaType).toBe('video');
    expect(parsed.productName).toBe('laptop');

    const decision = TurnDecisionResolver.resolve({
      text: 'wrini video dial laptop',
      language: 'darija',
      isEcommerceEnabled: true
    });
    expect(decision.intent).toBe('PRODUCT_DETAIL');
    expect(decision.requestedMediaType).toBe('video');
    expect(decision.productName).toBe('laptop');
  });

  // F. "wrini lvideo dial laptop" -> requestedMediaType = video, productName = laptop
  it('F. "wrini lvideo dial laptop" -> requestedMediaType = video, productName = laptop', () => {
    const parsed = EcommerceIntentParser.parse('wrini lvideo dial laptop');
    expect(parsed.intent).toBe('PRODUCT_DETAIL');
    expect(parsed.requestedMediaType).toBe('video');
    expect(parsed.productName).toBe('laptop');

    const decision = TurnDecisionResolver.resolve({
      text: 'wrini lvideo dial laptop',
      language: 'darija',
      isEcommerceEnabled: true
    });
    expect(decision.intent).toBe('PRODUCT_DETAIL');
    expect(decision.requestedMediaType).toBe('video');
  });

  // G. "wrini video dial it" -> selected product reused
  it('G. "wrini video dial it" -> selected product reused', () => {
    const parsed = EcommerceIntentParser.parse('wrini video dial it', productContextWithLaptop);
    expect(parsed.intent).toBe('PRODUCT_DETAIL');
    expect(parsed.requestedMediaType).toBe('video');
    expect(parsed.productName).toBeUndefined();

    const decision = TurnDecisionResolver.resolve({
      text: 'wrini video dial it',
      language: 'darija',
      productContext: productContextWithLaptop,
      isEcommerceEnabled: true
    });
    expect(decision.productId).toBe('prod-rtx-01');
    expect(decision.requestedMediaType).toBe('video');
  });

  // H. "وريني فيديو ديالو" -> selected product reused
  it('H. "وريني فيديو ديالو" -> selected product reused', () => {
    const parsed = EcommerceIntentParser.parse('وريني فيديو ديالو', productContextWithLaptop);
    expect(parsed.intent).toBe('PRODUCT_DETAIL');
    expect(parsed.requestedMediaType).toBe('video');
    expect(parsed.productName).toBeUndefined();

    const decision = TurnDecisionResolver.resolve({
      text: 'وريني فيديو ديالو',
      language: 'ar',
      productContext: productContextWithLaptop,
      isEcommerceEnabled: true
    });
    expect(decision.productId).toBe('prod-rtx-01');
    expect(decision.requestedMediaType).toBe('video');
  });

  // I. "montre-moi la vidéo de celui-ci" -> selected product reused
  it('I. "montre-moi la vidéo de celui-ci" -> selected product reused', () => {
    const parsed = EcommerceIntentParser.parse('montre-moi la vidéo de celui-ci', productContextWithLaptop);
    expect(parsed.intent).toBe('PRODUCT_DETAIL');
    expect(parsed.requestedMediaType).toBe('video');
    expect(parsed.productName).toBeUndefined();

    const decision = TurnDecisionResolver.resolve({
      text: 'montre-moi la vidéo de celui-ci',
      language: 'fr',
      productContext: productContextWithLaptop,
      isEcommerceEnabled: true
    });
    expect(decision.productId).toBe('prod-rtx-01');
    expect(decision.requestedMediaType).toBe('video');
  });

  // J. "how much is it?" -> existing PRICE behavior preserved
  it('J. "how much is it?" -> PRICE intent, product reused, media = []', () => {
    const parsed = EcommerceIntentParser.parse('how much is it?', productContextWithLaptop);
    expect(parsed.intent).toBe('PRICE');
    expect(parsed.productName).toBeUndefined();

    const decision = TurnDecisionResolver.resolve({
      text: 'how much is it?',
      language: 'en',
      productContext: productContextWithLaptop,
      isEcommerceEnabled: true
    });
    expect(decision.intent).toBe('PRICE');
    expect(decision.productId).toBe('prod-rtx-01');
    expect(decision.requestedMediaType).toBeNull();
  });

  // K. "is it in stock?" -> existing AVAILABILITY behavior preserved
  it('K. "is it in stock?" -> AVAILABILITY intent, product reused, media = []', () => {
    const parsed = EcommerceIntentParser.parse('is it in stock?', productContextWithLaptop);
    expect(parsed.intent).toBe('AVAILABILITY');
    expect(parsed.productName).toBeUndefined();

    const decision = TurnDecisionResolver.resolve({
      text: 'is it in stock?',
      language: 'en',
      productContext: productContextWithLaptop,
      isEcommerceEnabled: true
    });
    expect(decision.intent).toBe('AVAILABILITY');
    expect(decision.productId).toBe('prod-rtx-01');
    expect(decision.requestedMediaType).toBeNull();
  });

  // L. Multiple laptop products with no prior selected product -> productName = laptop, video preserved
  it('L. "show me a video of laptop" -> productName = laptop, requestedMediaType = video', () => {
    const parsed = EcommerceIntentParser.parse('show me a video of laptop');
    expect(parsed.intent).toBe('PRODUCT_DETAIL');
    expect(parsed.requestedMediaType).toBe('video');
    expect(parsed.productName).toBe('laptop');
  });

  // M. Normal: "show me laptops" -> PRODUCT_SEARCH, media = []
  it('M. "show me laptops" -> PRODUCT_SEARCH, media = []', () => {
    const parsed = EcommerceIntentParser.parse('show me laptops');
    expect(parsed.intent).toBe('PRODUCT_SEARCH');
    expect(parsed.requestedMediaType).toBeUndefined();

    const media = AnswerComposer.extractMedia({
      productFacts: [laptopFact],
      userMessage: 'show me laptops',
      intent: 'PRODUCT_SEARCH',
      requestedMediaType: parsed.requestedMediaType
    });
    expect(media.length).toBe(0);
  });

  // N. Normal: "tell me about the Gaming Laptop RTX" -> no implicit media
  it('N. "tell me about the Gaming Laptop RTX" -> PRODUCT_DETAIL without implicit media', () => {
    const parsed = EcommerceIntentParser.parse('tell me about the Gaming Laptop RTX');
    expect(parsed.intent).toBe('PRODUCT_DETAIL');
    expect(parsed.requestedMediaType).toBeUndefined();

    const media = AnswerComposer.extractMedia({
      productFacts: laptopFact,
      userMessage: 'tell me about the Gaming Laptop RTX',
      intent: 'PRODUCT_DETAIL',
      requestedMediaType: parsed.requestedMediaType
    });
    expect(media.length).toBe(0);
  });

  // O. Multilingual video requests matrix
  it('O. Multilingual video requests matrix', () => {
    const queries = [
      { text: 'show me a video of the laptop', lang: 'en', expectedName: 'laptop' },
      { text: 'show me a video of it', lang: 'en', expectedName: undefined },
      { text: 'wrini video dial laptop', lang: 'darija', expectedName: 'laptop' },
      { text: 'wrini lvideo dial laptop', lang: 'darija', expectedName: 'laptop' },
      { text: 'وريني فيديو ديال اللابتوب', lang: 'ar', expectedName: 'اللابتوب' },
      { text: 'وريني فيديو ديالو', lang: 'ar', expectedName: undefined },
      { text: 'montre-moi la vidéo du laptop', lang: 'fr', expectedName: 'laptop' },
      { text: 'montre-moi la vidéo de celui-ci', lang: 'fr', expectedName: undefined }
    ];

    for (const q of queries) {
      const parsed = EcommerceIntentParser.parse(q.text, productContextWithLaptop, q.lang as any);
      expect(parsed.intent).toBe('PRODUCT_DETAIL');
      expect(parsed.requestedMediaType).toBe('video');
      expect(parsed.productName).toBe(q.expectedName);
    }
  });
});
