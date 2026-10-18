import { describe, expect, it } from 'vitest';
import { validatePlan } from '../../src/portal/validation';

const plan = (modules: string[], limits: Record<string, number> = {}) => validatePlan({ name: 'Plan', price: 100, modules, limits });

describe('broadcast plan entitlement', () => {
  it('accepts broadcasts as a plan module with monthly limits', () => {
    expect(plan(['knowledge', 'broadcasts'], { broadcasts: 8, broadcastRecipients: 5000 })).toMatchObject({
      modules: ['knowledge', 'broadcasts'], limits: { broadcasts: 8, broadcastRecipients: 5000 }
    });
  });
  it('fills default limits for plans saved before broadcasts existed', () => {
    expect(plan(['knowledge']).limits).toMatchObject({ broadcasts: 4, broadcastRecipients: 2000 });
  });
  it('rejects a broadcast plan without allowance and absurd limits', () => {
    expect(() => plan(['broadcasts'], { broadcasts: 0 })).toThrow(expect.objectContaining({ code: 'BROADCAST_LIMITS_REQUIRED' }));
    expect(() => plan(['broadcasts'], { broadcastRecipients: 0 })).toThrow(expect.objectContaining({ code: 'BROADCAST_LIMITS_REQUIRED' }));
    expect(() => plan(['broadcasts'], { broadcasts: 500 })).toThrow(expect.objectContaining({ code: 'PLAN_LIMIT_TOO_LARGE' }));
    expect(() => plan(['newsletters'])).toThrow(expect.objectContaining({ code: 'INVALID_MODULE' }));
  });
});
