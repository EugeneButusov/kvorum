import type { INestApplication } from '@nestjs/common';
import { Wallet } from 'ethers';
import { SiweMessage } from 'siwe';
import request from 'supertest';
import {
  createRealApp,
  describeHttpIf,
  resetDaoProposalApiTables,
} from './dao-proposal-api.e2e.helpers';

const SIWE_DOMAIN = 'localhost:3000';
const WALLET_A = new Wallet(`0x${'1'.repeat(64)}`);
const WALLET_B = new Wallet(`0x${'2'.repeat(64)}`);

function cookieValue(setCookie: string[], name: string): string {
  const match = setCookie.find((c) => c.startsWith(`${name}=`));
  return match?.split(';')[0]?.split('=')[1] ?? '';
}

type Session = { cookie: string[]; csrf: string; userId: string };

async function login(app: INestApplication, wallet: Wallet): Promise<Session> {
  const { body } = await request(app.getHttpServer()).post('/v1/auth/siwe/nonce').expect(201);
  const siwe = new SiweMessage({
    domain: SIWE_DOMAIN,
    address: wallet.address,
    statement: 'Sign in to Kvorum',
    uri: `https://${SIWE_DOMAIN}`,
    version: '1',
    chainId: 1,
    nonce: body.nonce,
    issuedAt: new Date().toISOString(),
  });
  const message = siwe.prepareMessage();
  const signature = await wallet.signMessage(message);
  const verify = await request(app.getHttpServer())
    .post('/v1/auth/siwe/verify')
    .send({ message, signature })
    .expect(201);
  const setCookie = verify.headers['set-cookie'] as unknown as string[];
  return {
    cookie: [
      `kv_session=${cookieValue(setCookie, 'kv_session')}`,
      `kv_csrf=${cookieValue(setCookie, 'kv_csrf')}`,
    ],
    csrf: cookieValue(setCookie, 'kv_csrf'),
    userId: verify.body.userId,
  };
}

describeHttpIf('API keys (M6-2.3)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env['SIWE_DOMAIN'] = SIWE_DOMAIN;
    app = await createRealApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDaoProposalApiTables();
  });

  it('create returns the full key once; list shows prefix + last-4 without the secret', async () => {
    const s = await login(app, WALLET_A);
    const created = await request(app.getHttpServer())
      .post('/v1/keys')
      .set('Cookie', s.cookie)
      .set('x-csrf-token', s.csrf)
      .send({ label: 'ci' })
      .expect(201);

    expect(created.body.key).toMatch(/^kv_live_[A-Za-z0-9_-]{32}$/);
    expect(created.body.status).toBe('active');
    expect(created.body.current_month_requests).toBe(0);

    const list = await request(app.getHttpServer())
      .get('/v1/keys')
      .set('Cookie', s.cookie)
      .expect(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({ prefix: 'kv_live_', label: 'ci', status: 'active' });
    expect(list.body.data[0].key).toBeUndefined(); // secret never re-shown
  });

  it('rotate issues a new key and marks the old one expiring (grace)', async () => {
    const s = await login(app, WALLET_A);
    const created = await request(app.getHttpServer())
      .post('/v1/keys')
      .set('Cookie', s.cookie)
      .set('x-csrf-token', s.csrf)
      .send({})
      .expect(201);

    const rotated = await request(app.getHttpServer())
      .post(`/v1/keys/${created.body.id}/rotate`)
      .set('Cookie', s.cookie)
      .set('x-csrf-token', s.csrf)
      .expect(201);
    expect(rotated.body.key).not.toBe(created.body.key);

    const list = await request(app.getHttpServer())
      .get('/v1/keys')
      .set('Cookie', s.cookie)
      .expect(200);
    const statuses = (list.body.data as Array<{ id: string; status: string }>).reduce<
      Record<string, string>
    >((m, k) => ({ ...m, [k.id]: k.status }), {});
    expect(statuses[created.body.id]).toBe('expiring');
    expect(statuses[rotated.body.id]).toBe('active');
  });

  it('revoke works; a different user cannot touch the key (404)', async () => {
    const a = await login(app, WALLET_A);
    const b = await login(app, WALLET_B);
    const created = await request(app.getHttpServer())
      .post('/v1/keys')
      .set('Cookie', a.cookie)
      .set('x-csrf-token', a.csrf)
      .send({})
      .expect(201);

    // B cannot revoke A's key.
    await request(app.getHttpServer())
      .delete(`/v1/keys/${created.body.id}`)
      .set('Cookie', b.cookie)
      .set('x-csrf-token', b.csrf)
      .expect(404);

    // A can.
    await request(app.getHttpServer())
      .delete(`/v1/keys/${created.body.id}`)
      .set('Cookie', a.cookie)
      .set('x-csrf-token', a.csrf)
      .expect(200);
  });

  it('usage endpoint reports per-family counts + quota after an authenticated request', async () => {
    const s = await login(app, WALLET_A);
    const created = await request(app.getHttpServer())
      .post('/v1/keys')
      .set('Cookie', s.cookie)
      .set('x-csrf-token', s.csrf)
      .send({})
      .expect(201);

    // Exercise a read endpoint with the new key so the usage interceptor records a 'daos' tick.
    await request(app.getHttpServer())
      .get('/v1/daos')
      .set('Authorization', `Bearer ${created.body.key}`)
      .expect(200);

    const usage = await request(app.getHttpServer())
      .get(`/v1/keys/${created.body.id}/usage`)
      .set('Cookie', s.cookie)
      .expect(200);
    expect(usage.body.quota).toEqual({ per_minute: 60, per_day: 10_000 });
    expect(usage.body.by_family.daos).toBeGreaterThanOrEqual(1);
    expect(usage.body.current_month_requests).toBeGreaterThanOrEqual(1);
  });
});
