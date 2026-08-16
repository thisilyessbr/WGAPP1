import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TenantConfigService } from '../domain/tenant/TenantConfigService';
import { DEFAULT_BUSINESS_CONFIG } from '../domain/tenant/BusinessConfig';

import { prisma } from './testDb';

// Initialize Prisma similarly to the db test
const configService = new TenantConfigService(prisma);
describe('Generic Business Configuration Layer', () => {
  beforeAll(async () => {
    await prisma.knowledgeChunk.deleteMany();
    await prisma.knowledgeDocument.deleteMany();
    await prisma.knowledgeSource.deleteMany();
    await prisma.workflowSession.deleteMany();
    await prisma.message.deleteMany();
    await prisma.conversation.deleteMany();
    await prisma.tenantConfig.deleteMany();
    await prisma.customer.deleteMany();
    await prisma.tenant.deleteMany();
  });
  it('1. Should throw error for missing configuration', async () => {
    const tenant = await prisma.tenant.create({ data: { name: 'No Config Tenant' } });
    await expect(configService.getConfig(tenant.id)).rejects.toThrow(/Configuration not found/);
  });
  it('2. Should load generic defaults when config is mostly empty', async () => {
    const tenant = await prisma.tenant.create({ data: { name: 'Empty Config Tenant' } });
    await prisma.tenantConfig.create({
      data: { tenantId: tenant.id, config: {} }
    });
    const snapshot = await configService.getConfig(tenant.id);
    // Check various default categories
    expect(snapshot.identity.botName).toBe(DEFAULT_BUSINESS_CONFIG.identity.botName);
    expect(snapshot.behavior.stayOnTopic).toBe(true);
    expect(snapshot.limits.maxWorkflowSteps).toBe(10);
    expect(snapshot.llm.provider).toBe('deepseek');
  });
  it('3. Should load specific overrides (Prompts, Behavior, Limits, Knowledge, LLM)', async () => {
    const tenant = await prisma.tenant.create({ data: { name: 'Override Tenant' } });
    await prisma.tenantConfig.create({
      data: {
        tenantId: tenant.id,
        config: {
          prompts: { system: 'Custom system prompt' },
          behavior: { allowHumanHandoff: true },
          limits: { maxResponseLength: 1000 },
          knowledge: { enabled: true },
          llm: { temperature: 0.7 }
        }
      }
    });
    const snapshot = await configService.getConfig(tenant.id);
    // Validating specific overrides
    expect(snapshot.prompts.system).toBe('Custom system prompt');
    // Ensure others remain default
    expect(snapshot.prompts.fallback).toBe(DEFAULT_BUSINESS_CONFIG.prompts.fallback);
    expect(snapshot.behavior.allowHumanHandoff).toBe(true);
    expect(snapshot.limits.maxResponseLength).toBe(1000);
    expect(snapshot.knowledge.enabled).toBe(true);
    expect(snapshot.llm.temperature).toBe(0.7);
  });
  it('4. Should enforce tenant isolation (Cannot access other tenant config)', async () => {
    const tenantA = await prisma.tenant.create({ data: { name: 'Tenant A Config' } });
    const tenantB = await prisma.tenant.create({ data: { name: 'Tenant B Config' } });
    await prisma.tenantConfig.create({
      data: { tenantId: tenantA.id, config: { identity: { botName: 'Bot A' } } }
    });
    await prisma.tenantConfig.create({
      data: { tenantId: tenantB.id, config: { identity: { botName: 'Bot B' } } }
    });
    const configA = await configService.getConfig(tenantA.id);
    expect(configA.identity.botName).toBe('Bot A'); // Isolation intact
  });
  it('5. Should load completely fictional TutorExample tenant with TUTOR_SESSION workflow', async () => {
    // This proves the architecture can handle arbitrary workflows without TypeScript modifications
    const tenant = await prisma.tenant.create({ data: { name: 'TutorExample' } });
    const fictionalWorkflowConfig = {
      id: 'TUTOR_SESSION',
      initialState: 'collect_student',
      states: {
        collect_student: {
          id: 'collect_student',
          type: 'collect',
          field: { name: 'studentName', type: 'string', required: true },
          transitions: [{ target: 'collect_subject' }]
        },
        collect_subject: {
          id: 'collect_subject',
          type: 'collect',
          field: { name: 'subject', type: 'string', required: true },
          transitions: [{ target: 'collect_date' }]
        },
        collect_date: {
          id: 'collect_date',
          type: 'collect',
          field: { name: 'date', type: 'date', required: true },
          transitions: [{ target: 'collect_duration' }]
        },
        collect_duration: {
          id: 'collect_duration',
          type: 'collect',
          field: { name: 'duration', type: 'number', required: true },
          transitions: [{ target: 'end' }]
        },
        end: {
          id: 'end',
          type: 'end',
          transitions: []
        }
      }
    };
    await prisma.tenantConfig.create({
      data: {
        tenantId: tenant.id,
        config: {
          identity: { botName: 'TutorBot' },
          workflows: {
            'TUTOR_SESSION': fictionalWorkflowConfig
          }
        }
      }
    });
    const snapshot = await configService.getConfig(tenant.id);
    expect(snapshot.identity.botName).toBe('TutorBot');
    expect(snapshot.workflows['TUTOR_SESSION']).toBeDefined();
    expect(snapshot.workflows['TUTOR_SESSION'].initialState).toBe('collect_student');
    expect(snapshot.workflows['TUTOR_SESSION'].states['collect_duration'].field?.name).toBe('duration');
  });
  it('6. Configuration snapshot consistency (immutable properties)', async () => {
    const tenant = await prisma.tenant.create({ data: { name: 'Snapshot Tenant' } });
    await prisma.tenantConfig.create({ data: { tenantId: tenant.id, config: {} } });
    const snapshot = await configService.getConfig(tenant.id);
    // Modify the snapshot manually in the test to ensure it doesn't affect the default
    snapshot.identity.botName = 'HackedBot';
    const newSnapshot = await configService.getConfig(tenant.id);
    // The default should remain unaffected because it is deeply cloned
    expect(newSnapshot.identity.botName).toBe(DEFAULT_BUSINESS_CONFIG.identity.botName);
  });
});