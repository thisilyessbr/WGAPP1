import { describe, expect, it } from 'vitest';
import { clientWorkflowMessage, DEFAULT_BUSINESS_CONFIG } from '../../src/domain/tenant/BusinessConfig';
import { ResponseBuilder } from '../../src/domain/conversation/ResponseBuilder';
import { validateAdminConfig } from '../../src/portal/validation';

const withPrompts = (prompts: Record<string, unknown>) => ({ ...DEFAULT_BUSINESS_CONFIG, prompts: { ...DEFAULT_BUSINESS_CONFIG.prompts, ...prompts } }) as any;

describe('client workflow messages', () => {
  it('uses the client text for that language, else the built-in text', () => {
    const config = withPrompts({ unclearReprompt: { fr: 'Oups, pas compris !', darija: 'سمح ليا ما فهمتش' } });
    expect(clientWorkflowMessage(config, 'unclearReprompt', 'fr', 'BUILT_IN')).toBe('Oups, pas compris !');
    expect(clientWorkflowMessage(config, 'unclearReprompt', 'en', 'BUILT_IN')).toBe('BUILT_IN');
    expect(clientWorkflowMessage(config, 'unclearReprompt', 'darija', 'BUILT_IN', 'arabic')).toBe('سمح ليا ما فهمتش');
    // Arabic-script Darija text is never sent to an Arabizi customer.
    expect(clientWorkflowMessage(config, 'unclearReprompt', 'darija', 'BUILT_IN', 'arabizi')).toBe('BUILT_IN');
  });

  it('never answers a French customer with English-only client text', () => {
    const config = withPrompts({ confirmHint: 'Reply yes or no please' });
    expect(clientWorkflowMessage(config, 'confirmHint', 'en', 'BUILT_IN')).toBe('Reply yes or no please');
    expect(clientWorkflowMessage(config, 'confirmHint', 'fr', 'BUILT_IN')).toBe('BUILT_IN');
    expect(clientWorkflowMessage(DEFAULT_BUSINESS_CONFIG, 'confirmHint', 'fr', 'BUILT_IN')).toBe('BUILT_IN');
  });

  it('applies the client invalid email / phone text', () => {
    const builder = new ResponseBuilder();
    const config = withPrompts({ invalidEmail: { en: 'Email please!' } });
    expect(builder.buildValidationErrorResponse('Value must be a valid email address.', 'en', 'latin', config)).toBe('Email please!');
    expect(builder.buildValidationErrorResponse('Value must be a valid email address.', 'fr', 'latin', config)).toContain('nom@gmail.com');
    expect(builder.buildValidationErrorResponse('Value must be a valid phone number.', 'en', 'latin', config)).toBe('Please type a valid phone number.');
  });

  it('the admin can save the new messages', () => {
    expect(() => validateAdminConfig({ prompts: { unclearReprompt: { en: 'Sorry?' }, confirmHint: 'yes/no', collectFallback: { fr: 'On continue :' }, invalidEmail: { ar: 'خطأ' }, invalidPhone: { darija: 'نمرة غالطة' } } })).not.toThrow();
  });
});
