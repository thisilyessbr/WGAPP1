import { describe, it, expect, vi } from 'vitest';
import { AnswerComposer, AnswerContext } from '../../src/domain/conversation/AnswerComposer';
import { TurnDecisionResolver } from '../../src/domain/conversation/TurnDecision';
import { ProductFact } from '../../src/domain/ecommerce/ProductRepository';

describe('Phase 26E: AnswerComposer Integration Tests', () => {
  const mockProductFact: ProductFact = {
    product: {
      id: 'prod-cyber-jacket',
      tenantId: 'animeverse',
      accountId: 'animeverse-store',
      title: 'Cyber Spirit Jacket',
      description: 'Premium anime cyberpunk embroidered jacket with water-resistant fabric.',
      category: 'Jackets',
      price: '450.00',
      currency: 'MAD',
      stock: 10,
      sku: 'CYBER-JKT',
      images: [],
      metadata: {},
      variants: [
        { id: 'v-black-l', productId: 'prod-cyber-jacket', title: 'Black / L', sku: 'CYBER-JKT-BLK-L', price: '450.00', stock: 5, color: 'Black', size: 'L' },
        { id: 'v-black-m', productId: 'prod-cyber-jacket', title: 'Black / M', sku: 'CYBER-JKT-BLK-M', price: '450.00', stock: 5, color: 'Black', size: 'M' }
      ],
      createdAt: new Date(),
      updatedAt: new Date()
    },
    displayName: 'Cyber Spirit Jacket',
    effectivePrice: '450.00',
    currency: 'MAD',
    inStock: true,
    availableStock: 10,
    displayDescription: 'Premium anime cyberpunk embroidered jacket with water-resistant fabric.'
  };

  it('1. English ecommerce', async () => {
    const turnDecision = TurnDecisionResolver.resolve({
      text: 'How much is the Cyber Spirit Jacket?',
      language: 'en'
    });

    const context: AnswerContext = {
      turnDecision,
      productFacts: mockProductFact,
      responseLanguage: 'en',
      responseScript: 'latin'
    };

    const response = await AnswerComposer.compose(context);
    expect(response).toBe('The price for Cyber Spirit Jacket is 450.00 MAD.');
  });

  it('2. Darija Arabizi ecommerce', async () => {
    const turnDecision = TurnDecisionResolver.resolve({
      text: 'bchhal Cyber Spirit Jacket?',
      language: 'darija'
    });

    const context: AnswerContext = {
      turnDecision,
      productFacts: mockProductFact,
      responseLanguage: 'darija',
      responseScript: 'arabizi'
    };

    const response = await AnswerComposer.compose(context);
    expect(response).toBe('Taman dyal Cyber Spirit Jacket howa 450.00 MAD.');
  });

  it('3. Arabic-script ecommerce', async () => {
    const turnDecision = TurnDecisionResolver.resolve({
      text: 'شحال ثمن Cyber Spirit Jacket؟',
      language: 'darija'
    });

    const context: AnswerContext = {
      turnDecision,
      productFacts: mockProductFact,
      responseLanguage: 'darija',
      responseScript: 'arabic'
    };

    const response = await AnswerComposer.compose(context);
    expect(response).toBe('الثمن ديال Cyber Spirit Jacket هو 450.00 MAD.');
  });

  it('4. English RAG source -> Darija Arabizi answer', async () => {
    const turnDecision = TurnDecisionResolver.resolve({
      text: 'kifach n9der nrje3 chi haja?',
      language: 'darija'
    });

    const mockLlm: any = {
      generateResponse: vi.fn().mockResolvedValue('T9der trje3 l-produit f 14 yom mn be3d ma tsellemtiha.')
    };

    const context: AnswerContext = {
      turnDecision,
      knowledgeFacts: ['Orders can be returned within 14 days of delivery in original condition.'],
      responseLanguage: 'darija',
      responseScript: 'arabizi',
      llm: mockLlm
    };

    const response = await AnswerComposer.compose(context);
    expect(mockLlm.generateResponse).toHaveBeenCalled();
    expect(response).toBe('T9der trje3 l-produit f 14 yom mn be3d ma tsellemtiha.');
  });

  it('5. English RAG source -> Arabic-script answer', async () => {
    const turnDecision = TurnDecisionResolver.resolve({
      text: 'شحال كياخد التوصيل للمغرب؟',
      language: 'ar'
    });

    const mockLlm: any = {
      generateResponse: vi.fn().mockResolvedValue('التوصيل في المغرب يستغرق من يومين إلى 4 أيام عمل.')
    };

    const context: AnswerContext = {
      turnDecision,
      knowledgeFacts: ['Standard shipping in Morocco takes 2-4 business days.'],
      responseLanguage: 'ar',
      responseScript: 'arabic',
      llm: mockLlm
    };

    const response = await AnswerComposer.compose(context);
    expect(mockLlm.generateResponse).toHaveBeenCalled();
    expect(response).toBe('التوصيل في المغرب يستغرق من يومين إلى 4 أيام عمل.');
  });

  it('6. French RAG source -> Darija answer', async () => {
    const turnDecision = TurnDecisionResolver.resolve({
      text: 'kifach nghsel had l-jacket?',
      language: 'darija'
    });

    const mockLlm: any = {
      generateResponse: vi.fn().mockResolvedValue('Ghsel l-jacket b l-yed f 30°C w madirhach f seche-linge.')
    };

    const context: AnswerContext = {
      turnDecision,
      knowledgeFacts: ['Lavage à la main recommandé à 30°C maximum. Ne pas passer au sèche-linge.'],
      responseLanguage: 'darija',
      responseScript: 'arabizi',
      llm: mockLlm
    };

    const response = await AnswerComposer.compose(context);
    expect(mockLlm.generateResponse).toHaveBeenCalled();
    expect(response).toBe('Ghsel l-jacket b l-yed f 30°C w madirhach f seche-linge.');
  });

  it('7. hybrid product + returns', async () => {
    const turnDecision = TurnDecisionResolver.resolve({
      text: 'شنو هي سياسة الإرجاع ديال Cyber Spirit Jacket؟',
      language: 'darija'
    });

    const mockLlm: any = {
      generateResponse: vi.fn().mockResolvedValue('بالنسبة لـ Cyber Spirit Jacket، يمكن ليك ترجعها فـ 14 يوم من بعد الاستلام إذا بقات فالحالة الأصلية ديالها.')
    };

    const context: AnswerContext = {
      turnDecision,
      productFacts: mockProductFact,
      knowledgeFacts: ['Items can be returned within 14 days of delivery in unused condition with tags.'],
      responseLanguage: 'darija',
      responseScript: 'arabic',
      llm: mockLlm
    };

    const response = await AnswerComposer.compose(context);
    expect(mockLlm.generateResponse).toHaveBeenCalled();
    expect(response).toContain('Cyber Spirit Jacket');
    expect(response).toContain('14 يوم');
  });

  it('8. hybrid product + care', async () => {
    const turnDecision = TurnDecisionResolver.resolve({
      text: 'kifach nghsel Cyber Spirit Jacket?',
      language: 'darija'
    });

    const mockLlm: any = {
      generateResponse: vi.fn().mockResolvedValue('Bach te3tani b Cyber Spirit Jacket, ghselha b l-ma bared w b l-yed bach teb9a mzyana.')
    };

    const context: AnswerContext = {
      turnDecision,
      productFacts: mockProductFact,
      knowledgeFacts: ['All jackets should be hand washed in cold water to protect embroidered artwork.'],
      responseLanguage: 'darija',
      responseScript: 'arabizi',
      llm: mockLlm
    };

    const response = await AnswerComposer.compose(context);
    expect(mockLlm.generateResponse).toHaveBeenCalled();
    expect(response).toContain('Cyber Spirit Jacket');
    expect(response).toContain('ghselha');
  });

  it('9. product price cannot be overridden by LLM', async () => {
    const turnDecision = TurnDecisionResolver.resolve({
      text: 'شنو هي سياسة الإرجاع لـ Cyber Spirit Jacket وشحال ثمنها؟',
      language: 'ar'
    });

    // LLM attempts to output hallucinated wrong price: 299 MAD instead of authoritative 450.00 MAD
    const mockLlm: any = {
      generateResponse: vi.fn().mockResolvedValue('سعر Cyber Spirit Jacket هو 299 MAD ويمكنك إرجاعها خلال 14 يوماً.')
    };

    const context: AnswerContext = {
      turnDecision,
      productFacts: mockProductFact,
      knowledgeFacts: ['Returns accepted within 14 days.'],
      responseLanguage: 'ar',
      responseScript: 'arabic',
      llm: mockLlm
    };

    const response = await AnswerComposer.compose(context);
    expect(response).toContain('450.00 MAD');
    expect(response).not.toContain('299 MAD');
  });

  it('10. stock cannot be overridden', async () => {
    const turnDecision = TurnDecisionResolver.resolve({
      text: 'واش باقية Cyber Spirit Jacket وشنو سياسة الإرجاع ديالها؟',
      language: 'ar'
    });

    // LLM hallucinating that product is out of stock even though DB has stock: 10
    const mockLlm: any = {
      generateResponse: vi.fn().mockResolvedValue('Cyber Spirit Jacket غير متوفر حالياً ولكن سياسة الإرجاع 14 يوم.')
    };

    const context: AnswerContext = {
      turnDecision,
      productFacts: mockProductFact,
      knowledgeFacts: ['Returns accepted within 14 days.'],
      responseLanguage: 'ar',
      responseScript: 'arabic',
      llm: mockLlm
    };

    const response = await AnswerComposer.compose(context);
    expect(response).toContain('متوفر في المخزون (10 قطع)');
  });

  it('11. unknown knowledge stays unknown', async () => {
    const turnDecision = TurnDecisionResolver.resolve({
      text: 'واش عندكم فرع فكندا؟',
      language: 'darija'
    });

    const mockLlm: any = {
      generateResponse: vi.fn().mockResolvedValue('UNANSWERABLE')
    };

    const context: AnswerContext = {
      turnDecision,
      knowledgeFacts: [], // No knowledge found
      responseLanguage: 'darija',
      responseScript: 'arabic',
      llm: mockLlm
    };

    const response = await AnswerComposer.compose(context);
    expect(response).toBe('سمح ليا، ما عنديش هاد المعلومة حالياً.');
  });

  it('12. fallback respects language/script', async () => {
    const turnDecision = TurnDecisionResolver.resolve({ text: 'xyz123random' });

    // English
    expect(await AnswerComposer.compose({ turnDecision, responseLanguage: 'en', responseScript: 'latin' }))
      .toBe('I did not understand that. Could you rephrase?');

    // French
    expect(await AnswerComposer.compose({ turnDecision, responseLanguage: 'fr', responseScript: 'latin' }))
      .toBe('Désolé, je ne dispose pas de cette information.');

    // Arabic
    expect(await AnswerComposer.compose({ turnDecision, responseLanguage: 'ar', responseScript: 'arabic' }))
      .toBe('عذراً، لا تتوفر لدي هذه المعلومة حالياً.');

    // Darija Arabic script
    expect(await AnswerComposer.compose({ turnDecision, responseLanguage: 'darija', responseScript: 'arabic' }))
      .toBe('سمح ليا، ما عنديش هاد المعلومة حالياً.');

    // Darija Arabizi
    expect(await AnswerComposer.compose({ turnDecision, responseLanguage: 'darija', responseScript: 'arabizi' }))
      .toBe('Smeh ليا / Smeh liya, ma3ndich had lme3louma db.' .replace('Smeh ليا / ', ''));
  });

  it('13. handoff respects language/script', async () => {
    const turnDecision = TurnDecisionResolver.resolve({ text: 'human agent' });

    // English
    expect(await AnswerComposer.compose({ turnDecision, responseLanguage: 'en', responseScript: 'latin' }))
      .toBe('A human agent has been notified and will assist you shortly.');

    // French
    expect(await AnswerComposer.compose({ turnDecision, responseLanguage: 'fr', responseScript: 'latin' }))
      .toBe('Un conseiller humain a été prévenu et va prendre le relais sous peu.');

    // Arabic
    expect(await AnswerComposer.compose({ turnDecision, responseLanguage: 'ar', responseScript: 'arabic' }))
      .toBe('تم إخطار أحد موظفي خدمة العملاء وسيقوم بمساعدتك قريباً.');

    // Darija Arabic script
    expect(await AnswerComposer.compose({ turnDecision, responseLanguage: 'darija', responseScript: 'arabic' }))
      .toBe('علمنا فريق الدعم وغادي يجاوبك واحد من الموظفين قريبا.');

    // Darija Arabizi
    expect(await AnswerComposer.compose({ turnDecision, responseLanguage: 'darija', responseScript: 'arabizi' }))
      .toBe("3lemna l'equipe d support w ghadi yjawbek chi wahed 9riban.");
  });

  it('14. raw RAG chunk does not leak in wrong language', async () => {
    const turnDecision = TurnDecisionResolver.resolve({
      text: 'شحال التوصيل للمغرب؟',
      language: 'ar'
    });

    const englishRawChunk = 'Standard shipping in Morocco takes 2-4 business days.';

    const mockLlm: any = {
      generateResponse: vi.fn().mockResolvedValue('الشحن القياسي في المغرب يستغرق 2 إلى 4 أيام عمل.')
    };

    const context: AnswerContext = {
      turnDecision,
      knowledgeFacts: [englishRawChunk],
      responseLanguage: 'ar',
      responseScript: 'arabic',
      llm: mockLlm
    };

    const response = await AnswerComposer.compose(context);
    expect(mockLlm.generateResponse).toHaveBeenCalled();
    expect(response).not.toBe(englishRawChunk);
    expect(response).toBe('الشحن القياسي في المغرب يستغرق 2 إلى 4 أيام عمل.');
  });
});
