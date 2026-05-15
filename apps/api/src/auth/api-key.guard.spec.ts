import { UnauthorizedException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { hashApiKey, type PepperSet } from '@libs/auth';
import type { ApiKeyRepository } from '@libs/db';
import { ApiKeyGuard } from './api-key.guard';
import { apiMetrics } from '../observability/api-metrics';

vi.mock('../observability/api-metrics', () => ({
  apiMetrics: {
    pepperMatch: { add: vi.fn() },
    authRejections: { add: vi.fn() },
  },
}));

type ExecutionContextMock = {
  getHandler: () => () => void;
  getClass: () => abstract new (...args: never[]) => object;
  switchToHttp: () => {
    getRequest: () => { headers: { authorization?: string } } & Record<string, unknown>;
  };
};

function makeContext(
  request: { headers: { authorization?: string } } & Record<string, unknown>,
): ExecutionContextMock {
  return {
    getHandler: () => function handler() {},
    getClass: () => class TestClass {},
    switchToHttp: () => ({ getRequest: () => request }),
  };
}

function peppers(): PepperSet {
  return {
    current: Buffer.alloc(32, 1),
    previous: Buffer.alloc(32, 2),
  };
}

describe('ApiKeyGuard', () => {
  const key = 'kv_live_aB01_-aB01_-aB01_-aB01_-aB01_-aB';
  const user = {
    id: 'u1',
    email: 'u@example.com',
    display_name: 'User',
    role: 'user',
    banned_at: null,
    banned_reason: null,
    created_at: new Date(),
    updated_at: new Date(),
  };

  const apiKey = {
    id: 'k1',
    user_id: 'u1',
    prefix: 'kv_live_',
    last_four: '1234',
    tier: 'authenticated_free',
    label: null,
    created_at: new Date(),
    last_used_at: null,
    revoked_at: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('bypasses auth for @Public handlers', async () => {
    const reflector = { getAllAndOverride: vi.fn(() => true) } as unknown as Reflector;
    const repo = {
      findActiveByHash: vi.fn(),
      touchLastUsed: vi.fn(),
      rehashKey: vi.fn(),
    } as unknown as ApiKeyRepository;
    const guard = new ApiKeyGuard(reflector, repo, peppers());

    await expect(guard.canActivate(makeContext({ headers: {} }) as never)).resolves.toBe(true);
    expect(repo.findActiveByHash).not.toHaveBeenCalled();
  });

  it('rejects missing header', async () => {
    const reflector = { getAllAndOverride: vi.fn(() => false) } as unknown as Reflector;
    const repo = {
      findActiveByHash: vi.fn(),
      touchLastUsed: vi.fn(),
      rehashKey: vi.fn(),
    } as unknown as ApiKeyRepository;
    const guard = new ApiKeyGuard(reflector, repo, peppers());

    await expect(guard.canActivate(makeContext({ headers: {} }) as never)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(apiMetrics.authRejections.add).toHaveBeenCalledWith(1, { reason: 'missing' });
  });

  it('rejects malformed bearer header', async () => {
    const reflector = { getAllAndOverride: vi.fn(() => false) } as unknown as Reflector;
    const repo = {
      findActiveByHash: vi.fn(),
      touchLastUsed: vi.fn(),
      rehashKey: vi.fn(),
    } as unknown as ApiKeyRepository;
    const guard = new ApiKeyGuard(reflector, repo, peppers());

    await expect(
      guard.canActivate(makeContext({ headers: { authorization: 'Bearer bad' } }) as never),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(apiMetrics.authRejections.add).toHaveBeenCalledWith(1, { reason: 'malformed' });
  });

  it('authenticates current pepper key and attaches user/apiKey', async () => {
    const reflector = { getAllAndOverride: vi.fn(() => false) } as unknown as Reflector;
    const currentHash = hashApiKey(peppers().current, key);
    const repo = {
      findActiveByHash: vi.fn(async () => ({ user, apiKey })),
      touchLastUsed: vi.fn(async () => undefined),
      rehashKey: vi.fn(async () => undefined),
    } as unknown as ApiKeyRepository;

    const request: { headers: { authorization?: string } } & Record<string, unknown> = {
      headers: { authorization: `Bearer ${key}` },
    };
    const guard = new ApiKeyGuard(reflector, repo, peppers());

    await expect(guard.canActivate(makeContext(request) as never)).resolves.toBe(true);
    expect(repo.findActiveByHash).toHaveBeenCalledWith(currentHash);
    expect(request.user).toEqual(user);
    expect(request.apiKey).toEqual(apiKey);
    expect(request.apiKey.key_hash).toBeUndefined();
    expect(apiMetrics.pepperMatch.add).toHaveBeenCalledWith(1, { pepper: 'current' });
    expect(repo.rehashKey).not.toHaveBeenCalled();
    expect(repo.touchLastUsed).toHaveBeenCalledWith('k1');
  });

  it('authenticates previous pepper and schedules rehash', async () => {
    const reflector = { getAllAndOverride: vi.fn(() => false) } as unknown as Reflector;
    const p = peppers();
    const currentHash = hashApiKey(p.current, key);
    const previousHash = hashApiKey(p.previous!, key);
    const repo = {
      findActiveByHash: vi
        .fn()
        .mockImplementationOnce(async (hash: Buffer) =>
          hash.equals(currentHash) ? undefined : undefined,
        )
        .mockImplementationOnce(async (hash: Buffer) =>
          hash.equals(previousHash) ? { user, apiKey } : undefined,
        ),
      touchLastUsed: vi.fn(async () => undefined),
      rehashKey: vi.fn(async () => undefined),
    } as unknown as ApiKeyRepository;

    const request: { headers: { authorization?: string } } & Record<string, unknown> = {
      headers: { authorization: `Bearer ${key}` },
    };
    const guard = new ApiKeyGuard(reflector, repo, p);

    await expect(guard.canActivate(makeContext(request) as never)).resolves.toBe(true);
    expect(apiMetrics.pepperMatch.add).toHaveBeenCalledWith(1, { pepper: 'previous' });
    expect(repo.rehashKey).toHaveBeenCalledWith('k1', currentHash);
    expect(repo.touchLastUsed).toHaveBeenCalledWith('k1');
  });

  it('does not fail request when touchLastUsed/rehash reject', async () => {
    const reflector = { getAllAndOverride: vi.fn(() => false) } as unknown as Reflector;
    const p = peppers();
    const currentHash = hashApiKey(p.current, key);
    const previousHash = hashApiKey(p.previous!, key);
    const repo = {
      findActiveByHash: vi
        .fn()
        .mockImplementationOnce(async (hash: Buffer) =>
          hash.equals(currentHash) ? undefined : undefined,
        )
        .mockImplementationOnce(async (hash: Buffer) =>
          hash.equals(previousHash) ? { user, apiKey } : undefined,
        ),
      touchLastUsed: vi.fn(async () => {
        throw new Error('touch fail');
      }),
      rehashKey: vi.fn(async () => {
        throw new Error('rehash fail');
      }),
    } as unknown as ApiKeyRepository;

    const guard = new ApiKeyGuard(reflector, repo, p);
    await expect(
      guard.canActivate(makeContext({ headers: { authorization: `Bearer ${key}` } }) as never),
    ).resolves.toBe(true);
  });
});
