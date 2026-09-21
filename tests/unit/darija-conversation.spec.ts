import { describe, expect, it, vi } from 'vitest';
import { LanguageDetector } from '../../src/domain/faq/FaqMatcher';
import { EcommerceIntentParser } from '../../src/domain/ecommerce/EcommerceIntent';
import { HandoffService } from '../../src/domain/conversation/HandoffService';
import { TurnDecisionResolver } from '../../src/domain/conversation/TurnDecision';
import { AnswerComposer } from '../../src/domain/conversation/AnswerComposer';
import { ConversationEngine } from '../../src/domain/conversation/ConversationEngine';
import { buildConversationContext } from '../../src/domain/conversation/ConversationContext';
import { DEFAULT_BUSINESS_CONFIG } from '../../src/domain/tenant/BusinessConfig';
import { ResponseBuilder } from '../../src/domain/conversation/ResponseBuilder';
import { CRMService } from '../../src/domain/crm/CRMService';
import { WorkflowEngine, WorkflowCancellationDetector } from '../../src/core/engine/WorkflowEngine';
import { PolicyEvidenceReuse } from '../../src/domain/rag/PolicyEvidenceReuse';

const product = { selectedProductId: 'p1', selectedSku: 'SKU-1' };

describe('Darija language and spelling', () => {
  it.each([
    'salam', 'salaam', 'slm', 'wach kayn?', 'wash kayn?', 'ch7al taman?',
    'bch7al hada?', 'bghit nchri hada', 'baghi nchri hada', 'baghya ncommandi',
    'mabghitch nchri', 'makaynch stock?', '3afak la livraison l casa ch7al?',
    'بغيت نشري هادا', 'باغية نشري', 'مابغيتش نشريه', 'واش كاين التوصيل؟',
    'شْحَالْ الثمن؟', 'بغيييت نشري هادا', 'واش livraison gratuite؟'
  ])('recognizes Darija: %s', text => expect(LanguageDetector.detect(text)).toBe('darija'));

  it.each([
    ['bghiiit nchri hada', 'BUY_INTENT'], ['بغيييت نشري هادا', 'BUY_INTENT'],
    ['بْغِيت نْشْرِي هادا', 'BUY_INTENT'], ['bghit nchrih', 'BUY_INTENT'],
    ['bghit nshri hada', 'BUY_INTENT'], ['baghya ncommandi', 'BUY_INTENT'],
    ['ch7al taman?', 'PRICE'], ['بشحال هادا؟', 'PRICE'],
    ['wach kayn?', 'AVAILABILITY'], ['واش كاين؟', 'AVAILABILITY'],
    ['wrini chi hoodies', 'PRODUCT_SEARCH'], ['بغيت شي سباط', 'PRODUCT_SEARCH']
  ])('routes a shopping request: %s', (text, expected) => {
    expect(EcommerceIntentParser.parse(text, product, 'darija').intent).toBe(expected);
  });

  it.each([
    'ma bghitch nchri hada', 'mabghitch nchri hada', 'ma bghit ch nchri hada',
    'ma bghitch nchrih', 'mabghitch nkhod hadchi', 'machi baghi nchri hada',
    'ما بغيتش نشري هادا', 'مابغيتش نشريه', 'ما باغيش نشري', 'ما باغياش نشري',
    'ما بغيتش ناخد هادشي', 'ما بغيتش نكموندي', 'بغيت نشري؟ لا ما بغيتش',
    'bghit nchri? la mabghitch'
  ])('does not convert a refused purchase into a sale: %s', async text => {
    const decision = TurnDecisionResolver.resolve({ text, productContext: product });
    expect(decision.intent).not.toBe('BUY_INTENT');
    const upsert = vi.fn();
    await new CRMService({ lead: { upsert } } as any).processTurnSignal({ tenantId: 't', accountId: 'a', customerId: 'c', turnDecision: decision, userMessage: text });
    expect(upsert).not.toHaveBeenCalled();
  });
});

describe('Darija policy and handoff routes', () => {
  it.each([
    ['ch7al livraison l casa?', 'SHIPPING'], ['واش كتوصلو لكازا؟', 'SHIPPING'],
    ['ch7al tawssil?', 'SHIPPING'], ['katwsslo l rabat?', 'SHIPPING'],
    ['bghit nrje3 hadchi', 'RETURNS'], ['bghit nreje3 hadchi', 'RETURNS'],
    ['بغيت نرجع هادشي', 'RETURNS'], ['wach n9der nbdel hada?', 'RETURNS'],
    ['fin wslat commande dyali?', 'TRACKING'], ['فين وصلات الكوموند ديالي؟', 'TRACKING'],
    ['wach kayn daman?', 'WARRANTY'], ['واش كاين ضمان؟', 'WARRANTY'],
    ['kifach nkhelles?', 'PAYMENT'], ['كيفاش نخلص؟', 'PAYMENT'],
    ['kifach nghsel hada?', 'CARE'], ['كيفاش نغسل هادا؟', 'CARE'],
    ['fin kayn lmagasin?', 'STORE_INFO'], ['فين كاين المحل؟', 'STORE_INFO']
  ])('recognizes the policy request: %s', (text, expected) => {
    expect(TurnDecisionResolver.detectPolicySignals(text).matchedCategories).toContain(expected);
  });
  it.each([
    'bghit nhder m3a chi agent', 'bghit nhdar m3a chi wa7d',
    'bghit ndwi m3a chi wahed', 'dwez lia chi responsable',
    'بغيت نهضر مع شي موظف', 'بغيت نهدر مع شي واحد',
    'بغيت نهضر مع مول المحل', 'دوزني لشي مسؤول'
  ])('recognizes an explicit human request: %s', text => expect(HandoffService.isHandoffRequested(text)).toBe(true));
  it.each([
    'ma bghitch nhder m3a agent', 'mabghitch ndwi m3a chi wahed',
    'ma bghit ch nhder m3a agent', 'machi baghi nhder m3a agent',
    'ما بغيتش نهضر مع شي موظف', 'مابغيتش نهدر مع شي واحد',
    'بغيت نهضر مع شي موظف؟ لا ما بغيتش', 'bghit nhder m3a agent? la mabghitch'
  ])('does not hand off a refused request: %s', text => expect(HandoffService.isHandoffRequested(text)).toBe(false));
  it.each([
    'wach kayn agent nettoyant?', 'شنو ثمن هاد المنتوج؟', 'bghit nchri hoodie',
    'fin wslat commande dyali?', 'ما بغيتش نرجع هادشي ولكن بغيت نشري هادا'
  ])('does not mistake ordinary shopping for a handoff: %s', text => expect(HandoffService.isHandoffRequested(text)).toBe(false));
});

describe('Darija response script and conversation continuity', () => {
  it.each(['arabic', 'arabizi'] as const)('uses %s for every canned reply', responseScript => {
    const context: any = { responseLanguage: 'darija', responseScript, config: structuredClone(DEFAULT_BUSINESS_CONFIG), turnDecision: { domain: 'GENERAL', intent: 'GENERAL_CONVERSATION', responseLanguage: 'darija', responseScript } };
    for (const method of ['composeGreeting', 'composeHandoff', 'composeFallback'] as const) {
      const reply = AnswerComposer[method](context);
      expect(reply.trim().length).toBeGreaterThan(5);
      expect(/[\u0600-\u06ff]/.test(reply), `${method}: ${reply}`).toBe(responseScript === 'arabic');
    }
  });

  it.each(['42', 'M', 'ok', 'نعم', 'لا'])('keeps Darija for an ambiguous follow-up: %s', currentMessageText => {
    const context = buildConversationContext({ tenantId: 't', customerId: 'c', conversationId: 'v', language: LanguageDetector.detect(currentMessageText), currentMessageText,
      recentMessages: [{ role: 'USER', content: 'بغيت نشري هادشي', createdAt: new Date() }] } as any);
    expect(context.effectiveLanguage).toBe('darija');
    expect((context as any).effectiveScript).toBe('arabic');
  });
});

function fixture(ecommerce?: any) {
  const config: any = structuredClone(DEFAULT_BUSINESS_CONFIG);
  config.identity.language = 'darija'; config.knowledge.enabled = false;
  config.capabilities = { intents: [], ecommerceEnabled: false, faq: [] };
  const conversation: any = { id: 'v', tenantId: 't', customerId: 'c', accountId: 'a', status: 'ACTIVE', version: 0, messageCount: 0, contextData: {} };
  const history: any[] = [];
  const service: any = { getOrCreateConversation: async () => conversation, getAutomationState: async () => null, getMessageCount: async () => history.length,
    getActiveSession: async () => null, getRecentMessages: async () => [...history].reverse().slice(0, 4), getLatestCompletedSession: async () => null,
    findExistingTurnResponse: async () => null, commitConversationTurn: vi.fn(async (p: any) => {
      history.push({ role: 'USER', content: p.userMessage, createdAt: new Date() }, { role: 'ASSISTANT', content: p.assistantMessage, createdAt: new Date() });
      conversation.version++; conversation.messageCount++; if (p.contextData) conversation.contextData = p.contextData;
      return { success: true };
    }) };
  const llm: any = { classifyIntent: vi.fn(async () => null), generateResponse: vi.fn(async () => 'UNANSWERABLE') };
  const engine = new ConversationEngine(service, { getConfig: async () => config } as any, new WorkflowEngine({ evaluateNextState: async () => null } as any), llm, new ResponseBuilder(), undefined, undefined, undefined, undefined, ecommerce);
  return { engine, config, service, llm, conversation };
}

describe('Darija full engine regression', () => {
  it.each(['salam', 'salaam', 'slm', 'سلام', 'السلام عليكم'])('greets naturally: %s', async text => {
    const { engine } = fixture(); const reply = await engine.handleMessage('t', 'c', text, 'a');
    expect(reply.toLowerCase()).toMatch(/salam|سلام/);
    expect(/[\u0600-\u06ff]/.test(reply)).toBe(/[\u0600-\u06ff]/.test(text));
  });
  it.each(['bghit nhder m3a chi agent', 'بغيت نهضر مع شي موظف'])('acknowledges handoff in the same script: %s', async text => {
    const { engine, service } = fixture(); const reply = await engine.handleMessage('t', 'c', text, 'a');
    expect(/[\u0600-\u06ff]/.test(reply)).toBe(/[\u0600-\u06ff]/.test(text));
    expect(service.commitConversationTurn.mock.calls[0][0]).toMatchObject({ newStatus: 'HANDOFF_REQUESTED', responseType: 'HANDOFF' });
  });
  it.each(['بغيت نسولك على شي حاجة', 'bghit nswlk 3la chi haja'])('keeps writing style through short replies: %s', async first => {
    const { engine } = fixture(); await engine.handleMessage('t', 'c', first, 'a');
    const reply = await engine.handleMessage('t', 'c', '42', 'a');
    expect(/[\u0600-\u06ff]/.test(reply)).toBe(/[\u0600-\u06ff]/.test(first));
  });
  it.each(['بغيت نصيفط وثيقة', 'bghit nsift document'])('handles unsupported attachments in the same script: %s', async text => {
    const { engine } = fixture(); const reply = await engine.handleMessage('t', 'c', { text, unsupportedMediaType: 'document' }, 'a');
    expect(/[\u0600-\u06ff]/.test(reply)).toBe(/[\u0600-\u06ff]/.test(text));
  });
  it.each(['بغيت نورّيك هاد التصويرة', 'bghit nwerik had tswira'])('uses the same script when images are disabled: %s', async text => {
    const { engine, llm } = fixture(); const reply = await engine.handleMessage('t', 'c', { text, imageBase64: 'AQID', mimeType: 'image/png' }, 'a');
    expect(/[\u0600-\u06ff]/.test(reply)).toBe(/[\u0600-\u06ff]/.test(text));
    expect(llm.generateResponse).not.toHaveBeenCalled();
  });
  it.each(['بغيت نسولك', 'bghit nswlk'])('keeps the same script at the conversation limit: %s', async text => {
    const { engine, conversation } = fixture(); conversation.messageCount = 501;
    const reply = await engine.handleMessage('t', 'c', text, 'a');
    expect(/[\u0600-\u06ff]/.test(reply)).toBe(/[\u0600-\u06ff]/.test(text));
  });
  it.each(['بغيت نسولك على شي حاجة أخرى', 'bghit nswlk 3la chi haja okhra'])('keeps the same script after a completed workflow: %s', async text => {
    const { engine, service } = fixture(); service.getLatestCompletedSession = async () => ({ id: 'done', workflowId: 'done', status: 'COMPLETED', collectedData: {} });
    const reply = await engine.handleMessage('t', 'c', text, 'a');
    expect(/[\u0600-\u06ff]/.test(reply)).toBe(/[\u0600-\u06ff]/.test(text));
  });
});

describe('Darija workflow confirmations and prompts', () => {
  const workflow: any = { id: 'w', initialState: 'confirm', states: { confirm: { type: 'confirm', next: 'done' }, done: { type: 'end' } } };
  const session: any = { id: 's', tenantId: 't', conversationId: 'v', stateId: 'confirm', workflowId: 'w', contextData: { _started: true, name: 'Ilyes' }, collectedData: { name: 'Ilyes' }, stateHistory: [] };
  it.each(['ih', 'iyeh', 'wakha!', 'واخا!', 'إيه', 'اه'])('accepts an explicit confirmation: %s', async text => {
    const script = /[\u0600-\u06ff]/.test(text) ? 'arabic' : 'arabizi';
    const result = await new WorkflowEngine({ evaluateNextState: async () => null } as any).process(structuredClone(session), text, workflow, structuredClone(DEFAULT_BUSINESS_CONFIG), undefined, undefined, undefined, undefined, 'darija', script);
    expect(result.isComplete).toBe(true);
    expect(result.nextStateId).toBe('done');
    expect(/[\u0600-\u06ff]/.test(result.response)).toBe(script === 'arabic');
  });
  it.each(['ma bghitch', 'mabghitch', 'ma bghit ch', 'ما بغيتش', 'مابغيتش'])('cancels a refused active workflow: %s', async text => {
    expect(WorkflowCancellationDetector.isCancellation(text)).toBe(true);
    const { engine, config, service } = fixture(); config.workflows = { w: workflow }; service.getActiveSession = async () => structuredClone(session);
    const reply = await engine.handleMessage('t', 'c', text, 'a');
    expect(service.commitConversationTurn.mock.calls[0][0].sessionUpdate.status).toBe('CANCELLED');
    expect(/[\u0600-\u06ff]/.test(reply)).toBe(/[\u0600-\u06ff]/.test(text));
  });
  it.each(['wakha walakin bdel l3onwan', 'واخا ولكن بدل العنوان', 'ma n2ekkedch'])('does not confirm an ambiguous or qualified reply: %s', async text => {
    const result = await new WorkflowEngine({ evaluateNextState: async () => null } as any).process(structuredClone(session), text, workflow, structuredClone(DEFAULT_BUSINESS_CONFIG), undefined, undefined, undefined, undefined, 'darija', 'arabizi');
    expect(result.isComplete).toBe(false);
    expect(result.nextStateId).toBe('confirm');
  });
  it.each(['arabic', 'arabizi'])('renders field, choice and confirmation prompts in %s', script => {
    const builder = new ResponseBuilder(); const config = structuredClone(DEFAULT_BUSINESS_CONFIG);
    const responses = [builder.buildMissingFieldResponse({ type: 'collect', field: { name: 'name', type: 'string' } } as any, config, 'darija', script),
      builder.buildConfirmationResponse({ name: 'Ilyes' }, config, undefined, 'darija', script), builder.buildChoiceResponse({ type: 'choice', options: [{ id: '1', label: 'M' }] } as any, 'darija', script)];
    for (const response of responses) expect(/[\u0600-\u06ff]/.test(response)).toBe(script === 'arabic');
  });
  it('respects an explicit script-specific business prompt', () => {
    const builder = new ResponseBuilder(); const config = structuredClone(DEFAULT_BUSINESS_CONFIG);
    const state: any = { type: 'collect', field: { name: 'name', type: 'string' }, prompt: { darija_arabic: 'عفاك عطيني سميتك', darija_arabizi: '3afak 3tini smitek' } };
    expect(builder.buildMissingFieldResponse(state, config, 'darija', 'arabic')).toBe(state.prompt.darija_arabic);
    expect(builder.buildMissingFieldResponse(state, config, 'darija', 'arabizi')).toBe(state.prompt.darija_arabizi);
  });
});

describe('Darija factual policy answers', () => {
  it.each([
    ['PAYMENT', 'كيفاش نخلص؟', 'تقدر تخلص عند الاستلام.'],
    ['RETURNS', 'بغيت نبدل هادا', 'تقدر تبدل السلعة إلا بقات جديدة.'],
    ['TRACKING', 'فين وصلات الكوموند؟', 'غادي نصيفطو ليك رابط التتبع.'],
    ['CARE', 'كيفاش نغسل هادا؟', 'غسلها بالماء البارد.'],
    ['STORE_INFO', 'وقتاش كتحلو؟', 'المحل كيتحل مع التسعود دالصباح.']
  ])('accepts Arabic-script Darija evidence for %s', (intent, query, factualContent) => {
    expect(PolicyEvidenceReuse.isSufficient(intent, query, [{ factualContent } as any], DEFAULT_BUSINESS_CONFIG).isSufficient).toBe(true);
  });
  it.each(['ch7al livraison lfransa?', 'واش كتوصلو لفرنسا؟', 'katwsslo l fransa?'])('does not answer a foreign destination with a domestic fee: %s', async text => {
    const { engine, config } = fixture();
    config.capabilities.faq = [{ id: 'shipping', category: 'SHIPPING', question: 'ch7al livraison?', answer: 'Livraison f lmghrib b 30 MAD.', language: 'darija' }];
    expect(PolicyEvidenceReuse.isScopeExpanded('SHIPPING', text, config)).toBe(true);
    expect(await engine.handleMessage('t', 'c', text, 'a')).not.toContain('30 MAD');
  });
  it.each([
    ['ch7al livraison?', 'Livraison f lmghrib b 30 MAD.'],
    ['شحال التوصيل؟', 'التوصيل فالمغرب ب 30 درهم.']
  ])('answers a trusted FAQ in the same script: %s', async (text, answer) => {
    const { engine, config, llm } = fixture(); config.capabilities.faq = [{ id: 'shipping', category: 'SHIPPING', question: text, answer, language: 'darija' }];
    expect(await engine.handleMessage('t', 'c', text, 'a')).toContain('30');
    expect(llm.generateResponse).not.toHaveBeenCalled();
  });
});

describe('Darija commerce response path', () => {
  it.each(['ch7al taman?', 'شحال الثمن؟'])('keeps the live catalog price and requested script: %s', async text => {
    const fact: any = { product: { id: 'p1', name: 'Moon Ninja Hoodie', sku: 'SKU-1', metadata: {} }, displayName: 'Moon Ninja Hoodie', displayDescription: '', effectivePrice: 249, currency: 'MAD', inStock: true, availableStock: 4, availableColors: [], availableSizes: [], variants: [], selectedVariant: null };
    const getProductFact = vi.fn(async () => fact);
    const { engine, config, conversation, llm } = fixture({ getDistinctCategories: async () => [], getProductFact, searchProducts: async () => [] });
    config.capabilities.ecommerceEnabled = true; conversation.contextData.productContext = product;
    const reply = await engine.handleMessage('t', 'c', text, 'a');
    expect(reply).toContain('249'); expect(reply).toContain('MAD');
    expect(/[\u0600-\u06ff]/.test(reply)).toBe(/[\u0600-\u06ff]/.test(text));
    expect(getProductFact).toHaveBeenCalled(); expect(llm.generateResponse).not.toHaveBeenCalled();
  });
  it('preserves product names and SKUs while normalizing Darija', () => {
    const result = EcommerceIntentParser.parse('بْغِيت نْشْرِي Moon Ninja Hoodie', product, 'darija');
    expect(result.productName).toBe('Moon Ninja Hoodie');
    expect(EcommerceIntentParser.parse('bghit nchri SKU-12345', product, 'darija').sku).toBe('SKU-12345');
  });
  it('switches back to English when the customer changes language', async () => {
    const { engine } = fixture(); await engine.handleMessage('t', 'c', 'بغيت نسولك على شي حاجة', 'a');
    const response = await engine.handleMessage('t', 'c', 'Hello', 'a'); expect(response).toContain('Hello');
  });
});
