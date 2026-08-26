import { describe, it, expect } from 'vitest';
import {
  BusinessConfig,
  DEFAULT_BUSINESS_CONFIG,
  DEFAULT_POST_COMPLETION_MESSAGES,
  DEFAULT_HANDOFF_MESSAGES,
  DEFAULT_IMAGE_FALLBACK_MESSAGES,
  DEFAULT_LIMIT_EXCEEDED_MESSAGES,
  resolveLocalizedPrompt
} from '../../src/domain/tenant/BusinessConfig';
import { AnswerComposer } from '../../src/domain/conversation/AnswerComposer';
import { ResponseBuilder, DEFAULT_WORKFLOW_MESSAGES } from '../../src/domain/conversation/ResponseBuilder';

describe('PHASE ARCH-FIX-47H — Config-Driven Multilingual Customer Prompts', () => {
  // Test A: Custom English closing
  it('A. Custom English closing: resolves configured postCompletionClosing for English', () => {
    const config: Partial<BusinessConfig> = {
      prompts: {
        ...DEFAULT_BUSINESS_CONFIG.prompts,
        postCompletionClosing: {
          en: 'Our dedicated booking team will reach out shortly.',
          fr: 'Notre équipe de réservation vous contactera sous peu.'
        }
      }
    };

    const resolved = resolveLocalizedPrompt(
      config.prompts?.postCompletionClosing,
      'en',
      DEFAULT_POST_COMPLETION_MESSAGES.closing.en
    );

    expect(resolved).toBe('Our dedicated booking team will reach out shortly.');
    expect(resolved).not.toContain('support team');
  });

  // Test B: Custom French closing
  it('B. Custom French closing: resolves configured postCompletionClosing for French', () => {
    const config: Partial<BusinessConfig> = {
      prompts: {
        ...DEFAULT_BUSINESS_CONFIG.prompts,
        postCompletionClosing: {
          en: 'Our clinical team will follow up with you.',
          fr: 'Notre équipe médicale vous recontactera très rapidement.'
        }
      }
    };

    const resolved = resolveLocalizedPrompt(
      config.prompts?.postCompletionClosing,
      'fr',
      DEFAULT_POST_COMPLETION_MESSAGES.closing.fr
    );

    expect(resolved).toBe('Notre équipe médicale vous recontactera très rapidement.');
  });

  // Test C: Custom Arabic closing
  it('C. Custom Arabic closing: resolves configured postCompletionClosing for Arabic', () => {
    const config: Partial<BusinessConfig> = {
      prompts: {
        ...DEFAULT_BUSINESS_CONFIG.prompts,
        postCompletionClosing: {
          en: 'Our sales team will follow up.',
          ar: 'سيتواصل معك مستشار المبيعات قريباً.'
        }
      }
    };

    const resolved = resolveLocalizedPrompt(
      config.prompts?.postCompletionClosing,
      'ar',
      DEFAULT_POST_COMPLETION_MESSAGES.closing.ar
    );

    expect(resolved).toBe('سيتواصل معك مستشار المبيعات قريباً.');
  });

  // Test D: Custom Darija closing
  it('D. Custom Darija closing: resolves configured postCompletionClosing for Darija', () => {
    const config: Partial<BusinessConfig> = {
      prompts: {
        ...DEFAULT_BUSINESS_CONFIG.prompts,
        postCompletionClosing: {
          en: 'Our team will call you.',
          darija: 'ghadi y-3eyyet lik l-moustachar dyalna 9riban.'
        }
      }
    };

    const resolved = resolveLocalizedPrompt(
      config.prompts?.postCompletionClosing,
      'darija',
      DEFAULT_POST_COMPLETION_MESSAGES.closing.darija
    );

    expect(resolved).toBe('ghadi y-3eyyet lik l-moustachar dyalna 9riban.');
  });

  // Test E: Missing locale fallback
  it('E. Missing locale fallback: falls back to English when target locale is unconfigured', () => {
    const config: Partial<BusinessConfig> = {
      prompts: {
        ...DEFAULT_BUSINESS_CONFIG.prompts,
        postCompletionClosing: {
          en: 'Our store manager will be in touch.'
        }
      }
    };

    const resolved = resolveLocalizedPrompt(
      config.prompts?.postCompletionClosing,
      'es', // unconfigured locale
      DEFAULT_POST_COMPLETION_MESSAGES.closing.en
    );

    expect(resolved).toBe('Our store manager will be in touch.');
  });

  // Test F: Zero-config defaults
  it('F. Zero-config defaults: uses neutral system defaults when no config provided', () => {
    const config: Partial<BusinessConfig> = {
      prompts: {
        ...DEFAULT_BUSINESS_CONFIG.prompts,
        postCompletionClosing: undefined,
        postCompletionFallback: undefined
      }
    };

    const closingEn = resolveLocalizedPrompt(
      config.prompts?.postCompletionClosing,
      'en',
      DEFAULT_POST_COMPLETION_MESSAGES.closing.en
    );
    expect(closingEn).toBe(DEFAULT_POST_COMPLETION_MESSAGES.closing.en);
    expect(closingEn).toContain('our team');

    const closingFr = resolveLocalizedPrompt(
      config.prompts?.postCompletionClosing,
      'fr',
      DEFAULT_POST_COMPLETION_MESSAGES.closing.fr
    );
    expect(closingFr).toBe(DEFAULT_POST_COMPLETION_MESSAGES.closing.fr);
    expect(closingFr).toContain('notre équipe');
  });

  // Test G: Post-completion unmatched query fallback
  it('G. Post-completion unmatched query: resolves localized postCompletionFallback', () => {
    const config: Partial<BusinessConfig> = {
      prompts: {
        ...DEFAULT_BUSINESS_CONFIG.prompts,
        postCompletionFallback: {
          en: 'I can only assist with your consultation appointment.',
          fr: 'Je peux uniquement vous aider concernant votre rendez-vous.'
        }
      }
    };

    const enFallback = resolveLocalizedPrompt(
      config.prompts?.postCompletionFallback,
      'en',
      DEFAULT_POST_COMPLETION_MESSAGES.fallback.en
    );
    expect(enFallback).toBe('I can only assist with your consultation appointment.');

    const frFallback = resolveLocalizedPrompt(
      config.prompts?.postCompletionFallback,
      'fr',
      DEFAULT_POST_COMPLETION_MESSAGES.fallback.fr
    );
    expect(frFallback).toBe('Je peux uniquement vous aider concernant votre rendez-vous.');
  });

  // Test H: Localized handoff
  it('H. Localized handoff: AnswerComposer.composeHandoff resolves multilingual prompt', () => {
    const customConfig: BusinessConfig = {
      ...DEFAULT_BUSINESS_CONFIG,
      prompts: {
        ...DEFAULT_BUSINESS_CONFIG.prompts,
        handoff: {
          en: 'Connecting you to our medical team.',
          fr: 'Nous vous mettons en relation avec notre service médical.'
        }
      }
    };

    const enHandoff = AnswerComposer.composeHandoff({
      turnDecision: { domain: 'HANDOFF', intent: 'HUMAN_HANDOFF' } as any,
      config: customConfig,
      responseLanguage: 'en'
    });
    expect(enHandoff).toBe('Connecting you to our medical team.');

    const frHandoff = AnswerComposer.composeHandoff({
      turnDecision: { domain: 'HANDOFF', intent: 'HUMAN_HANDOFF' } as any,
      config: customConfig,
      responseLanguage: 'fr'
    });
    expect(frHandoff).toBe('Nous vous mettons en relation avec notre service médical.');

    // Default handoff when unconfigured
    const defaultHandoff = AnswerComposer.composeHandoff({
      turnDecision: { domain: 'HANDOFF', intent: 'HUMAN_HANDOFF' } as any,
      config: DEFAULT_BUSINESS_CONFIG,
      responseLanguage: 'en'
    });
    expect(defaultHandoff).toBe(DEFAULT_HANDOFF_MESSAGES.en);
  });

  // Test I: Localized image fallback
  it('I. Localized image fallback: resolves configured and default image fallbacks', () => {
    const customConfig: BusinessConfig = {
      ...DEFAULT_BUSINESS_CONFIG,
      prompts: {
        ...DEFAULT_BUSINESS_CONFIG.prompts,
        imageFallback: {
          en: 'Please type the name of the prescription instead of uploading a photo.',
          fr: 'Veuillez saisir le nom de l’ordonnance au lieu de télécharger une photo.'
        }
      }
    };

    const enImg = resolveLocalizedPrompt(
      customConfig.prompts?.imageFallback,
      'en',
      DEFAULT_IMAGE_FALLBACK_MESSAGES.en
    );
    expect(enImg).toBe('Please type the name of the prescription instead of uploading a photo.');

    const defaultArImg = resolveLocalizedPrompt(
      DEFAULT_BUSINESS_CONFIG.prompts?.imageFallback,
      'ar',
      DEFAULT_IMAGE_FALLBACK_MESSAGES.ar
    );
    expect(defaultArImg).toBe(DEFAULT_IMAGE_FALLBACK_MESSAGES.ar);
  });

  // Test J: Localized limit exceeded
  it('J. Localized limit exceeded: resolves configured limit exceeded prompts across languages', () => {
    const customConfig: BusinessConfig = {
      ...DEFAULT_BUSINESS_CONFIG,
      prompts: {
        ...DEFAULT_BUSINESS_CONFIG.prompts,
        limitExceeded: {
          en: 'Session limit reached. Please restart.',
          fr: 'Limite de session atteinte. Veuillez recommencer.'
        }
      }
    };

    const enLimit = resolveLocalizedPrompt(
      customConfig.prompts?.limitExceeded,
      'en',
      DEFAULT_LIMIT_EXCEEDED_MESSAGES.en
    );
    expect(enLimit).toBe('Session limit reached. Please restart.');

    const frLimit = resolveLocalizedPrompt(
      customConfig.prompts?.limitExceeded,
      'fr',
      DEFAULT_LIMIT_EXCEEDED_MESSAGES.fr
    );
    expect(frLimit).toBe('Limite de session atteinte. Veuillez recommencer.');
  });

  // Test K: Legacy string prompt compatibility
  it('K. Legacy string prompt compatibility: supports legacy string configuration without errors', () => {
    const legacyConfig: Partial<BusinessConfig> = {
      prompts: {
        ...DEFAULT_BUSINESS_CONFIG.prompts,
        handoff: 'Hold on, transfer in progress.' as any,
        postCompletionFallback: 'We will call you soon.' as any,
        limitExceeded: 'Max turns reached.' as any
      }
    };

    const handoff = resolveLocalizedPrompt(
      legacyConfig.prompts?.handoff,
      'fr',
      DEFAULT_HANDOFF_MESSAGES.en
    );
    expect(handoff).toBe('Hold on, transfer in progress.');

    const fallback = resolveLocalizedPrompt(
      legacyConfig.prompts?.postCompletionFallback,
      'ar',
      DEFAULT_POST_COMPLETION_MESSAGES.fallback.en
    );
    expect(fallback).toBe('We will call you soon.');
  });

  // Test L: No unresolved placeholders or [object Object]
  it('L. Robustness: never outputs [object Object] or raw object placeholders', () => {
    const messyPrompt: any = {
      en: '   ',
      fr: ''
    };

    const resolved = resolveLocalizedPrompt(
      messyPrompt,
      'en',
      'Safe Default String'
    );
    expect(resolved).toBe('Safe Default String');
    expect(resolved).not.toContain('[object Object]');
  });

  // Test M: Normal workflow completion unchanged
  it('M. Workflow completion unchanged: ResponseBuilder and DEFAULT_WORKFLOW_MESSAGES remain intact', () => {
    const responseBuilder = new ResponseBuilder();
    const config: BusinessConfig = {
      ...DEFAULT_BUSINESS_CONFIG
    };

    const missingField = responseBuilder.buildMissingFieldResponse(
      { type: 'collect', field: 'customerEmail' } as any,
      config,
      'en'
    );
    expect(missingField).toBe('Please provide: customerEmail');

    const frMissing = responseBuilder.buildMissingFieldResponse(
      { type: 'collect', field: 'customerEmail' } as any,
      config,
      'fr'
    );
    expect(frMissing).toBe('Veuillez fournir : customerEmail');
  });

  // Test N: Arabizi response-script behavior preserved
  it('N. Arabizi response-script: AnswerComposer respects Arabizi script for Darija handoff', () => {
    const handoffArabizi = AnswerComposer.composeHandoff({
      turnDecision: { domain: 'HANDOFF', intent: 'HUMAN_HANDOFF' } as any,
      config: DEFAULT_BUSINESS_CONFIG,
      responseLanguage: 'darija',
      responseScript: 'arabizi'
    });
    expect(handoffArabizi).toBe('ghadi n7ewlek l 3end wa7d mn l-fariq dyalna.');
  });
});
