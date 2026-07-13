import { isoSeconds, isoSecondsRequired } from './iso-seconds';

describe('isoSeconds', () => {
  it('truncates milliseconds and passes null through', () => {
    expect(isoSeconds(new Date('2026-05-15T10:00:00.123Z'))).toBe('2026-05-15T10:00:00Z');
    expect(isoSeconds(null)).toBeNull();
  });
});

describe('isoSecondsRequired', () => {
  it('truncates milliseconds for non-null dates', () => {
    expect(isoSecondsRequired(new Date('2026-05-15T10:00:00.123Z'))).toBe('2026-05-15T10:00:00Z');
  });
});
