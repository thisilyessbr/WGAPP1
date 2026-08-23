import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { prisma, pool } from '../../src/tests/testDb';
import { bootstrapChatbot } from '../../src/bootstrap';
import { DEFAULT_BUSINESS_CONFIG } from '../../src/domain/tenant/BusinessConfig';
import { LLMMockProvider } from '../../src/core/llm/LLMProvider';

describe('Phase 3: Account-Aware Prompt Architecture Integration Tests', () => {
  let deps: ReturnType<typeof bootstrapChatbot>;
  let mockLlm: LLMMockProvider;

  beforeAll(async () => {
    const client = await pool.connect();
    try {
      await client.query('SET search_path TO test, public, extensions;');
      await client.query(`
        CREATE TABLE IF NOT EXISTS "Account" (
            "id" TEXT NOT NULL,
            "tenantId" TEXT NOT NULL,
            "name" TEXT NOT NULL,
            "enabled" BOOLEAN NOT NULL DEFAULT true,
            "config" JSONB,
            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
        );
        ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "accountId" TEXT;
      `);
    } finally {
      client.release();
    }
  });

  beforeEach(async () => {
    deps = bootstrapChatbot(prisma);
    mockLlm = new LLMMockProvider();
    deps.llmFactory.registerProvider('mock', 'mock-model', mockLlm);
    deps.tenantConfigService.clearCache();
  });

  it('1. Propagates Account A and Account B prompt overrides, tone, and identity to grounded LLM calls', async () => {
    const tenant = await prisma.tenant.create({
      data: {
        name: `Tenant-P3-Prompt-${Date.now()}`,
        config: {
          create: {
            config: {
              ...DEFAULT_BUSINESS_CONFIG,
              identity: { botName: 'Base Bot', language: 'en' },
              behavior: { tone: 'neutral', verbosity: 'medium', stayOnTopic: true },
              prompts: { ...DEFAULT_BUSINESS_CONFIG.prompts, system: 'Base System Prompt' },
              llm: { provider: 'mock', model: 'mock-model', temperature: 0.1, maxTokens: 500, timeoutMs: 5000 },
              workflows: {},
              capabilities: { ...DEFAULT_BUSINESS_CONFIG.capabilities, faq: [] }
            }
          }
        }
      }
    });

    const accountA = await prisma.account.create({
      data: {
        tenantId: tenant.id,
        name: 'Account A',
        enabled: true,
        config: {
          identity: { botName: 'ALPHA-BOT', language: 'en' },
          behavior: { tone: 'professional', verbosity: 'short' },
          prompts: { system: 'When answering, include ALPHA-MARKER once.' }
        }
      }
    });

    const accountB = await prisma.account.create({
      data: {
        tenantId: tenant.id,
        name: 'Account B',
        enabled: true,
        config: {
          identity: { botName: 'BETA-BOT', language: 'fr' },
          behavior: { tone: 'casual', verbosity: 'long' },
          prompts: { system: 'When answering, include BETA-MARKER once.' }
        }
      }
    });

    let systemPromptA = '';
    let userPromptA = '';
    let systemPromptB = '';
    let userPromptB = '';

    mockLlm.generateResponse = async (sysPrompt: string, messages: any[]) => {
      const userContent = messages[0]?.content || '';
      if (sysPrompt.includes('ALPHA-MARKER')) {
        systemPromptA = sysPrompt;
        userPromptA = userContent;
        return 'Alpha answer. ALPHA-MARKER';
      }
      if (sysPrompt.includes('BETA-MARKER')) {
        systemPromptB = sysPrompt;
        userPromptB = userContent;
        return 'Beta answer. BETA-MARKER';
      }
      return 'UNANSWERABLE';
    };

    const resA = await deps.conversationEngine.handleMessage(tenant.id, `cust-A-${Date.now()}`, 'What is your refund policy?', accountA.id);
    const resB = await deps.conversationEngine.handleMessage(tenant.id, `cust-B-${Date.now()}`, 'What is your refund policy?', accountB.id);

    // Verify Account A
    expect(resA).toContain('ALPHA-MARKER');
    expect(systemPromptA).toContain('ALPHA-BOT');
    expect(systemPromptA).toContain('Use a professional tone.');
    expect(systemPromptA).toContain('Keep responses concise and direct.');
    expect(systemPromptA).toContain('When answering, include ALPHA-MARKER once.');
    expect(systemPromptA).not.toContain('BETA');

    // Verify Account B
    expect(resB).toContain('BETA-MARKER');
    expect(systemPromptB).toContain('BETA-BOT');
    expect(systemPromptB).toContain('Use a casual, conversational tone.');
    expect(systemPromptB).toContain('Provide thorough, detailed explanations.');
    expect(systemPromptB).toContain('When answering, include BETA-MARKER once.');
    expect(systemPromptB).not.toContain('ALPHA');

    // Verify Trust Boundary formatting
    expect(userPromptA).toContain('<UNTRUSTED_KNOWLEDGE_DATA>');
    expect(userPromptA).toContain('<CUSTOMER_QUESTION>');
    expect(userPromptA).toContain('What is your refund policy?');
  });

  it('2. Language Policy correctly handles English, French, Arabic, and Darija', async () => {
    const tenant = await prisma.tenant.create({
      data: {
        name: `Tenant-Lang-${Date.now()}`,
        config: {
          create: {
            config: {
              ...DEFAULT_BUSINESS_CONFIG,
              llm: { provider: 'mock', model: 'mock-model', temperature: 0.1, maxTokens: 500, timeoutMs: 5000 },
              workflows: {},
              capabilities: { ...DEFAULT_BUSINESS_CONFIG.capabilities, faq: [] }
            }
          }
        }
      }
    });

    const account = await prisma.account.create({
      data: {
        tenantId: tenant.id,
        name: 'Multi-Lang Account',
        enabled: true,
        config: {
          identity: { botName: 'Global Bot', language: 'fr' }
        }
      }
    });

    const capturedPrompts: Record<string, string> = {};

    mockLlm.generateResponse = async (sysPrompt: string, messages: any[]) => {
      const userContent = messages[0]?.content || '';
      if (userContent.includes('horaires')) {
        capturedPrompts['fr'] = sysPrompt;
        return 'Ouvert de 9h à 18h.';
      }
      if (userContent.includes('hours')) {
        capturedPrompts['en'] = sysPrompt;
        return 'Open 9am to 6pm.';
      }
      if (userContent.includes('ساعات')) {
        capturedPrompts['ar'] = sysPrompt;
        return 'مفتوح من 9 صباحا إلى 6 مساء.';
      }
      if (userContent.includes('fo9ach')) {
        capturedPrompts['darija'] = sysPrompt;
        return 'Maftouh mn 9 l 18.';
      }
      return 'UNANSWERABLE';
    };

    await deps.conversationEngine.handleMessage(tenant.id, `cust-fr-${Date.now()}`, 'Quels sont vos horaires?', account.id);
    await deps.conversationEngine.handleMessage(tenant.id, `cust-en-${Date.now()}`, 'What are your hours?', account.id);
    await deps.conversationEngine.handleMessage(tenant.id, `cust-ar-${Date.now()}`, 'ما هي ساعات العمل؟', account.id);
    await deps.conversationEngine.handleMessage(tenant.id, `cust-dar-${Date.now()}`, 'fo9ach katsdo 3afak?', account.id);

    expect(capturedPrompts['fr']).toContain('detected: "fr"');
    expect(capturedPrompts['en']).toContain('detected: "en"');
    expect(capturedPrompts['ar']).toContain('detected: "ar"');
    expect(capturedPrompts['darija']).toContain('detected: "darija"');
    expect(capturedPrompts['fr']).toContain('primary language is "fr"');
  }, 60000);

  it('3. Unified prompt contract across post-completion workflow and workflow-less paths', async () => {
    const tenant = await prisma.tenant.create({
      data: {
        name: `Tenant-Workflow-P3-${Date.now()}`,
        config: {
          create: {
            config: {
              ...DEFAULT_BUSINESS_CONFIG,
              llm: { provider: 'mock', model: 'mock-model', temperature: 0.1, maxTokens: 500, timeoutMs: 5000 },
              workflows: {
                SURVEY: {
                  id: 'SURVEY',
                  initialState: 's1',
                  states: {
                    s1: {
                      id: 's1',
                      type: 'collect',
                      field: { name: 'rating', type: 'string', required: true, extractionPrompt: 'What is your rating?' },
                      transitions: [{ target: 'end' }]
                    },
                    end: {
                      id: 'end',
                      type: 'end',
                      prompt: 'Done',
                      transitions: []
                    }
                  }
                }
              }
            }
          }
        }
      }
    });

    const account = await prisma.account.create({
      data: {
        tenantId: tenant.id,
        name: 'Account Unified',
        enabled: true,
        config: {
          identity: { botName: 'Unified Bot' },
          prompts: { system: 'UNIFIED-SYSTEM-INSTRUCTION' }
        }
      }
    });

    let postCompletionSysPrompt = '';
    mockLlm.generateResponse = async (sysPrompt: string, messages: any[]) => {
      postCompletionSysPrompt = sysPrompt;
      return 'Post completion answer with UNIFIED-SYSTEM-INSTRUCTION';
    };

    const custId = `cust-wf-${Date.now()}`;
    // Turn 1: Start workflow
    const res1 = await deps.conversationEngine.handleMessage(tenant.id, custId, 'SURVEY', account.id);
    expect(res1).toBe('What is your rating?');

    // Turn 2: Complete workflow
    const res2 = await deps.conversationEngine.handleMessage(tenant.id, custId, '5 stars', account.id);
    expect(res2).toBe('Done');

    // Turn 3: Post-completion inquiry triggers grounded LLM safety net
    const resPost = await deps.conversationEngine.handleMessage(tenant.id, custId, 'Can I get a discount next time?', account.id);

    expect(resPost).toContain('UNIFIED-SYSTEM-INSTRUCTION');
    expect(postCompletionSysPrompt).toContain('Unified Bot');
    expect(postCompletionSysPrompt).toContain('UNIFIED-SYSTEM-INSTRUCTION');
    expect(postCompletionSysPrompt).toContain('<UNTRUSTED_KNOWLEDGE_DATA>');
  }, 20000);
});
