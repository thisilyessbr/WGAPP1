/**
 * Writing-quality checks applied to every bot reply, independent of the
 * business facts: leaked internals, broken formatting for WhatsApp, repeated
 * sentences, language mixing, re-greeting mid-conversation, robotic phrasing.
 */
import type { Lang } from './moroccanCommerceCorpus';

const LEAK = /UNANSWERABLE|UNTRUSTED|KNOWLEDGE_DATA|CUSTOMER_QUESTION|OUTPUT CONTRACT|"status"\s*:|"answer"\s*:|\{\{|\}\}|\bundefined\b|\bNaN\b|\[object |\{(?:p|s|c|x|name|product|service)\}|<\/?[A-Z_]{4,}>|system prompt/u;
const INTERNAL_WORDING = /\bevidence\b|l-evidence|المعطيات|les informations fournies|the information provided|knowledge base|base de connaissances|données fournies|provided (?:data|information)|f l-?ma3lomat li 3ndi/iu;
const MOJIBAKE = /Ã[©¨ ¢§]|â€[™œ\x9d“”]|Ø[§£]|�/u;
const MARKDOWN = /\*\*[^*\n]+\*\*|^#{1,6}\s|\[[^\]\n]+\]\(https?:[^)]+\)|^\s*\|.*\|\s*$/mu;
const ROBOTIC = /as an ai|en tant qu'(?:ia|intelligence)|كذكاء اصطناعي|language model|modèle de langage|I am just a bot/iu;
const STOCK_COUNT = /in stock\s*[:(]\s*\d|en stock\s*[:(]\s*\d|\d+\s*(?:pieces?|pièces?|units?|unités?|items?|articles?)\s*(?:left|available|in stock|restante?s?|disponibles?|en stock)|(?:only|plus que|reste|il reste|ghir|غير|بقاو|بقات)\s*\d+\s*(?:pieces?|pièces?|units?|left|قطع|قطعة|حبات|بياسات|wa7da|pièce)|كاين منو\s*:?\s*\d|الكمية المتوفرة\s*:?\s*\d|kayen mno\s*:?\s*\d|\d+\s*(?:قطع|قطعة|حبات|حبة|بياسات|بياسة)\s*(?:متوفرة?|متبقية|كاينين|باقيين)/iu;
const STOCK_LABEL = /(?:^|\n)\s*(?:stock|المخزون|disponibilité|availability|الحالة)\s*:/iu;
const GREETING_START = /^(?:hello|hi|hey|good (?:morning|evening)|bonjour|bonsoir|salut|salam|slm|السلام عليكم|سلام|مرحبا|أهلا|أهلاً|ahlan|mr7ba|marhba)\b/iu;
const GENERIC_FALLBACK = /don't have that (?:detail|information)|n[’']ai pas cette (?:précision|information)|لا تتوفر لدي|ما عنديش هاد المعلومة|ma3ndich had (?:lma3loma|lme3louma)/iu;
const FR_WORDS = /(?<![\p{L}'])(?:le|la|les|est|vous|nous|notre|nos|pour|des|une|et|avec|votre|sont|livraison|merci|bonjour|disponible|taille|couleur|voici|désolé|frais|jours|paiement|gratuite?|dès|sauf|échange|réception|boutique|commande)(?![\p{L}])/giu;
const DZ_WORDS = /(?<![\p{L}\d])(?:kayn|kayna|dyal|dyali|dyalk|3la|wach|bghiti|ghadi|m3a|hna|daba|3ndna|lik|lia|liya|mzyan|ch7al|bch7al|wakha|chi|ila|3afak|safi|taman|bach|mn|f|l|w|nhar|smeh|n9der|n3awnk|twsil|khlas|lkhlas|katwsl|ghir|wla|machi|ma3ndnach|mli|tswira|kanqblo|katakhod|kayakhod|sa3a|d9i9a|dirham|drahem)(?![\p{L}\d])/giu;

// Merchant-written names quoted verbatim are not language mixing.
const ALLOWED_LATIN = /^(?:mad|dh|dhs|whatsapp|sms|xl|xxl|ok|spa|guéliz|gueliz|marrakech|casablanca|maârif|maarif|wifi|cash|cod|rif|runner|atlas|yasmine|nour|salma|sahara|ultras|fès|fes|nakhil|kessa|ghassoul)$/iu;

export interface QualityContext { lang: Lang; turnIndex: number; catalogText: string[]; answerable: boolean; multiTopic?: boolean }

export function replyQualityIssues(rawReply: string, ctx: QualityContext): string[] {
  const issues: string[] = [];
  const reply = rawReply || '';
  if (!reply.trim()) return issues;
  if (LEAK.test(reply)) issues.push('leaked internal text');
  if (INTERNAL_WORDING.test(reply)) issues.push('talks about its data/evidence instead of speaking as the business');
  if (MOJIBAKE.test(reply)) issues.push('broken characters (encoding)');
  if (MARKDOWN.test(reply)) issues.push('markdown that WhatsApp does not render');
  if (ROBOTIC.test(reply)) issues.push('robotic AI disclaimer');
  // Customers are told whether an item is available, never the stock count.
  if (STOCK_COUNT.test(reply)) issues.push('reveals the stock count');
  if (STOCK_LABEL.test(reply)) issues.push('robotic stock label');
  if (ctx.turnIndex > 0 && GREETING_START.test(reply.trim())) issues.push('greets again mid-conversation');
  if (ctx.answerable && GENERIC_FALLBACK.test(reply)) issues.push('generic "no information" fallback on an answerable question');
  const limit = ctx.multiTopic ? 1200 : 800;
  if (reply.length > limit) issues.push(`too long (${reply.length} chars)`);

  const sentences = reply.split(/(?<=[.!?؟。])\s+|\n+/u).map(s => s.trim().toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()).filter(s => s.length > 18);
  if (new Set(sentences).size < sentences.length) issues.push('repeats the same sentence');
  const doubled = /(?<![\p{L}\p{N}])(\p{L}{3,})\s+\1(?![\p{L}\p{N}])/iu.exec(reply);
  // Darija intensifiers ("bzaf bzaf", "شوية شوية") and "إلا إلا" (except if) are natural, not typos.
  if (doubled && !/^(?:bzaf|chwiya|chwia|بزاف|شوية|شويا|very|très|إلا|الا|ila)$/iu.test(doubled[1])) issues.push('doubled word');

  // Language mixing, judged without merchant-quoted catalog text.
  const text = ctx.catalogText.reduce((s, t) => s.split(t).join(' '), reply);
  if (ctx.lang === 'ar' || ctx.lang === 'da') {
    const latin = (text.match(/[A-Za-zÀ-ÿ]{3,}/g) || []).filter(w => !ALLOWED_LATIN.test(w));
    if (latin.length > 3) issues.push(`Latin words inside an Arabic-script reply (${latin.slice(0, 4).join(' ')})`);
  }
  if (ctx.lang === 'dz') {
    const fr = (text.match(FR_WORDS) || []).length, dz = (text.match(DZ_WORDS) || []).length;
    if (fr >= 4 && fr > dz) issues.push(`French mixed into an Arabizi reply (fr=${fr}, darija=${dz})`);
  }
  if (ctx.lang === 'en') {
    const fr = (text.match(FR_WORDS) || []).filter(w => !/^(?:est|une|et|des)$/i.test(w)).length;
    if (fr >= 3) issues.push(`French words inside an English reply (${fr})`);
  }
  return issues;
}
