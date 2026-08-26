import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prisma } from '../../src/tests/testDb';
import { bootstrapChatbot } from '../../src/bootstrap';
import { DEFAULT_BUSINESS_CONFIG, BusinessConfig } from '../../src/domain/tenant/BusinessConfig';
import { logger } from '../../src/utils/logger';
import { LLMMockProvider } from '../../src/core/llm/LLMProvider';

describe('French Study-Abroad Tenant & Dynamic Localization Integration Tests', () => {
  let deps: ReturnType<typeof bootstrapChatbot>;
  let mockLlm: LLMMockProvider;

  beforeEach(async () => {
    deps = bootstrapChatbot(prisma);
    mockLlm = new LLMMockProvider();
    deps.llmFactory.registerProvider('mock', 'mock-model', mockLlm);
    deps.tenantConfigService.clearCache();
  });

  const frenchStudyAbroadConfig: BusinessConfig = {
    ...DEFAULT_BUSINESS_CONFIG,
    identity: {
      botName: 'Conseiller Études France',
      language: 'fr'
    },
    behavior: {
      ...DEFAULT_BUSINESS_CONFIG.behavior,
      stayOnTopic: true
    },
    limits: {
      maxConversationHistory: 20,
      maxWorkflowSteps: 10,
      maxResponseLength: 500
    },
    llm: {
      provider: 'mock',
      model: 'mock-model',
      temperature: 0.1,
      maxTokens: 500,
      timeoutMs: 5000
    },
    prompts: {
      ...DEFAULT_BUSINESS_CONFIG.prompts,
      system: 'Vous êtes un conseiller d\'orientation pour les études en France.',
      greeting: 'Bonjour ! Comment puis-je vous aider dans votre projet d\'études ?',
      fallback: 'Je n\'ai pas compris votre demande. Pourriez-vous reformuler ?',
      limitExceeded: 'La conversation a atteint la limite maximale. Merci de débuter un nouvel échange.',
      workflowUnavailable: 'Ce formulaire de candidature n\'est plus disponible.',
      workflowCancelled: 'Candidature annulée avec succès.',
      missingFieldPrompt: 'Veuillez renseigner votre {{fieldName}}.',
      confirmationPrompt: 'Veuillez confirmer vos coordonnées:\n{{summary}}\n\n(Répondez "oui" pour valider ou "non" pour annuler)'
    },
    capabilities: {
      intents: [
        {
          id: 'INTENT_CANDIDATURE_FRANCE',
          description: 'Candidater pour un programme universitaire',
          workflowId: 'WORKFLOW_CAMPUS_FRANCE'
        }
      ]
    },
    workflows: {
      WORKFLOW_CAMPUS_FRANCE: {
        id: 'WORKFLOW_CAMPUS_FRANCE',
        name: 'Dossier Campus France',
        description: 'Collecte des informations du candidat',
        initialState: 'collecte_nom',
        states: {
          collecte_nom: {
            type: 'collect',
            prompt: 'Quel est votre nom complet ?',
            field: { name: 'nomCandidat', type: 'string', required: true },
            transitions: [{ target: 'confirmation_dossier', default: true }]
          },
          confirmation_dossier: {
            type: 'confirm',
            confirmKeywords: ['oui', 'valider', 'd\'accord'],
            cancelKeywords: ['non', 'annuler', 'stop'],
            cancellationPrompt: 'Candidature annulée avec succès.',
            transitions: [{ target: 'succes', default: true }]
          },
          succes: {
            type: 'end',
            prompt: 'Félicitations ! Votre dossier a été enregistré auprès de notre agence.'
          }
        }
      }
    }
  };

  it('1. Intent-to-Workflow mapping works when intent ID and workflow ID differ', async () => {
    const tenant = await prisma.tenant.create({ data: { name: 'Study Abroad Agency FR' } });
    await prisma.tenantConfig.create({ data: { tenantId: tenant.id, config: frenchStudyAbroadConfig as any } });

    // Mock LLM classifies user intent as INTENT_CANDIDATURE_FRANCE
    mockLlm.intentMock = 'INTENT_CANDIDATURE_FRANCE';

    const customerId = `etudiant-${Date.now()}`;
    const res = await deps.conversationEngine.handleMessage(tenant.id, customerId, 'Je souhaite m\'inscrire pour étudier en France');

    // Should route to WORKFLOW_CAMPUS_FRANCE and ask first question
    expect(res).toBe('Quel est votre nom complet ?');
  });

  it('2. Robust case-insensitive & whitespace-trimmed confirmation matching ("Oui", " oui ", "OUI")', async () => {
    const tenant = await prisma.tenant.create({ data: { name: 'Study Abroad Agency FR 2' } });
    await prisma.tenantConfig.create({ data: { tenantId: tenant.id, config: frenchStudyAbroadConfig as any } });

    mockLlm.intentMock = 'INTENT_CANDIDATURE_FRANCE';
    mockLlm.extractedFieldMock = 'Jean Dupont';

    // Test with " oui "
    const cust1 = `c1-${Date.now()}`;
    await deps.conversationEngine.handleMessage(tenant.id, cust1, 'Candidature');
    const confirmPrompt = await deps.conversationEngine.handleMessage(tenant.id, cust1, 'Jean Dupont');
    expect(confirmPrompt).toContain('Veuillez confirmer vos coordonnées:');
    expect(confirmPrompt).toContain('nomCandidat: Jean Dupont');

    const doneRes1 = await deps.conversationEngine.handleMessage(tenant.id, cust1, '  oui  ');
    expect(doneRes1).toBe('Félicitations ! Votre dossier a été enregistré auprès de notre agence.');

    // Test with "OUI"
    const cust2 = `c2-${Date.now()}`;
    await deps.conversationEngine.handleMessage(tenant.id, cust2, 'Candidature');
    await deps.conversationEngine.handleMessage(tenant.id, cust2, 'Marie Curie');
    const doneRes2 = await deps.conversationEngine.handleMessage(tenant.id, cust2, 'OUI');
    expect(doneRes2).toBe('Félicitations ! Votre dossier a été enregistré auprès de notre agence.');

    // Test with "Oui"
    const cust3 = `c3-${Date.now()}`;
    await deps.conversationEngine.handleMessage(tenant.id, cust3, 'Candidature');
    await deps.conversationEngine.handleMessage(tenant.id, cust3, 'Victor Hugo');
    const doneRes3 = await deps.conversationEngine.handleMessage(tenant.id, cust3, 'Oui');
    expect(doneRes3).toBe('Félicitations ! Votre dossier a été enregistré auprès de notre agence.');
  }, 25000);

  it('3. Cancellation in French workflow produces zero English leaked strings', async () => {
    const tenant = await prisma.tenant.create({ data: { name: 'Study Abroad Agency FR 3' } });
    await prisma.tenantConfig.create({ data: { tenantId: tenant.id, config: frenchStudyAbroadConfig as any } });

    mockLlm.intentMock = 'INTENT_CANDIDATURE_FRANCE';
    mockLlm.extractedFieldMock = 'Jean Dupont';

    const cust = `cancel-user-${Date.now()}`;
    await deps.conversationEngine.handleMessage(tenant.id, cust, 'Candidature');
    await deps.conversationEngine.handleMessage(tenant.id, cust, 'Jean Dupont');
    
    // User replies "non"
    const cancelRes = await deps.conversationEngine.handleMessage(tenant.id, cust, 'non');
    expect(cancelRes).toBe('Candidature annulée avec succès.');
  });

  it('4. Custom French limitExceeded message is returned without English leaks', async () => {
    const shortLimitConfig: BusinessConfig = {
      ...frenchStudyAbroadConfig,
      limits: {
        ...frenchStudyAbroadConfig.limits,
        maxConversationHistory: 2
      }
    };

    const tenant = await prisma.tenant.create({ data: { name: 'Short Limit FR' } });
    await prisma.tenantConfig.create({ data: { tenantId: tenant.id, config: shortLimitConfig as any } });

    mockLlm.intentMock = null;
    const cust = `limit-user-${Date.now()}`;
    await deps.conversationEngine.handleMessage(tenant.id, cust, 'Bonjour');
    // Second user message hits history limit (2 msgs stored: user + assistant)
    const limitRes = await deps.conversationEngine.handleMessage(tenant.id, cust, 'Deuxième message');
    expect(limitRes).toBe('La conversation a atteint la limite maximale. Merci de débuter un nouvel échange.');
  });

  it('5. Emits deprecation warning when legacy prompt === "confirm" is used', async () => {
    const warnSpy = vi.spyOn(logger, 'warn');

    const legacyConfig: BusinessConfig = {
      ...frenchStudyAbroadConfig,
      workflows: {
        LEGACY_FLOW: {
          id: 'LEGACY_FLOW',
          name: 'Legacy Flow',
          description: 'Uses legacy prompt confirm',
          initialState: 'legacy_confirm',
          states: {
            legacy_confirm: {
              type: 'collect',
              prompt: 'confirm',
              transitions: [{ target: 'end', default: true }]
            },
            end: {
              type: 'end',
              prompt: 'Fini.'
            }
          }
        }
      }
    };

    const tenant = await prisma.tenant.create({ data: { name: 'Legacy Tenant' } });
    await prisma.tenantConfig.create({ data: { tenantId: tenant.id, config: legacyConfig as any } });

    mockLlm.intentMock = null;
    const cust = `leg-${Date.now()}`;
    await deps.conversationEngine.handleMessage(tenant.id, cust, 'LEGACY_FLOW');
    await deps.conversationEngine.handleMessage(tenant.id, cust, 'yes');

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[DEPRECATION]')
    );
  });
});
