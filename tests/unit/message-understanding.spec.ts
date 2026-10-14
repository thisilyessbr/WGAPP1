import { describe, expect, it, vi } from 'vitest';
import { MessageUnderstanding, phraseKey } from '../../src/domain/understanding/MessageUnderstanding';
import { MemoryLearnedPhraseStore, matchLearnedPhrase, isActivePhrase } from '../../src/domain/understanding/LearnedPhraseStore';

const items = [
  { id: 'waxing', name: 'Épilation jambes complètes' },
  { id: 'henna', name: 'Henné des mains' }
];
const llmReturning = (raw: string) => ({ generateResponse: vi.fn(async () => raw) }) as any;

describe('MessageUnderstanding', () => {
  it('maps Darija wording onto the business item and keeps the exact mention', async () => {
    const llm = llmReturning(JSON.stringify({ item: 'waxing', mention: 'l7lawa dyal rjlin', fr: "Combien coûte l'épilation des jambes ?" }));
    const result = await MessageUnderstanding.understand(llm, 'salam bch7al l7lawa dyal rjlin?', items);
    expect(result).toEqual({ itemId: 'waxing', mention: 'l7lawa dyal rjlin', rewrite: "Combien coûte l'épilation des jambes ?" });
  });

  it('never trusts an item that is not in the business list', async () => {
    const llm = llmReturning(JSON.stringify({ item: 'botox', mention: 'botox', fr: 'Vous faites du botox ?' }));
    const result = await MessageUnderstanding.understand(llm, 'wach katdiro botox?', items);
    expect(result?.itemId).toBeNull();
    // Kept for the owner's review ("customers ask for botox"), never used as a match.
    expect(result?.mention).toBe('botox');
  });

  it('does not learn a mention that is not in the customer message', async () => {
    const llm = llmReturning(JSON.stringify({ item: 'henna', mention: 'henné décoratif', fr: 'Combien coûte le henné ?' }));
    const result = await MessageUnderstanding.understand(llm, 'bch7al l7enna?', items);
    expect(result?.itemId).toBe('henna');
    expect(result?.mention).toBeNull();
  });

  it('keeps deterministic routing when the model output is unusable', async () => {
    expect(await MessageUnderstanding.understand(llmReturning('not json'), 'bch7al l7enna?', items)).toBeNull();
    const failing = { generateResponse: vi.fn(async () => { throw new Error('timeout'); }) } as any;
    expect(await MessageUnderstanding.understand(failing, 'bch7al l7enna?', items)).toBeNull();
  });

  it('sends the item list and message as data, bounded in size', async () => {
    const llm = llmReturning('{"item":null,"mention":null,"fr":"x"}');
    const many = Array.from({ length: 200 }, (_, i) => ({ id: String(i), name: 'x'.repeat(500) }));
    await MessageUnderstanding.understand(llm, 'y'.repeat(2000), many);
    const payload = JSON.parse(llm.generateResponse.mock.calls[0][1][0].content);
    expect(payload.items).toHaveLength(MessageUnderstanding.MAX_ITEMS);
    expect(payload.items[0].name.length).toBeLessThanOrEqual(160);
    expect(payload.message.length).toBeLessThanOrEqual(500);
  });
});

describe('learned customer wording', () => {
  it('is used on the fast path only after two consistent resolutions', async () => {
    const store = new MemoryLearnedPhraseStore();
    await store.record('t', 'a', { kind: 'service', mention: 'l7lawa dyal rjlin', itemKey: 'waxing', itemLabel: 'Épilation' });
    let phrases = await store.list('t', 'a', 'service');
    expect(isActivePhrase(phrases[0])).toBe(false);
    expect(matchLearnedPhrase('bch7al l7lawa dyal rjlin?', phrases, 'service')).toBeNull();
    await store.record('t', 'a', { kind: 'service', mention: 'L7lawa dyal rjlin', itemKey: 'waxing', itemLabel: 'Épilation' });
    phrases = await store.list('t', 'a', 'service');
    expect(matchLearnedPhrase('salam bch7al l7lawa dyal rjlin 3afak', phrases, 'service')?.itemKey).toBe('waxing');
  });

  it('restarts the count when the model resolves the phrase differently', async () => {
    const store = new MemoryLearnedPhraseStore();
    await store.record('t', 'a', { kind: 'service', mention: 'l7lawa', itemKey: 'waxing', itemLabel: 'Épilation' });
    await store.record('t', 'a', { kind: 'service', mention: 'l7lawa', itemKey: 'henna', itemLabel: 'Henné' });
    const [row] = await store.list('t', 'a', 'service');
    expect(row).toMatchObject({ itemKey: 'henna', hits: 1 });
    expect(isActivePhrase(row)).toBe(false);
  });

  it('follows the business owner: rejected wording is never used or re-learned, corrections win', async () => {
    const store = new MemoryLearnedPhraseStore();
    await store.record('t', 'a', { kind: 'product', mention: 'sbardila', itemKey: 'babouche', itemLabel: 'Babouches' });
    const [row] = await store.list('t', 'a');
    await store.setStatus('t', 'a', row.id!, 'APPROVED', 'sneakers', 'Baskets Rif Runner');
    expect(matchLearnedPhrase('bch7al sbardila?', await store.list('t', 'a'), 'product')?.itemKey).toBe('sneakers');
    // The model later resolving it to something else does not override the owner.
    await store.record('t', 'a', { kind: 'product', mention: 'sbardila', itemKey: 'babouche', itemLabel: 'Babouches' });
    expect(matchLearnedPhrase('bch7al sbardila?', await store.list('t', 'a'), 'product')?.itemKey).toBe('sneakers');
    await store.setStatus('t', 'a', row.id!, 'REJECTED');
    await store.record('t', 'a', { kind: 'product', mention: 'sbardila', itemKey: 'sneakers', itemLabel: 'Baskets' });
    await store.record('t', 'a', { kind: 'product', mention: 'sbardila', itemKey: 'sneakers', itemLabel: 'Baskets' });
    expect(matchLearnedPhrase('bch7al sbardila?', await store.list('t', 'a'), 'product')).toBeNull();
  });

  it('keeps unmatched wording for the owner without ever using it, until the owner says what it means', async () => {
    const store = new MemoryLearnedPhraseStore();
    for (let i = 0; i < 3; i++) await store.record('t', 'a', { kind: 'product', mention: 'lmaryoul', itemKey: '', itemLabel: '' });
    let [row] = await store.list('t', 'a');
    expect(row).toMatchObject({ itemKey: '', hits: 3, status: 'AUTO' });
    expect(matchLearnedPhrase('sift lia tswira dyal lmaryoul', [row], 'product')).toBeNull();
    // A later model match replaces "unmatched"; a later unmatched sighting never erases a match.
    await store.record('t', 'a', { kind: 'product', mention: 'lmaryoul', itemKey: 'tshirt', itemLabel: 'T-shirt' });
    await store.record('t', 'a', { kind: 'product', mention: 'lmaryoul', itemKey: '', itemLabel: '' });
    [row] = await store.list('t', 'a');
    expect(row).toMatchObject({ itemKey: 'tshirt', hits: 1 });
    await store.setStatus('t', 'a', row.id!, 'APPROVED');
    expect(matchLearnedPhrase('sift lia tswira dyal lmaryoul', await store.list('t', 'a'), 'product')?.itemKey).toBe('tshirt');
  });

  it('keeps each business separate and matches whole words only', async () => {
    const store = new MemoryLearnedPhraseStore();
    for (let i = 0; i < 2; i++) await store.record('t', 'a', { kind: 'product', mention: 'sac', itemKey: 'bag', itemLabel: 'Sac' });
    expect(matchLearnedPhrase('bch7al sac?', await store.list('t', 'other'), 'product')).toBeNull();
    expect(matchLearnedPhrase('bch7al sacoche?', await store.list('t', 'a'), 'product')).toBeNull();
    expect(phraseKey('L’abaya  Salma!')).toBe(phraseKey("l'abaya salma"));
  });
});
