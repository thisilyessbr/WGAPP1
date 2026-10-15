import { LEXICON_CONCEPTS } from '../understanding/MoroccanLexicon';
/**
 * Catalog-aware product matching for Moroccan commerce conversations.
 *
 * Merchants usually name products in French or English ("Caftan Yasmine",
 * "Baskets Rif Runner") while customers ask in Darija, Arabic or Arabizi
 * ("شحال القفطان ياسمين", "bch7al sbardila"). Substring search cannot bridge
 * that, so a message is scored against every catalog product with:
 *   1. exact / prefix token matches,
 *   2. a multilingual lexicon of common product words (same concept),
 *   3. a consonant "skeleton" that matches transliterations across scripts
 *      (ياسمين ≈ Yasmine, قفطان ≈ caftan, مونطر ≈ montre).
 * Question words, greetings and filler never contribute to a match.
 */

export interface MatchableProduct {
  id: string;
  name: string;
  description?: string | null;
  category?: string | null;
  sku?: string | null;
  nameLocalized?: unknown;
}

export interface CatalogMatch<T extends MatchableProduct> { product: T; score: number }

const CONCEPTS = LEXICON_CONCEPTS;

/** Moroccan cities: a delivery destination, not a product, when the message is about shipping. */
const CITIES = new Set(`casablanca casa kaza rabat rbat sale salé tanger tanja tangier tetouan tetuan agadir oujda wejda wjda marrakech marrakesh mrakch fes fès fez meknes meknès
kenitra knitra eljadida jadida safi beni mellal nador laayoune laâyoune l3ayoun ayoun dakhla khouribga settat mohammedia mhammedia temara taza errachidia ouarzazate essaouira
larache ksar guelmim tiznit berkane khemisset sidi kasem taroudant
كازا الدار البيضاء البيضاء كازابلانكا الرباط سلا طنجة تطوان أكادير اكادير وجدة مراكش فاس مكناس القنيطرة الجديدة آسفي اسفي بني ملال الناظور العيون الداخلة خريبكة سطات المحمدية تمارة تازة الراشيدية ورزازات الصويرة العرائش`
  .split(/\s+/).map(w => w.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/^ال(?=\S{2,})/, '')));
const DELIVERY_CUE = /(?:receive|recevoir|re[cç]oi|arrive|reach|my\s+order|ma\s+commande|nst9bel|twsalni|twslni|توصلني|livraison|livrer|livrez|livré|deliver|delivery|shipping|ship|expédi|envoi\b|توصيل|التوصيل|ليفريزون|الليفريزون|شحن|الشحن|توصلو|كتوصلو|توصلني|twsil|twssil|tawsil|katwslo|katwsslo|twslo|twsalni|livrezon|lifrizon)/iu;

/** Words that describe the question, never the product. */
const STOP = new Set(`
a an the is are am be do does did have has had can could would will i me my you your we our it this that these those of for to in on at by with and or but please pls thanks thank
hi hello hey salut bonjour bonsoir salam slm salamo alaykom labas lbas khouya khoya akhi khti 3afak afak 3afakom svp stp merci
how much what which where when who price prices cost costs costing available availability stock instock still sell selling buy order want would like need
send show me picture pictures photo photos pic pics image images see view size sizes colour color colours colors
combien coute coûte coûtent prix tarif est-ce disponible disponibles dispo encore reste stock avez vous nous je veux voudrais aimerais acheter commander
envoyer envoyez menvoyer montrer voir taille tailles pointure couleur couleurs le la les un une des du de au aux en et ou est sont il elle ce cet cette ces mon ma mes ton ta
moi toi lui envoyezmoi envoiemoi envoyermoi montrezmoi montremoi donnezmoi pouvez peux pouvons quel quelle quels quelles matiere matière material made fabric tissu qualite qualité quality original
livraison delivery shipping frais fee fees cost délai delai combien temps long take takes receive recevoir jours days
bch7al bchhal ch7al chhal ch7al bchal chal taman tamane thaman prix wach wech kayn kayna kaynin kaynine kayen mazal ba9i b9a 3ndkom 3andkom 3ndk 3andek
3tini atini sift sifet seft lia liya li tswira tsawer tswer tsawir photo dyal dial dyali dialna f fi l m3a mn men ila wla ola o w bghit bghina nchri ncommandi nakhod nakhd
momkin mumkin ymkn ymken n9der nqder chno chnou achno ach shno fin imta kifach kifash 3lach wakha ok safi daba hna had hadak hadi hadik
taille pointure numero nmra nemra
`.trim().split(/\s+/).concat(`
كم سعر ثمن السعر الثمن ما هو هي هل لا يزال يزال متاح متاحا متوفر متوفرة موجود يوجد توجد عندكم عندك عندي لديكم واش وش كاين كاينة كاينين باقي مازال
شحال بشحال بكم شنو شنهو اش آش علاش فين أين اين إمتى امتى كيفاش ممكن يمكن يمكنني أريد اريد بغيت بغينا نطلب نشري نشريها نشريه نشوف أرسل ارسل صيفط صيفطي سيفط عطيني
لي ليا لي ديال ديالكم ديالي ديالو ديالها من في على عن الى إلى مع هاد هادا هادي هذا هذه ذلك تلك صورة صور تصويرة تصاور الصورة الصور تصوير شوف وريني
مقاس المقاس مقاسات قياس القياس نمرة النمرة لون اللون ألوان الألوان من فضلك عافاك عفاك الله يخليك سلام السلام عليكم مرحبا أهلا اهلا شكرا بزاف
وكم وشحال الي إلى الى توصيل التوصيل ليفريزون شحن الشحن مادة صنع الثوب ثوب جودة
له لها ليه ليها ديالو ديالها تصويرتو تصويرتها صورته صورتها أرسل أرسلي ابعث dyalo dyalha tswirto tswirtha tswirtou
`.trim().split(/\s+/)));

const ARABIC_SKELETON: Record<string, string> = {
  'ب': 'b', 'ت': 't', 'ث': 't', 'ج': 'j', 'ح': 'h', 'خ': 'k', 'د': 'd', 'ذ': 'd', 'ر': 'r', 'ز': 'z', 'س': 's', 'ش': 's',
  'ص': 's', 'ض': 'd', 'ط': 't', 'ظ': 'd', 'غ': 'g', 'ف': 'f', 'ق': 'k', 'ك': 'k', 'گ': 'g', 'ڭ': 'g', 'ل': 'l', 'م': 'm',
  'ن': 'n', 'ه': 'h', 'پ': 'b', 'ڤ': 'f'
};

export function normalizeToken(raw: string): string {
  let t = raw.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  t = t.replace(/[ً-ٰٟـ]/g, '').replace(/[إأآٱ]/g, 'ا').replace(/ى/g, 'ي');
  t = t.replace(/^[ld]['’]/, '');            // French elision: l'abaya, d'été
  t = t.replace(/[-_.'’]/g, '');               // t-shirt → tshirt
  if (/^[؀-ۿ]/.test(t)) {
    // Arabic clitics: وال / بال / فال / كال / لل / ال
    t = t.replace(/^(?:وال|بال|فال|كال)(?=\S{2,})/, '').replace(/^لل(?=\S{2,})/, '').replace(/^ال(?=\S{2,})/, '');
  }
  return t;
}

function stripArabizi(t: string): string {
  // Arabizi definite article glued to the noun: l9eftan, lbelgha, l3baya, lmontre.
  return /^l[^aeiouy\s]/.test(t) && t.length >= 5 ? t.slice(1) : t;
}

export function skeleton(token: string): string {
  const t = token;
  if (/[؀-ۿ]/.test(t)) {
    let out = '';
    [...t].forEach((ch, i) => {
      if (ch === 'و' || ch === 'ي') { if (i === 0) out += ch === 'و' ? 'w' : 'y'; return; }
      out += ARABIC_SKELETON[ch] ?? '';
    });
    return out.replace(/(.)\1+/g, '$1');
  }
  let s = stripArabizi(t)
    .replace(/dj/g, 'j').replace(/sh|ch/g, 's').replace(/kh/g, 'k').replace(/gh/g, 'g').replace(/th/g, 't')
    .replace(/ph/g, 'f').replace(/qu/g, 'k').replace(/ck/g, 'k').replace(/c(?=[eiy])/g, 's').replace(/c/g, 'k').replace(/q/g, 'k')
    .replace(/x/g, 'ks').replace(/p/g, 'b').replace(/v/g, 'f')
    .replace(/7/g, 'h').replace(/9/g, 'k').replace(/5/g, 'k').replace(/8/g, 'g').replace(/[2-4]/g, '');
  const first = s[0];
  s = s.slice(1).replace(/[aeiouwy]/g, '');
  s = ((first && /[wy]/.test(first)) ? first : (first && /[aeiou]/.test(first) ? '' : first || '')) + s;
  return s.replace(/[^a-z]/g, '').replace(/(.)\1+/g, '$1');
}

const conceptIndex = (() => {
  const index = new Map<string, Set<string>>();
  for (const [concept, words] of Object.entries(CONCEPTS)) {
    for (const word of words) {
      const key = normalizeToken(word);
      if (!index.has(key)) index.set(key, new Set());
      index.get(key)!.add(concept);
    }
  }
  return index;
})();

function conceptsOf(token: string): Set<string> {
  const direct = conceptIndex.get(token) || conceptIndex.get(stripArabizi(token));
  if (direct) return direct;
  // Light plural / feminine handling: baskets → basket, جلابات → جلاب
  for (const candidate of [token.replace(/(?:es|s|x)$/, ''), token.replace(/(?:ات|ين)$/, ''), token.replace(/ة$/, ''), token.replace(/^[لب](?=[؀-ۿ]{3,})/, '')]) {
    const hit = candidate !== token ? conceptIndex.get(candidate) : undefined;
    if (hit) return hit;
  }
  return new Set();
}

export function tokenize(text: string): string[] {
  return (text || '').split(/[\s,;:!?؟،.()\[\]{}"«»/\\|+*&]+/u)
    .map(normalizeToken)
    .filter(t => t.length >= 2 && !STOP.has(t) && !STOP.has(stripArabizi(t)) && !/^\d+$/.test(t)
      && !/^(?:x{0,3}[sml]|xxl|xxxl)$/.test(t));
}

function tokenScore(q: string, p: string): number {
  if (q === p) return 3;
  const qa = stripArabizi(q), pa = stripArabizi(p);
  if (qa === pa) return 3;
  const qCon = conceptsOf(q), pCon = conceptsOf(p);
  for (const c of qCon) if (pCon.has(c)) return 2.5;
  // A customer may type the start of a name ("cafta") or add a plural ending ("baskets"), but a short
  // product word must not match the start of a longer, different word ("mini" in "minimalist").
  if (q.length >= 4 && p.length >= 4 && (p.startsWith(q) || (q.startsWith(p) && q.length - p.length <= 2))) return 2.5;
  const qs = skeleton(q), ps = skeleton(p);
  if (qs.length >= 3 && qs === ps) return 2;
  if (qs.length >= 4 && ps.length >= 4 && (qs.startsWith(ps) || ps.startsWith(qs))) return 1.5;
  return 0;
}

function productFields(p: MatchableProduct): { tokens: string[]; weight: number }[] {
  const localized = p.nameLocalized && typeof p.nameLocalized === 'object'
    ? Object.values(p.nameLocalized as Record<string, unknown>).filter((v): v is string => typeof v === 'string').join(' ')
    : '';
  return [
    { tokens: tokenize(`${p.name} ${localized}`), weight: 1.5 },
    { tokens: tokenize(p.category || ''), weight: 1 },
    { tokens: tokenize(p.sku || ''), weight: 1 },
    { tokens: tokenize(p.description || ''), weight: 0.4 }
  ];
}

export class CatalogMatcher {
  static readonly MIN_SCORE = 2.5;

  /** Content-word tokens of a customer message (question words removed). */
  static queryTokens(text: string): string[] {
    const tokens = [...new Set(tokenize(text))];
    // "livraison l fes" names a destination, not the "Sac Fès" product.
    const isCity = (t: string) => CITIES.has(t) || CITIES.has(stripArabizi(t)) || CITIES.has(t.replace(/^[لب](?=[؀-ۿ]{3,})/, ''));
    return DELIVERY_CUE.test(text) ? tokens.filter(t => !isCity(t)) : tokens;
  }

  static score(text: string, product: MatchableProduct): number {
    const query = this.queryTokens(text);
    if (!query.length) return 0;
    const fields = productFields(product);
    let total = 0;
    for (const q of query) {
      let best = 0;
      for (const field of fields) for (const p of field.tokens) best = Math.max(best, tokenScore(q, p) * field.weight);
      // A word written exactly as in the product name ("runner" in "Runner Atlas") outweighs a synonym ("runner" ≈ "sport"),
      // so a big catalog sharing words like "Atlas" still finds the one product the customer named.
      if (fields[0].tokens.some(p => p === q || stripArabizi(p) === stripArabizi(q))) best += 1;
      total += best;
    }
    return total;
  }

  static rank<T extends MatchableProduct>(text: string, products: T[]): CatalogMatch<T>[] {
    return products
      .map(product => ({ product, score: this.score(text, product) }))
      .filter(m => m.score >= this.MIN_SCORE)
      .sort((a, b) => b.score - a.score);
  }

  /** The single product the message clearly refers to, or null when absent/ambiguous. */
  static best<T extends MatchableProduct>(text: string, products: T[]): T | null {
    const ranked = this.rank(text, products);
    if (!ranked.length) return null;
    if (ranked.length > 1 && ranked[0].score - ranked[1].score < 1) return null;
    return ranked[0].product;
  }
}
