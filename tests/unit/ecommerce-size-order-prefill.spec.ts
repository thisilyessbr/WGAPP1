import { describe, expect, it, vi } from 'vitest';
import { EcommerceIntentParser } from '../../src/domain/ecommerce/EcommerceIntent';
import { TurnDecisionResolver } from '../../src/domain/conversation/TurnDecision';
import { AnswerComposer } from '../../src/domain/conversation/AnswerComposer';
import { EcommerceIntentHandler } from '../../src/domain/conversation/EcommerceIntentHandler';
import { ConversationEngine } from '../../src/domain/conversation/ConversationEngine';
import { WorkflowEngine } from '../../src/core/engine/WorkflowEngine';
import { DEFAULT_BUSINESS_CONFIG } from '../../src/domain/tenant/BusinessConfig';
import { EcommerceService } from '../../src/domain/ecommerce/EcommerceService';

const product = { id: 'jeans-1', category: 'Pants', name: 'Jean Atlas bleu', stock: 8 };
const selectedVariant = { id: 'variant-34', color: 'Blue', size: '34', stock: 4 };
const fact = {
  product,
  selectedVariant,
  displayName: 'Jean Atlas bleu',
  displayDescription: 'Jeans',
  effectivePrice: 299,
  currency: 'MAD',
  inStock: true,
  availableStock: 4
};
const decision = (text: string, selectedProductId?: string) => TurnDecisionResolver.resolve({
  text, language: 'darija', script: 'arabic', isEcommerceEnabled: true,
  productContext: selectedProductId ? { selectedProductId } : undefined
});

describe('commerce size and order handoff', () => {
  it.each([
    ['Vous avez le jean bleu en taille 34 ? Combien coûte-t-il ?', 'fr', 'latin', 'En stock : 4'],
    ['Is the blue jeans size 34 available, and how much is it?', 'en', 'latin', 'In stock: 4'],
    ['هل الجينز الأزرق مقاس 34 متوفر وكم سعره؟', 'ar', 'arabic', 'الكمية المتوفرة: 4'],
    ['سلام، واش عندكم جينز أزرق مقاس 34 وشحال الثمن؟', 'darija', 'arabic', 'كاين منو: 4']
  ] as const)('answers the price and stock together: %s', (message, language, script, stockPhrase) => {
    const turnDecision = TurnDecisionResolver.resolve({
      text: message, language, script, isEcommerceEnabled: true
    });
    expect(turnDecision.intent).toBe('PRICE');
    expect(turnDecision.size).toBe('34');
    const answer = AnswerComposer.composeEcommerce({
      turnDecision, productFacts: fact as any, userMessage: message,
      responseLanguage: language, responseScript: script
    });
    expect(answer).toContain('299 MAD');
    expect(answer).toContain(stockPhrase);
  });

  it('parses common jeans sizes without turning the size-only follow-up into a new product', () => {
    for (const size of ['28', '30', '32', '34']) {
      expect(EcommerceIntentParser.parse(`بغيت نطلب جينز أزرق مقاس ${size}`).size).toBe(size);
    }
    const followup = EcommerceIntentParser.parse('واش المقاس 34 متوفر دابا؟');
    expect(followup.intent).toBe('AVAILABILITY');
    expect(followup.size).toBe('34');
    expect(followup.productName).toBeUndefined();
    expect(EcommerceIntentParser.parse('سلام، واش عندكم جينز أزرق مقاس 34 وشحال الثمن؟').productName).toBeUndefined();
  });

  it('answers both price and variant stock when the customer asks both', () => {
    const message = 'سلام، واش عندكم جينز أزرق مقاس 34 وشحال الثمن؟';
    const answer = AnswerComposer.composeEcommerce({
      turnDecision: decision(message), productFacts: fact as any, userMessage: message,
      responseLanguage: 'darija', responseScript: 'arabic'
    });
    expect(answer).toContain('299 MAD');
    expect(answer).toContain('34');
    expect(answer).toContain('كاين منو: 4');
    expect(answer).not.toContain('كاين منو: 8');
  });

  it('uses a single catalog match for a category enquiry and rechecks variant stock', async () => {
    const getProductFact = vi.fn().mockImplementation(async (_tenant, _account, identifier) =>
      identifier.id ? fact : null);
    const searchProducts = vi.fn().mockResolvedValue([fact]);
    const message = 'سلام، واش عندكم جينز أزرق مقاس 34 وشحال الثمن؟';
    const result = await EcommerceIntentHandler.handle({
      turnDecision: decision(message), tenantId: 'tenant', targetAccountId: 'account',
      effectiveLang: 'darija', content: message,
      conversation: { id: 'conversation', contextData: {} },
      conversationContext: { productContext: null } as any,
      correlationId: 'test', config: {} as any,
      ecommerceService: { getProductFact, searchProducts } as any
    });
    expect(getProductFact).toHaveBeenLastCalledWith('tenant', 'account',
      { id: 'jeans-1', color: 'Blue', size: '34' }, 'darija');
    expect(result.answerText).toContain('كاين منو: 4');
  });

  it('keeps the selected product for a size-only follow-up and never reports parent stock', async () => {
    const getProductFact = vi.fn().mockResolvedValue(fact);
    const message = 'واش المقاس 34 متوفر دابا؟';
    const result = await EcommerceIntentHandler.handle({
      turnDecision: decision(message, 'jeans-1'), tenantId: 'tenant', targetAccountId: 'account',
      effectiveLang: 'darija', content: message,
      conversation: { id: 'conversation', contextData: {} },
      conversationContext: { productContext: { selectedProductId: 'jeans-1', selectedColor: 'Blue' } } as any,
      correlationId: 'test', config: {} as any,
      ecommerceService: { getProductFact } as any
    });
    expect(getProductFact).toHaveBeenCalledWith('tenant', 'account',
      { id: 'jeans-1', sku: undefined, name: undefined, color: 'Blue', size: '34' }, 'darija');
    expect(result.answerText).toContain('كاين منو: 4');
    expect(result.answerText).not.toContain('كاين منو: 8');
  });

  it('prefills a product only after catalog verification, then asks the next order field', async () => {
    const createSession = vi.fn().mockResolvedValue({ id: 'session' });
    const getProductFact = vi.fn().mockResolvedValue(fact);
    const searchProducts = vi.fn().mockResolvedValue([fact]);
    const stub = { conversationService: { createSession }, ecommerceService: { getProductFact, searchProducts } };
    const workflow = {
      initialState: 'collect_product',
      states: {
        collect_product: { type: 'collect', field: 'product', next: 'collect_quantity' },
        collect_quantity: { type: 'collect', field: 'quantity' }
      }
    };
    await (ConversationEngine.prototype as any).createWorkflowSessionForTurn.call(
      stub, 'tenant', 'conversation', 'cod', workflow,
      decision('بغيت نطلب جينز أزرق مقاس 34', 'jeans-1'),
      { selectedProductId: 'jeans-1' }, 'account', 'darija'
    );
    expect(createSession).toHaveBeenCalledWith('tenant', 'conversation', 'cod', 'collect_quantity', {
      stateHistory: ['collect_product'],
      collectedData: { product: 'Jean Atlas bleu (Blue, 34)' },
      contextData: { product: 'Jean Atlas bleu (Blue, 34)' }
    });
    const seededSession = {
      id: 'session', tenantId: 'tenant', conversationId: 'conversation', workflowId: 'cod',
      stateId: 'collect_quantity', status: 'ACTIVE',
      stateHistory: ['collect_product'],
      collectedData: { product: 'Jean Atlas bleu (Blue, 34)' },
      contextData: { product: 'Jean Atlas bleu (Blue, 34)' }
    };
    const nextPrompt = await new WorkflowEngine().process(
      seededSession as any, 'بغيت نطلب جينز أزرق مقاس 34',
      { ...workflow, id: 'cod', name: 'Order', description: 'Order',
        states: { ...workflow.states, collect_quantity: {
          type: 'collect', field: 'quantity', prompt: 'شحال من واحد بغيتي؟'
        } } } as any,
      DEFAULT_BUSINESS_CONFIG, undefined, undefined, undefined, 'turn', 'darija', 'arabic'
    );
    expect(nextPrompt.response).toContain('شحال من واحد بغيتي؟');
    expect(nextPrompt.updatedCollectedData?.product).toBe('Jean Atlas bleu (Blue, 34)');

    createSession.mockClear();
    getProductFact.mockResolvedValueOnce({ ...fact, inStock: false, availableStock: 0 });
    await (ConversationEngine.prototype as any).createWorkflowSessionForTurn.call(
      stub, 'tenant', 'conversation', 'cod', workflow,
      decision('بغيت نطلب جينز أزرق مقاس 34', 'jeans-1'),
      { selectedProductId: 'jeans-1' }, 'account', 'darija'
    );
    expect(createSession).toHaveBeenCalledWith('tenant', 'conversation', 'cod', 'collect_product');

    createSession.mockClear();
    searchProducts.mockResolvedValueOnce([fact, { ...fact, product: { ...product, id: 'jeans-2' } }]);
    await (ConversationEngine.prototype as any).createWorkflowSessionForTurn.call(
      stub, 'tenant', 'conversation', 'cod', workflow,
      decision('بغيت نطلب جينز أزرق مقاس 34', 'jeans-1'),
      { selectedProductId: 'jeans-1' }, 'account', 'darija'
    );
    expect(createSession).toHaveBeenCalledWith('tenant', 'conversation', 'cod', 'collect_product');
  });

  it('does not label aggregate size stock as one color or claim a missing variant is available', async () => {
    const variants = [
      { ...selectedVariant, sku: 'BLUE-34', stock: 4 },
      { ...selectedVariant, id: 'red-34', sku: 'RED-34', color: 'Red', stock: 3 }
    ];
    const catalogProduct = { ...product, price: 299, currency: 'MAD', description: 'Jeans',
      nameLocalized: null, descriptionLocalized: null, variants };
    const service = new EcommerceService({ findById: vi.fn().mockResolvedValue(catalogProduct) } as any);
    const aggregated = await service.getProductFact('tenant', 'account', { id: 'jeans-1', size: '34' }, 'en');
    expect(aggregated?.availableStock).toBe(7);
    expect(aggregated?.selectedVariant).toBeNull();
    const answer = AnswerComposer.composeEcommerce({
      turnDecision: decision('واش المقاس 34 متوفر دابا؟', 'jeans-1'),
      productFacts: aggregated as any, userMessage: 'واش المقاس 34 متوفر دابا؟',
      responseLanguage: 'darija', responseScript: 'arabic'
    });
    expect(answer).toContain('كاين منو: 7');
    expect(answer).not.toContain('Red / 34');
    expect(answer).not.toContain('Blue / 34');

    const missing = await service.getProductFact('tenant', 'account', { id: 'jeans-1', size: '36' }, 'en');
    expect(missing?.inStock).toBe(false);
    expect(missing?.availableStock).toBe(0);
  });

  it('does not call an ambiguous category out of stock or choose one for the customer', async () => {
    const message = 'سلام، واش عندكم جينز أزرق مقاس 34 وشحال الثمن؟';
    const candidates = [fact, { ...fact, product: { ...product, id: 'jeans-2', name: 'Jean Second' }, displayName: 'Jean Second' }];
    const result = await EcommerceIntentHandler.handle({
      turnDecision: decision(message), tenantId: 'tenant', targetAccountId: 'account',
      effectiveLang: 'darija', content: message,
      conversation: { id: 'conversation', contextData: {} },
      conversationContext: { productContext: null } as any, correlationId: 'test', config: {} as any,
      ecommerceService: { getProductFact: vi.fn().mockResolvedValue(null), searchProducts: vi.fn().mockResolvedValue(candidates) } as any
    });
    expect(result.answerText).toContain('Jean Atlas bleu');
    expect(result.answerText).toContain('Jean Second');
    expect(result.answerText).not.toContain('ما كاينش');
    expect(result.answerText).not.toContain('كاين منو: 8');
    expect(result.productContextUpdate?.selectedProductId).toBeNull();
  });

  it('does not present an unknown product as definitely out of stock', () => {
    const answer = AnswerComposer.composeEcommerce({
      turnDecision: decision('شحال ثمن داك المنتوج؟'), productFacts: null,
      userMessage: 'شحال ثمن داك المنتوج؟', responseLanguage: 'darija', responseScript: 'arabic'
    });
    expect(answer).toContain('صيفط ليا سميتو');
    expect(answer).not.toContain('ما كاينش');
  });

  it('does not pin a product when search finds several possible matches', async () => {
    const candidates = [fact, { ...fact, product: { ...product, id: 'jeans-2' } }];
    const result = await EcommerceIntentHandler.handle({
      turnDecision: { ...decision('بغيت جينز'), intent: 'PRODUCT_SEARCH', category: 'Pants' },
      tenantId: 'tenant', targetAccountId: 'account', effectiveLang: 'darija',
      content: 'بغيت جينز', conversation: { id: 'conversation', contextData: {} },
      conversationContext: { productContext: null } as any, correlationId: 'test', config: {} as any,
      ecommerceService: { searchProducts: vi.fn().mockResolvedValue(candidates) } as any
    });
    expect(result.productContextUpdate?.lastViewedProductIds).toEqual(['jeans-1', 'jeans-2']);
    expect(result.productContextUpdate?.selectedProductId).toBeNull();
  });

  it('aggregates filtered search stock without selecting an arbitrary color', async () => {
    const variants = [
      { ...selectedVariant, sku: 'BLUE-34', stock: 4 },
      { ...selectedVariant, id: 'red-34', sku: 'RED-34', color: 'Red', stock: 3 }
    ];
    const catalogProduct = { ...product, price: 299, currency: 'MAD', description: 'Jeans',
      nameLocalized: null, descriptionLocalized: null, variants };
    const service = new EcommerceService({ search: vi.fn().mockResolvedValue([catalogProduct]) } as any);
    const results = await service.searchProducts('tenant', 'account', undefined, 'en', { size: '34' });
    expect(results[0].availableStock).toBe(7);
    expect(results[0].selectedVariant).toBeNull();
    const missing = await service.searchProducts('tenant', 'account', undefined, 'en', { size: '36' });
    expect(missing[0].availableStock).toBe(0);
    expect(missing[0].inStock).toBe(false);
  });
});
