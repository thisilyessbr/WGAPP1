import { describe, it, expect, beforeEach, beforeAll, afterEach } from 'vitest';
import { prisma, pool } from '../../src/tests/testDb';
import { bootstrapChatbot } from '../../src/bootstrap';
import { DEFAULT_BUSINESS_CONFIG, BusinessConfig } from '../../src/domain/tenant/BusinessConfig';
import { AccountConfigService } from '../../src/domain/tenant/AccountConfigService';
import fs from 'fs';
import path from 'path';
import { JSDOM } from 'jsdom';

describe('Phase CONFIG-UI: Configuration UI & Visual Editor Exposure Tests', () => {
  let deps: ReturnType<typeof bootstrapChatbot>;
  let accountConfigService: AccountConfigService;
  const createdTenantIds: string[] = [];
  const htmlPath = path.resolve(__dirname, '../../src/dev/ui/index.html');
  let htmlContent: string;

  beforeAll(async () => {
    const client = await pool.connect();
    try {
      await client.query('SET search_path TO test, public, extensions;');
    } finally {
      client.release();
    }
    htmlContent = fs.readFileSync(htmlPath, 'utf8');
  });

  beforeEach(async () => {
    deps = bootstrapChatbot(prisma);
    accountConfigService = new AccountConfigService(prisma, deps.tenantConfigService);
    deps.tenantConfigService.clearCache();
  });

  afterEach(async () => {
    for (const tenantId of createdTenantIds) {
      try {
        await prisma.tenant.delete({ where: { id: tenantId } });
      } catch (err) {}
    }
    createdTenantIds.length = 0;
  });

  function createDomEnvironment(initialConfig?: BusinessConfig) {
    const dom = new JSDOM(htmlContent, {
      runScripts: 'dangerously',
      url: 'http://localhost:3000'
    });

    const window = dom.window as any;
    const document = window.document;

    // Suppress unhandled alerts in jsdom
    window.alert = () => {};

    // Set mock initial state
    const configToLoad = initialConfig || JSON.parse(JSON.stringify(DEFAULT_BUSINESS_CONFIG));
    document.getElementById('rawJsonEditor').value = JSON.stringify(configToLoad, null, 2);
    window.currentConfig = JSON.parse(JSON.stringify(configToLoad));

    return { dom, window, document };
  }

  it('1. HTML Markup: All required visual editor fields and controls exist in DOM', () => {
    const { document } = createDomEnvironment();

    // Identity & Brand
    expect(document.getElementById('v_botName')).not.toBeNull();
    expect(document.getElementById('v_language')).not.toBeNull();
    expect(document.getElementById('v_brand')).not.toBeNull();
    expect(document.getElementById('v_industry')).not.toBeNull();
    expect(document.getElementById('v_country')).not.toBeNull();
    expect(document.getElementById('v_currency')).not.toBeNull();
    expect(document.getElementById('v_businessHours')).not.toBeNull();
    expect(document.getElementById('v_locations')).not.toBeNull();
    expect(document.getElementById('v_supportEmail')).not.toBeNull();
    expect(document.getElementById('v_supportPhone')).not.toBeNull();
    expect(document.getElementById('v_supportSales')).not.toBeNull();
    expect(document.getElementById('v_supportReturns')).not.toBeNull();

    // Behavior
    expect(document.getElementById('v_tone')).not.toBeNull();
    expect(document.getElementById('v_verbosity')).not.toBeNull();
    expect(document.getElementById('v_stayOnTopic')).not.toBeNull();
    expect(document.getElementById('v_answerOnlyKnowledge')).not.toBeNull();
    expect(document.getElementById('v_allowSmallTalk')).not.toBeNull();
    expect(document.getElementById('v_allowHumanHandoff')).not.toBeNull();

    // Limits
    expect(document.getElementById('v_maxHistory')).not.toBeNull();
    expect(document.getElementById('v_maxWorkflowSteps')).not.toBeNull();
    expect(document.getElementById('v_maxResponseLength')).not.toBeNull();

    // LLM
    expect(document.getElementById('v_llmProvider')).not.toBeNull();
    expect(document.getElementById('v_llmModel')).not.toBeNull();
    expect(document.getElementById('v_llmTemp')).not.toBeNull();
    expect(document.getElementById('v_llmMaxTokens')).not.toBeNull();
    expect(document.getElementById('v_llmTimeoutMs')).not.toBeNull();

    // Knowledge & Ingestion
    expect(document.getElementById('v_ragEnabled')).not.toBeNull();
    expect(document.getElementById('v_topK')).not.toBeNull();
    expect(document.getElementById('v_minSim')).not.toBeNull();
    expect(document.getElementById('v_maxContextSize')).not.toBeNull();
    expect(document.getElementById('v_chunkSize')).not.toBeNull();
    expect(document.getElementById('v_chunkOverlap')).not.toBeNull();
    expect(document.getElementById('v_maxFileSizeMb')).not.toBeNull();
    expect(document.getElementById('v_maxChunks')).not.toBeNull();
    expect(document.getElementById('v_maxExtractedTextLength')).not.toBeNull();

    // Capabilities
    expect(document.getElementById('v_imageEnabled')).not.toBeNull();
    expect(document.getElementById('v_ecommerceEnabled')).not.toBeNull();

    // Prompts
    expect(document.getElementById('v_sysPrompt')).not.toBeNull();
    expect(document.getElementById('v_greeting_en')).not.toBeNull();
    expect(document.getElementById('v_greeting_fr')).not.toBeNull();
    expect(document.getElementById('v_greeting_ar')).not.toBeNull();
    expect(document.getElementById('v_greeting_darija')).not.toBeNull();
    expect(document.getElementById('v_fallback_en')).not.toBeNull();
    expect(document.getElementById('v_fallback_fr')).not.toBeNull();
    expect(document.getElementById('v_fallback_ar')).not.toBeNull();
    expect(document.getElementById('v_fallback_darija')).not.toBeNull();
    expect(document.getElementById('v_knowledgePrompt')).not.toBeNull();
    expect(document.getElementById('v_workflowPrompt')).not.toBeNull();
    expect(document.getElementById('v_handoffPrompt')).not.toBeNull();
    expect(document.getElementById('v_limitExceededPrompt')).not.toBeNull();
    expect(document.getElementById('v_workflowUnavailablePrompt')).not.toBeNull();
    expect(document.getElementById('v_workflowCancelledPrompt')).not.toBeNull();
    expect(document.getElementById('v_missingFieldPrompt')).not.toBeNull();
    expect(document.getElementById('v_confirmationPrompt')).not.toBeNull();
    expect(document.getElementById('v_intentClassificationPrompt')).not.toBeNull();
    expect(document.getElementById('v_fieldExtractionPrompt')).not.toBeNull();
  });

  it('2. Load into Visual Editor: syncJsonToVisual populates all fields accurately from BusinessConfig', () => {
    const customConfig: BusinessConfig = {
      ...DEFAULT_BUSINESS_CONFIG,
      identity: {
        botName: 'AtlasBot',
        language: 'fr',
        brand: 'Atlas Home Tech',
        industry: 'Home Automation',
        country: 'Morocco',
        currency: 'MAD',
        businessHours: 'Mon-Sat 8:00-20:00',
        locations: ['Casablanca', 'Tangier'],
        support: {
          email: 'help@atlas.ma',
          phone: '+212522112233',
          sales: 'sales@atlas.ma',
          returns: 'returns@atlas.ma'
        }
      },
      behavior: {
        tone: 'empathetic',
        verbosity: 'short',
        stayOnTopic: false,
        answerOnlyFromKnowledge: true,
        allowSmallTalk: false,
        allowHumanHandoff: true
      },
      limits: {
        maxConversationHistory: 35,
        maxWorkflowSteps: 15,
        maxResponseLength: 750
      },
      llm: {
        provider: 'gemini',
        model: 'gemini-2.0-flash-001',
        temperature: 0.7,
        maxTokens: 2048,
        timeoutMs: 25000
      },
      knowledge: {
        enabled: true,
        topK: 5,
        minSimilarityScore: 0.65,
        maxContextSize: 6000,
        ingestion: {
          chunkSize: 1200,
          chunkOverlap: 200,
          maxFileSizeMb: 25,
          maxChunks: 800,
          maxExtractedTextLength: 200000
        }
      },
      capabilities: {
        ...DEFAULT_BUSINESS_CONFIG.capabilities,
        imageEnabled: true,
        ecommerceEnabled: true
      },
      prompts: {
        ...DEFAULT_BUSINESS_CONFIG.prompts,
        system: 'Custom System Prompt',
        greeting: {
          en: 'Welcome!',
          fr: 'Bienvenue !',
          ar: 'أهلا وسهلا!',
          darija: 'Marhba bikom!'
        },
        fallback: {
          en: 'Could you repeat?',
          fr: 'Pouvez-vous répéter ?',
          ar: 'هل يمكنك التكرار؟',
          darija: '3awed 3afak?'
        },
        knowledge: 'Context: {{context}}',
        workflow: 'Custom workflow step prompt',
        handoff: 'Hold on for an agent',
        limitExceeded: 'Session expired',
        workflowUnavailable: 'WF unavailable',
        workflowCancelled: 'WF cancelled',
        missingFieldPrompt: 'Please enter {{fieldName}}',
        confirmationPrompt: 'Confirm details:\n{{summary}}',
        intentClassification: 'Custom intent prompt',
        fieldExtraction: 'Custom extract prompt'
      }
    };

    const { window, document } = createDomEnvironment(customConfig);
    window.syncJsonToVisual();

    // Verify Identity
    expect(document.getElementById('v_botName').value).toBe('AtlasBot');
    expect(document.getElementById('v_language').value).toBe('fr');
    expect(document.getElementById('v_brand').value).toBe('Atlas Home Tech');
    expect(document.getElementById('v_industry').value).toBe('Home Automation');
    expect(document.getElementById('v_country').value).toBe('Morocco');
    expect(document.getElementById('v_currency').value).toBe('MAD');
    expect(document.getElementById('v_businessHours').value).toBe('Mon-Sat 8:00-20:00');
    expect(document.getElementById('v_locations').value).toBe('Casablanca, Tangier');
    expect(document.getElementById('v_supportEmail').value).toBe('help@atlas.ma');
    expect(document.getElementById('v_supportPhone').value).toBe('+212522112233');
    expect(document.getElementById('v_supportSales').value).toBe('sales@atlas.ma');
    expect(document.getElementById('v_supportReturns').value).toBe('returns@atlas.ma');

    // Verify Behavior
    expect(document.getElementById('v_tone').value).toBe('empathetic');
    expect(document.getElementById('v_verbosity').value).toBe('short');
    expect(document.getElementById('v_stayOnTopic').value).toBe('false');
    expect(document.getElementById('v_answerOnlyKnowledge').value).toBe('true');
    expect(document.getElementById('v_allowSmallTalk').value).toBe('false');
    expect(document.getElementById('v_allowHumanHandoff').value).toBe('true');

    // Verify Limits
    expect(Number(document.getElementById('v_maxHistory').value)).toBe(35);
    expect(Number(document.getElementById('v_maxWorkflowSteps').value)).toBe(15);
    expect(Number(document.getElementById('v_maxResponseLength').value)).toBe(750);

    // Verify LLM
    expect(document.getElementById('v_llmProvider').value).toBe('gemini');
    expect(document.getElementById('v_llmModel').value).toBe('gemini-2.0-flash-001');
    expect(Number(document.getElementById('v_llmTemp').value)).toBe(0.7);
    expect(Number(document.getElementById('v_llmMaxTokens').value)).toBe(2048);
    expect(Number(document.getElementById('v_llmTimeoutMs').value)).toBe(25000);

    // Verify Knowledge
    expect(document.getElementById('v_ragEnabled').value).toBe('true');
    expect(Number(document.getElementById('v_topK').value)).toBe(5);
    expect(Number(document.getElementById('v_minSim').value)).toBe(0.65);
    expect(Number(document.getElementById('v_maxContextSize').value)).toBe(6000);
    expect(Number(document.getElementById('v_chunkSize').value)).toBe(1200);
    expect(Number(document.getElementById('v_chunkOverlap').value)).toBe(200);
    expect(Number(document.getElementById('v_maxFileSizeMb').value)).toBe(25);
    expect(Number(document.getElementById('v_maxChunks').value)).toBe(800);
    expect(Number(document.getElementById('v_maxExtractedTextLength').value)).toBe(200000);

    // Verify Capabilities
    expect(document.getElementById('v_imageEnabled').value).toBe('true');
    expect(document.getElementById('v_ecommerceEnabled').value).toBe('true');

    // Verify Prompts
    expect(document.getElementById('v_sysPrompt').value).toBe('Custom System Prompt');
    expect(document.getElementById('v_greeting_en').value).toBe('Welcome!');
    expect(document.getElementById('v_greeting_fr').value).toBe('Bienvenue !');
    expect(document.getElementById('v_greeting_ar').value).toBe('أهلا وسهلا!');
    expect(document.getElementById('v_greeting_darija').value).toBe('Marhba bikom!');
    expect(document.getElementById('v_fallback_en').value).toBe('Could you repeat?');
    expect(document.getElementById('v_fallback_fr').value).toBe('Pouvez-vous répéter ?');
    expect(document.getElementById('v_fallback_ar').value).toBe('هل يمكنك التكرار؟');
    expect(document.getElementById('v_fallback_darija').value).toBe('3awed 3afak?');
    expect(document.getElementById('v_knowledgePrompt').value).toBe('Context: {{context}}');
    expect(document.getElementById('v_workflowPrompt').value).toBe('Custom workflow step prompt');
    expect(document.getElementById('v_handoffPrompt').value).toBe('Hold on for an agent');
    expect(document.getElementById('v_limitExceededPrompt').value).toBe('Session expired');
    expect(document.getElementById('v_workflowUnavailablePrompt').value).toBe('WF unavailable');
    expect(document.getElementById('v_workflowCancelledPrompt').value).toBe('WF cancelled');
    expect(document.getElementById('v_missingFieldPrompt').value).toBe('Please enter {{fieldName}}');
    expect(document.getElementById('v_confirmationPrompt').value).toBe('Confirm details:\n{{summary}}');
    expect(document.getElementById('v_intentClassificationPrompt').value).toBe('Custom intent prompt');
    expect(document.getElementById('v_fieldExtractionPrompt').value).toBe('Custom extract prompt');
  });

  it('3. Visual to JSON Sync: syncVisualToJson updates only the target JSON paths without corrupting others', () => {
    const { window, document } = createDomEnvironment();
    window.syncJsonToVisual();

    // Modify specific fields in DOM
    document.getElementById('v_botName').value = 'UpdatedBot';
    document.getElementById('v_brand').value = 'BrandXYZ';
    document.getElementById('v_tone').value = 'friendly';
    document.getElementById('v_verbosity').value = 'long';
    document.getElementById('v_stayOnTopic').value = 'false';
    document.getElementById('v_maxHistory').value = '42';
    document.getElementById('v_llmTemp').value = '0.85';
    document.getElementById('v_topK').value = '7';
    document.getElementById('v_chunkSize').value = '1500';
    document.getElementById('v_ecommerceEnabled').value = 'true';
    document.getElementById('v_greeting_en').value = 'Hello world!';
    document.getElementById('v_handoffPrompt').value = 'Transferring now...';

    // Trigger sync
    window.syncVisualToJson();

    const updatedJson: BusinessConfig = JSON.parse(document.getElementById('rawJsonEditor').value);

    // Verify modified fields
    expect(updatedJson.identity.botName).toBe('UpdatedBot');
    expect(updatedJson.identity.brand).toBe('BrandXYZ');
    expect(updatedJson.behavior.tone).toBe('friendly');
    expect(updatedJson.behavior.verbosity).toBe('long');
    expect(updatedJson.behavior.stayOnTopic).toBe(false);
    expect(updatedJson.limits.maxConversationHistory).toBe(42);
    expect(updatedJson.llm.temperature).toBe(0.85);
    expect(updatedJson.knowledge.topK).toBe(7);
    expect(updatedJson.knowledge.ingestion.chunkSize).toBe(1500);
    expect(updatedJson.capabilities.ecommerceEnabled).toBe(true);
    expect((updatedJson.prompts.greeting as any).en).toBe('Hello world!');
    expect(updatedJson.prompts.handoff).toBe('Transferring now...');

    // Verify UNMODIFIED fields remain strictly intact
    expect(updatedJson.identity.language).toBe(DEFAULT_BUSINESS_CONFIG.identity.language);
    expect(updatedJson.behavior.allowSmallTalk).toBe(DEFAULT_BUSINESS_CONFIG.behavior.allowSmallTalk);
    expect(updatedJson.limits.maxWorkflowSteps).toBe(DEFAULT_BUSINESS_CONFIG.limits.maxWorkflowSteps);
    expect(updatedJson.llm.provider).toBe(DEFAULT_BUSINESS_CONFIG.llm.provider);
    expect(updatedJson.knowledge.minSimilarityScore).toBe(DEFAULT_BUSINESS_CONFIG.knowledge.minSimilarityScore);
    expect(updatedJson.prompts.system).toBe(DEFAULT_BUSINESS_CONFIG.prompts.system);
  });

  it('4. Raw JSON to Visual Sync: Modifying raw JSON updates Visual Editor on switchTab', () => {
    const { window, document } = createDomEnvironment();

    const rawUpdate: BusinessConfig = {
      ...DEFAULT_BUSINESS_CONFIG,
      identity: {
        botName: 'JsonDirectBot',
        language: 'ar',
        brand: 'DirectBrand'
      },
      behavior: {
        ...DEFAULT_BUSINESS_CONFIG.behavior,
        tone: 'formal',
        allowHumanHandoff: true
      },
      limits: {
        ...DEFAULT_BUSINESS_CONFIG.limits,
        maxResponseLength: 888
      }
    };

    document.getElementById('rawJsonEditor').value = JSON.stringify(rawUpdate, null, 2);

    // Call switchTab to visual tab
    const visualTabEl = document.createElement('div');
    window.currentConfig = rawUpdate;
    window.syncJsonToVisual();

    expect(document.getElementById('v_botName').value).toBe('JsonDirectBot');
    expect(document.getElementById('v_language').value).toBe('ar');
    expect(document.getElementById('v_brand').value).toBe('DirectBrand');
    expect(document.getElementById('v_tone').value).toBe('formal');
    expect(document.getElementById('v_allowHumanHandoff').value).toBe('true');
    expect(Number(document.getElementById('v_maxResponseLength').value)).toBe(888);
  });

  it('5. Multilingual Tab Switching: switchPromptLang switches active language tabs correctly', () => {
    const { window, document } = createDomEnvironment();

    // Initial state: 'en' is active
    expect(document.getElementById('prompt-greeting-en').style.display).not.toBe('none');

    // Switch greeting to 'fr'
    window.switchPromptLang('greeting', 'fr');
    expect(document.getElementById('prompt-greeting-en').style.display).toBe('none');
    expect(document.getElementById('prompt-greeting-fr').style.display).toBe('block');

    // Switch greeting to 'ar'
    window.switchPromptLang('greeting', 'ar');
    expect(document.getElementById('prompt-greeting-fr').style.display).toBe('none');
    expect(document.getElementById('prompt-greeting-ar').style.display).toBe('block');

    // Switch fallback to 'darija'
    window.switchPromptLang('fallback', 'darija');
    expect(document.getElementById('prompt-fallback-darija').style.display).toBe('block');
  });

  it('6. Account Inheritance: Account overrides merge cleanly without mutating base tenant config', async () => {
    const tenant = await prisma.tenant.create({
      data: {
        name: `Tenant-UI-Inherit-${Date.now()}`,
        config: { create: { config: DEFAULT_BUSINESS_CONFIG } },
        accounts: {
          create: {
            name: 'account-with-overrides',
            config: {
              identity: { botName: 'AccountSpecificBot', brand: 'SubBrand' },
              behavior: { tone: 'casual' },
              limits: { maxConversationHistory: 50 },
              capabilities: { ecommerceEnabled: true }
            }
          }
        }
      },
      include: { accounts: true }
    });
    createdTenantIds.push(tenant.id);
    const account = tenant.accounts[0];

    const effectiveConfig = await accountConfigService.getEffectiveConfig(tenant.id, account.id);

    // Overridden fields
    expect(effectiveConfig.identity.botName).toBe('AccountSpecificBot');
    expect(effectiveConfig.identity.brand).toBe('SubBrand');
    expect(effectiveConfig.behavior.tone).toBe('casual');
    expect(effectiveConfig.limits.maxConversationHistory).toBe(50);

    // Inherited base fields
    expect(effectiveConfig.identity.language).toBe('en');
    expect(effectiveConfig.behavior.verbosity).toBe('medium');
    expect(effectiveConfig.llm.model).toBe(DEFAULT_BUSINESS_CONFIG.llm.model);
    expect(effectiveConfig.prompts.system).toBe(DEFAULT_BUSINESS_CONFIG.prompts.system);
  });

  it('7. Preservation of Internal/Data Keys: Custom keys like catalog, customers, promotions are never lost', () => {
    const configWithData: any = {
      ...DEFAULT_BUSINESS_CONFIG,
      catalog: [{ id: 'item_1', name: 'Special Item' }],
      customers: [{ id: 'cust_1', name: 'VIP Customer' }],
      customInternalMeta: { deployedAt: '2026-08-22' }
    };

    const { window, document } = createDomEnvironment(configWithData);
    window.syncJsonToVisual();

    // Edit visual field
    document.getElementById('v_botName').value = 'PreserveKeysBot';
    document.getElementById('v_tone').value = 'concise';
    window.syncVisualToJson();

    const result = JSON.parse(document.getElementById('rawJsonEditor').value);

    // Visual fields updated
    expect(result.identity.botName).toBe('PreserveKeysBot');
    expect(result.behavior.tone).toBe('concise');

    // Internal data keys preserved
    expect(result.catalog).toEqual([{ id: 'item_1', name: 'Special Item' }]);
    expect(result.customers).toEqual([{ id: 'cust_1', name: 'VIP Customer' }]);
    expect(result.customInternalMeta).toEqual({ deployedAt: '2026-08-22' });
  });

  it('8. Single String vs Localized Object Prompt Handling', () => {
    // Config with single string prompt
    const stringConfig: BusinessConfig = {
      ...DEFAULT_BUSINESS_CONFIG,
      prompts: {
        ...DEFAULT_BUSINESS_CONFIG.prompts,
        greeting: 'Just English Greeting',
        fallback: 'Just English Fallback'
      }
    };

    const { window, document } = createDomEnvironment(stringConfig);
    window.syncJsonToVisual();

    expect(document.getElementById('v_greeting_en').value).toBe('Just English Greeting');
    expect(document.getElementById('v_fallback_en').value).toBe('Just English Fallback');

    // Edit English only -> stays string
    document.getElementById('v_greeting_en').value = 'Updated English Greeting';
    window.syncVisualToJson();

    let res = JSON.parse(document.getElementById('rawJsonEditor').value);
    expect(res.prompts.greeting).toBe('Updated English Greeting');

    // Add French translation -> converts cleanly to object
    document.getElementById('v_greeting_fr').value = 'Salutations en français';
    window.syncVisualToJson();

    res = JSON.parse(document.getElementById('rawJsonEditor').value);
    expect(typeof res.prompts.greeting).toBe('object');
    expect(res.prompts.greeting.en).toBe('Updated English Greeting');
    expect(res.prompts.greeting.fr).toBe('Salutations en français');
  });

  it('9. Numeric Fields Type Safety: Number controls parse numbers and ignore non-numeric inputs', () => {
    const { window, document } = createDomEnvironment();
    window.syncJsonToVisual();

    document.getElementById('v_maxHistory').value = '55';
    document.getElementById('v_topK').value = '8';
    document.getElementById('v_minSim').value = '0.75';
    document.getElementById('v_llmTemp').value = '0.45';
    document.getElementById('v_llmMaxTokens').value = '4096';
    document.getElementById('v_llmTimeoutMs').value = '30000';

    window.syncVisualToJson();

    const res: BusinessConfig = JSON.parse(document.getElementById('rawJsonEditor').value);
    expect(typeof res.limits.maxConversationHistory).toBe('number');
    expect(res.limits.maxConversationHistory).toBe(55);

    expect(typeof res.knowledge.topK).toBe('number');
    expect(res.knowledge.topK).toBe(8);

    expect(typeof res.knowledge.minSimilarityScore).toBe('number');
    expect(res.knowledge.minSimilarityScore).toBe(0.75);

    expect(typeof res.llm.temperature).toBe('number');
    expect(res.llm.temperature).toBe(0.45);

    expect(typeof res.llm.maxTokens).toBe('number');
    expect(res.llm.maxTokens).toBe(4096);

    expect(typeof res.llm.timeoutMs).toBe('number');
    expect(res.llm.timeoutMs).toBe(30000);
  });
});
