import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('CRM Leads UI Contract & Safety Tests', () => {
  let htmlContent: string;

  beforeAll(() => {
    const htmlPath = path.resolve(__dirname, '../../src/dev/ui/index.html');
    htmlContent = fs.readFileSync(htmlPath, 'utf8');
  });

  it('1. Navigation contains first-class CRM (Leads) tab', () => {
    expect(htmlContent).toContain(`switchTab(this, 'tab-crm')`);
    expect(htmlContent).toContain(`CRM (Leads)`);
    expect(htmlContent).toContain(`id="tab-crm"`);
  });

  it('2. Leads view contains Account selector, Status filter, and Leads container', () => {
    expect(htmlContent).toContain(`id="crmAccountSelect"`);
    expect(htmlContent).toContain(`id="crmAccountStatic"`);
    expect(htmlContent).toContain(`id="crmStatusFilter"`);
    expect(htmlContent).toContain(`id="crmLeadsContainer"`);
  });

  it('3. Status filter contains all 5 canonical pipeline statuses', () => {
    const allowedStatuses = ['NEW', 'CONTACTED', 'QUALIFIED', 'WON', 'LOST'];
    for (const status of allowedStatuses) {
      expect(htmlContent).toContain(`<option value="${status}">${status}</option>`);
    }
  });

  it('4. Lead Detail Modal contains required customer and status fields', () => {
    expect(htmlContent).toContain(`id="leadModal"`);
    expect(htmlContent).toContain(`id="lead_id"`);
    expect(htmlContent).toContain(`id="lead_customer_external_id"`);
    expect(htmlContent).toContain(`id="lead_customer_name"`);
    expect(htmlContent).toContain(`id="lead_customer_contact"`);
    expect(htmlContent).toContain(`id="lead_status_select"`);
    expect(htmlContent).toContain(`id="lead_updated_at"`);
  });

  it('5. Open conversation button is wired to openLeadConversation()', () => {
    expect(htmlContent).toContain(`onclick="openLeadConversation()"`);
    expect(htmlContent).toContain(`function openLeadConversation()`);
  });

  it('6. Lead detail rendering uses DOM-safe textContent for dynamic customer fields', () => {
    expect(htmlContent).toContain(`document.getElementById('lead_customer_name').textContent = displayName;`);
    expect(htmlContent).toContain(`document.getElementById('lead_customer_contact').textContent = contactInfo;`);
    expect(htmlContent).toContain(`document.getElementById('lead_updated_at').textContent =`);
  });

  it('7. Table rows use escapeHtml() to sanitize all customer identifiers and status badges', () => {
    expect(htmlContent).toContain(`escapeHtml(displayName)`);
    expect(htmlContent).toContain(`escapeHtml(contactInfo)`);
    expect(htmlContent).toContain(`escapeHtml(lead.status)`);
    expect(htmlContent).toContain(`escapeHtml(updatedDate)`);
  });

  it('8. JavaScript calls the proper CRM API endpoints with tenantId and accountId', () => {
    expect(htmlContent).toContain(`/api/dev/crm/leads?tenantId=`);
    expect(htmlContent).toContain(`/api/dev/crm/leads/\${encodeURIComponent(leadId)}`);
  });

  it('9. Status update sends ONLY permitted payload fields (tenantId, accountId, status)', () => {
    expect(htmlContent).toContain(`body: JSON.stringify({ tenantId, accountId, status })`);
  });
});
