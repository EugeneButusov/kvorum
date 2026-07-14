import { AuthIpRateLimitGuard } from './auth-ip-rate-limit.guard';
import { RedisUnavailableError, type RateLimitResult } from './rate-limiter.service';
import { ProblemException } from '../http/problem-exception';

vi.mock('../observability/api-metrics', () => ({
  apiMetrics: { rateLimitRejections: { add: vi.fn() } },
}));

function makeContext(ip: string | undefined): {
  ctx: never;
  setHeader: ReturnType<typeof vi.fn>;
} {
  const setHeader = vi.fn();
  const ctx = {
    switchToHttp: () => ({
      getRequest: () => ({ ip }),
      getResponse: () => ({ setHeader }),
    }),
  } as unknown as never;
  return { ctx, setHeader };
}

const ALLOWED: RateLimitResult = {
  allowed: true,
  limit: 10,
  remaining: 9,
  resetSeconds: 60,
  retryAfterSeconds: 0,
  bindingWindow: 'minute',
};

describe('AuthIpRateLimitGuard', () => {
  it('allows within the budget and sets RateLimit-* headers keyed on the IP', async () => {
    const consume = vi.fn(async () => ALLOWED);
    const guard = new AuthIpRateLimitGuard({ consume } as never);
    const { ctx, setHeader } = makeContext('1.2.3.4');

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(consume).toHaveBeenCalledWith('authip:1.2.3.4', 'auth_ip');
    expect(setHeader).toHaveBeenCalledWith('RateLimit-Remaining', '9');
  });

  it('rejects with 429 when the per-IP budget is exceeded', async () => {
    const consume = vi.fn(async () => ({ ...ALLOWED, allowed: false, retryAfterSeconds: 30 }));
    const guard = new AuthIpRateLimitGuard({ consume } as never);
    const { ctx, setHeader } = makeContext('1.2.3.4');

    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      slug: 'rate-limited',
    } satisfies Partial<ProblemException>);
    expect(setHeader).toHaveBeenCalledWith('Retry-After', '30');
  });

  it('rejects with 503 when the limiter backend is unavailable (fall-open)', async () => {
    const consume = vi.fn(async () => {
      throw new RedisUnavailableError(new Error('down'));
    });
    const guard = new AuthIpRateLimitGuard({ consume } as never);
    const { ctx } = makeContext('1.2.3.4');

    await expect(guard.canActivate(ctx)).rejects.toMatchObject({ slug: 'service-unavailable' });
  });

  it('falls back to a placeholder identity when req.ip is absent', async () => {
    const consume = vi.fn(async () => ALLOWED);
    const guard = new AuthIpRateLimitGuard({ consume } as never);
    const { ctx } = makeContext(undefined);

    await guard.canActivate(ctx);
    expect(consume).toHaveBeenCalledWith('authip:unknown', 'auth_ip');
  });
});
