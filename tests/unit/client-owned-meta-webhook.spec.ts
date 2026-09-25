import { describe, it, expect, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createHmac } from 'crypto';
import { SecretBox } from '../../src/core/security/SecretBox';
import { createClientOwnedMetaWebhookRouter } from '../../src/domain/channel/whatsapp/ClientOwnedMetaWebhookRouter';

const connectionId = '11111111-1111-4111-8111-111111111111';
const otherConnectionId = '22222222-2222-4222-8222-222222222222';
const signingSecret = 'client-own-app-secret';
const verifyToken = 'client-own-verify-token';
const previousKey = process.env.ENCRYPTION_KEY;

afterEach(() => {
  if (previousKey === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = previousKey;
});

function fixture() {
  process.env.ENCRYPTION_KEY = 'test-client-owned-meta-key-32-bytes';
  const box = new SecretBox();
  const connection = {
    id: connectionId, connectionKey: 'CLIENT_OWNED:123456789:987654321', status: 'CONNECTED',
    encryptedCredentials: box.encryptJson({ appSecret: signingSecret, verifyToken, accessToken: 'hidden' })
  };
  const updates: any[] = [];
  const db: any = {
    channelConnection: {
      findUnique: async ({ where }: any) => where.id === connectionId ? connection : null,
      update: async (args: any) => { updates.push(args); return args; }
    }
  };
  const lookups: string[] = [];
  const numberService: any = {
    resolveAccountByPhoneNumberId: async (phoneId: string) => {
      lookups.push(phoneId);
      return { tenantId: 'tenant', accountId: 'client', connectionId: phoneId === '20002' ? otherConnectionId : connectionId,
        connection: { id: phoneId === '20002' ? otherConnectionId : connectionId } };
    }
  };
  const jobs: any[] = [];
  const queue: any = { durable: true, enqueue: async (job: any) => { jobs.push(job); return true; } };
  const app = express();
  app.use(express.json({ verify: (req, _res, bytes) => { (req as any).rawBody = bytes; } }));
  app.use('/hook', createClientOwnedMetaWebhookRouter(db, numberService, undefined, queue));
  return { app, connection, jobs, lookups, updates };
}

function payload(phoneNumberId: string) {
  return { object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: {
    metadata: { phone_number_id: phoneNumberId }, messages: [{ id: 'wamid.test.1', from: '212600000000', timestamp: '1000', type: 'text', text: { body: 'Salam' } }]
  } }] }] };
}

function signed(body: object, secret = signingSecret) {
  return createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex');
}

describe('client-owned Meta webhook isolation', () => {
  it('requires the client-owned verify token and records Meta handshake', async () => {
    const { app, connection, updates } = fixture();
    connection.status = 'PENDING';
    const path = `/hook/${connectionId}?hub.mode=subscribe&hub.challenge=ready&hub.verify_token=`;
    expect((await request(app).get(path + 'wrong')).status).toBe(403);
    const response = await request(app).get(path + verifyToken);
    expect(response.status).toBe(200);
    expect(response.text).toBe('ready');
    expect(updates[0].data.status).toBe('WEBHOOK_VERIFIED');
  });

  it('enqueues a message only for a number mapped to this connection', async () => {
    const { app, jobs } = fixture();
    const body = payload('10001');
    const response = await request(app).post(`/hook/${connectionId}`)
      .set('x-hub-signature-256', `sha256=${signed(body)}`).send(body);
    expect(response.status).toBe(200);
    expect(response.body.processed).toBe(1);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].accountId).toBe('client');
  });

  it('rejects a valid app signature for another client number', async () => {
    const { app, jobs } = fixture();
    const body = payload('20002');
    const response = await request(app).post(`/hook/${connectionId}`)
      .set('x-hub-signature-256', `sha256=${signed(body)}`).send(body);
    expect(response.status).toBe(403);
    expect(jobs).toHaveLength(0);
  });

  it('rejects messages signed by another Meta app', async () => {
    const { app, jobs, lookups } = fixture();
    const body = payload('10001');
    const response = await request(app).post(`/hook/${connectionId}`)
      .set('x-hub-signature-256', `sha256=${signed(body, 'wrong-app-secret')}`).send(body);
    expect(response.status).toBe(401);
    expect(jobs).toHaveLength(0);
    expect(lookups).toHaveLength(0);
  });

  it('routes a newly added second client without changing or remounting the app', async () => {
    process.env.ENCRYPTION_KEY = 'test-client-owned-meta-key-32-bytes';
    const box = new SecretBox();
    const connections = new Map<string, any>();
    const addClient = (id: string, secret: string, token: string) => connections.set(id, {
      id, connectionKey: `CLIENT_OWNED:${id}:987654321`, status: 'CONNECTED',
      encryptedCredentials: box.encryptJson({ appSecret: secret, verifyToken: token, accessToken: 'hidden' })
    });
    addClient(connectionId, 'secret-one', 'verify-one');
    const db: any = { channelConnection: { findUnique: async ({ where }: any) => connections.get(where.id) || null } };
    const numberService: any = { resolveAccountByPhoneNumberId: async (phoneId: string) => {
      const id = phoneId === '10001' ? connectionId : otherConnectionId;
      return { tenantId: id, accountId: id, connectionId: id, connection: connections.get(id) };
    } };
    const jobs: any[] = [];
    const queue: any = { durable: true, enqueue: async (job: any) => { jobs.push(job); return true; } };
    const app = express();
    app.use(express.json({ verify: (req, _res, bytes) => { (req as any).rawBody = bytes; } }));
    app.use('/hook', createClientOwnedMetaWebhookRouter(db, numberService, undefined, queue));

    const first = payload('10001');
    expect((await request(app).post(`/hook/${connectionId}`)
      .set('x-hub-signature-256', `sha256=${signed(first, 'secret-one')}`).send(first)).status).toBe(200);

    // This connection is added after the Express app has already started.
    addClient(otherConnectionId, 'secret-two', 'verify-two');
    expect((await request(app).get(`/hook/${otherConnectionId}?hub.mode=subscribe&hub.challenge=ready&hub.verify_token=verify-two`)).text).toBe('ready');
    const second = payload('20002');
    expect((await request(app).post(`/hook/${otherConnectionId}`)
      .set('x-hub-signature-256', `sha256=${signed(second, 'secret-two')}`).send(second)).status).toBe(200);
    expect((await request(app).post(`/hook/${connectionId}`)
      .set('x-hub-signature-256', `sha256=${signed(second, 'secret-two')}`).send(second)).status).toBe(401);
    expect(jobs.map(job => job.accountId)).toEqual([connectionId, otherConnectionId]);
  });
});
