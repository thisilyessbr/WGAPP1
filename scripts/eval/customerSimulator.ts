/**
 * Adaptive simulated customer for multi-turn order and booking flows: reads
 * the bot's question and answers it the way a Moroccan customer would, in the
 * conversation's language. Returns null when the question is not recognisable.
 */
import { Lang, STORE } from './moroccanCommerceCorpus';
import { SERVICE_STORE } from './moroccanServiceCorpus';

export type Field = 'confirm' | 'phone' | 'name' | 'address' | 'slot' | 'size' | 'service' | 'product';

const ASK: [Field, RegExp][] = [
  ['confirm', /akkid|akked|t-akked|t2akked|confirmi|confirm|tu confirmes|vous confirmez|تأكيد|تؤكد|تأكدي|تأكد|t2ekked|t2kd|kat2ekked|ta2kid|est-ce correct|c'est bien ça|is that correct|is this correct|صحيح؟|واش صحيح|wach s7i7|wach mzyan hakka/iu],
  ['phone', /phone|téléphone|tél\b|numéro|mobile|portable|رقم|هاتف|التيليفون|التلفون|النمرة|nmra|ra9m|tilifon|tel\b|numero/iu],
  ['name', /name|\bnom\b|prénom|اسم|سميت|سمية|smit|smiya|smitk|smitek|smiytek/iu],
  ['address', /city|address|ville|adresse|مدينة|عنوان|المدينة|mdina|l3onwan|3onwan|livrer à|deliver to|fin ghadi|فين نوصلو|فين غادي/iu],
  ['slot', /\bnhar\b|sa3a|wa9t|lw9t|date|day|time|when|jour|heure|quand|créneau|disponibilit|يوم|وقت|الوقت|نهار|إمتى|امتى|imta|lw9t|lwe9t|lwa9t|fo9ach|فوقاش|موعد|maw3id/iu],
  ['size', /size|colou?r|taille|couleur|pointure|مقاس|لون|القياس|اللون|النمرة ديال|mqas|9yas|lon\b|loun|pointure/iu],
  ['service', /service|prestation|soin|treatment|خدمة|الخدمة|khidma|achmen service|شنو بغيتي دير/iu],
  ['product', /product|article|produit|item|منتج|المنتوج|المنتج|montoj|l-produit|chno bghiti/iu]
];

export function askedField(reply: string): Field | null {
  for (const [field, re] of ASK) if (re.test(reply)) return field;
  return null;
}

const NAME: Record<Lang, string> = { en: 'Salma Bennani', fr: 'Salma Bennani', ar: 'سلمى بناني', da: 'سلمى بناني', dz: 'salma bennani' };
const ADDRESS: Record<Lang, string> = { en: 'Rabat, 15 Avenue Hassan II', fr: 'Rabat, 15 avenue Hassan II', ar: 'الرباط، 15 شارع الحسن الثاني', da: 'الرباط، 15 شارع الحسن الثاني', dz: 'rbat, 15 avenue hassan 2' };
const SLOT: Record<Lang, string> = { en: 'tomorrow at 3pm', fr: 'demain à 15h', ar: 'غدا على الساعة الثالثة بعد الزوال', da: 'غدا مع 3 العشية', dz: 'ghedda m3a 3 l3chiya' };
const YES: Record<Lang, string> = { en: 'yes', fr: 'oui', ar: 'نعم', da: 'واخا', dz: 'wakha' };

export function answerFor(field: Field, lang: Lang, flow: { kind: 'order' | 'book'; item: string }): string {
  switch (field) {
    case 'confirm': return YES[lang];
    case 'phone': return '0612345678';
    case 'name': return NAME[lang];
    case 'address': return ADDRESS[lang];
    case 'slot': return SLOT[lang];
    case 'service': return SERVICE_STORE.services.find(s => s.key === flow.item)?.alias[lang][0] || SLOT[lang];
    case 'product': return STORE.products.find(p => p.key === flow.item)?.alias[lang][0]
      || SERVICE_STORE.services.find(s => s.key === flow.item)?.alias[lang][0] || '';
    case 'size': {
      const p = STORE.products.find(x => x.key === flow.item);
      const v = p?.variants.find(x => x.stock > 0);
      if (!v) return lang === 'dz' ? 'ay haja' : 'M';
      return ({ en: `size ${v.size}, ${v.color}`, fr: `taille ${v.size}, ${v.color}`, ar: `المقاس ${v.size}، ${v.color}`, da: `المقاس ${v.size}، ${v.color}`, dz: `taille ${v.size}, ${v.color}` } as Record<Lang, string>)[lang];
    }
  }
}
