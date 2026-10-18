import { describe, expect, it } from 'vitest';
import { LLMMockProvider } from '../../src/core/llm/LLMProvider';
import { WorkflowFieldValueParser } from '../../src/core/engine/WorkflowFieldValueParser';
import { WorkflowTurnInterpreter, isBareArabicName } from '../../src/core/engine/WorkflowTurnInterpreter';

const pending = { name: 'fullName', label: 'Name', type: 'string' as const,
  semanticType: 'person_name' as const, collected: false };

describe('strict workflow turn interpretation', () => {
  it('never captures a side question as the pending name', async () => {
    const result = await WorkflowTurnInterpreter.interpret({
      message: 'chrah lia lproduit', pendingField: pending, pendingPrompt: 'chno smitek?', fields: [pending]
    });
    expect(result.kind).toBe('SIDE_QUESTION');
    expect(result.fieldSourceSpan).toBeNull();
  });

  it('keeps exact source evidence and rejects transliterated model values', async () => {
    const llm = new LLMMockProvider();
    llm.generatedResponseMock = JSON.stringify({ kind: 'FIELD_ANSWER',
      fieldSourceSpan: { text: 'Ilyes', start: 6, end: 11 }, questionSourceSpan: null,
      targetField: null, newValueSourceSpan: null, intent: null });
    const rejected = await WorkflowTurnInterpreter.interpret({
      message: 'الاسم إلياس', pendingField: pending, pendingPrompt: 'شنو سميتك؟', fields: [pending], llm
    });
    expect(rejected.kind).toBe('UNCLEAR');
  });

  it('uses the value-only source span supplied by the model', async () => {
    const llm = new LLMMockProvider();
    llm.generatedResponseMock = JSON.stringify({ kind: 'FIELD_ANSWER',
      fieldSourceSpan: { text: 'Ilyes', start: 6, end: 11 }, questionSourceSpan: null,
      targetField: null, newValueSourceSpan: null, intent: null });
    const result = await WorkflowTurnInterpreter.interpret({
      message: 'smiti Ilyes', pendingField: pending, pendingPrompt: 'chno smitek?', fields: [pending], llm
    });
    expect(result.fieldSourceSpan).toEqual({ text: 'Ilyes', start: 6, end: 11 });
  });

  it('represents a correction without a value as a field reopen', async () => {
    const llm = new LLMMockProvider();
    llm.generatedResponseMock = JSON.stringify({ kind: 'CORRECTION', fieldSourceSpan: null,
      questionSourceSpan: null, targetField: 'preferredTime', newValueSourceSpan: null, intent: null });
    const result = await WorkflowTurnInterpreter.interpret({
      message: 'bghit nbdl lwa9t', pendingField: pending, pendingPrompt: 'email?', fields: [pending,
        { name: 'preferredTime', label: 'lwa9t', type: 'time', collected: true }], llm
    });
    expect(result.kind).toBe('CORRECTION');
    expect(result.targetField).toBe('preferredTime');
    expect(result.newValueSourceSpan).toBeNull();
  });
});

describe('deterministic workflow value parsing', () => {
  it('normalizes a phone but retains its evidence', () => {
    const span = { text: '+212 612-345678', start: 0, end: 15 };
    expect(WorkflowFieldValueParser.parse(span, { name: 'phone', type: 'phone', required: true }))
      .toEqual({ rawSpan: span, value: '+212612345678' });
  });

  it('derives tomorrow without asking the model for a stored date', () => {
    const span = { text: 'ghda', start: 0, end: 4 };
    const parsed = WorkflowFieldValueParser.parse(span, { name: 'day', type: 'date', required: true }, new Date('2026-10-16T10:00:00Z'));
    expect(parsed?.value).toBe('2026-10-17');
    expect(parsed?.rawSpan).toBe(span);
  });

  it('accepts bare Arabic-script names when the model is unavailable', async () => {
    const failing = new LLMMockProvider();
    failing.generateResponse = async () => { throw new Error('provider down'); };
    for (const name of ['ياسين', 'كريم العلمي', 'فاطمة الزهراء بناني']) {
      const result = await WorkflowTurnInterpreter.interpret({
        message: name, pendingField: pending, pendingPrompt: 'شنو سميتك؟', fields: [pending], llm: failing
      });
      expect(result.kind).toBe('FIELD_ANSWER');
      expect(result.fieldSourceSpan?.text).toBe(name);
    }
  });

  it('accepts a Latin name with a trailing initial', async () => {
    const result = await WorkflowTurnInterpreter.interpret({
      message: 'Karim B.', pendingField: pending, pendingPrompt: 'Name?', fields: [pending]
    });
    expect(result.kind).toBe('FIELD_ANSWER');
  });

  it('never takes Arabic greetings, acknowledgements or sentences as a name', () => {
    for (const text of ['السلام عليكم', 'شكرا', 'واخا', 'بغيت نعرف الثمن', 'الاسم إلياس', 'عندي سؤال', 'غدا', 'كريم ٢']) {
      expect(isBareArabicName(text), text).toBe(false);
    }
    expect(isBareArabicName('ياسين')).toBe(true);
  });
});
