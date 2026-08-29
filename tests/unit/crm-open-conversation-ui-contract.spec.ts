import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Phase CRM-C-FIX-02 — CRM Open Conversation UI Contract', () => {
  const htmlPath = path.join(process.cwd(), 'src/dev/ui/index.html');
  const htmlContent = fs.readFileSync(htmlPath, 'utf8');

  it('A. openLeadConversation() calls loadConversationHistory and does NOT call resetChat', () => {
    const openLeadFuncMatch = htmlContent.match(/function\s+openLeadConversation\s*\(\)\s*\{([\s\S]*?)\}/);
    expect(openLeadFuncMatch).not.toBeNull();
    const body = openLeadFuncMatch![1];

    expect(body).toContain('loadConversationHistory');
    expect(body).not.toContain('resetChat(');
    expect(body).not.toContain('/api/dev/reset');
  });

  it('B. loadConversationHistory() function exists and fetches /api/dev/conversations/latest with tenantId, customerId, and accountId', () => {
    const loadFuncMatch = htmlContent.match(/async\s+function\s+loadConversationHistory\s*\([\s\S]*?\)\s*\{([\s\S]*?)\n\s*async\s+function/);
    expect(loadFuncMatch).not.toBeNull();
    const body = loadFuncMatch![1];

    expect(body).toContain('/api/dev/conversations/latest');
    expect(body).toContain('tenantId=');
    expect(body).toContain('customerId=');
    expect(body).toContain('accountId=');
    expect(body).toContain('chatCustomerId');
    expect(body).toContain('chatAccountSelect');
    expect(body).toContain('appendMsg');
    expect(body).not.toContain('/api/dev/reset');
  });

  it('C. resetChat() remains intact for explicit Reset button and calls /api/dev/reset', () => {
    const resetFuncMatch = htmlContent.match(/async\s+function\s+resetChat\s*\(\)\s*\{([\s\S]*?)\}/);
    expect(resetFuncMatch).not.toBeNull();
    const body = resetFuncMatch![1];

    expect(body).toContain('/api/dev/reset');
    expect(body).toContain('POST');
  });

  it('D. Open Conversation button in modal invokes openLeadConversation()', () => {
    expect(htmlContent).toContain('onclick="openLeadConversation()"');
    expect(htmlContent).toContain('💬 Open Conversation');
  });

  it('E. appendMsg uses safe textContent for message rendering', () => {
    const appendMsgMatch = htmlContent.match(/function\s+appendMsg\s*\([\s\S]*?\)\s*\{([\s\S]*?)\n\s*function/);
    expect(appendMsgMatch).not.toBeNull();
    const body = appendMsgMatch![1];

    expect(body).toContain('textContent = text');
  });
});
