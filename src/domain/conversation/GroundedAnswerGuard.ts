// JS \b only sees ASCII word characters: after "درهم" or before "€" it never
// matches. Unicode letter lookarounds give the same boundary for every script.
const NUMBER = String.raw`\d{1,3}(?:[,\u00a0\u202f]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?`;
const CURRENCY = String.raw`(?:mad|dhs?|dirhams?|drahm|drahem|eur(?:os?)?|usd|درهم|دراهم|€|\$)`;
const MONEY_AFTER = new RegExp(String.raw`(?<![\p{L}\p{N}.,])(${NUMBER})\s*${CURRENCY}(?![\p{L}])`, 'giu');
const MONEY_BEFORE = new RegExp(String.raw`(?<![\p{L}])${CURRENCY}\s*(${NUMBER})(?![\p{N}])`, 'giu');
const ANY_NUMBER = new RegExp(String.raw`(?<![\p{N}.,])(?:${NUMBER})(?![\p{N}])`, 'gu');

const HOURS_QUESTION = /\b(?:hours?|open\w*|clos\w*|horaires?|ferme\w*|ouvr\w*|ouvert\w*|katseddo|katsedou|katsdo|katsdou|katsedo|kat7lo|kat7lou|kat7ello|kat7elou|kathllo|kathlo|wqt|wa9t|lwe9t|lw9t|l7oraire|l'horaire|loraire)\b|ساعات العمل|اوقات العمل|أوقات العمل|كتسدو|كتحلو|تفتح|تغلق|الوقت|وقتاش|فوقاش/iu;

const DISCOUNT_WORD = String.raw`(?:off|discount|reduction|réduction|remise|promo(?:tion)?|soldes?|rabais|tkhfid|takhfid|تخفيض|خصم|تخفيضات|بروموسيون)`;
const PERCENT = String.raw`(\d+(?:[.,]\d+)?)\s*%|%\s*(\d+(?:[.,]\d+)?)`;
const DISCOUNT_CLAIMS = [
  new RegExp(String.raw`(?:${PERCENT})\s*(?:de\s+|d['’]\s*|ديال\s+)?${DISCOUNT_WORD}(?![\p{L}])`, 'giu'),
  new RegExp(String.raw`(?<![\p{L}])${DISCOUNT_WORD}[:\s]*(?:de\s+|of\s+|ديال\s+|b\s+|ب\s*)?(?:${PERCENT})`, 'giu'),
  new RegExp(String.raw`(?<![\p{L}\p{N}])[-−–]\s*(\d+(?:[.,]\d+)?)\s*%`, 'giu')
];

const FALSE_ACTION = [
  /(?:\b(?:your|the)\s+(?:booking|appointment|order)\s+(?:is|has been)\s+confirmed\b|\b(?:i|we)\s+(?:have|already)\s+(?:booked|placed|cancelled|refunded)\b|(?:votre|la)\s+(?:réservation|commande|rendez-vous)\s+(?:est|a été)\s+confirmé|(?:تم|لقد)\s+(?:تأكيد|حجز|إلغاء)\s+(?:طلبك|موعدك|حجزك))/iu,
  // French past participle without the auxiliary: "Réservation confirmée !"
  /(?<![\p{L}])(?:réservation|reservation|commande|rendez-vous|rdv)\s+(?:bien\s+)?(?:confirmée?|enregistrée?|validée?)(?![\p{L}])/iu,
  // Darija in Arabic script, in either word order. "الفرقة تأكد ليك الموعد"
  // (the team will confirm your appointment) is a next step, not a claim.
  /(?<![\p{L}])(?<!(?:الفرقة|الفريق|فريقنا|الفرقة\s+ديالنا|الفريق\s+ديالنا|الإدارة|المسؤولة?|غادي|غا|باش|حتى|ملي|منين|و?نقدرو|تقدر|يقدر)\s+)(?:راه\s+)?(?:تم\s+)?(?:تأكد|تاكد|تأكدات|تاكدات|تسجل|تسجلات|تسجيل|تأكيد|تاكيد)\s+(?:ليك\s+)?(?:ال)?(?:حجز|طلب|موعد|رونديفو|كوموند)(?:ك|كم)?(?![\p{L}])/u,
  /(?<![\p{L}])(?:ال)?(?:حجز|طلب|موعد|رونديفو|كوموند)\s+(?:ديالك|ديالكم)\s+(?:راه\s+|را\s+)?(?:تأكد|تاكد|تأكدات|تاكدات|تسجل|تسجلات|مأكد|مسجل)(?![\p{L}])/u,
  // Arabizi, also in either word order. "bach t2akkad" (in order to confirm)
  // is an instruction, not a completed action.
  /(?<!\b(?:bach|bash|ila|bghiti|t9der|tqder|khass|khassek)\s+)\b(?:ra\s+)?(?:tconfirma|tconfirmat|t2akkad|t2akad|ta2akad|t2akkadat|tsjjel|tsjel|tsajjel|tsajel|tsejjel|tsjjlat)\b.{0,30}\b(?:l?7ajz|l?hajz|l?reservation|rdv|l?commande|l?talab|l?maw3id)\b/iu,
  /\b(?:l?7ajz|l?hajz|l?reservation|rdv|l?commande|l?talab|l?maw3id)\b.{0,30}\b(?:ra\s+)?(?:tconfirma|tconfirmat|t2akkad|t2akad|ta2akad|t2akkadat|tsjjel|tsjel|tsajjel|tsajel|tsejjel|tsjjlat)\b/iu
];

// "Once your order is confirmed, you receive the tracking number" describes a
// future step (often straight from the merchant's FAQ); it claims no action.
const CONDITIONAL_LEAD = /(?:\b(?:once|after|when|as\s+soon\s+as|if|until|après(?:\s+la)?|dès\s+que|une\s+fois(?:\s+que)?|quand|lorsque|si|ila|mli|melli|mnin|ba3d|ghir\s+ma)\b|بعد|ملي|منين|عند|إذا|اذا|إلا|الا|حتى)[^.!?\n]{0,40}$/iu;

/** Checks claims that must be supported by current, account-scoped evidence. */
export class GroundedAnswerGuard {
  /** True when the answer states a booking/order action as already done. */
  static claimsCompletedAction(answer: string): boolean {
    for (const pattern of FALSE_ACTION) {
      const global = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
      for (const match of answer.matchAll(global)) {
        const lead = answer.slice(Math.max(0, (match.index ?? 0) - 60), match.index ?? 0);
        if (!CONDITIONAL_LEAD.test(lead)) return true;
      }
    }
    return false;
  }

  /** Parses "1 200,50", "1,200", "80" or "80.5" to a number. */
  static parseAmount(raw: string): number {
    const compact = raw.replace(/[\u00a0\u202f]/g, '');
    const decimal = compact.match(/[.,](\d{1,2})$/);
    const integerPart = decimal ? compact.slice(0, -decimal[0].length) : compact;
    const value = Number(integerPart.replace(/[.,]/g, '') + (decimal ? `.${decimal[1]}` : ''));
    return value;
  }

  static moneyClaims(text: string): Array<{ value: number; index: number }> {
    const claims = [
      ...Array.from(text.matchAll(MONEY_AFTER)),
      ...Array.from(text.matchAll(MONEY_BEFORE))
    ].map(match => ({ value: this.parseAmount(match[1]), index: match.index ?? 0 }));
    return claims.filter(claim => Number.isFinite(claim.value)).sort((a, b) => a.index - b.index);
  }

  /** Normalizes 9:00, 09:00, 9h, 9h00, 9H30 and 6pm to "H:MM". */
  static extractTimes(text: string): string[] {
    const times: string[] = [];
    const pattern = /(?<![\p{N}:.,])(\d{1,2})(?:\s*[:hH](\d{2})(?!\p{N})|\s*[hH](?![\p{L}\p{N}])|\s*([ap])\.?m\.?(?![\p{L}]))(?:\s*([ap])\.?m\.?(?![\p{L}]))?/giu;
    for (const match of text.matchAll(pattern)) {
      let hour = Number(match[1]);
      const minutes = match[2] ?? '00';
      const meridiem = (match[3] || match[4] || '').toLowerCase();
      if (meridiem === 'p' && hour < 12) hour += 12;
      if (meridiem === 'a' && hour === 12) hour = 0;
      if (hour > 24 || Number(minutes) > 59) continue;
      times.push(`${hour}:${minutes}`);
    }
    return times;
  }

  static isHoursQuestion(question: string): boolean {
    return HOURS_QUESTION.test(question);
  }

  private static percentValues(text: string, patterns: RegExp[]): number[] {
    const values: number[] = [];
    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern)) {
        const raw = match.slice(1).find(group => group !== undefined);
        if (raw) values.push(Number(raw.replace(',', '.')));
      }
    }
    return values;
  }

  static evaluate(answer: string, evidence: string, context?: { question?: string; services?: unknown; businessHours?: string }): { safe: boolean; reason?: 'UNSUPPORTED_PRICE' | 'CONFLICTING_PRICE' | 'CONFLICTING_HOURS' | 'UNSUPPORTED_DISCOUNT' | 'FALSE_ACTION' } {
    // A generated text reply cannot perform a booking or order action. The
    // workflow engine, rather than the language model, owns those transitions.
    if (this.claimsCompletedAction(answer)) {
      return { safe: false, reason: 'FALSE_ACTION' };
    }

    const moneyClaims = this.moneyClaims(answer);
    const question = context?.question?.toLocaleLowerCase() || '';
    if (/\b(?:discount|reduction|réduction|remise|promo(?:tion)?)\b|تخفيض|خصم/iu.test(question)
      && !/\b(?:discount|reduction|réduction|remise|promo(?:tion)?)\b|تخفيض|خصم/iu.test(evidence)
      && !/\b(?:listed|specified|mentioned|documented|renseigné|indiqué)\b/iu.test(answer)
      && /\b(?:we|they|i)\s+(?:do\s+not|don't|does\s+not|doesn't)\s+offer\b.{0,35}\b(?:discounts?|reduction|promotion)\b|\bno\s+(?:student\s+)?discounts?\b|\b(?:aucune|pas\s+de)\s+(?:réduction|remise)\b|لا\s+نقدم\s+خصم/iu.test(answer)) {
      return { safe: false, reason: 'UNSUPPORTED_DISCOUNT' };
    }
    // An invented positive offer ("20% off", "-20%", "تخفيض 20%") is as
    // harmful as an invented price: only percentages present in evidence pass.
    const claimedDiscounts = this.percentValues(answer, DISCOUNT_CLAIMS);
    if (claimedDiscounts.length > 0) {
      const supportedPercents = new Set(this.percentValues(evidence, [new RegExp(PERCENT, 'gu')]));
      if (claimedDiscounts.some(value => !supportedPercents.has(value))) {
        return { safe: false, reason: 'UNSUPPORTED_DISCOUNT' };
      }
    }

    const matchedServices = Array.isArray(context?.services)
      ? context.services.filter((service: any) => typeof service?.name === 'string' && question.includes(service.name.toLocaleLowerCase())) as Array<{ name: string; price?: string | number }>
      : [];
    if (matchedServices.length === 1 && moneyClaims.length > 0) {
      const rawPrice = matchedServices[0].price;
      const priceText = typeof rawPrice === 'number' ? String(rawPrice) : (String(rawPrice ?? '').match(new RegExp(NUMBER, 'u'))?.[0] || '');
      const authoritativePrice = priceText ? this.parseAmount(priceText) : NaN;
      if (Number.isFinite(authoritativePrice)) {
        // A reply may list several services; judge the amount stated for the
        // asked-about service, not every amount in the reply.
        const nameAt = answer.toLocaleLowerCase().indexOf(matchedServices[0].name.toLocaleLowerCase());
        const statedForService = nameAt >= 0
          ? moneyClaims.find(claim => claim.index >= nameAt && claim.index - nameAt <= matchedServices[0].name.length + 60)
          : undefined;
        const conflicts = statedForService
          ? statedForService.value !== authoritativePrice
          : !moneyClaims.some(claim => claim.value === authoritativePrice);
        if (conflicts) return { safe: false, reason: 'CONFLICTING_PRICE' };
      }
    }

    if (context?.businessHours && this.isHoursQuestion(question)) {
      const authorizedTimes = new Set(this.extractTimes(context.businessHours));
      if (authorizedTimes.size > 0 && this.extractTimes(answer).some(time => !authorizedTimes.has(time))) {
        return { safe: false, reason: 'CONFLICTING_HOURS' };
      }
    }
    if (moneyClaims.length > 0) {
      const supportedNumbers = new Set(Array.from(evidence.matchAll(ANY_NUMBER), match => this.parseAmount(match[0])));
      if (moneyClaims.some(claim => !supportedNumbers.has(claim.value))) {
        return { safe: false, reason: 'UNSUPPORTED_PRICE' };
      }
    }
    return { safe: true };
  }
}
