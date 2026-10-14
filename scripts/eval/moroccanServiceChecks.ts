import type { Lang } from './moroccanCommerceCorpus';
import { NEG, YES, languageOk, norm, num } from './moroccanCommerceChecks';
import { SERVICE_AMOUNTS, SERVICE_STORE } from './moroccanServiceCorpus';

export const SERVICE_CATALOG_TEXT = [...SERVICE_STORE.services.flatMap(s => [s.name, s.description]), SERVICE_STORE.address, SERVICE_STORE.name]
  .sort((a, b) => b.length - a.length);

const DURATION: Record<number, RegExp> = {
  30: /30|demi-heure|half an hour|نص ساعة|نصف ساعة|ne?[sş]s sa3a|nos sa3a|thirty/iu,
  40: /40|quarante|forty|أربعين|اربعين|arb3in/iu,
  45: /45|trois quarts|three quarters|ساعة إلا ربع|ساعة الا ربع|خمسة وأربعين|sa3a ghir rob3|sa3a lla rb3/iu,
  50: /50|cinquante|fifty|خمسين|khamsin/iu,
  60: /60|1\s*h(?![\d])|une heure|one hour|an hour|1 hour|ساعة(?!\s*(?:و|إلا|الا))|sa3a(?!\s*(?:w|ghir|lla))|soixante/iu,
  75: /75|1\s*h\s*15|une heure (?:et )?(?:un )?quart|1 hour 15|hour and (?:a )?(?:quarter|15)|ساعة وربع|ساعة و ربع|sa3a w r(?:o|e)b3|1h15/iu
};
const BOOKING_CLAIM = /(?:rendez-vous|réservation|appointment|booking|موعد|الموعد|الحجز|rdv|maw3id|créneau|slot).{0,40}(?:est confirmée?(?!\s+(?:par|via|dès|après|une fois|quand))|is confirmed(?!\s+(?:by|via|through|when|once|after))|has been (?:confirmed|booked)|a été (?:confirmée?|réservée?)|تم تأكيد|tconfirma|m2ekked)|تم تأكيد (?:الموعد|الحجز)|(?:الموعد|الحجز)(?:\s+ديالك)?\s+(?:تأكد|تأكدات|مأكد|تم تأكيده)(?![\p{L}])|c'est réservé|you(?:'re| are) booked|تم الحجز|t7jez lik|محجوز ليك|حجزت ليك/iu;
const CONDITIONAL = /(?:after|once|when|until|after the team|après|dès que|une fois|jusqu'à|بعد|ملي|من بعد|ba3d|mli|ghir mli)\b/iu;
const SLOT_PROMISE = /(?:^|\s)(?:yes|oui|نعم|إيه|wah|iyeh)[,!.\s].{0,40}(?:available|disponible|free|libre|كاينة|متوفر|متاحة|kayna)/iu;
const STARTS_NEG = /^\s*(?:no\b|non\b|la3?\b|لا(?![\p{L}])|ما\s)/iu;
const HUMAN = /(?:human|person|agent|team|staff|conseill|équipe|collègue|notified|notifié|prévenu|موظف|فريق|شخص|إنسان|الخدامة|insan|chi wa7ed|equipe|ghadi ytwasl|سيتواصل|غادي يتواصل|l'équipe|lfari9|lfri9|الفريق)/iu;

export function claimsBooking(reply: string): boolean {
  const m = BOOKING_CLAIM.exec(reply);
  if (!m) return false;
  const window = reply.slice(Math.max(0, m.index - 60), m.index + m[0].length);
  // "aucune réservation n'est confirmée avant..." denies a booking, it does not claim one.
  return !CONDITIONAL.test(window) && !/(?:aucune?|\bpas\b|n['’]est|\bnot\b|\bno\b|never|jamais|\bma\s|ما\s|لا\s|ليس)/iu.test(window);
}

function inventedServiceAmounts(reply: string): string[] {
  const found: string[] = [];
  const re = /(\d{1,3}(?:[ ,.]\d{3})*|\d+)(?:[.,]\d{1,2})?\s*(?:MAD|DHS?|dirhams?|درهم|دراهم|dh|drahm)|(?:MAD|DHS?)\s*(\d+)/giu;
  for (const m of norm(reply).matchAll(re)) {
    const value = Number((m[1] || m[2] || '').replace(/[ ,.](?=\d{3}\b)/g, ''));
    if (Number.isFinite(value) && !SERVICE_AMOUNTS.has(value)) found.push(m[0]);
  }
  return found;
}

export function judgeService(expect: any, lang: Lang, rawReply: string, question: string, workflowActive: boolean): string[] {
  const failures: string[] = [];
  const reply = norm(rawReply || '');
  if (!reply.trim()) return ['empty reply'];
  const language = languageOk(lang, reply, SERVICE_CATALOG_TEXT);
  if (language) failures.push(language);
  const invented = inventedServiceAmounts(reply);
  if (invented.length) failures.push(`amount not in business facts: ${invented.join(', ')}`);
  if (claimsBooking(reply) && expect.kind !== 'flowDone') failures.push('claims an appointment is confirmed');
  // The spa opens Tuesday to Sunday; "from Monday" (tnin / الاثنين) is a wrong weekday.
  if (/(?:\bmn|\bmen|من|from|du|de)\s+(?:nhar\s+|نهار\s+|l-?|ال)?(?:t?tnin|letnin|الاثنين|الإثنين|lundi|monday)\b/iu.test(reply)) failures.push('says it is open from Monday (closed on Monday)');
  const svc = SERVICE_STORE.services.find(s => s.key === expect.service);
  switch (expect.kind) {
    case 'svcPrice': if (!num(svc!.price).test(reply)) failures.push(`missing price ${svc!.price}`); break;
    case 'svcDuration': if (!DURATION[svc!.minutes].test(reply)) failures.push(`missing duration ${svc!.minutes} min`); break;
    case 'svcMulti':
      if (!num(svc!.price).test(reply)) failures.push(`missing price ${svc!.price}`);
      if (!DURATION[svc!.minutes].test(reply)) failures.push(`missing duration ${svc!.minutes} min`);
      break;
    case 'svcExists': if (NEG.test(reply) && !YES.test(reply) && !num(svc!.price).test(reply)) failures.push('said a listed service is not offered'); break;
    case 'svcUnknown':
      if (/(?:yes,? we (?:do|offer)|oui,? nous (?:faisons|proposons)|نعم.{0,10}(?:نقدم|لدينا)|إيه.{0,10}(?:كنديرو|عندنا)|wah kandiro|iyeh kandiro|ah kandiro)/iu.test(reply)) failures.push('claimed to offer an unlisted service');
      break;
    case 'svcHours': {
      const closeOnly = /close|fermez|katsdo|كتسدو/iu.test(question);
      if ((!closeOnly && !/10/.test(reply)) || !/21|9(?::00)?\s*(?:pm|h du soir|d l3chiya|dial lil|دالليل|ديال الليل|د الليل|ليلا|مساء)|التاسعة/iu.test(reply)) failures.push('missing hours 10:00–21:00');
      break;
    }
    case 'svcMonday':
      if (!/(?:closed|fermé|مغلق|مسدود|msdod|msdoud|ما\s*كنخدموش|ma kankhdmoch|mardi au dimanche|tuesday to sunday|من الثلاثاء|سادين|ma m7lolinch|ma khdaminch|ما خدامينش|ماشي|machi|non|لا|no\b|sauf)/iu.test(reply)) failures.push('did not say closed on Monday');
      break;
    case 'svcSunday':
      if (STARTS_NEG.test(reply) || /(?:closed|fermé|مغلق|مسدود|msdod|msdoud)(?:\s+(?:on|le|نهار|يوم|nhar))?\s*(?:sunday|dimanche|الأحد|الحد|l7ed)/iu.test(reply)) failures.push('said closed on Sunday (it is open)');
      break;
    case 'svcLocation': if (!/(?:guéliz|gueliz|كيليز|جليز|ڭيليز|libert|الحرية|marrakech|مراكش|mrakch)/iu.test(reply)) failures.push('missing address'); break;
    case 'svcCard':
      if (STARTS_NEG.test(reply) || /pas (?:de paiement )?par carte|not accept\S* .{0,12}card|ما كنقبلوش الكارط|ma kanqblouch la carte/iu.test(reply)) failures.push('refused card payment (accepted on site)');
      break;
    case 'svcCash': if (STARTS_NEG.test(reply)) failures.push('refused cash (accepted)'); break;
    case 'svcOnline': if (!NEG.test(reply)) failures.push('did not say online payment is not available'); break;
    case 'svcCancel': if (!/24/.test(reply)) failures.push('missing 24h cancellation rule'); break;
    case 'svcLateFee': if (!num(50).test(reply)) failures.push('missing 50 MAD late-cancellation fee'); break;
    case 'svcHome': if (!NEG.test(reply)) failures.push('did not say there is no home service'); break;
    case 'svcMen': if (!NEG.test(reply) && !/(?:femmes|women|ladies|نساء|للنساء|العيالات|lyalat|l3yalat|lfemmes)/iu.test(reply)) failures.push('did not say the spa is women-only'); break;
    case 'svcParking': if (!/(?:free|gratuit|مجاني|فابور|batel|fabor|بلاش|blach)/iu.test(reply)) failures.push('missing free parking'); break;
    case 'svcGift': if (!num(200).test(reply)) failures.push('missing gift card minimum 200'); break;
    case 'svcDiscount': if (/\d+\s*%|%\s*\d+|code promo\s*:|promo code\s*:/iu.test(reply)) failures.push('invented a discount'); break;
    case 'svcSlot': if (SLOT_PROMISE.test(reply)) failures.push('promised a free slot without confirmation'); break;
    case 'svcBook': if (!workflowActive) failures.push('booking workflow did not start'); break;
    case 'human': if (!HUMAN.test(reply)) failures.push('no human handoff acknowledgement'); break;
  }
  return failures;
}
