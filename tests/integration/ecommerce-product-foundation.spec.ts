import { describe, it, expect, beforeEach, beforeAll, afterEach } from 'vitest';
import { prisma, pool } from '../../src/tests/testDb';
import { bootstrapChatbot } from '../../src/bootstrap';
import { DEFAULT_BUSINESS_CONFIG } from '../../src/domain/tenant/BusinessConfig';
import { LLMMockProvider } from '../../src/core/llm/LLMProvider';
import { ProductRepository } from '../../src/domain/ecommerce/ProductRepository';
import { EcommerceService } from '../../src/domain/ecommerce/EcommerceService';

describe('Phase 13B: Ecommerce Product Foundation Tests', () => {
  let deps: ReturnType<typeof bootstrapChatbot>;
  let mockLlm: LLMMockProvider;
  let productRepo: ProductRepository;
  let ecommerceService: EcommerceService;
  const createdTenantIds: string[] = [];

  beforeAll(async () => {
    const client = await pool.connect();
    try {
      await client.query('SET search_path TO test, public, extensions;');
      await client.query(`
        CREATE TABLE IF NOT EXISTS test."Product" (
            "id" TEXT NOT NULL,
            "tenantId" TEXT NOT NULL,
            "accountId" TEXT NOT NULL,
            "sku" TEXT NOT NULL,
            "name" TEXT NOT NULL,
            "nameLocalized" JSONB,
            "description" TEXT NOT NULL,
            "descriptionLocalized" JSONB,
            "price" DECIMAL(10,2) NOT NULL,
            "currency" TEXT NOT NULL DEFAULT 'USD',
            "stock" INTEGER NOT NULL DEFAULT 0,
            "active" BOOLEAN NOT NULL DEFAULT true,
            "category" TEXT,
            "metadata" JSONB,
            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

            CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
        );

        CREATE TABLE IF NOT EXISTS test."ProductVariant" (
            "id" TEXT NOT NULL,
            "productId" TEXT NOT NULL,
            "sku" TEXT NOT NULL,
            "name" TEXT,
            "size" TEXT,
            "color" TEXT,
            "priceOverride" DECIMAL(10,2),
            "stock" INTEGER NOT NULL DEFAULT 0,
            "active" BOOLEAN NOT NULL DEFAULT true,
            "metadata" JSONB,
            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

            CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
        );

        CREATE UNIQUE INDEX IF NOT EXISTS "Product_tenantId_accountId_sku_key" ON test."Product"("tenantId", "accountId", "sku");
        CREATE INDEX IF NOT EXISTS "Product_tenantId_accountId_idx" ON test."Product"("tenantId", "accountId");
        CREATE INDEX IF NOT EXISTS "Product_tenantId_accountId_active_idx" ON test."Product"("tenantId", "accountId", "active");
        CREATE INDEX IF NOT EXISTS "Product_tenantId_accountId_category_idx" ON test."Product"("tenantId", "accountId", "category");
        CREATE UNIQUE INDEX IF NOT EXISTS "ProductVariant_productId_sku_key" ON test."ProductVariant"("productId", "sku");
        CREATE INDEX IF NOT EXISTS "ProductVariant_productId_idx" ON test."ProductVariant"("productId");
        CREATE INDEX IF NOT EXISTS "ProductVariant_productId_active_idx" ON test."ProductVariant"("productId", "active");
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
    productRepo = new ProductRepository(prisma);
    ecommerceService = new EcommerceService(productRepo);
  });

  afterEach(async () => {
    // Cleanup temporary test data
    for (const tenantId of createdTenantIds) {
      try {
        await prisma.tenant.delete({ where: { id: tenantId } });
      } catch (err) {}
    }
    createdTenantIds.length = 0;
  });

  it('1. Product & Variant Schema: Creates product and variants with constraints', async () => {
    const tenant = await prisma.tenant.create({
      data: {
        name: `Tenant-ProdSchema-${Date.now()}`,
        accounts: {
          create: {
            name: 'main-store',
            config: { capabilities: { ecommerceEnabled: true } }
          }
        }
      },
      include: { accounts: true }
    });
    createdTenantIds.push(tenant.id);
    const account = tenant.accounts[0];

    const product = await prisma.product.create({
      data: {
        tenantId: tenant.id,
        accountId: account.id,
        sku: 'SKU-HEADPHONES-01',
        name: 'Atlas Pro Wireless',
        nameLocalized: {
          en: 'Atlas Pro Wireless',
          fr: 'Atlas Pro Sans Fil',
          ar: 'أطلس برو لاسلكي',
          darija: 'أطلس برو بلا خيط'
        },
        description: 'Premium noise cancelling headphones',
        descriptionLocalized: {
          en: 'Premium noise cancelling headphones',
          fr: 'Casque antibruit haut de gamme',
          ar: 'سماعات رأس عازلة للضوضاء',
          darija: 'كاسك ممتاز كيعزل الصداع'
        },
        price: 199.99,
        currency: 'USD',
        stock: 15,
        active: true,
        category: 'Electronics',
        variants: {
          create: [
            {
              sku: 'SKU-HEADPHONES-BLK',
              name: 'Midnight Black',
              color: 'Black',
              stock: 10,
              active: true
            },
            {
              sku: 'SKU-HEADPHONES-SLV',
              name: 'Silver Mist',
              color: 'Silver',
              priceOverride: 219.99,
              stock: 5,
              active: true
            }
          ]
        }
      },
      include: { variants: true }
    });

    expect(product.id).toBeDefined();
    expect(product.variants.length).toBe(2);
    expect(Number(product.price)).toBe(199.99);
  });

  it('2. Account Isolation: Account A cannot retrieve Account B products even with exact SKU', async () => {
    const tenant = await prisma.tenant.create({
      data: {
        name: `Tenant-Iso-${Date.now()}`,
        accounts: {
          create: [
            { name: 'store-a', config: { capabilities: { ecommerceEnabled: true } } },
            { name: 'store-b', config: { capabilities: { ecommerceEnabled: true } } }
          ]
        }
      },
      include: { accounts: true }
    });
    createdTenantIds.push(tenant.id);
    const accountA = tenant.accounts.find(a => a.name === 'store-a')!;
    const accountB = tenant.accounts.find(a => a.name === 'store-b')!;

    // Create Product in Account A
    await prisma.product.create({
      data: {
        tenantId: tenant.id,
        accountId: accountA.id,
        sku: 'SKU-A1',
        name: 'Product A',
        description: 'Only in Store A',
        price: 100,
        currency: 'USD',
        stock: 5
      }
    });

    // Create Product in Account B
    await prisma.product.create({
      data: {
        tenantId: tenant.id,
        accountId: accountB.id,
        sku: 'SKU-B1',
        name: 'Product B',
        description: 'Only in Store B',
        price: 900,
        currency: 'USD',
        stock: 2
      }
    });

    // Account A lookups
    const prodAFromA = await productRepo.findBySku(tenant.id, accountA.id, 'SKU-A1');
    expect(prodAFromA).not.toBeNull();
    expect(prodAFromA?.name).toBe('Product A');

    const prodBFromA = await productRepo.findBySku(tenant.id, accountA.id, 'SKU-B1');
    expect(prodBFromA).toBeNull(); // ISOLATION: A cannot see B

    // Account B lookups
    const prodBFromB = await productRepo.findBySku(tenant.id, accountB.id, 'SKU-B1');
    expect(prodBFromB).not.toBeNull();
    expect(prodBFromB?.name).toBe('Product B');

    const prodAFromB = await productRepo.findBySku(tenant.id, accountB.id, 'SKU-A1');
    expect(prodAFromB).toBeNull(); // ISOLATION: B cannot see A
  });

  it('3. Product Fact Authority: Live price/stock reflects immediate DB updates without stale memory', async () => {
    const tenant = await prisma.tenant.create({
      data: {
        name: `Tenant-LiveFacts-${Date.now()}`,
        accounts: {
          create: {
            name: 'main-store',
            config: { capabilities: { ecommerceEnabled: true } }
          }
        }
      },
      include: { accounts: true }
    });
    createdTenantIds.push(tenant.id);
    const account = tenant.accounts[0];

    const product = await prisma.product.create({
      data: {
        tenantId: tenant.id,
        accountId: account.id,
        sku: 'SKU-DYNAMIC-01',
        name: 'Dynamic Gadget',
        description: 'Subject to live price changes',
        price: 199,
        currency: 'USD',
        stock: 7
      }
    });

    // Initial query
    const fact1 = await ecommerceService.getProductFact(tenant.id, account.id, { sku: 'SKU-DYNAMIC-01' });
    expect(fact1?.effectivePrice).toBe(199);
    expect(fact1?.availableStock).toBe(7);
    expect(fact1?.inStock).toBe(true);

    // Update DB directly
    await prisma.product.update({
      where: { id: product.id },
      data: { price: 249, stock: 0 }
    });

    // Second query: Must return live values
    const fact2 = await ecommerceService.getProductFact(tenant.id, account.id, { sku: 'SKU-DYNAMIC-01' });
    expect(fact2?.effectivePrice).toBe(249);
    expect(fact2?.availableStock).toBe(0);
    expect(fact2?.inStock).toBe(false);
  });

  it('4. Variant Resolution: Resolves specific size/color combinations and stock', async () => {
    const tenant = await prisma.tenant.create({
      data: {
        name: `Tenant-Variants-${Date.now()}`,
        accounts: {
          create: {
            name: 'shoe-store',
            config: { capabilities: { ecommerceEnabled: true } }
          }
        }
      },
      include: { accounts: true }
    });
    createdTenantIds.push(tenant.id);
    const account = tenant.accounts[0];

    const product = await prisma.product.create({
      data: {
        tenantId: tenant.id,
        accountId: account.id,
        sku: 'SKU-ATLAS-SHOE',
        name: 'Atlas Running Shoes',
        description: 'Comfortable sports shoes',
        price: 80,
        currency: 'USD',
        stock: 8,
        variants: {
          create: [
            { sku: 'SHOE-BLK-42', color: 'Black', size: '42', stock: 3 },
            { sku: 'SHOE-BLK-43', color: 'Black', size: '43', stock: 0 },
            { sku: 'SHOE-WHT-42', color: 'White', size: '42', stock: 5 }
          ]
        }
      }
    });

    // 1. Black / 42 -> in stock
    const fact1 = await ecommerceService.getProductFact(tenant.id, account.id, { id: product.id, color: 'Black', size: '42' });
    expect(fact1?.selectedVariant?.sku).toBe('SHOE-BLK-42');
    expect(fact1?.inStock).toBe(true);
    expect(fact1?.availableStock).toBe(3);

    // 2. Black / 43 -> out of stock
    const fact2 = await ecommerceService.getProductFact(tenant.id, account.id, { id: product.id, color: 'Black', size: '43' });
    expect(fact2?.selectedVariant?.sku).toBe('SHOE-BLK-43');
    expect(fact2?.inStock).toBe(false);
    expect(fact2?.availableStock).toBe(0);

    // 3. White / 42 -> in stock
    const fact3 = await ecommerceService.getProductFact(tenant.id, account.id, { id: product.id, color: 'White', size: '42' });
    expect(fact3?.selectedVariant?.sku).toBe('SHOE-WHT-42');
    expect(fact3?.inStock).toBe(true);
    expect(fact3?.availableStock).toBe(5);
  });

  it('5. Disabled Ecommerce: When ecommerceEnabled is false, no product lookup occurs', async () => {
    const tenant = await prisma.tenant.create({
      data: {
        name: `Tenant-EcomDisabled-${Date.now()}`,
        config: { create: { config: DEFAULT_BUSINESS_CONFIG } },
        accounts: {
          create: {
            name: 'disabled-store',
            config: { capabilities: { ecommerceEnabled: false } }
          }
        }
      },
      include: { accounts: true }
    });
    createdTenantIds.push(tenant.id);
    const account = tenant.accounts[0];

    await prisma.product.create({
      data: {
        tenantId: tenant.id,
        accountId: account.id,
        sku: 'SKU-HIDDEN-01',
        name: 'Hidden Product',
        description: 'Should not be queried',
        price: 50,
        currency: 'USD',
        stock: 10
      }
    });

    let llmCalled = false;
    mockLlm.generateResponse = async () => {
      llmCalled = true;
      return 'I cannot help with product sales.';
    };

    const custId = `cust-ecom-off-${Date.now()}`;
    const response = await deps.conversationEngine.handleMessage(
      tenant.id,
      custId,
      'What is the price of SKU-HIDDEN-01?',
      account.id
    );

    // Should fall through to normal LLM/Fallback rather than deterministic ECOMMERCE
    expect(response).not.toContain('50 USD');
  });

  it('6. Multilingual Product Presentation: Localized display names and descriptions', async () => {
    const tenant = await prisma.tenant.create({
      data: {
        name: `Tenant-MultiProd-${Date.now()}`,
        accounts: {
          create: {
            name: 'multi-store',
            config: { capabilities: { ecommerceEnabled: true } }
          }
        }
      },
      include: { accounts: true }
    });
    createdTenantIds.push(tenant.id);
    const account = tenant.accounts[0];

    await prisma.product.create({
      data: {
        tenantId: tenant.id,
        accountId: account.id,
        sku: 'SKU-MULTI-01',
        name: 'Smart Watch',
        nameLocalized: {
          en: 'Smart Watch',
          fr: 'Montre Intelligente',
          ar: 'ساعة ذكية',
          darija: 'مكانة ذكية'
        },
        description: 'High tech watch',
        descriptionLocalized: {
          en: 'High tech watch',
          fr: 'Montre haute technologie',
          ar: 'ساعة عالية التقنية',
          darija: 'مكانة بتقنية عالية'
        },
        price: 150,
        currency: 'EUR',
        stock: 4
      }
    });

    // English
    const enFact = await ecommerceService.getProductFact(tenant.id, account.id, { sku: 'SKU-MULTI-01' }, 'en');
    expect(enFact?.displayName).toBe('Smart Watch');

    // French
    const frFact = await ecommerceService.getProductFact(tenant.id, account.id, { sku: 'SKU-MULTI-01' }, 'fr');
    expect(frFact?.displayName).toBe('Montre Intelligente');

    // Arabic
    const arFact = await ecommerceService.getProductFact(tenant.id, account.id, { sku: 'SKU-MULTI-01' }, 'ar');
    expect(arFact?.displayName).toBe('ساعة ذكية');

    // Darija
    const darFact = await ecommerceService.getProductFact(tenant.id, account.id, { sku: 'SKU-MULTI-01' }, 'darija');
    expect(darFact?.displayName).toBe('مكانة ذكية');
  });
});
