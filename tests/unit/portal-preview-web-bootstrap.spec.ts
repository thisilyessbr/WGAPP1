import { afterEach, describe, expect, it, vi } from 'vitest';
import { bootstrapWebDependencies } from '../../src/bootstrap';

describe('admin preview web bootstrap', () => {
  const previousPortalEnabled = process.env.PORTAL_ENABLED;
  afterEach(() => {
    if (previousPortalEnabled === undefined) delete process.env.PORTAL_ENABLED;
    else process.env.PORTAL_ENABLED = previousPortalEnabled;
    vi.restoreAllMocks();
  });

  it('provides an isolated preview engine without starting a WhatsApp worker', () => {
    process.env.PORTAL_ENABLED = 'true';
    const deps = bootstrapWebDependencies({} as any, { useMemoryQueue: true });
    try {
      expect(deps.conversationEngine?.previewMessage).toBeTypeOf('function');
      expect(deps.whatsAppWorker).toBeUndefined();
      expect(deps.ragService).toBeUndefined();
      expect(deps.llmFactory).toBeUndefined();
    } finally {
      deps.portalService?.stop();
    }
  });
});
