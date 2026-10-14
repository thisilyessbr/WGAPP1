/**
 * Turns a merchant's free-text opening days ("Mardi au dimanche de 10:00 à
 * 21:00. Fermé le lundi.", "Monday to Saturday, closed Sunday") into explicit
 * open/closed days named in every customer language, so the answer never has
 * to work out which Darija day name is which (tnin = Monday, l7ed = Sunday).
 * Returns null when the text has no clear day range.
 */
const DAYS = [
  { en: 'Monday', fr: 'lundi', ar: 'الاثنين', darija: 'tnin / الاثنين', words: ['monday', 'mon', 'lundi', 'الاثنين', 'الإثنين', 'tnin', 'letnin'] },
  { en: 'Tuesday', fr: 'mardi', ar: 'الثلاثاء', darija: 'tlat / الثلاثاء', words: ['tuesday', 'tue', 'mardi', 'الثلاثاء', 'tlat'] },
  { en: 'Wednesday', fr: 'mercredi', ar: 'الأربعاء', darija: 'larb3 / الأربعاء', words: ['wednesday', 'wed', 'mercredi', 'الأربعاء', 'الاربعاء', 'larb3'] },
  { en: 'Thursday', fr: 'jeudi', ar: 'الخميس', darija: 'lkhmis / الخميس', words: ['thursday', 'thu', 'jeudi', 'الخميس', 'lkhmis'] },
  { en: 'Friday', fr: 'vendredi', ar: 'الجمعة', darija: 'jjem3a / الجمعة', words: ['friday', 'fri', 'vendredi', 'الجمعة', 'jjem3a'] },
  { en: 'Saturday', fr: 'samedi', ar: 'السبت', darija: 'sebt / السبت', words: ['saturday', 'sat', 'samedi', 'السبت', 'sebt'] },
  { en: 'Sunday', fr: 'dimanche', ar: 'الأحد', darija: 'l7ed / الحد', words: ['sunday', 'sun', 'dimanche', 'الأحد', 'الاحد', 'الحد', 'l7ed'] }
];

const dayIndex = (word: string) => DAYS.findIndex(d => d.words.includes(word.toLowerCase().replace(/[.,;:]$/, '')));
const DAY_WORD = DAYS.flatMap(d => d.words).sort((a, b) => b.length - a.length).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
const RANGE = new RegExp(`(?<![\\p{L}])(${DAY_WORD})(?![\\p{L}])\\s*(?:au|à|a|-|–|to|through|until|jusqu'au|إلى|الى|حتى|hta)\\s*(?:le\\s+)?(${DAY_WORD})(?![\\p{L}])`, 'giu');
const CLOSED = new RegExp(`(?:fermée?s?|closed|مغلق|مسدود|sauf|except)\\s*(?:le|les|on|the|يوم|نهار)?\\s*((?:(?:${DAY_WORD})(?:\\s*(?:,|et|and|&|و)\\s*(?:le\\s+|les\\s+|the\\s+|on\\s+)?)?)+)`, 'giu');
const DAY_ONLY = new RegExp(`(?<![\\p{L}])(${DAY_WORD})(?![\\p{L}])`, 'giu');

export interface WeekSchedule { open: string[]; closed: string[] }

export function parseWeekSchedule(hours: unknown): WeekSchedule | null {
  const text = typeof hours === 'string' ? hours : '';
  if (!text.trim()) return null;
  // Half-day closures ("closed Monday morning") are too fine-grained to restate
  // safely; the original text is then the only source.
  if (/morning|afternoon|evening|matin|après-midi|apres-midi|soir|صباح|الصباح|مساء|المساء|العشية/iu.test(text)) return null;
  const open = new Set<number>();
  for (const m of text.matchAll(RANGE)) {
    const from = dayIndex(m[1]), to = dayIndex(m[2]);
    if (from < 0 || to < 0) continue;
    for (let i = from; ; i = (i + 1) % 7) { open.add(i); if (i === to) break; }
  }
  if (!open.size) return null;
  const closed = new Set<number>();
  let rest = text;
  for (const m of text.matchAll(CLOSED)) {
    for (const d of m[1].matchAll(DAY_ONLY)) { const i = dayIndex(d[1]); if (i >= 0) closed.add(i); }
    rest = rest.replace(m[0], ' ');
  }
  // A day listed on its own ("Saturday 9-13") is open too.
  for (const d of rest.matchAll(DAY_ONLY)) { const i = dayIndex(d[1]); if (i >= 0 && !closed.has(i)) open.add(i); }
  for (const i of closed) open.delete(i);
  for (let i = 0; i < 7; i++) if (!open.has(i)) closed.add(i);
  const name = (i: number) => `${DAYS[i].en} (${DAYS[i].fr}, ${DAYS[i].ar}, Darija ${DAYS[i].darija})`;
  return { open: [...open].sort((a, b) => a - b).map(name), closed: [...closed].sort((a, b) => a - b).map(name) };
}
