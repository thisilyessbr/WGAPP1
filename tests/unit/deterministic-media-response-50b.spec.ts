import { describe, it, expect, beforeEach } from 'vitest';
import { AnswerComposer, ChatMedia } from '../../src/domain/conversation/AnswerComposer';
import { EcommerceIntentParser } from '../../src/domain/ecommerce/EcommerceIntent';
import { TurnDecision } from '../../src/domain/conversation/TurnDecision';
import { ProductFact } from '../../src/domain/ecommerce/ProductRepository';

describe('Phase 50B: Low-Cost Deterministic Media Response Unit Tests', () => {
  const mockProductFact: ProductFact = {
    product: {
      id: 'prod-laptop-001',
      tenantId: 'tenant-electronics',
      accountId: 'account-flagship',
      sku: 'LAP-001',
      name: 'Gaming Laptop RTX',
      nameLocalized: null,
      description: 'High performance gaming laptop',
      descriptionLocalized: null,
      price: 12000 as any,
      currency: 'USD',
      stock: 7,
      active: true,
      category: 'Laptops',
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: {
        images: [
          'https://cdn.example.com/laptop-main.webp',
          'https://cdn.example.com/laptop-angle.webp',
          'https://cdn.example.com/laptop-keyboard.webp',
          'https://cdn.example.com/laptop-extra.webp'
        ],
        video: 'https://cdn.example.com/laptop-trailer.mp4',
        thumbnail: 'https://cdn.example.com/laptop-thumb.webp'
      },
      variants: []
    } as any,
    effectivePrice: 12000,
    currency: 'USD',
    inStock: true,
    availableStock: 7,
    displayName: 'Gaming Laptop RTX',
    displayDescription: 'High performance gaming laptop'
  };

  const mockProductNoMedia: ProductFact = {
    product: {
      id: 'prod-plain-002',
      tenantId: 'tenant-electronics',
      accountId: 'account-flagship',
      sku: 'PLAIN-002',
      name: 'Basic USB Cable',
      nameLocalized: null,
      description: 'Standard cable',
      descriptionLocalized: null,
      price: 50 as any,
      currency: 'USD',
      stock: 20,
      active: true,
      category: 'Accessories',
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: null,
      variants: []
    } as any,
    effectivePrice: 50,
    currency: 'USD',
    inStock: true,
    availableStock: 20,
    displayName: 'Basic USB Cable',
    displayDescription: 'Standard cable'
  };

  it('1. Default Product Query without explicit image request returns empty media', () => {
    const media = AnswerComposer.extractMedia({
      productFacts: mockProductFact,
      userMessage: 'Show me the Gaming Laptop',
      intent: 'PRODUCT_DETAIL'
    });

    expect(media.length).toBe(0);
  });

  it('2. Explicit Image Request extracts up to 3 images', () => {
    const media = AnswerComposer.extractMedia({
      productFacts: mockProductFact,
      userMessage: 'Show me pictures of the Gaming Laptop',
      intent: 'PRODUCT_DETAIL',
      requestedMediaType: 'image'
    });

    expect(media.length).toBe(3);
    expect(media.every(m => m.type === 'image')).toBe(true);
    expect(media[0].url).toBe('https://cdn.example.com/laptop-main.webp');
    expect(media[1].url).toBe('https://cdn.example.com/laptop-angle.webp');
    expect(media[2].url).toBe('https://cdn.example.com/laptop-keyboard.webp');
  });

  it('3. Explicit Video Request extracts 1 video with poster thumbnail', () => {
    const media = AnswerComposer.extractMedia({
      productFacts: mockProductFact,
      userMessage: 'Show me a video of the Gaming Laptop',
      intent: 'PRODUCT_DETAIL',
      requestedMediaType: 'video'
    });

    expect(media.length).toBe(1);
    expect(media[0].type).toBe('video');
    expect(media[0].url).toBe('https://cdn.example.com/laptop-trailer.mp4');
    expect(media[0].thumbnailUrl).toBe('https://cdn.example.com/laptop-thumb.webp');
  });

  it('4. Product without media returns empty array without error', () => {
    const media = AnswerComposer.extractMedia({
      productFacts: mockProductNoMedia,
      userMessage: 'Show me pictures of the Basic USB Cable',
      intent: 'PRODUCT_DETAIL',
      requestedMediaType: 'image'
    });

    expect(media).toEqual([]);
  });

  it('5. Malformed URLs and dangerous schemes are strictly filtered out', () => {
    const dangerousProduct: ProductFact = {
      ...mockProductFact,
      product: {
        ...mockProductFact.product,
        metadata: {
          images: [
            'javascript:alert(1)',
            'data:text/html,<script>alert(1)</script>',
            'ftp://untrusted.server/evil.png',
            'https://cdn.example.com/safe-image.webp'
          ],
          video: 'file:///etc/passwd'
        }
      }
    };

    const media = AnswerComposer.extractMedia({
      productFacts: dangerousProduct,
      userMessage: 'Show pictures',
      requestedMediaType: 'image'
    });

    expect(media.length).toBe(1);
    expect(media[0].url).toBe('https://cdn.example.com/safe-image.webp');
  });

  it('6. Knowledge chunks with media metadata are extracted deterministically', () => {
    const mockChunks = [
      {
        id: 'chunk-1',
        documentId: 'doc-1',
        content: 'Our store size chart details.',
        score: 0.92,
        similarity: 0.92,
        documentTitle: 'Size Guide Chart',
        metadata: {
          media: [
            {
              type: 'image',
              url: 'https://cdn.example.com/size-chart.webp',
              title: 'Size Guide'
            }
          ]
        }
      }
    ];

    const media = AnswerComposer.extractMedia({
      chunks: mockChunks,
      userMessage: 'What is the size chart?'
    });

    expect(media.length).toBe(1);
    expect(media[0].type).toBe('image');
    expect(media[0].url).toBe('https://cdn.example.com/size-chart.webp');
    expect(media[0].title).toBe('Size Guide');
  });

  it('7. General search & recommendation responses hide numeric stock count', async () => {
    const decisionSearch: TurnDecision = {
      domain: 'ECOMMERCE',
      intent: 'PRODUCT_SEARCH',
      productName: 'Gaming Laptop RTX',
      confidence: 1.0,
      source: 'ECOMMERCE',
      action: 'ANSWER'
    };

    const searchResponse = await AnswerComposer.compose({
      turnDecision: decisionSearch,
      productFacts: [mockProductFact],
      responseLanguage: 'en',
      responseScript: 'latin'
    });

    // Should indicate In stock without the raw count in parentheses
    expect(searchResponse).toContain('Gaming Laptop RTX — 12000 USD (In stock)');
    expect(searchResponse).not.toContain('(7 available)');

    const decisionRec: TurnDecision = {
      domain: 'ECOMMERCE',
      intent: 'RECOMMENDATION',
      productName: 'Gaming Laptop RTX',
      confidence: 1.0,
      source: 'ECOMMERCE',
      action: 'ANSWER'
    };

    const recResponse = await AnswerComposer.compose({
      turnDecision: decisionRec,
      productFacts: [mockProductFact],
      responseLanguage: 'en',
      responseScript: 'latin'
    });

    expect(recResponse).toBe('We recommend Gaming Laptop RTX (12000 USD): In stock.');
  });

  it('8. Explicit availability queries render the exact numeric available stock', async () => {
    const decisionAvail: TurnDecision = {
      domain: 'ECOMMERCE',
      intent: 'AVAILABILITY',
      productName: 'Gaming Laptop RTX',
      confidence: 1.0,
      source: 'ECOMMERCE',
      action: 'ANSWER'
    };

    const availResponse = await AnswerComposer.compose({
      turnDecision: decisionAvail,
      productFacts: mockProductFact,
      responseLanguage: 'en',
      responseScript: 'latin'
    });

    expect(availResponse).toContain('Gaming Laptop RTX is available for 12000 USD. (In stock: 7)');
  });

  it('9. Multilingual media requests are recognized deterministically by EcommerceIntentParser', () => {
    const p1 = EcommerceIntentParser.parse('show me pictures of the laptop');
    expect(p1.intent).toBe('PRODUCT_DETAIL');
    expect(p1.requestedMediaType).toBe('image');

    const p2 = EcommerceIntentParser.parse('montre-moi les photos du pc');
    expect(p2.intent).toBe('PRODUCT_DETAIL');
    expect(p2.requestedMediaType).toBe('image');

    const p3 = EcommerceIntentParser.parse('wrini tsawer dyal l-laptop');
    expect(p3.intent).toBe('PRODUCT_DETAIL');
    expect(p3.requestedMediaType).toBe('image');

    const p4 = EcommerceIntentParser.parse('وريني صور الحاسوب');
    expect(p4.intent).toBe('PRODUCT_DETAIL');
    expect(p4.requestedMediaType).toBe('image');

    const p5 = EcommerceIntentParser.parse('show me a video of the desk');
    expect(p5.intent).toBe('PRODUCT_DETAIL');
    expect(p5.requestedMediaType).toBe('video');

    const p6 = EcommerceIntentParser.parse('wrini video dyal bureau');
    expect(p6.intent).toBe('PRODUCT_DETAIL');
    expect(p6.requestedMediaType).toBe('video');
  });

  it('10. Security: URL validation rejects excessive length and invalid protocols', () => {
    expect(AnswerComposer.isValidMediaUrl('https://valid.com/image.png')).toBe(true);
    expect(AnswerComposer.isValidMediaUrl('http://valid.com/image.png')).toBe(true);
    expect(AnswerComposer.isValidMediaUrl('javascript:alert(1)')).toBe(false);
    expect(AnswerComposer.isValidMediaUrl('file:///tmp/secret.txt')).toBe(false);
    expect(AnswerComposer.isValidMediaUrl('data:text/html;base64,PHNjcmlwdD4=')).toBe(false);
    expect(AnswerComposer.isValidMediaUrl('')).toBe(false);
    expect(AnswerComposer.isValidMediaUrl('https://' + 'a'.repeat(2500) + '.png')).toBe(false);
  });
});
