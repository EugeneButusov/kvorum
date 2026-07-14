import { z } from 'zod';

export const TIERS = {
  authenticated_free: { perMinute: 60, perDay: 10_000 },
  dashboard: { perMinute: 240, perDay: 50_000 },
  // Per-IP budget for unauthenticated auth endpoints (SIWE, key issuance). Tight, to blunt
  // enumeration / brute-forcing (SPEC §6.14, §7.3). Not a DB api_key_tier — rate-limit config only.
  auth_ip: { perMinute: 10, perDay: 200 },
} as const;

export type Tier = keyof typeof TIERS;

export interface RateLimitConfig {
  redisUrl: string;
}

const schema = z.object({
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
});

export function parseRateLimitConfigFromEnv(env: NodeJS.ProcessEnv): RateLimitConfig {
  const parsed = schema.parse(env);
  return {
    redisUrl: parsed.REDIS_URL,
  };
}
