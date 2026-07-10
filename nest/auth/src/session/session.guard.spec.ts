import {
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import type { User } from '@libs/db';
import type { UserRepository } from '@libs/db';
import { CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE } from './session.config';
import { SessionGuard } from './session.guard';
import { SessionStore, SessionStoreUnavailableError, type SessionRecord } from './session.store';

const USER: User = {
  id: 'user-1',
  email: null,
  display_name: null,
  wallet_address: '0x' + 'a'.repeat(40),
  role: 'user',
  banned_at: null,
  banned_reason: null,
  created_at: new Date(),
  updated_at: new Date(),
};

const RECORD: SessionRecord = {
  userId: 'user-1',
  csrfToken: 'csrf-token',
  createdAt: Date.now(),
  lastSeenAt: Date.now(),
};

type Req = {
  method: string;
  cookies: Record<string, string | undefined>;
  headers: Record<string, string | undefined>;
  user?: User;
  session?: unknown;
};

function makeContext(req: Req): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

function makeGuard(overrides?: {
  get?: SessionStore['get'];
  findById?: UserRepository['findById'];
}): SessionGuard {
  const store = {
    get: overrides?.get ?? (async () => RECORD),
    touch: async () => undefined,
  } as unknown as SessionStore;
  const users = {
    findById: overrides?.findById ?? (async () => USER),
  } as unknown as UserRepository;
  return new SessionGuard(store, users);
}

describe('SessionGuard', () => {
  it('rejects a request with no session cookie', async () => {
    const guard = makeGuard();
    const ctx = makeContext({ method: 'GET', cookies: {}, headers: {} });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects when the session is unknown/expired', async () => {
    const guard = makeGuard({ get: async () => null });
    const ctx = makeContext({ method: 'GET', cookies: { [SESSION_COOKIE]: 'sid' }, headers: {} });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('maps a store outage to 503, not 401', async () => {
    const guard = makeGuard({
      get: async () => {
        throw new SessionStoreUnavailableError(new Error('ECONNREFUSED'));
      },
    });
    const ctx = makeContext({ method: 'GET', cookies: { [SESSION_COOKIE]: 'sid' }, headers: {} });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('rejects a banned user', async () => {
    const guard = makeGuard({
      findById: async () => ({ ...USER, banned_at: new Date(), banned_reason: 'spam' }),
    });
    const ctx = makeContext({ method: 'GET', cookies: { [SESSION_COOKIE]: 'sid' }, headers: {} });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('authenticates a valid GET and attaches user + session', async () => {
    const guard = makeGuard();
    const req: Req = { method: 'GET', cookies: { [SESSION_COOKIE]: 'sid' }, headers: {} };
    await expect(guard.canActivate(makeContext(req))).resolves.toBe(true);
    expect(req.user).toBe(USER);
    expect(req.session).toMatchObject({ id: 'sid', userId: 'user-1' });
  });

  describe('CSRF on mutating verbs', () => {
    const cookies = { [SESSION_COOKIE]: 'sid', [CSRF_COOKIE]: 'csrf-token' };

    it('passes when header matches cookie and the session token', async () => {
      const guard = makeGuard();
      const ctx = makeContext({
        method: 'POST',
        cookies,
        headers: { [CSRF_HEADER]: 'csrf-token' },
      });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('rejects when the CSRF header is missing', async () => {
      const guard = makeGuard();
      const ctx = makeContext({ method: 'POST', cookies, headers: {} });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects when the CSRF header does not match the cookie', async () => {
      const guard = makeGuard();
      const ctx = makeContext({
        method: 'POST',
        cookies,
        headers: { [CSRF_HEADER]: 'wrong' },
      });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('does not require CSRF on a GET', async () => {
      const guard = makeGuard();
      const ctx = makeContext({
        method: 'GET',
        cookies: { [SESSION_COOKIE]: 'sid' },
        headers: {},
      });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });
  });
});
