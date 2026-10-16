import { describe, expect, it } from 'vitest';
import { buildConversationContext } from '../../src/domain/conversation/ConversationContext';
import { LanguageDetector } from '../../src/domain/faq/FaqMatcher';

// A Darija (Latin letters) conversation, as in a real Relayqo demo booking.
const history = [
  { role: 'USER', content: 't9dr tchr7 lia chatbot ana intersted', createdAt: new Date(Date.now() - 60000) },
  { role: 'ASSISTANT', content: 'Mar7ba bik! Bach nfhem kifach n9dro n3awnok, chno smitek?', createdAt: new Date(Date.now() - 50000) },
  { role: 'USER', content: 'kanbi3 clothes ou hodies', createdAt: new Date(Date.now() - 40000) }
].reverse(); // most recent first, as stored

const resolve = (text: string) => buildConversationContext({
  tenantId: 't', accountId: 'a', customerId: 'c', conversationId: 'v', language: LanguageDetector.detect(text), accountLanguage: 'darija',
  currentMessageText: text, recentMessages: history, contextData: { _lang: 'darija', _script: 'arabizi' }
});

describe('a short or unknown word never switches the conversation language', () => {
  it.each(['chokrane', 'chokran bzaf', 'chnu', 'chnu hadchi', 'ok', 'merci', 'wakha', '👍', 'ilyassaber671@gmail.com', 'fl3chiya'])('"%s" keeps Darija in Latin letters', text => {
    const ctx = resolve(text);
    expect(ctx.effectiveLanguage).toBe('darija');
    expect(ctx.effectiveScript).toBe('arabizi');
  });
  it.each(['kaynin des messages kat3tlo bzf', 'ma9dertch nrd 3la les clients', 'oui 3ndi boutique en ligne'])('"%s" (French words in Arabizi) stays Darija', text =>
    expect(resolve(text).effectiveLanguage).toBe('darija'));
  it('a real switch is still followed', () => {
    expect(resolve('Bonjour, pouvez-vous m’expliquer le prix de votre service ?').effectiveLanguage).toBe('fr');
    expect(resolve('Hello, can you explain how your pricing works please?').effectiveLanguage).toBe('en');
  });
});
