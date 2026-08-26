import { describe, it, expect } from 'vitest';
import { resolveLocalizedPrompt, LocalizedPrompt, WorkflowConfig, BusinessConfig, DEFAULT_BUSINESS_CONFIG } from '../../src/domain/tenant/BusinessConfig';
import { ResponseBuilder } from '../../src/domain/conversation/ResponseBuilder';
import { WorkflowEngine } from '../../src/core/engine/WorkflowEngine';
import { WorkflowSession } from '@prisma/client';

describe('Phase FIX-PROBLEM-5A: Config-Driven Multilingual Workflow Prompts', () => {
  const responseBuilder = new ResponseBuilder();
  const engine = new WorkflowEngine();

  const localizedPrompt: LocalizedPrompt = {
    en: 'Please provide your full name:',
    fr: 'Veuillez indiquer votre nom complet :',
    ar: 'يرجى تقديم اسمك الكامل:',
    darija: 'عفاك عطيني سميتك الكاملة:'
  };

  const testWorkflow: WorkflowConfig = {
    id: 'multilingual_booking',
    name: 'Multilingual Booking',
    description: 'Workflow with multilingual localized prompts',
    initialState: 'collect_name',
    states: {
      collect_name: {
        type: 'collect',
        field: { name: 'name', type: 'string', required: true },
        prompt: localizedPrompt,
        next: 'booking_end'
      },
      booking_end: {
        type: 'end',
        prompt: {
          en: 'Your consultation is booked!',
          fr: 'Votre consultation est réservée !',
          ar: 'تم حجز استشارتك بنجاح!',
          darija: 'T-7jzat l-istichara dyalek!'
        }
      }
    }
  };

  const testConfig: BusinessConfig = {
    ...DEFAULT_BUSINESS_CONFIG,
    capabilities: {
      ecommerceEnabled: false,
      imageEnabled: false,
      intents: [
        {
          id: 'book_consultation',
          description: 'Book consultation',
          workflowId: 'multilingual_booking',
          keywords: ['بغيت نحجز', 'book consultation', 'حجز استشارة', 'bghit n7jez']
        }
      ]
    },
    workflows: {
      multilingual_booking: testWorkflow
    }
  };

  function createSession(lang: string, stateId: string = 'collect_name'): WorkflowSession {
    return {
      id: `sess-${Date.now()}-${Math.random()}`,
      tenantId: 'test-tenant',
      conversationId: 'test-conv',
      workflowId: 'multilingual_booking',
      stateId,
      status: 'ACTIVE',
      contextData: { _started: true, _lang: lang },
      stateHistory: [],
      collectedData: {},
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }

  it('A. Localized prompt + Arabic -> Arabic prompt returned', () => {
    const res = resolveLocalizedPrompt(localizedPrompt, 'ar', 'default');
    expect(res).toBe('يرجى تقديم اسمك الكامل:');

    const missingField = responseBuilder.buildMissingFieldResponse(testWorkflow.states.collect_name, testConfig, 'ar');
    expect(missingField).toBe('يرجى تقديم اسمك الكامل:');
  });

  it('B. Localized prompt + Darija -> Darija prompt returned', () => {
    const res = resolveLocalizedPrompt(localizedPrompt, 'darija', 'default');
    expect(res).toBe('عفاك عطيني سميتك الكاملة:');

    const missingField = responseBuilder.buildMissingFieldResponse(testWorkflow.states.collect_name, testConfig, 'darija');
    expect(missingField).toBe('عفاك عطيني سميتك الكاملة:');
  });

  it('C. Localized prompt + French -> French prompt returned', () => {
    const res = resolveLocalizedPrompt(localizedPrompt, 'fr', 'default');
    expect(res).toBe('Veuillez indiquer votre nom complet :');

    const missingField = responseBuilder.buildMissingFieldResponse(testWorkflow.states.collect_name, testConfig, 'fr');
    expect(missingField).toBe('Veuillez indiquer votre nom complet :');
  });

  it('D. Localized prompt + English -> English prompt returned', () => {
    const res = resolveLocalizedPrompt(localizedPrompt, 'en', 'default');
    expect(res).toBe('Please provide your full name:');

    const missingField = responseBuilder.buildMissingFieldResponse(testWorkflow.states.collect_name, testConfig, 'en');
    expect(missingField).toBe('Please provide your full name:');
  });

  it('E. Localized prompt missing requested language -> fallbacks to prompt.en', () => {
    const partialPrompt: LocalizedPrompt = {
      en: 'English fallback prompt',
      fr: 'Prompt français'
    };
    const res = resolveLocalizedPrompt(partialPrompt, 'ar', 'default');
    expect(res).toBe('English fallback prompt');
  });

  it('F. Legacy string prompt -> remains backward-compatible', () => {
    const legacyPrompt = 'Please enter your name:';
    const resAr = resolveLocalizedPrompt(legacyPrompt, 'ar', 'default');
    const resFr = resolveLocalizedPrompt(legacyPrompt, 'fr', 'default');
    expect(resAr).toBe('Please enter your name:');
    expect(resFr).toBe('Please enter your name:');
  });

  it('G. Arabizi user -> uses Darija localized prompt and advances cleanly', async () => {
    const session = createSession('darija');
    // User provides valid name in Latin/Arabizi
    const res = await engine.process(session, 'Mehdi Bennani', testWorkflow, testConfig);

    expect(res.nextStateId).toBe('booking_end');
    expect(res.response).toBe('T-7jzat l-istichara dyalek!');
  });

  it('H. UI round-trip: save localized prompt object -> reload -> values preserved', () => {
    const stateObj = {
      type: 'collect' as const,
      field: 'fullName',
      prompt: {
        en: 'Enter your name:',
        fr: 'Entrez votre nom :',
        ar: 'أدخل اسمك:',
        darija: 'عطيني سميتك:'
      }
    };

    // Serialize / deserialize simulating API payload
    const serialized = JSON.stringify(stateObj);
    const deserialized = JSON.parse(serialized);

    expect(deserialized.prompt.en).toBe('Enter your name:');
    expect(deserialized.prompt.fr).toBe('Entrez votre nom :');
    expect(deserialized.prompt.ar).toBe('أدخل اسمك:');
    expect(deserialized.prompt.darija).toBe('عطيني سميتك:');
    expect(resolveLocalizedPrompt(deserialized.prompt, 'ar', '')).toBe('أدخل اسمك:');
  });
});
