/**
 * Canonical, reusable customer-intent vocabulary.
 *
 * Keep deterministic trigger phrases here instead of scattering them across
 * tenants, CRM rules and workflow code. Tenant intents can map one or more of
 * these use cases to their own workflow through `capabilities.intents[].useCases`.
 */
export const TRIGGER_USE_CASES = ['PURCHASE', 'DEMO', 'BOOKING', 'HUMAN_SUPPORT'] as const;
export type TriggerUseCase = (typeof TRIGGER_USE_CASES)[number];

export interface TriggerLibraryMatch {
  useCase: TriggerUseCase;
  normalizedText: string;
}

export function normalizeTriggerText(input: string): string {
  return (input || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f\u064B-\u065F\u0670]/g, '')
    .replace(/\u0640/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[’']/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const NEGATED_PURCHASE = [
  /(?:^|\s)(?:ma\s+|m)?(?:bghit|baghi|baghya)\s*ch\s+(?:nchri|nshri|ncommandi|nkomandi|ncommander|komandi)(?:\s|$)/u,
  /(?:^|\s)(?:mabghitch|mabaghitch)\s+(?:nchri|nshri|ncommandi|nkomandi|ncommander|komandi)(?:\s|$)/u,
  /(?:^|\s)(?:ما\s*بغيتش|مابغيتش|ما\s*باغيش)\s+(?:نشري|نكوموندي|نكموندي|نطلب)(?:\s|$)/u,
  /(?:^|\s)je\s+ne\s+veux\s+pas\s+(?:acheter|commander)(?:\s|$)/u,
  /(?:^|\s)(?:i\s+)?(?:do\s+not|don\s+t|dont)\s+want\s+to\s+(?:buy|order|purchase)(?:\s|$)/u
];

const ORDER_STATUS = [
  /(?:^|\s)(?:fin|fayn|where|ou)\s+(?:wslat|waslat|is|est)\s+(?:commande|command|order|talab|طلبي|الطلب)(?:\s|$)/u,
  /(?:^|\s)(?:suivi|tracking|track|status|statut)\s+(?:de\s+)?(?:commande|order|talab)(?:\s|$)/u
];

const PATTERNS: Record<TriggerUseCase, RegExp[]> = {
  PURCHASE: [
    /(?:^|\s)(?:ana\s+)?(?:bghit|baghi|baghya|bghina)\s+(?:nchri|nshri|nechri|chri|ncommandi|nkomandi|ncommander|komandi|nkhod)(?:h|ha)?(?:\s|$)/u,
    /(?:^|\s)(?:(?:wach\s+)?(?:n9der|nqder|ne9der)|kifash|kifesh)\s+(?:nchri|nshri|nechri|ncommandi|nkomandi)(?:h|ha)?(?:\s|$)/u,
    /(?:^|\s)(?:bghit|baghi|baghya)\s+(?:chi\s+)?(?:chat\s*bot|chatbot|bot)(?:\s|$)/u,
    /(?:^|\s)(?:بغيت|باغي|باغيه|اريد|اود)\s+(?:نشري|نشتري|نكوموندي|نكموندي|نطلب|ناخد)(?:ه|ها)?(?:\s|$)/u,
    /(?:^|\s)(?:(?:واش\s+)?نقدر|كيفاش|كيفيه)\s+(?:نشري|نشتري|نكوموندي|نكموندي|نطلب|الشراء|الطلب)(?:ه|ها)?(?:\s|$)/u,
    /(?:^|\s)(?:بغيت|باغي|باغيه)\s+(?:شي\s+)?(?:شات\s*بوت|تشات\s*بوت|بوت)(?:\s|$)/u,
    /(?:^|\s)(?:je\s+veux|je\s+voudrais|je\s+vais|j\s+aimerais)\s+(?:acheter|commander|prendre)(?:\s|$)/u,
    /(?:^|\s)(?:comment\s+(?:acheter|commander)|(?:je\s+)?passe(?:r)?\s+commande)(?:\s|$)/u,
    /(?:^|\s)(?:i\s+want\s+to|i\s+would\s+like\s+to|i\s+d\s+like\s+to)\s+(?:buy|order|purchase|get)(?:\s|$)/u,
    /(?:^|\s)(?:how\s+to\s+(?:buy|order)|place\s+(?:an?\s+)?order)(?:\s|$)/u
  ],
  DEMO: [
    /(?:^|\s)(?:bghit|baghi|baghya|n9der|nqder)\s+(?:nakhod\s+|nkhod\s+|ndir\s+|nchof\s+)?(?:demo|dimo)(?:\s|$)/u,
    /(?:^|\s)(?:بغيت|باغي|باغيه|نقدر)\s+(?:ناخد\s+|ندير\s+|نشوف\s+)?(?:ديمو|عرض\s+توضيحي)(?:\s|$)/u,
    /(?:^|\s)(?:je\s+veux|je\s+voudrais)\s+(?:une\s+)?demo(?:\s|$)/u,
    /(?:^|\s)(?:i\s+want|i\s+would\s+like)\s+(?:a\s+)?demo(?:\s|$)/u
  ],
  BOOKING: [
    /(?:^|\s)(?:bghit|baghi|baghya)\s+(?:n7jez|nhjez|n7jz|n9yed|ntsjel|ntsajel|nreserve|rendez\s+vous|rdv|session|seance)(?:\s|$)/u,
    /(?:^|\s)(?:بغيت|باغي|باغيه|اريد|اود)\s+(?:ان\s+)?(?:نحجز|احجز|نسجل|اسجل|حجز|الحجز|التسجيل|موعد|جلسه|سيانس)(?:\s|$)/u,
    /(?:^|\s)(?:je\s+veux|je\s+voudrais|je\s+souhaite|j\s+aimerais)\s+(?:reserver|m\s+inscrire|prendre\s+(?:un\s+)?rendez\s+vous)(?:\s|$)/u,
    /(?:^|\s)(?:i\s+want\s+to|i\s+need\s+to|i\s+would\s+like\s+to)\s+(?:book|reserve|schedule)(?:\s|$)/u
  ],
  HUMAN_SUPPORT: [
    /(?:^|\s)(?:bghit|baghi|baghya)\s+(?:nhder|ntklem)\s+m3a\s+(?:chi\s+)?(?:wa7d|insan|responsable)(?:\s|$)/u,
    /(?:^|\s)(?:بغيت|باغي|باغيه)\s+(?:نهضر|نتكلم)\s+مع\s+(?:شي\s+)?(?:واحد|انسان|مسؤول)(?:\s|$)/u,
    /(?:^|\s)(?:je\s+veux|je\s+voudrais)\s+parler\s+(?:a|avec)\s+(?:un\s+)?(?:agent|conseiller|humain)(?:\s|$)/u,
    /(?:^|\s)(?:i\s+want|i\s+need)\s+to\s+(?:speak|talk)\s+to\s+(?:a\s+)?(?:human|person|agent)(?:\s|$)/u
  ]
};

export class IntentTriggerLibrary {
  static match(input: string): TriggerLibraryMatch[] {
    const normalizedText = normalizeTriggerText(input);
    if (!normalizedText) return [];

    const results: TriggerLibraryMatch[] = [];
    for (const useCase of TRIGGER_USE_CASES) {
      if (useCase === 'PURCHASE') {
        if (NEGATED_PURCHASE.some(pattern => pattern.test(normalizedText))) continue;
        if (ORDER_STATUS.some(pattern => pattern.test(normalizedText))) continue;
      }
      if (PATTERNS[useCase].some(pattern => pattern.test(normalizedText))) {
        results.push({ useCase, normalizedText });
      }
    }
    return results;
  }

  static has(input: string, useCase: TriggerUseCase): boolean {
    return this.match(input).some(match => match.useCase === useCase);
  }
}
