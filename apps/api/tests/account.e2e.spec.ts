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

function cookieValue(setCookie: string[], name: string): string {
  const match = setCookie.find((c) => c.startsWith(`${name}=`));
  return match?.split(';')[0]?.split('=')[1] ?? '';
}

type Session = { cookie: string[]; csrf: string; userId: string };

async function login(app: INestApplication): Promise<Session> {
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

describeHttpIf('account deletion (M6-2.4)', () => {
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

  it('requires CSRF on delete', async () => {
    const s = await login(app);
    await request(app.getHttpServer())
      .delete('/v1/account')
      .set('Cookie', s.cookie) // no x-csrf-token
      .expect(403);
  });

  it('deletes the account: removes the user + keys and invalidates sessions', async () => {
    const s = await login(app);
    const key = await request(app.getHttpServer())
      .post('/v1/keys')
      .set('Cookie', s.cookie)
      .set('x-csrf-token', s.csrf)
      .send({})
      .expect(201);

    await request(app.getHttpServer())
      .delete('/v1/account')
      .set('Cookie', s.cookie)
      .set('x-csrf-token', s.csrf)
      .expect(204);

    // The user row and its key are gone.
    const user = await pgDb
      .selectFrom('users')
      .select('id')
      .where('id', '=', s.userId)
      .executeTakeFirst();
    expect(user).toBeUndefined();
    const remainingKey = await pgDb
      .selectFrom('api_key')
      .select('id')
      .where('id', '=', key.body.id)
      .executeTakeFirst();
    expect(remainingKey).toBeUndefined();

    // The session is invalidated.
    await request(app.getHttpServer()).get('/v1/auth/session').set('Cookie', s.cookie).expect(401);
  });
});
