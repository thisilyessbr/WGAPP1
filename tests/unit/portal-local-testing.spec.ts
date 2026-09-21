import { afterEach, describe, expect, it, vi } from 'vitest';
import { localEmailBypass } from '../../src/portal/localTesting';

describe('local email testing guard', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('requires explicit opt-in and a loopback host', () => {
    vi.stubEnv('NODE_ENV', 'development'); vi.stubEnv('PORTAL_DEV_SKIP_EMAIL', 'false');
    expect(localEmailBypass('http://localhost:3000')).toBe(false);
    vi.stubEnv('PORTAL_DEV_SKIP_EMAIL', 'true');
    for (const host of ['localhost','127.0.0.1','[::1]']) expect(localEmailBypass('http://'+host+':3000')).toBe(true);
    for (const host of ['relayqo.online','localhost.attacker.test','192.168.1.3']) expect(localEmailBypass('https://'+host)).toBe(false);
    expect(localEmailBypass('invalid')).toBe(false);
  });
  it('cannot skip email in production, even on localhost', () => {
    vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('PORTAL_DEV_SKIP_EMAIL', 'true');
    expect(localEmailBypass('https://localhost')).toBe(false);
  });
});
