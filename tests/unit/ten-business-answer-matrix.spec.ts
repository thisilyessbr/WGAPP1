import { describe, expect, it, vi } from 'vitest';
import { ConversationEngine } from '../../src/domain/conversation/ConversationEngine';
import { AnswerComposer } from '../../src/domain/conversation/AnswerComposer';
import { GroundedAnswerGuard } from '../../src/domain/conversation/GroundedAnswerGuard';
import { DirectRagGuard } from '../../src/domain/rag/DirectRagGuard';
import { DEFAULT_BUSINESS_CONFIG } from '../../src/domain/tenant/BusinessConfig';
import { ResponseBuilder } from '../../src/domain/conversation/ResponseBuilder';
import { WorkflowEngine } from '../../src/core/engine/WorkflowEngine';
import { WorkflowStateEvaluator } from '../../src/core/engine/WorkflowStateEvaluator';

const businesses = [
  { id: 'clothing', brand: 'Fictional Casa Clothing', mode: 'commerce', offer: 'cotton shirt', price: 149, policy: 'returns', detail: 'Shirts can be returned within 14 days.' },
  { id: 'electronics', brand: 'Fictional Rabat Electronics', mode: 'commerce', offer: 'headphones', price: 390, policy: 'warranty', detail: 'Headphones have a 12 month warranty.' },
  { id: 'salon', brand: 'Fictional Marrakech Salon', mode: 'standard', offer: 'brushing', price: 80, policy: 'payment', detail: 'You can pay by cash or card.' },
  { id: 'restaurant', brand: 'Fictional Tangier Restaurant', mode: 'standard', offer: 'lunch menu', price: 95, policy: 'payment', detail: 'You can pay by cash or card.' },
  { id: 'riad', brand: 'Fictional Fez Riad', mode: 'standard', offer: 'room inquiry', price: 450, policy: 'payment', detail: 'A deposit is paid on arrival.' },
  { id: 'school', brand: 'Fictional Agadir School', mode: 'standard', offer: 'French course', price: 600, policy: 'payment', detail: 'Course fees are paid at registration.' },
  { id: 'garage', brand: 'Fictional Kenitra Garage', mode: 'standard', offer: 'oil change', price: 250, policy: 'payment', detail: 'Payment is due after the repair.' },
  { id: 'property', brand: 'Fictional Casa Property', mode: 'standard', offer: 'viewing request', price: 0, policy: 'payment', detail: 'No payment is required to request a viewing.' },
  { id: 'clinic', brand: 'Fictional Rabat Clinic', mode: 'standard', offer: 'appointment request', price: 0, policy: 'payment', detail: 'Payment details are provided by staff.' },
  { id: 'grocery', brand: 'Fictional Oujda Grocery', mode: 'commerce', offer: 'olive oil', price: 65, policy: 'shipping', detail: 'Delivery takes two days within Oujda.' }
] as const;

function makeEngine(profile: typeof businesses[number], withDocument = false) {
  const config: any = structuredClone(DEFAULT_BUSINESS_CONFIG);
  config.identity.brand = profile.brand;
  config.identity.businessHours = 'Monday to Saturday, 9:00–18:00';
  config.identity.locations = [`Fictional address, ${profile.brand.split(' ')[1]}`];
  config.capabilities.ecommerceEnabled = profile.mode === 'commerce';
  config.capabilities.faq = [{ id: 'hours', category: 'HOURS', question: 'What are your opening hours?', answer: 'We are open Monday to Saturday, 9:00–18:00.', language: 'en' }];
  config.knowledge.enabled = withDocument;
  config.portalFacts = { services: profile.mode === 'standard' ? [{ name: profile.offer, price: profile.price }] : [], policies: { [profile.policy]: profile.detail } };
  const conv: any = { id: profile.id, tenantId: profile.id, accountId: profile.id, customerId: 'fictional-customer', status: 'ACTIVE', version: 0, messageCount: 0, contextData: {} };
  const messages: any[] = [];
  const service: any = {
    getOrCreateConversation: async () => conv,
    getMessageCount: async () => messages.length,
    getAutomationState: async () => null,
    getActiveSession: async () => null,
    getLatestCompletedSession: async () => null,
    countCompletedWorkflowSessions: async () => 0,
    getRecentMessages: async (_t: string, _c: string, n: number) => messages.slice(-n).reverse(),
    commitConversationTurn: async (p: any) => {
      messages.push({ role: 'USER', content: p.userMessage, createdAt: new Date() });
      if (p.assistantMessage) messages.push({ role: 'ASSISTANT', content: p.assistantMessage, createdAt: new Date() });
      if (p.contextData) conv.contextData = p.contextData;
      conv.version++; conv.messageCount++;
      return { success: true };
    }
  };
  const llm: any = { generateResponse: vi.fn(async () => 'UNANSWERABLE'), classifyIntent: vi.fn(async () => null), extractField: vi.fn(async () => null) };
  const rag: any = withDocument ? { retrieve: vi.fn(async () => {
    const content = `${profile.brand} policy guide\n${profile.detail}`;
    return { chunks: [{ id: `${profile.id}-chunk`, documentId: `${profile.id}-document`, content, similarity: 0.92, score: 0.92, documentTitle: `${profile.id}-policy.pdf` }], context: content };
  }) } : undefined;
  const engine = new ConversationEngine(service, { getConfig: async () => config } as any, new WorkflowEngine(new WorkflowStateEvaluator(), llm), llm, new ResponseBuilder(), rag);
  return { engine, llm, config };
}

describe('ten fictional Moroccan business answer matrix', () => {
  it.each(businesses)('$id answers an Arabizi address question from account data without a model call', async profile => {
    const { engine, llm, config } = makeEngine(profile);
    const answer = await engine.handleMessage(profile.id, 'customer', 'fin kaynin 3afak?', profile.id);
    expect(answer).toContain(config.identity.locations[0]);
    expect(llm.generateResponse).not.toHaveBeenCalled();
  });

  it('keeps the configured hours when an address question asks for both facts', async () => {
    const profile = businesses.find(item => item.id === 'property')!;
    const { engine, llm, config } = makeEngine(profile);
    llm.generateResponse.mockResolvedValueOnce(`Kaynin f ${config.identity.locations[0]}.`);
    const answer = await engine.handleMessage(profile.id, 'customer', 'fin kaynin w fach katseddo?', profile.id);
    expect(answer).toContain(config.identity.locations[0]);
    expect(answer).toContain('18:00');
  });

  it.each(businesses)('$id returns the known hours without a model call', async profile => {
    const { engine, llm } = makeEngine(profile);
    const answer = await engine.handleMessage(profile.id, 'customer', 'What are your opening hours?', profile.id);
    expect(answer).toContain('9:00–18:00');
    expect(llm.generateResponse).not.toHaveBeenCalled();
  });

  it.each(businesses)('$id does not turn its unrelated guide into a policy answer', profile => {
    const question = profile.policy === 'returns' ? 'What is the return policy?'
      : profile.policy === 'warranty' ? 'What is the warranty?'
      : profile.policy === 'shipping' ? 'How does delivery work?'
      : 'How can I pay?';
    const unrelated = `${profile.brand} general guide\nThe address is Fictional Street 10.`;
    expect(DirectRagGuard.evaluate(question, unrelated, 'en', 'latin')).toMatchObject({ isSafe: false, reason: 'QUESTION_NOT_ANSWERED' });
  });

  it.each(businesses)('$id guides unsupported requests toward its configured offer', async profile => {
    const { engine, config } = makeEngine(profile);
    const answer = await engine.handleMessage(profile.id, 'customer', 'Do you offer a 90 percent student discount?', profile.id);
    expect(answer).toMatch(/don't have that (?:detail|information)/i);
    expect(answer).not.toMatch(/yes.{0,30}90 percent/i);
    expect(answer).toContain(profile.mode === 'commerce' ? 'products' : 'services');
    expect(AnswerComposer.composeUnknownAnswer({ turnDecision: {} as any, responseLanguage: 'en', responseScript: 'latin', config })).not.toContain('fictional-customer');
  });

  it.each(businesses)('$id keeps the requested language/script for an unanswered question', async profile => {
    const cases = [
      { question: 'Est-ce que vous avez une réduction étudiante de 90% ?', script: 'latin', marker: /(?:Désolé|information|précision|réduction)/iu },
      { question: 'هل لديكم خصم للطلاب؟', script: 'arabic', marker: /[\u0600-\u06FF]/u },
      { question: 'واش عندكم تخفيض للطلبة؟', script: 'arabic', marker: /[\u0600-\u06FF]/u },
      { question: 'wach 3ndkom reduction l talaba?', script: 'arabizi', marker: /(?:smeh|n9der|lme3louma)/iu }
    ] as const;
    for (const item of cases) {
      const { engine } = makeEngine(profile);
      const answer = await engine.handleMessage(profile.id, `customer-${item.script}-${item.question.length}`, item.question, profile.id);
      expect(answer).toMatch(item.marker);
      expect(/[\u0600-\u06FF]/u.test(answer)).toBe(item.script === 'arabic');
    }
  });

  it.each(businesses)('$id rejects an invented price and false confirmation', profile => {
    const evidence = `Service: ${profile.offer}; price: ${profile.price} MAD. ${profile.detail}`;
    expect(GroundedAnswerGuard.evaluate(`The price is ${profile.price + 77} MAD.`, evidence).safe).toBe(false);
    expect(GroundedAnswerGuard.evaluate('Your appointment is confirmed.', evidence).safe).toBe(false);
  });

  it.each(businesses)('$id answers a published policy document without leaking its heading', async profile => {
    const { engine, llm } = makeEngine(profile, true);
    const question = profile.policy === 'returns' ? 'What is your return policy?'
      : profile.policy === 'warranty' ? 'What is your warranty?'
      : profile.policy === 'shipping' ? 'How does delivery work?'
      : 'How can I pay?';
    const reply = await engine.handleMessage(profile.id, 'customer', question, profile.id);
    expect(reply).toContain(profile.detail);
    expect(reply).not.toContain('policy guide');
    expect(llm.generateResponse).not.toHaveBeenCalled();
  });
});
