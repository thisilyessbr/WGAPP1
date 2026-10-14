/**
 * 10,000 fictional Moroccan WhatsApp conversations across four chatbot
 * profiles (2,500 each): e-commerce with an order workflow, e-commerce without
 * workflows, a service business with a booking workflow, and a service business
 * without workflows. Single questions, follow-ups and complete multi-turn
 * order/booking flows (driven by an adaptive simulated customer) in English,
 * French, Modern Standard Arabic, Darija (Arabic script) and Arabizi.
 */
import { CITIES, LANGS, Lang, STORE, T, UNKNOWN_ITEMS, fill } from './moroccanCommerceCorpus';
import { SERVICE_STORE, SERVICE_TEMPLATES, UNKNOWN_SERVICES } from './moroccanServiceCorpus';

export type Profile = 'ecom_wf' | 'ecom_nowf' | 'svc_wf' | 'svc_nowf';
export const PROFILES: Profile[] = ['ecom_wf', 'ecom_nowf', 'svc_wf', 'svc_nowf'];

export interface FlowSpec {
  kind: 'order' | 'book';
  item: string;
  /** Asked right after the bot's first workflow question, then the flow resumes. */
  interrupt?: { text: string; expect: any };
  cancelText?: string;
}

export interface Case10k { id: string; profile: Profile; intent: string; lang: Lang; turns: string[]; expect: any; flow?: FlowSpec }

const PER_PROFILE = 2500;

function rng(seed: number) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

const PREFIX: Record<Lang, string[]> = {
  en: ['', '', 'Hi, ', 'Hello! ', 'hey '], fr: ['', '', 'Bonjour, ', 'Salut ', 'Bonsoir, '],
  ar: ['', '', 'السلام عليكم، ', 'مرحبا، '], da: ['', '', 'سلام، ', 'السلام عليكم، ', 'سلام خويا، '], dz: ['', '', 'salam ', 'slm ', 'salam khouya ', 'salam alikom ']
};
const SUFFIX: Record<Lang, string[]> = {
  en: ['', '', ' please', ' thanks', ' pls'], fr: ['', '', ' svp', ' merci', " s'il vous plaît"],
  ar: ['', '', ' من فضلك', ' شكرا'], da: ['', '', ' عافاك', ' الله يخليك', ' شكرا'], dz: ['', '', ' 3afak', ' lah ykhalik', ' merci', ' mrc']
};

/** Realistic surface variety: greetings, politeness, casual casing/punctuation. */
function decorate(text: string, lang: Lang, r: () => number): string {
  const pick = <X>(xs: X[]) => xs[Math.floor(r() * xs.length)];
  let core = text;
  const suffix = pick(SUFFIX[lang]);
  if (suffix) core = core.replace(/\s*([?？؟])?\s*$/u, (_m, q) => `${suffix}${q ?? ''}`);
  if ((lang === 'dz' || lang === 'fr' || lang === 'en') && r() < 0.35) core = core.toLowerCase().replace(/\s*[?？]\s*$/u, r() < 0.5 ? '' : ' ?');
  const prefix = pick(PREFIX[lang]);
  return prefix ? prefix + core.charAt(0).toLowerCase() + core.slice(1) : core;
}

const FOLLOW: Record<string, Record<Lang, string[]>> = {
  fee: { en: ['and how much is delivery to {c}?'], fr: ['et la livraison à {c} ?'], ar: ['وكم ثمن التوصيل إلى {c}؟'], da: ['وشحال التوصيل ل{c}؟'], dz: ['w livraison l {c} bch7al?'] },
  variant: { en: ['do you have it in size {s}?'], fr: ["vous l'avez en taille {s} ?"], ar: ['هل يوجد بمقاس {s}؟'], da: ['واش كاين ف المقاس {s}؟'], dz: ['wach kayn f {s}?'] }
};
const CANCEL: Record<Lang, string[]> = {
  en: ["actually cancel it, I don't want it anymore"], fr: ["non finalement j'annule"], ar: ['أريد إلغاء الطلب'],
  da: ['صافي ما بغيتش، لغي'], dz: ['safi ma bghitch, annuler']
};
const ORDER_DETAILS: Record<Lang, string> = {
  en: 'My name is Salma Bennani, 15 Avenue Hassan II Rabat, 0612345678',
  fr: "Je m'appelle Salma Bennani, 15 avenue Hassan II Rabat, 0612345678",
  ar: 'اسمي سلمى بناني، 15 شارع الحسن الثاني الرباط، 0612345678',
  da: 'سميتي سلمى بناني، 15 شارع الحسن الثاني الرباط، 0612345678',
  dz: 'smiti salma bennani, 15 avenue hassan 2 rbat, 0612345678'
};

type Gen = (lang: Lang, push: (turns: string[], expect: any, flow?: FlowSpec) => void) => void;

const products = STORE.products;
const orderable = products.filter(p => p.variants.length && p.stock > 0);

function commerceGenerators(): Record<string, Gen> {
  const g: Record<string, Gen> = {};
  const each = (intent: string, f: (tpl: string, lang: Lang, push: any) => void): Gen => (lang, push) => { for (const tpl of T[intent][lang]) f(tpl, lang, push); };
  g.price = each('price', (tpl, lang, push) => { for (const p of products) for (const a of p.alias[lang]) push([fill(tpl, { p: a })], { kind: 'price', product: p.key }); });
  g.available = each('available', (tpl, lang, push) => { for (const p of products) for (const a of p.alias[lang]) push([fill(tpl, { p: a })], { kind: 'available', product: p.key, expected: p.stock > 0 }); });
  g.variant = each('variant', (tpl, lang, push) => {
    for (const p of products) for (const a of p.alias[lang]) for (const size of [...new Set(p.variants.map(x => x.size))]) {
      const stock = p.variants.filter(x => x.size === size).reduce((s, x) => s + x.stock, 0);
      push([fill(tpl, { p: a, s: size })], { kind: 'variant', product: p.key, expected: stock > 0 });
    }
  });
  g.photo = each('photo', (tpl, lang, push) => { for (const p of products.filter(x => x.image)) for (const a of p.alias[lang]) push([fill(tpl, { p: a })], { kind: 'photo', product: p.key }); });
  g.followupPhoto = (lang, push) => { for (const tpl of T.followupPhoto[lang]) for (const p of products.filter(x => x.image)) for (const a of p.alias[lang]) push([fill(T.price[lang][0], { p: a }), tpl], { kind: 'photo', product: p.key }); };
  g.followupFee = (lang, push) => { for (const p of products) for (const a of p.alias[lang]) for (const c of CITIES) push([fill(T.price[lang][0], { p: a }), fill(FOLLOW.fee[lang][0], { c: c.names[lang] })], { kind: 'fee', casa: c.casa }); };
  g.followupVariant = (lang, push) => {
    for (const p of products.filter(x => x.variants.length)) for (const a of p.alias[lang]) for (const size of [...new Set(p.variants.map(x => x.size))]) {
      const stock = p.variants.filter(x => x.size === size).reduce((s, x) => s + x.stock, 0);
      push([fill(T.price[lang][0], { p: a }), fill(FOLLOW.variant[lang][0], { s: size })], { kind: 'variant', product: p.key, expected: stock > 0 });
    }
  };
  for (const k of ['fee', 'time'] as const) g[k] = each(k, (tpl, lang, push) => { for (const c of CITIES) push([fill(tpl, { c: c.names[lang] })], { kind: k, casa: c.casa }); });
  for (const k of ['cod', 'card', 'exchange', 'refund', 'free', 'location', 'hours', 'sunday', 'discount', 'tracking', 'human', 'greeting']) g[k] = each(k, (tpl, _l, push) => push([tpl], { kind: k }));
  g.unknown = each('unknown', (tpl, lang, push) => { for (const x of UNKNOWN_ITEMS[lang]) push([fill(tpl, { x })], { kind: 'unknown' }); });
  g.multi = each('multi', (tpl, lang, push) => { for (const p of products) for (const a of p.alias[lang]) for (const c of CITIES) push([fill(tpl, { p: a, c: c.names[lang] })], { kind: 'multi', product: p.key, casa: c.casa }); });
  g.quality = each('quality', (tpl, lang, push) => { for (const p of products) for (const a of p.alias[lang]) push([fill(tpl, { p: a })], { kind: 'quality', product: p.key }); });
  g.order = each('order', (tpl, lang, push) => { for (const p of products.filter(x => x.stock > 0)) for (const a of p.alias[lang]) push([fill(tpl, { p: a })], { kind: 'order', product: p.key }); });
  g.orderNoWf = each('order', (tpl, lang, push) => { for (const p of products.filter(x => x.stock > 0)) for (const a of p.alias[lang]) push([fill(tpl, { p: a })], { kind: 'orderNoWf', product: p.key }); });
  g.orderDetailsNoWf = each('order', (tpl, lang, push) => { for (const p of orderable) for (const a of p.alias[lang]) push([fill(tpl, { p: a }), ORDER_DETAILS[lang]], { kind: 'orderDetailsNoWf', product: p.key }); });
  g.flowOrder = each('order', (tpl, lang, push) => { for (const p of orderable) for (const a of p.alias[lang]) push([fill(tpl, { p: a })], { kind: 'flow' }, { kind: 'order', item: p.key }); });
  g.flowOrderInterrupt = each('order', (tpl, lang, push) => {
    for (const p of orderable) for (const a of p.alias[lang]) for (const c of CITIES.slice(0, 4)) {
      push([fill(tpl, { p: a })], { kind: 'flow' }, { kind: 'order', item: p.key, interrupt: { text: fill(T.fee[lang][T.fee[lang].length - 1], { c: c.names[lang] }), expect: { kind: 'fee', casa: c.casa } } });
    }
  });
  g.flowOrderCancel = each('order', (tpl, lang, push) => { for (const p of orderable) for (const a of p.alias[lang]) push([fill(tpl, { p: a })], { kind: 'flow' }, { kind: 'order', item: p.key, cancelText: CANCEL[lang][0] }); });
  return g;
}

function serviceGenerators(): Record<string, Gen> {
  const S = SERVICE_TEMPLATES, services = SERVICE_STORE.services;
  const g: Record<string, Gen> = {};
  const perService = (intent: string, kind: string, tplKey = intent): Gen => (lang, push) => {
    for (const tpl of S[tplKey][lang]) for (const s of services) for (const a of s.alias[lang]) push([fill(tpl, { s: a })], { kind, service: s.key });
  };
  g.svcPrice = perService('svcPrice', 'svcPrice');
  g.svcDuration = perService('svcDuration', 'svcDuration');
  g.svcExists = perService('svcExists', 'svcExists');
  g.svcMulti = perService('svcMulti', 'svcMulti');
  g.svcSlot = perService('svcSlot', 'svcSlot');
  g.svcBook = perService('svcBook', 'svcBook');
  g.svcBookNoWf = perService('svcBookNoWf', 'svcBookNoWf', 'svcBook');
  g.svcUnknown = (lang, push) => { for (const tpl of S.svcUnknown[lang]) for (const x of UNKNOWN_SERVICES[lang]) push([fill(tpl, { x })], { kind: 'svcUnknown' }); };
  for (const k of ['svcHours', 'svcMonday', 'svcSunday', 'svcLocation', 'svcCard', 'svcCash', 'svcOnline', 'svcCancel', 'svcLateFee', 'svcHome', 'svcMen', 'svcParking', 'svcGift', 'svcDiscount', 'human', 'greeting']) {
    g[k] = (lang, push) => { for (const tpl of S[k][lang]) push([tpl], { kind: k }); };
  }
  g.svcFollowDuration = (lang, push) => { for (const s of services) for (const a of s.alias[lang]) push([fill(S.svcPrice[lang][0], { s: a }), S.followDuration[lang][0]], { kind: 'svcDuration', service: s.key }); };
  g.svcFollowPrice = (lang, push) => { for (const s of services) for (const a of s.alias[lang]) push([fill(S.svcDuration[lang][0], { s: a }), S.followPrice[lang][0]], { kind: 'svcPrice', service: s.key }); };
  g.flowBook = (lang, push) => { for (const tpl of S.svcBook[lang]) for (const s of services) for (const a of s.alias[lang]) push([fill(tpl, { s: a })], { kind: 'flow' }, { kind: 'book', item: s.key }); };
  g.flowBookInterrupt = (lang, push) => {
    for (const tpl of S.svcBook[lang]) for (const s of services) for (const a of s.alias[lang]) for (const other of services.filter(o => o.key !== s.key).slice(0, 3)) {
      push([fill(tpl, { s: a })], { kind: 'flow' }, { kind: 'book', item: s.key, interrupt: { text: fill(S.svcPrice[lang][1] || S.svcPrice[lang][0], { s: other.alias[lang][0] }), expect: { kind: 'svcPrice', service: other.key } } });
    }
  };
  g.flowBookCancel = (lang, push) => { for (const tpl of S.svcBook[lang]) for (const s of services) for (const a of s.alias[lang]) push([fill(tpl, { s: a })], { kind: 'flow' }, { kind: 'book', item: s.key, cancelText: CANCEL[lang][0].replace(/الطلب/u, 'الموعد') }); };
  return g;
}

const ECOM_BASE: Record<string, number> = {
  price: 260, available: 150, variant: 160, photo: 190, followupPhoto: 80, followupFee: 70, followupVariant: 70, fee: 140, time: 80,
  cod: 90, card: 45, exchange: 80, refund: 45, free: 45, location: 55, hours: 60, sunday: 40, discount: 60, unknown: 70,
  tracking: 45, human: 45, greeting: 45, multi: 110, quality: 30
};
export const QUOTAS: Record<Profile, Record<string, number>> = {
  ecom_wf: { ...ECOM_BASE, order: 100, flowOrder: 170, flowOrderInterrupt: 80, flowOrderCancel: 60 },
  ecom_nowf: { ...ECOM_BASE, orderNoWf: 170, orderDetailsNoWf: 120 },
  svc_wf: {
    svcPrice: 330, svcDuration: 200, svcExists: 110, svcUnknown: 110, svcHours: 90, svcMonday: 70, svcSunday: 55, svcLocation: 80,
    svcCard: 65, svcCash: 45, svcOnline: 45, svcCancel: 85, svcLateFee: 55, svcHome: 55, svcMen: 55, svcParking: 45, svcGift: 45,
    svcDiscount: 70, svcSlot: 70, human: 55, greeting: 55, svcMulti: 140, svcFollowDuration: 110, svcFollowPrice: 60,
    svcBook: 100, flowBook: 180, flowBookInterrupt: 80, flowBookCancel: 60
  },
  svc_nowf: {
    svcPrice: 340, svcDuration: 210, svcExists: 120, svcUnknown: 115, svcHours: 95, svcMonday: 75, svcSunday: 60, svcLocation: 85,
    svcCard: 70, svcCash: 50, svcOnline: 50, svcCancel: 90, svcLateFee: 60, svcHome: 60, svcMen: 60, svcParking: 50, svcGift: 50,
    svcDiscount: 75, svcSlot: 90, human: 60, greeting: 60, svcMulti: 150, svcFollowDuration: 120, svcFollowPrice: 65, svcBookNoWf: 180
  }
};

function normalize(quota: Record<string, number>, total: number): Record<string, number> {
  const sum = Object.values(quota).reduce((a, b) => a + b, 0);
  const out = Object.fromEntries(Object.entries(quota).map(([k, v]) => [k, Math.floor(v * total / sum)]));
  let rest = total - Object.values(out).reduce((a, b) => a + b, 0);
  for (const k of Object.keys(out).sort((a, b) => quota[b] - quota[a])) { if (rest-- <= 0) break; out[k]++; }
  return out;
}

export function build10kCorpus(): Case10k[] {
  const out: Case10k[] = [];
  const gens = { ...commerceGenerators(), ...serviceGenerators() };
  const undecorated = new Set(['greeting', 'human']);
  for (const profile of PROFILES) {
    const quotas = normalize(QUOTAS[profile], PER_PROFILE);
    let n = 0;
    for (const [intent, quota] of Object.entries(quotas)) {
      const r = rng(intent.length * 7919 + profile.length * 104729 + intent.charCodeAt(0));
      const byLang: Record<Lang, Omit<Case10k, 'id' | 'profile' | 'intent'>[]> = { en: [], fr: [], ar: [], da: [], dz: [] };
      for (const lang of LANGS) gens[intent](lang, (turns, expect, flow) => byLang[lang].push({ lang, turns, expect, flow }));
      for (const lang of LANGS) for (let i = byLang[lang].length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [byLang[lang][i], byLang[lang][j]] = [byLang[lang][j], byLang[lang][i]]; }
      for (let i = 0; i < quota; i++) {
        const lang = LANGS[i % LANGS.length];
        const pool = byLang[lang];
        const base = pool[Math.floor(i / LANGS.length) % pool.length];
        const round = Math.floor(Math.floor(i / LANGS.length) / pool.length);
        // Repeats of a small pool differ in their decoration, never verbatim.
        const turns = base.turns.map((t, k) => k === 0 && !undecorated.has(intent) && (round > 0 || r() < 0.6) ? decorate(t, lang, r) : t);
        out.push({ id: `${profile}-${String(++n).padStart(4, '0')}-${intent}-${lang}`, profile, intent, lang, turns, expect: base.expect, flow: base.flow });
      }
    }
  }
  return out;
}
