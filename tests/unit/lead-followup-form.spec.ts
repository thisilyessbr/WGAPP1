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
});
