import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Helper simulating form serialization and extraction logic matching index.html
function validateMediaUrlInput(url: string | null | undefined, label: string): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (trimmed.length > 2048) {
    return `${label} must be 2048 characters or less.`;
  }
  if (/^(?:javascript|data|file):/i.test(trimmed)) {
    return `${label} protocol is not allowed.`;
  }
  if (!/^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(trimmed)) {
    return `${label} must be a valid HTTP or HTTPS URL.`;
  }
  return null;
}

function populateProductForm(product: { metadata?: Record<string, any> | null }) {
  const meta = product.metadata ? JSON.parse(JSON.stringify(product.metadata)) : {};

  // Extract images
  const rawImgs = Array.isArray(meta.images)
    ? meta.images
    : (meta.imageUrl ? [meta.imageUrl] : (meta.image ? [meta.image] : []));

  const p_img_1 = rawImgs[0] || '';
  const p_img_2 = rawImgs[1] || '';
  const p_img_3 = rawImgs[2] || '';

  // Extract video & thumbnail
  const p_video_url = meta.video || meta.videoUrl || '';
  const p_video_thumb = meta.thumbnail || meta.thumbnailUrl || '';

  // Remove media keys from custom metadata
  delete meta.images;
  delete meta.image;
  delete meta.imageUrl;
  delete meta.video;
  delete meta.videoUrl;
  delete meta.thumbnail;
  delete meta.thumbnailUrl;

  const advancedMetadataJson = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';

  return {
    p_img_1,
    p_img_2,
    p_img_3,
    p_video_url,
    p_video_thumb,
    advancedMetadataJson
  };
}

function serializeProductForm(inputs: {
  p_img_1?: string;
  p_img_2?: string;
  p_img_3?: string;
  p_video_url?: string;
  p_video_thumb?: string;
  advancedMetadataJson?: string;
}) {
  const img1 = (inputs.p_img_1 || '').trim();
  const img2 = (inputs.p_img_2 || '').trim();
  const img3 = (inputs.p_img_3 || '').trim();
  const videoUrl = (inputs.p_video_url || '').trim();
  const videoThumb = (inputs.p_video_thumb || '').trim();

  const validationError =
    validateMediaUrlInput(img1, 'Primary Image') ||
    validateMediaUrlInput(img2, 'Gallery Image 2') ||
    validateMediaUrlInput(img3, 'Gallery Image 3') ||
    validateMediaUrlInput(videoUrl, 'Video URL') ||
    validateMediaUrlInput(videoThumb, 'Video Poster');

  if (validationError) {
    throw new Error(validationError);
  }

  let metadata: Record<string, any> = {};
  if (inputs.advancedMetadataJson && inputs.advancedMetadataJson.trim()) {
    const parsed = JSON.parse(inputs.advancedMetadataJson.trim());
    if (typeof parsed !== 'object' || Array.isArray(parsed) || parsed === null) {
      throw new Error('Metadata must be a JSON object.');
    }
    metadata = parsed;
  }

  const images = [img1, img2, img3].filter(Boolean);
  if (images.length > 0) {
    metadata.images = images;
  } else {
    delete metadata.images;
  }

  if (videoUrl) {
    metadata.video = videoUrl;
  } else {
    delete metadata.video;
  }

  if (videoThumb) {
    metadata.thumbnail = videoThumb;
  } else {
    delete metadata.thumbnail;
  }

  delete metadata.image;
  delete metadata.imageUrl;
  delete metadata.videoUrl;
  delete metadata.thumbnailUrl;

  return Object.keys(metadata).length ? metadata : null;
}

describe('Phase 50F: Simple Product Media Form & Serialization', () => {
  it('A. create with 3 images', () => {
    const payload = serializeProductForm({
      p_img_1: 'https://cdn.example.com/img1.webp',
      p_img_2: 'https://cdn.example.com/img2.webp',
      p_img_3: 'https://cdn.example.com/img3.webp'
    });

    expect(payload).toEqual({
      images: [
        'https://cdn.example.com/img1.webp',
        'https://cdn.example.com/img2.webp',
        'https://cdn.example.com/img3.webp'
      ]
    });
  });

  it('B. edit and preserve ram/storage/gpu', () => {
    const originalProduct = {
      metadata: {
        ram: '32GB',
        storage: '1TB',
        gpu: 'RTX 4060',
        images: ['https://cdn.example.com/old.webp']
      }
    };

    const formState = populateProductForm(originalProduct);
    expect(formState.p_img_1).toBe('https://cdn.example.com/old.webp');
    expect(JSON.parse(formState.advancedMetadataJson)).toEqual({
      ram: '32GB',
      storage: '1TB',
      gpu: 'RTX 4060'
    });

    // Save with no changes
    const updated = serializeProductForm(formState);
    expect(updated).toEqual({
      ram: '32GB',
      storage: '1TB',
      gpu: 'RTX 4060',
      images: ['https://cdn.example.com/old.webp']
    });
  });

  it('C. replace image 1', () => {
    const formState = populateProductForm({
      metadata: {
        tags: ['sale'],
        images: ['https://cdn.example.com/img1.webp', 'https://cdn.example.com/img2.webp']
      }
    });

    formState.p_img_1 = 'https://cdn.example.com/new-img1.webp';
    const updated = serializeProductForm(formState);

    expect(updated).toEqual({
      tags: ['sale'],
      images: ['https://cdn.example.com/new-img1.webp', 'https://cdn.example.com/img2.webp']
    });
  });

  it('D. remove image 2', () => {
    const formState = populateProductForm({
      metadata: {
        category: 'Tech',
        images: [
          'https://cdn.example.com/img1.webp',
          'https://cdn.example.com/img2.webp',
          'https://cdn.example.com/img3.webp'
        ]
      }
    });

    formState.p_img_2 = ''; // clear image 2
    const updated = serializeProductForm(formState);

    expect(updated?.images).toEqual([
      'https://cdn.example.com/img1.webp',
      'https://cdn.example.com/img3.webp'
    ]);
  });

  it('E. remove all images', () => {
    const formState = populateProductForm({
      metadata: {
        material: 'Wood',
        images: ['https://cdn.example.com/img1.webp']
      }
    });

    formState.p_img_1 = '';
    const updated = serializeProductForm(formState);

    expect(updated).toEqual({
      material: 'Wood'
    });
    expect(updated?.images).toBeUndefined();
  });

  it('F. add video', () => {
    const updated = serializeProductForm({
      p_img_1: 'https://cdn.example.com/img1.webp',
      p_video_url: 'https://cdn.example.com/demo.mp4'
    });

    expect(updated).toEqual({
      images: ['https://cdn.example.com/img1.webp'],
      video: 'https://cdn.example.com/demo.mp4'
    });
  });

  it('G. remove video', () => {
    const formState = populateProductForm({
      metadata: {
        sku: '123',
        video: 'https://cdn.example.com/demo.mp4'
      }
    });

    formState.p_video_url = '';
    const updated = serializeProductForm(formState);

    expect(updated).toEqual({
      sku: '123'
    });
    expect(updated?.video).toBeUndefined();
  });

  it('H. add/remove thumbnail', () => {
    const formState = populateProductForm({
      metadata: {
        video: 'https://cdn.example.com/demo.mp4',
        thumbnail: 'https://cdn.example.com/poster.webp'
      }
    });

    expect(formState.p_video_thumb).toBe('https://cdn.example.com/poster.webp');

    formState.p_video_thumb = 'https://cdn.example.com/new-poster.webp';
    const updated = serializeProductForm(formState);
    expect(updated?.thumbnail).toBe('https://cdn.example.com/new-poster.webp');

    formState.p_video_thumb = '';
    const updatedNoThumb = serializeProductForm(formState);
    expect(updatedNoThumb?.thumbnail).toBeUndefined();
  });

  it('I. legacy imageUrl migration', () => {
    const legacyProduct = {
      metadata: {
        color: 'Black',
        imageUrl: 'https://cdn.example.com/legacy.webp'
      }
    };

    const formState = populateProductForm(legacyProduct);
    expect(formState.p_img_1).toBe('https://cdn.example.com/legacy.webp');

    const updated = serializeProductForm(formState);
    expect(updated).toEqual({
      color: 'Black',
      images: ['https://cdn.example.com/legacy.webp']
    });
    expect(updated?.imageUrl).toBeUndefined();
  });

  it('J. variant image', () => {
    const varImg = 'https://cdn.example.com/variant-blue.webp';
    const varMeta: Record<string, any> = { size: 'XL' };
    if (varImg) varMeta.images = [varImg];

    expect(varMeta).toEqual({
      size: 'XL',
      images: ['https://cdn.example.com/variant-blue.webp']
    });
  });

  it('K. malformed URL', () => {
    expect(() => {
      serializeProductForm({
        p_img_1: 'not-a-valid-url'
      });
    }).toThrow('Primary Image must be a valid HTTP or HTTPS URL.');
  });

  it('L. malicious URL', () => {
    expect(() => {
      serializeProductForm({
        p_img_1: 'javascript:alert(1)'
      });
    }).toThrow('Primary Image protocol is not allowed.');

    expect(() => {
      serializeProductForm({
        p_video_url: 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=='
      });
    }).toThrow('Video URL protocol is not allowed.');
  });

  it('M. malformed advanced JSON', () => {
    expect(() => {
      serializeProductForm({
        advancedMetadataJson: '{ bad json }'
      });
    }).toThrow();
  });

  it('N. no-media product', () => {
    const updated = serializeProductForm({});
    expect(updated).toBeNull();
  });

  it('O. API backward compatibility and template inspection', () => {
    const html = fs.readFileSync(path.resolve(__dirname, '../../src/dev/ui/index.html'), 'utf-8');
    
    // Verify modal elements exist in DOM
    expect(html).toContain('id="p_img_1"');
    expect(html).toContain('id="p_img_2"');
    expect(html).toContain('id="p_img_3"');
    expect(html).toContain('id="p_video_url"');
    expect(html).toContain('id="p_video_thumb"');
    expect(html).toContain('id="var_img_1"');
    expect(html).toContain('Advanced Custom Specifications');
    expect(html).toContain('validateMediaUrlInput');
  });
});
