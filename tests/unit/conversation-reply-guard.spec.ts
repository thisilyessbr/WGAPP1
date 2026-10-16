import { describe, expect, it } from 'vitest';
import { ConversationReplyGuard, invitesToFlow, isRepeat, replyOverlap } from '../../src/domain/conversation/ConversationReplyGuard';

const demoFlow: any = { id: 'sales_demo', activation: { mode: 'auto_start', keywords: ['bghit demo', 'demo', 'I want a demo', 'je veux une démo', 'بغيت ديمو'] }, states: {} };

describe('reply guard: no invitation to a flow the customer already completed', () => {
  it.each([
    ['Bghit tchouf demo?', true],
    ['Kteb "bghit demo" w nsawlek 4 as\'ila qsar.', true],
    ['If you\'d like, write "I want a demo" and I\'ll take your details.', true],
    ['Écrivez « je veux une démo » et on organise un rendez-vous.', true],
    ['واش بغيتي ديمو؟', false], // "ديمو" alone is not a configured trigger here
    ['Le prix dépend de votre volume de messages.', false],
    ['Your demo is tomorrow at 14:00.', false]
  ])('%s → %s', (sentence, expected) => expect(invitesToFlow(sentence, demoFlow)).toBe(expected));

  it('keeps the answer and drops only the invitation after the demo was booked', () => {
    const faq = 'Relayqo howa assistant dyal chat l-businesses, kayjaweb zbnayk b darija w fransiya. Bghit tchouf demo? Kteb "bghit demo" w nsawlek 4 as\'ila qsar.';
    const out = ConversationReplyGuard.apply(faq, { source: 'FAQ', language: 'darija', script: 'arabizi', completedWorkflow: demoFlow });
    expect(out).toBe('Relayqo howa assistant dyal chat l-businesses, kayjaweb zbnayk b darija w fransiya.');
  });

  it('drops the sentence that continues the invitation, and keeps the rest', () => {
    // Ending of a real reply after a booked demo.
    const reply = 'Relayqo kayjaweb zbnayk 24/24. Bghit nchouf kifach kaykhdem? Démo fabor w kayakhod 15-20 dqiqa. Ila 3ndek so2al, kteb lia.';
    expect(ConversationReplyGuard.apply(reply, { source: 'FAQ', language: 'darija', script: 'arabizi', completedWorkflow: demoFlow }))
      .toBe('Relayqo kayjaweb zbnayk 24/24. Ila 3ndek so2al, kteb lia.');
  });

  it('does not touch replies while no flow is completed, or messages of the flow itself', () => {
    const cta = 'Bghit tchouf demo? Kteb "bghit demo".';
    expect(ConversationReplyGuard.apply(cta, { source: 'FAQ', language: 'darija', script: 'arabizi' })).toBe(cta);
    expect(ConversationReplyGuard.apply(cta, { source: 'WORKFLOW', language: 'darija', script: 'arabizi', completedWorkflow: demoFlow })).toBe(cta);
  });

  it('asks a clarifying question when the whole reply was an invitation', () => {
    expect(ConversationReplyGuard.apply('Kteb "bghit demo" w nsawlek 4 as\'ila qsar.', { source: 'FAQ', language: 'darija', script: 'arabizi', completedWorkflow: demoFlow }))
      .toBe(ConversationReplyGuard.clarifyingQuestion('darija', 'arabizi'));
  });
});

describe('reply guard: no near-repeat of the previous reply', () => {
  // The two replies to "chnu hadchi" and "chnu" in a real Relayqo conversation (after the guard removed the demo invite).
  const first = 'Relayqo howa assistant dyal chat l-businesses: kayjaweb zbnayk b lma3loumat l-m3tmda dyal l-business dyalek, b darija, 3arabiya, fransiya w english, w kayjme3 talabat l-khadamat wla l-produits bach l-friq ytab3ha. Kaykhdem 3la WhatsApp r-rasmi, w Instagram DM 3la 7sab l-ba9a.';
  const second = 'Relayqo howa assistant dyal chat l business: kayjaweb zbnayk men lma3lomat lmo3tamda dyalek, w kayjme3 talabat lkhadamat wla lproduits bach l\'équipe dyalek ttab3ha. Kaykhdem b darija, 3arabiya, français w anglais, w kayfhem voice f WhatsApp ila kan mfe33el.';
  it('tells a paraphrased repeat from a different answer', () => {
    expect(replyOverlap(first, second)).toBeGreaterThanOrEqual(0.6);
    expect(isRepeat(second, first)).toBe(true);
    // Same sentence, other city and price: new information, not a repeat.
    expect(isRepeat('La livraison vers Rabat coûte 30 MAD et prend 3 jours ouvrables en moyenne.', 'La livraison vers Casablanca coûte 25 MAD et prend 2 jours ouvrables en moyenne.')).toBe(false);
    expect(replyOverlap(first, 'Livraison f 48 sa3a l kol l mdon dyal lmaghrib, w lkhlas 3nd tawsil.')).toBeLessThan(0.3);
  });
  it.each([['darija', 'arabizi', 'Chno bghiti t3ref'], ['fr', 'latin', 'Que voulez-vous savoir'], ['en', 'latin', 'What would you like to know'], ['darija', 'arabic', 'شنو بغيتي تعرف']])(
    'asks what the customer means instead of repeating (%s/%s)', (language, script, start) =>
      expect(ConversationReplyGuard.apply(second, { source: 'FAQ', language, script, previousReply: first })).toContain(start));
  it('lets short replies, catalog answers and flow messages repeat', () => {
    expect(ConversationReplyGuard.apply('Bla jmil! 🙌', { source: 'FALLBACK', language: 'darija', script: 'arabizi', previousReply: 'Bla jmil! 🙌' })).toBe('Bla jmil! 🙌');
    expect(ConversationReplyGuard.apply(second, { source: 'ECOMMERCE', language: 'darija', script: 'arabizi', previousReply: first })).toBe(second);
    expect(ConversationReplyGuard.apply(second, { source: 'WORKFLOW', language: 'darija', script: 'arabizi', previousReply: first })).toBe(second);
  });
});

describe('reply guard: committed workflow invariants', () => {
  it('removes a side-answer CTA and keeps one pending prompt', () => {
    const prompt = 'Chno smitek?';
    const reply = `Relayqo kayjawb 24/24. Kteb bghit demo bach t7jez.\n\n${prompt}\n${prompt}`;
    const guarded = ConversationReplyGuard.apply(reply, {
      source: 'WORKFLOW', language: 'darija', script: 'arabizi',
      workflow: { sideAnswer: true, midWorkflow: true, pendingPrompt: prompt }
    });
    expect(guarded).not.toContain('Kteb bghit demo');
    expect(guarded.split(prompt)).toHaveLength(2);
  });

  it('does not allow an uncommitted booking claim', () => {
    const guarded = ConversationReplyGuard.apply('Your appointment is booked.', {
      source: 'WORKFLOW', language: 'en',
      workflow: { committedOutcome: null }
    });
    expect(guarded).toContain('What would you like to know');
  });
});
