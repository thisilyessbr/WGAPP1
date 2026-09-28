import { describe, expect, it } from 'vitest';
import { LLMMockProvider } from '../../src/core/llm/LLMProvider';
import { MeteredLLMProvider } from '../../src/core/llm/MeteredLLMProvider';
import { ConversationMemory } from '../../src/domain/conversation/ConversationMemory';
import { QuestionReformulator } from '../../src/domain/rag/QuestionReformulator';

const memory = {
  recentTurns: [
    { role: 'user', content: 'Tell me about the English course.' },
    { role: 'assistant', content: 'We offer an English course.' }
  ]
} as ConversationMemory;

describe('multilingual retrieval query reformulation', () => {
  it.each([
    'How much does the English course cost?',
    'How long is the English course?',
    'Combien coûte le cours de français ?',
    'كم ثمن دورة الإنجليزية؟',
    'Ch7al taman cours anglais?',
    'Kifach n9der n7jez cours anglais?'
  ])('does not spend an AI call on a standalone question: %s', async query => {
    const llm = new LLMMockProvider();
    expect(QuestionReformulator.isAmbiguous(query, memory)).toBe(false);
    expect(await QuestionReformulator.reformulate(query, memory, llm)).toMatchObject({
      retrievalQuery: query,
      reformulated: false
    });
    expect(llm.callCount).toBe(0);
  });

  it.each([
    'How much is it?',
    'Combien ça coûte?',
    'bch7al hadi?',
    'Ch7al',
    'كم؟',
    'What about its duration?'
  ])('keeps context resolution for a genuine follow-up: %s', query => {
    expect(QuestionReformulator.isAmbiguous(query, memory)).toBe(true);
  });

  it('labels a necessary reformulation call for latency measurement', async () => {
    const calls: string[] = [];
    const llm = new MeteredLLMProvider(new LLMMockProvider(),
      { provider: 'mock', model: 'mock-model' }, usage => calls.push(usage.purpose));

    await QuestionReformulator.reformulate('How much is it?', memory, llm);

    expect(calls).toEqual(['query_reformulation']);
  });
});
