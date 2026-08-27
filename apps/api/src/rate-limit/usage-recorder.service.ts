import { Injectable } from '@nestjs/common';
import type { SlidingWindowRedis } from './redis.client';

const KEY_PREFIX = 'usage:apikey:';
const TTL_SECONDS = 31 * 86_400;

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

@Injectable()
export class UsageRecorderService {
  constructor(private readonly redis: SlidingWindowRedis) {}

  record(keyId: string): void {
    const key = `${KEY_PREFIX}${keyId}`;
    const field = todayUtc();
    this.redis.hincrby(key, field, 1).catch(() => {});
    this.redis.expire(key, TTL_SECONDS).catch(() => {});
  }

  async getDailyUsage(
    keyIds: readonly string[],
    days: number,
  ): Promise<Map<string, Record<string, number>>> {
    if (keyIds.length === 0) return new Map();

    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - days + 1);
    const cutoffDate = cutoff.toISOString().slice(0, 10);

    const pipeline = this.redis.pipeline();
    for (const id of keyIds) {
      pipeline.hgetall(`${KEY_PREFIX}${id}`);
    }

    const results = await pipeline.exec();
    const out = new Map<string, Record<string, number>>();

    for (let i = 0; i < keyIds.length; i++) {
      const result = results?.[i];
      const raw = (result?.[1] ?? {}) as Record<string, string>;
      const filtered: Record<string, number> = {};
      for (const [date, count] of Object.entries(raw)) {
        if (date >= cutoffDate) {
          filtered[date] = Number(count);
        }
      }
      out.set(keyIds[i]!, filtered);
    }

    return out;
  }
}
