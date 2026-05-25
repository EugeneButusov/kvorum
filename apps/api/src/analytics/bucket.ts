import type { RawBuilder } from 'kysely';
import { sql } from 'kysely';
import { z } from 'zod';

export type BucketGrain = 'daily' | 'weekly' | 'monthly';

export const BUCKET_GRAIN_ENUM = z.enum(['daily', 'weekly', 'monthly']);

export function chTimeBucketExpression(column: string, grain: BucketGrain): RawBuilder<Date> {
  const ref = sql.ref(column);
  if (grain === 'daily') {
    return sql<Date>`toStartOfDay(${ref})`;
  }
  if (grain === 'weekly') {
    return sql<Date>`toStartOfWeek(${ref})`;
  }
  return sql<Date>`toStartOfMonth(${ref})`;
}

export function pgTimeBucketExpression(column: string, grain: BucketGrain): RawBuilder<Date> {
  const ref = sql.ref(column);
  if (grain === 'daily') {
    return sql<Date>`date_trunc('day', ${ref})`;
  }
  if (grain === 'weekly') {
    return sql<Date>`date_trunc('week', ${ref})`;
  }
  return sql<Date>`date_trunc('month', ${ref})`;
}

export function estimateBucketCount(from: Date, to: Date, grain: BucketGrain): number {
  const ms = to.getTime() - from.getTime();
  if (ms < 0) {
    return 0;
  }

  const dayMs = 24 * 60 * 60 * 1000;
  if (grain === 'daily') {
    return Math.floor(ms / dayMs) + 1;
  }

  if (grain === 'weekly') {
    return Math.floor(ms / (7 * dayMs)) + 1;
  }

  return (
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth()) + 1
  );
}
