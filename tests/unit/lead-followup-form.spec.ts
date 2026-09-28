import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { JSDOM } from 'jsdom';

describe('lead follow-up form', () => {
  const source = readFileSync('src/portal/ui/leads.js', 'utf8');

  it.each([
    [-60, '2026-09-25T11:30'],
    [0, '2026-09-25T10:30'],
    [300, '2026-09-25T05:30']
  ])('shows the saved instant in the customer-facing local time for offset %i', (offset, expected) => {
    const window: Record<string, any> = {};
    class LocalDate extends Date { getTimezoneOffset() { return offset; } }
    runInNewContext(source, { window, Date: LocalDate });
    expect(window.RelayqoLeads.toLocalDateTimeValue('2026-09-25T10:30:00.000Z')).toBe(expected);
  });

  it.each([
    [false, 'Customer request', 'Return to Needs reply on', 'Delivery address'],
    [true, 'Lead details', 'Delivery address', 'Inquiry details']
  ])('shows fields for commerce=%s', async (commerce, heading, expected, excluded) => {
    const root = { innerHTML: '' };
    const form = { onsubmit: null };
    const window: Record<string, any> = {};
    const lead = { id: 'lead-1', status: 'NEW', interest: null, sourceRequest: 'Bghit n7jez anglais', details: {}, workflowDetails: {}, customerPhone: '212600000000', createdAt: '2026-09-25T10:30:00Z', updatedAt: '2026-09-25T10:30:00Z' };
    runInNewContext(source, { window, document: { querySelector: () => form }, Date });
    await window.RelayqoLeads.renderLeads({
      root, path: '/app/leads/lead-1', shell: (content: string) => content,
      header: (title: string) => title, escape: (value: unknown) => String(value ?? ''),
      toast: () => {}, bind: () => {}, go: () => {},
      api: async (path: string) => path === '/client/profile'
        ? { profile: { commerceActive: commerce } }
        : { lead }
    });
    expect(root.innerHTML).toContain(heading);
    expect(root.innerHTML).toContain(expected);
    expect(root.innerHTML).not.toContain(excluded);
    expect(root.innerHTML).toContain('Bghit n7jez anglais');
  });

  it('shows the qualifying request, not a later unrelated insult, in the inquiry queue', async () => {
    const dom = new JSDOM('<div id="root"></div>', { url: 'https://app.relayqo.online/app/leads', runScripts: 'outside-only' });
    dom.window.eval(source);
    const root = dom.window.document.querySelector('#root')!;
    await (dom.window as any).RelayqoLeads.renderLeads({
      root, path: '/app/leads', shell: (html: string) => html,
      header: (title: string, _subtitle: string, action = '') => `<h1>${title}</h1>${action}`, escape: (value: unknown) => String(value ?? ''),
      toast: () => {}, bind: () => {}, go: () => {},
      api: async (path: string) => path === '/client/profile' ? { profile: { commerceActive: false } }
        : path.startsWith('/client/leads?') ? { leads: [{ id: 'one', status: 'NEW', customerPhone: '212600000000', interest: null, sourceRequest: 'Bghit n7jez anglais', lastCustomerMessage: 'Jm3 krk a w9', updatedAt: '2026-09-26T21:20:00Z' }], pagination: { total: 1, hasMore: false } }
        : { new: 1, dueFollowUps: 0, qualified: 0, won: 0 }
    });
    expect(root.textContent).toContain('Bghit n7jez anglais');
    expect(root.textContent).not.toContain('Jm3 krk a w9');
    dom.window.close();
  });

  it('saves a service reminder without claiming a booking, and marks it handled separately', async () => {
    const dom = new JSDOM('<div id="root"></div>', { url: 'https://app.relayqo.online/app/leads/lead-1', runScripts: 'outside-only' });
    dom.window.eval(source);
    const root = dom.window.document.querySelector('#root')!;
    const changes: any[] = [];
    let lead: any = { id: 'lead-1', status: 'NEW', sourceRequest: 'Bghit n7jez anglais', details: {}, customerPhone: '212600000000', createdAt: '2026-09-25T10:30:00Z' };
    const ctx = {
      root, path: '/app/leads/lead-1', shell: (html: string) => html,
      header: (title: string) => `<h1>${title}</h1>`, escape: (value: unknown) => String(value ?? ''),
      toast: () => {}, bind: () => {}, go: () => {},
      api: async (path: string, options?: any) => {
        if (path === '/client/profile') return { profile: { commerceActive: false } };
        if (options?.method === 'PATCH') {
          const change = JSON.parse(options.body);
          changes.push(change);
          lead = { ...lead, ...change };
          return { lead };
        }
        return { lead };
      }
    };
    await (dom.window as any).RelayqoLeads.renderLeads(ctx);
    expect(root.textContent).toContain('Mark handled');
    expect(root.textContent).toContain('No notification or WhatsApp message is sent automatically.');
    expect(root.textContent).toContain('Return to Needs reply on');
    expect(root.textContent).not.toContain('Confirmed');
    (root.querySelector('#service-reminder') as HTMLInputElement).value = (dom.window as any).RelayqoLeads.toLocalDateTimeValue(new Date(Date.now()+86400000).toISOString());
    await (root.querySelector('#service-request-form') as any).onsubmit({ preventDefault() {} });
    expect(changes[0].status).toBeUndefined();
    expect(changes[0].followUpAt).toBeTruthy();
    expect(root.textContent).toContain('Planned');
    await (root.querySelector('#service-done') as any).onclick();
    expect(changes[1]).toMatchObject({ status: 'DONE', followUpAt: null });
    expect(root.textContent).toContain('Reopen request');
    dom.window.close();
  });
});
