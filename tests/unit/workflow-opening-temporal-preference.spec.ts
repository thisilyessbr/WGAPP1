import { describe, expect, it } from 'vitest';
import { WorkflowSession } from '@prisma/client';
import { WorkflowEngine } from '../../src/core/engine/WorkflowEngine';
import { OpeningTemporalPreference } from '../../src/core/engine/OpeningTemporalPreference';
import { DEFAULT_BUSINESS_CONFIG, WorkflowConfig } from '../../src/domain/tenant/BusinessConfig';

const workflow: WorkflowConfig = {
  id: 'demo', name: 'Demo', description: 'Demo', initialState: 'name',
  states: {
    name: { type: 'collect', field: 'fullName', prompt: 'What is your name?', next: 'need' },
    need: { type: 'collect', field: 'businessNeed', prompt: 'What does your business do?', next: 'time' },
    time: { type: 'collect', field: 'preferredDemoTime', prompt: 'What day and time suit you?', next: 'phone' },
    phone: { type: 'collect', field: 'phone', prompt: 'What is your phone number?', next: 'confirm' },
    confirm: { type: 'confirm', prompt: 'confirm', next: 'done' },
    done: { type: 'end' }
  }
};

const engine = new WorkflowEngine();
const config = { ...DEFAULT_BUSINESS_CONFIG, workflows: { demo: workflow } };
function session(previous?: ReturnType<typeof session>, stateId = 'name'): WorkflowSession {
  return { id: 's1', tenantId: 't1', conversationId: 'c1', workflowId: 'demo', stateId,
    stateHistory: previous?.stateHistory || [], status: 'ACTIVE',
    contextData: previous?.contextData || {}, collectedData: previous?.collectedData || {},
    createdAt: new Date(), updatedAt: new Date() } as unknown as WorkflowSession;
}

describe('opening temporal preference', () => {
  it('keeps a literal time from a mixed demo request and skips only that later question', async () => {
    const opening = await engine.process(session(), 'I want a demo tomorrow at 3 pm. Does it work on Instagram?', workflow, config,
      undefined, undefined, undefined, undefined, 'en', 'latin');
    expect(opening.response).toContain('name');
    expect(opening.updatedCollectedData).toEqual({});
    expect(opening.updatedContext._openingTemporalPreference).toEqual(expect.objectContaining({ fieldName: 'preferredDemoTime', value: 'tomorrow at 3 pm' }));

    const named = await engine.process(session({ contextData: opening.updatedContext, collectedData: opening.updatedCollectedData, stateHistory: opening.updatedStateHistory }, 'name'),
      'Ilyes', workflow, config, undefined, undefined, undefined, undefined, 'en', 'latin');
    expect(named.nextStateId).toBe('need');
    const need = await engine.process(session({ contextData: named.updatedContext, collectedData: named.updatedCollectedData, stateHistory: named.updatedStateHistory }, 'need'),
      'I sell jeans', workflow, config, undefined, undefined, undefined, undefined, 'en', 'latin');
    expect(need.nextStateId).toBe('phone');
    expect(need.updatedCollectedData).toEqual({ fullName: 'Ilyes', businessNeed: 'I sell jeans', preferredDemoTime: 'tomorrow at 3 pm' });
    expect(need.response).toContain('phone');
    expect(need.updatedStateHistory).toContain('time');
    expect(need.updatedContext._openingTemporalPreference).toBeUndefined();
    expect(need.isComplete).toBe(false);
    const phone = await engine.process(session({ contextData: need.updatedContext, collectedData: need.updatedCollectedData, stateHistory: need.updatedStateHistory }, 'phone'),
      '0612345678', workflow, config, undefined, undefined, undefined, undefined, 'en', 'latin');
    expect(phone.nextStateId).toBe('confirm');
    expect(phone.updatedCollectedData.preferredDemoTime).toBe('tomorrow at 3 pm');
    expect(phone.isComplete).toBe(false);
  });

  it('does not turn a question about availability into a booking preference', () => {
    expect(OpeningTemporalPreference.extract('Does it work tomorrow at 3 pm? I want a demo.')).toBeNull();
    expect(OpeningTemporalPreference.extract('بغيت ديمو. واش خدام غدا مع 3 العشية؟')).toBeNull();
  });

  it('asks again when a relative opening time has gone stale', async () => {
    const stale = { _started: true, _openingTemporalPreference: {
      fieldName: 'preferredDemoTime', value: 'tomorrow at 3 pm', capturedAt: Date.now() - 2 * 60 * 60 * 1000
    } };
    const result = await engine.process(session({ contextData: stale, collectedData: { fullName: 'Ilyes' }, stateHistory: ['name'] }, 'need'),
      'I sell jeans', workflow, config, undefined, undefined, undefined, undefined, 'en', 'latin');
    expect(result.nextStateId).toBe('time');
    expect(result.updatedCollectedData.preferredDemoTime).toBeUndefined();
    expect(result.updatedContext._openingTemporalPreference).toBeUndefined();
  });

  it('retains an explicit Darija date/time phrase without inventing a confirmed appointment', () => {
    expect(OpeningTemporalPreference.extract('بغيت ديمو غدا مع 3 العشية. واش خدام فالإنستغرام؟'))
      .toBe('غدا مع 3 العشية');
    expect(OpeningTemporalPreference.extract('Je veux une démo demain à 15h. Ça marche sur Instagram ?'))
      .toBe('demain à 15h');
  });
});
