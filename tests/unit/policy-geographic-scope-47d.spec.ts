import { describe, it, expect } from 'vitest';
import { PolicyEvidenceReuse } from '../../src/domain/rag/PolicyEvidenceReuse';
import { PolicyEvidence } from '../../src/domain/rag/PolicyEvidence';
import { BusinessConfig } from '../../src/domain/tenant/BusinessConfig';
import { TurnDecisionResolver } from '../../src/domain/conversation/TurnDecision';

describe('PHASE ARCH-FIX-47D — Generic Tenant-Relative Shipping Scope', () => {
  const moroccoConfig = {
    identity: { country: 'Morocco', botName: 'Bot', language: 'en' }
  } as BusinessConfig;

  const usConfig = {
    identity: { country: 'United States', botName: 'Bot', language: 'en' }
  } as BusinessConfig;

  const franceConfig = {
    identity: { country: 'France', botName: 'Bot', language: 'fr' }
  } as BusinessConfig;

  const worldwideConfig = {
    identity: { country: 'United States', botName: 'Bot', language: 'en' },
    capabilities: {
      intents: [],
      shippingScope: {
        scope: 'WORLDWIDE',
        domesticCountry: 'United States'
      }
    }
  } as BusinessConfig;

  const selectedCountriesConfig = {
    identity: { country: 'France', botName: 'Bot', language: 'fr' },
    capabilities: {
      intents: [],
      shippingScope: {
        scope: 'SELECTED_COUNTRIES',
        domesticCountry: 'France',
        supportedCountries: ['Spain', 'Belgium', 'Germany']
      }
    }
  } as BusinessConfig;

  const mockDomesticMoroccoEvidence: PolicyEvidence[] = [{
    intent: 'SHIPPING',
    sourceDocumentId: 'doc-shipping-1',
    sourceChunkId: 'chunk-shipping-1',
    factualContent: 'Delivery across Morocco is 35 MAD in 24-48 hours. Free shipping over 400 MAD.',
    confidence: 0.95,
    chunkType: 'FACTUAL_POLICY',
    provenance: { documentTitle: 'Shipping Policy' }
  }];

  const mockWorldwideEvidence: PolicyEvidence[] = [{
    intent: 'SHIPPING',
    sourceDocumentId: 'doc-shipping-world',
    sourceChunkId: 'chunk-shipping-world',
    factualContent: 'We provide worldwide international shipping to all countries in 5-7 business days for $15.',
    confidence: 0.95,
    chunkType: 'FACTUAL_POLICY',
    provenance: { documentTitle: 'International Shipping' }
  }];

  // Test A: Morocco -> Morocco destination
  it('A. Morocco merchant -> Morocco destination: isScopeExpanded is false, domestic evidence is sufficient', () => {
    const isExpanded = PolicyEvidenceReuse.isScopeExpanded('SHIPPING', 'What are delivery fees in Casablanca?', moroccoConfig);
    expect(isExpanded).toBe(false);

    const sufficiency = PolicyEvidenceReuse.isSufficient('SHIPPING', 'What are delivery fees in Casablanca?', mockDomesticMoroccoEvidence, moroccoConfig);
    expect(sufficiency.isSufficient).toBe(true);
  });

  // Test B: Morocco -> France
  it('B. Morocco merchant -> France: isScopeExpanded is true, domestic evidence is insufficient', () => {
    const isExpanded = PolicyEvidenceReuse.isScopeExpanded('SHIPPING', 'Do you ship to France?', moroccoConfig);
    expect(isExpanded).toBe(true);

    const sufficiency = PolicyEvidenceReuse.isSufficient('SHIPPING', 'Do you ship to France?', mockDomesticMoroccoEvidence, moroccoConfig);
    expect(sufficiency.isSufficient).toBe(false);
    expect(sufficiency.reason).toBe('SCOPE_MISMATCH_INTERNATIONAL_SHIPPING');
  });

  // Test C: US -> Canada
  it('C. US merchant -> Canada: isScopeExpanded is true for cross-border destination', () => {
    const isExpanded = PolicyEvidenceReuse.isScopeExpanded('SHIPPING', 'Do you ship to Canada?', usConfig);
    expect(isExpanded).toBe(true);
  });

  // Test D: US -> California
  it('D. US merchant -> California: isScopeExpanded is false for domestic subdivision', () => {
    const isExpanded = PolicyEvidenceReuse.isScopeExpanded('SHIPPING', 'Do you ship to California?', usConfig);
    expect(isExpanded).toBe(false);
  });

  // Test E: France -> Spain
  it('E. France merchant -> Spain: isScopeExpanded is true for cross-border destination', () => {
    const isExpanded = PolicyEvidenceReuse.isScopeExpanded('SHIPPING', 'Livrez-vous en Espagne ?', franceConfig);
    expect(isExpanded).toBe(true);
  });

  // Test F: Worldwide -> France
  it('F. Worldwide merchant -> France: worldwide evidence is sufficient for international queries', () => {
    const sufficiency = PolicyEvidenceReuse.isSufficient('SHIPPING', 'Do you ship to France?', mockWorldwideEvidence, worldwideConfig);
    expect(sufficiency.isSufficient).toBe(true);
  });

  // Test G: Selected countries: Spain supported
  it('G. Selected countries merchant: recognizes supported international destinations', () => {
    const detected = PolicyEvidenceReuse.extractGeographicTarget('Livraison vers l\'Espagne ?');
    expect(detected?.name).toBe('spain');
  });

  // Test H: Selected countries: Japan unsupported
  it('H. Selected countries merchant: unlisted destination Japan is flagged as scope expansion', () => {
    const isExpanded = PolicyEvidenceReuse.isScopeExpanded('SHIPPING', 'Livrez-vous au Japon ?', selectedCountriesConfig);
    expect(isExpanded).toBe(true);
  });

  // Test I: Service/consultation tenant, non-SHIPPING -> no scope logic
  it('I. Non-SHIPPING intents (consultation, care, returns) never trigger geographic expansion', () => {
    expect(PolicyEvidenceReuse.isScopeExpanded('CONSULTATION', 'Can I reschedule in France?', moroccoConfig)).toBe(false);
    expect(PolicyEvidenceReuse.isScopeExpanded('RETURNS', 'What is the return window in USA?', moroccoConfig)).toBe(false);
    expect(PolicyEvidenceReuse.isScopeExpanded('CARE', 'How to wash in Spain?', moroccoConfig)).toBe(false);
    expect(PolicyEvidenceReuse.isScopeExpanded('STORE_INFO', 'What are opening hours in Canada?', moroccoConfig)).toBe(false);
  });

  // Test J: Arabic query
  it('J. Arabic cross-border query triggers scope expansion', () => {
    const isExpanded = PolicyEvidenceReuse.isScopeExpanded('SHIPPING', 'واش كاين التوصيل لفرنسا؟', moroccoConfig);
    expect(isExpanded).toBe(true);
  });

  // Test K: French query
  it('K. French cross-border query triggers scope expansion', () => {
    const isExpanded = PolicyEvidenceReuse.isScopeExpanded('SHIPPING', 'Livrez-vous en Espagne ?', franceConfig);
    expect(isExpanded).toBe(true);
  });

  // Test L: Darija query
  it('L. Darija cross-border query triggers scope expansion', () => {
    const isExpanded = PolicyEvidenceReuse.isScopeExpanded('SHIPPING', 'كتوصلو لفرانسا؟', moroccoConfig);
    expect(isExpanded).toBe(true);
  });

  // Test M: Arabizi query
  it('M. Arabizi cross-border query triggers scope expansion', () => {
    const isExpanded = PolicyEvidenceReuse.isScopeExpanded('SHIPPING', 'katwsslo lfrance?', moroccoConfig);
    expect(isExpanded).toBe(true);
  });

  // Test N: Cross-tenant isolation
  it('N. Cross-tenant isolation: US query is domestic for US tenant but cross-border for Morocco tenant', () => {
    const isExpandedMorocco = PolicyEvidenceReuse.isScopeExpanded('SHIPPING', 'Do you ship to USA?', moroccoConfig);
    expect(isExpandedMorocco).toBe(true);

    const isExpandedUS = PolicyEvidenceReuse.isScopeExpanded('SHIPPING', 'Do you ship to USA?', usConfig);
    expect(isExpandedUS).toBe(false);
  });

  // Test O: Cached domestic evidence reused when safe
  it('O. Cached domestic evidence reused when safe (domestic city inquiry)', () => {
    const sufficiency = PolicyEvidenceReuse.isSufficient('SHIPPING', 'Tawsil l Rabat kayn?', mockDomesticMoroccoEvidence, moroccoConfig);
    expect(sufficiency.isSufficient).toBe(true);
  });

  // Test P: Cached domestic evidence rejected for broader scope
  it('P. Cached domestic evidence rejected for international shipping inquiry', () => {
    const sufficiency = PolicyEvidenceReuse.isSufficient('SHIPPING', 'Do you offer international shipping abroad?', mockDomesticMoroccoEvidence, moroccoConfig);
    expect(sufficiency.isSufficient).toBe(false);
    expect(sufficiency.reason).toBe('SCOPE_MISMATCH_INTERNATIONAL_SHIPPING');
  });

  // Test Q: Existing Moroccan config with no shippingScope preserves old behavior
  it('Q. Legacy/default fallback preserves Morocco domestic scope when shippingScope is omitted', () => {
    const emptyConfig = { identity: { botName: 'Bot', language: 'en' } } as BusinessConfig;
    const isDomestic = PolicyEvidenceReuse.isScopeExpanded('SHIPPING', 'Delivery in Casablanca', emptyConfig);
    expect(isDomestic).toBe(false);

    const isForeign = PolicyEvidenceReuse.isScopeExpanded('SHIPPING', 'Delivery to France', emptyConfig);
    expect(isForeign).toBe(true);
  });

  // Integration with TurnDecisionResolver
  it('TurnDecisionResolver: sets isScopeExpansion correctly using effective tenant config', () => {
    const decision = TurnDecisionResolver.resolve({
      text: 'Do you ship to France?',
      activePolicyIntent: 'SHIPPING',
      domesticCountry: 'Morocco'
    });
    expect(decision.isScopeExpansion).toBe(true);

    const decisionDomestic = TurnDecisionResolver.resolve({
      text: 'Do you ship to Casablanca?',
      activePolicyIntent: 'SHIPPING',
      domesticCountry: 'Morocco'
    });
    expect(decisionDomestic.isScopeExpansion).toBe(false);
  });
});
