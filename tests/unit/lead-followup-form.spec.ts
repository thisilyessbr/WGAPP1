import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

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
    [false, 'Inquiry details', 'Service or course', 'Delivery address'],
    [true, 'Lead details', 'Delivery address', 'Inquiry details']
  ])('shows fields for commerce=%s', async (commerce, heading, expected, excluded) => {
    const root = { innerHTML: '' };
    const form = { onsubmit: null };
    const window: Record<string, any> = {};
    const lead = { id: 'lead-1', status: 'NEW', details: {}, workflowDetails: {}, customerPhone: '212600000000', createdAt: '2026-09-25T10:30:00Z', updatedAt: '2026-09-25T10:30:00Z' };
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
  });
});
