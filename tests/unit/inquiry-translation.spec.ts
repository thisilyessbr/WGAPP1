import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

describe('inquiry translations', () => {
  it('translates the detail and follow-up controls into Arabic', async () => {
    const dom = new JSDOM('<main><h1>Inquiry details</h1><p>Follow up with this customer and record the result.</p><a>All inquiries</a><span>Not recorded</span><label>Follow up at</label><button>Save inquiry</button><small>Last updated 26/09/2026</small></main>', { url: 'https://app.relayqo.online/app/leads/one', runScripts: 'outside-only' });
    dom.window.eval(readFileSync('src/portal/ui/i18n.js', 'utf8'));
    (dom.window as any).RelayqoI18n.setLocale('ar');
    expect(dom.window.document.body.textContent).toContain('تابع مع هذا العميل وسجّل النتيجة.');
    expect(dom.window.document.body.textContent).toContain('كل الاستفسارات');
    expect(dom.window.document.body.textContent).toContain('موعد المتابعة');
    expect(dom.window.document.body.textContent).toContain('حفظ الاستفسار');
    expect(dom.window.document.body.textContent).not.toContain('Last updated');
    (dom.window as any).RelayqoI18n.setLocale('en');
    await new Promise(resolve => setTimeout(resolve, 0));
    dom.window.close();
  });
});
