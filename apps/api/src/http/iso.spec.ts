import { isoSeconds, toIsoDate } from './iso';

describe('isoSeconds', () => {
  it('truncates milliseconds and supports null', () => {
    expect(isoSeconds(new Date('2026-05-15T10:00:00.123Z'))).toBe('2026-05-15T10:00:00Z');
    expect(isoSeconds(null)).toBeNull();
  });
});

describe('toIsoDate', () => {
  it('truncates milliseconds for non-null date values', () => {
    expect(toIsoDate(new Date('2026-05-15T10:00:00.123Z'))).toBe('2026-05-15T10:00:00Z');
  });
});
