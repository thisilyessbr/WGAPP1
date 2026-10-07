import { describe, expect, it } from 'vitest';
import { WorkflowSession } from '@prisma/client';
import { WorkflowEngine } from '../../src/core/engine/WorkflowEngine';
import { DEFAULT_BUSINESS_CONFIG, WorkflowConfig } from '../../src/domain/tenant/BusinessConfig';
import { ResponseBuilder } from '../../src/domain/conversation/ResponseBuilder';

const workflow: WorkflowConfig = {
  id: 'relayqo_demo',
  name: 'Relayqo demo request',
  initialState: 'name',
  allowInterruption: true,
  outcome: { createLead: true, requestHumanHandoff: true, pauseBotHours: 24 },
  states: {
    name: { type: 'collect', field: { name: 'fullName', type: 'string', required: true, minLength: 2 }, next: 'need' },
    need: { type: 'collect', field: { name: 'businessNeed', type: 'string', required: true, minLength: 3 }, next: 'time' },
    time: { type: 'collect', field: { name: 'preferredDemoTime', type: 'string', required: true, minLength: 3 }, next: 'phone' },
    phone: { type: 'collect', field: { name: 'phone', type: 'phone', required: true }, next: 'confirm' },
    confirm: { type: 'confirm', next: 'team' },
    team: {
      type: 'handoff',
      pauseBotHours: 24,
      prompt: {
        en: 'Thank you. Your demo request is registered and our team will contact you.',
        fr: 'Merci. Votre demande de démo est enregistrée et notre équipe vous contactera.',
        ar: 'شكراً. تم تسجيل طلب العرض وسيتواصل معك فريقنا.',
        darija_arabic: 'شكرا، تسجل طلب الديمو ديالك. الفريق غادي يتاصل بك.',
        darija_arabizi: 'Chokran, talab demo dyalek tsjjel. L-fariq ghadi y-ttasel bik.'
      }
    }
  }
};

const engine = new WorkflowEngine({ evaluateNextState: async () => null } as any);

function session(stateId: string, data: Record<string, unknown> = {}, lang = 'darija', script = 'arabic'): WorkflowSession {
  return {
    id: `session-${stateId}`,
    tenantId: 'relayqo-tenant',
    conversationId: 'isolated-test-conversation',
    workflowId: workflow.id,
    stateId,
    status: 'ACTIVE',
    contextData: { _started: true, _lang: lang, _script: script, ...data },
    collectedData: { ...data },
    stateHistory: [],
    createdAt: new Date(),
    updatedAt: new Date()
  };
}

async function completeJourney(lang: string, script: string, answers: string[], confirmation: string) {
  let current = session('name', {}, lang, script);
  const responses: string[] = [];
  for (const answer of answers) {
    const result = await engine.process(current, answer, workflow, DEFAULT_BUSINESS_CONFIG, undefined, undefined, undefined, undefined, lang, script);
    responses.push(result.response);
    current = { ...current, stateId: result.nextStateId!, contextData: result.updatedContext, collectedData: result.updatedCollectedData || {} };
  }
  const confirmed = await engine.process(current, confirmation, workflow, DEFAULT_BUSINESS_CONFIG, undefined, undefined, undefined, undefined, lang, script);
  return { responses, confirmed };
}

describe('Relayqo customer journey acceptance matrix', () => {
  it.each([
    ['darija', 'arabic', ['إلياس صابر', 'بغيتو للإيكوميرس ديالي', 'غدا مع 11', '0649402305'], 'واخا'],
    ['darija', 'arabizi', ['Ilyes Saber', 'Bghito l ecommerce diali', 'Gheda m3a 11', '0649402305'], 'Ih bghit nconfirme'],
    ['fr', 'latin', ['Ilyes Saber', 'Automatiser le support client', 'Demain à 11h', '+212649402305'], 'Je confirme'],
    ['en', 'latin', ['Ilyes Saber', 'Automate customer support', 'Tomorrow at 11', '+212649402305'], 'yes']
  ])('completes a %s/%s demo request once with durable CRM and handoff outcomes', async (lang, script, answers, confirmation) => {
    const { confirmed } = await completeJourney(lang, script, answers, confirmation);
    expect(confirmed.isComplete, JSON.stringify(confirmed)).toBe(true);
    expect(confirmed.nextStateId).toBe('team');
    expect(confirmed.updatedCollectedData).toMatchObject({
      fullName: answers[0], businessNeed: answers[1], preferredDemoTime: answers[2], phone: answers[3], _confirmed: true
    });
    expect(confirmed.createLead).toBe(true);
    expect(confirmed.requestHumanHandoff).toBe(true);
    expect(confirmed.handoffPauseHours).toBe(24);
  });

  it.each([
    ['darija', 'arabic', 'ماشي نمرة', /نمرة تليفون صحيحة/, /[\u0600-\u06ff]/],
    ['darija', 'arabizi', 'not a phone', /nemra dyal telephone s7i7a/i, /^[^\u0600-\u06ff]+$/],
    ['fr', 'latin', 'pas un téléphone', /numéro de téléphone valide/i, /^[^\u0600-\u06ff]+$/],
    ['ar', 'arabic', 'ليس هاتفاً', /رقم هاتف صحيح/, /[\u0600-\u06ff]/]
  ])('keeps invalid phone input in the same %s/%s language and preserves prior data', async (lang, script, input, messagePattern, scriptPattern) => {
    const prior = { fullName: 'Ilyes Saber', businessNeed: 'Ecommerce', preferredDemoTime: 'غدا مع 11' };
    const result = await engine.process(session('phone', prior, lang, script), input, workflow, DEFAULT_BUSINESS_CONFIG, undefined, undefined, undefined, undefined, lang, script);
    expect(result.nextStateId).toBe('phone');
    expect(result.updatedCollectedData).toEqual(prior);
    expect(result.response).toMatch(messagePattern);
    expect(result.response).toMatch(scriptPattern);
    expect(result.response).not.toContain('Value must be');
  });

  it.each([
    ['darija', 'arabic', ['السمية', 'الاحتياج', 'الموعد المفضل', 'نمرة التليفون']],
    ['darija', 'arabizi', ['Smiya kamla', 'Chno bghiti chatbot y3awnek fih', 'Nhar w lwe9t li ynasbk', 'Téléphone']],
    ['fr', 'latin', ['Nom complet', 'Besoin', 'Créneau souhaité', 'Téléphone']],
    ['en', 'latin', ['Full name', 'Need', 'Preferred demo time', 'Phone']]
  ])('shows human confirmation labels in %s/%s and never internal field keys', (lang, script, labels) => {
    const response = new ResponseBuilder().buildConfirmationResponse({
      fullName: 'Ilyes Saber', businessNeed: 'Ecommerce', preferredDemoTime: '11:00', phone: '0649402305'
    }, DEFAULT_BUSINESS_CONFIG, undefined, lang, script);
    for (const label of labels) expect(response).toContain(label);
    expect(response).not.toMatch(/fullName|businessNeed|preferredDemoTime/);
  });

  it.each(['Wakha', 'Ui baghi', 'Ih bghit nconfirme', 'Ah bghit', 'اه بغيت', 'إيه بغيت نأكد', 'Je confirme', 'yes'])(
    'accepts common customer confirmation “%s” exactly once', async confirmation => {
      const result = await engine.process(session('confirm', {
        fullName: 'Ilyes', businessNeed: 'Ecommerce', preferredDemoTime: '11:00', phone: '0649402305'
      }, 'darija', /[\u0600-\u06ff]/.test(confirmation) ? 'arabic' : 'arabizi'), confirmation, workflow, DEFAULT_BUSINESS_CONFIG, undefined, undefined, undefined, undefined, 'darija', /[\u0600-\u06ff]/.test(confirmation) ? 'arabic' : 'arabizi');
      expect(result.isComplete).toBe(true);
      expect(result.updatedCollectedData?._confirmed).toBe(true);
      expect(result.requestHumanHandoff).toBe(true);
    }
  );

  it.each(['لا', 'ما بغيتش', 'mabghitch', 'non', 'cancel'])(
    'cancels cleanly on “%s” without creating a lead or handoff', async refusal => {
      const result = await engine.process(session('confirm', {
        fullName: 'Ilyes', businessNeed: 'Ecommerce', preferredDemoTime: '11:00', phone: '0649402305'
      }), refusal, workflow, DEFAULT_BUSINESS_CONFIG, undefined, undefined, undefined, undefined, 'darija', /[\u0600-\u06ff]/.test(refusal) ? 'arabic' : 'arabizi');
      expect(result.isComplete).toBe(true);
      expect(result.nextStateId).toBeNull();
      expect(result.updatedCollectedData?._confirmed).toBe(false);
      expect(result.createLead).toBeUndefined();
      expect(result.requestHumanHandoff).toBeUndefined();
    }
  );

  it.each(['ما بغيتش نكمل', 'mabghitch nkemmel', 'cancel'])(
    'cancels during data collection on “%s” without creating CRM outcomes', async refusal => {
      const result = await engine.process(session('phone', {
        fullName: 'Ilyes', businessNeed: 'Ecommerce', preferredDemoTime: '11:00'
      }), refusal, workflow, DEFAULT_BUSINESS_CONFIG, undefined, undefined, undefined, undefined, 'darija', /[\u0600-\u06ff]/.test(refusal) ? 'arabic' : 'arabizi');
      expect(result.isComplete).toBe(true);
      expect(result.updatedCollectedData?._confirmed).toBe(false);
      expect(result.createLead).toBeUndefined();
      expect(result.requestHumanHandoff).toBeUndefined();
    }
  );

  it.each(['Automate customer support', 'Automatiser le support client', 'نبغي نأوتوماتيزي خدمة الزبناء'])(
    'stores a legitimate descriptive need containing an intent phrase: “%s”', async need => {
      const script = /[\u0600-\u06ff]/.test(need) ? 'arabic' : 'latin';
      const lang = script === 'arabic' ? 'darija' : (need.includes('Automatiser') ? 'fr' : 'en');
      const result = await engine.process(session('need', { fullName: 'Ilyes' }, lang, script), need, workflow, DEFAULT_BUSINESS_CONFIG, undefined, undefined, undefined, undefined, lang, script);
      expect(result.nextStateId).toBe('time');
      expect(result.updatedCollectedData?.businessNeed).toBe(need);
    }
  );

  it.each(['سلام', 'salam', 'hello', 'bonjour'])(
    'does not save a greeting “%s” as the customer name', async greeting => {
      const result = await engine.process(session('name'), greeting, workflow, DEFAULT_BUSINESS_CONFIG, undefined, undefined, undefined, undefined, 'darija', /[\u0600-\u06ff]/.test(greeting) ? 'arabic' : 'arabizi');
      expect(result.nextStateId).toBe('name');
      expect(result.updatedCollectedData?.fullName).toBeUndefined();
    }
  );

  it('does not lose collected details when confirmation is unclear', async () => {
    const data = { fullName: 'Ilyes', businessNeed: 'Ecommerce', preferredDemoTime: '11:00', phone: '0649402305' };
    const result = await engine.process(session('confirm', data), 'واخا ولكن بدل الوقت', workflow, DEFAULT_BUSINESS_CONFIG, undefined, undefined, undefined, undefined, 'darija', 'arabic');
    expect(result.isComplete).toBe(false);
    expect(result.nextStateId).toBe('confirm');
    expect(result.updatedCollectedData).toEqual(data);
  });
});
