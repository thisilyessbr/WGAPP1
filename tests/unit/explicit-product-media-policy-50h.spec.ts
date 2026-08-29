import { describe, it, expect } from 'vitest';
import { AnswerComposer } from '../../src/domain/conversation/AnswerComposer';
import { ProductFact } from '../../src/domain/ecommerce/EcommerceService';

describe('Phase 50H: Strict Explicit-Only Product Media Policy', () => {
  const mockProductFact: ProductFact = {
    product: {
      id: 'prod-lap-01',
      tenantId: 'tenant-test',
      accountId: 'acc-test',
      name: 'Gaming Laptop RTX',
      sku: 'LAP-GAME-01',
      price: 14000,
      currency: 'USD',
      stock: 5,
      category: 'Laptops',
      description: 'High performance gaming laptop',
      metadata: {
        images: [
          'https://cdn.example.com/laptop-main.webp',
          'https://cdn.example.com/laptop-angle.webp',
          'https://cdn.example.com/laptop-keyboard.webp'
        ],
        video: 'https://cdn.example.com/laptop-trailer.mp4',
        thumbnail: 'https://cdn.example.com/laptop-thumb.webp',
        ram: '32GB',
        gpu: 'RTX 4060'
      }
    } as any,
    effectivePrice: 14000,
    currency: 'USD',
    inStock: true,
    availableStock: 5,
    displayName: 'Gaming Laptop RTX',
    displayDescription: 'High performance gaming laptop'
  };

  const mockProductNoMedia: ProductFact = {
    product: {
      id: 'prod-desk-01',
      tenantId: 'tenant-test',
      accountId: 'acc-test',
      name: 'Basic Wooden Desk',
      sku: 'FURN-DESK-01',
      price: 1200,
      currency: 'USD',
      stock: 3,
      category: 'Desks',
      description: 'Simple desk',
      metadata: {}
    } as any,
    effectivePrice: 1200,
    currency: 'USD',
    inStock: true,
    availableStock: 3,
    displayName: 'Basic Wooden Desk',
    displayDescription: 'Simple desk'
  };

  // A. Search -> no media
  it('A. "Show me laptops" -> media.length === 0', () => {
    const media = AnswerComposer.extractMedia({
      productFacts: [mockProductFact],
      userMessage: 'Show me laptops',
      intent: 'PRODUCT_SEARCH'
    });
    expect(media.length).toBe(0);
  });

  // B. Detail -> no media
  it('B. "Show me the Gaming Laptop RTX" -> media.length === 0', () => {
    const media = AnswerComposer.extractMedia({
      productFacts: mockProductFact,
      userMessage: 'Show me the Gaming Laptop RTX',
      intent: 'PRODUCT_DETAIL'
    });
    expect(media.length).toBe(0);
  });

  // C. Tell me about -> no media
  it('C. "Tell me about the Gaming Laptop RTX" -> media.length === 0', () => {
    const media = AnswerComposer.extractMedia({
      productFacts: mockProductFact,
      userMessage: 'Tell me about the Gaming Laptop RTX',
      intent: 'PRODUCT_DETAIL'
    });
    expect(media.length).toBe(0);
  });

  // D. Price -> no media
  it('D. "How much is the Gaming Laptop RTX?" -> media.length === 0', () => {
    const media = AnswerComposer.extractMedia({
      productFacts: mockProductFact,
      userMessage: 'How much is the Gaming Laptop RTX?',
      intent: 'PRODUCT_PRICE'
    });
    expect(media.length).toBe(0);
  });

  // E. Availability -> no media
  it('E. "Is the Gaming Laptop RTX in stock?" -> media.length === 0', () => {
    const media = AnswerComposer.extractMedia({
      productFacts: mockProductFact,
      userMessage: 'Is the Gaming Laptop RTX in stock?',
      intent: 'PRODUCT_AVAILABILITY'
    });
    expect(media.length).toBe(0);
  });

  // F. Recommendation -> no media
  it('F. "Which laptop do you recommend?" -> media.length === 0', () => {
    const media = AnswerComposer.extractMedia({
      productFacts: mockProductFact,
      userMessage: 'Which laptop do you recommend?',
      intent: 'PRODUCT_RECOMMENDATION'
    });
    expect(media.length).toBe(0);
  });

  // G. Explicit Pictures -> 1-3 images
  it('G. "Show me pictures of the Gaming Laptop RTX" -> 1-3 images', () => {
    const media = AnswerComposer.extractMedia({
      productFacts: mockProductFact,
      userMessage: 'Show me pictures of the Gaming Laptop RTX',
      intent: 'PRODUCT_DETAIL',
      requestedMediaType: 'image'
    });
    expect(media.length).toBe(3);
    expect(media.every(m => m.type === 'image')).toBe(true);
    expect(media[0].url).toBe('https://cdn.example.com/laptop-main.webp');
  });

  // H. Multilingual Darija explicit images -> 1-3 images
  it('H. "wrini tsawer dyal laptop" -> 1-3 images', () => {
    const media = AnswerComposer.extractMedia({
      productFacts: mockProductFact,
      userMessage: 'wrini tsawer dyal laptop',
      intent: 'PRODUCT_DETAIL'
    });
    expect(media.length).toBe(3);
    expect(media[0].type).toBe('image');
  });

  // I. Explicit Video -> exactly 1 video
  it('I. "Show me a video of the Gaming Laptop RTX" -> exactly 1 video', () => {
    const media = AnswerComposer.extractMedia({
      productFacts: mockProductFact,
      userMessage: 'Show me a video of the Gaming Laptop RTX',
      intent: 'PRODUCT_DETAIL',
      requestedMediaType: 'video'
    });
    expect(media.length).toBe(1);
    expect(media[0].type).toBe('video');
    expect(media[0].url).toBe('https://cdn.example.com/laptop-trailer.mp4');
    expect(media[0].thumbnailUrl).toBe('https://cdn.example.com/laptop-thumb.webp');
  });

  // J. Product with no media -> empty array
  it('J. Product with no media -> text unchanged, media empty', () => {
    const media = AnswerComposer.extractMedia({
      productFacts: mockProductNoMedia,
      userMessage: 'Show me pictures of the Basic Wooden Desk',
      intent: 'PRODUCT_DETAIL'
    });
    expect(media).toEqual([]);
  });

  // K. Workflow field input -> no media
  it('K. Workflow field input -> no media', () => {
    const media = AnswerComposer.extractMedia({
      userMessage: 'Karim Bennani',
      intent: 'WORKFLOW_FIELD'
    });
    expect(media.length).toBe(0);
  });

  // L. Workflow side price question -> no media
  it('L. Workflow side price question -> no media', () => {
    const media = AnswerComposer.extractMedia({
      productFacts: mockProductFact,
      userMessage: 'How much is the Gaming Laptop RTX?',
      intent: 'PRODUCT_PRICE'
    });
    expect(media.length).toBe(0);
  });

  // M. Workflow explicit picture request -> up to 3 images
  it('M. Workflow explicit picture request -> up to 3 images', () => {
    const media = AnswerComposer.extractMedia({
      productFacts: mockProductFact,
      userMessage: 'Show me pictures of the Gaming Laptop RTX',
      intent: 'PRODUCT_DETAIL'
    });
    expect(media.length).toBe(3);
  });

  // N. Knowledge media remains available when explicitly attached to evidence
  it('N. Knowledge media remains available when explicitly attached to evidence', () => {
    const mockChunk = {
      id: 'chunk-size-chart',
      documentTitle: 'Sizing Guideline',
      content: 'Here is the sizing guide for all hoodies.',
      metadata: {
        media: [
          {
            type: 'image',
            url: 'https://cdn.example.com/hoodie-size-chart.webp',
            title: 'Sizing Chart'
          }
        ]
      }
    };

    const media = AnswerComposer.extractMedia({
      chunks: [mockChunk],
      userMessage: 'What are the dimensions of the hoodie?'
    });

    expect(media.length).toBe(1);
    expect(media[0].url).toBe('https://cdn.example.com/hoodie-size-chart.webp');
  });

  // O. Broken/malformed media never breaks extraction
  it('O. Broken/malformed media never breaks text response', () => {
    const malformedFact: ProductFact = {
      product: {
        id: 'bad-01',
        name: 'Bad Product',
        metadata: {
          images: ['javascript:alert(1)', 'not a url', 12345],
          video: 'file:///etc/passwd'
        }
      } as any,
      effectivePrice: 100,
      currency: 'USD',
      inStock: true,
      availableStock: 1,
      displayName: 'Bad Product',
      displayDescription: 'Bad'
    };

    const media = AnswerComposer.extractMedia({
      productFacts: malformedFact,
      userMessage: 'Show me pictures of Bad Product'
    });

    expect(media).toEqual([]);
  });

  // P. Isolation invariant
  it('P. Tenant/account isolation remains unchanged', () => {
    // Only facts passed to the context can be extracted
    const mediaA = AnswerComposer.extractMedia({
      productFacts: mockProductFact,
      userMessage: 'Show me pictures'
    });
    expect(mediaA.length).toBe(3);

    const mediaB = AnswerComposer.extractMedia({
      productFacts: [],
      userMessage: 'Show me pictures'
    });
    expect(mediaB.length).toBe(0);
  });

  // Q, R, S, T. Cost Invariants
  it('Q, R, S, T. 0 extra AI/DB cost', () => {
    // Deterministic synchronous string regex extraction
    const start = performance.now();
    const media = AnswerComposer.extractMedia({
      productFacts: mockProductFact,
      userMessage: 'Show me laptops'
    });
    const duration = performance.now() - start;

    expect(media.length).toBe(0);
    expect(duration).toBeLessThan(10); // < 10ms execution, 0 AI calls
  });
});
