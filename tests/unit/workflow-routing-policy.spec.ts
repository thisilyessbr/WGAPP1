import { describe, expect, it } from 'vitest';
import { DEFAULT_BUSINESS_CONFIG, type BusinessConfig } from '../../src/domain/tenant/BusinessConfig';
import { WorkflowRoutingPolicy } from '../../src/domain/conversation/WorkflowRoutingPolicy';

function serviceConfig(): BusinessConfig {
  const config = structuredClone(DEFAULT_BUSINESS_CONFIG);
  config.capabilities.ecommerceEnabled = false;
  config.capabilities.intents = [
    { id: 'demo_request', description: 'Relayqo demo', workflowId: 'demo', useCases: ['PURCHASE', 'DEMO'] },
    { id: 'fitness_consultation', description: 'Fitness consultation', workflowId: 'fitness' }
  ];
  config.workflows = {
    demo: { id: 'demo', name: 'Product demonstration', initialState: 'start', states: { start: { type: 'end', prompt: 'Done' } } },
    fitness: { id: 'fitness', name: 'Fitness consultation', initialState: 'start', states: { start: { type: 'end', prompt: 'Done' } } }
  } as BusinessConfig['workflows'];
  return config;
}

describe('single workflow-routing policy', () => {
  it.each([
    'bghit ncommandi wa7d',
    'bghit nchri wa7d chat bot',
    'بغيت نشري واحد',
    'je veux acheter',
    'I want to buy'
  ])('routes %s by the business mapping, not a workflow name', phrase => {
    const route = WorkflowRoutingPolicy.resolve(phrase, serviceConfig());
    expect(route.kind).toBe('WORKFLOW');
    if (route.kind === 'WORKFLOW') expect(route.workflowId).toBe('demo');
  });

  it('does not infer a sales workflow from names or descriptions', () => {
    const config = serviceConfig();
    config.capabilities.intents[0].useCases = [];
    expect(WorkflowRoutingPolicy.resolve('bghit ncommandi wa7d', config)).toEqual({ kind: 'UNMAPPED_PURCHASE', useCase: 'PURCHASE' });
  });

  it.each(['ma bghitch nchri', 'where is my order?', 'je ne veux pas acheter'])(
    'does not start a purchase workflow for %s', phrase => {
      expect(WorkflowRoutingPolicy.resolve(phrase, serviceConfig()).kind).toBe('NONE');
    }
  );

  it('fails closed if a legacy tenant config maps one use case to two workflows', () => {
    const config = serviceConfig();
    config.capabilities.intents[1].useCases = ['PURCHASE'];
    expect(WorkflowRoutingPolicy.resolve('bghit nchri wa7d', config)).toEqual({ kind: 'AMBIGUOUS', useCase: 'PURCHASE' });
  });

  it('leaves a store purchase to its ecommerce engine when no workflow is mapped', () => {
    const config = serviceConfig();
    config.capabilities.ecommerceEnabled = true;
    config.capabilities.intents[0].useCases = [];
    expect(WorkflowRoutingPolicy.resolve('bghit ncommandi wa7d', config).kind).toBe('NONE');
  });
});
