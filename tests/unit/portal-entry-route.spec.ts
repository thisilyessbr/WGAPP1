import { expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';

it('redirects the application root to the login page when the portal is enabled', async () => {
  const app = await createApp({ portalService: {}, conversationAutomationService: {}, prisma: {} } as any);
  const response = await request(app).get('/');

  expect(response.status).toBe(302);
  expect(response.headers.location).toBe('/login');
});
