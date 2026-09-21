const boundedPatterns = new WeakMap<RegExp, RegExp>();

const darijaAliases: Record<string, string> = {
  salaam: 'salam', ssalam: 'salam', slm: 'salam',
  tawssil: 'tawsil', nreje3: 'nrje3', wslat: 'wsl',
  nkhelles: 'n5les', nkhlles: 'n5les', lmagasin: 'magasin',
  nhdar: 'nhder', wa7d: 'wahed', 'نهدر': 'نهضر'
};
const stretchableDarijaWords = new Set(['bghit', 'bghiti', 'bghina', 'baghi', 'baghya', 'salam', 'wach', 'chhal', 'بغيت', 'باغي', 'باغية', 'واش', 'شحال', 'سلام']);

/** Normalize known language forms without lowercasing or rewriting product names/SKUs. */
export function normalizeIntentText(text: string): string {
  return text.normalize('NFKC').replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[\p{L}\p{N}]+/gu, token => {
      const lower = token.toLowerCase();
      if (darijaAliases[lower]) return darijaAliases[lower];
      const unstretched = lower.replace(/(\p{L})\1{2,}/gu, '$1');
      return lower !== unstretched && stretchableDarijaWords.has(unstretched) ? unstretched : token;
    });
}

/** Latin words must not match inside names (code/COD, spaceship/ship).
 * Arabic clitics retain the existing matching behavior. */
export function matchesPolicyPhrase(text: string, pattern: RegExp): boolean {
  let bounded = boundedPatterns.get(pattern);
  if (!bounded) {
    bounded = new RegExp(`(?<![\\p{Script=Latin}\\p{N}_])(?:${pattern.source})(?![\\p{Script=Latin}\\p{N}_])`, pattern.flags.replace(/[gy]/g, ''));
    boundedPatterns.set(pattern, bounded);
  }
  return bounded.test(text);
}

/** Conservative action guard; negated requests must never authorize state changes. */
export function isActionNegated(text: string, action: 'purchase' | 'handoff'): boolean {
  const normalized = normalizeIntentText(text);
  const actionWords = action === 'purchase'
    ? '(?:buy|order|purchase|checkout|acheter|commander|prendre|(?:nchri|nechri|nshri|ncommandi|nkomandi|nkhod|nakhod)(?:h|ha)?|شراء|الشراء|اشتري|أشتري|نشري|نطلب|نكوموندي|نكموندي|ناخد|ناخذ)'
    : '(?:transfer|connect|talk|speak|human|agent|person|parler|transf[eé]rer|humain|conseiller|nhder|nhdr|nhedar|ndwi|نهضر|ندوي|تحويل|حولني|موظف|إنسان|انسان|شخص)';
  const negative = '(?:do\\s+not|don[’\x27]?t|doesn[’\x27]?t|not|never|no|ne|pas|sans|لا|لن|ليس|ماشي|ما\\s*بغيت\\s*ش|ما\\s*باغي(?:ش|اش)|ma\\s*bghit\\s*(?:ch|sh)|ma\\s*bagh[yi]a?(?:ch|sh)|machi|manbghich)';
  // Negation of a return request must not negate a purchase in a later "but" clause.
  const clauses = normalized.split(/[.!?;؟،]|\s+(?:but|however|mais|walakin|ولكن|لكن)\s+/iu).map(s => s.trim()).filter(Boolean);
  const deniedAction = new RegExp(`(?:^|[^\\p{L}\\p{N}])${negative}(?:\\s+[\\p{L}\\p{N}’\x27-]+){0,6}\\s+${actionWords}(?=$|[^\\p{Script=Latin}\\p{N}])`, 'iu');
  if (clauses.some(clause => deniedAction.test(clause))) return true;
  // A final explicit correction ("... ? la mabghitch") withdraws the earlier request.
  const last = clauses.at(-1) || '';
  return clauses.length > 1 && new RegExp(actionWords, 'iu').test(clauses.slice(0, -1).join(' ')) &&
    /^(?:(?:la|لا|no|non)\s*)?(?:ma\s*bghit\s*(?:ch|sh)|ما\s*بغيت\s*ش)(?:\s+(?:daba|دابا))?$/iu.test(last);
}
