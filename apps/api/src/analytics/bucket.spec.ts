import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { chTimeBucketExpression, estimateBucketCount, pgTimeBucketExpression } from './bucket';

type TestDb = { events: { created_at: Date } };

const pool = new Pool({ connectionString: 'postgres://unused:unused@localhost:5432/unused' });
const db = new Kysely<TestDb>({ dialect: new PostgresDialect({ pool }) });

afterAll(async () => {
  await db.destroy();
});

describe('chTimeBucketExpression', () => {
  it('returns toStartOfDay for daily grain', () => {
    const sql = db
      .selectFrom('events')
      .select(chTimeBucketExpression('created_at', 'daily').as('b'))
      .compile().sql;
    expect(sql).toContain('toStartOfDay');
  });

  it('returns toStartOfWeek for weekly grain', () => {
    const sql = db
      .selectFrom('events')
      .select(chTimeBucketExpression('created_at', 'weekly').as('b'))
      .compile().sql;
    expect(sql).toContain('toStartOfWeek');
  });

  it('returns toStartOfMonth for monthly grain', () => {
    const sql = db
      .selectFrom('events')
      .select(chTimeBucketExpression('created_at', 'monthly').as('b'))
      .compile().sql;
    expect(sql).toContain('toStartOfMonth');
  });
});

describe('pgTimeBucketExpression', () => {
  it('returns date_trunc day for daily grain', () => {
    const sql = db
      .selectFrom('events')
      .select(pgTimeBucketExpression('created_at', 'daily').as('b'))
      .compile().sql;
    expect(sql).toContain("'day'");
  });

  it('returns date_trunc week for weekly grain', () => {
    const sql = db
      .selectFrom('events')
      .select(pgTimeBucketExpression('created_at', 'weekly').as('b'))
      .compile().sql;
    expect(sql).toContain("'week'");
  });

  it('returns date_trunc month for monthly grain', () => {
    const sql = db
      .selectFrom('events')
      .select(pgTimeBucketExpression('created_at', 'monthly').as('b'))
      .compile().sql;
    expect(sql).toContain("'month'");
  });
});

describe('estimateBucketCount', () => {
  it('counts daily buckets inclusively', () => {
    const from = new Date('2026-01-01T00:00:00.000Z');
    const to = new Date('2026-01-03T00:00:00.000Z');
    expect(estimateBucketCount(from, to, 'daily')).toBe(3);
  });

  it('counts monthly buckets across years', () => {
    const from = new Date('2025-11-01T00:00:00.000Z');
    const to = new Date('2026-02-01T00:00:00.000Z');
    expect(estimateBucketCount(from, to, 'monthly')).toBe(4);
  });

  it('returns 0 for negative time range', () => {
    const from = new Date('2026-01-10T00:00:00.000Z');
    const to = new Date('2026-01-01T00:00:00.000Z');
    expect(estimateBucketCount(from, to, 'daily')).toBe(0);
  });

  it('counts weekly buckets', () => {
    const from = new Date('2026-01-01T00:00:00.000Z');
    const to = new Date('2026-01-22T00:00:00.000Z');
    expect(estimateBucketCount(from, to, 'weekly')).toBe(4);
  });
});
