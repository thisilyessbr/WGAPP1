import { describe, expect, it } from 'vitest';
import { workflowOpeningAnswer } from '../../src/domain/conversation/WorkflowOpeningAnswer';
import { DEFAULT_BUSINESS_CONFIG } from '../../src/domain/tenant/BusinessConfig';

describe('a question alongside a workflow request', () => {
  const config = structuredClone(DEFAULT_BUSINESS_CONFIG);
  config.portalFacts = {
    policies: {
      payment: 'لا نطلب بيانات البطاقة. السعر حسب الباقة والاحتياج؛ يؤكده الفريق.'
    }
  };

  it('answers the approved price policy before the demo prompt', () => {
    expect(workflowOpeningAnswer('Bghit nchri wa7d chatbot, ch7al taman?', config, 'darija', 'arabic'))
      .toBe('السعر حسب الباقة والاحتياج');
  });

  it('does not answer a different question using the price policy', () => {
    expect(workflowOpeningAnswer('Bghit demo, wach kaykhdem f Instagram?', config, 'darija', 'arabic'))
      .toBeNull();
  });

  it('never uses an Arabic-only policy in a Latin-script answer', () => {
    expect(workflowOpeningAnswer('bghit demo, ch7al taman?', config, 'darija', 'arabizi'))
      .toBeNull();
  });

  it('does not change simple workflow requests', () => {
    expect(workflowOpeningAnswer('bghit demo', config, 'darija', 'arabic')).toBeNull();
  });

  it('uses a matching localized FAQ for other separate questions', () => {
    const withFaq = structuredClone(config);
    withFaq.capabilities.faq = [{
      id: 'instagram', language: 'darija', question: 'واش خدام ف Instagram?',
      answer: 'Instagram DM متاح حسب الباقة وربط الحساب.'
    }];
    expect(workflowOpeningAnswer('بغيت ديمو، واش خدام ف Instagram?', withFaq, 'darija', 'arabic'))
      .toBe('Instagram DM متاح حسب الباقة وربط الحساب.');
  });
});
