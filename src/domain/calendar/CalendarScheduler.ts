import { createHash, createSign } from 'crypto';
import { logger } from '../../utils/logger';

/**
 * Demo/appointment scheduling against a real calendar.
 * - Offers only slots that are free in the business calendar on the day the customer picks.
 * - Books the event; the bot may say "confirmed" only after the booking succeeded.
 * Days and times are understood in English, French, Arabic, Darija and Arabizi.
 */

export interface CalendarConfig {
  enabled?: boolean;
  /** Set at runtime when the client linked their own Google Calendar from the portal. */
  connectionId?: string;
  provider?: 'relayqo' | 'google' | 'fake';
  calendarId?: string;
  timezone?: string;          // default Africa/Casablanca
  durationMinutes?: number;   // default 30
  slotTimes?: string[];       // local "HH:mm" starts, default 10:00..18:00 every 2h
  workingDays?: number[];     // 0=Sunday..6=Saturday, default Monday..Saturday
  maxSlots?: number;          // slots shown per day, default 3
  minNoticeMinutes?: number;  // default 120
  daysAhead?: number;         // default 21
  eventTitle?: string;        // default "Demo"
}

export interface BusyRange { start: string; end: string }
/** `details` are the customer's answers (name, email, phone...), kept with the booking. */
export interface CalendarEvent { id: string; summary: string; description: string; startIso: string; endIso: string; timezone: string; details?: Record<string, unknown> }
export interface CalendarProvider {
  busy(calendarId: string, fromIso: string, toIso: string): Promise<BusyRange[]>;
  createEvent(calendarId: string, event: CalendarEvent): Promise<{ id: string }>;
  cancelEvent?(calendarId: string, eventId: string): Promise<void>;
}
export interface OfferedSlot { start: string; end: string; label: string }

const DEFAULTS = { timezone: 'Africa/Casablanca', durationMinutes: 30, slotTimes: ['10:00', '12:00', '14:00', '16:00', '18:00'], workingDays: [1, 2, 3, 4, 5, 6], maxSlots: 3, minNoticeMinutes: 120, daysAhead: 21, eventTitle: 'Demo' };
const settings = (c: CalendarConfig) => ({ ...DEFAULTS, ...Object.fromEntries(Object.entries(c || {}).filter(([, v]) => v !== undefined && v !== null && v !== '')) }) as Required<CalendarConfig>;

// ------------------------------------------------------------------ time zone helpers
function tzOffsetMinutes(instant: number, timeZone: string): number {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(new Date(instant)).filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]));
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour % 24, parts.minute, parts.second);
  return Math.round((asUtc - instant) / 60000);
}
/** UTC instant of a local wall-clock time in a time zone. */
export function zonedTime(day: string, hhmm: string, timeZone: string): Date {
  const [y, m, d] = day.split('-').map(Number), [h, mi] = hhmm.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  let utc = guess - tzOffsetMinutes(guess, timeZone) * 60000;
  utc = guess - tzOffsetMinutes(utc, timeZone) * 60000;
  return new Date(utc);
}
export function localDay(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);
}
const weekdayOf = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();
const addDays = (day: string, n: number) => { const t = new Date(`${day}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

// ------------------------------------------------------------------ language
const toLatinDigits = (s: string) => s.replace(/[ً-ْـ]/g, '').replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
const WEEKDAYS: [number, RegExp][] = [
  [1, /\b(?:monday|lundi|tnin|letnin|ltnin|ltnine|tnine|el ?tnin)\b|الاثنين|الإثنين|اثنين|التنين|الثنين|تنين/iu],
  [2, /\b(?:tuesday|mardi|tlat|tlata|ttlat|ttlata|ltlat)\b|الثلاثاء|الثلاث|التلات|ثلاثاء|تلات/iu],
  [3, /\b(?:wednesday|mercredi|larb3|l2arba3|arb3a|larba3|arba3|lerb3)\b|الأربعاء|الاربعاء|الاربع|لاربع|أربعاء|اربعاء/iu],
  [4, /\b(?:thursday|jeudi|lkhmis|khmis|lekhmis)\b|الخميس|خميس/iu],
  [5, /\b(?:friday|vendredi|jem3a|ljem3a|jm3a|ljm3a|jemaa)\b|الجمعة|جمعة|الجمعه/iu],
  [6, /\b(?:saturday|samedi|sebt|ssebt|sabt|ssabt|lsebt)\b|السبت|سبت/iu],
  [0, /\b(?:sunday|dimanche|l7ed|l7add|7ed|lhad)\b|الأحد|الاحد|الحد|أحد/iu]
];
const MONTHS: Record<string, number> = { january: 1, janvier: 1, february: 2, fevrier: 2, février: 2, march: 3, mars: 3, april: 4, avril: 4, may: 5, mai: 5, june: 6, juin: 6, july: 7, juillet: 7,
  august: 8, aout: 8, août: 8, september: 9, septembre: 9, october: 10, octobre: 10, november: 11, novembre: 11, december: 12, decembre: 12, décembre: 12 };

/** A day the customer named ("ghda", "غدا", "lundi", "20/10", "après-demain"), as YYYY-MM-DD, or null. */
export function parseDay(raw: string, now: Date, timeZone = DEFAULTS.timezone): string | null {
  const text = toLatinDigits(raw).toLowerCase();
  const today = localDay(now, timeZone);
  if (/\b(?:after ?tomorrow|apr[eè]s[- ]demain|ba3d ?ghda|ba3d ?ghedda|ba3d ?ghdda)\b|بعد غدا|بعد غدّا|بعد غد\b/iu.test(text)) return addDays(today, 2);
  if (/\b(?:tomorrow|demain|ghda|ghdda|ghedda|ghodwa)\b|غدا|غدّا|غذا|غدوة|الغد|غداً/iu.test(text)) return addDays(today, 1);
  if (/\b(?:today|aujourd'?hui|auj|lyoum|lyouma|lyoma|lyom|had nhar)\b|اليوم|ليوم|هاد النهار/iu.test(text)) return today;
  const numeric = /(?<!\d)(\d{1,2})\s*[\/.-]\s*(\d{1,2})(?:\s*[\/.-]\s*(\d{2,4}))?(?!\d)/.exec(text);
  if (numeric) {
    const [, d, m, y] = numeric.map(Number) as any;
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      let year = y ? (y < 100 ? 2000 + y : y) : Number(today.slice(0, 4));
      let day = `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      if (!y && day < today) day = `${year + 1}-${day.slice(5)}`;
      if (new Date(`${day}T12:00:00Z`).toISOString().slice(0, 10) === day) return day;
    }
  }
  const named = /(?<!\d)(\d{1,2})\s+([a-zéèûô]+)/iu.exec(text);
  if (named && MONTHS[named[2]]) {
    const year = Number(today.slice(0, 4)), m = MONTHS[named[2]], d = Number(named[1]);
    let day = `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (day < today) day = `${year + 1}-${day.slice(5)}`;
    if (new Date(`${day}T12:00:00Z`).toISOString().slice(0, 10) === day) return day;
  }
  for (const [weekday, pattern] of WEEKDAYS) {
    if (pattern.test(text)) {
      const diff = (weekday - weekdayOf(today) + 7) % 7;
      const next = /\b(?:next|prochain|jay|jaya)\b|الجاي|القادم|المقبل/iu.test(text) && diff === 0 ? 7 : diff;
      return addDays(today, next);
    }
  }
  return null;
}

const DAY_NAMES: Record<string, string[]> = {
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  fr: ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'],
  ar: ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'],
  darija: ['الحد', 'التنين', 'الثلاث', 'لاربع', 'الخميس', 'الجمعة', 'السبت'],
  arabizi: ['l7ed', 'letnin', 'tlat', 'larb3', 'lkhmis', 'jem3a', 'sebt']
};
const variant = (lang: string, script: string) => lang === 'darija' ? (script === 'arabizi' ? 'arabizi' : 'darija') : (DAY_NAMES[lang] ? lang : 'en');

/** "غدا", "tomorrow", "jeudi 16/10". */
export function dayLabel(day: string, now: Date, lang: string, script: string, timeZone = DEFAULTS.timezone): string {
  const v = variant(lang, script), today = localDay(now, timeZone);
  const words: Record<string, [string, string]> = { en: ['today', 'tomorrow'], fr: ["aujourd'hui", 'demain'], ar: ['اليوم', 'غدًا'], darija: ['اليوم', 'غدا'], arabizi: ['lyoum', 'ghda'] };
  if (day === today) return words[v][0];
  if (day === addDays(today, 1)) return words[v][1];
  return `${DAY_NAMES[v][weekdayOf(day)]} ${day.slice(8, 10)}/${day.slice(5, 7)}`;
}

/** The offered slot a reply picks: "14:00", "14h", "2pm", "the second", "l3chiya", "الثانية". */
export function matchSlot(raw: string, offered: OfferedSlot[]): OfferedSlot | null {
  if (!offered.length) return null;
  const text = toLatinDigits(raw).toLowerCase().trim();
  const time = /(?<![\p{L}\d])(\d{1,2})\s*(?:[:h.]\s*(\d{2}))?\s*(am|pm|du matin|de l'après-midi|du soir|sba7|sbah|l3chiya|3chiya|lil)?/iu.exec(text);
  if (time) {
    let h = Number(time[1]); const mm = time[2] ? Number(time[2]) : 0, mer = (time[3] || '').toLowerCase();
    const explicitClock = Boolean(time[2]) || /h/i.test(text.slice(time.index, time.index + time[0].length)) || Boolean(mer);
    const laterInDay = /pm|après|soir|3chiya|lil/.test(mer) || /\b(?:pm|soir|evening|afternoon|apr[eè]s[- ]midi|d?l3chiya|3chiya|d?lil|f lil)\b|العشية|عشية|الليل|المساء|بعد الزوال/iu.test(text);
    if (laterInDay && h < 12) h += 12;
    const at = (hour: number) => offered.find(s => s.label === `${String(hour).padStart(2, '0')}:${String(mm).padStart(2, '0')}`);
    const byClock = at(h) || (!mer && h < 12 ? at(h + 12) : undefined);
    if (byClock) return byClock;
    if (!explicitClock && h >= 1 && h <= offered.length && text.length <= 3) return offered[h - 1];
  }
  // Clock hours said in words: "العاشرة", "الثانية عشرة", "f l3chra", "m3a jouj".
  const later = /\b(?:pm|soir|evening|afternoon|apr[eè]s[- ]midi|l3chiya|3chiya|lil)\b|العشية|عشية|الليل|المساء|مساء|بعد الزوال|بعد الظهر/iu.test(text);
  for (const [pattern, hour] of HOUR_WORDS) {
    if (!pattern.test(text)) continue;
    const at = (x: number) => offered.find(s => s.label === `${String(x).padStart(2, '0')}:00`);
    const slot = (later && hour < 12 ? at(hour + 12) : at(hour)) || (hour < 12 ? at(hour + 12) : undefined);
    if (slot) return slot;
  }
  const ordinals: [RegExp, number][] = [
    [/\b(?:first|premier|premi[eè]re|lowl|lwl|lewla|lowla|1st)\b|الأول|الاول|الأولى|الاولى|اللول|اللولة/iu, 0],
    [/\b(?:second|deuxi[eè]me|tani|tanya|ttani|2nd)\b|الثاني|الثانية|التاني|التانية/iu, 1],
    [/\b(?:third|troisi[eè]me|talt|talta|3rd)\b|الثالث|الثالثة|التالت|التالتة/iu, 2],
    [/\b(?:last|dernier|derni[eè]re|lakhar|lekhra)\b|الأخير|الأخيرة|اللخر|اللخرة/iu, offered.length - 1]
  ];
  for (const [pattern, index] of ordinals) if (pattern.test(text) && offered[index]) return offered[index];
  const hour = (s: OfferedSlot) => Number(s.label.slice(0, 2));
  // Same words as the slot list (10:00 صباحاً, 12:00 فالزوال, 14:00 من بعد الزوال, 18:00 العشية).
  if (/\b(?:morning|matin|sba7|sbah|f sba7)\b|صباح|الصباح|فالصباح/iu.test(text)) return offered.find(s => hour(s) < 12) || null;
  if (/\b(?:afternoon|apr[eè]s[- ]midi|ba3d zwal|ba3d dhohr)\b|بعد الزوال|بعد الظهر/iu.test(text)) return offered.find(s => hour(s) >= 13 && hour(s) < 17) || offered.find(s => hour(s) >= 12 && hour(s) < 17) || null;
  if (/\b(?:evening|soir|soirée|fin de journ[ée]e|lil|f lil|l3chiya|3chiya|l3chia|3chia)\b|العشية|عشية|الليل|فالليل|المساء|مساء/iu.test(text)) return offered.find(s => hour(s) >= 17) || offered.find(s => hour(s) >= 15) || null;
  if (/\b(?:noon|midi|zwal|f zwal|dhohr)\b|الزوال|فالزوال|الظهر|ظهر/iu.test(text)) return offered.find(s => hour(s) === 12) || offered.find(s => hour(s) === 13) || null;
  return null;
}

/** Hours said as words, most specific first ("الثانية عشرة" before "الثانية"). */
const HOUR_WORDS: [RegExp, number][] = [
  [/الحادية عشرة?|الحضاش|\blhdach\b|\bl7dach\b|\bonze heures?\b|\beleven\b/iu, 11],
  [/الثانية عشرة?|الطناش|\bttnach\b|\bltnach\b|\bdouze heures?\b|\btwelve\b/iu, 12],
  [/الواحدة|الوحدة|\blwe7da\b|\blwa7da\b|\bune heure\b|\bone o'?clock\b/iu, 1],
  [/الثانية|الجوج|\bjouj\b|\bdeux heures?\b|\btwo o'?clock\b/iu, 2],
  [/الثالثة|التلاتة|\bltlata\b|\btrois heures?\b|\bthree o'?clock\b/iu, 3],
  [/الرابعة|الربعة|\bl2rb3a\b|\blareb3a\b|\bquatre heures?\b|\bfour o'?clock\b/iu, 4],
  [/الخامسة|الخمسة|\blkhamsa\b|\bcinq heures?\b|\bfive o'?clock\b/iu, 5],
  [/السادسة|الستة|\blsta\b|\bsix heures?\b|\bsix o'?clock\b/iu, 6],
  [/السابعة|السبعة|\bsept heures?\b|\bseven o'?clock\b/iu, 7],
  [/الثامنة|التمنية|\bhuit heures?\b|\beight o'?clock\b/iu, 8],
  [/التاسعة|التسعود|\bneuf heures?\b|\bnine o'?clock\b/iu, 9],
  [/العاشرة|العشرة|\bl3chra\b|\bdix heures?\b|\bten o'?clock\b/iu, 10]
];

// ------------------------------------------------------------------ messages
const M = (en: string, fr: string, ar: string, darija: string, arabizi: string) => ({ en, fr, ar, darija, arabizi });
export const CALENDAR_MESSAGES = {
  slots: M('Here are the available times {day}:\n{slots}\nWhich time suits you?', 'Voici les créneaux disponibles {day} :\n{slots}\nQuel horaire vous convient ?',
    'هذه الأوقات المتاحة {day}:\n{slots}\nما الوقت الذي يناسبك؟', 'واخا! عندنا هاد الأوقات المتاحة {day}:\n{slots}\nشنو الوقت اللي يناسبك؟', 'Wakha! 3ndna had lw9at li khawyin {day}:\n{slots}\nChmen w9t li ynasbek?'),
  noSlots: M('Sorry, {day} is fully booked. Which other day suits you?', 'Désolé, {day} est complet. Quel autre jour vous convient ?',
    'عذرًا، {day} محجوز بالكامل. ما اليوم الآخر الذي يناسبك؟', 'سمح ليا، {day} عامر. شنو نهار آخر اللي يناسبك؟', 'Smeh lia, {day} 3amer. Chmen nhar akhor li ynasbek?'),
  closed: M('Sorry, we are closed {day}. Which other day suits you?', 'Désolé, nous sommes fermés {day}. Quel autre jour vous convient ?',
    'عذرًا، نحن مغلقون {day}. ما اليوم الآخر الذي يناسبك؟', 'سمح ليا، ما خدامينش {day}. شنو نهار آخر اللي يناسبك؟', 'Smeh lia, ma khddaminch {day}. Chmen nhar akhor li ynasbek?'),
  chosen: M('Great, {when}.', 'Parfait, {when}.', 'ممتاز، {when}.', 'مزيان، {when}.', 'Mzyan, {when}.'),
  appointment: M('Your appointment is {when} ✅ If you want to change it, tell me the new day.', 'Votre rendez-vous est {when} ✅ Pour le changer, dites-moi le nouveau jour.',
    'موعدك {when} ✅ إذا أردت تغييره، أخبرني باليوم الجديد.', 'الموعد ديالك {when} ✅ إلا بغيتي تبدلو، قول ليا النهار الجديد.', 'Lmaw3id dyalek {when} ✅ Ila bghiti tbdlo, goul lia nhar jdid.'),
  reschedule: M('No problem. Your appointment is {when} for now. Which new day suits you?', 'Pas de souci. Votre rendez-vous est {when} pour l’instant. Quel nouveau jour vous convient ?',
    'لا مشكلة. موعدك حاليًا {when}. ما اليوم الجديد الذي يناسبك؟', 'ماشي مشكل. الموعد ديالك دابا {when}. شنو النهار الجديد اللي يناسبك؟', 'Machi mochkil. Lmaw3id dyalek daba {when}. Chmen nhar jdid li ynasbek?'),
  moved: M('✅ Done, your appointment is moved to {when}. See you then!', '✅ C’est fait, votre rendez-vous est déplacé à {when}. À bientôt !',
    '✅ تم، نُقل موعدك إلى {when}. نراك قريبًا!', '✅ صافي، تبدل الموعد ديالك ل{when}. نتلاقاو إن شاء الله!', '✅ Safi, tbdel lmaw3id dyalek l {when}. Ntla9aw nchallah!'),
  askDay: M('Which day suits you? For example tomorrow, Monday or 20/10.', 'Quel jour vous convient ? Par exemple demain, lundi ou le 20/10.',
    'ما اليوم الذي يناسبك؟ مثلًا غدًا أو الاثنين أو 20/10.', 'شنو النهار اللي يناسبك؟ مثلا غدا، التنين ولا 20/10.', 'Chmen nhar li ynasbek? Matalan ghda, letnin wla 20/10.'),
  pickSlot: M('Please choose one of these times:\n{slots}', 'Merci de choisir un de ces créneaux :\n{slots}', 'من فضلك اختر أحد هذه الأوقات:\n{slots}',
    'عافاك ختار واحد من هاد الأوقات:\n{slots}', '3afak khtar wa7ed mn had lw9at:\n{slots}'),
  taken: M('That time was just taken. Here is what is still free {day}:\n{slots}', 'Ce créneau vient d’être pris. Voici ce qui reste {day} :\n{slots}',
    'تم حجز هذا الوقت للتو. هذه الأوقات المتبقية {day}:\n{slots}', 'هاد الوقت تحجز دابا. ها شنو باقي خاوي {day}:\n{slots}', 'Had lw9t tdreb daba. Ha chno ba9i khawi {day}:\n{slots}'),
  // Neutral wording: the same booking step serves demos, fittings, salon visits... The workflow's own end message follows it.
  booked: M('✅ Your appointment is confirmed for {when}.', '✅ Votre rendez-vous est confirmé pour {when}.',
    '✅ تم تأكيد موعدك {when}.', '✅ تأكد الموعد ديالك {when}.', '✅ Tkked lmaw3id dyalek {when}.'),
  notBooked: M('Your request is saved ✅ We could not lock the time automatically, so our team will confirm {when} with you shortly.',
    'Votre demande est enregistrée ✅ Le créneau n’a pas pu être réservé automatiquement : notre équipe vous confirmera {when} très vite.',
    'تم تسجيل طلبك ✅ لم نتمكن من حجز الوقت تلقائيًا، وسيؤكد لك فريقنا {when} قريبًا.',
    'الطلب ديالك تسجل ✅ ما قدرناش نحجزو الوقت أوتوماتيكيا، الفريق ديالنا غادي يأكد معاك {when} قريب.',
    'Talab dyalek tsjel ✅ Ma 9dernach n7jzo lw9t automatiquement, lfari9 dyalna ghadi y2akked m3ak {when} 9rib.'),
  unavailable: M('The calendar is temporarily unavailable. Our team will confirm an available time with you.',
    'Le calendrier est momentanément indisponible. Notre équipe vous confirmera un horaire disponible.',
    'التقويم غير متاح مؤقتًا. سيؤكد لك فريقنا موعدًا متاحًا.',
    'التقويم ما خدامش دابا. الفريق ديالنا غادي يأكد معاك الوقت المناسب.',
    'L-calendar ma khddamch daba. Lfari9 dyalna ghadi y2akked m3ak lw9t lmnasb.')
};
const ICONS = ['🕙', '🕑', '🕕', '🕛', '🕓'];
export function calendarMessage(key: keyof typeof CALENDAR_MESSAGES, lang: string, script: string, vars: Record<string, string>): string {
  const v = variant(lang, script) as keyof typeof CALENDAR_MESSAGES.slots;
  return (CALENDAR_MESSAGES[key][v] || CALENDAR_MESSAGES[key].en).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}
const PART_OF_DAY = {
  en: ['in the morning', 'at noon', 'in the afternoon', 'in the evening'],
  fr: ['le matin', 'à midi', "l'après-midi", 'en fin de journée'],
  ar: ['صباحًا', 'ظهرًا', 'بعد الظهر', 'مساءً'],
  darija: ['صباحاً', 'فالزوال', 'من بعد الزوال', 'العشية'],
  arabizi: ['sba7', 'f zwal', 'mn ba3d zwal', 'l3chiya']
};
/** "morning / noon / afternoon / evening" word for a slot label such as "14:00". */
function partOfDay(label: string, lang?: string, script?: string): string {
  const hour = Number(/(\d{1,2})[:h]/.exec(label)?.[1] ?? NaN);
  if (!lang || Number.isNaN(hour)) return '';
  const words = PART_OF_DAY[variant(lang, script || '') as keyof typeof PART_OF_DAY] || PART_OF_DAY.en;
  return words[hour < 12 ? 0 : hour < 13 ? 1 : hour < 17 ? 2 : 3];
}
export const slotList = (slots: OfferedSlot[], lang?: string, script?: string) =>
  slots.map((s, i) => [ICONS[i % ICONS.length], s.label, partOfDay(s.label, lang, script)].filter(Boolean).join(' ')).join('\n');

// ------------------------------------------------------------------ scheduler
export class CalendarScheduler {
  constructor(private provider: CalendarProvider, private clock: () => Date = () => new Date()) {}
  now() { return this.clock(); }

  /** False on days the business does not work (so the customer hears "closed", not "fully booked"). */
  isWorkingDay(config: CalendarConfig, day: string): boolean {
    return settings(config).workingDays.includes(weekdayOf(day));
  }

  /** Cancels an earlier booking (when an appointment is moved). Providers without cancellation keep the event. */
  async cancel(config: CalendarConfig, eventId: string): Promise<boolean> {
    const c = settings(config);
    if (!this.provider.cancelEvent) return false;
    try { await this.provider.cancelEvent(c.calendarId, eventId); return true; }
    catch (error: any) { logger.warn(`CalendarScheduler: cancel failed: ${error?.message || error}`); return false; }
  }

  async freeSlots(config: CalendarConfig, day: string): Promise<OfferedSlot[]> {
    const c = settings(config);
    if (!c.calendarId) throw new Error('CALENDAR_NOT_CONFIGURED');
    const now = this.clock(), today = localDay(now, c.timezone);
    if (day < today || day > addDays(today, c.daysAhead) || !c.workingDays.includes(weekdayOf(day))) return [];
    const candidates = c.slotTimes.map(hhmm => {
      const start = zonedTime(day, hhmm, c.timezone);
      return { start: start.toISOString(), end: new Date(start.getTime() + c.durationMinutes * 60000).toISOString(), label: hhmm };
    }).filter(s => new Date(s.start).getTime() >= now.getTime() + c.minNoticeMinutes * 60000);
    if (!candidates.length) return [];
    const busy = await this.provider.busy(c.calendarId, zonedTime(day, '00:00', c.timezone).toISOString(), zonedTime(addDays(day, 1), '00:00', c.timezone).toISOString());
    const free = candidates.filter(s => !busy.some(b => new Date(b.start) < new Date(s.end) && new Date(b.end) > new Date(s.start)));
    if (free.length <= c.maxSlots) return free;
    // Spread the suggestions over the day (morning, afternoon, evening) instead of the first few.
    return Array.from({ length: c.maxSlots }, (_, i) => free[Math.round(i * (free.length - 1) / (c.maxSlots - 1 || 1))]);
  }

  /** Every free slot of the day, so a customer may ask for a free time that was not among the suggestions. */
  async allFreeSlots(config: CalendarConfig, day: string): Promise<OfferedSlot[]> {
    const c = settings(config);
    const hours = c.slotTimes.map(t => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))).sort((a, b) => a - b);
    if (!hours.length) return [];
    const expanded: string[] = [];
    for (let minute = hours[0]; minute <= hours[hours.length - 1]; minute += c.durationMinutes) {
      expanded.push(`${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`);
    }
    return this.freeSlots({ ...c, slotTimes: expanded, maxSlots: expanded.length }, day);
  }

  async isStillFree(config: CalendarConfig, slot: OfferedSlot): Promise<boolean> {
    const c = settings(config);
    const busy = await this.provider.busy(c.calendarId, slot.start, slot.end);
    return !busy.some(b => new Date(b.start) < new Date(slot.end) && new Date(b.end) > new Date(slot.start));
  }

  async book(config: CalendarConfig, slot: OfferedSlot, details: Record<string, unknown>): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
    const c = settings(config);
    try {
      if (!(await this.isStillFree(c, slot))) return { ok: false, reason: 'SLOT_TAKEN' };
      const name = String(details.fullName || details.name || '').trim();
      const answers = Object.fromEntries(Object.entries(details).filter(([k, v]) => !k.startsWith('_') && v !== undefined && v !== null && String(v).trim()).map(([k, v]) => [k, String(v)]));
      const description = Object.entries(answers).map(([k, v]) => `${k}: ${v}`).join('\n');
      // A deterministic Google event ID makes concurrent attempts for the same slot conflict atomically.
      // freeBusy alone is not a lock: two requests can both observe an empty slot.
      const id = createHash('sha256').update(`${c.calendarId}\0${slot.start}\0${slot.end}`).digest('hex');
      const event = await this.provider.createEvent(c.calendarId, { id, summary: `${c.eventTitle}${name ? ` — ${name}` : ''}`, description: `${description}\n\nBooked by the WhatsApp assistant.`,
        startIso: slot.start, endIso: slot.end, timezone: c.timezone, details: answers });
      if (!event.id) throw new Error('CALENDAR_EVENT_ID_MISSING');
      return { ok: true, id: event.id };
    } catch (error: any) {
      logger.warn(`CalendarScheduler: booking failed: ${error?.message || error}`);
      return { ok: false, reason: /(?:\b409\b|CALENDAR_EVENT_CONFLICT)/.test(String(error?.message || error)) ? 'SLOT_TAKEN' : 'BOOKING_FAILED' };
    }
  }
}

// ------------------------------------------------------------------ providers
/**
 * Google Calendar API. Authenticated either with a service account (the business shares its calendar with the
 * service account email) or with an access-token source (a calendar the client linked with "Connect Google Calendar").
 */
export class GoogleCalendarProvider implements CalendarProvider {
  private token?: { value: string; expiresAt: number };
  constructor(private credentials: { client_email: string; private_key: string } | (() => Promise<string>), private fetchFn: typeof fetch = fetch) {}

  static fromEnv(): GoogleCalendarProvider | null {
    const raw = process.env.GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON;
    if (!raw) return null;
    try {
      const json = JSON.parse(raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8'));
      return json.client_email && json.private_key ? new GoogleCalendarProvider(json) : null;
    } catch { logger.error('GoogleCalendarProvider: GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON is not valid JSON'); return null; }
  }

  private async accessToken(): Promise<string> {
    if (typeof this.credentials === 'function') return this.credentials();
    if (this.token && this.token.expiresAt > Date.now() + 60000) return this.token.value;
    const now = Math.floor(Date.now() / 1000);
    const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
    const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: this.credentials.client_email, scope: 'https://www.googleapis.com/auth/calendar', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`;
    const signature = createSign('RSA-SHA256').update(unsigned).sign(this.credentials.private_key.replace(/\\n/g, '\n')).toString('base64url');
    const res = await this.fetchFn('https://oauth2.googleapis.com/token', { method: 'POST', signal: AbortSignal.timeout(8000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }) });
    if (!res.ok) throw new Error(`Google token error ${res.status}`);
    const data: any = await res.json();
    this.token = { value: data.access_token, expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000 };
    return this.token.value;
  }

  private async call(path: string, body: unknown): Promise<any> {
    const res = await this.fetchFn(`https://www.googleapis.com/calendar/v3${path}`, { method: 'POST', signal: AbortSignal.timeout(8000),
      headers: { Authorization: `Bearer ${await this.accessToken()}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`Google Calendar error ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.json();
  }

  async busy(calendarId: string, fromIso: string, toIso: string): Promise<BusyRange[]> {
    const data = await this.call('/freeBusy', { timeMin: fromIso, timeMax: toIso, items: [{ id: calendarId }] });
    const cal = data?.calendars?.[calendarId];
    if (!cal || !Array.isArray(cal.busy) || cal.errors?.length) {
      throw new Error(`Google Calendar access error: ${cal?.errors?.[0]?.reason || 'missing calendar availability'}`);
    }
    return cal.busy as BusyRange[];
  }

  async createEvent(calendarId: string, e: CalendarEvent) {
    const data = await this.call(`/calendars/${encodeURIComponent(calendarId)}/events`, {
      id: e.id, summary: e.summary, description: e.description, start: { dateTime: e.startIso, timeZone: e.timezone }, end: { dateTime: e.endIso, timeZone: e.timezone } });
    return { id: String(data.id) };
  }
}

/** In-memory calendar for tests and local previews. */
export class FakeCalendarProvider implements CalendarProvider {
  events: { id: string; calendarId: string; summary: string; description: string; startIso: string; endIso: string }[] = [];
  constructor(public preBusy: BusyRange[] = []) {}
  async busy(calendarId: string, fromIso: string, toIso: string) {
    return [...this.preBusy, ...this.events.filter(e => e.calendarId === calendarId).map(e => ({ start: e.startIso, end: e.endIso }))]
      .filter(b => new Date(b.start) < new Date(toIso) && new Date(b.end) > new Date(fromIso));
  }
  async createEvent(calendarId: string, e: { id: string; summary: string; description: string; startIso: string; endIso: string }) {
    if (this.events.some(event => event.calendarId === calendarId && event.id === e.id)) throw new Error('CALENDAR_EVENT_CONFLICT');
    this.events.push({ calendarId, ...e });
    return { id: e.id };
  }
  async cancelEvent(calendarId: string, eventId: string) {
    this.events = this.events.filter(e => !(e.calendarId === calendarId && e.id === eventId));
  }
}

/** Calendars linked by clients: a provider per connection, registered at startup (see GoogleCalendarConnections). */
let connectionProviders: ((connectionId: string) => CalendarProvider) | null = null;
const connectionSchedulers = new Map<string, CalendarScheduler>();
export function setCalendarConnectionProviders(factory: ((connectionId: string) => CalendarProvider) | null) { connectionProviders = factory; connectionSchedulers.clear(); }
export function schedulerForConnection(connectionId: string): CalendarScheduler | null {
  if (!connectionProviders) return null;
  let scheduler = connectionSchedulers.get(connectionId);
  if (!scheduler) { scheduler = new CalendarScheduler(connectionProviders(connectionId)); connectionSchedulers.set(connectionId, scheduler); }
  return scheduler;
}

let defaultScheduler: CalendarScheduler | null | undefined;
/** Scheduler from the environment: Google when credentials are set, the in-memory calendar when CALENDAR_FAKE=1. */
export function defaultCalendarScheduler(): CalendarScheduler | null {
  if (defaultScheduler !== undefined) return defaultScheduler;
  const google = GoogleCalendarProvider.fromEnv();
  defaultScheduler = google ? new CalendarScheduler(google) : process.env.NODE_ENV !== 'production' && process.env.CALENDAR_FAKE === '1' ? new CalendarScheduler(new FakeCalendarProvider()) : null;
  return defaultScheduler;
}
export function setDefaultCalendarScheduler(s: CalendarScheduler | null) { defaultScheduler = s; }
