/**
 * Replies that decline an optional workflow question ("no", "later", "I don't have one")
 * in Darija (Arabic script and Arabizi), Arabic, French and English. The whole reply
 * must be a refusal: punctuation, emoji and polite words around it are ignored, so
 * "لا شكرا 🙏" declines while "لا، الإيميل هو …" does not.
 */
const POLITE = /\b(?:merci|thanks?|thank you|chokran|choukran|shukran|shokran|svp|please|3afak|afak|beaucoup|bzaf|bezzaf)\b|شكرا|شكراً|مرسي|ميرسي|عفاك|بزاف|الله يخليك/giu;

const DECLINE_ARABIC = [
  'لا', 'لاا', 'لالا', 'لا لا', 'نو', 'لا بغيت', 'لا أريد', 'لا اريد', 'ما أريد', 'لا داعي', 'لا حاجة', 'لا يوجد', 'لا أملك', 'ليس لدي', 'ليس عندي',
  'ماشي ضروري', 'ماشي دابا', 'ماشي مشكل', 'منبعد', 'من بعد', 'من بعد إن شاء الله', 'بلا', 'بلاش', 'بلاها', 'خليها', 'خليه', 'خلي', 'خليها منبعد',
  'سكيب', 'تخطى', 'تجاوز', 'والو', 'حتى لا', 'ماعنديش', 'ما عنديش', 'معنديش', 'ما عندي', 'ماعندي', 'ماكاينش', 'ما كاينش', 'ماكاين', 'مكاينش',
  'ما بغيتش', 'مابغيتش', 'ما باغيش', 'ماباغيش', 'ما باغياش', 'ماشي لازم', 'مكانش', 'ماكانش', 'ماشي'
];
const DECLINE_LATIN = [
  'no', 'nope', 'nah', 'non', 'la', 'lla', 'laa', 'lala', 'no need', 'not now', 'later', 'skip', 'pass', 'passer', 'plus tard', 'pas besoin', 'pas maintenant',
  'pas de mail', 'pas d email', 'pas d e-mail', 'pas d\'email', 'sans email', 'sans mail', 'je n ai pas', 'je n\'ai pas', 'i don\'t have', 'i dont have', 'don\'t have',
  'mn ba3d', 'mnba3d', 'men ba3d', 'menba3d', 'mn b3d', 'ma3ndich', 'ma 3ndich', 'ma3endich', 'ma 3endich', 'makaynch', 'makaynch email', 'ma bghitch', 'mabghitch',
  'machi daroori', 'machi daruri', 'machi darori', 'machi daba', 'machi lazem', 'machi', 'pas', 'not', 'bla', 'blach', 'blash', 'khliha', 'khlih', 'walo'
];
const DECLINES = new Set([...DECLINE_ARABIC, ...DECLINE_LATIN]);
const DECLINE_WORDS = new Set([...DECLINES].flatMap(phrase => phrase.split(' ')));

function normalize(text: string): string {
  return String(text || '').normalize('NFC').toLocaleLowerCase()
    .replace(/[ً-ٰٟـ]/gu, '')
    .replace(POLITE, ' ')
    .replace(/[\p{Extended_Pictographic}️‍]/gu, ' ')
    .replace(/[.,!?؟،؛;:…"«»()\-_*~]+/gu, ' ')
    .replace(/\s+/gu, ' ').trim();
}

/** The field words a refusal may name: "ماعنديش إيميل", "ma bghitch n3tik l email". */
const FIELD_WORDS = /\b(?:e-?mail|mail|l-?email|l-?mail|courriel|adresse|address)\b|الإيميل|الايميل|إيميل|ايميل|الميل|البريد|بريد|البريد الإلكتروني|البريد الالكتروني/giu;
const FILLER = /^(?:ana|ana ma|daba|safi|wakha|ok|okay|d accord|ah|iyeh|واخا|صافي|أنا|انا|دابا|آه|اه|ايه)\s+/u;

export function isDeclineReply(message: string): boolean {
  if (/@/.test(message)) return false;
  let text = normalize(message);
  if (!text) return false;
  for (let i = 0; i < 2 && FILLER.test(text); i++) text = text.replace(FILLER, '');
  // "ماعنديش الإيميل دابا", "pas pour le moment": a time word does not change the refusal.
  text = text.replace(/(?<=^|\s)(?:دابا|الآن|حاليا|daba|now|for now|right now|maintenant|pour le moment|pour l instant)(?=\s|$)/giu, ' ').replace(/\s+/gu, ' ').trim();
  if (!text) return false;
  if (DECLINES.has(text)) return true;
  // "ماعنديش إيميل", "ما بغيتش نعطي الإيميل", "pas d'email merci": a refusal word with the field name.
  // \b only knows ASCII letters, so these words are matched between spaces.
  const withoutField = text.replace(FIELD_WORDS, ' ')
    .replace(/(?<=^|\s)(?:n3tik|n3tikom|na3tik|n3ti|نعطيك|نعطيكم|نعطي|نعطيه|نعطيها|ديالي|dyali|my|mon)(?=\s|$)/giu, ' ')
    .replace(/\s+/gu, ' ').trim();
  if (withoutField !== text && DECLINES.has(withoutField)) return true;
  // "واخا لا ماشي مشكل", "la merci machi daroori": every word is part of a refusal.
  const tokens = text.split(' ');
  return tokens.length <= 5 && tokens.some(word => DECLINES.has(word)) && tokens.every(word => DECLINE_WORDS.has(word));
}
