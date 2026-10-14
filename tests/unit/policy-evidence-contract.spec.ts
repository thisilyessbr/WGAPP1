import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_BUSINESS_CONFIG } from '../../src/domain/tenant/BusinessConfig';
import { PolicyAnswerSafety } from '../../src/domain/rag/PolicyAnswerSafety';
import { RAGService } from '../../src/domain/rag/RAGService';
import { IntentTriggerLibrary } from '../../src/domain/conversation/IntentTriggerLibrary';
import { WorkflowTurnGate } from '../../src/core/engine/WorkflowTurnGate';
import { FieldValidator } from '../../src/core/engine/FieldValidator';
import { WorkflowEngine } from '../../src/core/engine/WorkflowEngine';
import { WorkflowStateEvaluator } from '../../src/core/engine/WorkflowStateEvaluator';
import { ConversationEngine } from '../../src/domain/conversation/ConversationEngine';
import { ResponseBuilder } from '../../src/domain/conversation/ResponseBuilder';

describe('shared policy evidence contract', () => {
  it('does not return a domestic shipping fee for a foreign destination in English, French, or Darija', () => {
    const cases = [
      ['Do you ship to France?', 'Shipping within Morocco costs 30 MAD.', 'en', 'latin'],
      ['Livrez-vous en France ?', 'Livraison au Maroc : 30 MAD.', 'fr', 'latin'],
      ['واش كتوصلو لفرنسا؟', 'التوصيل داخل المغرب بـ 30 درهم.', 'darija', 'arabic']
    ] as const;
    for (const [query, content, language, script] of cases) {
      expect(PolicyAnswerSafety.directAnswerIsSafe(query, content, 'Shipping policy',
        DEFAULT_BUSINESS_CONFIG, language, script)).toBe(false);
    }
    expect(PolicyAnswerSafety.directAnswerIsSafe('And France?',
      'Shipping within Morocco costs 30 MAD.', 'Shipping policy', DEFAULT_BUSINESS_CONFIG,
      'en', 'latin')).toBe(false);
    expect(PolicyAnswerSafety.directAnswerIsSafe('Do you ship to France?',
      'We ship to France for 60 MAD.', 'Shipping policy', DEFAULT_BUSINESS_CONFIG, 'en', 'latin')).toBe(true);
  });

  it('never counts a returns-only document as shipping evidence', async () => {
    const returns = { id: 'return-1', documentId: 'document-1', documentTitle: 'Returns policy',
      content: 'Returns are accepted within 14 days.', similarity: 0.92, metadata: {} };
    const rag = new RAGService({ embedText: async () => [1] } as any,
      { searchSimilar: async () => [returns] } as any);
    const result = await rag.retrieveMultiPolicy('tenant-1', ['RETURNS', 'SHIPPING'],
      DEFAULT_BUSINESS_CONFIG, 'account-1', 'en', undefined,
      'What is your returns policy and shipping cost?');
    expect(result.availableIntents).toEqual(['RETURNS']);
    expect(result.missingIntents).toEqual(['SHIPPING']);
    expect(result.coverage.SHIPPING).toBeUndefined();
  });

  it('accepts independent, relevant evidence for both requested policies', async () => {
    const chunks = [
      { id: 'return-1', documentId: 'document-1', documentTitle: 'Returns policy',
        content: 'Returns are accepted within 14 days.', similarity: 0.92, metadata: {} },
      { id: 'shipping-1', documentId: 'document-2', documentTitle: 'Shipping policy',
        content: 'Shipping within Morocco costs 30 MAD.', similarity: 0.90, metadata: {} }
    ];
    const rag = new RAGService({ embedText: async () => [1] } as any,
      { searchSimilar: async () => chunks } as any);
    const result = await rag.retrieveMultiPolicy('tenant-1', ['RETURNS', 'SHIPPING'],
      DEFAULT_BUSINESS_CONFIG, 'account-1', 'en', undefined,
      'What is your returns policy and shipping cost?');
    expect(result.availableIntents).toEqual(['RETURNS', 'SHIPPING']);
    expect(result.coverage.RETURNS.map(item => item.sourceChunkId)).toEqual(['return-1']);
    expect(result.coverage.SHIPPING.map(item => item.sourceChunkId)).toEqual(['shipping-1']);
  });

  it('does not leak a domestic fee after a workflow has completed', async () => {
    const config = structuredClone(DEFAULT_BUSINESS_CONFIG);
    config.identity.language = 'en';
    config.knowledge.enabled = true;
    config.workflows = { demo: { id: 'demo', name: 'Demo', description: 'Demo',
      initialState: 'done', states: { done: { type: 'end' } } } };
    const conversation: any = { id: 'conversation-1', tenantId: 'tenant-1', customerId: 'customer-1',
      accountId: 'account-1', status: 'ACTIVE', version: 0, messageCount: 0,
      postCompletionQuestionCount: 0, contextData: {} };
    const service: any = {
      getOrCreateConversation: async () => conversation,
      getAutomationState: async () => null,
      getMessageCount: async () => 0,
      getActiveSession: async () => null,
      getRecentMessages: async () => [],
      getLatestCompletedSession: async () => ({ id: 'session-1', status: 'COMPLETED', workflowId: 'demo' }),
      findExistingTurnResponse: async () => null,
      commitConversationTurn: vi.fn(async () => ({ success: true }))
    };
    const llm: any = { generateResponse: vi.fn(async () => 'UNANSWERABLE'), classifyIntent: vi.fn(async () => null) };
    const rag: any = { retrieve: vi.fn(async () => ({ chunks: [{ id: 'shipping-1', documentId: 'doc-1',
      documentTitle: 'Shipping policy', content: 'Shipping within Morocco costs 30 MAD.',
      similarity: 0.96, score: 0.96 }] })) };
    const engine = new ConversationEngine(service, { getConfig: async () => config } as any,
      new WorkflowEngine(new WorkflowStateEvaluator()), llm, new ResponseBuilder(), rag);
    const reply = await engine.handleMessage('tenant-1', 'customer-1', 'Do you ship to France?', 'account-1');
    expect(reply).not.toContain('30 MAD');
    expect(reply).toMatch(/confirmed information about international shipping/i);
    expect(service.commitConversationTurn).toHaveBeenCalledOnce();
  });

  it('keeps the form step while declining an unsupported foreign-shipping answer', async () => {
    const config = structuredClone(DEFAULT_BUSINESS_CONFIG);
    config.knowledge.enabled = true;
    config.portalFacts = { description: 'Shipping within Morocco costs 30 MAD.' };
    const workflow: any = { id: 'demo', name: 'Demo', description: 'Demo', initialState: 'name',
      states: { name: { type: 'collect', prompt: 'What is your name?',
        field: { name: 'fullName', type: 'string', semanticType: 'person_name', required: true }, next: 'done' },
        done: { type: 'end' } } };
    const session: any = { id: 'session-1', tenantId: 'tenant-1', conversationId: 'conversation-1',
      workflowId: 'demo', stateId: 'name', status: 'ACTIVE', stateHistory: [], contextData: { _started: true },
      collectedData: {}, createdAt: new Date(), updatedAt: new Date() };
    const rag: any = { retrieve: vi.fn(async () => ({ chunks: [{ id: 'shipping-1', documentId: 'doc-1',
      documentTitle: 'Shipping policy', content: 'Shipping within Morocco costs 30 MAD.',
      similarity: 0.96, score: 0.96 }] })) };
    const result = await new WorkflowEngine(new WorkflowStateEvaluator()).process(session,
      'Do you ship to France?', workflow, config, undefined, undefined, rag, undefined, 'en', 'latin', 'account-1');
    expect(result.response).not.toContain('30 MAD');
    expect(result.response).toMatch(/confirmed information about international shipping/i);
    expect(result.response).toContain('What is your name?');
    expect(result.nextStateId).toBe('name');
    expect(result.updatedCollectedData).toEqual({});
  });
});

describe('resilient form and lead routing', () => {
  it('routes constrained text to its validator when the AI classifier is unavailable', async () => {
    const field = { name: 'email', type: 'string' as const,
      validationRegex: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$' };
    const unavailableLlm = { generateResponse: async () => 'not-json' } as any;
    expect((await WorkflowTurnGate.interpret('john@example.com', 'email', field,
      'What is your email?', unavailableLlm)).kind).toBe('FIELD_ANSWER');
    expect(new FieldValidator().validate('john@example.com', field)).toBeNull();
    expect((await WorkflowTurnGate.interpret('not-an-email', 'email', field,
      'What is your email?', unavailableLlm)).kind).toBe('FIELD_ANSWER');
    expect(new FieldValidator().validate('not-an-email', field)).not.toBeNull();
    expect((await WorkflowTurnGate.interpret('What is your email policy?', 'email', field,
      'What is your email?', unavailableLlm)).kind).toBe('CUSTOMER_QUESTION');
    expect((await WorkflowTurnGate.interpret('Do you ship to France?', 'businessNeed',
      { name: 'businessNeed', type: 'string', semanticType: 'free_text' },
      'What is your business need?', unavailableLlm)).kind).toBe('CUSTOMER_QUESTION');
  });

  it.each(['أريد شراء هذا', 'أود شراء هذا', 'سأشتري هذا', 'بغيت نشري هادشي', 'I want to buy this'])
  ('recognizes a positive purchase request: %s', message => {
    expect(IntentTriggerLibrary.has(message, 'PURCHASE')).toBe(true);
  });

  it.each(['لا أريد شراء هذا', 'لن أشتري هذا', 'ما بغيتش نشري هادشي'])
  ('does not create a purchase signal from refusal: %s', message => {
    expect(IntentTriggerLibrary.has(message, 'PURCHASE')).toBe(false);
  });

  it('keeps a positive purchase request after a rejected alternative', () => {
    expect(IntentTriggerLibrary.has('لا أريد شراء الأحمر لكن أريد شراء الأزرق', 'PURCHASE')).toBe(true);
    expect(IntentTriggerLibrary.has('Je ne veux pas acheter le rouge, mais je veux acheter le bleu', 'PURCHASE')).toBe(true);
  });
});
