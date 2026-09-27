import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

describe('administrator Arabic interface', () => {
  it('translates controls without changing submitted status values or customer text', () => {
    const dom = new JSDOM(`
      <main class="admin-shell">
        <h1>Client accounts</h1>
        <p>Status: NEEDS_CHANGES. Changes are recorded in the activity history.</p>
        <label for="status">Status</label>
        <select id="status"><option value="NEEDS_CHANGES">NEEDS_CHANGES</option><option value="ACTIVE">ACTIVE</option></select>
        <select id="legacy-status"><option>APPROVED</option></select>
        <button>Save controls</button>
        <p>Conditional transitions (2)</p>
        <label>Transition 1 intent</label>
        <p>Service Assistant · suggested 449 MAD</p>
        <p>Chatbot information is frozen for this client. WhatsApp replies and inbox work continue.</p>
        <span>Provider ready · Client switch: On</span>
        <div class="admin-convo-message"><p>Active</p></div>
      </main>`, { url: 'https://app.relayqo.online/admin/client/example', runScripts: 'outside-only' });
    dom.window.eval(readFileSync('src/portal/ui/i18n.js', 'utf8'));
    const i18n = (dom.window as any).RelayqoI18n;
    i18n.setLocale('ar');
    const document = dom.window.document;
    expect(document.documentElement.dir).toBe('rtl');
    expect(document.querySelector('h1')?.textContent).toBe('حسابات العملاء');
    expect(document.querySelector('button')?.textContent).toBe('حفظ الإعدادات');
    expect(document.querySelector('select')?.value).toBe('NEEDS_CHANGES');
    expect(document.querySelector('option')?.textContent).toBe('يتطلب تعديلات');
    expect((document.querySelector('#legacy-status') as HTMLSelectElement).value).toBe('APPROVED');
    expect(document.body.textContent).toContain('الانتقالات المشروطة (2)');
    expect(document.body.textContent).toContain('مساعد الخدمات · سعر مقترح 449 درهم');
    expect(document.querySelector('.admin-convo-message p')?.textContent).toBe('Active');
    expect(document.body.textContent).toContain('خيار العميل: مفعّل');
    expect(document.body.textContent).toContain('بيانات الروبوت مقفلة لهذا العميل. تستمر ردود واتساب');
    expect(document.body.textContent).not.toContain('Changes are recorded');
    i18n.setLocale('fr');
    expect(document.querySelector('select')?.value).toBe('NEEDS_CHANGES');
    expect(document.querySelector('button')?.textContent).toBe('Enregistrer les paramètres');
    i18n.setLocale('en');
    expect(document.querySelector('select')?.value).toBe('NEEDS_CHANGES');
    expect(document.querySelector('button')?.textContent).toBe('Save controls');
    dom.window.close();
  });
});
