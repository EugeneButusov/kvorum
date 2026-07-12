import type { INestApplication } from '@nestjs/common';
import { Wallet } from 'ethers';
import { SiweMessage } from 'siwe';
import request from 'supertest';
import {
  createRealApp,
  describeHttpIf,
  resetDaoProposalApiTables,
} from './dao-proposal-api.e2e.helpers';
import { pgDb } from '../../../libs/db/src/client';

const SIWE_DOMAIN = 'localhost:3000';
const WALLET = new Wallet(`0x${'1'.repeat(64)}`);

// Pull a cookie's value out of a Set-Cookie header array.
function cookieValue(setCookie: string[], name: string): string | undefined {
  const match = setCookie.find((c) => c.startsWith(`${name}=`));
  return match?.split(';')[0]?.split('=')[1];
}

async function fetchNonceAndSign(
  app: INestApplication,
): Promise<{ message: string; signature: string }> {
  const { body } = await request(app.getHttpServer()).post('/v1/auth/siwe/nonce').expect(201);
  const siwe = new SiweMessage({
    domain: SIWE_DOMAIN,
    address: WALLET.address,
    statement: 'Sign in to Kvorum',
    uri: `https://${SIWE_DOMAIN}`,
    version: '1',
    chainId: 1,
    nonce: body.nonce,
    issuedAt: new Date().toISOString(),
  });
  const message = siwe.prepareMessage();
  const signature = await WALLET.signMessage(message);
  return { message, signature };
}

describeHttpIf('SIWE auth (M6-2.2)', () => {
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

  it('nonce → sign → verify establishes a session; /session then returns the address', async () => {
    const { message, signature } = await fetchNonceAndSign(app);

    const verify = await request(app.getHttpServer())
      .post('/v1/auth/siwe/verify')
      .send({ message, signature })
      .expect(201);
    expect(verify.body.address).toBe(WALLET.address);

    const setCookie = verify.headers['set-cookie'] as unknown as string[];
    const session = cookieValue(setCookie, 'kv_session');
    expect(session).toBeDefined();

    const me = await request(app.getHttpServer())
      .get('/v1/auth/session')
      .set('Cookie', `kv_session=${session}`)
      .expect(200);
    expect(me.body).toMatchObject({
      userId: verify.body.userId,
      address: WALLET.address.toLowerCase(),
    });
  });

  it('rejects a replayed nonce (same message + signature twice)', async () => {
    const { message, signature } = await fetchNonceAndSign(app);

    await request(app.getHttpServer())
      .post('/v1/auth/siwe/verify')
      .send({ message, signature })
      .expect(201);

    // The nonce was consumed on first verify — replay must fail.
    await request(app.getHttpServer())
      .post('/v1/auth/siwe/verify')
      .send({ message, signature })
      .expect(401);
  });

  it('rejects a tampered signature', async () => {
    const { message, signature } = await fetchNonceAndSign(app);
    const tampered = `${signature.slice(0, -1)}${signature.endsWith('0') ? '1' : '0'}`;

    await request(app.getHttpServer())
      .post('/v1/auth/siwe/verify')
      .send({ message, signature: tampered })
      .expect(401);
  });

  it('captures an optional recovery email on verify', async () => {
    const { message, signature } = await fetchNonceAndSign(app);
    const email = `siwe-recovery-${Date.now()}@example.com`;

    const verify = await request(app.getHttpServer())
      .post('/v1/auth/siwe/verify')
      .send({ message, signature, email })
      .expect(201);

    const row = await pgDb
      .selectFrom('users')
      .select(['email', 'wallet_address'])
      .where('id', '=', verify.body.userId)
      .executeTakeFirstOrThrow();
    expect(row.email).toBe(email);
    expect(row.wallet_address).toBe(WALLET.address.toLowerCase());
  });

  it('logout-all revokes the session', async () => {
    const { message, signature } = await fetchNonceAndSign(app);
    const verify = await request(app.getHttpServer())
      .post('/v1/auth/siwe/verify')
      .send({ message, signature })
      .expect(201);
    const setCookie = verify.headers['set-cookie'] as unknown as string[];
    const session = cookieValue(setCookie, 'kv_session');
    const csrf = cookieValue(setCookie, 'kv_csrf');

    await request(app.getHttpServer())
      .post('/v1/auth/logout-all')
      .set('Cookie', [`kv_session=${session}`, `kv_csrf=${csrf}`])
      .set('x-csrf-token', csrf!)
      .expect(201);

    await request(app.getHttpServer())
      .get('/v1/auth/session')
      .set('Cookie', `kv_session=${session}`)
      .expect(401);
  });
});
