import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { ApiKeyRepository, type User } from '@libs/db';
import { Public, SessionGuard, SessionUser } from '@nest/auth';
import { TIERS, type Tier } from '../rate-limit/rate-limit.config';
import { RateLimiterService, type WindowState } from '../rate-limit/rate-limiter.service';
import { UsageRecorderService } from '../rate-limit/usage-recorder.service';

type KeyUsageView = {
  id: string;
  label: string | null;
  prefix: string;
  last_four: string;
  daily: number[];
  rate_limit: {
    minute: WindowState;
    day: WindowState;
  };
};

type UsageResponse = {
  buckets: string[];
  keys: KeyUsageView[];
};

@ApiExcludeController()
@Public()
@UseGuards(SessionGuard)
@Controller('v1/keys/usage')
export class UsageController {
  constructor(
    private readonly keys: ApiKeyRepository,
    private readonly rateLimiter: RateLimiterService,
    private readonly usageRecorder: UsageRecorderService,
  ) {}

  @Get()
  async getUsage(@SessionUser() user: User): Promise<UsageResponse> {
    const allKeys = await this.keys.listByUser(user.id);
    const activeKeys = allKeys.filter((k) => k.tier !== 'dashboard' && k.revoked_at === null);

    const buckets = buildBuckets(30);
    const keyIds = activeKeys.map((k) => k.id);

    const [dailyMap, peekResults] = await Promise.all([
      this.usageRecorder.getDailyUsage(keyIds, 30),
      Promise.all(
        activeKeys.map((k) => {
          const tier = k.tier as Tier;
          if (!(tier in TIERS)) return null;
          return this.rateLimiter.peek(`apikey:${k.id}`, tier);
        }),
      ),
    ]);

    const keys: KeyUsageView[] = activeKeys.map((k, i) => {
      const usage = dailyMap.get(k.id) ?? {};
      const daily = buckets.map((date) => usage[date] ?? 0);
      const tier = k.tier as Tier;
      const limits = TIERS[tier] ?? TIERS.authenticated_free;
      const peek = peekResults[i];

      return {
        id: k.id,
        label: k.label,
        prefix: k.prefix,
        last_four: k.last_four,
        daily,
        rate_limit: peek ?? {
          minute: { used: 0, limit: limits.perMinute, resetSeconds: 0 },
          day: { used: 0, limit: limits.perDay, resetSeconds: 0 },
        },
      };
    });

    return { buckets, keys };
  }
}

function buildBuckets(days: number): string[] {
  const result: string[] = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    result.push(d.toISOString().slice(0, 10));
  }
  return result;
}
