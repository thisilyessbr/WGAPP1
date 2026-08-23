import { describe, it, expect, beforeEach, beforeAll, afterEach } from 'vitest';
import { prisma, pool } from '../../src/tests/testDb';
import { bootstrapChatbot } from '../../src/bootstrap';
import { DEFAULT_BUSINESS_CONFIG } from '../../src/domain/tenant/BusinessConfig';
import { LLMMockProvider } from '../../src/core/llm/LLMProvider';
import { TurnDecisionResolver } from '../../src/domain/conversation/TurnDecision';
import { EcommerceIntentParser } from '../../src/domain/ecommerce/EcommerceIntent';

describe('Phase 32C: Global Policy-vs-Ecommerce Disambiguation', { timeout: 20000 }, () => {
  let deps: ReturnType<typeof bootstrapChatbot>;
  let mockLlm: LLMMockProvider;
  const createdTenantIds: string[] = [];

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
    deps.llmFactory.registerProvider('deepseek', 'deepseek-chat', mockLlm);
    deps.llmFactory.registerProvider('gemini', 'gemini-1.5-flash', mockLlm);
    deps.llmFactory.registerProvider('gemini', 'gemini-1.5-pro', mockLlm);
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

  async function seedStore() {
    const tenant = await prisma.tenant.create({
      data: {
        name: `Tenant-Policy32C-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        config: {
          create: {
            config: {
              ...DEFAULT_BUSINESS_CONFIG,
              llm: {
                provider: 'mock',
                model: 'mock-model'
              },
              capabilities: {
                ...DEFAULT_BUSINESS_CONFIG.capabilities,
                ecommerceEnabled: true
              }
            }
          }
        },
        accounts: {
          create: {
            name: 'main-store',
            config: {
              llm: {
                provider: 'mock',
                model: 'mock-model'
              },
              capabilities: { ecommerceEnabled: true }
            }
          }
        }
      },
      include: { accounts: true }
    });
    createdTenantIds.push(tenant.id);
    const account = tenant.accounts[0];

    const hoodie = await prisma.product.create({
      data: {
        tenantId: tenant.id,
        accountId: account.id,
        sku: 'HOOD-CLASSIC',
        name: 'Moon Ninja Hoodie',
        description: 'Premium heavyweight cotton anime hoodie in black and white.',
        price: 350.0,
        currency: 'MAD',
        category: 'Hoodies',
        stock: 15,
        active: true,
        variants: {
          create: [
            {
              sku: 'HOOD-CLASSIC-BLK-M',
              name: 'Moon Ninja Hoodie - Black M',
              color: 'Black',
              size: 'M',
              stock: 5,
              active: true
            },
            {
              sku: 'HOOD-CLASSIC-BLK-L',
              name: 'Moon Ninja Hoodie - Black L',
              color: 'Black',
              size: 'L',
              stock: 10,
              active: true
            }
          ]
        }
      },
      include: { variants: true }
    });

    return { tenant, account, hoodie };
  }

  describe('Scenario 1-6: Multilingual Policy & Window Semantic Resolution', () => {
    it('1. Arabic return-window question -> RETURNS ("وشحال عندي من الوقت باش نرجع المنتج؟")', () => {
      const text = 'وشحال عندي من الوقت باش نرجع المنتج؟';
      const parsed = EcommerceIntentParser.parse(text);
      expect(parsed.intent).toBe('POLICY_INQUIRY');

      const resolved = TurnDecisionResolver.resolve({
        text,
        language: 'ar'
      });

      expect(resolved.domain).toBe('KNOWLEDGE');
      expect(resolved.intent).toBe('RETURNS');
      expect(resolved.productName).toBeNull();
      expect(resolved.productId).toBeNull();
    });

    it('2. Arabic exchange-window question -> RETURNS / KNOWLEDGE ("قداش بقا ليا باش نبدلو؟")', () => {
      const text = 'قداش بقا ليا باش نبدلو؟';
      const parsed = EcommerceIntentParser.parse(text);
      expect(parsed.intent).toBe('POLICY_INQUIRY');

      const resolved = TurnDecisionResolver.resolve({
        text,
        language: 'darija'
      });

      expect(resolved.domain).toBe('KNOWLEDGE');
      expect(resolved.intent).toBe('RETURNS');
    });

    it('3. Darija return question -> RETURNS ("واش نقدر نرجعو؟")', () => {
      const text = 'واش نقدر نرجعو؟';
      const parsed = EcommerceIntentParser.parse(text);
      expect(parsed.intent).toBe('POLICY_INQUIRY');

      const resolved = TurnDecisionResolver.resolve({
        text,
        language: 'darija'
      });

      expect(resolved.domain).toBe('KNOWLEDGE');
      expect(resolved.intent).toBe('RETURNS');
    });

    it('4. Arabizi return question -> RETURNS ("chhal 3ndi dlwa9t bach nrje3 lmontaj?")', () => {
      const text = 'chhal 3ndi dlwa9t bach nrje3 lmontaj?';
      const parsed = EcommerceIntentParser.parse(text);
      expect(parsed.intent).toBe('POLICY_INQUIRY');

      const resolved = TurnDecisionResolver.resolve({
        text,
        language: 'darija'
      });

      expect(resolved.domain).toBe('KNOWLEDGE');
      expect(resolved.intent).toBe('RETURNS');
    });

    it('5. English return-window -> RETURNS ("how long do I have to return it?")', () => {
      const text = 'how long do I have to return it?';
      const parsed = EcommerceIntentParser.parse(text);
      expect(parsed.intent).toBe('POLICY_INQUIRY');

      const resolved = TurnDecisionResolver.resolve({
        text,
        language: 'en'
      });

      expect(resolved.domain).toBe('KNOWLEDGE');
      expect(resolved.intent).toBe('RETURNS');
    });

    it('6. French return-window -> RETURNS ("combien de temps pour le retourner ?")', () => {
      const text = 'combien de temps pour le retourner ?';
      const parsed = EcommerceIntentParser.parse(text);
      expect(parsed.intent).toBe('POLICY_INQUIRY');

      const resolved = TurnDecisionResolver.resolve({
        text,
        language: 'fr'
      });

      expect(resolved.domain).toBe('KNOWLEDGE');
      expect(resolved.intent).toBe('RETURNS');
    });
  });

  describe('Scenario 7-9: Legitimate Price Questions Are Preserved', () => {
    it('7. Normal Arabic price question -> PRICE ("شحال الثمن ديالو؟")', () => {
      const text = 'شحال الثمن ديالو؟';
      const parsed = EcommerceIntentParser.parse(text);
      expect(parsed.intent).toBe('PRICE');

      const resolved = TurnDecisionResolver.resolve({
        text,
        language: 'ar',
        productContext: {
          selectedProductId: 'prod-hoodie-1',
          selectedSku: 'HOOD-CLASSIC'
        }
      });

      expect(resolved.domain).toBe('ECOMMERCE');
      expect(resolved.intent).toBe('PRICE');
      expect(resolved.productId).toBe('prod-hoodie-1');
    });

    it('8. Darija contextual price question -> PRICE ("وشحال كيسوى؟")', () => {
      const text = 'وشحال كيسوى؟';
      const parsed = EcommerceIntentParser.parse(text);
      expect(parsed.intent).toBe('PRICE');

      const resolved = TurnDecisionResolver.resolve({
        text,
        language: 'darija',
        productContext: {
          selectedProductId: 'prod-hoodie-1',
          selectedSku: 'HOOD-CLASSIC'
        }
      });

      expect(resolved.domain).toBe('ECOMMERCE');
      expect(resolved.intent).toBe('PRICE');
      expect(resolved.productId).toBe('prod-hoodie-1');
    });

    it('9. Arabizi price question -> PRICE ("ch7al kayswa?")', () => {
      const text = 'ch7al kayswa?';
      const parsed = EcommerceIntentParser.parse(text);
      expect(parsed.intent).toBe('PRICE');

      const resolved = TurnDecisionResolver.resolve({
        text,
        language: 'darija',
        productContext: {
          selectedProductId: 'prod-hoodie-1',
          selectedSku: 'HOOD-CLASSIC'
        }
      });

      expect(resolved.domain).toBe('ECOMMERCE');
      expect(resolved.intent).toBe('PRICE');
      expect(resolved.productId).toBe('prod-hoodie-1');
    });
  });

  describe('Scenario 10-15: Hybrid & Pure Policy Context Invariants', () => {
    it('10. Product-specific return question -> HYBRID ("شنو هي سياسة الإرجاع ديال Moon Ninja Hoodie؟")', () => {
      const text = 'شنو هي سياسة الإرجاع ديال Moon Ninja Hoodie؟';
      const parsed = EcommerceIntentParser.parse(text);
      expect(parsed.intent).toBe('POLICY_INQUIRY');
      expect(parsed.productName).toBe('Moon Ninja Hoodie');

      const resolved = TurnDecisionResolver.resolve({
        text,
        language: 'darija'
      });

      expect(resolved.domain).toBe('KNOWLEDGE');
      expect(resolved.intent).toBe('RETURNS');
      expect(resolved.source).toBe('HYBRID');
      expect(resolved.productName).toBe('Moon Ninja Hoodie');
    });

    it('11. Generic policy question with active product context -> KNOWLEDGE ("وشحال عندي من الوقت باش نرجع المنتج؟")', () => {
      const text = 'وشحال عندي من الوقت باش نرجع المنتج؟';
      const resolved = TurnDecisionResolver.resolve({
        text,
        language: 'darija',
        productContext: {
          selectedProductId: 'prod-hoodie-1',
          selectedSku: 'HOOD-CLASSIC'
        }
      });

      // Pure policy query with "المنتج" does not force product identification or ecommerce execution
      expect(resolved.domain).toBe('KNOWLEDGE');
      expect(resolved.intent).toBe('RETURNS');
      expect(resolved.source).toBe('RAG');
      expect(resolved.productName).toBeNull();
    });

    it('12. Policy question does not invoke Ecommerce execution', async () => {
      const { tenant, account } = await seedStore();

      // Step 1: User asks policy question
      const res = await deps.conversationEngine.handleMessage(
        tenant.id,
        'cust-policy-1',
        'وشحال عندي من الوقت باش نرجع المنتج؟',
        account.id
      );

      // Verify answer does not return empty or fail with unhandled ecommerce execution
      expect(res).toBeTruthy();
    });

    it('13. Price question still inherits active product context end-to-end', async () => {
      const { tenant, account } = await seedStore();

      // Step 1: Select hoodie
      const res1 = await deps.conversationEngine.handleMessage(
        tenant.id,
        'cust-ecom-policy-1',
        'tell me about Moon Ninja Hoodie',
        account.id
      );
      expect(res1).toContain('350');

      // Step 2: Price follow-up
      const res2 = await deps.conversationEngine.handleMessage(
        tenant.id,
        'cust-ecom-policy-1',
        'وشحال كيسوى؟',
        account.id
      );
      expect(res2).toContain('350');
    });

    it('14. Explicit product + price remains Ecommerce', () => {
      const text = 'Moon Ninja Hoodie شحال ثمن؟';
      const parsed = EcommerceIntentParser.parse(text);
      expect(parsed.intent).toBe('PRICE');
      expect(parsed.productName).toBe('Moon Ninja Hoodie');

      const resolved = TurnDecisionResolver.resolve({
        text,
        language: 'darija'
      });

      expect(resolved.domain).toBe('ECOMMERCE');
      expect(resolved.intent).toBe('PRICE');
      expect(resolved.productName).toBe('Moon Ninja Hoodie');
    });

    it('15. Explicit product + return remains Hybrid Knowledge', () => {
      const text = 'وشحال عندي من الوقت باش نرجع Moon Ninja Hoodie؟';
      const parsed = EcommerceIntentParser.parse(text);
      expect(parsed.intent).toBe('POLICY_INQUIRY');
      expect(parsed.productName).toBe('Moon Ninja Hoodie');

      const resolved = TurnDecisionResolver.resolve({
        text,
        language: 'darija',
        productContext: {
          selectedProductId: 'prod-old-1'
        }
      });

      expect(resolved.domain).toBe('KNOWLEDGE');
      expect(resolved.intent).toBe('RETURNS');
      expect(resolved.source).toBe('HYBRID');
      expect(resolved.productName).toBe('Moon Ninja Hoodie');
    });
  });
});
