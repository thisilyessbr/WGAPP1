import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';

const assets = resolve(process.cwd(), 'src/portal/ui');

async function loginPage(response: { status: number; body: Record<string, unknown> }, language = 'en') {
  const dom = new JSDOM('<!doctype html><div id="root"></div><div id="toast"></div>', {
    url: 'https://app.relayqo.online/login', runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const { window } = dom;
  window.localStorage.setItem('relayqo-language', language);
  const fetch = vi.fn(async (url: string) => {
    const path = String(url);
    const result = path.endsWith('/auth/session') ? { status: 401, body: { error: 'LOGIN_REQUIRED' } }
      : path.endsWith('/portal/plans') ? { status: 200, body: { plans: [] } }
      : path.endsWith('/portal/settings') ? { status: 200, body: {} } : response;
    return { ok: result.status < 400, status: result.status, json: async () => result.body };
  });
  Object.assign(window, { fetch });
  window.eval(readFileSync(resolve(assets, 'i18n.js'), 'utf8'));
  window.eval(readFileSync(resolve(assets, 'portal.js'), 'utf8'));
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  await vi.waitFor(() => expect(window.document.querySelector('#auth-form')).not.toBeNull());
  const email = window.document.querySelector<HTMLInputElement>('#email')!;
  const password = window.document.querySelector<HTMLInputElement>('#password')!;
  email.value = 'test@example.com';
  password.value = 'incorrect';
  window.document.querySelector<HTMLFormElement>('#auth-form')!
    .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  return { dom, fetch };
}

describe('login feedback', () => {
  it('shows one helpful Arabic credential error inside the form, not a technical toast', async () => {
    const { dom } = await loginPage({ status: 401, body: { error: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect.' } }, 'ar');
    const { document } = dom.window;
    await vi.waitFor(() => expect(document.querySelector('#auth-notice')?.textContent).toContain('تأكد من البريد الإلكتروني'));
    expect(document.querySelector('#auth-notice')?.getAttribute('role')).toBe('alert');
    expect(document.querySelector('#toast')?.textContent).toBe('');
  });

  it('does not show a generic Done toast on a successful login', async () => {
    const { dom, fetch } = await loginPage({ status: 200, body: { csrf: 'csrf' } });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/auth/login', expect.anything()));
    await vi.waitFor(() => expect(dom.window.document.querySelector<HTMLButtonElement>('#auth-form button[type="submit"]')?.disabled).toBe(false));
    expect(dom.window.document.querySelector('#toast')?.textContent).toBe('');
  });
});
