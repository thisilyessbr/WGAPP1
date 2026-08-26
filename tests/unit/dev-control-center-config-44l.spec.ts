import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('PHASE DEV-FIX-44L: Dev Control Center UI Config Fixes', () => {
  const uiHtmlPath = path.resolve(__dirname, '../../src/dev/ui/index.html');
  const uiContent = fs.readFileSync(uiHtmlPath, 'utf-8');

  it('A. loadConfig synchronizes tenantId from the header input before fetching', () => {
    expect(uiContent).toMatch(/async function loadConfig\(\)\s*\{[\s\S]*?const currentInput = document\.getElementById\('tenantId'\)\?\.value\?\.trim\(\);[\s\S]*?if \(currentInput\) tenantId = currentInput;/);
    expect(uiContent).toMatch(/fetch\(`\/api\/dev\/config\?tenantId=\$\{encodeURIComponent\(tenantId\)\}`\)/);
  });

  it('B. Workflow field validation regex accepts valid snake_case field names', () => {
    const CAMEL_CASE_REGEX = /^[a-z][a-zA-Z0-9_]*$/;

    expect(CAMEL_CASE_REGEX.test('consultation_topic')).toBe(true);
    expect(CAMEL_CASE_REGEX.test('preferred_date')).toBe(true);
    expect(CAMEL_CASE_REGEX.test('preferred_time')).toBe(true);
    expect(CAMEL_CASE_REGEX.test('name')).toBe(true);
    expect(CAMEL_CASE_REGEX.test('phone')).toBe(true);
    expect(CAMEL_CASE_REGEX.test('email')).toBe(true);
    expect(CAMEL_CASE_REGEX.test('consultationTopic')).toBe(true);
  });

  it('C. Workflow field validation regex rejects invalid field names', () => {
    const CAMEL_CASE_REGEX = /^[a-z][a-zA-Z0-9_]*$/;

    expect(CAMEL_CASE_REGEX.test('1invalid')).toBe(false);
    expect(CAMEL_CASE_REGEX.test('_invalid')).toBe(false);
    expect(CAMEL_CASE_REGEX.test('invalid-name')).toBe(false);
    expect(CAMEL_CASE_REGEX.test('InvalidName')).toBe(false);
    expect(CAMEL_CASE_REGEX.test('name with space')).toBe(false);
    expect(CAMEL_CASE_REGEX.test('field$name')).toBe(false);
  });

  it('D. UI index.html contains updated regex in both save validator and renderer', () => {
    const count = uiContent.split('/^[a-z][a-zA-Z0-9_]*$/').length - 1;
    expect(count).toBeGreaterThanOrEqual(2);
  });
});
