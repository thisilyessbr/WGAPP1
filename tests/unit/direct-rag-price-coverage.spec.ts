import { describe, expect, it } from 'vitest';
import { DirectRagGuard } from '../../src/domain/rag/DirectRagGuard';

describe('Direct RAG price coverage', () => {
  it('does not present a care guide as the answer to a price question', () => {
    const result = DirectRagGuard.evaluate(
      'How much is the Atlas T-shirt?',
      'Atlas T-shirt care guide. Wash at 30 degrees Celsius. Air dry it.',
      'en', 'latin'
    );
    expect(result).toMatchObject({ isSafe: false, reason: 'QUESTION_NOT_ANSWERED' });
  });

  it('still allows a document with an actual price', () => {
    const result = DirectRagGuard.evaluate(
      'How much is the Atlas T-shirt?',
      'The Atlas T-shirt costs 149 MAD.',
      'en', 'latin'
    );
    expect(result).toMatchObject({ isSafe: true, reason: 'SAFE' });
  });

  it('does not treat a capacity question as a price question', () => {
    const result = DirectRagGuard.evaluate(
      'How much weight can the Atlas bag hold?',
      'The Atlas bag can carry 8 kg.',
      'en', 'latin'
    );
    expect(result).toMatchObject({ isSafe: true, reason: 'SAFE' });
  });
});
