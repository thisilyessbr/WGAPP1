import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('PHASE ACCOUNT-UI-FIX-21: Account UI Modals DOM Contract', () => {
  let html: string;

  beforeAll(() => {
    const htmlPath = path.resolve(__dirname, '../../src/dev/ui/index.html');
    html = fs.readFileSync(htmlPath, 'utf8');
  });

  it('1. Global header contains canonical + Add Account and + Create Tenant buttons', () => {
    expect(html).toContain(`onclick="openCreateAccountModal()"`);
    expect(html).toContain(`onclick="openCreateTenantModal()"`);

    // Verify they are inside <header>
    const headerMatch = html.match(/<header>([\s\S]*?)<\/header>/);
    expect(headerMatch).not.toBeNull();
    const headerContent = headerMatch![1];
    expect(headerContent).toContain('openCreateAccountModal()');
    expect(headerContent).toContain('openCreateTenantModal()');
    expect(headerContent).toContain('+ Add Account');
    expect(headerContent).toContain('+ Create Tenant');
  });

  it('2. Ecommerce tab does NOT contain redundant local + Add Account button', () => {
    const ecomTabMatch = html.match(/<div id="tab-ecommerce" class="tab-content">([\s\S]*?)<\/div>\s*<!-- CRM/);
    expect(ecomTabMatch).not.toBeNull();
    const ecomContent = ecomTabMatch![1];
    expect(ecomContent).not.toContain('openCreateAccountModal()');
    expect(ecomContent).not.toContain('+ Add Account');
  });

  it('3. #accountModal is NOT inside #tab-ecommerce or any other .tab-content', () => {
    const ecomTabMatch = html.match(/<div id="tab-ecommerce" class="tab-content">([\s\S]*?)<\/div>\s*<!-- CRM/);
    expect(ecomTabMatch).not.toBeNull();
    expect(ecomTabMatch![1]).not.toContain('id="accountModal"');

    // Verify it is placed under root body after script tags
    const afterScripts = html.substring(html.indexOf('</script>'));
    expect(afterScripts).toContain('id="accountModal"');
  });

  it('4. #tenantModal is NOT inside #tab-ecommerce or any other .tab-content', () => {
    const ecomTabMatch = html.match(/<div id="tab-ecommerce" class="tab-content">([\s\S]*?)<\/div>\s*<!-- CRM/);
    expect(ecomTabMatch).not.toBeNull();
    expect(ecomTabMatch![1]).not.toContain('id="tenantModal"');

    const afterScripts = html.substring(html.indexOf('</script>'));
    expect(afterScripts).toContain('id="tenantModal"');
  });

  it('5. #productModal and #variantModal are NOT inside #tab-ecommerce', () => {
    const ecomTabMatch = html.match(/<div id="tab-ecommerce" class="tab-content">([\s\S]*?)<\/div>\s*<!-- CRM/);
    expect(ecomTabMatch).not.toBeNull();
    expect(ecomTabMatch![1]).not.toContain('id="productModal"');
    expect(ecomTabMatch![1]).not.toContain('id="variantModal"');

    const afterScripts = html.substring(html.indexOf('</script>'));
    expect(afterScripts).toContain('id="productModal"');
    expect(afterScripts).toContain('id="variantModal"');
  });

  it('6. #leadModal is NOT inside #tab-crm', () => {
    const crmTabMatch = html.match(/<div id="tab-crm" class="tab-content">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/);
    expect(crmTabMatch).not.toBeNull();
    expect(crmTabMatch![1]).not.toContain('id="leadModal"');

    const afterScripts = html.substring(html.indexOf('</script>'));
    expect(afterScripts).toContain('id="leadModal"');
  });

  it('7. Modal handlers and input IDs remain intact', () => {
    // Tenant modal IDs
    expect(html).toContain('id="new_tenant_name"');
    expect(html).toContain('id="new_tenant_id"');
    expect(html).toContain('onclick="submitCreateTenant()"');
    expect(html).toContain('onclick="closeCreateTenantModal()"');

    // Account modal IDs
    expect(html).toContain('id="acc_name"');
    expect(html).toContain('id="acc_error"');
    expect(html).toContain('onclick="saveAccount()"');
    expect(html).toContain('onclick="closeAccountModal()"');

    // Product modal IDs
    expect(html).toContain('id="productModalTitle"');
    expect(html).toContain('id="p_name"');
    expect(html).toContain('id="p_sku"');
    expect(html).toContain('id="p_price"');
    expect(html).toContain('onclick="saveProduct()"');
    expect(html).toContain('onclick="closeProductModal()"');

    // Variant modal IDs
    expect(html).toContain('id="var_sku"');
    expect(html).toContain('onclick="saveVariant()"');
    expect(html).toContain('onclick="closeVariantModal()"');

    // Lead modal IDs
    expect(html).toContain('id="lead_id"');
    expect(html).toContain('id="lead_status_select"');
    expect(html).toContain('onclick="saveLeadStatus()"');
    expect(html).toContain('onclick="closeLeadModal()"');
    expect(html).toContain('onclick="openLeadConversation()"');
  });
});
