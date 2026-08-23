import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { prisma, pool } from '../../src/tests/testDb';
import { bootstrapChatbot } from '../../src/bootstrap';
import { DEFAULT_BUSINESS_CONFIG } from '../../src/domain/tenant/BusinessConfig';
import { LLMMockProvider } from '../../src/core/llm/LLMProvider';
import { LanguageDetector, SupportedLanguage } from '../../src/domain/faq/FaqMatcher';
import { DirectRagGuard } from '../../src/domain/rag/DirectRagGuard';
import { buildConversationContext } from '../../src/domain/conversation/ConversationContext';

describe('Phase 10: Multilingual Conversation Architecture Tests', () => {
  let deps: ReturnType<typeof bootstrapChatbot>;
  let mockLlm: LLMMockProvider;

  beforeAll(async () => {
    const client = await pool.connect();
    try {
      await client.query('SET search_path TO test, public, extensions;');
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

  it('1. Language Detector accurately classifies EN, FR, AR, and Darija / Arabizi', () => {
    // English
    expect(LanguageDetector.detect('What are your opening hours?')).toBe('en');
    expect(LanguageDetector.detect('support is available 9am-6pm')).toBe('en');
    expect(LanguageDetector.detect('24/7 support')).toBe('en');

    // French
    expect(LanguageDetector.detect('Quels sont vos horaires douverture ?')).toBe('fr');
    expect(LanguageDetector.detect('Bonjour, je voudrais des informations.')).toBe('fr');
    expect(LanguageDetector.detect('Merci beaucoup pour votre aide.')).toBe('fr');

    // Arabic
    expect(LanguageDetector.detect('ما هي ساعات العمل لديكم؟')).toBe('ar');
    expect(LanguageDetector.detect('أريد معرفة تفاصيل الاشتراك')).toBe('ar');
    expect(LanguageDetector.detect('شكرا جزيلا لكم')).toBe('ar');

    // Moroccan Darija / Arabizi
    expect(LanguageDetector.detect('شحال الثمن ديال هاد الخدمة؟')).toBe('darija');
    expect(LanguageDetector.detect('واش كاين ديسبونيبل دابا؟')).toBe('darija');
    expect(LanguageDetector.detect('chhal taman dyal hada?')).toBe('darija');
    expect(LanguageDetector.detect('wach kayn stock?')).toBe('darija');
    expect(LanguageDetector.detect('bghit hada')).toBe('darija');
    expect(LanguageDetector.detect('mzyan')).toBe('darija');
  });

  it('2. ConversationContext resolves effectiveLanguage and preserves context on short ambiguous messages', () => {
    // Initial French turn
    const ctx1 = buildConversationContext({
      tenantId: 't1',
      customerId: 'c1',
      conversationId: 'conv1',
      language: 'fr',
      accountLanguage: 'en',
      recentMessages: []
    });
    expect(ctx1.effectiveLanguage).toBe('fr');

    // Follow-up short message "ok" (detected as 'en') should inherit previous 'fr'
    const ctx2 = buildConversationContext({
      tenantId: 't1',
      customerId: 'c1',
      conversationId: 'conv1',
      language: 'en',
      accountLanguage: 'en',
      recentMessages: [
        { role: 'USER', content: 'Quels sont vos horaires ?', createdAt: new Date() },
        { role: 'ASSISTANT', content: 'Nous sommes ouverts de 9h à 18h.', createdAt: new Date() }
      ]
    });
    expect(ctx2.effectiveLanguage).toBe('fr');
  });

  it('3. Multi-turn conversation language switching works across languages', async () => {
    const tenant = await prisma.tenant.create({
      data: {
        name: `Tenant-LangSwitch-${Date.now()}`,
        config: {
          create: {
            config: {
              ...DEFAULT_BUSINESS_CONFIG,
              prompts: {
                ...DEFAULT_BUSINESS_CONFIG.prompts,
                greeting: {
                  en: 'Hello!',
                  fr: 'Bonjour !',
                  ar: 'مرحبا !',
                  darija: 'السلام عليكم !'
                },
                fallback: {
                  en: 'Fallback EN',
                  fr: 'Fallback FR',
                  ar: 'Fallback AR',
                  darija: 'Fallback Darija'
                }
              }
            }
          }
        }
      }
    });

    const custId = `cust-lang-switch-${Date.now()}`;

    // Turn 1: French greeting
    const res1 = await deps.conversationEngine.handleMessage(tenant.id, custId, 'Bonjour');
    expect(res1).toBe('Bonjour !');

    // Turn 2: French short follow-up "merci"
    const res2 = await deps.conversationEngine.handleMessage(tenant.id, custId, 'merci');
    expect(res2).toBe('Bonjour !');

    // Turn 3: Switch to English
    const res3 = await deps.conversationEngine.handleMessage(tenant.id, custId, 'hello');
    expect(res3).toBe('Hello!');

    // Turn 4: Switch to Arabic
    const res4 = await deps.conversationEngine.handleMessage(tenant.id, custId, 'مرحبا');
    expect(res4).toBe('مرحبا !');

    // Turn 5: Switch to Darija
    const res5 = await deps.conversationEngine.handleMessage(tenant.id, custId, 'salam labas');
    expect(res5).toBe('السلام عليكم !');
  }, 25000);

  it('4. DirectRagGuard allows same-language chunks and rejects cross-language raw returns', () => {
    // Same-language: English query, English chunk -> SAFE
    const res1 = DirectRagGuard.evaluate('What are your hours?', 'Our offices are open Monday to Friday from 9am to 6pm.', 'en');
    expect(res1.isSafe).toBe(true);
    expect(res1.reason).toBe('SAFE');

    // Same-language: French query, French chunk -> SAFE
    const res2 = DirectRagGuard.evaluate('Quels sont vos horaires ?', 'Nos bureaux sont ouverts du lundi au vendredi de 9h à 18h.', 'fr');
    expect(res2.isSafe).toBe(true);
    expect(res2.reason).toBe('SAFE');

    // Cross-language: French query, English chunk -> UNSAFE (LANGUAGE_MISMATCH)
    const res3 = DirectRagGuard.evaluate('Quels sont vos horaires ?', 'Our offices are open Monday to Friday from 9am to 6pm.', 'fr');
    expect(res3.isSafe).toBe(false);
    expect(res3.reason).toBe('LANGUAGE_MISMATCH');

    // Cross-language: Arabic query, English chunk -> UNSAFE (LANGUAGE_MISMATCH)
    const res4 = DirectRagGuard.evaluate('ما هي ساعات العمل؟', 'Our offices are open Monday to Friday from 9am to 6pm.', 'ar');
    expect(res4.isSafe).toBe(false);
    expect(res4.reason).toBe('LANGUAGE_MISMATCH');
  });

  it('5. Grounded LLM receives effective customer language instruction in prompt contract', async () => {
    const tenant = await prisma.tenant.create({
      data: {
        name: `Tenant-LangLLM-${Date.now()}`,
        config: {
          create: {
            config: {
              ...DEFAULT_BUSINESS_CONFIG,
              identity: { ...DEFAULT_BUSINESS_CONFIG.identity, language: 'fr' },
              llm: { provider: 'mock', model: 'mock-model', temperature: 0.1, maxTokens: 500, timeoutMs: 5000 },
              workflows: {},
              capabilities: { ...DEFAULT_BUSINESS_CONFIG.capabilities, faq: [] }
            }
          }
        }
      }
    });

    let capturedSystemPrompt = '';
    mockLlm.generateResponse = async (sysPrompt: string) => {
      capturedSystemPrompt = sysPrompt;
      return 'UNANSWERABLE';
    };

    const custId = `cust-lang-llm-${Date.now()}`;
    await deps.conversationEngine.handleMessage(tenant.id, custId, 'Quelles sont vos conditions de retour ?');

    expect(capturedSystemPrompt).toContain('The account configured primary language is "fr"');
    expect(capturedSystemPrompt).toContain('detected: "fr"');
    expect(capturedSystemPrompt).toContain('Always respond in the customer\'s language and script');
  }, 20000);

  it('6. Account Language Isolation: Concurrent Account A (FR) and Account B (AR) maintain distinct language policies', async () => {
    const tenant = await prisma.tenant.create({
      data: {
        name: `Tenant-Lang-Iso-${Date.now()}`,
        config: {
          create: {
            config: {
              ...DEFAULT_BUSINESS_CONFIG,
              identity: { ...DEFAULT_BUSINESS_CONFIG.identity, language: 'en' },
              prompts: {
                ...DEFAULT_BUSINESS_CONFIG.prompts,
                greeting: {
                  en: 'Hello!',
                  fr: 'Bonjour de Compte A !',
                  ar: 'مرحبا من الحساب ب !'
                }
              }
            }
          }
        }
      }
    });

    const accountA = await prisma.account.create({
      data: {
        tenantId: tenant.id,
        name: 'Account A (FR)',
        config: {
          identity: { language: 'fr', botName: 'Bot A' },
          prompts: {
            greeting: { fr: 'Bonjour de Compte A !', en: 'Hello from A' }
          }
        }
      }
    });

    const accountB = await prisma.account.create({
      data: {
        tenantId: tenant.id,
        name: 'Account B (AR)',
        config: {
          identity: { language: 'ar', botName: 'Bot B' },
          prompts: {
            greeting: { ar: 'مرحبا من الحساب ب !', en: 'Hello from B' }
          }
        }
      }
    });

    const custA = `cust-iso-a-${Date.now()}`;
    const custB = `cust-iso-b-${Date.now()}`;

    const [resA, resB] = await Promise.all([
      deps.conversationEngine.handleMessage(tenant.id, custA, 'Bonjour', accountA.id),
      deps.conversationEngine.handleMessage(tenant.id, custB, 'مرحبا', accountB.id)
    ]);

    expect(resA).toContain('Bonjour de Compte A !');
    expect(resB).toContain('مرحبا من الحساب ب !');
    expect(resA).not.toContain('مرحبا');
    expect(resB).not.toContain('Bonjour');
  }, 25000);
});
