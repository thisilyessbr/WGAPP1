/** Render uncertainty without letting the model attach a speculative price/offer.
 * The phrase must come from this customer's message, never from another account
 * or a retrieved title. Normal grounded answers remain unchanged.
 */
export function resolveGroundedAnswer(raw: string, question: string, language: string, script?: string): string {
  const text=(raw || '').trim();
  if (text.startsWith('{') || text.startsWith('```')) {
    try {
      const parsed=JSON.parse(text.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''));
      if (parsed.status==='answer') return typeof parsed.answer==='string' && parsed.answer.trim() ? parsed.answer.trim() : 'UNANSWERABLE';
      if (parsed.status==='unanswerable') return 'UNANSWERABLE';
      if (!['clarify','unconfirmed'].includes(parsed.status) || typeof parsed.phrase!=='string') return 'UNANSWERABLE';
      return resolveGroundedAnswer(`${parsed.status.toUpperCase()}|${parsed.phrase}`,question,language,script);
    } catch {return 'UNANSWERABLE';}
  }
  const match=/^(CLARIFY|UNCONFIRMED)\s*\|\s*([^\n]+)/u.exec(text);
  if (!match) return /^(?:CLARIFY|UNCONFIRMED)\b/u.test(text) ? 'UNANSWERABLE' : text;
  const phrase=match[2].trim();
  if (!phrase || phrase.length>160 || !question.toLocaleLowerCase().includes(phrase.toLocaleLowerCase())) return 'UNANSWERABLE';
  if (match[1]==='CLARIFY') {
    if (language==='fr') return `Que voulez-vous dire par « ${phrase} » ?`;
    if (language==='ar') return `ما الذي تقصده بعبارة «${phrase}»؟`;
    if (language==='darija' && script==='arabizi') return `Chno kat9sed b "${phrase}"? Momkin twdd7 liya?`;
    if (language==='darija') return `شنو كتعني بـ «${phrase}»؟ ممكن توضح ليا؟`;
    return `What do you mean by “${phrase}”?`;
  }
  if (language==='fr') return `Je ne peux pas confirmer « ${phrase} » avec les informations disponibles. Notre équipe peut vérifier avec vous ici.`;
  if (language==='ar') return `لا أستطيع تأكيد «${phrase}» بالمعلومات المتوفرة. يمكن لفريقنا التحقق معك هنا.`;
  if (language==='darija' && script==='arabizi') return `Ma n9drch n2ekked "${phrase}" b lma3lomat li 3ndi. L-equipe t9der t2ekked m3ak hna.`;
  if (language==='darija') return `ما نقدرش نأكد «${phrase}» بالمعلومات اللي عندي. الفريق يقدر يتأكد معاك هنا.`;
  return `I cannot confirm “${phrase}” from the available information. Our team can check with you here.`;
}
