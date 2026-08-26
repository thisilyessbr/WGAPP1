import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LanguageDetector } from '../../src/domain/faq/FaqMatcher';
import { DirectRagGuard } from '../../src/domain/rag/DirectRagGuard';
import { TurnDecisionResolver } from '../../src/domain/conversation/TurnDecision';
import { WorkflowEngine } from '../../src/core/engine/WorkflowEngine';
import { WorkflowConfig, BusinessConfig, DEFAULT_BUSINESS_CONFIG } from '../../src/domain/tenant/BusinessConfig';
import { WorkflowSession } from '@prisma/client';

describe('Phase COST-FIX-46D: Single Authoritative Language Detection Per Turn', () => {
  const engine = new WorkflowEngine();

  const mockMultilingualWorkflow: WorkflowConfig = {
    id: 'lang_test_wf',
    name: 'Language Test Workflow',
    description: 'Test workflow for language resolution',
    initialState: 'collect_name',
    states: {
      collect_name: {
        type: 'collect',
        field: { name: 'name', type: 'string', required: true, minLength: 2 },
        prompt: {
          en: 'Please enter your name:',
          fr: 'Veuillez entrer votre nom :',
          ar: 'يرجى إدخال اسمك:',
          darija: 'عفاك دخل سميتك:'
        },
        next: 'confirm'
      },
      confirm: {
        type: 'confirm',
        prompt: {
          en: 'Confirm name: {name}',
          fr: 'Confirmez le nom : {name}',
          ar: 'تأكيد الاسم: {name}',
          darija: 'تأكيد الاسم: {name}'
        },
        next: 'end'
      },
      end: {
        type: 'end',
        prompt: {
          en: 'Done {name}!',
          fr: 'Terminé {name} !',
          ar: 'تم {name}!',
          darija: 'سالينا {name}!'
        }
      }
    }
  };

  const testConfig: BusinessConfig = {
    ...DEFAULT_BUSINESS_CONFIG,
    capabilities: {
      ecommerceEnabled: false,
      imageEnabled: false,
      faq: [
        {
          id: 'faq_price',
          questions: {
            en: 'How much does it cost?',
            fr: 'Combien ça coûte ?',
            ar: 'كم السعر؟',
            darija: 'شحال الثمن؟'
          },
          answers: {
            en: 'Price is 750 MAD.',
            fr: 'Le prix est de 750 MAD.',
            ar: 'السعر هو 750 درهم.',
            darija: 'الثمن هو 750 درهم.'
          }
        }
      ]
    },
    workflows: {
      lang_test_wf: mockMultilingualWorkflow
    }
  };

  function createSession(stateId: string = 'collect_name', collectedData: Record<string, any> = {}): WorkflowSession {
    return {
      id: 'sess-lang-test',
      tenantId: 'tenant-test',
      conversationId: 'conv-test',
      workflowId: 'lang_test_wf',
      stateId,
      status: 'ACTIVE',
      contextData: { _started: true, ...collectedData },
      stateHistory: [],
      collectedData,
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }

  it('A. Arabic turn -> resolves ar / arabic correctly', () => {
    const text = 'ما هي خدماتكم المتاحة؟';
    const lang = LanguageDetector.detect(text);
    const script = DirectRagGuard.detectScript(text, lang);
    expect(lang).toBe('ar');
    expect(script).toBe('arabic');
  });

  it('B. English turn -> resolves en / latin correctly', () => {
    const text = 'How much does it cost?';
    const lang = LanguageDetector.detect(text);
    const script = DirectRagGuard.detectScript(text, lang);
    expect(lang).toBe('en');
    expect(script).toBe('latin');
  });

  it('C. French turn -> resolves fr / latin correctly', () => {
    const text = 'Quels sont vos horaires douverture ?';
    const lang = LanguageDetector.detect(text);
    const script = DirectRagGuard.detectScript(text, lang);
    expect(lang).toBe('fr');
    expect(script).toBe('latin');
  });

  it('D. Darija Arabic script -> resolves darija / arabic correctly', () => {
    const text = 'شحال الثمن ديال الاستشارة؟';
    const lang = LanguageDetector.detect(text);
    const script = DirectRagGuard.detectScript(text, lang);
    expect(lang).toBe('darija');
    expect(script).toBe('arabic');
  });

  it('E. Darija Arabizi -> resolves darija / arabizi correctly', () => {
    const text = 'bghit n3rf chhal taman 3afak';
    const lang = LanguageDetector.detect(text);
    const script = DirectRagGuard.detectScript(text, lang);
    expect(lang).toBe('darija');
    expect(script).toBe('arabizi');
  });

  it('F. WorkflowEngine.process uses passed effectiveLang and skips LanguageDetector.detect', async () => {
    const detectSpy = vi.spyOn(LanguageDetector, 'detect');
    const session = createSession('collect_name');

    // Call process with explicit effectiveLang and effectiveScript
    const res = await engine.process(
      session,
      'Ilyes Saber',
      mockMultilingualWorkflow,
      testConfig,
      undefined,
      undefined,
      undefined,
      'corr-123',
      'fr',
      'latin'
    );

    // Assert that LanguageDetector.detect was NOT invoked inside WorkflowEngine.process
    expect(detectSpy).not.toHaveBeenCalled();
    expect(res.nextStateId).toBe('confirm');
    expect(res.updatedContext?.['_lang']).toBe('fr');
    expect(res.response).toContain('Confirmez le nom : Ilyes Saber');
    detectSpy.mockRestore();
  });

  it('G. TurnDecisionResolver uses passed language without re-detection', () => {
    const detectSpy = vi.spyOn(LanguageDetector, 'detect');
    const decision = TurnDecisionResolver.resolve({
      text: 'How much does it cost?',
      language: 'en',
      script: 'latin',
      isGreeting: false,
      isHandoff: false,
      isWorkflow: false
    });

    expect(detectSpy).not.toHaveBeenCalled();
    expect(decision.responseLanguage).toBe('en');
    expect(decision.responseScript).toBe('latin');
    detectSpy.mockRestore();
  });

  it('H. Multilingual prompt rendering respects passed language for Arabic, French, Darija', async () => {
    const sessionFr = createSession('collect_name');
    const resFr = await engine.process(sessionFr, 'Jean Dupont', mockMultilingualWorkflow, testConfig, undefined, undefined, undefined, 'corr-fr', 'fr', 'latin');
    expect(resFr.response).toContain('Confirmez le nom : Jean Dupont');

    const sessionAr = createSession('collect_name');
    const resAr = await engine.process(sessionAr, 'كريم العلمي', mockMultilingualWorkflow, testConfig, undefined, undefined, undefined, 'corr-ar', 'ar', 'arabic');
    expect(resAr.response).toContain('تأكيد الاسم: كريم العلمي');

    const sessionDarija = createSession('collect_name');
    const resDarija = await engine.process(sessionDarija, 'Reda Bennani', mockMultilingualWorkflow, testConfig, undefined, undefined, undefined, 'corr-dar', 'darija', 'arabizi');
    expect(resDarija.response).toContain('تأكيد الاسم: Reda Bennani');
  });

  it('I. End state template interpolation works seamlessly with passed language', async () => {
    const session = createSession('confirm', { name: 'Saber' });
    const res = await engine.process(session, 'yes', mockMultilingualWorkflow, testConfig, undefined, undefined, undefined, 'corr-end', 'fr', 'latin');
    expect(res.isComplete).toBe(true);
    expect(res.response).toBe('Terminé Saber !');
  });
});
