import { describe, expect, it } from 'vitest';
import { chTimestampToDate } from './ch-timestamp';

describe('chTimestampToDate', () => {
  it('parses a ClickHouse DateTime64 string as UTC (not local time)', () => {
    expect(chTimestampToDate('2026-05-21 00:00:00.000').toISOString()).toBe(
      '2026-05-21T00:00:00.000Z',
    );
  });

  it('parses a ClickHouse DateTime string (no fractional seconds) as UTC', () => {
    expect(chTimestampToDate('2024-05-21 00:00:00').toISOString()).toBe('2024-05-21T00:00:00.000Z');
  });

  it('passes a Date through unchanged', () => {
    const d = new Date('2026-01-02T03:04:05.000Z');
    expect(chTimestampToDate(d)).toBe(d);
  });
});
