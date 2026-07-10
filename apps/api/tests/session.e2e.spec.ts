import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE, SessionStore } from '@nest/auth';
import {
  createRealApp,
  describeHttpIf,
  resetDaoProposalApiTables,
} from './dao-proposal-api.e2e.helpers';
import { pgDb } from '../../../libs/db/src/client';

const USER_ID = '20000000-0000-0000-0000-000000000001';
const WALLET = `0x${'d'.repeat(40)}`;

async function seedWalletUser(): Promise<void> {
  // A SIWE-style account: wallet only, no email/display_name (exercises the M6-2.1 nullable schema).
  await pgDb
    .insertInto('users')
    .values({ id: USER_ID, wallet_address: WALLET, role: 'user', updated_at: new Date() })
    .execute();
}

describeHttpIf('session probe (M6-2.1)', () => {
  let app: INestApplication;
  let store: SessionStore;

  beforeAll(async () => {
    app = await createRealApp();
    store = app.get(SessionStore);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDaoProposalApiTables();
    await seedWalletUser();
  });

  it('rejects /me without a session cookie (401)', async () => {
    await request(app.getHttpServer()).get('/v1/_session/me').expect(401);
  });

  it('authenticates /me with a valid session cookie', async () => {
    const { id } = await store.create(USER_ID);
    const res = await request(app.getHttpServer())
      .get('/v1/_session/me')
      .set('Cookie', `${SESSION_COOKIE}=${id}`)
      .expect(200);
    expect(res.body).toMatchObject({ userId: USER_ID, sessionId: id });
  });

  it('rejects a logout POST without a CSRF header (403)', async () => {
    const { id, csrfToken } = await store.create(USER_ID);
    await request(app.getHttpServer())
      .post('/v1/_session/logout')
      .set('Cookie', [`${SESSION_COOKIE}=${id}`, `${CSRF_COOKIE}=${csrfToken}`])
      .expect(403);
  });

  it('logout destroys the current session', async () => {
    const { id, csrfToken } = await store.create(USER_ID);
    await request(app.getHttpServer())
      .post('/v1/_session/logout')
      .set('Cookie', [`${SESSION_COOKIE}=${id}`, `${CSRF_COOKIE}=${csrfToken}`])
      .set(CSRF_HEADER, csrfToken)
      .expect(201);
    // Session is gone.
    await request(app.getHttpServer())
      .get('/v1/_session/me')
      .set('Cookie', `${SESSION_COOKIE}=${id}`)
      .expect(401);
  });

  it('logout-all revokes every session for the user (sign out everywhere)', async () => {
    const a = await store.create(USER_ID);
    const b = await store.create(USER_ID);

    await request(app.getHttpServer())
      .post('/v1/_session/logout-all')
      .set('Cookie', [`${SESSION_COOKIE}=${a.id}`, `${CSRF_COOKIE}=${a.csrfToken}`])
      .set(CSRF_HEADER, a.csrfToken)
      .expect(201);

    for (const sid of [a.id, b.id]) {
      await request(app.getHttpServer())
        .get('/v1/_session/me')
        .set('Cookie', `${SESSION_COOKIE}=${sid}`)
        .expect(401);
    }
  });
});
