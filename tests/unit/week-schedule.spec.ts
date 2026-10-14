import { describe, expect, it } from 'vitest';
import { parseWeekSchedule } from '../../src/domain/understanding/WeekSchedule';

const days = (hours: string) => {
  const r = parseWeekSchedule(hours);
  return r && { open: r.open.map(d => d.split(' ')[0]), closed: r.closed.map(d => d.split(' ')[0]) };
};

describe('opening days from merchant hours text', () => {
  it('reads French ranges and closures', () => {
    expect(days('Mardi au dimanche de 10:00 à 21:00. Fermé le lundi.')).toEqual({
      open: ['Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'], closed: ['Monday'] });
    expect(days('Du lundi au vendredi, fermé le samedi et le dimanche')).toEqual({
      open: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], closed: ['Saturday', 'Sunday'] });
  });

  it('reads English and Arabic, and single extra days', () => {
    expect(days('Monday to Friday 9-18, Saturday 9-13')?.closed).toEqual(['Sunday']);
    expect(days('من الاثنين إلى الجمعة، مغلق يوم السبت والأحد')?.closed).toEqual(['Saturday', 'Sunday']);
  });

  it('names each day in every customer language, including Darija', () => {
    expect(parseWeekSchedule('Lundi au samedi, fermé le dimanche')!.closed[0]).toBe('Sunday (dimanche, الأحد, Darija l7ed / الحد)');
  });

  it('refuses to guess when the text is not a clear weekly range', () => {
    expect(parseWeekSchedule('Tous les jours 9h-22h')).toBeNull();
    expect(parseWeekSchedule('Monday-Saturday 9am-7pm, closed on Sunday and Monday morning')).toBeNull();
    expect(parseWeekSchedule('')).toBeNull();
    expect(parseWeekSchedule(undefined)).toBeNull();
  });
});
