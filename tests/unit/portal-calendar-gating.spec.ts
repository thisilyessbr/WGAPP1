import { beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { portalDatabase } from '../helpers/portal-db';
import { PortalStore } from '../../src/portal/PortalStore';
import { PortalAuth, hashPassword, hashToken } from '../../src/portal/PortalAuth';
import { createPortalRouter } from '../../src/portal/PortalRouter';
import { validatePlan } from '../../src/portal/validation';

describe('calendar plan gating and permissions', () => {
  let db: any, store: PortalStore, auth: PortalAuth, app: express.Express;
  let servicePlan: any, bookingPlan: any, passwordHash: string;

  beforeAll(async () => {
    db = (await portalDatabase()).db;
    store = new PortalStore(db);
    passwordHash = await hashPassword('Test-password-2026!');
    auth = new PortalAuth(store, { publicUrl: 'http://localhost' });

    app = express();
    app.use(express.json());
    app.use('/api', createPortalRouter({
      store,
      auth,
      documents: { remove: async () => {} } as any,
      connections: {} as any
    }, {
      relayqoCalendar: {
        settings: async () => ({ enabled: true }),
        today: async () => '2026-10-16',
        between: async () => []
      }
    } as any));

    const adminId = randomUUID();
    await store.db.$executeRaw`INSERT INTO "PortalUser"(id,email,name,"passwordHash",role,"verifiedAt") VALUES (${adminId},'admin@test.com','Admin',${passwordHash},'ADMIN',NOW())`;

    servicePlan = await store.savePlan(adminId, validatePlan({
      name: 'Service Only Plan',
      published: true,
      modules: ['knowledge', 'services'],
      limits: { monthlyUsd: 5 }
    }));

    bookingPlan = await store.savePlan(adminId, validatePlan({
      name: 'Booking Plan',
      published: true,
      modules: ['knowledge', 'services', 'calendar'],
      limits: { monthlyUsd: 10 }
    }));
  }, 60000);

  async function createAccount(planId: string, adminConfig: any = {}) {
    const reg = await store.register(randomUUID() + '@test.com', 'Biz', passwordHash, planId);
    await store.db.$executeRaw`UPDATE "PortalUser" SET "verifiedAt"=NOW() WHERE id=${reg.userId}`;
    const p = await store.profile(reg.accountId);
    await store.updateAccount(reg.userId, reg.accountId, p.revision, { planId, adminConfig });

    const raw = randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '');
    const csrf = randomUUID();
    await store.newSession(reg.userId, hashToken(raw), csrf, new Date(Date.now() + 60000));
    const headers = { Cookie: 'relayqo_portal=' + raw, 'X-CSRF-Token': csrf, Origin: 'http://localhost' };
    return { ...reg, headers };
  }

  it('allows calendar as a valid plan module in validatePlan', () => {
    const plan = validatePlan({
      name: 'Calendar Allowed',
      modules: ['services', 'calendar']
    });
    expect(plan.modules).toContain('calendar');
    expect(plan.modules).toContain('services');
  });

  it('hides calendar for service-only plans without booking workflows', async () => {
    const c = await createAccount(servicePlan.id);
    const res = await request(app).get('/api/client/profile').set(c.headers);
    expect(res.status).toBe(200);
    expect(res.body.profile.calendarInUse).toBe(false);

    // Gated endpoint returns 403 CALENDAR_NOT_INCLUDED
    const calRes = await request(app).get('/api/client/calendar').set(c.headers);
    expect(calRes.status).toBe(403);
    expect(calRes.body.error).toBe('CALENDAR_NOT_INCLUDED');
  });

  it('shows calendar for plans that entitle calendar', async () => {
    const c = await createAccount(bookingPlan.id);
    const res = await request(app).get('/api/client/profile').set(c.headers);
    expect(res.status).toBe(200);
    expect(res.body.profile.calendarInUse).toBe(true);

    const calRes = await request(app).get('/api/client/calendar').set(c.headers);
    expect(calRes.status).toBe(200);
    expect(calRes.body.today).toBe('2026-10-16');
  });

  it('shows calendar when a booking workflow is present even on service plan', async () => {
    const c = await createAccount(servicePlan.id, {
      workflows: {
        booking: {
          initialState: 'ask_day',
          states: {
            ask_day: { type: 'collect', calendar: 'day', prompt: 'Choose a day', next: 'done' },
            done: { type: 'end' }
          }
        }
      }
    });
    const res = await request(app).get('/api/client/profile').set(c.headers);
    expect(res.status).toBe(200);
    expect(res.body.profile.calendarInUse).toBe(true);

    const calRes = await request(app).get('/api/client/calendar').set(c.headers);
    expect(calRes.status).toBe(200);
  });

  it('allows administrator to explicitly disable calendar on an account', async () => {
    const c = await createAccount(bookingPlan.id, {
      capabilities: { calendarEnabled: false }
    });
    const res = await request(app).get('/api/client/profile').set(c.headers);
    expect(res.status).toBe(200);
    expect(res.body.profile.calendarInUse).toBe(false);

    const calRes = await request(app).get('/api/client/calendar').set(c.headers);
    expect(calRes.status).toBe(403);
  });
});
