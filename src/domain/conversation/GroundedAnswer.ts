/** Render uncertainty without letting the model attach a speculative price/offer.
 * The phrase must come from this customer's message, never from another account
 * or a retrieved title. Normal grounded answers remain unchanged.
 */
export function resolveGroundedAnswer(raw: string, question: string, language: string, script?: string): string {
  const text=(raw || '').trim();
  if (text.startsWith('{') || text.startsWith('```')) {
    try {
      const body=text.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
      let parsed: any;
      // Models occasionally drop the final brace after a complete answer string.
      try { parsed=JSON.parse(body); } catch (error) { if (!/"\s*$/.test(body)) throw error; parsed=JSON.parse(`${body}}`); }
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
  // Quoting the whole question back ("what do you mean by 'and how long?'") is not a clarification.
  const bare=(value: string) => value.replace(/[sp{P}]+/gu,'').toLocaleLowerCase();
  if (bare(phrase).length >= bare(question).length*0.8) return 'UNANSWERABLE';
  if (match[1]==='CLARIFY') {
    if (language==='fr') return `Que voulez-vous dire par « ${phrase} » ?`;
    if (language==='ar') return `ما الذي تقصده بعبارة «${phrase}»؟`;
    if (language==='darija' && script==='arabizi') return `Chno kat9sed b "${phrase}"? Momkin twdd7 liya?`;
    if (language==='darija') return `شنو كتعني بـ «${phrase}»؟ ممكن توضح ليا؟`;
    return `What do you mean by “${phrase}”?`;
  }
if (language==='fr') return `Je ne trouve pas « ${phrase} » dans notre liste. Notre équipe peut vous le confirmer ici.`;
  if (language==='ar') return `لم أجد «${phrase}» ضمن قائمتنا. يمكن لفريقنا تأكيد ذلك لك هنا.`;
  if (language==='darija' && script==='arabizi') return `Ma l9itch "${phrase}" f la liste dyalna. Lfari9 dyalna y9der y2ekked lik hna.`;
  if (language==='darija') return `ما لقيتش «${phrase}» فاللائحة ديالنا. الفريق ديالنا يقدر يأكد ليك هنا.`;
  return `I can't find “${phrase}” in our list. Our team can confirm it for you here.`;
}
