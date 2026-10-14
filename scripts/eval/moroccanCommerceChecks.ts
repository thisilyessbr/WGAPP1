import { CITIES, EvalCase, Lang, STORE, imageUrlFor } from './moroccanCommerceCorpus';

export interface TurnResult { reply: string; media: { type: string; url: string }[]; workflowActive: boolean }
export interface Verdict { passed: boolean; failures: string[] }

const arabicRatio = (s: string) => {
  const letters = s.match(/\p{L}/gu) || [];
  return letters.length ? letters.filter(c => /\p{Script=Arabic}/u.test(c)).length / letters.length : 0;
};
const has = (re: RegExp, s: string) => re.test(s);
const norm = (s: string) => s.normalize('NFKC').replace(/[ً-ْ]/g, '').replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
const num = (n: number) => new RegExp(`(?<![\\d.,])${n}(?:[.,]0{1,2})?(?![\\d])`, 'u');

const NEG = /(?:\bne\s+\S+\s+(?:pas|plus)\b|\bpas\s+de\b|(?:^|[\s.,!])la3?[,!.]?\s|^la3?\b|\bma[\s-]*ka[tn]\S+|\bmaka[tn]\S+|\bmach?i\s+mqbol|\bmsali\b|مسالي|\bonly\s+(?:possible\s+)?for\b|ما\s*كن\S+|ماكن\S+|\bnot?\b|\bno\b|n'est pas|ne sont pas|pas (?:disponible|en stock|de |d')|plus disponible|rupture|épuisé|indisponible|out of stock|unavailable|sold out|isn't|aren't|don't|doesn't|ما\s*كاين|ماكاين|ما\s*كايناش|ماكايناش|ما\s*بقا|مابقا|غير متوفر|غير متاح|نفد|نفذ|لا يوجد|ليس|لا\s|ma[\s-]*kayn|makayn|ma\s*b9a|mab9a|ma\s*kaynach|makaynach|machi|mkaynch|ma\s*3ndna|ما عندناش|ما\s*عندنا|ماعندنا|ma\s*3andnach|walou|wlh la|indispo)/iu;
const YES = /(?:\byes\b|available|in stock|\boui\b|disponible|en stock|متوفر|متاح|كاين|موجود|نعم|إيه|\bkayn|\bkayna|mawjoud|metwfer|\bwah\b|\biyeh\b|eh\b|\bdispo)/iu;
const CURRENCY = /(?:MAD|DHS?|DH\b|dirhams?|درهم|دراهم|dh|drahm)/iu;

// The merchant's own catalog text (names, descriptions, colours) is quoted
// verbatim in whatever language the merchant wrote it; judge only the bot's words.
const CATALOG_TEXT = [...STORE.products.flatMap(p => [p.description, p.name, ...p.variants.map(v => v.color)]), STORE.address, STORE.name]
  .sort((a, b) => b.length - a.length);
const withoutCatalog = (reply: string, catalog: string[] = CATALOG_TEXT) => catalog.reduce((s, t) => s.split(t).join(' '), reply);

export function languageOk(lang: Lang, rawReply: string, catalog: string[] = CATALOG_TEXT): string | null {
  const reply = withoutCatalog(rawReply, catalog);
  // A reply made almost only of merchant-written names and numbers carries no language signal.
  if ((reply.match(/\p{L}/gu) || []).length < 20) return null;
  const r = arabicRatio(reply);
  if (lang === 'ar' || lang === 'da') return r >= 0.5 ? null : `expected Arabic script (ratio ${r.toFixed(2)})`;
  if (r > 0.2) return `expected Latin script (ratio ${r.toFixed(2)})`;
  const lower = reply.toLowerCase();
  const fr = (lower.match(/(?<![\p{L}'])(?:le|la|les|est|vous|nous|notre|nos|se|au|aux|chez|trouve|située?|boutique|magasin|pour|de|des|une|et|à|avec|votre|sont|livraison|merci|bonjour|pas|oui|non|prix|disponible|disponibles|taille|couleur|voici|désolé|frais|jours|en stock|options|produits)(?![\p{L}])/gu) || []).length;
  const en = (lower.match(/(?<![\p{L}'])(?:the|is|you|we|for|and|your|are|with|please|delivery|thank|hello|it|our|can|yes|no|price|available|size|colour|color|here|sorry|days|in stock|options|products|located|store|shop|at|accepted|not|only)(?![\p{L}])/gu) || []).length;
  const dz = (lower.match(/(?<![\p{L}\d])(?:kayn|kayen|kayna|kaynin|dyal|dyali|dyalna|dyalk|3la|wach|bghiti|ghadi|m3a|hna|daba|3ndna|3andna|lik|lia|mzyan|bzaf|ch7al|bch7al|wakha|chi|dial|nta|nti|ila|ola|ma|3afak|safi|ana|howa|hiya|taman|mno|ah|walakin|bach|mn|f|l|w|o|kheyarat|lwan|taille|smh|men|lhad|l7ed|msdoud|msdoudin|msdouda|meghlouq|iyeh|chriti|ktar|khdamin|khdama|tnin|sbt|sebt|ghir|wla|kanqbloch|ma3ndich|msali|db|sa3a|katakhod|smeh|liya|kaynch|salam|labas|hamdollah|hamdoullah|kifach|kifash|n9der|n3awnk|n3awnek|n3awnak|lyoum|mr7ba|marhba|ahlan|sme7|smeh|lina|likom|ntouma|katwsl|twsil|tswira|makaynch|makaynach|ma\s?kaynch|nhar|yamat|ayam)(?![\p{L}\d])/gu) || []).length;
  // Short factual replies ("Oui, X est disponible. Prix : 890 MAD.") carry
  // few function words; require a clear lead rather than a fixed count.
  if (lang === 'fr' && (fr < 1 || fr <= en || dz > fr + 1)) return `expected French (fr=${fr}, en=${en}, darija=${dz})`;
  if (lang === 'en' && (en < 1 || en <= fr || dz > en + 1)) return `expected English (en=${en}, fr=${fr}, darija=${dz})`;
  const short = reply.split(/\s+/).length < 10;
  if (lang === 'dz' && (dz < (short ? 1 : 2) || en > dz + 1 || fr > dz + 1)) return `expected Darija in Latin script (darija=${dz}, en=${en}, fr=${fr})`;
  return null;
}

/** Every amount written next to a currency must exist in the store facts. */
function inventedAmounts(reply: string): string[] {
  const allowed = new Set<number>([...STORE.products.map(p => p.price), 20, 35, 500]);
  const text = norm(reply);
  const found: string[] = [];
  const re = /(\d{1,3}(?:[ ,.]\d{3})*|\d+)(?:[.,]\d{1,2})?\s*(?:MAD|DHS?|dirhams?|درهم|دراهم|dh|drahm)|(?:MAD|DHS?)\s*(\d+)/giu;
  for (const m of text.matchAll(re)) {
    const raw = (m[1] || m[2] || '').replace(/[ ,.](?=\d{3}\b)/g, '');
    const value = Number(raw);
    if (Number.isFinite(value) && !allowed.has(value)) found.push(m[0]);
  }
  return found;
}

export { NEG, YES, num, norm, inventedAmounts };

export function judge(c: EvalCase, turns: TurnResult[]): Verdict {
  const failures: string[] = [];
  const last = turns[turns.length - 1];
  const reply = norm(last?.reply || '');
  if (!reply.trim()) return { passed: false, failures: ['empty reply'] };
  const lang = languageOk(c.lang, reply);
  if (lang) failures.push(lang);
  const invented = inventedAmounts(reply);
  if (invented.length) failures.push(`amount not in store facts: ${invented.join(', ')}`);
  if (/(?:order|commande|طلبك|الطلب|lcommande|commande dyalk).{0,40}(?:is confirmed|has been confirmed|est confirmée|a été confirmée|تم تأكيد|تأكدات|tconfirmat|confirmé)/iu.test(reply) && c.expect.kind !== 'order'
    && !/(?:after|once|when|après|dès que|une fois|بعد|ملي|من بعد|ba3d|mli)[^.!?]{0,40}(?:order|commande|طلب|الكوموند|lcommande)/iu.test(reply)) {
    failures.push('claims an order is confirmed');
  }
  const product = (key: string) => STORE.products.find(p => p.key === key)!;
  const e = c.expect;
  switch (e.kind) {
    case 'price': {
      const p = product(e.product);
      if (!num(p.price).test(reply)) failures.push(`missing price ${p.price}`);
      break;
    }
    case 'available': {
      if (e.expected && NEG.test(reply) && !YES.test(reply)) failures.push('said unavailable but product is in stock');
      if (!e.expected && !NEG.test(reply)) failures.push('did not say the product is out of stock');
      break;
    }
    case 'variant': {
      if (e.expected && NEG.test(reply) && !YES.test(reply)) failures.push('said size unavailable but it is in stock');
      if (!e.expected && !NEG.test(reply)) failures.push('did not say the size is out of stock');
      break;
    }
    case 'photo': {
      const url = imageUrlFor(e.product);
      const urls = last.media.filter(m => m.type === 'image').map(m => m.url);
      if (!urls.includes(url)) failures.push(urls.length ? `sent the wrong image (${urls.join(', ')})` : 'no product image attached');
      break;
    }
    case 'fee': {
      const fee = e.casa ? 20 : 35;
      if (!num(fee).test(reply)) failures.push(`missing delivery fee ${fee}`);
      if (!e.casa && num(20).test(reply) && !num(35).test(reply)) failures.push('quoted the Casablanca fee for another city');
      break;
    }
    case 'time': {
      const ok = e.casa ? /24\s*(?:h|heures|hours|ساعة|sa3a)|يوم واحد|nhar wa7ed|one day|un jour|غدا|ghedda/iu : /48|72|2\s*(?:à|a|-|to|و|ou|l)\s*3|deux à trois|two to three|يومين|جوج|3 أيام|ثلاث|tlata|juj/iu;
      if (!ok.test(reply)) failures.push(`missing delivery time for ${e.casa ? 'Casablanca (24h)' : 'other cities (48–72h)'}`);
      break;
    }
    case 'cod':
      if (/^\s*(?:no\b|non\b|la3?\b|لا(?![\p{L}])|ما\s)/iu.test(reply)) { failures.push('refused cash on delivery'); break; }
      if (!/(?:livraison|réception|delivery|receiv|cash|استلام|الاستلام|التسليم|نقدا|كاش|ملي توصل|stilam|lbab|cash|f lbab|3nd)/iu.test(reply) || /(?:no|non|pas possible|لا يمكن|ما\s*يمكنش|ma ymkench).{0,20}(?:cash|livraison|استلام)/iu.test(reply)) failures.push('did not confirm cash on delivery');
      break;
    case 'card':
      if (!NEG.test(reply)) failures.push('did not say card payment is not accepted');
      break;
    case 'exchange':
      if (!num(7).test(reply) && !/sept|seven|سبعة|سبع|seb3a/iu.test(reply)) failures.push('missing 7-day exchange window');
      break;
    case 'refund':
      if (!NEG.test(reply)) failures.push('did not say refunds are not offered');
      break;
    case 'free':
      if (!num(500).test(reply)) failures.push('missing free-delivery threshold 500');
      break;
    case 'location':
      if (!/(?:ma[aâ]rif|tarik|طارق|المعاريف|maarif|casablanca|الدار البيضاء|كازا|casa)/iu.test(reply)) failures.push('missing store address');
      break;
    case 'hours':
      {
        const asksClosingOnly = /close|fermez|katsdo|كتسدو/iu.test(c.turns.at(-1) || '');
        if ((!asksClosingOnly && !/10/.test(reply)) || !/20|8\s*(?:pm|مساء|d l3chiya)|الثامنة/iu.test(reply)) failures.push('missing hours 10:00–20:00');
      }
      break;
    case 'sunday':
      if (!/(?:closed|fermé|مغلق|مسدود|msdod|msdoud|ما\s*كنخدموش|ma kankhdmoch|sauf|except|lundi au samedi|monday to saturday|من الاثنين إلى السبت|من الإثنين|ما حالينش|makan7lch|machi|non|لا|no\b|ma\s*m7lolinch|ma khdaminch|ما خدامينش|سادين)/iu.test(reply)) failures.push('did not say closed on Sunday');
      break;
    case 'discount':
      if (/\d+\s*%|%\s*\d+|code promo\s*:|promo code\s*:/iu.test(reply)) failures.push('invented a discount');
      break;
    case 'unknown':
      if (/(?:yes,? we (?:have|sell)|oui,? nous (?:avons|vendons)|نعم.{0,10}(?:لدينا|نبيع)|إيه.{0,10}عندنا|ah 3ndna|wah 3ndna)/iu.test(reply)) failures.push('claimed to sell an item not in the catalog');
      break;
    case 'order':
      if (!last.workflowActive) failures.push('order workflow did not start');
      break;
    case 'tracking':
      if (/(?:is on (?:its|the) way|has been shipped|est en route|a été expédiée|في الطريق|تم شحن)/iu.test(reply)) failures.push('invented an order status');
      if (!/(?:suivi|tracking|track|تتبع|التتبع|suivi|numéro|number|رقم|ra9m|24)/iu.test(reply)) failures.push('missing tracking explanation');
      break;
    case 'human':
      if (!/(?:human|person|agent|team|staff|conseiller|équipe|collègue|notified|notifié|prévenu|موظف|فريق|شخص|إنسان|الخدامة|insan|chi wa7ed|l'équipe|equipe|ghadi ytwasl|سيتواصل|غادي يتواصل)/iu.test(reply)) failures.push('no human handoff acknowledgement');
      break;
    case 'greeting':
      break;
    case 'multi': {
      const p = product(e.product);
      if (!num(p.price).test(reply)) failures.push(`missing price ${p.price}`);
      const fee = e.casa ? 20 : 35;
      const free = p.price >= 500 && /(?:free|gratuite?|offerte|مجاني|فابور|fabor|batel|à l'œil)/iu.test(reply);
      if (!num(fee).test(reply) && !free) failures.push(`missing delivery fee ${fee}`);
      break;
    }
    case 'quality':
      break;
  }
  return { passed: failures.length === 0, failures };
}

export const cityKeys = CITIES.map(c => c.key);
