/**
 * Fictional Moroccan service business (spa / beauty centre) and the questions
 * such businesses receive most on WhatsApp, in English, French, Modern
 * Standard Arabic, Darija in Arabic script and Darija in Latin script.
 * No real customer data. Every expectation is derived from SERVICE_STORE.
 */
import type { Lang } from './moroccanCommerceCorpus';

export interface StoreService {
  key: string; name: string; description: string; price: number; minutes: number;
  alias: Record<Lang, string[]>;
}

export const SERVICE_STORE = {
  name: 'Spa Nakhil Guéliz (fictional)',
  address: '24 Rue de la Liberté, Guéliz, Marrakech',
  hours: 'Mardi au dimanche de 10:00 à 21:00. Fermé le lundi.',
  description: 'Spa et institut de beauté pour femmes à Marrakech : hammam, massages, soins du visage, onglerie, épilation, coiffure et henné.',
  policies: {
    booking: 'Les rendez-vous se demandent par WhatsApp. L\'équipe confirme le créneau par message ; aucun créneau n\'est garanti avant cette confirmation.',
    cancellation: 'Annulation ou report gratuit jusqu\'à 24h avant le rendez-vous. Annulation moins de 24h avant : frais de 50 MAD.',
    payment: 'Paiement sur place en espèces ou par carte bancaire. Pas de paiement en ligne.',
    access: 'Espace réservé aux femmes. Pas de service à domicile. Parking gratuit devant le spa.',
    gifts: 'Cartes cadeaux disponibles à partir de 200 MAD.'
  },
  services: [
    { key: 'hammam', name: 'Hammam traditionnel', description: 'Hammam au savon noir, 45 minutes.', price: 150, minutes: 45,
      alias: { en: ['traditional hammam', 'hammam'], fr: ['hammam traditionnel', 'hammam'], ar: ['الحمام التقليدي', 'الحمام'], da: ['الحمام البلدي', 'الحمام'], dz: ['hammam beldi', 'l7mam'] } },
    { key: 'ritual', name: 'Rituel hammam gommage et enveloppement', description: 'Hammam, gommage au kessa et enveloppement au ghassoul, 75 minutes.', price: 280, minutes: 75,
      alias: { en: ['hammam with scrub and wrap', 'full hammam ritual'], fr: ['rituel hammam gommage', 'hammam avec gommage et enveloppement'], ar: ['الحمام مع التقشير واللف', 'باقة الحمام الكاملة'], da: ['الحمام مع الكسالة والغاسول', 'الحمام كامل بالكسالة'], dz: ['l7mam m3a lkessala w ghassoul', 'hammam complet m3a gommage'] } },
    { key: 'massage', name: 'Massage relaxant', description: 'Massage relaxant aux huiles d\'argan, 60 minutes.', price: 400, minutes: 60,
      alias: { en: ['relaxing massage', 'massage'], fr: ['massage relaxant', 'massage'], ar: ['التدليك المريح', 'المساج'], da: ['المساج ديال الراحة', 'المساج'], dz: ['massage relaxant', 'lmassage'] } },
    { key: 'facial', name: 'Soin du visage hydratant', description: 'Nettoyage et hydratation du visage, 60 minutes.', price: 350, minutes: 60,
      alias: { en: ['hydrating facial', 'facial'], fr: ['soin du visage hydratant', 'soin visage'], ar: ['العناية بالوجه', 'تنظيف البشرة'], da: ['سوان ديال الوجه', 'تنقية الوجه'], dz: ['soin dyal wjeh', 'tn9iya dyal lwejh'] } },
    { key: 'manicure', name: 'Manucure', description: 'Soin des mains et pose de vernis, 40 minutes.', price: 100, minutes: 40,
      alias: { en: ['manicure', 'manicure with polish'], fr: ['manucure', 'manucure avec vernis'], ar: ['المانيكير', 'تجميل أظافر اليدين'], da: ['المانيكير', 'الظفار ديال اليدين'], dz: ['manicure', 'manucure dyal dfar'] } },
    { key: 'pedicure', name: 'Pédicure', description: 'Soin des pieds et pose de vernis, 50 minutes.', price: 160, minutes: 50,
      alias: { en: ['pedicure'], fr: ['pédicure', 'soin des pieds'], ar: ['الباديكير', 'العناية بالقدمين'], da: ['الباديكير', 'الرجلين باديكير'], dz: ['pedicure', 'pédicure dyal rjlin'] } },
    { key: 'waxing', name: 'Épilation jambes complètes', description: 'Épilation à la cire des jambes complètes, 30 minutes.', price: 120, minutes: 30,
      alias: { en: ['full leg waxing', 'leg wax'], fr: ['épilation jambes complètes', 'épilation des jambes'], ar: ['إزالة شعر الساقين بالشمع', 'إزالة الشعر للساقين'], da: ['الحلاوة ديال الرجلين', 'الحلاوة'], dz: ['l7lawa dyal rjlin', 'épilation dyal rjlin'] } },
    { key: 'haircut', name: 'Coupe et brushing', description: 'Coupe femme avec brushing, 60 minutes.', price: 200, minutes: 60,
      alias: { en: ['haircut and blow dry', 'haircut'], fr: ['coupe et brushing', 'coupe brushing'], ar: ['قص الشعر مع التسريح', 'قص الشعر'], da: ['القص والبروشينغ', 'قص الشعر'], dz: ['coupe w brushing', '9ess cha3r'] } },
    { key: 'henna', name: 'Henné des mains', description: 'Henné décoratif sur les deux mains, 45 minutes.', price: 130, minutes: 45,
      alias: { en: ['henna on hands', 'henna'], fr: ['henné des mains', 'henné'], ar: ['نقش الحناء على اليدين', 'الحناء'], da: ['النقشة ديال الحنة', 'الحنة'], dz: ['n9cha dyal l7enna', 'l7enna'] } }
  ] as StoreService[]
};

export const SERVICE_AMOUNTS = new Set<number>([...SERVICE_STORE.services.map(s => s.price), 50, 200]);

export type ServiceTpl = Record<Lang, string[]>;

/** {s} = service alias, {x} = unknown service. */
export const SERVICE_TEMPLATES: Record<string, ServiceTpl> = {
  svcPrice: {
    en: ['How much is the {s}?', 'what is the price of a {s}', 'price for {s}?'],
    fr: ['Combien coûte le {s} ?', "c'est combien le {s}", 'Quel est le prix du {s} ?'],
    ar: ['كم سعر {s}؟', 'ما هو ثمن {s}؟'],
    da: ['شحال ثمن {s}؟', 'بشحال {s}؟', 'شحال كتديرو {s}؟'],
    dz: ['bch7al {s}?', 'ch7al taman dyal {s}', '{s} bch7al?']
  },
  svcDuration: {
    en: ['How long does the {s} take?', 'how much time is the {s}?'],
    fr: ['Le {s} dure combien de temps ?', 'combien de temps pour le {s} ?'],
    ar: ['كم تستغرق مدة {s}؟', 'كم من الوقت يدوم {s}؟'],
    da: ['شحال كياخد {s} ديال الوقت؟', 'شحال كيدوم {s}؟'],
    dz: ['ch7al kayakhod {s} dyal lw9t?', 'ch7al kaydoum {s}?']
  },
  svcExists: {
    en: ['Do you do {s}?', 'do you offer {s}?'],
    fr: ['Vous faites le {s} ?', 'vous proposez {s} ?'],
    ar: ['هل تقدمون {s}؟', 'هل لديكم خدمة {s}؟'],
    da: ['واش كتديرو {s}؟', 'واش عندكم {s}؟'],
    dz: ['wach katdiro {s}?', 'wach 3ndkom {s}?']
  },
  svcUnknown: {
    en: ['Do you do {x}? how much?'], fr: ['Vous faites {x} ? à quel prix ?'], ar: ['هل تقدمون {x}؟ وكم السعر؟'],
    da: ['واش كتديرو {x}؟ بشحال؟'], dz: ['wach katdiro {x}? bch7al?']
  },
  svcHours: {
    en: ['What are your opening hours?', 'what time do you close?'], fr: ["Quels sont vos horaires ?", 'vous fermez à quelle heure ?'],
    ar: ['ما هي أوقات العمل؟'], da: ['شنو هي الأوقات ديالكم؟', 'فوقاش كتسدو؟'], dz: ['fo9ach kat7lo?', 'chno homa les horaires dyalkom?']
  },
  svcMonday: {
    en: ['Are you open on Monday?'], fr: ['Vous êtes ouverts le lundi ?'], ar: ['هل تفتحون يوم الاثنين؟'],
    da: ['واش حالين نهار الاثنين؟'], dz: ['wach m7lolin nhar tnin?', 'nhar letnin khdamin?']
  },
  svcSunday: {
    en: ['Are you open on Sunday?'], fr: ['Vous êtes ouverts le dimanche ?'], ar: ['هل تفتحون يوم الأحد؟'],
    da: ['واش حالين نهار الحد؟'], dz: ['wach m7lolin nhar l7ed?', 'nhar l7ed khdamin?']
  },
  svcLocation: {
    en: ['Where are you located?', 'what is the address of the spa?'], fr: ['Où se trouve le spa ?', "c'est quoi l'adresse ?"],
    ar: ['أين يوجد المركز؟'], da: ['فين جاي السبا؟', 'فين كاينين؟'], dz: ['fin kaynin?', 'fin jay spa?']
  },
  svcCard: {
    en: ['Can I pay by card?'], fr: ['Je peux payer par carte ?'], ar: ['هل يمكن الدفع بالبطاقة البنكية؟'],
    da: ['واش نقدر نخلص بالكارط؟'], dz: ['n9der nkhles b la carte?', 'wach katqblo la carte?']
  },
  svcCash: {
    en: ['Do you accept cash?'], fr: ['Vous acceptez les espèces ?'], ar: ['هل تقبلون الدفع نقدا؟'],
    da: ['واش نقدر نخلص كاش؟'], dz: ['n9der nkhles cash?']
  },
  svcOnline: {
    en: ['Can I pay online in advance?'], fr: ['Je peux payer en ligne à l\'avance ?'], ar: ['هل يمكن الدفع عبر الإنترنت مسبقا؟'],
    da: ['واش نقدر نخلص أونلاين قبل؟'], dz: ['n9der nkhles online 9bel?']
  },
  svcCancel: {
    en: ['What is your cancellation policy?', 'can I cancel my appointment?'], fr: ["Quelle est votre politique d'annulation ?", 'je peux annuler mon rendez-vous ?'],
    ar: ['ما هي سياسة إلغاء الموعد؟'], da: ['واش نقدر نلغي الموعد؟', 'إلا بغيت نبدل الموعد كيفاش؟'], dz: ['n9der nlghi rdv?', 'ila bghit nbdel rdv kifach?']
  },
  svcLateFee: {
    en: ['Is there a fee if I cancel the same day?'], fr: ['Il y a des frais si j\'annule le jour même ?'], ar: ['هل توجد رسوم إذا ألغيت في نفس اليوم؟'],
    da: ['إلا لغيت نفس النهار واش كاين شي خلاص؟'], dz: ['ila lghit nfs nhar wach kayn chi khlas?']
  },
  svcHome: {
    en: ['Do you come to the house?', 'do you offer home service?'], fr: ['Vous vous déplacez à domicile ?'], ar: ['هل تقدمون الخدمة في المنزل؟'],
    da: ['واش كتجيو للدار؟'], dz: ['wach katjiw l dar?', 'kayn service f dar?']
  },
  svcMen: {
    en: ['Can men book too?', 'do you accept men?'], fr: ['Vous acceptez les hommes ?'], ar: ['هل تستقبلون الرجال؟'],
    da: ['واش الرجال يقدرو يجيو؟'], dz: ['wach rjal y9dro yjiw?']
  },
  svcParking: {
    en: ['Is there parking?'], fr: ['Il y a un parking ?'], ar: ['هل يوجد موقف للسيارات؟'],
    da: ['واش كاين فين نحط الطوموبيل؟'], dz: ['kayn parking?', 'fin nparki tomobil?']
  },
  svcGift: {
    en: ['Do you sell gift cards?'], fr: ['Vous avez des cartes cadeaux ?'], ar: ['هل لديكم بطاقات هدايا؟'],
    da: ['واش عندكم كارط كادو؟'], dz: ['3ndkom carte cadeau?']
  },
  svcDiscount: {
    en: ['Do you have any discount?', 'any promotion this month?'], fr: ['Vous avez des promotions ?', 'il y a une remise ?'],
    ar: ['هل يوجد تخفيض؟'], da: ['واش كاين شي تخفيض؟', 'واش كاينة شي بروموسيون؟'], dz: ['kayna chi promo?', 'dir lia chi remise 3afak']
  },
  svcBook: {
    en: ['I want to book a {s}', 'I would like to make an appointment for a {s}'], fr: ['Je veux réserver un {s}', 'je voudrais prendre rendez-vous pour un {s}'],
    ar: ['أريد حجز موعد ل{s}'], da: ['بغيت نحجز {s}', 'بغيت ناخد موعد ل{s}'], dz: ['bghit n7jez {s}', 'bghit rdv l {s}']
  },
  svcSlot: {
    en: ['Do you have a free slot tomorrow at 3pm for a {s}?'], fr: ['Vous avez une place demain à 15h pour un {s} ?'],
    ar: ['هل يوجد موعد فارغ غدا على الساعة الثالثة ل{s}؟'], da: ['واش كاينة بلاصة غدا مع 3 ل{s}؟'], dz: ['kayna blasa ghedda m3a 3 l {s}?']
  },
  svcMulti: {
    en: ['How much is the {s} and how long does it take?'], fr: ['Le {s} coûte combien et dure combien de temps ?'],
    ar: ['كم سعر {s} وكم تستغرق مدته؟'], da: ['شحال {s} وشحال كياخد ديال الوقت؟'], dz: ['bch7al {s} w ch7al kayakhod dyal lw9t?']
  },
  followDuration: {
    en: ['and how long does it take?'], fr: ['et ça dure combien de temps ?'], ar: ['وكم تستغرق؟'],
    da: ['وشحال كياخد ديال الوقت؟'], dz: ['w ch7al kayakhod?']
  },
  followPrice: {
    en: ['ok and how much is it?'], fr: ["d'accord et c'est combien ?"], ar: ['حسنا وكم سعره؟'],
    da: ['واخا وشحال الثمن ديالو؟'], dz: ['wakha w bch7al?']
  },
  human: {
    en: ['I want to talk to a real person'], fr: ['Je veux parler à une conseillère'], ar: ['أريد التحدث مع موظفة'],
    da: ['بغيت نهضر مع شي وحدة من الخدامة'], dz: ['bghit nhder m3a chi wa7ed machi robot', '3tini chi insan nhder m3ah']
  },
  greeting: {
    en: ['Hi', 'Hello, good evening'], fr: ['Bonjour', 'Salut, bonsoir'], ar: ['السلام عليكم', 'مرحبا'],
    da: ['سلام، لاباس؟', 'السلام عليكم ختي'], dz: ['salam', 'slm labas?', 'salam khti']
  }
};

export const UNKNOWN_SERVICES: Record<Lang, string[]> = {
  en: ['botox', 'a tattoo', 'eyelash extensions', 'keratin treatment'], fr: ['du botox', 'un tatouage', 'des extensions de cils', 'un lissage à la kératine'],
  ar: ['البوتوكس', 'الوشم', 'تركيب الرموش', 'علاج الكيراتين'], da: ['البوتوكس', 'الوشم', 'الرموش الصناعية', 'الكيراتين'], dz: ['botox', 'tatouage', 'extension dyal rmouch', 'keratine']
};
