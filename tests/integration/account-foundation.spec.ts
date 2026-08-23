import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { prisma, pool } from '../../src/tests/testDb';
import { bootstrapChatbot } from '../../src/bootstrap';
import { DEFAULT_BUSINESS_CONFIG } from '../../src/domain/tenant/BusinessConfig';
import { LLMMockProvider } from '../../src/core/llm/LLMProvider';
import { AccountConfigService } from '../../src/domain/tenant/AccountConfigService';

describe('Phase 1: Account Foundation Integration Tests', () => {
  let deps: ReturnType<typeof bootstrapChatbot>;
  let mockLlm: LLMMockProvider;
  let accountConfigService: AccountConfigService;

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
        CREATE INDEX IF NOT EXISTS "Account_tenantId_idx" ON "Account"("tenantId");
        CREATE UNIQUE INDEX IF NOT EXISTS "Account_tenantId_name_key" ON "Account"("tenantId", "name");
        CREATE INDEX IF NOT EXISTS "Conversation_tenantId_accountId_customerId_idx" ON "Conversation"("tenantId", "accountId", "customerId");
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
    accountConfigService = new AccountConfigService(prisma, deps.tenantConfigService);
  });

  it('A. Existing tenant request without accountId behaves exactly as before', async () => {
    const tenant = await prisma.tenant.create({
      data: {
        name: `Tenant-No-Account-${Date.now()}`,
        config: {
          create: {
            config: {
              ...DEFAULT_BUSINESS_CONFIG,
              prompts: {
                ...DEFAULT_BUSINESS_CONFIG.prompts,
                greeting: 'Hello from Tenant Base!'
              }
            }
          }
        }
      }
    });

    const custId = `cust-legacy-${Date.now()}`;
    const res = await deps.conversationEngine.handleMessage(tenant.id, custId, 'hello');
    expect(res).toBe('Hello from Tenant Base!');

    const conv = await prisma.conversation.findFirst({
      where: { tenantId: tenant.id, customer: { externalId: custId } }
    });
    expect(conv).toBeDefined();
    expect(conv?.accountId).toBeNull();
  });

  it('B & C & D. Creates Account, sends request with accountId, and associates Conversation', async () => {
    const tenant = await prisma.tenant.create({
      data: {
        name: `Tenant-With-Account-${Date.now()}`,
        config: {
          create: {
            config: DEFAULT_BUSINESS_CONFIG
          }
        }
      }
    });

    const account = await prisma.account.create({
      data: {
        tenantId: tenant.id,
        name: 'WhatsApp Support Line 1',
        enabled: true,
        config: {
          identity: {
            botName: 'WhatsApp Assistant'
          },
          prompts: {
            greeting: 'Welcome to WhatsApp Support Line 1!'
          }
        }
      }
    });

    const custId = `cust-acc-${Date.now()}`;
    const res = await deps.conversationEngine.handleMessage(
      tenant.id,
      custId,
      'hello',
      account.id
    );

    expect(res).toBe('Welcome to WhatsApp Support Line 1!');

    const conv = await prisma.conversation.findFirst({
      where: { tenantId: tenant.id, customer: { externalId: custId } }
    });
    expect(conv).toBeDefined();
    expect(conv?.accountId).toBe(account.id);
  });

  it('E. Cross-tenant account access is rejected', async () => {
    const tenantA = await prisma.tenant.create({
      data: {
        name: `Tenant-A-${Date.now()}`,
        config: { create: { config: DEFAULT_BUSINESS_CONFIG } }
      }
    });

    const tenantB = await prisma.tenant.create({
      data: {
        name: `Tenant-B-${Date.now()}`,
        config: { create: { config: DEFAULT_BUSINESS_CONFIG } }
      }
    });

    const accountA = await prisma.account.create({
      data: {
        tenantId: tenantA.id,
        name: 'Account for Tenant A',
        enabled: true
      }
    });

    const custId = `cust-cross-${Date.now()}`;

    // Attempt to use tenant A's account with tenant B must throw
    await expect(
      deps.conversationEngine.handleMessage(tenantB.id, custId, 'hello', accountA.id)
    ).rejects.toThrow(/not found for tenant/i);

    await expect(
      accountConfigService.getEffectiveConfig(tenantB.id, accountA.id)
    ).rejects.toThrow(/not found for tenant/i);
  });

  it('F. Existing conversation with accountId = null still continues to work seamlessly', async () => {
    const tenant = await prisma.tenant.create({
      data: {
        name: `Tenant-Null-Acc-${Date.now()}`,
        config: {
          create: {
            config: {
              ...DEFAULT_BUSINESS_CONFIG,
              workflows: {
                FLOW_1: {
                  id: 'FLOW_1',
                  name: 'Flow 1',
                  description: 'Test Flow',
                  initialState: 'step1',
                  states: {
                    step1: {
                      type: 'collect',
                      prompt: 'What is your city?',
                      field: { name: 'city', type: 'string', required: true },
                      next: 'done'
                    },
                    done: {
                      type: 'message',
                      prompt: 'City recorded.'
                    }
                  }
                }
              }
            }
          }
        }
      }
    });

    const customer = await prisma.customer.create({
      data: {
        tenantId: tenant.id,
        externalId: `cust-existing-${Date.now()}`
      }
    });

    // Create existing conversation with explicit null accountId
    const existingConv = await prisma.conversation.create({
      data: {
        tenantId: tenant.id,
        customerId: customer.id,
        accountId: null,
        status: 'ACTIVE'
      }
    });

    // Send turn 1 without accountId
    const res1 = await deps.conversationEngine.handleMessage(tenant.id, customer.externalId, 'FLOW_1');
    expect(res1).toBe('What is your city?');

    // Send turn 2 without accountId
    const res2 = await deps.conversationEngine.handleMessage(tenant.id, customer.externalId, 'Casablanca');
    expect(res2).toBe('City recorded.');

    const updatedConv = await prisma.conversation.findUnique({
      where: { id: existingConv.id }
    });
    expect(updatedConv?.accountId).toBeNull();
    expect(updatedConv?.messageCount).toBe(2);
  });

  it('G. Config inheritance: Account overrides specific fields while inheriting Tenant defaults', async () => {
    const tenant = await prisma.tenant.create({
      data: {
        name: `Tenant-Inherit-${Date.now()}`,
        config: {
          create: {
            config: {
              ...DEFAULT_BUSINESS_CONFIG,
              identity: {
                botName: 'Base Bot',
                language: 'en',
                brand: 'Base Brand'
              },
              behavior: {
                tone: 'professional',
                verbosity: 'short',
                stayOnTopic: true,
                answerOnlyFromKnowledge: false,
                allowSmallTalk: true,
                allowHumanHandoff: false
              },
              limits: {
                maxConversationHistory: 20,
                maxWorkflowSteps: 15,
                maxResponseLength: 600
              },
              prompts: {
                ...DEFAULT_BUSINESS_CONFIG.prompts,
                greeting: 'Base Greeting',
                fallback: 'Base Fallback'
              }
            }
          }
        }
      }
    });

    const account = await prisma.account.create({
      data: {
        tenantId: tenant.id,
        name: 'Account Override Line',
        enabled: true,
        config: {
          identity: {
            botName: 'Overridden Account Bot'
            // brand is omitted -> should inherit 'Base Brand'
          },
          behavior: {
            tone: 'casual'
            // verbosity is omitted -> should inherit 'short'
          },
          prompts: {
            greeting: 'Account Custom Greeting'
            // fallback is omitted -> should inherit 'Base Fallback'
          }
        }
      }
    });

    const effectiveConfig = await accountConfigService.getEffectiveConfig(tenant.id, account.id);

    // Overridden fields
    expect(effectiveConfig.identity.botName).toBe('Overridden Account Bot');
    expect(effectiveConfig.behavior.tone).toBe('casual');
    expect(effectiveConfig.prompts.greeting).toBe('Account Custom Greeting');

    // Inherited fields
    expect(effectiveConfig.identity.brand).toBe('Base Brand');
    expect(effectiveConfig.identity.language).toBe('en');
    expect(effectiveConfig.behavior.verbosity).toBe('short');
    expect(effectiveConfig.behavior.stayOnTopic).toBe(true);
    expect(effectiveConfig.limits.maxResponseLength).toBe(600);
    expect(effectiveConfig.prompts.fallback).toBe('Base Fallback');

    // Verify base tenant config was not mutated
    const baseConfig = await deps.tenantConfigService.getConfig(tenant.id);
    expect(baseConfig.identity.botName).toBe('Base Bot');
    expect(baseConfig.behavior.tone).toBe('professional');
    expect(baseConfig.prompts.greeting).toBe('Base Greeting');
  });

  it('H. No RAG/FAQ/Workflow/LLM behavior is broken by the Account foundation', async () => {
    const tenant = await prisma.tenant.create({
      data: {
        name: `Tenant-Full-Stack-${Date.now()}`,
        config: {
          create: {
            config: {
              ...DEFAULT_BUSINESS_CONFIG,
              workflows: {},
              capabilities: {
                ...DEFAULT_BUSINESS_CONFIG.capabilities,
                faq: [
                  {
                    id: 'faq-pricing',
                    questions: { en: 'How much does it cost?' },
                    answers: { en: 'Pricing starts at 100 MAD/month.' },
                    keywords: { en: ['cost', 'pricing'] }
                  }
                ]
              }
            }
          }
        }
      }
    });

    const account = await prisma.account.create({
      data: {
        tenantId: tenant.id,
        name: 'FAQ Line',
        enabled: true
      }
    });

    // 1. FAQ test with accountId
    const resFaq = await deps.conversationEngine.handleMessage(
      tenant.id,
      `cust-faq-${Date.now()}`,
      'How much does it cost?',
      account.id
    );
    expect(resFaq).toBe('Pricing starts at 100 MAD/month.');

    // 2. Deterministic greeting test with accountId
    const resGreeting = await deps.conversationEngine.handleMessage(
      tenant.id,
      `cust-greet-${Date.now()}`,
      'hello',
      account.id
    );
    expect(resGreeting).toBe('Hello! How can I help you today?');

    // 3. Fallback test with accountId
    const resFallback = await deps.conversationEngine.handleMessage(
      tenant.id,
      `cust-fallback-${Date.now()}`,
      'unrecognized_gibberish_query_123',
      account.id
    );
    expect(resFallback).toBe('I did not understand that. Could you rephrase?');
  });
});
