import { describe, it, expect } from 'vitest';
import { AnswerComposer, ChatMedia } from '../../src/domain/conversation/AnswerComposer';
import { TurnDecision } from '../../src/domain/conversation/TurnDecision';
import { ProductFact } from '../../src/domain/ecommerce/ProductRepository';
import fs from 'fs';
import path from 'path';

describe('Phase 50D: Media UI Contract & UX Validation', () => {
  const mockProductWithImages: ProductFact = {
    product: {
      id: 'prod-hoodie-01',
      tenantId: 'tenant-test',
      accountId: 'acc-test',
      sku: 'HOODIE-01',
      name: 'Cyber Spirit Hoodie',
      nameLocalized: null,
      description: 'Futuristic oversized hoodie',
      descriptionLocalized: null,
      price: 350 as any,
      currency: 'MAD',
      stock: 15,
      active: true,
      category: 'Hoodies',
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: {
        images: [
          'https://cdn.example.com/hoodie-front.webp',
          'https://cdn.example.com/hoodie-back.webp',
          'https://cdn.example.com/hoodie-detail.webp',
          'https://cdn.example.com/hoodie-extra.webp'
        ]
      },
      variants: []
    } as any,
    effectivePrice: 350,
    currency: 'MAD',
    inStock: true,
    availableStock: 15,
    displayName: 'Cyber Spirit Hoodie',
    displayDescription: 'Futuristic oversized hoodie'
  };

  const mockProductWithVideo: ProductFact = {
    product: {
      id: 'prod-desk-01',
      tenantId: 'tenant-test',
      accountId: 'acc-test',
      sku: 'DESK-01',
      name: 'Executive Oak Desk',
      nameLocalized: null,
      description: 'Solid oak modern executive desk',
      descriptionLocalized: null,
      price: 2200 as any,
      currency: 'USD',
      stock: 3,
      active: true,
      category: 'Furniture',
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: {
        images: ['https://cdn.example.com/desk-main.webp'],
        video: 'https://cdn.example.com/desk-demo.mp4',
        thumbnail: 'https://cdn.example.com/desk-thumb.webp'
      },
      variants: []
    } as any,
    effectivePrice: 2200,
    currency: 'USD',
    inStock: true,
    availableStock: 3,
    displayName: 'Executive Oak Desk',
    displayDescription: 'Solid oak modern executive desk'
  };

  const mockProductNoMedia: ProductFact = {
    product: {
      id: 'prod-plain-01',
      tenantId: 'tenant-test',
      accountId: 'acc-test',
      sku: 'PLAIN-01',
      name: 'Standard Notebook',
      nameLocalized: null,
      description: 'A5 ruled notebook',
      descriptionLocalized: null,
      price: 25 as any,
      currency: 'MAD',
      stock: 40,
      active: true,
      category: 'Stationery',
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: null,
      variants: []
    } as any,
    effectivePrice: 25,
    currency: 'MAD',
    inStock: true,
    availableStock: 40,
    displayName: 'Standard Notebook',
    displayDescription: 'A5 ruled notebook'
  };

  // A. Ordinary Product Query (No Media)
  it('A. Ordinary product query returns no media unless explicit', () => {
    const media = AnswerComposer.extractMedia({
      productFacts: mockProductWithImages,
      userMessage: 'Show me the Cyber Spirit Hoodie',
      intent: 'PRODUCT_DETAIL'
    });

    expect(media.length).toBe(0);
  });

  // B. Three-Image Gallery
  it('B. Extract up to 3 images when user explicitly asks for pictures', () => {
    const media = AnswerComposer.extractMedia({
      productFacts: mockProductWithImages,
      userMessage: 'Show me pictures of the Cyber Spirit Hoodie',
      intent: 'PRODUCT_DETAIL',
      requestedMediaType: 'image'
    });

    expect(media.length).toBe(3);
    expect(media[0].url).toBe('https://cdn.example.com/hoodie-front.webp');
    expect(media[1].url).toBe('https://cdn.example.com/hoodie-back.webp');
    expect(media[2].url).toBe('https://cdn.example.com/hoodie-detail.webp');
  });

  // C. Video with Poster
  it('C. Extract video with thumbnail poster when video is requested', () => {
    const media = AnswerComposer.extractMedia({
      productFacts: mockProductWithVideo,
      userMessage: 'Show me a video of the Executive Oak Desk',
      intent: 'PRODUCT_DETAIL',
      requestedMediaType: 'video'
    });

    expect(media.length).toBe(1);
    expect(media[0]).toEqual({
      type: 'video',
      url: 'https://cdn.example.com/desk-demo.mp4',
      thumbnailUrl: 'https://cdn.example.com/desk-thumb.webp',
      title: 'Executive Oak Desk',
      alt: 'Executive Oak Desk Video'
    });
  });

  // D. Empty Media
  it('D. Returns empty array for products without media without throwing', () => {
    const media = AnswerComposer.extractMedia({
      productFacts: mockProductNoMedia,
      userMessage: 'Show me the Standard Notebook',
      intent: 'PRODUCT_DETAIL'
    });

    expect(media).toEqual([]);
  });

  // E. Broken Image Fallback (Validation)
  it('E. Rejects invalid protocols and formats gracefully', () => {
    expect(AnswerComposer.isValidMediaUrl('not-a-valid-url')).toBe(false);
    expect(AnswerComposer.isValidMediaUrl('http://')).toBe(false);
    expect(AnswerComposer.isValidMediaUrl(null)).toBe(false);
    expect(AnswerComposer.isValidMediaUrl(undefined)).toBe(false);
    expect(AnswerComposer.isValidMediaUrl(12345)).toBe(false);
  });

  // F. Malformed Media Ignored
  it('F. Filters out malformed items while keeping valid ones', () => {
    const malformedProduct: ProductFact = {
      ...mockProductWithImages,
      product: {
        ...mockProductWithImages.product,
        metadata: {
          images: [
            null,
            '',
            'https://cdn.example.com/valid-image.webp',
            123
          ]
        }
      }
    };

    const media = AnswerComposer.extractMedia({
      productFacts: malformedProduct,
      userMessage: 'Show pictures',
      requestedMediaType: 'image'
    });

    expect(media.length).toBe(1);
    expect(media[0].url).toBe('https://cdn.example.com/valid-image.webp');
  });

  // G. Dangerous URL Ignored
  it('G. Strictly rejects javascript, data:text/html, and file protocols', () => {
    expect(AnswerComposer.isValidMediaUrl('javascript:alert(1)')).toBe(false);
    expect(AnswerComposer.isValidMediaUrl('file:///etc/passwd')).toBe(false);
    expect(AnswerComposer.isValidMediaUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
  });

  // H. Text-Only Response Unchanged
  it('H. Generates clean text response regardless of media presence', async () => {
    const decision: TurnDecision = {
      domain: 'ECOMMERCE',
      intent: 'PRODUCT_DETAIL',
      productName: 'Standard Notebook',
      confidence: 1.0,
      source: 'ECOMMERCE',
      action: 'ANSWER'
    };

    const text = await AnswerComposer.compose({
      turnDecision: decision,
      productFacts: mockProductNoMedia,
      responseLanguage: 'en',
      responseScript: 'latin'
    });

    expect(text).toContain('Standard Notebook');
    expect(text).toContain('Price: 25 MAD');
    expect(text).toContain('Availability: In stock');
  });

  // I. Stock Count Hidden Normally
  it('I. Hides numeric stock count from normal recommendation and detail', async () => {
    const decisionRec: TurnDecision = {
      domain: 'ECOMMERCE',
      intent: 'RECOMMENDATION',
      productName: 'Cyber Spirit Hoodie',
      confidence: 1.0,
      source: 'ECOMMERCE',
      action: 'ANSWER'
    };

    const recText = await AnswerComposer.compose({
      turnDecision: decisionRec,
      productFacts: [mockProductWithImages],
      responseLanguage: 'en',
      responseScript: 'latin'
    });

    expect(recText).toBe('We recommend Cyber Spirit Hoodie (350 MAD): In stock.');
    expect(recText).not.toContain('15 available');
  });

  // J. Stock Shown on Explicit Availability Query
  it('J. Shows exact stock count only when user asks for availability', async () => {
    const decisionAvail: TurnDecision = {
      domain: 'ECOMMERCE',
      intent: 'AVAILABILITY',
      productName: 'Cyber Spirit Hoodie',
      confidence: 1.0,
      source: 'ECOMMERCE',
      action: 'ANSWER'
    };

    const availText = await AnswerComposer.compose({
      turnDecision: decisionAvail,
      productFacts: mockProductWithImages,
      responseLanguage: 'en',
      responseScript: 'latin'
    });

    expect(availText).toContain('Cyber Spirit Hoodie is available for 350 MAD. (In stock: 15)');
  });

  // K. UI Markup Validation (Static Forensics on src/dev/ui/index.html)
  it('K. Verifies src/dev/ui/index.html includes required gallery, modal, and DOM safety patterns', () => {
    const uiHtmlPath = path.resolve(__dirname, '../../src/dev/ui/index.html');
    const htmlContent = fs.readFileSync(uiHtmlPath, 'utf8');

    // Lightbox modal markup and elements
    expect(htmlContent).toContain('id="mediaLightbox"');
    expect(htmlContent).toContain('id="lightboxImg"');
    expect(htmlContent).toContain('id="lightboxCaption"');
    expect(htmlContent).toContain('lightbox-close-btn');

    // Gallery CSS classes
    expect(htmlContent).toContain('.chat-media-container');
    expect(htmlContent).toContain('.chat-media-single');
    expect(htmlContent).toContain('.chat-media-grid');
    expect(htmlContent).toContain('.chat-media-video');

    // DOM & performance attributes
    expect(htmlContent).toContain("loading = 'lazy'");
    expect(htmlContent).toContain("preload = 'metadata'");
    expect(htmlContent).toContain("controls = true");
    expect(htmlContent).toContain("openLightbox(");
    expect(htmlContent).toContain("closeLightbox(");
    expect(htmlContent).toContain("Escape");
  });
});
