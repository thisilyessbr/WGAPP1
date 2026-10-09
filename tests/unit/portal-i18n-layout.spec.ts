import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

const script = readFileSync(resolve(process.cwd(), 'src/portal/ui/i18n.js'), 'utf8');

function page(language: 'ar' | 'fr') {
  const dom = new JSDOM(`<!doctype html><html><body>
    <main>
      <h1>Client account</h1>
      <p>How the assistant introduces itself and speaks to customers.</p>
      <label>Chatbot name</label>
      <label>Trigger phrases — one per line</label>
      <label>Bot message · en</label>
      <label>Intent 1 custom keywords — one per line</label>
      <span>Next → تأكيد الطلب</span>
      <p>A recent outbound message outcome is unconfirmed. Reconciling delivery status with WhatsApp…</p>
      <select><option value="auto">Automatic</option><option value="arabic">Arabic script</option></select>
      <div class="inbox-msg-content" dir="auto" data-no-translate>Done</div>
    </main>
  </body></html>`, { url: 'https://app.relayqo.online/admin', runScripts: 'outside-only' });
  dom.window.localStorage.setItem('relayqo-language', language);
  dom.window.eval(script);
  dom.window.RelayqoI18n.decorate();
  return dom;
}

describe('portal translation and conversation content', () => {
  it('keeps incoming and outgoing inbox bubbles stable in RTL while allowing message text to choose its own direction', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/portal/ui/portal.css'), 'utf8');
    const inbox = readFileSync(resolve(process.cwd(), 'src/portal/ui/inbox.js'), 'utf8');
    expect(css).toMatch(/\.inbox-transcript\{[^}]*direction:ltr/);
    expect(css).toMatch(/\.inbox-msg\.msg-customer\{align-self:flex-start/);
    expect(css).toMatch(/\.inbox-msg\.msg-ai\{align-self:flex-end/);
    expect(inbox).toContain('class="inbox-msg-content" dir="auto" data-no-translate');
  });

  it('translates admin, workflow and inbox chrome to Arabic without altering message text or option values', () => {
    const dom = page('ar');
    const { document } = dom.window;
    expect(document.documentElement.dir).toBe('rtl');
    expect(document.querySelector('h1')?.textContent).toBe('حساب العميل');
    expect(document.body.textContent).toContain('عبارات التفعيل');
    expect(document.body.textContent).toContain('رسالة الروبوت · en');
    expect(document.body.textContent).toContain('النية 1 · كلمات مخصصة');
    expect(document.body.textContent).toContain('التالي → تأكيد الطلب');
    expect(document.body.textContent).toContain('حالة إرسال رسالة حديثة غير مؤكدة');
    expect(document.querySelector('.inbox-msg-content')?.textContent).toBe('Done');
    expect(document.querySelector('option')?.value).toBe('auto');
    expect(document.querySelector('option')?.textContent).toBe('تلقائي');
    dom.window.RelayqoI18n.setLocale('fr');
    expect(document.querySelector('h1')?.textContent).toBe('Compte client');
    expect(document.querySelector('.inbox-msg-content')?.textContent).toBe('Done');
    expect(document.querySelector('option')?.value).toBe('auto');
  });

  it('translates newly inserted interface labels but leaves customer messages alone', async () => {
    const dom = page('fr');
    const node = dom.window.document.createElement('div');
    node.innerHTML = '<span>All controls saved.</span><div class="inbox-msg-content" data-no-translate>Saved</div>';
    dom.window.document.body.append(node);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(node.querySelector('span')?.textContent).toBe('Tous les paramètres sont enregistrés.');
    expect(node.querySelector('.inbox-msg-content')?.textContent).toBe('Saved');
  });
});
