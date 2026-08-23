import { describe, it, expect, vi } from 'vitest';
import { AnswerComposer, AnswerContext } from '../../src/domain/conversation/AnswerComposer';
import { TurnDecisionResolver, TurnDecision } from '../../src/domain/conversation/TurnDecision';
import { ProductFact } from '../../src/domain/ecommerce/ProductRepository';
import { chatDiagnosticStorage, RequestDiagnosticContext } from '../../src/dev/chatApi';

describe('Phase 28B: Bug Fixes Verification', () => {

  const mockProductFact: ProductFact = {
    product: {
      id: 'prod-cyber-jacket',
      tenantId: 'animeverse',
      accountId: 'animeverse-store',
      title: 'Cyber Spirit Jacket',
      description: 'Premium anime cyberpunk embroidered jacket with water-resistant fabric.',
      category: 'Jackets',
      price: '599.00',
      currency: 'MAD',
      stock: 12,
      sku: 'ANV-J001',
      images: [],
      metadata: {},
      variants: [
        { id: 'v-black-l', productId: 'prod-cyber-jacket', title: 'Black / L', sku: 'ANV-J001-BLK-L', price: '599.00', stock: 12, color: 'Cyber Black', size: 'L' }
      ],
      createdAt: new Date(),
      updatedAt: new Date()
    },
    displayName: 'Cyber Spirit Jacket',
    effectivePrice: '599.00',
    currency: 'MAD',
    inStock: true,
    availableStock: 12,
    displayDescription: 'Premium anime cyberpunk embroidered jacket with water-resistant fabric.'
  };

  it('1. composeKnowledge passes correct provider signature (systemPrompt, history, options)', async () => {
    // English RAG chunk -> Darija Arabizi response (triggers LLM translation synthesis)
    const turnDecision: TurnDecision = {
      domain: 'KNOWLEDGE',
      intent: 'SHIPPING',
      source: 'RAG',
      inputQuery: 'chhal wa9t dial livraison?',
      responseLanguage: 'darija',
      responseScript: 'arabizi',
      confidence: 0.9
    };

    const calls: any[] = [];
    const mockLlm: any = {
      generateResponse: vi.fn().mockImplementation(async (sysPrompt: string, history: any[], options?: any) => {
        calls.push({ sysPrompt, history, options });
        // Real provider interface validation: history MUST be an array of { role, content }
        if (!Array.isArray(history)) throw new TypeError('history.map is not a function');
        return 'Twsil f lmghrib kayakhod bin 24 htal 48 sa3a.';
      })
    };

    const context: AnswerContext = {
      turnDecision,
      knowledgeFacts: ['Standard shipping across Morocco is 30 MAD, taking 24-48 hours.'],
      responseLanguage: 'darija',
      responseScript: 'arabizi',
      llm: mockLlm,
      llmOptions: { temperature: 0.2, maxTokens: 400 }
    };

    const result = await AnswerComposer.compose(context);

    expect(result).toBe('Twsil f lmghrib kayakhod bin 24 htal 48 sa3a.');
    expect(mockLlm.generateResponse).toHaveBeenCalledTimes(1);
    expect(calls.length).toBe(1);
    expect(typeof calls[0].sysPrompt).toBe('string');
    expect(calls[0].sysPrompt).toContain('You are a helpful customer support assistant');
    expect(Array.isArray(calls[0].history)).toBe(true);
    expect(calls[0].history[0].role).toBe('user');
    expect(calls[0].history[0].content).toContain('<KNOWLEDGE_BASE>');
    expect(calls[0].history[0].content).toContain('chhal wa9t dial livraison?');
    expect(calls[0].options).toEqual({ temperature: 0.2, maxTokens: 400 });
  });

  it('2. composeHybrid passes correct provider signature (systemPrompt, history, options)', async () => {
    const turnDecision: TurnDecision = {
      domain: 'KNOWLEDGE',
      intent: 'RETURNS',
      source: 'HYBRID',
      productId: 'prod-cyber-jacket',
      productName: 'Cyber Spirit Jacket',
      inputQuery: 'What is the return policy for the Cyber Spirit Jacket?',
      responseLanguage: 'en',
      responseScript: 'latin',
      confidence: 0.9
    };

    const calls: any[] = [];
    const mockLlm: any = {
      generateResponse: vi.fn().mockImplementation(async (sysPrompt: string, history: any[], options?: any) => {
        calls.push({ sysPrompt, history, options });
        if (!Array.isArray(history)) throw new TypeError('history.map is not a function');
        return 'The Cyber Spirit Jacket costs 599.00 MAD and can be returned within 14 days.';
      })
    };

    const context: AnswerContext = {
      turnDecision,
      productFacts: mockProductFact,
      knowledgeFacts: ['Items can be returned within 14 days with original tags.'],
      responseLanguage: 'en',
      responseScript: 'latin',
      llm: mockLlm,
      llmOptions: { temperature: 0.1, maxTokens: 300 }
    };

    const result = await AnswerComposer.compose(context);

    expect(result).toBe('The Cyber Spirit Jacket costs 599.00 MAD and can be returned within 14 days.');
    expect(mockLlm.generateResponse).toHaveBeenCalledTimes(1);
    expect(calls.length).toBe(1);
    expect(typeof calls[0].sysPrompt).toBe('string');
    expect(calls[0].sysPrompt).toContain('Answer the customer\'s question by combining the Live Store Catalog Fact with the Store Policy Knowledge.');
    expect(Array.isArray(calls[0].history)).toBe(true);
    expect(calls[0].history[0].role).toBe('user');
    expect(calls[0].history[0].content).toContain('Live Store Catalog Fact (Authoritative - DO NOT ALTER):');
    expect(calls[0].history[0].content).toContain('Cyber Spirit Jacket');
    expect(calls[0].options).toEqual({ temperature: 0.1, maxTokens: 300 });
  });

  it('3. malformed provider call (history.map TypeError) no longer occurs with strict provider', async () => {
    // Strict provider simulating DeepSeekProvider/GeminiLLMProvider behavior
    class StrictLLMProvider {
      async generateResponse(systemPrompt: string, history: { role: string; content: string }[]): Promise<string> {
        // Will throw TypeError if history is not an array (e.g. systemPrompt was passed as 2nd arg)
        const messages = history.map(h => ({ role: h.role, text: h.content }));
        return `Answer synthesized from ${messages.length} message(s).`;
      }
    }

    const strictProvider: any = new StrictLLMProvider();

    const turnDecision: TurnDecision = {
      domain: 'KNOWLEDGE',
      intent: 'RETURNS',
      source: 'RAG',
      inputQuery: 'kifach n9der nrje3 chi haja?',
      responseLanguage: 'darija',
      responseScript: 'arabizi',
      confidence: 0.9
    };

    const context: AnswerContext = {
      turnDecision,
      knowledgeFacts: ['Orders can be returned within 14 days in original packaging.'],
      responseLanguage: 'darija',
      responseScript: 'arabizi',
      llm: strictProvider
    };

    const result = await AnswerComposer.compose(context);
    expect(result).toBe('Answer synthesized from 1 message(s).');
  });

  it('4. knowledge fallback still works for true UNANSWERABLE', async () => {
    const turnDecision: TurnDecision = {
      domain: 'KNOWLEDGE',
      intent: 'GENERAL',
      source: 'RAG',
      inputQuery: 'kifach nsayeb rocket l l-fadaa?',
      responseLanguage: 'darija',
      responseScript: 'arabizi',
      confidence: 0.9
    };

    const mockLlm: any = {
      generateResponse: vi.fn().mockResolvedValue('UNANSWERABLE')
    };

    const context: AnswerContext = {
      turnDecision,
      knowledgeFacts: ['We sell anime streetwear clothing.'],
      responseLanguage: 'darija',
      responseScript: 'arabizi',
      llm: mockLlm
    };

    const result = await AnswerComposer.compose(context);
    expect(result).toBe('Smeh liya, ma3ndich had lme3louma db.');
  });

  it('5. hybrid fallback still works for true failure', async () => {
    const turnDecision: TurnDecision = {
      domain: 'KNOWLEDGE',
      intent: 'CARE',
      source: 'HYBRID',
      inputQuery: 'Can I return this Cyber Spirit Jacket on the Moon?',
      responseLanguage: 'en',
      responseScript: 'latin',
      confidence: 0.9
    };

    const mockLlm: any = {
      generateResponse: vi.fn().mockRejectedValue(new Error('API Quota Exceeded'))
    };

    const context: AnswerContext = {
      turnDecision,
      productFacts: mockProductFact,
      knowledgeFacts: ['Hand wash only.'],
      responseLanguage: 'en',
      responseScript: 'latin',
      llm: mockLlm
    };

    const result = await AnswerComposer.compose(context);
    expect(result).toBe('I did not understand that. Could you rephrase?');
  });

  it('6. concurrent chat diagnostics remain isolated in AsyncLocalStorage', async () => {
    const contextA: RequestDiagnosticContext = {
      intent: null,
      classificationError: null,
      chunks: []
    };

    const contextB: RequestDiagnosticContext = {
      intent: null,
      classificationError: null,
      chunks: []
    };

    // Simulate two simultaneous asynchronous requests
    const promiseA = chatDiagnosticStorage.run(contextA, async () => {
      await new Promise(r => setTimeout(r, 15));
      const store = chatDiagnosticStorage.getStore();
      if (store) {
        store.intent = 'SEARCH';
        store.chunks = [{ id: 'chunk-A1' }, { id: 'chunk-A2' }];
      }
      await new Promise(r => setTimeout(r, 10));
      return chatDiagnosticStorage.getStore();
    });

    const promiseB = chatDiagnosticStorage.run(contextB, async () => {
      await new Promise(r => setTimeout(r, 5));
      const store = chatDiagnosticStorage.getStore();
      if (store) {
        store.intent = 'PRICE';
        store.chunks = [{ id: 'chunk-B1' }];
      }
      await new Promise(r => setTimeout(r, 25));
      return chatDiagnosticStorage.getStore();
    });

    const [resA, resB] = await Promise.all([promiseA, promiseB]);

    // Verify complete isolation
    expect(resA?.intent).toBe('SEARCH');
    expect(resA?.chunks.length).toBe(2);
    expect(resA?.chunks[0].id).toBe('chunk-A1');

    expect(resB?.intent).toBe('PRICE');
    expect(resB?.chunks.length).toBe(1);
    expect(resB?.chunks[0].id).toBe('chunk-B1');

    expect(contextA.intent).toBe('SEARCH');
    expect(contextB.intent).toBe('PRICE');
  });

  it('7. TurnDecision still works accurately', () => {
    const ecomTurn = TurnDecisionResolver.resolve({
      text: 'How much is the Moon Ninja Hoodie?',
      language: 'en'
    });
    expect(ecomTurn.domain).toBe('ECOMMERCE');
    expect(ecomTurn.intent).toBe('PRICE');

    const multiPolicyTurn = TurnDecisionResolver.resolve({
      text: 'Can I return this and how much is shipping?',
      language: 'en'
    });
    expect(multiPolicyTurn.domain).toBe('KNOWLEDGE');
    expect(multiPolicyTurn.isMultiPolicy).toBe(true);
  });

  it('8. Ecommerce still works with authoritative deterministic price response', async () => {
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
    expect(response).toBe('The price for Cyber Spirit Jacket is 599.00 MAD.');
  });

  it('9. Knowledge/RAG still works for deterministic direct chunk matches', async () => {
    const turnDecision = TurnDecisionResolver.resolve({
      text: 'What is your shipping policy?',
      language: 'en'
    });

    const context: AnswerContext = {
      turnDecision,
      knowledgeFacts: ['Standard shipping is 30 MAD nationwide.'],
      responseLanguage: 'en',
      responseScript: 'latin'
    };

    const response = await AnswerComposer.compose(context);
    expect(response).toBe('Standard shipping is 30 MAD nationwide.');
  });

  it('10. AnswerComposer still preserves price/stock invariants during hybrid synthesis', async () => {
    const turnDecision: TurnDecision = {
      domain: 'KNOWLEDGE',
      intent: 'RETURNS',
      source: 'HYBRID',
      productId: 'prod-cyber-jacket',
      productName: 'Cyber Spirit Jacket',
      inputQuery: 'Can I return the Cyber Spirit Jacket?',
      responseLanguage: 'en',
      responseScript: 'latin',
      confidence: 0.9
    };

    // Mock LLM attempting to alter the price to 999 MAD and claim out of stock
    const maliciousLlm: any = {
      generateResponse: vi.fn().mockResolvedValue(
        'The Cyber Spirit Jacket costs 999 MAD and is out of stock. You can return it in 14 days.'
      )
    };

    const context: AnswerContext = {
      turnDecision,
      productFacts: mockProductFact,
      knowledgeFacts: ['Items can be returned within 14 days with tags.'],
      responseLanguage: 'en',
      responseScript: 'latin',
      llm: maliciousLlm
    };

    const response = await AnswerComposer.compose(context);

    // Invariant guard replaces altered price with authoritative effectivePrice (599.00 MAD) and stock status
    expect(response).toContain('599.00 MAD');
    expect(response).not.toContain('999 MAD');
    expect(response).toContain('in stock (12 available)');
    expect(response).not.toContain('out of stock');
  });

});
