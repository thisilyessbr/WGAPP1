import { describe, expect, it } from 'vitest';
import { chromium } from 'playwright';
import express from 'express';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';

describe('business product catalog', () => {
  it('keeps products compact and edits photos and options without losing data', async () => {
    const app = express();
    const ui = resolve(dirname(fileURLToPath(import.meta.url)), '../../src/portal/ui');
    app.use('/portal-assets', express.static(ui, { dotfiles: 'allow' }));
    app.use((_request, response) => response.sendFile(resolve(ui, 'index.html'), { dotfiles: 'allow' }));
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>(done => server.once('listening', done));
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const profile: any = {
      status: 'DRAFT', revision: 1, editingFrozen: false, lockedFields: [],
      plan: { modules: ['commerce'] },
      draft: {
        name: 'Shoe shop', email: '', phone: '', website: '', description: '', address: '', hours: '', currency: 'MAD',
        policies: { shipping: '', returns: '', payment: '', privacy: '' }, services: [], faqs: [],
        products: [
          { sku: 'A', name: 'Leather shoes', price: 220, stock: 6, category: 'Shoes', description: '', imageIds: [], variants: [{ sku: 'A-40', size: '40', color: 'Black', stock: 2, price: null }] },
          { sku: 'B', name: 'Sandals', price: 140, stock: 8, category: 'Shoes', description: '', imageIds: [], variants: [] }
        ]
      }
    };
    let browser;
    try {
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      page.setDefaultTimeout(3000);
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/api/**', async route => {
        const path = new URL(route.request().url()).pathname;
        if (path === '/api/auth/session') return route.fulfill({ json: { user: { name: 'Shop owner', role: 'CLIENT' }, csrf: 'test' } });
        if (path === '/api/client/profile') return route.fulfill({ json: { profile } });
        if (path === '/api/client/business' && route.request().method() === 'PUT') {
          profile.draft = JSON.parse(route.request().postData() || '{}').data;
          profile.revision += 1;
          return route.fulfill({ json: { profile } });
        }
        if (path === '/api/client/product-images' && route.request().method() === 'POST') return route.fulfill({ json: { id: 'photo-1' } });
        if (path.includes('/product-images/')) return route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX9sAAAAASUVORK5CYII=', 'base64') });
        return route.fulfill({ status: 404, json: { message: path } });
      });
      await page.goto(origin + '/app/business');
      await page.getByRole('tab', { name: 'Products', exact: true }).click();
      await expect.poll(() => page.locator('.product-catalog-row').count()).toBe(2);
      expect(await page.locator('.product-edit-panel').count()).toBe(0);
      await page.locator('[data-edit-product="0"]').click();
      mkdirSync(resolve(ui, '../../../output/product-catalog'), { recursive: true });
      await page.screenshot({ path: resolve(ui, '../../../output/product-catalog/editor.png'), fullPage: true });
      expect(await page.getByLabel('Product name').inputValue()).toBe('Leather shoes');
      expect(await page.locator('.product-option').count()).toBe(1);
      expect(await page.locator('.product-option').first().getAttribute('open')).toBeNull();
      await page.locator('.product-option summary').click();
      await page.getByLabel('Size', { exact: true }).fill('41');
      await page.getByRole('button', { name: 'Add size or color' }).click();
      expect(await page.locator('.product-option').count()).toBe(2);
      expect(await page.locator('.product-option').last().getAttribute('open')).not.toBeNull();
      await page.locator('.product-photo-editor input[type=file]').setInputFiles({ name: 'shoe.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX9sAAAAASUVORK5CYII=', 'base64') });
      await expect.poll(() => page.locator('.product-photo-grid img').count()).toBe(1);
      await page.getByRole('button', { name: 'Save changes' }).click();
      await expect.poll(() => profile.draft.products[0].imageIds.length).toBe(1);
      expect(profile.draft.products[0].variants[0].size).toBe('41');
      await page.reload();
      await page.getByRole('tab', { name: 'Products', exact: true }).click();
      expect(await page.locator('.product-edit-panel').count()).toBe(0);
      await page.locator('[data-edit-product="0"]').click();
      expect(await page.locator('.product-option').count()).toBe(2);
      expect(await page.locator('.product-photo-grid img').count()).toBe(1);
      await page.locator('.language-select').selectOption('ar');
      expect(await page.locator('html').getAttribute('dir')).toBe('rtl');
      await page.getByRole('heading', { name: 'المعلومات الأساسية' }).waitFor();
      await page.setViewportSize({ width: 390, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      expect(errors).toEqual([]);
      await page.close();
    } finally {
      await browser?.close();
      await new Promise<void>(done => server.close(() => done()));
    }
  });
});
